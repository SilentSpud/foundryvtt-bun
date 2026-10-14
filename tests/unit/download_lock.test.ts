import { describe, expect, test } from "bun:test";
import {
    appendFileSync,
    chmodSync,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    writeFileSync,
} from "node:fs";

import {
    DownloadLock,
    lockTunables,
    SlotState,
} from "../../src/download_lock.ts";
import { silentLogger } from "../../src/logging.ts";
import { isRoot, isWindows, tmpDir } from "../helpers/tmp.ts";

const FAST = { pollSeconds: 0.05, stallTicks: 4, stealLimit: 3 };

function paths(dir: string) {
    return [
        `${dir}/v.lock`,
        `${dir}/release.zip`,
        `${dir}/downloading-v.*.zip`,
    ] as const;
}

function lock(tunables = FAST) {
    return new DownloadLock(silentLogger, { HOSTNAME: "test-host" }, tunables);
}

test("slot state values are stable", () => {
    expect([
        SlotState.Acquired,
        SlotState.Cached,
        SlotState.Unarbitrated,
        SlotState.GaveUp,
    ]).toEqual([0, 1, 2, 3]);
});

describe("tunables", () => {
    test("defaults", () => {
        expect(lockTunables({}, silentLogger)).toEqual({
            pollSeconds: 5,
            stallTicks: 60,
            stealLimit: 3,
        });
    });

    test("garbage falls back to defaults; leading zeros are decimal", () => {
        expect(
            lockTunables(
                {
                    DOWNLOAD_LOCK_POLL_SECONDS: "soon",
                    DOWNLOAD_LOCK_STALL_TICKS: "08",
                    DOWNLOAD_LOCK_STEAL_LIMIT: "many",
                },
                silentLogger,
            ),
        ).toEqual({ pollSeconds: 5, stallTicks: 8, stealLimit: 3 });
    });

    test("a zero poll interval would busy-spin, so it falls back", () => {
        expect(
            lockTunables({ DOWNLOAD_LOCK_POLL_SECONDS: "0.0" }, silentLogger)
                .pollSeconds,
        ).toBe(5);
        expect(
            lockTunables({ DOWNLOAD_LOCK_POLL_SECONDS: ".25" }, silentLogger)
                .pollSeconds,
        ).toBe(0.25);
    });
});

describe("acquire and release", () => {
    test("an uncontended slot is acquired and the owner file written", async () => {
        const dir = tmpDir();
        expect(await lock().acquire(...paths(dir))).toBe(SlotState.Acquired);
        expect(readFileSync(`${dir}/v.lock/owner`, "utf8")).toStartWith(
            "test-host-",
        );
    });

    test("release removes a held lock and is safe to repeat", async () => {
        const dir = tmpDir();
        const l = lock();
        await l.acquire(...paths(dir));
        l.release();
        l.release();
        expect(existsSync(`${dir}/v.lock`)).toBe(false);
    });

    test("an existing release short-circuits without locking", async () => {
        const dir = tmpDir();
        writeFileSync(`${dir}/release.zip`, "zip");
        expect(await lock().acquire(...paths(dir))).toBe(SlotState.Cached);
        expect(existsSync(`${dir}/v.lock`)).toBe(false);
    });

    test("an uncreatable lock path degrades to unarbitrated", async () => {
        const dir = tmpDir();
        writeFileSync(`${dir}/v.lock`, "not a directory");
        expect(await lock().acquire(...paths(dir))).toBe(
            SlotState.Unarbitrated,
        );
    });

    test("a stolen-and-reacquired lock survives the zombie's release", async () => {
        const dir = tmpDir();
        const l = lock();
        await l.acquire(...paths(dir));
        renameSync(`${dir}/v.lock`, `${dir}/v.lock.stale.thief`);
        rmSync(`${dir}/v.lock.stale.thief`, { recursive: true });
        mkdirSync(`${dir}/v.lock`);
        writeFileSync(`${dir}/v.lock/owner`, "new-holder");
        l.release();
        expect(readFileSync(`${dir}/v.lock/owner`, "utf8")).toBe("new-holder");
    });

    test("an ownerless lock is never deleted on release", async () => {
        const dir = tmpDir();
        const l = lock();
        await l.acquire(...paths(dir));
        rmSync(`${dir}/v.lock/owner`);
        l.release();
        expect(existsSync(`${dir}/v.lock`)).toBe(true);
    });
});

describe("waiting", () => {
    test("a waiter returns Cached once the holder delivers", async () => {
        const dir = tmpDir();
        mkdirSync(`${dir}/v.lock`);
        const holder = (async () => {
            for (let i = 0; i < 6; i++) {
                appendFileSync(`${dir}/downloading-v.other.zip`, "chunk");
                await Bun.sleep(50);
            }
            writeFileSync(`${dir}/release.zip`, "zip");
            rmSync(`${dir}/v.lock`, { recursive: true });
        })();
        expect(await lock().acquire(...paths(dir))).toBe(SlotState.Cached);
        await holder;
    });

    test("a waiter acquires when the holder gives up", async () => {
        const dir = tmpDir();
        mkdirSync(`${dir}/v.lock`);
        setTimeout(() => rmSync(`${dir}/v.lock`, { recursive: true }), 100);
        expect(
            await lock({ ...FAST, stallTicks: 100 }).acquire(...paths(dir)),
        ).toBe(SlotState.Acquired);
    });

    test("a slow but progressing download is never stolen", async () => {
        const dir = tmpDir();
        mkdirSync(`${dir}/v.lock`);
        let stolen = false;
        const holder = (async () => {
            // Progress on every poll for well past the stall window.
            for (let i = 0; i < 12; i++) {
                appendFileSync(`${dir}/downloading-v.other.zip`, "chunk");
                await Bun.sleep(50);
            }
            stolen = !existsSync(`${dir}/v.lock`);
            writeFileSync(`${dir}/release.zip`, "zip");
            rmSync(`${dir}/v.lock`, { recursive: true, force: true });
        })();
        expect(await lock().acquire(...paths(dir))).toBe(SlotState.Cached);
        await holder;
        expect(stolen).toBe(false);
    });
});

describe("stale locks", () => {
    test("a stalled lock is stolen and acquired", async () => {
        const dir = tmpDir();
        mkdirSync(`${dir}/v.lock`);
        writeFileSync(`${dir}/v.lock/owner`, "dead-holder");
        expect(await lock().acquire(...paths(dir))).toBe(SlotState.Acquired);
        expect(readFileSync(`${dir}/v.lock/owner`, "utf8")).not.toBe(
            "dead-holder",
        );
        expect(
            readdirSync(dir).filter((name) => name.includes(".stale.")),
        ).toEqual([]);
    });

    test("an exhausted steal budget gives up and leaves the lock", async () => {
        const dir = tmpDir();
        mkdirSync(`${dir}/v.lock`);
        expect(
            await lock({ ...FAST, stealLimit: 0 }).acquire(...paths(dir)),
        ).toBe(SlotState.GaveUp);
        expect(existsSync(`${dir}/v.lock`)).toBe(true);
    });

    test.skipIf(isWindows || isRoot)(
        "failed steals consume the budget",
        async () => {
            const dir = tmpDir();
            const locked = `${dir}/locked`;
            mkdirSync(`${locked}/v.lock`, { recursive: true });
            chmodSync(locked, 0o555);
            try {
                expect(
                    await lock({ ...FAST, stealLimit: 2 }).acquire(
                        ...paths(locked),
                    ),
                ).toBe(SlotState.GaveUp);
            } finally {
                chmodSync(locked, 0o755);
            }
        },
    );
});
