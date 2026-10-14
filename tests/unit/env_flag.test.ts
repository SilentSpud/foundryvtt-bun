import { describe, expect, test } from "bun:test";

import envFlag, {
    envIsFalse,
    envIsTrue,
    flagValue,
} from "../../src/env_flag.ts";
import { type Logger, silentLogger } from "../../src/logging.ts";

const TRUTHY = ["1", "true", "TRUE", "True", "yes", "YES", "on", "On"];
const FALSY = ["0", "false", "FALSE", "False", "no", "No", "off", "OFF"];

function recorder(): Logger & { warnings: string[] } {
    const warnings: string[] = [];
    return {
        ...silentLogger,
        warn: (message) => warnings.push(message),
        warnings,
    };
}

const env = (value: string | undefined) =>
    value === undefined ? {} : { MY_FLAG: value };

describe("envIsTrue", () => {
    test.each(TRUTHY)("%s is true", (value) => {
        const log = recorder();
        expect(envIsTrue("MY_FLAG", env(value), log)).toBe(true);
        expect(log.warnings).toEqual([]);
    });

    test.each(FALSY)("%s is false without warning", (value) => {
        const log = recorder();
        expect(envIsTrue("MY_FLAG", env(value), log)).toBe(false);
        expect(log.warnings).toEqual([]);
    });

    test.each([undefined, ""])(
        "unset/empty (%p) is false without warning",
        (value) => {
            const log = recorder();
            expect(envIsTrue("MY_FLAG", env(value), log)).toBe(false);
            expect(log.warnings).toEqual([]);
        },
    );

    test("garbage warns, naming the variable, and reads as unset", () => {
        const log = recorder();
        expect(envIsTrue("MY_FLAG", env("banana"), log)).toBe(false);
        expect(log.warnings).toHaveLength(1);
        expect(log.warnings[0]).toContain("MY_FLAG");
    });
});

describe("envIsFalse", () => {
    test.each(FALSY)("%s is explicitly false", (value) => {
        expect(envIsFalse("MY_FLAG", env(value), silentLogger)).toBe(true);
    });

    test.each([...TRUTHY, undefined, ""])(
        "%p is not explicitly false",
        (value) => {
            expect(envIsFalse("MY_FLAG", env(value), silentLogger)).toBe(false);
        },
    );

    test("garbage warns and keeps the default", () => {
        const log = recorder();
        expect(envIsFalse("MY_FLAG", env("banana"), log)).toBe(false);
        expect(log.warnings).toHaveLength(1);
    });
});

test("envFlag returns the caller's default for unset values", () => {
    expect(envFlag("MY_FLAG", null, {})).toBeNull();
    expect(envFlag("MY_FLAG", true, { MY_FLAG: "" })).toBe(true);
});

test("flagValue distinguishes flags from other values", () => {
    expect(flagValue("Yes")).toBe(true);
    expect(flagValue("off")).toBe(false);
    expect(flagValue("/data/awsConfig.json")).toBeUndefined();
});
