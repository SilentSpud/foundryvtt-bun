#!/usr/bin/env bun

/**
 * Manage the repository rulesets in .github/rulesets as code.
 *
 *   rulesets.ts apply   create or update each ruleset (resolved by name)
 *   rulesets.ts export  overwrite each file from its live ruleset
 *
 * Requires the GitHub CLI (`gh`), authenticated as a repository admin.  See
 * .github/rulesets/README.md.
 */

import { readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export const REPO = "felddy/foundryvtt-docker";
export const RULESET_DIR = ".github/rulesets";
/** Fields kept on export; the rest are read-only and rejected on write. */
export const WRITABLE_FIELDS = [
    "name",
    "target",
    "enforcement",
    "conditions",
    "bypass_actors",
    "rules",
] as const;

interface Ruleset {
    id: number;
    name: string;
}

function gh(args: string[], input?: string): string {
    const result = Bun.spawnSync(["gh", ...args], {
        stdin:
            input === undefined ? "inherit" : new TextEncoder().encode(input),
        stdout: "pipe",
        stderr: "inherit",
    });
    if (result.exitCode !== 0) {
        throw new Error(
            `gh ${args.join(" ")} failed with exit code ${result.exitCode}`,
        );
    }
    return result.stdout.toString();
}

/** Recursively sort object keys, matching the committed (pre-commit) format. */
export function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortKeys);
    }
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([key, inner]) => [key, sortKeys(inner)]),
        );
    }
    return value;
}

/**
 * Keep only the writable fields.  Every field must be present: the API omits
 * bypass_actors for callers who are not repository admins, and writing the
 * file without them would silently drop the bypass list on the next apply.
 */
export function writableRuleset(
    live: Record<string, unknown>,
): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const field of WRITABLE_FIELDS) {
        if (!(field in live)) {
            throw new Error(
                `the live ruleset has no "${field}" (is gh authenticated as a repository admin?)`,
            );
        }
        result[field] = live[field];
    }
    return sortKeys(result) as Record<string, unknown>;
}

function rulesetFiles(): string[] {
    const files = readdirSync(RULESET_DIR)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => `${RULESET_DIR}/${name}`);
    if (files.length === 0) {
        throw new Error(`no ruleset files in ${RULESET_DIR}`);
    }
    return files;
}

function liveRulesets(): Ruleset[] {
    return JSON.parse(
        gh(["api", "--paginate", "--slurp", `repos/${REPO}/rulesets`]),
    ).flat();
}

function nameOf(file: string): string {
    const name = (JSON.parse(readFileSync(file, "utf8")) as { name?: unknown })
        .name;
    if (typeof name !== "string" || !name) {
        throw new Error(`${file} has no name`);
    }
    return name;
}

function apply(): void {
    const live = liveRulesets();
    for (const file of rulesetFiles()) {
        const name = nameOf(file);
        const body = readFileSync(file, "utf8");
        const existing = live.find((ruleset) => ruleset.name === name);
        if (existing) {
            console.log(
                `Updating ruleset '${name}' (id ${existing.id}) in ${REPO}`,
            );
            gh(
                [
                    "api",
                    "--method",
                    "PUT",
                    `repos/${REPO}/rulesets/${existing.id}`,
                    "--input",
                    "-",
                ],
                body,
            );
        } else {
            console.log(`Creating ruleset '${name}' in ${REPO}`);
            gh(
                [
                    "api",
                    "--method",
                    "POST",
                    `repos/${REPO}/rulesets`,
                    "--input",
                    "-",
                ],
                body,
            );
        }
    }
    console.log("Done.");
}

function exportRulesets(): void {
    const live = liveRulesets();
    for (const file of rulesetFiles()) {
        const name = nameOf(file);
        const existing = live.find((ruleset) => ruleset.name === name);
        if (!existing) {
            throw new Error(`no ruleset named '${name}' in ${REPO}`);
        }
        const full = JSON.parse(
            gh(["api", `repos/${REPO}/rulesets/${existing.id}`]),
        );
        writeFileSync(
            `${file}.tmp`,
            JSON.stringify(writableRuleset(full), null, 2) + "\n",
        );
        renameSync(`${file}.tmp`, file);
        console.log(`Wrote ${file} from ruleset '${name}' (id ${existing.id})`);
    }
}

if (import.meta.main) {
    const [command] = process.argv.slice(2);
    try {
        if (!Bun.which("gh")) {
            throw new Error("gh (GitHub CLI) is required");
        }
        if (command === "apply") {
            apply();
        } else if (command === "export") {
            exportRulesets();
        } else {
            console.error("usage: rulesets.ts (apply | export)");
            process.exit(2);
        }
    } catch (err) {
        console.error(`ERROR: ${(err as Error).message}`);
        process.exit(1);
    }
}
