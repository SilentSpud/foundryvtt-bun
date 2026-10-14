/**
 * Exponential backoff between failed container starts.
 *
 * A container that fails during startup is restarted by its runtime, which
 * can turn a persistent problem (bad credentials, a full disk) into a rapid
 * restart loop that hammers foundryvtt.com.  The failure count is persisted
 * in ${CONTAINER_CACHE}/backoff_state.json so the delay grows across
 * restarts:
 *
 *   delay(n) = 0 for the first failure, then min(10 * 2^(n-2), 960) seconds
 *
 * Failures further apart than BACKOFF_DECAY_SECONDS (default 3600) are not a
 * restart loop: the count restarts at 1 instead of continuing to grow, so a
 * container that crashes rarely is not punished with the maximum delay.
 */

import {
    mkdirSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
} from "node:fs";

import { type Logger } from "./logging.ts";
import { isFile, parseNonNegativeInt, sleep, sleepForever } from "./util.ts";

export const DEFAULT_CACHE = "/data/container_cache";
export const DEFAULT_DECAY_SECONDS = 3600;
export const MAX_DELAY_SECONDS = 960;
export const STATE_FILENAME = "backoff_state.json";

type Env = Record<string, string | undefined>;

export interface BackoffState {
    consecutive_failures: number;
    last_failure_timestamp: string;
    last_failure_epoch: number;
}

export interface BackoffOptions {
    env: Env;
    logger: Logger;
    /** Aborted by the SIGTERM handler to cut a sleep short. */
    signal: AbortSignal;
    /** Current time in milliseconds.  Injectable for tests. */
    now?: () => number;
    /** Sleep implementation.  Injectable for tests. */
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** Seconds to wait before exiting after the n-th consecutive failure. */
export function computeDelay(n: number): number {
    if (n <= 1) {
        return 0;
    }
    if (n >= 9) {
        return MAX_DELAY_SECONDS;
    }
    return 10 * 2 ** (n - 2);
}

/** Resolve the decay window, falling back to the default on garbage. */
export function decaySeconds(env: Env, logger: Logger): number {
    const raw = env.BACKOFF_DECAY_SECONDS;
    if (raw === undefined || raw === "") {
        return DEFAULT_DECAY_SECONDS;
    }
    const parsed = parseNonNegativeInt(raw);
    if (parsed === undefined) {
        logger.warn(
            `BACKOFF_DECAY_SECONDS must be a non-negative integer.  Found: '${raw}'.  Using ${DEFAULT_DECAY_SECONDS}.`,
        );
        return DEFAULT_DECAY_SECONDS;
    }
    return parsed;
}

function readState(path: string): Record<string, unknown> | undefined {
    try {
        const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
        return parsed !== null && typeof parsed === "object"
            ? (parsed as Record<string, unknown>)
            : undefined;
    } catch {
        return undefined;
    }
}

function isCount(value: unknown): value is number {
    return (
        typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    );
}

/** Delete the failure state after a successful (or operator-ended) run. */
export function backoffReset(env: Env, logger: Logger): void {
    const cache = env.CONTAINER_CACHE ?? "";
    logger.debug(`backoff_reset: CONTAINER_CACHE='${cache}'`);
    const stateFile = `${cache}/${STATE_FILENAME}`;
    if (cache && isFile(stateFile)) {
        logger.info("Resetting backoff state after successful startup.");
        try {
            rmSync(stateFile, { force: true });
            logger.debug(`backoff_reset: deleted ${stateFile}`);
        } catch (err) {
            logger.warn(`Unable to delete backoff state file: ${String(err)}`);
        }
    } else {
        logger.debug(
            "backoff_reset: no state file to remove (file absent or no cache dir).",
        );
    }
}

/**
 * Apply backoff for a failed run and return the exit code to use.
 *
 *   Kubernetes (KUBERNETES_SERVICE_HOST set): return immediately —
 *     CrashLoopBackOff already throttles restarts.
 *   No usable cache directory: sleep until SIGTERM, then return 0 (a clean
 *     operator-initiated shutdown).  Without persisted state there is no
 *     other way to slow a restart loop.
 *   Otherwise: record the failure, sleep the computed delay (cut short by
 *     SIGTERM), and return the original exit code.
 */
export async function backoffOnFailure(
    exitCode: number,
    options: BackoffOptions,
): Promise<number> {
    const { env, logger, signal } = options;
    const now = options.now ?? Date.now;
    const doSleep = options.sleep ?? sleep;

    logger.debug(`backoff_on_failure: called with exit_code=${exitCode}`);
    logger.debug(
        `backoff_on_failure: CONTAINER_CACHE='${env.CONTAINER_CACHE ?? ""}'`,
    );
    logger.debug(
        `backoff_on_failure: KUBERNETES_SERVICE_HOST='${env.KUBERNETES_SERVICE_HOST ?? ""}'`,
    );

    if (env.KUBERNETES_SERVICE_HOST) {
        logger.info(
            "Kubernetes environment detected.  Skipping backoff — CrashLoopBackOff will handle restart throttling.",
        );
        return exitCode;
    }

    // Same default as the install step: unset → default path, empty → disabled.
    let cache = env.CONTAINER_CACHE ?? DEFAULT_CACHE;
    if (cache) {
        try {
            mkdirSync(cache, { recursive: true });
        } catch {
            logger.warn(
                `Cannot create CONTAINER_CACHE directory '${cache}'.  Treating cache as disabled.`,
            );
            cache = "";
        }
    }

    if (!cache) {
        logger.warn(
            "No CONTAINER_CACHE available.  Cannot persist backoff state.",
        );
        logger.warn(
            "Sleeping indefinitely to prevent a restart loop.  Send SIGTERM to shut down.",
        );
        await sleepForever(signal);
        return 0;
    }

    const stateFile = `${cache}/${STATE_FILENAME}`;
    let failures = 0;
    let previous: Record<string, unknown> | undefined;
    if (isFile(stateFile)) {
        logger.debug(`backoff_on_failure: reading state file ${stateFile}`);
        previous = readState(stateFile);
        if (previous && isCount(previous.consecutive_failures)) {
            failures = previous.consecutive_failures;
            logger.debug(
                `backoff_on_failure: read consecutive_failures=${failures}`,
            );
        } else {
            logger.warn(
                "Backoff state file is missing or corrupt.  Resetting failure count.",
            );
        }
    } else {
        logger.debug(
            "backoff_on_failure: no state file found, starting from consecutive_failures=0",
        );
    }

    const decay = decaySeconds(env, logger);
    const nowSeconds = Math.floor(now() / 1000);
    if (failures > 0 && previous && isCount(previous.last_failure_epoch)) {
        const since = nowSeconds - previous.last_failure_epoch;
        if (since > decay) {
            logger.info(
                `Last failure was ${since}s ago (> ${decay}s).  Resetting failure count.`,
            );
            failures = 0;
        }
    }

    const n = failures + 1;
    const delay = computeDelay(n);
    if (delay === 0) {
        logger.warn(
            `Failure ${n} detected (exit code ${exitCode}).  Exiting immediately.`,
        );
    } else {
        logger.warn(
            `Failure ${n} detected (exit code ${exitCode}).  Waiting ${delay}s before exiting.`,
        );
    }

    const state: BackoffState = {
        consecutive_failures: n,
        last_failure_timestamp: new Date(nowSeconds * 1000)
            .toISOString()
            .replace(/\.\d{3}Z$/, "Z"),
        last_failure_epoch: nowSeconds,
    };
    // Write atomically.  If that fails (disk full, read-only volume), fall
    // back to the indefinite sleep so a broken write cannot silently degrade
    // into a rapid restart loop.
    const tmpFile = `${stateFile}.tmp`;
    try {
        writeFileSync(tmpFile, JSON.stringify(state) + "\n");
        renameSync(tmpFile, stateFile);
    } catch {
        logger.error(
            `Failed to write backoff state file '${stateFile}'.  Falling back to indefinite sleep.`,
        );
        try {
            rmSync(tmpFile, { force: true });
        } catch {
            // Best effort; the sleep below is what matters.
        }
        await sleepForever(signal);
        return 0;
    }
    logger.debug(
        `backoff_on_failure: wrote state file ${stateFile} (consecutive_failures=${n})`,
    );

    if (delay > 0) {
        logger.debug(`backoff_on_failure: sleeping ${delay}s`);
        await doSleep(delay * 1000, signal);
        logger.debug(
            `backoff_on_failure: sleep complete, exiting with code ${exitCode}`,
        );
    }
    return exitCode;
}
