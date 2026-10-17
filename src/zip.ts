/**
 * Read-only access to a zip archive's central directory: list member names
 * and read small members (such as package.json) without extracting the
 * archive.  Supports ZIP64 archives and the stored and deflate methods.
 */

import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
// EOCD is 22 bytes plus a comment of at most 65535 bytes.
const EOCD_SEARCH = 22 + 0xffff;
// Only small metadata members (package.json) are ever read.
const MAX_READ_SIZE = 16 * 1024 * 1024;

export interface ZipEntry {
    name: string;
    method: number;
    compressedSize: number;
    size: number;
    localHeaderOffset: number;
}

export class ZipError extends Error {
    override name = "ZipError";
}

function readAt(fd: number, position: number, length: number): Buffer {
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, position);
    if (read !== length) {
        throw new ZipError("Unexpected end of file");
    }
    return buffer;
}

function bigToNumber(value: bigint): number {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ZipError("Zip offset too large");
    }
    return Number(value);
}

export class ZipReader implements Disposable {
    private readonly fd: number;
    readonly entries: ZipEntry[];

    constructor(path: string) {
        this.fd = openSync(path, "r");
        try {
            this.entries = this.readCentralDirectory();
        } catch (err) {
            closeSync(this.fd);
            throw err;
        }
    }

    close(): void {
        closeSync(this.fd);
    }

    [Symbol.dispose](): void {
        this.close();
    }

    private readCentralDirectory(): ZipEntry[] {
        const fileSize = fstatSync(this.fd).size;
        const tailLength = Math.min(fileSize, EOCD_SEARCH);
        if (tailLength < 22) {
            throw new ZipError("Not a zip archive");
        }
        const tailStart = fileSize - tailLength;
        const tail = readAt(this.fd, tailStart, tailLength);
        let eocd = -1;
        for (let i = tail.length - 22; i >= 0; i--) {
            if (tail.readUInt32LE(i) === EOCD_SIG) {
                eocd = i;
                break;
            }
        }
        if (eocd < 0) {
            throw new ZipError("Not a zip archive");
        }
        let count = tail.readUInt16LE(eocd + 10);
        let cdSize = tail.readUInt32LE(eocd + 12);
        let cdOffset = tail.readUInt32LE(eocd + 16);

        if (
            count === 0xffff ||
            cdSize === 0xffffffff ||
            cdOffset === 0xffffffff
        ) {
            const locatorPos = tailStart + eocd - 20;
            if (locatorPos < 0) {
                throw new ZipError("Missing ZIP64 locator");
            }
            const locator = readAt(this.fd, locatorPos, 20);
            if (locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIG) {
                throw new ZipError("Missing ZIP64 locator");
            }
            const zip64Pos = bigToNumber(locator.readBigUInt64LE(8));
            const zip64 = readAt(this.fd, zip64Pos, 56);
            if (zip64.readUInt32LE(0) !== ZIP64_EOCD_SIG) {
                throw new ZipError("Bad ZIP64 end of central directory");
            }
            count = bigToNumber(zip64.readBigUInt64LE(32));
            cdSize = bigToNumber(zip64.readBigUInt64LE(40));
            cdOffset = bigToNumber(zip64.readBigUInt64LE(48));
        }

        // Checked before allocating, so a forged size cannot claim gigabytes.
        if (cdOffset + cdSize > fileSize) {
            throw new ZipError("Central directory extends past end of file");
        }
        const cd = readAt(this.fd, cdOffset, cdSize);
        const entries: ZipEntry[] = [];
        let pos = 0;
        for (let i = 0; i < count; i++) {
            if (pos + 46 > cd.length || cd.readUInt32LE(pos) !== CENTRAL_SIG) {
                throw new ZipError("Corrupt central directory");
            }
            const method = cd.readUInt16LE(pos + 10);
            let compressedSize = cd.readUInt32LE(pos + 20);
            let size = cd.readUInt32LE(pos + 24);
            const nameLength = cd.readUInt16LE(pos + 28);
            const extraLength = cd.readUInt16LE(pos + 30);
            const commentLength = cd.readUInt16LE(pos + 32);
            let localHeaderOffset = cd.readUInt32LE(pos + 42);
            const name = cd.toString("utf8", pos + 46, pos + 46 + nameLength);

            // ZIP64 extended information: present fields appear in order.
            let extra = pos + 46 + nameLength;
            const extraEnd = extra + extraLength;
            while (extra + 4 <= extraEnd) {
                const id = cd.readUInt16LE(extra);
                const length = cd.readUInt16LE(extra + 2);
                if (id === 0x0001) {
                    let field = extra + 4;
                    if (size === 0xffffffff) {
                        size = bigToNumber(cd.readBigUInt64LE(field));
                        field += 8;
                    }
                    if (compressedSize === 0xffffffff) {
                        compressedSize = bigToNumber(cd.readBigUInt64LE(field));
                        field += 8;
                    }
                    if (localHeaderOffset === 0xffffffff) {
                        localHeaderOffset = bigToNumber(
                            cd.readBigUInt64LE(field),
                        );
                    }
                }
                extra += 4 + length;
            }

            entries.push({
                name,
                method,
                compressedSize,
                size,
                localHeaderOffset,
            });
            pos = extraEnd + commentLength;
        }
        return entries;
    }

    names(): string[] {
        return this.entries.map((entry) => entry.name);
    }

    /**
     * Read and decompress a member, or undefined when it is absent.  Members
     * over `maxSize` bytes are refused, which also stops a deflate bomb.
     */
    read(name: string, maxSize = MAX_READ_SIZE): Buffer | undefined {
        const entry = this.entries.find((candidate) => candidate.name === name);
        if (!entry) {
            return undefined;
        }
        if (entry.size > maxSize || entry.compressedSize > maxSize) {
            throw new ZipError(`${name} is larger than ${maxSize} bytes`);
        }
        const header = readAt(this.fd, entry.localHeaderOffset, 30);
        if (header.readUInt32LE(0) !== LOCAL_SIG) {
            throw new ZipError(`Corrupt local header for ${name}`);
        }
        const dataStart =
            entry.localHeaderOffset +
            30 +
            header.readUInt16LE(26) +
            header.readUInt16LE(28);
        const data = readAt(this.fd, dataStart, entry.compressedSize);
        switch (entry.method) {
            case 0:
                return data;
            case 8:
                // The declared size is untrusted; cap what inflation may produce.
                return inflateRawSync(data, { maxOutputLength: maxSize });
            default:
                throw new ZipError(
                    `Unsupported compression method ${entry.method}`,
                );
        }
    }
}
