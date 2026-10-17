/** Child process lifecycle handling. */

import { constants } from "node:os";

import { type Logger, silentLogger } from "./logging.ts";

/** Shell-style exit status: the exit code, or 128 + signal number. */
export function exitStatus(proc: {
    exitCode: number | null;
    signalCode: NodeJS.Signals | number | null;
}): number {
    if (proc.exitCode !== null) {
        return proc.exitCode;
    }
    const signal = proc.signalCode;
    if (typeof signal === "number") {
        return 128 + signal;
    }
    return 128 + (signal ? (constants.signals[signal] ?? 0) : 0);
}

export interface RunChildOptions {
    env?: Record<string, string | undefined>;
    cwd?: string;
    logger?: Logger;
    /**
     * Signals forwarded to the child.  Settles only once the child exits: as
     * PID 1, returning early would get it SIGKILLed mid-shutdown.
     */
    forward?: NodeJS.Signals[];
    /** Signals received but not forwarded (the child gets them itself). */
    ignore?: NodeJS.Signals[];
}

/** Run a command with inherited stdio and resolve to its exit status. */
export async function runChild(
    argv: string[],
    options: RunChildOptions = {},
): Promise<number> {
    const logger = options.logger ?? silentLogger;
    const proc = Bun.spawn(argv, {
        cwd: options.cwd,
        env: options.env,
        stdio: ["inherit", "inherit", "inherit"],
    });
    const handlers: [NodeJS.Signals, () => void][] = [
        ...(options.forward ?? []).map(
            (signal): [NodeJS.Signals, () => void] => [
                signal,
                () => {
                    logger.debug(
                        `Sending ${signal} signal to child pid: ${proc.pid}`,
                    );
                    proc.kill(signal);
                },
            ],
        ),
        ...(options.ignore ?? []).map(
            (signal): [NodeJS.Signals, () => void] => [signal, () => {}],
        ),
    ];
    for (const [signal, handler] of handlers) {
        process.on(signal, handler);
    }
    try {
        logger.debug(`Waiting for child pid: ${proc.pid} to exit.`);
        await proc.exited;
    } finally {
        for (const [signal, handler] of handlers) {
            process.off(signal, handler);
        }
    }
    return exitStatus(proc);
}
