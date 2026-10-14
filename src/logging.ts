/**
 * Minimal leveled logger shared by every container utility.
 *
 * Lines look like `Name | 2024-01-31 12:34:56 | [info] message`, with the
 * level colorized, matching the format of src/logging.sh (which remains as
 * the log helper library for user patch scripts).
 */

export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVELS: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
};

const COLORS: Record<LogLevel, string> = {
    debug: "\x1b[34m",
    error: "\x1b[31m",
    info: "\x1b[32m",
    warn: "\x1b[33m",
};
const RESET = "\x1b[0m";

export interface Logger {
    debug(message: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

export interface LoggerOptions {
    /** Most verbose level that is emitted.  Defaults to "info". */
    level?: string;
    /** Where lines are written.  Defaults to stderr. */
    stream?: "stdout" | "stderr";
}

/** Format a date as `YYYY-MM-DD HH:MM:SS` in the local time zone. */
export function timestamp(date: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    );
}

export function isLogLevel(value: string): value is LogLevel {
    return Object.hasOwn(LEVELS, value);
}

export default function createLogger(
    name: string,
    options: LoggerOptions = {},
): Logger {
    const requested = (options.level ?? "info").toLowerCase();
    const threshold = LEVELS[isLogLevel(requested) ? requested : "info"];
    const write =
        options.stream === "stdout"
            ? (line: string) => process.stdout.write(line)
            : (line: string) => process.stderr.write(line);
    const emit = (level: LogLevel, message: string) => {
        if (LEVELS[level] > threshold) {
            return;
        }
        write(
            `${name} | ${timestamp()} | [${COLORS[level]}${level}${RESET}] ${message}\n`,
        );
    };
    return {
        debug: (message) => emit("debug", message),
        info: (message) => emit("info", message),
        warn: (message) => emit("warn", message),
        error: (message) => emit("error", message),
    };
}

/** A logger that discards everything; handy as a default and in tests. */
export const silentLogger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
};
