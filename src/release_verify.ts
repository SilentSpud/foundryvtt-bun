/**
 * Inspect release archives.
 *
 * Works for both release layouts: Node.js zips carry package.json at the
 * archive root; Linux zips carry it under resources/app/.
 */

import { closeSync, openSync, readSync } from "node:fs";

import { ZipReader } from "./zip.ts";

const PACKAGE_MEMBERS = ["package.json", "resources/app/package.json"];

/**
 * Pseudo-version ("generation.build") from a parsed package.json, or
 * undefined when the metadata is missing or partial.  Foundry no longer
 * maintains the "version" field, so it is built from the release object.
 */
export function releaseVersion(pkg: unknown): string | undefined {
    const release = (
        pkg as { release?: { generation?: unknown; build?: unknown } } | null
    )?.release;
    if (!release) {
        return undefined;
    }
    const version = `${release.generation}.${release.build}`;
    // Guard against partial metadata rendering as "undefined.null" etc.
    return /^[0-9]+\.[0-9]+$/.test(version) ? version : undefined;
}

/**
 * The Foundry Virtual Tabletop version contained in a release zip, or
 * undefined when it cannot be determined (not a zip, no package.json, a
 * pre-v9 layout, or malformed metadata).  Callers should treat undefined as
 * "unknown", never as a mismatch.
 */
export function releaseArchiveVersion(archive: string): string | undefined {
    let zip: ZipReader;
    try {
        zip = new ZipReader(archive);
    } catch {
        return undefined;
    }
    try {
        for (const member of PACKAGE_MEMBERS) {
            try {
                const data = zip.read(member);
                if (!data || data.length === 0) {
                    continue;
                }
                const version = releaseVersion(
                    JSON.parse(data.toString("utf8")),
                );
                if (version) {
                    return version;
                }
            } catch {
                // try the next layout
            }
        }
        return undefined;
    } finally {
        zip.close();
    }
}

/** Whether the archive is a Linux (Electron) release rather than Node.js. */
export function isLinuxRelease(archive: string): boolean {
    const zip = new ZipReader(archive);
    try {
        return zip
            .names()
            .some((name) => name.startsWith("resources/app/main.mjs"));
    } finally {
        zip.close();
    }
}

export type ArchiveKind = "zip" | "windows-exe" | "mac-dmg" | "unknown";

/** Identify a release file from its magic bytes. */
export function archiveKind(path: string): ArchiveKind {
    const header = Buffer.alloc(4);
    const fd = openSync(path, "r");
    let read: number;
    try {
        read = readSync(fd, header, 0, 4, 0);
    } finally {
        closeSync(fd);
    }
    if (read >= 4 && header[0] === 0x50 && header[1] === 0x4b) {
        // Local file header, or the end record of an empty archive.
        const kind = header.readUInt16LE(2);
        if (kind === 0x0403 || kind === 0x0605) {
            return "zip";
        }
    }
    if (read >= 2 && header[0] === 0x4d && header[1] === 0x5a) {
        return "windows-exe";
    }
    // Disk images are zlib streams (CMF 0x78 with a valid FCHECK).
    if (
        read >= 2 &&
        header[0] === 0x78 &&
        ((0x78 << 8) | header[1]!) % 31 === 0
    ) {
        return "mac-dmg";
    }
    return "unknown";
}
