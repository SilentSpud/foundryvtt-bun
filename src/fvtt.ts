#!/usr/bin/env bun

/**
 * Wrapper for the Foundry Virtual Tabletop CLI, installed in the image as
 * /usr/local/bin/fvtt.
 *
 * The CLI persists its configuration to ${XDG_DATA_HOME}/.fvttrc.yml
 * (~/.local/share when unset) and creates that file on every invocation, so
 * the location must be writable.  The container may run as an arbitrary UID
 * whose home directory is not writable, so default the location to the /data
 * volume, which the entrypoint guarantees is writable and which persists
 * across container recreation.  The variable is scoped to the CLI process
 * only; the Foundry server never sees it.  Set XDG_DATA_HOME to override.
 *
 * On first use, seed the configuration with this container's Foundry
 * installation and data paths so CLI commands work without any manual
 * `fvtt configure set` steps.
 */

import {
    chmodSync,
    existsSync,
    linkSync,
    mkdirSync,
    rmSync,
    writeFileSync,
} from "node:fs";

import { runChild } from "./lifecycle.ts";

export const CLI_MAIN =
    "/usr/local/lib/foundryvtt-cli/node_modules/@foundryvtt/foundryvtt-cli/fvtt.mjs";
export const DEFAULT_XDG_DATA_HOME = "/data/.local/share";
export const SEED_CONFIG =
    "installPath: /home/node/resources/app\ndataPath: /data\n";

/**
 * Create the configuration file if it is missing.  The file is written to a
 * temporary name and hard-linked into place, so concurrent first invocations
 * never observe a partial file and the first one to land wins.  It is left
 * writable by any UID — matching this image's /data volume conventions — so
 * a later run under a different UID can still `fvtt configure set`.
 */
export function seedConfig(dataHome: string): string {
    const configFile = `${dataHome}/.fvttrc.yml`;
    if (existsSync(configFile)) {
        return configFile;
    }
    // Directories created here must stay writable by any UID a later
    // container run may use.  Pre-existing directories (e.g. a user-supplied
    // XDG_DATA_HOME) are never modified.
    const previous = process.umask(0);
    try {
        mkdirSync(dataHome, { recursive: true });
    } finally {
        process.umask(previous);
    }
    const tmpFile = `${configFile}.${process.pid}.${Math.random().toString(36).slice(2)}`;
    writeFileSync(tmpFile, SEED_CONFIG);
    try {
        chmodSync(tmpFile, 0o666);
        try {
            linkSync(tmpFile, configFile);
        } catch (err) {
            // EEXIST: another invocation won the race; keep its file.
            if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
                throw err;
            }
        }
    } finally {
        rmSync(tmpFile, { force: true });
    }
    return configFile;
}

if (import.meta.main) {
    if (!existsSync(CLI_MAIN)) {
        console.error(`The Foundry VTT CLI is not installed at ${CLI_MAIN}.`);
        process.exit(1);
    }
    const dataHome = process.env.XDG_DATA_HOME || DEFAULT_XDG_DATA_HOME;
    seedConfig(dataHome);

    // The terminal delivers Ctrl-C to the whole process group, so the CLI
    // receives SIGINT directly; just outlive it.
    const status = await runChild(
        ["bun", "run", "--bun", CLI_MAIN, ...process.argv.slice(2)],
        {
            env: { ...process.env, XDG_DATA_HOME: dataHome },
            forward: ["SIGTERM"],
            ignore: ["SIGINT"],
        },
    );
    process.exit(status);
}
