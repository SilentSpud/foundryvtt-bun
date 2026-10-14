import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs";

import { download } from "../../src/download.ts";
import { silentLogger } from "../../src/logging.ts";
import { tmpDir } from "../helpers/tmp.ts";

const LAST_MODIFIED = new Date("2024-06-01T00:00:00Z");
let server: ReturnType<typeof Bun.serve>;
let base: string;
let userAgent = "";

beforeAll(() => {
    server = Bun.serve({
        port: 0,
        fetch(request) {
            userAgent = request.headers.get("user-agent") ?? "";
            const path = new URL(request.url).pathname;
            if (path === "/missing") {
                return new Response("not found", { status: 404 });
            }
            const since = request.headers.get("if-modified-since");
            if (since && new Date(since) >= LAST_MODIFIED) {
                return new Response(null, { status: 304 });
            }
            return new Response("x".repeat(100_000));
        },
    });
    base = `http://localhost:${server.port}`;
});
afterAll(() => server.stop(true));

const opts = {
    userAgent: "test-agent",
    logger: silentLogger,
    progressInterval: 0,
};

test("downloads the body", async () => {
    const out = `${tmpDir()}/out.zip`;
    expect(await download(`${base}/release`, out, opts)).toBe("downloaded");
    expect(readFileSync(out, "utf8")).toHaveLength(100_000);
    expect(userAgent).toBe("test-agent");
});

test("a newer local copy is not downloaded again", async () => {
    const dir = tmpDir();
    const cached = `${dir}/cached.zip`;
    writeFileSync(cached, "cached");
    utimesSync(cached, new Date("2025-01-01"), new Date("2025-01-01"));
    const out = `${dir}/out.zip`;
    expect(
        await download(`${base}/release`, out, { ...opts, newerThan: cached }),
    ).toBe("not-modified");
    expect(existsSync(out)).toBe(false);
});

test("an older local copy is replaced", async () => {
    const dir = tmpDir();
    const cached = `${dir}/cached.zip`;
    writeFileSync(cached, "cached");
    utimesSync(cached, new Date("2020-01-01"), new Date("2020-01-01"));
    expect(
        await download(`${base}/release`, `${dir}/out.zip`, {
            ...opts,
            newerThan: cached,
        }),
    ).toBe("downloaded");
});

test("an HTTP error is thrown and nothing is written", async () => {
    const out = `${tmpDir()}/out.zip`;
    await expect(download(`${base}/missing`, out, opts)).rejects.toThrow(
        /HTTP 404/,
    );
    expect(existsSync(out)).toBe(false);
});
