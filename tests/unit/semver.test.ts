import { describe, expect, test } from "bun:test";

import { bump, incrementString, isValid } from "../../tools/semver.ts";

describe("semver", () => {
    test("validation", () => {
        expect(isValid("14.365.0")).toBe(true);
        expect(isValid("14.365")).toBe(false);
        expect(isValid("1.2.3-rc.1+build.5")).toBe(true);
    });

    test.each([
        ["1.2.3", "major", undefined, "2.0.0"],
        ["1.2.3-rc.1", "minor", undefined, "1.3.0"],
        ["1.2.3", "patch", undefined, "1.2.4"],
        ["1.2.3", "prerelease", undefined, "1.2.3-rc.1"],
        ["1.2.3-rc.1", "prerelease", undefined, "1.2.3-rc.2"],
        ["1.2.3", "prerelease", "beta", "1.2.3-beta.1"],
        ["1.2.3", "build", undefined, "1.2.3+build.1"],
        ["1.2.3+build.9", "build", undefined, "1.2.3+build.10"],
        ["1.2.3-rc.2+b.1", "finalize", undefined, "1.2.3"],
    ] as const)("%s %s(%s) → %s", (version, part, token, expected) => {
        expect(bump(version, part, token)).toBe(expected);
    });

    test("incrementString bumps the last number only", () => {
        expect(incrementString("rc.1.9")).toBe("rc.1.10");
        expect(incrementString("rc")).toBe("rc");
    });
});
