import { expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";

import { SEED_CONFIG, seedConfig } from "../../src/fvtt.ts";
import {
    patchLanguage,
    CONFIGURATION_WARNING,
    UPDATE_HINT,
} from "../../src/patch_lang.ts";
import { isWindows, tmpDir } from "../helpers/tmp.ts";

test("seeds the CLI configuration once", () => {
    const home = `${tmpDir()}/.local/share`;
    const file = seedConfig(home);
    expect(readFileSync(file, "utf8")).toBe(SEED_CONFIG);
    if (!isWindows) {
        expect(statSync(file).mode & 0o777).toBe(0o666);
        expect(statSync(home).mode & 0o777).toBe(0o777);
    }
    writeFileSync(file, "dataPath: /elsewhere\n");
    seedConfig(home);
    expect(readFileSync(file, "utf8")).toBe("dataPath: /elsewhere\n");
    // No temporary files are left behind.
    expect(readdirSync(home)).toEqual([".fvttrc.yml"]);
});

test("patches the language file", () => {
    const file = `${tmpDir()}/en.json`;
    writeFileSync(
        file,
        JSON.stringify({ KEEP: "me", "SETUP.UpdateHint": "old" }),
    );
    patchLanguage(file, false);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
        KEEP: "me",
        "SETUP.UpdateHint": UPDATE_HINT,
        "SETUP.ConfigurationWarning": CONFIGURATION_WARNING,
        "SETUP.UpdateNoUpdateMode": UPDATE_HINT,
    });
});

test("CONTAINER_PRESERVE_CONFIG leaves the configuration warning alone", () => {
    const file = `${tmpDir()}/en.json`;
    writeFileSync(
        file,
        JSON.stringify({ "SETUP.ConfigurationWarning": "original" }),
    );
    patchLanguage(file, true);
    expect(
        JSON.parse(readFileSync(file, "utf8"))["SETUP.ConfigurationWarning"],
    ).toBe("original");
});
