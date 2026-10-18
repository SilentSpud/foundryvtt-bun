#!/usr/bin/env bun

/**
 * Build images with `docker buildx bake`, supplying the versions derived from
 * the package.json version.  Arguments are passed through to bake, so targets
 * and flags work as usual:
 *
 *   bun run image                      # the "image" target (default group)
 *   bun run image multiarch --push     # every published platform
 */

import { containerVersion, foundryVersion } from "./version.ts";

const container = containerVersion();
const env = {
    ...process.env,
    CONTAINER_VERSION: container,
    FOUNDRY_VERSION: foundryVersion(container),
};
const result = Bun.spawnSync(
    ["docker", "buildx", "bake", ...process.argv.slice(2)],
    {
        env,
        stdio: ["inherit", "inherit", "inherit"],
    },
);
process.exit(result.exitCode ?? 1);
