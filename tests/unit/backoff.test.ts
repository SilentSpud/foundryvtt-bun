import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import {
    backoffOnFailure,
    backoffReset,
    computeDelay,
    STATE_FILENAME,
    type BackoffOptions,
} from "../../src/backoff.ts";
import { silentLogger } from "../../src/logging.ts";
import { tmpDir } from "../helpers/tmp.ts";

const EXPECTED_DELAYS: [number, number][] = [
    [1, 0],
    [2, 10],
    [3, 20],
    [4, 40],
    [5, 80],
    [6, 160],
    [7, 320],
    [8, 640],
    [9, 960],
    [10, 960],
];

/** Options that never really sleep, recording requested sleeps instead. */
function options(
    env: Record<string, string | undefined>,
    sleeps: number[] = [],
): BackoffOptions {
    return {
        env: { BACKOFF_DECAY_SECONDS: "3600", ...env },
        logger: silentLogger,
        signal: new AbortController().signal,
        sleep: async (ms) => {
            sleeps.push(ms);
        },
    };
}

function readState(dir: string) {
    return JSON.parse(readFileSync(`${dir}/${STATE_FILENAME}`, "utf8"));
}

function writeState(dir: string, failures: number, epoch?: number) {
    writeFileSync(
        `${dir}/${STATE_FILENAME}`,
        JSON.stringify({
            consecutive_failures: failures,
            last_failure_timestamp: "2024-01-01T00:00:00Z",
            ...(epoch === undefined ? {} : { last_failure_epoch: epoch }),
        }),
    );
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe("computeDelay", () => {
    test.each(EXPECTED_DELAYS)("failure %d waits %d seconds", (n, expected) => {
        expect(computeDelay(n)).toBe(expected);
    });

    test("is monotonically non-decreasing and capped at 960", () => {
        for (let n = 1; n <= 60; n++) {
            expect(computeDelay(n + 1)).toBeGreaterThanOrEqual(computeDelay(n));
            expect(computeDelay(n)).toBeLessThanOrEqual(960);
            const expected = n <= 1 ? 0 : Math.min(10 * 2 ** (n - 2), 960);
            expect(computeDelay(n)).toBe(expected);
        }
    });
});

describe("state file", () => {
    test("is created with the expected fields and the exit code is kept", async () => {
        const dir = tmpDir();
        const before = nowSeconds();
        expect(
            await backoffOnFailure(1, options({ CONTAINER_CACHE: dir })),
        ).toBe(1);
        const state = readState(dir);
        expect(state.consecutive_failures).toBe(1);
        expect(state.last_failure_timestamp).toMatch(
            /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/,
        );
        expect(state.last_failure_epoch).toBeGreaterThanOrEqual(before);
        expect(state.last_failure_epoch).toBeLessThanOrEqual(nowSeconds());
    });

    test("increments on repeated failures and sleeps the computed delay", async () => {
        const dir = tmpDir();
        const sleeps: number[] = [];
        for (let i = 0; i < 3; i++) {
            await backoffOnFailure(
                1,
                options({ CONTAINER_CACHE: dir }, sleeps),
            );
        }
        expect(readState(dir).consecutive_failures).toBe(3);
        // The first failure exits immediately.
        expect(sleeps).toEqual([10_000, 20_000]);
    });

    test("round-trips any seeded failure count", async () => {
        for (let count = 1; count <= 20; count++) {
            const dir = tmpDir();
            if (count > 1) {
                writeState(dir, count - 1);
            }
            await backoffOnFailure(1, options({ CONTAINER_CACHE: dir }));
            expect(readState(dir).consecutive_failures).toBe(count);
        }
    });

    test("a corrupt state file resets the count", async () => {
        const dir = tmpDir();
        writeFileSync(
            `${dir}/${STATE_FILENAME}`,
            "this is not valid json {{{{",
        );
        expect(
            await backoffOnFailure(1, options({ CONTAINER_CACHE: dir })),
        ).toBe(1);
        expect(readState(dir).consecutive_failures).toBe(1);
    });

    test("auth and generic failures produce the same state", async () => {
        const auth = tmpDir();
        const generic = tmpDir();
        expect(
            await backoffOnFailure(1, options({ CONTAINER_CACHE: auth })),
        ).toBe(1);
        expect(
            await backoffOnFailure(2, options({ CONTAINER_CACHE: generic })),
        ).toBe(2);
        expect(readState(auth).consecutive_failures).toBe(
            readState(generic).consecutive_failures,
        );
    });

    test("a failed state write falls back to sleeping until SIGTERM", async () => {
        const dir = tmpDir();
        // A directory in the way makes the temp-file write fail.
        mkdirSync(`${dir}/${STATE_FILENAME}.tmp`);
        const controller = new AbortController();
        const result = backoffOnFailure(1, {
            ...options({ CONTAINER_CACHE: dir }),
            signal: controller.signal,
        });
        await Bun.sleep(50);
        controller.abort();
        expect(await result).toBe(0);
    });
});

describe("decay", () => {
    test("a stale failure resets the count", async () => {
        const dir = tmpDir();
        writeState(dir, 5, nowSeconds() - 7200);
        await backoffOnFailure(1, options({ CONTAINER_CACHE: dir }));
        expect(readState(dir).consecutive_failures).toBe(1);
    });

    test("a recent failure keeps escalating", async () => {
        const dir = tmpDir();
        writeState(dir, 5, nowSeconds() - 10);
        await backoffOnFailure(1, options({ CONTAINER_CACHE: dir }));
        expect(readState(dir).consecutive_failures).toBe(6);
    });

    test("a state file without an epoch keeps escalating", async () => {
        const dir = tmpDir();
        writeState(dir, 5);
        await backoffOnFailure(1, options({ CONTAINER_CACHE: dir }));
        expect(readState(dir).consecutive_failures).toBe(6);
    });

    test("BACKOFF_DECAY_SECONDS controls the window", async () => {
        const dir = tmpDir();
        writeState(dir, 5, nowSeconds() - 30);
        await backoffOnFailure(
            1,
            options({ CONTAINER_CACHE: dir, BACKOFF_DECAY_SECONDS: "10" }),
        );
        expect(readState(dir).consecutive_failures).toBe(1);
    });

    test("a garbage override falls back to the default window", async () => {
        const dir = tmpDir();
        writeState(dir, 5, nowSeconds() - 10);
        await backoffOnFailure(
            1,
            options({ CONTAINER_CACHE: dir, BACKOFF_DECAY_SECONDS: "soon" }),
        );
        expect(readState(dir).consecutive_failures).toBe(6);
    });

    test("a leading-zero override is decimal", async () => {
        const dir = tmpDir();
        writeState(dir, 5, nowSeconds() - 30);
        await backoffOnFailure(
            1,
            options({ CONTAINER_CACHE: dir, BACKOFF_DECAY_SECONDS: "08" }),
        );
        expect(readState(dir).consecutive_failures).toBe(1);
    });
});

describe("kubernetes", () => {
    test("skips state and sleep for any exit code", async () => {
        for (const code of [1, 2, 77, 255]) {
            const dir = tmpDir();
            const sleeps: number[] = [];
            const result = await backoffOnFailure(
                code,
                options(
                    {
                        CONTAINER_CACHE: dir,
                        KUBERNETES_SERVICE_HOST: "10.0.0.1",
                    },
                    sleeps,
                ),
            );
            expect(result).toBe(code);
            expect(existsSync(`${dir}/${STATE_FILENAME}`)).toBe(false);
            expect(sleeps).toEqual([]);
        }
    });
});

describe("no cache", () => {
    test("sleeps until SIGTERM, then exits 0", async () => {
        const controller = new AbortController();
        let settled = false;
        const result = backoffOnFailure(1, {
            ...options({ CONTAINER_CACHE: "" }),
            signal: controller.signal,
        }).then((code) => {
            settled = true;
            return code;
        });
        await Bun.sleep(200);
        expect(settled).toBe(false);
        controller.abort();
        expect(await result).toBe(0);
    });
});

describe("backoffReset", () => {
    test("deletes the state file", () => {
        for (let count = 1; count <= 5; count++) {
            const dir = tmpDir();
            writeState(dir, count);
            backoffReset({ CONTAINER_CACHE: dir }, silentLogger);
            expect(existsSync(`${dir}/${STATE_FILENAME}`)).toBe(false);
        }
    });

    test("is a no-op without a state file or cache", () => {
        backoffReset({ CONTAINER_CACHE: tmpDir() }, silentLogger);
        backoffReset({}, silentLogger);
    });
});
