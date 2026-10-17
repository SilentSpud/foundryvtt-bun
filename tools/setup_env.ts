#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const USAGE = `Configure a development environment for this repository.

Usage:
  bun run setup [--install-hooks]
  bun run setup (-h | --help)

Options:
  -h | --help           Show this message.
  -i | --install-hooks  Install hook environments for all hooks in the
                        pre-commit config file.
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
        "install-hooks": { type: "boolean", short: "i" },
    },
});
if (values.help) {
    console.log(USAGE);
    process.exit(0);
}

run(["bun", "install", "--frozen-lockfile"]);

if (Bun.which("pre-commit")) {
    run([
        "pre-commit",
        "install",
        ...(values["install-hooks"] ? ["--install-hooks"] : []),
    ]);
} else {
    console.log(`
  pre-commit is not installed, so the git hooks were not set up.  Install it
  (for example with \`pipx install pre-commit\` or \`brew install pre-commit\`)
  and re-run this script.
`);
}

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
