#!/usr/bin/env bun

/**
 * Repository hygiene checks that oxfmt and the type checker do not cover.
 * Reads staged content from the index, so the result is the same on every
 * platform regardless of checkout line endings.
 */

import { posix } from "node:path";

export interface IndexEntry {
    mode: string;
    oid: string;
    path: string;
}

const PERMALINK_RE =
    /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/blob\/(?![0-9a-f]{40}\/)[^/\s]+\/[^\s)#]+#L\d+/;
const COMPOSE_RE = /(^|\/)compose[^/]*\.ya?ml$/;

export function listIndex(): IndexEntry[] {
    const out = Bun.spawnSync([
        "git",
        "ls-files",
        "-s",
        "-z",
    ]).stdout.toString();
    return out
        .split("\0")
        .filter(Boolean)
        .map((line) => {
            const [meta, path] = line.split("\t") as [string, string];
            const [mode, oid] = meta.split(" ") as [string, string];
            return { mode, oid, path };
        });
}

/** Blob contents for every entry, read in one `git cat-file --batch` call. */
export function readBlobs(entries: IndexEntry[]): Map<string, Buffer> {
    const input = entries.map((entry) => entry.oid).join("\n") + "\n";
    const out = Buffer.from(
        Bun.spawnSync(["git", "cat-file", "--batch"], {
            stdin: Buffer.from(input),
        }).stdout,
    );
    const blobs = new Map<string, Buffer>();
    let pos = 0;
    while (pos < out.length) {
        const eol = out.indexOf(10, pos);
        const [oid, , size] = out.toString("utf8", pos, eol).split(" ");
        const start = eol + 1;
        const end = start + Number(size);
        blobs.set(oid!, out.subarray(start, end));
        pos = end + 1;
    }
    return blobs;
}

export function caseConflicts(paths: string[]): string[] {
    const seen = new Map<string, string>();
    const problems: string[] = [];
    for (const path of paths) {
        const parts = path.split("/");
        for (let i = 1; i <= parts.length; i++) {
            const name = parts.slice(0, i).join("/");
            const lower = name.toLowerCase();
            const other = seen.get(lower);
            if (other === undefined) {
                seen.set(lower, name);
            } else if (other !== name) {
                problems.push(`${name}: differs only in case from ${other}`);
                seen.set(lower, name);
            }
        }
    }
    return [...new Set(problems)];
}

/** Problems with one file, as `path[:line]: message` strings. */
export function checkFile(
    entry: IndexEntry,
    content: Buffer,
    indexed: Set<string>,
): string[] {
    const { mode, path } = entry;
    const problems: string[] = [];
    if (mode === "120000") {
        const target = posix.normalize(
            posix.join(posix.dirname(path), content.toString("utf8")),
        );
        const exists =
            indexed.has(target) ||
            [...indexed].some((p) => p.startsWith(`${target}/`));
        if (!exists) {
            problems.push(`${path}: broken symlink to ${target}`);
        }
        return problems;
    }

    const shebang = content.subarray(0, 2).toString() === "#!";
    if (mode === "100755" && !shebang) {
        problems.push(`${path}: executable but has no shebang`);
    } else if (mode !== "100755" && shebang) {
        // Fix with: git update-index --chmod=+x <path>
        problems.push(`${path}: has a shebang but is not executable`);
    }

    if (content.subarray(0, 8000).includes(0)) {
        return problems;
    }
    const text = content.toString("utf8");
    if (text.includes("\r")) {
        problems.push(`${path}: contains CR line endings`);
    }
    if (text.length > 0 && !text.endsWith("\n")) {
        problems.push(`${path}: missing final newline`);
    } else if (text.endsWith("\n\n")) {
        problems.push(`${path}: extra blank lines at end of file`);
    }
    text.split("\n").forEach((line, index) => {
        const where = `${path}:${index + 1}`;
        if (/^(<<<<<<< |>>>>>>> )/.test(line) || line === "=======") {
            problems.push(`${where}: merge conflict marker`);
        }
        if (/[ \t]+\r?$/.test(line)) {
            problems.push(`${where}: trailing whitespace`);
        }
        if (PERMALINK_RE.test(line)) {
            problems.push(`${where}: line link to a branch; pin a commit SHA`);
        }
    });
    return problems;
}

function checkCompose(paths: string[]): string[] {
    const files = paths.filter((path) => COMPOSE_RE.test(path));
    if (files.length === 0) {
        return [];
    }
    if (!Bun.which("docker")) {
        console.warn("docker not found: skipping compose file validation");
        return [];
    }
    const problems: string[] = [];
    for (const file of files) {
        const result = Bun.spawnSync([
            "docker",
            "compose",
            "-f",
            file,
            "config",
            "--quiet",
        ]);
        if (result.exitCode !== 0) {
            problems.push(`${file}: ${result.stderr.toString().trim()}`);
        }
    }
    return problems;
}

if (import.meta.main) {
    const entries = listIndex();
    const paths = entries.map((entry) => entry.path);
    const indexed = new Set(paths);
    const blobs = readBlobs(entries);
    const problems = [
        ...caseConflicts(paths),
        ...entries.flatMap((entry) =>
            checkFile(entry, blobs.get(entry.oid) ?? Buffer.alloc(0), indexed),
        ),
        ...checkCompose(paths),
    ];
    for (const problem of problems) {
        console.error(problem);
    }
    if (problems.length > 0) {
        console.error(`${problems.length} problem(s) found.`);
        process.exit(1);
    }
    console.log(`Checked ${entries.length} files.`);
}
