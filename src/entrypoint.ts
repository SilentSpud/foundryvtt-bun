#!/usr/bin/env bun

/**
 * Container entrypoint.  Every non-zero exit goes through backoff.ts so
 * persistent failures (bad credentials, a full disk) cannot become a rapid
 * restart loop.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    closeSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    statSync,
    utimesSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";

import { backoffOnFailure, backoffReset, DEFAULT_CACHE } from "./backoff.ts";
import { cachePrune } from "./cache_prune.ts";
import { download } from "./download.ts";
import { DownloadLock, SlotState } from "./download_lock.ts";
import { envIsTrue } from "./env_flag.ts";
import { DEFAULT_USER_AGENT, FoundrySession } from "./foundry_site.ts";
import { launch } from "./launcher.ts";
import { runChild } from "./lifecycle.ts";
import createLogger, { type Logger } from "./logging.ts";
import { patchLanguage } from "./patch_lang.ts";
import {
    archiveKind,
    isLinuxRelease,
    releaseArchiveVersion,
    releaseVersion,
} from "./release_verify.ts";
import { ExitError, isDirectory, isFile, parseNonNegativeInt } from "./util.ts";

const DATA_DIR = "/data";
const CONFIG_DIR = `${DATA_DIR}/Config`;
const LICENSE_FILE = `${CONFIG_DIR}/license.json`;
const DEPRECATED_ENVS = [
    "CONTAINER_PRESERVE_OWNER",
    "FOUNDRY_UID",
    "FOUNDRY_GID",
    "TIMEZONE",
];
const LICENSE_MIN_LENGTH = 24;
const SECRET_FILE = "/run/secrets/config.json";
const IMAGE_VERSION_FILE = "image_version.txt";
const INSTALLED_PACKAGE = "resources/app/package.json";
const LOG_HELPERS = `${import.meta.dir}/logging.sh`;
const SECRET_NAME_RE = /PASSWORD|KEY|SECRET|TOKEN|SALT/;

const env = process.env;

// Normalize CONTAINER_VERBOSE before anything logs or spawns: the shell log
// helpers available to patch scripts are presence-based, so without this a
// value like "false" would turn their debug logging ON.
const verbose = envIsTrue(
    "CONTAINER_VERBOSE",
    env,
    createLogger("Entrypoint", { stream: "stdout" }),
);
if (verbose) {
    env.CONTAINER_VERBOSE = "true";
} else {
    delete env.CONTAINER_VERBOSE;
}

function logger(name: string): Logger {
    return createLogger(name, {
        level: verbose ? "debug" : "info",
        stream: "stdout",
    });
}

const log = logger("Entrypoint");
const lock = new DownloadLock(log, env);
const terminate = new AbortController();
let phase: "setup" | "server" | "exiting" = "setup";
let sigtermReceived = false;

function onSigterm(): void {
    log.warn("TERM signal received.  Shutting down server.");
    sigtermReceived = true;
    // Interrupts any in-progress backoff sleep.
    terminate.abort();
    if (phase === "setup") {
        // No child to forward the signal to, so stop now and free the lock.
        log.warn("TERM received before child process was started.");
        lock.release();
        process.exit(143);
    }
}

function readImageVersion(): string {
    try {
        return readFileSync(IMAGE_VERSION_FILE, "utf8").trim();
    } catch {
        log.error(`Unable to read ${IMAGE_VERSION_FILE}.`);
        throw new ExitError(1);
    }
}

function debugEnvironment(): string {
    return Object.entries(env)
        .map(
            ([name, value]) =>
                `${name}=${SECRET_NAME_RE.test(name) ? "[REDACTED]" : value}`,
        )
        .sort()
        .join("\n");
}

function testVolumePermissions(): void {
    const testFile = `${DATA_DIR}/.container-permissions-test.txt`;
    let failed = false;
    log.debug(`Testing permissions on ${testFile}`);
    const check = (what: string, action: () => void) => {
        try {
            action();
            log.debug(`Volume ${what} test succeeded.`);
        } catch {
            log.error(`Volume ${what} test failed.`);
            failed = true;
        }
    };
    check("write", () => closeSync(openSync(testFile, "a")));
    check("read", () => readFileSync(testFile));
    check("delete", () => rmSync(testFile, { force: true }));
    if (failed) {
        log.error(`Aborting due to insufficient permissions on ${DATA_DIR}`);
        log.error(
            `Container running as uid:gid: ${process.getuid?.()}:${process.getgid?.()}`,
        );
        log.error(
            "For more information see the discussion at: https://github.com/felddy/foundryvtt-docker/discussions/1197",
        );
        throw new ExitError(1);
    }
    log.debug("All permissions tests succeeded.");
}

/** Values from the secrets file override the environment when set. */
function applySecrets(): void {
    if (!isFile(SECRET_FILE)) {
        return;
    }
    log.info(`Reading configured secrets from: ${SECRET_FILE}`);
    let secrets: Record<string, unknown> = {};
    try {
        const parsed: unknown = JSON.parse(readFileSync(SECRET_FILE, "utf8"));
        if (parsed !== null && typeof parsed === "object") {
            secrets = parsed as Record<string, unknown>;
        }
    } catch {
        log.warn(`Unable to parse secrets file: ${SECRET_FILE}`);
    }
    for (const name of [
        "FOUNDRY_ADMIN_KEY",
        "FOUNDRY_LICENSE_KEY",
        "FOUNDRY_PASSWORD",
        "FOUNDRY_PASSWORD_SALT",
        "FOUNDRY_SERVICE_KEY",
        "FOUNDRY_USERNAME",
    ]) {
        const value = secrets[name.toLowerCase()];
        if (
            value !== null &&
            value !== undefined &&
            value !== false &&
            value !== ""
        ) {
            env[name] = String(value);
        }
    }
}

function installedVersion(): string | undefined {
    if (!isFile(INSTALLED_PACKAGE)) {
        return undefined;
    }
    try {
        const pkg: unknown = JSON.parse(
            readFileSync(INSTALLED_PACKAGE, "utf8"),
        );
        const release = (
            pkg as { release?: { generation?: unknown; build?: unknown } }
        )?.release;
        return (
            releaseVersion(pkg) ??
            `${release?.generation ?? null}.${release?.build ?? null}`
        );
    } catch {
        return "unknown";
    }
}

/**
 * The release endpoint keys on build number alone, so a nonexistent
 * generation yields another generation's release (#1051), which would poison
 * the cache.  An undeterminable version only warns.
 */
function verifyReleaseFile(file: string, foundryVersion: string): void {
    const found = releaseArchiveVersion(file);
    if (found === undefined) {
        log.warn(
            "Unable to determine the version inside the release archive.  Proceeding without verification.",
        );
        return;
    }
    if (found !== foundryVersion) {
        log.error(
            `The release archive contains Foundry Virtual Tabletop ${found}, not the requested ${foundryVersion}.`,
        );
        log.error(
            `Version ${foundryVersion} most likely does not exist.  See: https://foundryvtt.com/releases/`,
        );
        log.warn("Deleting the mislabeled release file.");
        rmSync(file, { force: true });
        throw new ExitError(1);
    }
    log.debug(`Release archive verified as version ${found}.`);
}

/** Mark the cache directory per https://bford.info/cachedir/ */
function writeCacheTag(cacheDir: string): void {
    const signature = createHash("md5")
        .update(".IsCacheDirectory")
        .digest("hex");
    writeFileSync(
        `${cacheDir}/CACHEDIR.TAG`,
        `Signature: ${signature}\n` +
            "# This file is a cache directory tag created by the silentspud/foundryvtt-bun container\n" +
            "# https://github.com/SilentSpud/foundryvtt-bun\n" +
            "# For information about cache directory tags see https://bford.info/cachedir/\n",
    );
}

/** An active download's mtime keeps advancing, so a stalled one is orphaned. */
function sweepStaleDownloads(cacheRoot: string, foundryVersion: string): void {
    const { pollSeconds, stallTicks } = lock.tunables;
    const minutes = Math.max(
        5,
        Math.ceil((Math.floor(pollSeconds) * stallTicks) / 60),
    );
    const prefix = `downloading-${foundryVersion}.`;
    let names: string[] = [];
    try {
        names = readdirSync(cacheRoot);
    } catch {
        return;
    }
    for (const name of names) {
        if (!name.startsWith(prefix) || !name.endsWith(".zip")) {
            continue;
        }
        const path = `${cacheRoot}/${name}`;
        try {
            if (Date.now() - statSync(path).mtimeMs > minutes * 60_000) {
                rmSync(path, { force: true });
            }
        } catch {
            // vanished
        }
    }
    // Temp files left behind by older image generations (the shared and the
    // version-only names); current instances never write these.
    rmSync(`${cacheRoot}/downloading.zip`, { force: true });
    rmSync(`${cacheRoot}/downloading-${foundryVersion}.zip`, { force: true });
}

async function unzip(args: string[]): Promise<void> {
    const status = await runChild(["unzip", ...args]);
    if (status !== 0) {
        log.error(`unzip failed with exit code ${status}.`);
        throw new ExitError(status);
    }
}

/** Matches the environment patches had when the entrypoint was a shell script. */
async function runPatch(file: string): Promise<void> {
    const status = await runChild(
        [
            "bash",
            "-c",
            'set -o errexit -o nounset -o pipefail; source "$1"; source "$2"',
            "patch",
            LOG_HELPERS,
            file,
        ],
        { env: { ...env, LOG_NAME: "Entrypoint" } },
    );
    if (status !== 0) {
        log.error(`Patch ${file} failed with exit code ${status}.`);
        throw new ExitError(status);
    }
}

async function applyPatches(userAgent: string): Promise<void> {
    if (env.CONTAINER_PATCH_URLS) {
        log.warn(
            "CONTAINER_PATCH_URLS is set:  Only use patch URLs from trusted sources!",
        );
        for (const url of env.CONTAINER_PATCH_URLS.split(/\s+/).filter(
            Boolean,
        )) {
            log.info(`Downloading patch from URL: ${url}`);
            const dir = mkdtempSync(`${tmpdir()}/patch_url.`);
            const patchFile = `${dir}/patch.sh`;
            // download() rejects HTTP errors so an error page is never run.
            // A 200 body is still trusted, as the warning states.
            try {
                await download(url, patchFile, {
                    userAgent,
                    logger: log,
                    progressInterval: 0,
                });
            } catch (err) {
                log.error(
                    `Failed to download patch from URL: ${url} (${(err as Error).message})`,
                );
                throw new ExitError(1);
            }
            log.debug(`Running patch file: ${patchFile}`);
            await runPatch(patchFile);
        }
        log.info("Completed URL patching.");
    }

    const patchDir = env.CONTAINER_PATCHES;
    if (patchDir) {
        log.info(`Using CONTAINER_PATCHES: ${patchDir}`);
        if (isDirectory(patchDir)) {
            log.info(
                "Container patches directory detected.  Starting patch application...",
            );
            for (const name of readdirSync(patchDir).sort()) {
                const file = `${patchDir}/${name}`;
                if (!isFile(file)) {
                    continue;
                }
                log.info(`Running patch from file: ${file}`);
                await runPatch(file);
            }
            log.info("Completed file patching.");
        } else {
            log.warn("Container patches directory not found.");
        }
    }
}

interface InstallContext {
    foundryVersion: string;
    userAgent: string;
}

/** Download (if needed) and install the requested release. */
async function install(
    ctx: InstallContext,
): Promise<FoundrySession | undefined> {
    const { foundryVersion, userAgent } = ctx;
    let session: FoundrySession | undefined;

    // Unset → default location; set to an empty string → caching disabled.
    const cache = env.CONTAINER_CACHE ?? DEFAULT_CACHE;
    env.CONTAINER_CACHE = cache;
    if (cache) {
        log.info(`Using CONTAINER_CACHE: ${cache}`);
        mkdirSync(cache, { recursive: true });
        writeCacheTag(cache);
    } else {
        log.warn(
            "CONTAINER_CACHE has been unset.  Release caching is disabled.",
        );
    }

    // An all-slash value ("/", "//") means the filesystem root, not "no cache".
    let cacheRoot = cache;
    while (cacheRoot.endsWith("/") && cacheRoot !== "/") {
        cacheRoot = cacheRoot.slice(0, -1);
    }
    const prefix = cacheRoot
        ? cacheRoot.endsWith("/")
            ? cacheRoot
            : `${cacheRoot}/`
        : "";
    // Version-unique so instances sharing a cache cannot mislabel releases;
    // instance-unique so a resumed "dead" downloader renames only its own
    // file.  Must not match the foundryvtt-*.zip pruning pattern.
    const downloadingGlob = `${prefix}downloading-${foundryVersion}.*.zip`;
    const downloadingFile = `${prefix}downloading-${foundryVersion}.${env.HOSTNAME || "unknown"}-${process.pid}.zip`;
    const releaseFile = `${prefix}foundryvtt-${foundryVersion}.zip`;

    let presignedUrl: string | undefined;
    if (env.FOUNDRY_RELEASE_URL) {
        log.info("Using FOUNDRY_RELEASE_URL to download release.");
        presignedUrl = env.FOUNDRY_RELEASE_URL;
    }

    let fetchReleaseUrl = false;
    if (env.FOUNDRY_USERNAME && env.FOUNDRY_PASSWORD) {
        // Login is only for the release URL and license key.  Skipping it
        // when neither is needed avoids rate limits on shared caches (#1399).
        const licenseKey = env.FOUNDRY_LICENSE_KEY ?? "";
        if (
            isFile(releaseFile) &&
            (isFile(LICENSE_FILE) || licenseKey.length >= LICENSE_MIN_LENGTH)
        ) {
            log.info(
                "Requested release is cached and licensing is settled.  Skipping authentication.",
            );
        } else {
            log.info(
                "Using FOUNDRY_USERNAME and FOUNDRY_PASSWORD to authenticate.",
            );
            const authLog = logger("Authenticate");
            const candidate = new FoundrySession({
                logger: authLog,
                userAgent,
            });
            try {
                await candidate.login(
                    env.FOUNDRY_USERNAME.toLowerCase(),
                    env.FOUNDRY_PASSWORD,
                );
                session = candidate;
            } catch (err) {
                authLog.error(
                    `Unable to authenticate: ${(err as Error).message}`,
                );
                log.warn("Authentication failed.");
            }
            if (session && !presignedUrl && !isFile(releaseFile)) {
                // Deferred until the download slot is held, so only one
                // instance hits the rate-limited endpoint (#1399).
                fetchReleaseUrl = true;
            }
        }
    }

    // A FOUNDRY_RELEASE_URL re-download over a cached file stays unguarded:
    // concurrent complete downloads rename atomically and are benign.
    let slot = SlotState.Unarbitrated;
    if (
        cacheRoot &&
        !isFile(releaseFile) &&
        (presignedUrl || fetchReleaseUrl)
    ) {
        slot = await lock.acquire(
            `${releaseFile}.lock`,
            releaseFile,
            downloadingGlob,
        );
        if (slot === SlotState.Cached) {
            log.info(
                "Another instance finished downloading this release.  Using the cached file.",
            );
        } else if (slot === SlotState.GaveUp) {
            log.error(
                "Gave up waiting for another instance's stalled download.",
            );
            throw new ExitError(1);
        }
    }

    if (fetchReleaseUrl && session && !isFile(releaseFile)) {
        log.info("Using authenticated credentials to fetch release URL.");
        let retries = 0;
        const retryOption = env.CONTAINER_URL_FETCH_RETRY;
        if (retryOption !== undefined) {
            const parsed = parseNonNegativeInt(retryOption);
            if (parsed === undefined) {
                log.error(
                    `CONTAINER_URL_FETCH_RETRY must be a non-negative integer.  Found: ${retryOption}`,
                );
                throw new ExitError(1);
            }
            retries = parsed;
        }
        const releaseLog = logger("ReleaseURL");
        const releaseSession = new FoundrySession(
            { logger: releaseLog, userAgent },
            session.jar,
        );
        try {
            presignedUrl = await releaseSession.releaseUrl(
                foundryVersion,
                retries,
            );
        } catch (err) {
            releaseLog.error((err as Error).message);
            throw new ExitError(1);
        }
    }

    if (presignedUrl && slot !== SlotState.Cached) {
        log.info("Downloading Foundry Virtual Tabletop release.");
        // A not-modified hit writes nothing, so the rename below would move
        // an interrupted run's partial over the good release.
        rmSync(downloadingFile, { force: true });
        if (cacheRoot) {
            sweepStaleDownloads(cacheRoot, foundryVersion);
        }
        let downloaded = false;
        try {
            // Only downloads when the remote release is newer than the cache.
            await download(presignedUrl, downloadingFile, {
                userAgent,
                logger: log,
                newerThan: releaseFile,
            });
            downloaded = true;
        } catch (err) {
            log.warn(
                `Download from presigned URL failed: ${(err as Error).message}`,
            );
            rmSync(downloadingFile, { force: true });
            if (isFile(releaseFile)) {
                log.info(
                    `Falling back to existing cached release file: ${releaseFile}`,
                );
            } else {
                log.error(
                    "No valid cached release file found. Unable to proceed with installation.",
                );
                throw new ExitError(1);
            }
        }
        if (downloaded && isFile(downloadingFile)) {
            // Verify before the rename so a wrong version never enters the cache.
            verifyReleaseFile(downloadingFile, foundryVersion);
            try {
                renameSync(downloadingFile, releaseFile);
            } catch {
                // the release file check below decides
            }
        }
    }
    lock.release();

    if (!isFile(releaseFile)) {
        log.error("Unable to install Foundry Virtual Tabletop!");
        log.error("Either set FOUNDRY_RELEASE_URL.");
        log.error("Or set FOUNDRY_USERNAME and FOUNDRY_PASSWORD.");
        log.error(
            `Or set CONTAINER_CACHE to a directory containing foundryvtt-${foundryVersion}.zip`,
        );
        throw new ExitError(1);
    }

    log.info(`Installing Foundry Virtual Tabletop ${foundryVersion}`);
    verifyReleaseFile(releaseFile, foundryVersion);
    // Record the use: cache eviction is least-recently-used by mtime.
    try {
        const now = new Date();
        utimesSync(releaseFile, now, now);
    } catch {
        // read-only cache
    }

    log.debug(`Checking file type of release file: ${releaseFile}`);
    const kind = archiveKind(releaseFile);
    log.debug(`Found file type: ${kind}`);
    if (kind !== "zip") {
        if (kind === "windows-exe") {
            log.error(
                "The release file appears to be a Windows executable (.exe).",
            );
        } else if (kind === "mac-dmg") {
            log.error(
                "The release file appears to be a Mac disk image (.dmg).",
            );
        } else {
            log.error(
                "The release file does not contain the expected zip data.",
            );
        }
        log.error(
            "Please provide the 'Linux/NodeJS' version of the release or URL.",
        );
        log.warn("Deleting invalid release file from cache.");
        rmSync(releaseFile, { force: true });
        throw new ExitError(1);
    }
    let linux = false;
    try {
        linux = isLinuxRelease(releaseFile);
    } catch {
        // unzip reports the damage below
    }
    if (linux) {
        log.debug("Extracting Linux release file.");
        log.warn(
            "You can conserve disk space by using Node.js releases instead of Linux releases.",
        );
        await unzip(["-q", releaseFile, "resources/*"]);
    } else {
        log.debug("Extracting Node.js release file.");
        mkdirSync("resources/app", { recursive: true });
        await unzip(["-q", releaseFile, "-d", "resources/app"]);
    }
    log.debug("Installation completed.");

    if (cache) {
        log.info("Preserving release archive file in cache.");
        const cacheSize = env.CONTAINER_CACHE_SIZE;
        if (cacheSize) {
            const keep = parseNonNegativeInt(cacheSize.trim());
            if (!keep) {
                log.error(
                    `If set, CONTAINER_CACHE_SIZE must be 1 or greater.  Found: ${cacheSize}`,
                );
                throw new ExitError(1);
            }
            log.info(`Cleaning up cache directory: ${cache}`);
            log.info(`Keeping the ${keep} most recently used releases.`);
            cachePrune(cacheRoot, keep, log);
        } else {
            log.debug(
                "CONTAINER_CACHE_SIZE is not set. Skipping cache cleanup.",
            );
        }
    } else {
        log.info("Deleting release archive file.");
        rmSync(releaseFile, { force: true });
    }

    await applyPatches(userAgent);

    log.debug("Patching GUI update and configuration messages.");
    patchLanguage(
        `${env.HOME}/resources/app/public/lang/en.json`,
        envIsTrue("CONTAINER_PRESERVE_CONFIG", env, log),
    );
    return session;
}

async function license(session: FoundrySession | undefined): Promise<void> {
    if (isFile(LICENSE_FILE)) {
        log.info("Not modifying existing installation license key.");
        return;
    }
    log.info("Installation not yet licensed.");
    log.debug(`Ensuring ${CONFIG_DIR} directory exists.`);
    mkdirSync(CONFIG_DIR, { recursive: true });
    const key = env.FOUNDRY_LICENSE_KEY ?? "";
    let licenseKey: string;
    if (key.length >= LICENSE_MIN_LENGTH) {
        log.info("Applying license key passed via FOUNDRY_LICENSE_KEY.");
        licenseKey = key.replace(/-/g, "");
    } else if (session) {
        log.info("Attempting to fetch license key from authenticated account.");
        const licenseLog = logger("License");
        const licenseSession = new FoundrySession(
            { logger: licenseLog },
            session.jar,
        );
        try {
            // A short FOUNDRY_LICENSE_KEY selects one of several keys by index.
            licenseKey = await licenseSession.license(key || undefined);
        } catch (err) {
            licenseLog.error((err as Error).message);
            throw new ExitError(1);
        }
    } else {
        log.warn(
            "Unable to apply a license key since neither a license key nor credentials were provided.  The license key will need to be entered in the browser.",
        );
        return;
    }
    writeFileSync(
        LICENSE_FILE,
        JSON.stringify({ license: licenseKey }, null, 2) + "\n",
    );
}

async function run(args: string[]): Promise<number> {
    const imageVersion = readImageVersion();

    for (const name of DEPRECATED_ENVS) {
        if (env[name]) {
            log.warn(
                `The environment variable "${name}" is deprecated and will be ignored.`,
            );
        }
    }

    log.info(`Starting silentspud/foundryvtt-bun container v${imageVersion}`);
    log.debug("CONTAINER_VERBOSE set.  Debug logging enabled.");
    log.debug(
        `Running as: uid=${process.getuid?.()} gid=${process.getgid?.()}`,
    );
    log.debug(`Environment:\n${debugEnvironment()}`);
    log.debug(`Data directory: ${DATA_DIR}`);
    const mount = spawnSync(
        "findmnt",
        ["-n", "-o", "SOURCE,FSTYPE,OPTIONS", "--target", DATA_DIR],
        {
            encoding: "utf8",
        },
    );
    if (mount.status === 0) {
        log.debug(`Mount info for ${DATA_DIR}: ${mount.stdout.trim()}`);
    }

    testVolumePermissions();

    const userAgent = `${DEFAULT_USER_AGENT} (silentspud/foundryvtt-bun:${imageVersion})`;

    // The container version is a semver x.y.z; FOUNDRY_VERSION looks like x.yyy.
    const expected = imageVersion.replace(/\.[^.]*$/, "");
    // The image sets FOUNDRY_VERSION, but an empty override (such as an
    // unset compose substitution) means "the image's own version".
    const foundryVersion = env.FOUNDRY_VERSION || expected;
    env.FOUNDRY_VERSION = foundryVersion;
    if (expected !== foundryVersion) {
        log.warn(
            "FOUNDRY_VERSION has been manually set and does not match the container's version.",
        );
        log.warn(`Expected ${expected} but found ${foundryVersion}`);
        log.warn(
            "The container may not function properly with this version mismatch.",
        );
    }

    applySecrets();

    let installRequired = false;
    const installed = installedVersion();
    if (installed !== undefined) {
        log.info(`Foundry Virtual Tabletop ${installed} is installed.`);
        if (installed !== foundryVersion) {
            log.info(
                `Requested version (${foundryVersion}) from FOUNDRY_VERSION differs.`,
            );
            log.info(`Uninstalling version ${installed}.`);
            rmSync("resources", { recursive: true, force: true });
            installRequired = true;
        }
    } else {
        log.info("No Foundry Virtual Tabletop installation detected.");
        installRequired = true;
    }

    let session: FoundrySession | undefined;
    if (installRequired) {
        session = await install({ foundryVersion, userAgent });
    }

    await license(session);

    log.info("Starting launcher.");
    phase = "server";
    const status = await launch(args, CONFIG_DIR, env, logger("Launcher"));
    log.debug(`Child process exited with code: ${status}.`);
    return status;
}

async function main(): Promise<never> {
    const args = process.argv.slice(2);
    if (args[0] === "--version") {
        try {
            process.stdout.write(`${readImageVersion()}\n`);
            process.exit(0);
        } catch {
            process.exit(1);
        }
    }

    process.on("SIGTERM", onSigterm);
    let code: number;
    try {
        code = await run(args);
    } catch (err) {
        if (err instanceof ExitError) {
            code = err.code;
        } else {
            log.error(
                `Unexpected error: ${(err as Error).stack ?? String(err)}`,
            );
            code = 1;
        }
    }
    phase = "exiting";
    // Never hold the download lock through a backoff sleep.
    lock.release();
    log.debug(`exit: code ${code} (sigterm_received=${sigtermReceived})`);
    if (code === 0 || sigtermReceived || code === 143) {
        backoffReset(env, log);
    } else {
        code = await backoffOnFailure(code, {
            env,
            logger: log,
            signal: terminate.signal,
        });
    }
    process.exit(code);
}

await main();
