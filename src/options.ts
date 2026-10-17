/** Generate Foundry's options.json from the container's environment. */

import envFlag, { flagValue } from "./env_flag.ts";
import { type Logger } from "./logging.ts";

const CSS_THEME = "dark";
const DATA_PATH = "/data";
const FOUNDRY_PORT = 30000;
const LANGUAGE = "en.core";
const MAXIMUM_PORT = 65535;
const MINIMUM_PORT = 1;
const UPDATE_CHANNEL = "stable";

type Env = Record<string, string | undefined>;

/**
 * A number from an environment variable limited to the given range, or
 * `unset` when the variable is empty.
 */
function clampEnv(
    value: string | undefined,
    min: number,
    max: number,
    unset: number | null = null,
): number | null {
    if (!value) {
        return unset;
    }
    return Math.min(Math.max(Number.parseInt(value), min), max);
}

/**
 * Truthy selects the AWS SDK's ambient credentials, falsy disables it, and
 * anything else is an awsConfig.json path.  Passing the word through made
 * Foundry look for a file named "true" (#309).
 */
function awsConfig(raw: string | undefined): boolean | string | null {
    if (raw === undefined || raw === "") {
        return null;
    }
    const flag = flagValue(raw);
    if (flag !== undefined) {
        return flag ? true : null;
    }
    return raw;
}

export function foundryOptions(
    env: Env,
    logger?: Logger,
): Record<string, unknown> {
    const flag = (name: string, unset: boolean | null = false) =>
        envFlag(name, unset, env, logger);
    return {
        awsConfig: awsConfig(env.FOUNDRY_AWS_CONFIG),
        compressSocket: flag("FOUNDRY_COMPRESS_WEBSOCKET"),
        compressStatic: flag("FOUNDRY_MINIFY_STATIC_FILES"),
        cssTheme: env.FOUNDRY_CSS_THEME || CSS_THEME,
        dataPath: DATA_PATH,
        deleteNEDB: flag("FOUNDRY_DELETE_NEDB"),
        demo: env.FOUNDRY_DEMO_CONFIG
            ? JSON.parse(env.FOUNDRY_DEMO_CONFIG)
            : undefined,
        fullscreen: false,
        hostname: env.FOUNDRY_HOSTNAME || null,
        hotReload: flag("FOUNDRY_HOT_RELOAD"),
        language: env.FOUNDRY_LANGUAGE || LANGUAGE,
        localHostname: env.FOUNDRY_LOCAL_HOSTNAME || null,
        passwordSalt: env.FOUNDRY_PASSWORD_SALT || null,
        port: FOUNDRY_PORT,
        protocol: env.FOUNDRY_PROTOCOL || null,
        proxyPort: clampEnv(
            env.FOUNDRY_PROXY_PORT,
            MINIMUM_PORT,
            MAXIMUM_PORT,
            null,
        ),
        proxySSL: flag("FOUNDRY_PROXY_SSL"),
        routePrefix: env.FOUNDRY_ROUTE_PREFIX || null,
        serviceConfig: env.FOUNDRY_SERVICE_CONFIG || null,
        sslCert: env.FOUNDRY_SSL_CERT || null,
        sslKey: env.FOUNDRY_SSL_KEY || null,
        // Deliberately tri-state: unset (null) lets Foundry prompt the user.
        telemetry: flag("FOUNDRY_TELEMETRY", null),
        tempDir: env.FOUNDRY_TEMP_DIR || null,
        unixSocket: env.FOUNDRY_UNIX_SOCKET || null,
        updateChannel: UPDATE_CHANNEL,
        upnp: flag("FOUNDRY_UPNP"),
        upnpLeaseDuration: env.FOUNDRY_UPNP_LEASE_DURATION || null,
        world: env.FOUNDRY_WORLD || null,
    };
}

/** The options.json text, formatted exactly as Foundry's own file. */
export function foundryOptionsJson(env: Env, logger?: Logger): string {
    return JSON.stringify(foundryOptions(env, logger), null, "  ");
}
