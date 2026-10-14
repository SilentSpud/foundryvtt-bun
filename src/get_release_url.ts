#!/usr/bin/env bun

import { parseCli, runCli, COMMON_OPTIONS_HELP } from "./cli.ts";
import { FoundrySession } from "./foundry_site.ts";
import { parseNonNegativeInt } from "./util.ts";

const USAGE = `
Generate a Foundry Virtual Tabletop presigned release URL using cookies from
authenticate.js.  The release URL is printed to standard out.

EXIT STATUS
    0   Completed successfully.
    >0  An error occurred.

Usage:
  get_release_url.js [options] <cookiejar> <version>
  get_release_url.js (-h | --help)

Options:${COMMON_OPTIONS_HELP}
  --retry=COUNT           The number of retries that will be attempted before
                          giving up. [default: 0]
`;

const { values, positionals, logger, userAgent } = parseCli(
    USAGE,
    "ReleaseURL",
    2,
    {
        retry: { type: "string", default: "0" },
    },
);
const [cookiejar, version] = positionals as [string, string];

await runCli(logger, async () => {
    const retryOption = String(values.retry);
    const retries = parseNonNegativeInt(retryOption);
    if (retries === undefined) {
        throw new Error(
            `--retry must be a non-negative safe integer.  Found: ${retryOption}`,
        );
    }
    logger.debug(`Loading cookies from: ${cookiejar}`);
    const session = FoundrySession.load(cookiejar, { logger, userAgent });
    process.stdout.write(await session.releaseUrl(version, retries));
});
