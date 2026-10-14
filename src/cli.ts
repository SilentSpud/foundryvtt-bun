/** Shared command-line handling for the account utilities. */

import { parseArgs, type ParseArgsConfig } from "node:util";

import createLogger, { isLogLevel, type Logger } from "./logging.ts";

export const COMMON_OPTIONS_HELP = `
  -h --help               Show this message.
  --log-level=LEVEL       Log level: "debug", "info", "warn", or "error".
                          [default: info]
  --user-agent=USERAGENT  The user-agent header to send.`;

type Options = NonNullable<ParseArgsConfig["options"]>;

export interface ParsedCli {
    values: Record<string, string | boolean | undefined>;
    positionals: string[];
    logger: Logger;
    userAgent: string | undefined;
}

/**
 * Parse argv against `options` (plus the common ones), printing usage and
 * exiting on --help or a usage error.
 */
export function parseCli(
    usage: string,
    loggerName: string,
    positionalCount: number,
    options: Options = {},
    argv: string[] = process.argv.slice(2),
): ParsedCli {
    let parsed;
    try {
        parsed = parseArgs({
            args: argv,
            allowPositionals: true,
            options: {
                help: { type: "boolean", short: "h" },
                "log-level": { type: "string", default: "info" },
                "user-agent": { type: "string" },
                ...options,
            },
        });
    } catch (err) {
        process.stderr.write(`${(err as Error).message}\n${usage}`);
        process.exit(2);
    }
    if (parsed.values.help) {
        process.stdout.write(usage);
        process.exit(0);
    }
    if (parsed.positionals.length !== positionalCount) {
        process.stderr.write(usage);
        process.exit(2);
    }
    const level = String(parsed.values["log-level"]).toLowerCase();
    if (!isLogLevel(level)) {
        process.stderr.write(`Invalid --log-level: ${level}\n${usage}`);
        process.exit(2);
    }
    return {
        values: parsed.values as ParsedCli["values"],
        positionals: parsed.positionals,
        logger: createLogger(loggerName, { level }),
        userAgent: parsed.values["user-agent"] as string | undefined,
    };
}

/** Run an async CLI main, mapping a thrown error to a logged failure. */
export async function runCli(
    logger: Logger,
    main: () => Promise<void>,
): Promise<void> {
    try {
        await main();
    } catch (err) {
        logger.error((err as Error).message);
        process.exitCode = 1;
    }
}
