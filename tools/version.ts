#!/usr/bin/env bun

/**
 * The project version and the Foundry version derived from it.
 *
 *   version.ts                  print both versions
 *   version.ts --github-output  print key=value lines for $GITHUB_OUTPUT
 */

import { readFileSync } from "node:fs";

import { parse } from "./semver.ts";

export const VERSION_FILE = "src/version.txt";

/** The container version (semver x.y.z) from src/version.txt. */
export function containerVersion(file: string = VERSION_FILE): string {
    const version = readFileSync(file, "utf8").trim();
    if (!version) {
        throw new Error(`${file} is missing or empty`);
    }
    parse(version); // validate
    return version;
}

/** The Foundry version ("generation.build") for a container version. */
export function foundryVersion(container: string): string {
    const v = parse(container);
    return `${v.major}.${v.minor}`;
}

if (import.meta.main) {
    const container = containerVersion();
    const foundry = foundryVersion(container);
    const [flag] = process.argv.slice(2);
    if (flag === "--github-output") {
        console.log(`container_version=${container}`);
        console.log(`foundry_version=${foundry}`);
    } else if (flag === undefined) {
        console.log(`Container : ${container}`);
        console.log(`FoundryVTT: ${foundry}`);
    } else {
        console.error("usage: version.ts [--github-output]");
        process.exit(2);
    }
}
