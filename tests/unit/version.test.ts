import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";

import { containerVersion, foundryVersion } from "../../tools/version.ts";
import { tmpDir } from "../helpers/tmp.ts";

function packageFile(content: unknown): string {
    const file = `${tmpDir()}/package.json`;
    writeFileSync(file, JSON.stringify(content));
    return file;
}

test("containerVersion reads package.json", () => {
    expect(containerVersion(packageFile({ version: "14.369.0" }))).toBe(
        "14.369.0",
    );
    expect(() => containerVersion(packageFile({}))).toThrow();
    expect(() =>
        containerVersion(packageFile({ version: "14.369" })),
    ).toThrow();
});

test("foundryVersion is generation.build", () => {
    expect(foundryVersion("14.369.0")).toBe("14.369");
    expect(foundryVersion("14.369.1-rc.1")).toBe("14.369");
    expect(() => foundryVersion("14")).toThrow();
});

test("the project version is valid", () => {
    expect(foundryVersion(containerVersion())).toMatch(/^\d+\.\d+$/);
});
