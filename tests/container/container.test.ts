/**
 * Tests against the built image (IMAGE_TAG, default local/test-image:latest).
 *
 * Most tests run without credentials: a fake release archive in the cache
 * drives the whole startup path (verify, install, patch, configure, launch,
 * health check, shutdown).  When FOUNDRY_USERNAME and FOUNDRY_PASSWORD are
 * set, the real release is also downloaded and started.
 */

import { afterAll, describe, expect, test } from "bun:test";
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { releaseJson, writeZip } from "../helpers/zip.ts";
import {
    docker,
    FOUNDRY_VERSION,
    IMAGE,
    PROJECT_VERSION,
    READY_MESSAGE,
    uniqueName,
    userArgs,
    waitForLog,
} from "./docker.ts";

const [GENERATION, BUILD] = FOUNDRY_VERSION.split(".").map(Number) as [
    number,
    number,
];
const containers: string[] = [];
const dirs: string[] = [];

afterAll(async () => {
    for (const name of containers) {
        await docker("rm", "--force", name);
    }
    for (const dir of dirs) {
        rmSync(dir, { recursive: true, force: true });
    }
});

/** A data directory any container UID can write. */
function dataDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "fvtt-data-")).replaceAll("\\", "/");
    chmodSync(dir, 0o777);
    dirs.push(dir);
    return dir;
}

/** A Node.js-layout release whose server answers the status endpoint. */
const FAKE_MAIN = `
import { writeFileSync } from "node:fs";
import http from "node:http";
const port = Number((process.argv.find((a) => a.startsWith("--port=")) ?? "--port=30000").slice(7));
writeFileSync("/data/server-env.json", JSON.stringify({ env: process.env, argv: process.argv.slice(2) }));
const server = http.createServer((req, res) => {
    if (req.url.endsWith("/api/status")) {
        res.writeHead(200, { "content-type": "application/json", "set-cookie": "session=fake" });
        res.end(JSON.stringify({ active: false, version: "${FOUNDRY_VERSION}" }));
    } else {
        res.writeHead(404);
        res.end();
    }
});
server.listen(port, () => console.log("${READY_MESSAGE} " + port));
process.on("SIGTERM", () => {
    console.log("fake-foundry: flushing data");
    setTimeout(() => process.exit(0), 500);
});
`;

function fakeRelease(
    cacheDir: string,
    generation = GENERATION,
    build = BUILD,
): string {
    mkdirSync(cacheDir, { recursive: true });
    return writeZip(`${cacheDir}/foundryvtt-${FOUNDRY_VERSION}.zip`, {
        "package.json": releaseJson(generation, build),
        "main.mjs": FAKE_MAIN,
        "public/": "",
        "public/lang/": "",
        "public/lang/en.json": JSON.stringify({
            "SETUP.UpdateHint": "original",
        }),
    });
}

async function start(
    name: string,
    data: string,
    env: Record<string, string>,
    ...extra: string[]
) {
    containers.push(name);
    const envArgs = Object.entries(env).flatMap(([key, value]) => [
        "-e",
        `${key}=${value}`,
    ]);
    const result = await docker(
        "run",
        "--detach",
        "--name",
        name,
        ...userArgs(),
        "-v",
        `${data}:/data`,
        ...envArgs,
        ...extra,
        IMAGE,
    );
    expect(result.code).toBe(0);
}

test("--version prints the project version", async () => {
    const result = await docker("run", "--rm", IMAGE, "--version");
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(PROJECT_VERSION);
});

describe("fake release", () => {
    test("installs, configures, serves, reports healthy, and shuts down cleanly", async () => {
        const data = dataDir();
        fakeRelease(`${data}/container_cache`);
        const name = uniqueName("fvtt-fake");
        await start(name, data, {
            CONTAINER_VERBOSE: "true",
            FOUNDRY_ADMIN_KEY: "atropos",
            FOUNDRY_LICENSE_KEY: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF",
            FOUNDRY_PASSWORD: "not-passed-to-the-server",
            FOUNDRY_IP_DISCOVERY: "false",
            NODE_OPTIONS: "--max-old-space-size=256 --no-warnings",
            TZ: "UTC",
        });
        await waitForLog(name, (logs) => logs.includes(READY_MESSAGE));

        // Configuration files.
        const options = JSON.parse(
            readFileSync(`${data}/Config/options.json`, "utf8"),
        );
        expect(options.port).toBe(30000);
        expect(options.dataPath).toBe("/data");
        expect(readFileSync(`${data}/Config/admin.txt`, "utf8")).toMatch(
            /^[0-9a-f]{128}$/,
        );
        expect(
            JSON.parse(readFileSync(`${data}/Config/license.json`, "utf8")),
        ).toEqual({
            license: "AAAABBBBCCCCDDDDEEEEFFFF",
        });
        expect(existsSync(`${data}/container_cache/CACHEDIR.TAG`)).toBe(true);

        // The server runs with a clean environment and the generated flags.
        const server = JSON.parse(
            readFileSync(`${data}/server-env.json`, "utf8"),
        );
        expect(server.env.TZ).toBe("UTC");
        expect(server.env.NODE_OPTIONS).toBe(
            "--max-old-space-size=256 --no-warnings",
        );
        expect(server.env.FOUNDRY_PASSWORD).toBeUndefined();
        expect(server.env.FOUNDRY_ADMIN_KEY).toBeUndefined();
        expect(server.argv).toContain("--noipdiscovery");

        // The language file was patched inside the container.
        const lang = await docker(
            "exec",
            name,
            "cat",
            "resources/app/public/lang/en.json",
        );
        expect(JSON.parse(lang.stdout)["SETUP.UpdateHint"]).toContain(
            "Docker container",
        );

        const health = await docker("exec", name, "./check_health.js");
        expect(health.code).toBe(0);

        // SIGTERM is forwarded and the entrypoint waits for the server.
        const stop = await docker("stop", "--time", "20", name);
        expect(stop.code).toBe(0);
        const logs = (await docker("logs", name)).stdout;
        expect(logs).toContain("fake-foundry: flushing data");
        const exitCode = (
            await docker("inspect", "--format", "{{.State.ExitCode}}", name)
        ).stdout.trim();
        expect(exitCode).toBe("0");
        expect(existsSync(`${data}/container_cache/backoff_state.json`)).toBe(
            false,
        );
    });

    test("a mislabeled release fails, is deleted, and records a backoff failure", async () => {
        const data = dataDir();
        const archive = fakeRelease(
            `${data}/container_cache`,
            GENERATION - 1,
            BUILD,
        );
        const name = uniqueName("fvtt-mislabeled");
        await start(name, data, {});
        const result = await docker("wait", name);
        expect(result.stdout.trim()).toBe("1");
        const logs = (await docker("logs", name)).stdout;
        expect(logs).toContain(
            `contains Foundry Virtual Tabletop ${GENERATION - 1}.${BUILD}`,
        );
        expect(existsSync(archive)).toBe(false);
        const state = JSON.parse(
            readFileSync(`${data}/container_cache/backoff_state.json`, "utf8"),
        );
        expect(state.consecutive_failures).toBe(1);
    });

    test("patch scripts run with the log helpers before the server starts", async () => {
        const data = dataDir();
        fakeRelease(`${data}/container_cache`);
        mkdirSync(`${data}/patches`);
        await Bun.write(
            `${data}/patches/01-marker.sh`,
            'log "patch running for ${FOUNDRY_VERSION}"\necho patched > /data/patch-marker\n',
        );
        const name = uniqueName("fvtt-patch");
        await start(name, data, { CONTAINER_PATCHES: "/data/patches" });
        const logs = await waitForLog(name, (text) =>
            text.includes(READY_MESSAGE),
        );
        expect(logs).toContain(`patch running for ${FOUNDRY_VERSION}`);
        expect(readFileSync(`${data}/patch-marker`, "utf8").trim()).toBe(
            "patched",
        );
    });
});

describe("Foundry VTT CLI", () => {
    const fvtt = (...args: string[]) =>
        docker("run", "--rm", "--entrypoint", "fvtt", ...args).then(
            (result) => {
                expect(result.code).toBe(0);
                return result.stdout.trim();
            },
        );
    const cliVersion = /^ARG FOUNDRYVTT_CLI_VERSION=(\S+)$/m.exec(
        readFileSync("Dockerfile", "utf8"),
    )?.[1];

    test("reports the pinned version", async () => {
        expect(cliVersion).toBeDefined();
        expect(await fvtt(IMAGE, "--version")).toBe(cliVersion!);
    });

    test("seeds the install and data paths", async () => {
        expect(await fvtt(IMAGE, "configure", "get", "installPath")).toBe(
            "/home/node/resources/app",
        );
        expect(await fvtt(IMAGE, "configure", "get", "dataPath")).toBe("/data");
    });

    test("considers the seeded configuration complete", async () => {
        expect(await fvtt(IMAGE, "configure")).toBe("Configuration complete!");
    });

    test("works as an arbitrary UID", async () => {
        expect(
            await fvtt(
                "--user",
                "12345:12345",
                IMAGE,
                "configure",
                "get",
                "dataPath",
            ),
        ).toBe("/data");
    });
});

const hasCredentials = Boolean(
    process.env.FOUNDRY_USERNAME && process.env.FOUNDRY_PASSWORD,
);

describe.skipIf(!hasCredentials)("real release", () => {
    test("downloads, starts, and becomes healthy", async () => {
        const data = dataDir();
        const name = uniqueName("foundry");
        await start(name, data, {
            CONTAINER_URL_FETCH_RETRY: "5",
            CONTAINER_VERBOSE: "true",
            FOUNDRY_ADMIN_KEY: process.env.FOUNDRY_ADMIN_KEY || "atropos",
            FOUNDRY_PASSWORD: process.env.FOUNDRY_PASSWORD!,
            FOUNDRY_USERNAME: process.env.FOUNDRY_USERNAME!,
            TZ: "UTC",
        });
        // This can take a while if we must back off due to rate limiting.
        await waitForLog(name, (logs) => logs.includes(READY_MESSAGE), {
            print: true,
        });
        for (let i = 0; i < 180; i++) {
            const health = (
                await docker(
                    "inspect",
                    "--format",
                    "{{.State.Health.Status}}",
                    name,
                )
            ).stdout.trim();
            if (health === "healthy") {
                return;
            }
            await Bun.sleep(1000);
        }
        throw new Error(
            "The container did not become healthy within 180 seconds.",
        );
    });
});

test.skipIf(!process.env.RELEASE_TAG)(
    "release tag matches the project version",
    () => {
        expect(process.env.RELEASE_TAG).toBe(`v${PROJECT_VERSION}`);
    },
);

// The version label is added by the GitHub Actions build workflow, so it is
// only checked during release builds there.
test.skipIf(
    process.env.GITHUB_ACTIONS !== "true" ||
        process.env.GITHUB_EVENT_NAME !== "release",
)("container version label matches the project version", async () => {
    const label = await docker(
        "inspect",
        "--format",
        '{{index .Config.Labels "org.opencontainers.image.version"}}',
        IMAGE,
    );
    expect(label.stdout.trim()).toBe(PROJECT_VERSION);
});
