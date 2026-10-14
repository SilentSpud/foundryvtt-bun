import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";

import {
    archiveKind,
    isLinuxRelease,
    releaseArchiveVersion,
    releaseVersion,
} from "../../src/release_verify.ts";
import { ZipReader } from "../../src/zip.ts";
import { tmpDir } from "../helpers/tmp.ts";
import { releaseJson, writeZip } from "../helpers/zip.ts";

describe("releaseArchiveVersion", () => {
    test("Node.js layout reads the root package.json", () => {
        const zip = writeZip(`${tmpDir()}/node.zip`, {
            "package.json": releaseJson(12, 331),
        });
        expect(releaseArchiveVersion(zip)).toBe("12.331");
    });

    test("Linux layout reads resources/app/package.json", () => {
        const zip = writeZip(`${tmpDir()}/linux.zip`, {
            "resources/app/package.json": releaseJson(13, 351),
        });
        expect(releaseArchiveVersion(zip)).toBe("13.351");
    });

    test("stored (uncompressed) members are read too", () => {
        const zip = writeZip(
            `${tmpDir()}/stored.zip`,
            { "package.json": releaseJson(14, 360) },
            false,
        );
        expect(releaseArchiveVersion(zip)).toBe("14.360");
    });

    test("missing package.json is unknown", () => {
        const zip = writeZip(`${tmpDir()}/bare.zip`, { "readme.txt": "hello" });
        expect(releaseArchiveVersion(zip)).toBeUndefined();
    });

    test("malformed JSON is unknown", () => {
        const zip = writeZip(`${tmpDir()}/bad.zip`, {
            "package.json": "{not json",
        });
        expect(releaseArchiveVersion(zip)).toBeUndefined();
    });

    test("a pre-v9 layout is unknown, never a pseudo-version", () => {
        const zip = writeZip(`${tmpDir()}/legacy.zip`, {
            "package.json": JSON.stringify({ version: "0.7.9" }),
        });
        expect(releaseArchiveVersion(zip)).toBeUndefined();
    });

    test("a non-zip is unknown", () => {
        const path = `${tmpDir()}/not.zip`;
        writeFileSync(path, "MZ this is not a zip");
        expect(releaseArchiveVersion(path)).toBeUndefined();
    });
});

test("releaseVersion rejects partial metadata", () => {
    expect(releaseVersion({ release: { generation: 13 } })).toBeUndefined();
    expect(
        releaseVersion({ release: { generation: null, build: null } }),
    ).toBeUndefined();
    expect(releaseVersion(null)).toBeUndefined();
    expect(releaseVersion({ release: { generation: 13, build: 351 } })).toBe(
        "13.351",
    );
});

test("isLinuxRelease detects the Electron layout", () => {
    const dir = tmpDir();
    expect(
        isLinuxRelease(
            writeZip(`${dir}/l.zip`, { "resources/app/main.mjs": "" }),
        ),
    ).toBe(true);
    expect(isLinuxRelease(writeZip(`${dir}/n.zip`, { "main.mjs": "" }))).toBe(
        false,
    );
});

test("ZipReader lists members", () => {
    const zip = writeZip(`${tmpDir()}/list.zip`, {
        "a/": "",
        "a/b.txt": "b",
        "c.txt": "c",
    });
    const reader = new ZipReader(zip);
    try {
        expect(reader.names()).toEqual(["a/", "a/b.txt", "c.txt"]);
        expect(reader.read("a/b.txt")?.toString()).toBe("b");
        expect(reader.read("missing")).toBeUndefined();
    } finally {
        reader.close();
    }
});

describe("archiveKind", () => {
    const write = (bytes: number[] | string) => {
        const path = `${tmpDir()}/file`;
        writeFileSync(
            path,
            typeof bytes === "string" ? bytes : Buffer.from(bytes),
        );
        return path;
    };

    test("zip", () => {
        expect(archiveKind(writeZip(`${tmpDir()}/k.zip`, { a: "a" }))).toBe(
            "zip",
        );
    });
    test("windows executable", () => {
        expect(archiveKind(write("MZ\x90\x00"))).toBe("windows-exe");
    });
    test("disk image", () => {
        expect(archiveKind(write([0x78, 0xda, 0x00, 0x00]))).toBe("mac-dmg");
    });
    test("anything else", () => {
        expect(archiveKind(write("<html>"))).toBe("unknown");
        expect(archiveKind(write(""))).toBe("unknown");
    });
});
