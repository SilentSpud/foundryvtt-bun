#!/usr/bin/env bun

/**
 * Bundle each container utility into a standalone, executable script in
 * dist/.  The bundles carry their dependencies, so the image needs no
 * node_modules at runtime.
 */

import { chmodSync, rmSync } from "node:fs";

export const ENTRYPOINTS = [
    "src/authenticate.ts",
    "src/check_health.ts",
    "src/entrypoint.ts",
    "src/fvtt.ts",
    "src/get_license.ts",
    "src/get_release_url.ts",
];
const OUT_DIR = "dist";

rmSync(OUT_DIR, { recursive: true, force: true });
const result = await Bun.build({
    entrypoints: ENTRYPOINTS,
    outdir: OUT_DIR,
    naming: "[name].js",
    target: "bun",
});
if (!result.success) {
    for (const message of result.logs) {
        console.error(message);
    }
    process.exit(1);
}
for (const output of result.outputs) {
    chmodSync(output.path, 0o755);
    console.log(`built ${output.path}`);
}
