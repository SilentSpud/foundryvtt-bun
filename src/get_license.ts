#!/usr/bin/env bun

import { parseCli, runCli, COMMON_OPTIONS_HELP } from "./cli.ts";
import { FoundrySession } from "./foundry_site.ts";

const USAGE = `
Retrieve a Foundry Virtual Tabletop license key from a user's account using
cookies from authenticate.js.  The license key is printed to standard out.

EXIT STATUS
    0   Completed successfully.
    >0  An error occurred.

Usage:
  get_license.js [options] <cookiejar>
  get_license.js (-h | --help)

Options:${COMMON_OPTIONS_HELP}
  --select=INDEX          If more than one license key is associated with an
                          account return the one specified by index.  If
                          unspecified, a random license will be returned.
                          Index starts at 1.
`;

const { values, positionals, logger, userAgent } = parseCli(
    USAGE,
    "License",
    1,
    {
        select: { type: "string" },
    },
);
const [cookiejar] = positionals as [string];

await runCli(logger, async () => {
    logger.debug(`Reading cookies from: ${cookiejar}`);
    const session = FoundrySession.load(cookiejar, { logger, userAgent });
    process.stdout.write(
        await session.license(values.select as string | undefined),
    );
});
