#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const USAGE = `Configure a development environment for this repository.

Usage:
  bun run setup
  bun run setup (-h | --help)

Options:
  -h | --help  Show this message.
`;

const LINEAGE_CONFIG = ".github/lineage.yml";

function run(argv: string[], { check = true } = {}): number {
    const result = Bun.spawnSync(argv, {
        stdio: ["inherit", "inherit", "inherit"],
    });
    const code = result.exitCode ?? 1;
    if (check && code !== 0) {
        console.error(`Command failed (${code}): ${argv.join(" ")}`);
        process.exit(code);
    }
    return code;
}

const { values } = parseArgs({
    options: {
        help: { type: "boolean", short: "h" },
    },
});
if (values.help) {
    console.log(USAGE);
    process.exit(0);
}

run(["bun", "install", "--frozen-lockfile"]);

// Fails harmlessly when the lineage remotes already exist.
if (existsSync(LINEAGE_CONFIG)) {
    const lineage = Bun.YAML.parse(readFileSync(LINEAGE_CONFIG, "utf8")) as {
        version?: string;
        lineage?: Record<string, { "remote-url": string }>;
    };
    if (String(lineage.version) === "1") {
        for (const [name, { "remote-url": url }] of Object.entries(
            lineage.lineage ?? {},
        )) {
            run(["git", "remote", "add", name, url], { check: false });
            run(["git", "remote", "set-url", "--push", name, "no_push"], {
                check: false,
            });
        }
    } else {
        console.error(`Unsupported lineage version: ${lineage.version}`);
    }
} else {
    console.error("No lineage configuration found.");
}

console.log("Success!");
