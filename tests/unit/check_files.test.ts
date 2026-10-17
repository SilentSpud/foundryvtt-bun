import { describe, expect, test } from "bun:test";

import {
    caseConflicts,
    checkFile,
    type IndexEntry,
} from "../../tools/check_files.ts";

function check(content: string, mode = "100644", indexed: string[] = []) {
    const entry: IndexEntry = { mode, oid: "0", path: "dir/file.txt" };
    return checkFile(entry, Buffer.from(content), new Set(indexed));
}

describe("checkFile", () => {
    test("clean file", () => {
        expect(check("one\ntwo\n")).toEqual([]);
    });

    test("whitespace and endings", () => {
        expect(check("one \n")).toEqual([
            "dir/file.txt:1: trailing whitespace",
        ]);
        expect(check("one")).toEqual(["dir/file.txt: missing final newline"]);
        expect(check("one\n\n")).toEqual([
            "dir/file.txt: extra blank lines at end of file",
        ]);
        expect(check("one\r\n")).toEqual([
            "dir/file.txt: contains CR line endings",
        ]);
    });

    test("merge conflict markers", () => {
        expect(check("<<<<<<< HEAD\na\n=======\nb\n>>>>>>> main\n")).toEqual([
            "dir/file.txt:1: merge conflict marker",
            "dir/file.txt:3: merge conflict marker",
            "dir/file.txt:5: merge conflict marker",
        ]);
    });

    test("shebang and executable bit must agree", () => {
        expect(check("#!/bin/sh\n", "100755")).toEqual([]);
        expect(check("echo\n", "100755")).toEqual([
            "dir/file.txt: executable but has no shebang",
        ]);
        expect(check("#!/bin/sh\n")).toEqual([
            "dir/file.txt: has a shebang but is not executable",
        ]);
    });

    test("branch permalinks", () => {
        // Built from parts so this file does not trip the check itself.
        const blob = ["https://github.com/o/r", "blob", ""].join("/");
        expect(check(`${blob}${"a".repeat(40)}/x.ts#L10\n`)).toEqual([]);
        expect(check(`${blob}main/x.ts#L10\n`)).toEqual([
            "dir/file.txt:1: line link to a branch; pin a commit SHA",
        ]);
    });

    test("symlinks", () => {
        expect(check("other.txt", "120000", ["dir/other.txt"])).toEqual([]);
        expect(check("../src", "120000", ["src/a.ts"])).toEqual([]);
        expect(check("missing", "120000")).toEqual([
            "dir/file.txt: broken symlink to dir/missing",
        ]);
    });

    test("binary content skips text checks", () => {
        expect(check("a \0 b")).toEqual([]);
    });
});

test("caseConflicts", () => {
    expect(caseConflicts(["a/B.txt", "a/c.txt"])).toEqual([]);
    expect(caseConflicts(["Docs/a.md", "docs/b.md"])).toEqual([
        "docs: differs only in case from Docs",
    ]);
});
