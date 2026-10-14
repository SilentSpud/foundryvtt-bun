import { expect, test } from "bun:test";
import { pbkdf2Sync } from "node:crypto";

import { foundryOptions, foundryOptionsJson } from "../../src/options.ts";
import { silentLogger } from "../../src/logging.ts";
import { hashAdminKey } from "../../src/password.ts";

const options = (env: Record<string, string>) =>
    foundryOptions(env, silentLogger);

test("defaults", () => {
    expect(options({})).toEqual({
        awsConfig: null,
        compressSocket: false,
        compressStatic: false,
        cssTheme: "dark",
        dataPath: "/data",
        deleteNEDB: false,
        demo: undefined,
        fullscreen: false,
        hostname: null,
        hotReload: false,
        language: "en.core",
        localHostname: null,
        passwordSalt: null,
        port: 30000,
        protocol: null,
        proxyPort: null,
        proxySSL: false,
        routePrefix: null,
        serviceConfig: null,
        sslCert: null,
        sslKey: null,
        telemetry: null,
        tempDir: null,
        unixSocket: null,
        updateChannel: "stable",
        upnp: false,
        upnpLeaseDuration: null,
        world: null,
    });
});

test("JSON output omits undefined demo and uses two-space indent", () => {
    const text = foundryOptionsJson({}, silentLogger);
    expect(text).not.toContain("demo");
    expect(text).toStartWith('{\n  "awsConfig": null,');
});

test("awsConfig accepts flags or a path (#309)", () => {
    expect(options({ FOUNDRY_AWS_CONFIG: "TRUE" }).awsConfig).toBe(true);
    expect(options({ FOUNDRY_AWS_CONFIG: "off" }).awsConfig).toBeNull();
    expect(options({ FOUNDRY_AWS_CONFIG: "/data/aws.json" }).awsConfig).toBe(
        "/data/aws.json",
    );
});

test("proxy port is clamped to the valid range", () => {
    expect(options({ FOUNDRY_PROXY_PORT: "443" }).proxyPort).toBe(443);
    expect(options({ FOUNDRY_PROXY_PORT: "0" }).proxyPort).toBe(1);
    expect(options({ FOUNDRY_PROXY_PORT: "99999" }).proxyPort).toBe(65535);
});

test("telemetry is tri-state", () => {
    expect(options({ FOUNDRY_TELEMETRY: "true" }).telemetry).toBe(true);
    expect(options({ FOUNDRY_TELEMETRY: "false" }).telemetry).toBe(false);
    expect(options({ FOUNDRY_TELEMETRY: "" }).telemetry).toBeNull();
});

test("demo config is parsed JSON", () => {
    expect(options({ FOUNDRY_DEMO_CONFIG: '{"worldName":"w"}' }).demo).toEqual({
        worldName: "w",
    });
});

test("admin key hashing matches Foundry's pbkdf2 scheme", () => {
    const expected = pbkdf2Sync(
        "atropos",
        "17c4f39053ac5a50d5797c665ad1f4e6",
        1000,
        64,
        "sha512",
    );
    expect(hashAdminKey(" atropos\n")).toBe(expected.toString("hex"));
    expect(hashAdminKey("atropos", "salty")).toBe(
        pbkdf2Sync("atropos", "salty", 1000, 64, "sha512").toString("hex"),
    );
});
