/**
 * Semantic version parsing and bumping, following the semantics of the
 * Python `semver` package this project used previously.
 */

// The regular expression recommended by https://semver.org
const SEMVER_RE =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export interface Version {
    major: number;
    minor: number;
    patch: number;
    prerelease?: string;
    build?: string;
}

export function parse(version: string): Version {
    const match = SEMVER_RE.exec(version);
    if (!match) {
        throw new Error(`${version} is not valid SemVer string`);
    }
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4],
        build: match[5],
    };
}

export function isValid(version: string): boolean {
    return SEMVER_RE.test(version);
}

export function format(version: Version): string {
    let text = `${version.major}.${version.minor}.${version.patch}`;
    if (version.prerelease) {
        text += `-${version.prerelease}`;
    }
    if (version.build) {
        text += `+${version.build}`;
    }
    return text;
}

/** Increment the last number in a string ("rc.1" → "rc.2"). */
export function incrementString(value: string): string {
    const match = /(\d+)(?!.*\d)/.exec(value);
    if (!match) {
        return value;
    }
    const next = String(Number(match[1]) + 1);
    const start = match.index;
    const end = start + match[1]!.length;
    return (
        value.slice(0, Math.max(end - next.length, start)) +
        next +
        value.slice(end)
    );
}

export type BumpPart =
    | "major"
    | "minor"
    | "patch"
    | "prerelease"
    | "build"
    | "finalize";

export function bump(version: string, part: BumpPart, token?: string): string {
    const v = parse(version);
    switch (part) {
        case "major":
            return format({ major: v.major + 1, minor: 0, patch: 0 });
        case "minor":
            return format({ major: v.major, minor: v.minor + 1, patch: 0 });
        case "patch":
            return format({
                major: v.major,
                minor: v.minor,
                patch: v.patch + 1,
            });
        case "finalize":
            return format({ major: v.major, minor: v.minor, patch: v.patch });
        case "prerelease": {
            const prerelease = v.prerelease ?? `${token ?? "rc"}.0`;
            return format({
                ...v,
                prerelease: incrementString(prerelease),
                build: undefined,
            });
        }
        case "build": {
            const build = v.build ?? `${token ?? "build"}.0`;
            return format({ ...v, build: incrementString(build) });
        }
    }
}
