/**
 * Boolean environment variable parsing shared by the container utilities.
 *
 * Accepted forms, case-insensitive:
 *   truthy: 1, true, yes, on
 *   falsy:  0, false, no, off
 * Empty and unset fall back to the caller's default.  Any other value logs a
 * warning naming the variable and also falls back to the default, so a typo
 * never silently flips behavior.
 */

import { type Logger } from "./logging.ts";

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off"]);

type Env = Record<string, string | undefined>;

/**
 * Interpret a raw string as a boolean flag word, or undefined when it is not
 * one — for options that accept a flag *or* another kind of value (such as a
 * file path) and must not warn on the latter.
 */
export function flagValue(raw: string): boolean | undefined {
    const value = raw.toLowerCase();
    if (TRUTHY.has(value)) {
        return true;
    }
    if (FALSY.has(value)) {
        return false;
    }
    return undefined;
}

function warnUnrecognized(
    name: string,
    raw: string,
    logger: Logger | undefined,
): void {
    const message =
        `${name} has unrecognized value '${raw}'.  Expected true/false ` +
        `(also accepted: 1/0, yes/no, on/off).  Treating it as unset.`;
    if (logger) {
        logger.warn(message);
    } else {
        console.error(`WARN: ${message}`);
    }
}

export default function envFlag(
    name: string,
    unset: boolean | null = false,
    env: Env = process.env,
    logger?: Logger,
): boolean | null {
    const raw = env[name];
    if (raw === undefined || raw === "") {
        return unset;
    }
    const flag = flagValue(raw);
    if (flag !== undefined) {
        return flag;
    }
    warnUnrecognized(name, raw, logger);
    return unset;
}

/** True only when the named variable is set to a truthy word. */
export function envIsTrue(name: string, env: Env, logger?: Logger): boolean {
    return envFlag(name, false, env, logger) === true;
}

/**
 * True only when the named variable is explicitly set to a falsy word — for
 * default-true toggles, where unset must NOT read as false.
 */
export function envIsFalse(name: string, env: Env, logger?: Logger): boolean {
    return envFlag(name, null, env, logger) === false;
}
