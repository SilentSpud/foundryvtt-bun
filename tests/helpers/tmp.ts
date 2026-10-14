/** Per-test temporary directories. */

import { afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const created: string[] = [];

/** A fresh temporary directory, removed after the current test. */
export function tmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "fvtt-test-")).replaceAll("\\", "/");
    created.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of created.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

export const isWindows = process.platform === "win32";
export const isRoot = process.getuid?.() === 0;
