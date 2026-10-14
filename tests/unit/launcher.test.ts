import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import {
    isPassed,
    serverArgs,
    serverEnv,
    writeConfig,
} from "../../src/launcher.ts";
import { silentLogger } from "../../src/logging.ts";
import { hashAdminKey } from "../../src/password.ts";
import { ExitError } from "../../src/util.ts";
import { tmpDir } from "../helpers/tmp.ts";

describe("environment passlist", () => {
    test.each([
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
        "no_proxy",
        "CUSTOM_PROXY",
        "custom_proxy",
        "HOME",
        "TZ",
        "NODE_OPTIONS",
    ])("%s is carried over", (name) => {
        expect(isPassed(name)).toBe(true);
    });

    test.each([
        "FOUNDRY_PASSWORD",
        "FOUNDRY_ADMIN_KEY",
        "PROXY",
        "NODE_",
        "TZDATA",
        "PATH",
    ])("%s is dropped", (name) => {
        expect(isPassed(name)).toBe(false);
    });

    test("values with spaces survive intact", () => {
        expect(
            serverEnv({
                NODE_OPTIONS: "--a --b",
                FOUNDRY_PASSWORD: "secret",
                TZ: "UTC",
                HOME: "/home/node",
            }),
        ).toEqual({ NODE_OPTIONS: "--a --b", TZ: "UTC", HOME: "/home/node" });
    });
});

describe("serverArgs", () => {
    const base = ["resources/app/main.mjs", "--port=30000"];

    test("passes the command through by default", () => {
        expect(serverArgs(base, {}, silentLogger)).toEqual(base);
    });

    test("adds flags from the environment", () => {
        expect(
            serverArgs(
                base,
                {
                    FOUNDRY_IP_DISCOVERY: "false",
                    FOUNDRY_LOG_SIZE: "10m",
                    FOUNDRY_MAX_LOGS: "7",
                    FOUNDRY_NO_BACKUPS: "yes",
                    FOUNDRY_SERVICE_KEY: "svc",
                    FOUNDRY_SERVICE_CONFIG: "/data/svc.json",
                },
                silentLogger,
            ),
        ).toEqual([
            ...base,
            "--noipdiscovery",
            "--logsize=10m",
            "--maxlogs=7",
            "--nobackups",
            "--serviceKey=svc",
        ]);
    });

    test("IP discovery stays on unless explicitly false", () => {
        expect(
            serverArgs(base, { FOUNDRY_IP_DISCOVERY: "true" }, silentLogger),
        ).toEqual(base);
    });

    test("a service key without a service config is fatal", () => {
        expect(() =>
            serverArgs(base, { FOUNDRY_SERVICE_KEY: "svc" }, silentLogger),
        ).toThrow(ExitError);
    });
});

describe("writeConfig", () => {
    test("writes options.json and the hashed admin key", () => {
        const dir = `${tmpDir()}/Config`;
        writeConfig(
            dir,
            { FOUNDRY_ADMIN_KEY: "atropos", FOUNDRY_WORLD: "w" },
            silentLogger,
        );
        expect(
            JSON.parse(readFileSync(`${dir}/options.json`, "utf8")).world,
        ).toBe("w");
        expect(readFileSync(`${dir}/admin.txt`, "utf8")).toBe(
            hashAdminKey("atropos"),
        );
    });

    test("removes admin.txt when no key is configured", () => {
        const dir = tmpDir();
        writeFileSync(`${dir}/admin.txt`, "old");
        writeConfig(dir, {}, silentLogger);
        expect(existsSync(`${dir}/admin.txt`)).toBe(false);
    });

    test("CONTAINER_PRESERVE_CONFIG keeps existing files", () => {
        const dir = tmpDir();
        writeFileSync(`${dir}/options.json`, "keep");
        writeFileSync(`${dir}/admin.txt`, "keep");
        writeConfig(
            dir,
            { CONTAINER_PRESERVE_CONFIG: "true", FOUNDRY_ADMIN_KEY: "new" },
            silentLogger,
        );
        expect(readFileSync(`${dir}/options.json`, "utf8")).toBe("keep");
        expect(readFileSync(`${dir}/admin.txt`, "utf8")).toBe("keep");
    });
});
