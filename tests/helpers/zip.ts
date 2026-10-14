/** Build small zip archives for test fixtures. */

import { writeFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/** Zip the given members (name → contents).  Names ending in "/" are directories. */
export function makeZip(
    members: Record<string, string | Uint8Array>,
    deflate = true,
): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const [name, contents] of Object.entries(members)) {
        const nameBytes = Buffer.from(name, "utf8");
        const data =
            typeof contents === "string"
                ? Buffer.from(contents, "utf8")
                : Buffer.from(contents);
        const isDir = name.endsWith("/");
        const method = deflate && !isDir ? 8 : 0;
        const stored = method === 8 ? deflateRawSync(data) : data;
        const crc = crc32(data);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6); // UTF-8 names
        local.writeUInt16LE(method, 8);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(stored.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBytes.length, 26);
        locals.push(local, nameBytes, stored);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE((3 << 8) | 20, 4); // made by Unix
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(method, 10);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(stored.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBytes.length, 28);
        central.writeUInt32LE(((isDir ? 0o40755 : 0o100644) << 16) >>> 0, 38);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, nameBytes);

        offset += local.length + nameBytes.length + stored.length;
    }
    const cd = Buffer.concat(centrals);
    const count = Object.keys(members).length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(count, 8);
    eocd.writeUInt16LE(count, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, eocd]);
}

export function writeZip(
    path: string,
    members: Record<string, string | Uint8Array>,
    deflate = true,
): string {
    writeFileSync(path, makeZip(members, deflate));
    return path;
}

export function releaseJson(generation: number, build: number): string {
    return JSON.stringify({ release: { generation, build } });
}
