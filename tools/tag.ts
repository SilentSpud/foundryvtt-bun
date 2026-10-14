#!/usr/bin/env bun

/** Tag the current commit with the project version and push the tags. */

import { readFileSync } from "node:fs";

const version = readFileSync("src/version.txt", "utf8").trim();

for (const args of [
    ["tag", `v${version}`],
    ["push", "--tags"],
]) {
    const result = Bun.spawnSync(["git", ...args], {
        stdio: ["inherit", "inherit", "inherit"],
    });
    if (result.exitCode !== 0) {
        process.exit(result.exitCode ?? 1);
    }
}
