#!/usr/bin/env bun

/**
 * The project version and the Foundry version derived from it.
 *
 *   version.ts                  print both versions
 *   version.ts --github-output  print key=value lines for $GITHUB_OUTPUT
 */

import { readFileSync } from "node:fs";

export const PACKAGE_FILE = "package.json";

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.+-]+)?$/;

/** The container version (semver x.y.z) from package.json. */
export function containerVersion(file: string = PACKAGE_FILE): string {
    const { version } = JSON.parse(readFileSync(file, "utf8")) as {
        version?: unknown;
    };
    if (typeof version !== "string" || !SEMVER_RE.test(version)) {
        throw new Error(`${file} has no valid semver "version"`);
    }
    return version;
}

/** The Foundry version ("generation.build") for a container version. */
export function foundryVersion(container: string): string {
    const match = SEMVER_RE.exec(container);
    if (!match) {
        throw new Error(`Invalid semver: ${container}`);
    }
    return `${match[1]}.${match[2]}`;
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
