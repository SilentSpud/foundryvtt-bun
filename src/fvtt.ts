#!/usr/bin/env bun

/**
 * Wrapper for the Foundry CLI.  The CLI writes ${XDG_DATA_HOME}/.fvttrc.yml
 * on every run, and an arbitrary container UID may have no writable home, so
 * it defaults to the /data volume.  Only the CLI sees the variable.
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
 * Create the config if missing.  Hard-linking a temp file into place means
 * concurrent first runs never see a partial file.  World-writable so a later
 * run under another UID can still `fvtt configure set`.
 */
export function seedConfig(dataHome: string): string {
    const configFile = `${dataHome}/.fvttrc.yml`;
    if (existsSync(configFile)) {
        return configFile;
    }
    // New directories must stay writable by any later UID; existing ones
    // (e.g. a user-supplied XDG_DATA_HOME) are left alone.
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
