#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs";

import { bump, isValid, parse, type BumpPart } from "./semver.ts";

// Stores the canonical version for the project.
const VERSION_FILE = "src/version.txt";
// Files that should be updated with the new version.
const VERSION_FILES = [VERSION_FILE];

const USAGE = `Update the version of the project.

Usage:
  bump_version.ts [--push] [--label LABEL] (major | minor | patch | prerelease | build | finalize | show)
  bump_version.ts set <version>
  bump_version.ts --list-files
  bump_version.ts (-h | --help)

Options:
  -h | --help    Show this message.
  --push         Perform a \`git push\` after updating the version.
  --label LABEL  Specify the label to use when updating the build or prerelease version.
  --list-files   List the files that will be updated when the version is bumped.

Commands:
  set <version>  Set an explicit version (e.g. 14.365.0). Use when Foundry skips build numbers.
`;

const COMMANDS_WITH_LABEL = ["build", "prerelease"];
const COMMANDS_WITH_PRERELEASE = ["major", "minor", "patch"];

function invalid(message: string): never {
    console.log(message);
    console.log(USAGE);
    process.exit(1);
}

function git(...args: string[]): void {
    const result = Bun.spawnSync(["git", ...args], {
        stdio: ["inherit", "inherit", "inherit"],
    });
    if (result.exitCode !== 0) {
        process.exit(result.exitCode ?? 1);
    }
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shortVersion(version: string): string {
    const v = parse(version);
    return `${v.major}.${v.minor}`;
}

const args = process.argv.slice(2);
if (args.length === 0) {
    console.log(USAGE);
    process.exit(1);
}

const oldVersion = readFileSync(VERSION_FILE, "utf8").trim();
let newVersion = oldVersion;
let bumpPart = "";
let label = "";
let withPush = false;
let withPrerelease = false;

while (args.length > 0) {
    const arg = args.shift()!;
    switch (arg) {
        case "--push":
            if (withPush) invalid("Push has already been set.");
            withPush = true;
            break;
        case "--label":
            if (label) invalid("Label has already been set.");
            label = args.shift() ?? invalid("--label requires a value.");
            break;
        case "build":
        case "finalize":
        case "major":
        case "minor":
        case "patch":
            if (bumpPart)
                invalid("Only one version part should be bumped at a time.");
            bumpPart = arg;
            break;
        case "set": {
            if (bumpPart)
                invalid("Only one version part should be bumped at a time.");
            const version = args.shift();
            if (!version)
                invalid("'set' requires a version argument (e.g. 14.365.0)");
            if (!isValid(version))
                invalid(
                    "'set' requires a valid semver version (e.g. 14.365.0)",
                );
            newVersion = version;
            bumpPart = "set";
            break;
        }
        case "prerelease":
            withPrerelease = true;
            break;
        case "show":
            console.log(oldVersion);
            process.exit(0);
        case "-h":
        case "--help":
            console.log(USAGE);
            process.exit(0);
        case "--list-files":
            console.log(VERSION_FILES.join("\n"));
            process.exit(0);
        default:
            invalid(`Invalid option: ${arg}`);
    }
}

if (label && !withPrerelease && !COMMANDS_WITH_LABEL.includes(bumpPart)) {
    invalid(
        `Setting the label is only allowed for the following commands: ${COMMANDS_WITH_LABEL.join(" ")}`,
    );
}
if (
    withPrerelease &&
    bumpPart &&
    !COMMANDS_WITH_PRERELEASE.includes(bumpPart)
) {
    invalid(
        `Changing the prerelease is only allowed in conjunction with the following commands: ${COMMANDS_WITH_PRERELEASE.join(" ")}`,
    );
}

let commitPrefix = "Bump";
if (bumpPart === "set") {
    console.log(`Setting version from ${oldVersion} to ${newVersion}`);
} else if (bumpPart) {
    if (bumpPart === "finalize") {
        commitPrefix = "Finalize";
    }
    newVersion = bump(oldVersion, bumpPart as BumpPart, label || undefined);
    console.log(`Changing version from ${oldVersion} to ${newVersion}`);
}
if (withPrerelease) {
    const next = bump(newVersion, "prerelease", label || undefined);
    console.log(`Changing version from ${newVersion} to ${next}`);
    newVersion = next;
}

// Replace the full form first (e.g. 14.360.0 → 14.361.0), then the short
// form used by some files (e.g. 14.360 → 14.361).
const fullRe = new RegExp(escapeRegExp(oldVersion), "g");
const shortRe = new RegExp(escapeRegExp(shortVersion(oldVersion)), "g");
const newShort = shortVersion(newVersion);
for (const file of VERSION_FILES) {
    let text: string;
    try {
        text = readFileSync(file, "utf8");
    } catch {
        console.log(`Missing expected file: ${file}`);
        process.exit(1);
    }
    writeFileSync(
        file,
        text.replace(fullRe, newVersion).replace(shortRe, newShort),
    );
}

git("add", ...VERSION_FILES);
git(
    "commit",
    "--message",
    `${commitPrefix} version from ${oldVersion} to ${newVersion}`,
);
if (withPush) {
    git("push");
}
