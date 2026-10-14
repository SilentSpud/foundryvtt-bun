/** Small helpers shared by the container utilities. */

import { statSync } from "node:fs";

/**
 * Thrown to end the entrypoint with a specific exit code.  Every failure is
 * routed through the backoff logic in main(), so code paths that would have
 * called `exit 1` in a shell script throw this instead.
 */
export class ExitError extends Error {
    constructor(
        readonly code: number,
        message = `exit ${code}`,
    ) {
        super(message);
        this.name = "ExitError";
    }
}

export function isFile(path: string): boolean {
    try {
        return statSync(path).isFile();
    } catch {
        return false;
    }
}

export function isDirectory(path: string): boolean {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}

/** Resolve after `ms` milliseconds, or early (without error) on abort. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal?.aborted) {
            resolve();
            return;
        }
        const timer = setTimeout(done, ms);
        function done() {
            clearTimeout(timer);
            signal?.removeEventListener("abort", done);
            resolve();
        }
        signal?.addEventListener("abort", done, { once: true });
    });
}

/** Resolve only when the signal aborts (an interruptible "sleep infinity"). */
export function sleepForever(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal.aborted) {
            resolve();
            return;
        }
        // Keep the event loop alive; an abort listener alone does not.
        const keepAlive = setInterval(() => {}, 1 << 30);
        signal.addEventListener(
            "abort",
            () => {
                clearInterval(keepAlive);
                resolve();
            },
            { once: true },
        );
    });
}

/** Convert a glob containing only `*` wildcards into an anchored RegExp. */
export function wildcardToRegExp(pattern: string): RegExp {
    const escaped = pattern
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*");
    return new RegExp(`^${escaped}$`);
}

/**
 * Parse a non-negative decimal integer.  Leading zeros are decimal (never
 * octal) and anything other than plain digits is rejected.
 */
export function parseNonNegativeInt(value: string): number | undefined {
    if (!/^[0-9]+$/.test(value)) {
        return undefined;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
}
