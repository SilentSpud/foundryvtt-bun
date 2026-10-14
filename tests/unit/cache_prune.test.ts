import { expect, test } from "bun:test";
import {
    existsSync,
    mkdirSync,
    readdirSync,
    utimesSync,
    writeFileSync,
} from "node:fs";

import { cachePrune } from "../../src/cache_prune.ts";
import { silentLogger } from "../../src/logging.ts";
import { tmpDir } from "../helpers/tmp.ts";

function make(dir: string, name: string, usedAgoSeconds: number) {
    const path = `${dir}/${name}`;
    writeFileSync(path, "zip");
    const stamp = Date.now() / 1000 - usedAgoSeconds;
    utimesSync(path, stamp, stamp);
}

const archives = (dir: string) =>
    readdirSync(dir)
        .filter((name) => /^foundryvtt-.*\.zip$/.test(name))
        .sort();

test("evicts least recently used, not lowest version (#1266)", () => {
    const dir = tmpDir();
    make(dir, "foundryvtt-12.343.zip", 60);
    make(dir, "foundryvtt-13.345.zip", 4000);
    make(dir, "foundryvtt-13.346.zip", 3000);
    make(dir, "foundryvtt-13.347.zip", 2000);
    expect(cachePrune(dir, 2, silentLogger)).toBe(2);
    expect(archives(dir)).toEqual([
        "foundryvtt-12.343.zip",
        "foundryvtt-13.347.zip",
    ]);
});

test("nothing is removed within the limit", () => {
    const dir = tmpDir();
    make(dir, "foundryvtt-13.345.zip", 100);
    make(dir, "foundryvtt-13.346.zip", 50);
    expect(cachePrune(dir, 2, silentLogger)).toBe(0);
    expect(archives(dir)).toHaveLength(2);
});

test("only release archives are considered", () => {
    const dir = tmpDir();
    make(dir, "foundryvtt-13.346.zip", 100);
    make(dir, "foundryvtt-13.347.zip", 50);
    writeFileSync(`${dir}/downloading-13.348.host-1.zip`, "partial");
    writeFileSync(`${dir}/backoff_state.json`, "{}");
    mkdirSync(`${dir}/foundryvtt-13.348.zip.lock`);
    cachePrune(dir, 1, silentLogger);
    expect(existsSync(`${dir}/foundryvtt-13.346.zip`)).toBe(false);
    expect(existsSync(`${dir}/foundryvtt-13.347.zip`)).toBe(true);
    expect(existsSync(`${dir}/downloading-13.348.host-1.zip`)).toBe(true);
    expect(existsSync(`${dir}/backoff_state.json`)).toBe(true);
    expect(existsSync(`${dir}/foundryvtt-13.348.zip.lock`)).toBe(true);
});

test("an empty or missing cache is a no-op", () => {
    const dir = tmpDir();
    expect(cachePrune(dir, 3, silentLogger)).toBe(0);
    expect(cachePrune(`${dir}/missing`, 3, silentLogger)).toBe(0);
});
