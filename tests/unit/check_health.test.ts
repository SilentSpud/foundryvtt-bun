import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { checkHealth, probeTarget } from "../../src/check_health.ts";
import { isWindows, tmpDir } from "../helpers/tmp.ts";

function target(
    options?: Record<string, unknown>,
    env: Record<string, string> = {},
) {
    const dataDir = tmpDir();
    mkdirSync(`${dataDir}/Config`);
    if (options) {
        writeFileSync(
            `${dataDir}/Config/options.json`,
            JSON.stringify(options),
        );
    }
    return probeTarget({ DATA_DIR: dataDir, ...env });
}

describe("probeTarget", () => {
    test("defaults to http on port 30000", () => {
        expect(target()).toEqual({ url: "http://localhost:30000/api/status" });
    });

    test("SSL from the environment selects https", () => {
        expect(
            target(undefined, {
                FOUNDRY_SSL_CERT: "c.pem",
                FOUNDRY_SSL_KEY: "k.pem",
            }).url,
        ).toBe("https://localhost:30000/api/status");
    });

    test("SSL configured only in options.json selects https (#1398)", () => {
        expect(target({ sslCert: "c.pem", sslKey: "k.pem" }).url).toBe(
            "https://localhost:30000/api/status",
        );
    });

    test("route prefix from options.json", () => {
        expect(target({ routePrefix: "game" }).url).toBe(
            "http://localhost:30000/game/api/status",
        );
    });

    test("route prefix from the environment", () => {
        expect(target(undefined, { FOUNDRY_ROUTE_PREFIX: "game" }).url).toBe(
            "http://localhost:30000/game/api/status",
        );
    });

    test("custom port from options.json", () => {
        expect(target({ port: 12345 }).url).toBe(
            "http://localhost:12345/api/status",
        );
    });

    test("unix socket probes through the socket", () => {
        expect(target({ unixSocket: "/data/foundry.sock" })).toEqual({
            url: "http://localhost/api/status",
            unixSocket: "/data/foundry.sock",
        });
    });

    test("explicit nulls fall through to env and defaults", () => {
        expect(
            target({ sslCert: null, sslKey: null, routePrefix: null }).url,
        ).toBe("http://localhost:30000/api/status");
    });
});

describe("checkHealth", () => {
    let server: ReturnType<typeof Bun.serve> | undefined;
    afterEach(() => {
        server?.stop(true);
        server = undefined;
    });

    test("healthy on 200, keeping the session cookie between probes", async () => {
        const seen: (string | null)[] = [];
        server = Bun.serve({
            port: 0,
            fetch(request) {
                seen.push(request.headers.get("cookie"));
                return new Response("{}", {
                    headers: { "Set-Cookie": "session=abc; Path=/" },
                });
            },
        });
        const cookieFile = `${tmpDir()}/cookies.json`;
        const probe = { url: `http://localhost:${server.port}/api/status` };
        expect(await checkHealth(probe, cookieFile)).toBe(true);
        expect(await checkHealth(probe, cookieFile)).toBe(true);
        expect(seen).toEqual([null, "session=abc"]);
        expect(JSON.parse(readFileSync(cookieFile, "utf8"))).toEqual({
            session: "abc",
        });
    });

    test("unhealthy on an error status", async () => {
        server = Bun.serve({
            port: 0,
            fetch: () => new Response("no", { status: 503 }),
        });
        expect(
            await checkHealth(
                { url: `http://localhost:${server.port}/api/status` },
                `${tmpDir()}/c`,
            ),
        ).toBe(false);
    });

    test("unhealthy when nothing listens", async () => {
        server = Bun.serve({ port: 0, fetch: () => new Response("") });
        const port = server.port;
        server.stop(true);
        server = undefined;
        expect(
            await checkHealth(
                { url: `http://localhost:${port}/api/status` },
                `${tmpDir()}/c`,
            ),
        ).toBe(false);
    });

    test.skipIf(isWindows)("probes a unix socket", async () => {
        const socket = `${tmpDir()}/foundry.sock`;
        let path = "";
        server = Bun.serve({
            unix: socket,
            fetch(request) {
                path = new URL(request.url).pathname;
                return new Response("{}");
            },
        });
        expect(
            await checkHealth(
                { url: "http://localhost/game/api/status", unixSocket: socket },
                `${tmpDir()}/c`,
            ),
        ).toBe(true);
        expect(path).toBe("/game/api/status");
    });
});
