/**
 * Configure and launch the server with a clean environment: only
 * ENV_VAR_PASSLIST variables carry over, so container credentials never leak.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";

import { envIsFalse, envIsTrue } from "./env_flag.ts";
import { runChild } from "./lifecycle.ts";
import { type Logger } from "./logging.ts";
import { foundryOptionsJson } from "./options.ts";
import { hashAdminKey } from "./password.ts";
import { ExitError, isFile } from "./util.ts";

export const BUN_BIN = "/usr/local/bin/bun";
/** `--bun` keeps Bun as the runtime even where a script asks for node. */
export const SERVER_RUNTIME = [BUN_BIN, "run", "--bun"];

/**
 * Environment variables that are carried over to the server process.  The
 * proxy pattern covers HTTP_PROXY, https_proxy, NO_PROXY, and so on.
 */
export const ENV_VAR_PASSLIST: RegExp[] = [
    /^BUN_.+$/,
    /^HOME$/,
    /^NODE_.+$/,
    /^TZ$/,
    /.+_(PROXY|proxy)$/,
];

type Env = Record<string, string | undefined>;

export function isPassed(name: string): boolean {
    return ENV_VAR_PASSLIST.some((regex) => regex.test(name));
}

/** The clean environment the server is started with. */
export function serverEnv(env: Env): Record<string, string> {
    const carried: Record<string, string> = {};
    for (const [name, value] of Object.entries(env)) {
        if (value !== undefined && isPassed(name)) {
            carried[name] = value;
        }
    }
    return carried;
}

/** Write options.json and admin.txt unless CONTAINER_PRESERVE_CONFIG says not to. */
export function writeConfig(configDir: string, env: Env, logger: Logger): void {
    const configFile = `${configDir}/options.json`;
    const adminKeyFile = `${configDir}/admin.txt`;
    logger.debug(`Ensuring ${configDir} directory exists.`);
    mkdirSync(configDir, { recursive: true });

    const preserve = envIsTrue("CONTAINER_PRESERVE_CONFIG", env, logger);
    if (preserve && isFile(configFile)) {
        logger.warn(
            "CONTAINER_PRESERVE_CONFIG is set: Not updating options.json",
        );
    } else {
        logger.info("Generating options.json file.");
        writeFileSync(configFile, foundryOptionsJson(env, logger));
    }

    if (preserve && isFile(adminKeyFile)) {
        logger.warn("CONTAINER_PRESERVE_CONFIG is set: Not updating admin.txt");
    } else if (env.FOUNDRY_ADMIN_KEY) {
        logger.info("Setting 'Admin Access Key'.");
        writeFileSync(
            adminKeyFile,
            hashAdminKey(env.FOUNDRY_ADMIN_KEY, env.FOUNDRY_PASSWORD_SALT),
        );
    } else {
        logger.warn("No 'Admin Access Key' has been configured.");
        rmSync(adminKeyFile, { force: true });
    }
}

/** Server arguments: the container command plus environment-driven flags. */
export function serverArgs(args: string[], env: Env, logger: Logger): string[] {
    const result = [...args];
    if (envIsFalse("FOUNDRY_IP_DISCOVERY", env, logger)) {
        logger.info(
            "FOUNDRY_IP_DISCOVERY is set to false: Disabling IP discovery.",
        );
        result.push("--noipdiscovery");
    }
    if (env.FOUNDRY_LOG_SIZE) {
        logger.info(
            `FOUNDRY_LOG_SIZE is set: Setting maximum log size to ${env.FOUNDRY_LOG_SIZE}.`,
        );
        result.push(`--logsize=${env.FOUNDRY_LOG_SIZE}`);
    }
    if (env.FOUNDRY_MAX_LOGS) {
        logger.info(
            `FOUNDRY_MAX_LOGS is set: Setting maximum log count to ${env.FOUNDRY_MAX_LOGS}.`,
        );
        result.push(`--maxlogs=${env.FOUNDRY_MAX_LOGS}`);
    }
    if (envIsTrue("FOUNDRY_NO_BACKUPS", env, logger)) {
        logger.info(
            "FOUNDRY_NO_BACKUPS is set to true: Disabling automatic world backups.",
        );
        result.push("--nobackups");
    }
    if (env.FOUNDRY_SERVICE_KEY) {
        if (!env.FOUNDRY_SERVICE_CONFIG) {
            logger.error(
                "FOUNDRY_SERVICE_KEY is set but FOUNDRY_SERVICE_CONFIG is not.  Both are required.",
            );
            throw new ExitError(1);
        }
        logger.info(
            "FOUNDRY_SERVICE_KEY is set: Enabling service provider configuration.",
        );
        result.push(`--serviceKey=${env.FOUNDRY_SERVICE_KEY}`);
    }
    return result;
}

/** Apply CONTAINER_UMASK (octal) to this process, inherited by the server. */
export function applyUmask(env: Env, logger: Logger): void {
    const umask = env.CONTAINER_UMASK;
    if (!umask) {
        return;
    }
    logger.info(`CONTAINER_UMASK is set: Setting umask to ${umask}`);
    if (/^[0-7]{1,4}$/.test(umask)) {
        process.umask(Number.parseInt(umask, 8));
    } else {
        logger.warn("Failed to set umask.");
    }
}

/**
 * Configure and run the server, resolving to its exit status.  SIGTERM is
 * forwarded, and the promise settles only once the server has exited.
 */
export async function launch(
    args: string[],
    configDir: string,
    env: Env,
    logger: Logger,
): Promise<number> {
    writeConfig(configDir, env, logger);
    applyUmask(env, logger);
    const argv = [...SERVER_RUNTIME, ...serverArgs(args, env, logger)];
    logger.info("Starting Foundry Virtual Tabletop.");
    return runChild(argv, {
        env: serverEnv(env),
        forward: ["SIGTERM"],
        logger,
    });
}
