#!/usr/bin/env bun

import { parseCli, runCli, COMMON_OPTIONS_HELP } from "./cli.ts";
import { FoundrySession } from "./foundry_site.ts";

const USAGE = `
Log into the Foundry Virtual Tabletop website, and save the session cookies
to a file for use by get_license.js and get_release_url.js.

EXIT STATUS
    0   Login completed successfully.
    >0  An error occurred.

Usage:
  authenticate.js [options] <username> <password> <cookiejar>
  authenticate.js (-h | --help)

Options:${COMMON_OPTIONS_HELP}
`;

const { positionals, logger, userAgent } = parseCli(USAGE, "Authenticate", 3);
const [username, password, cookiejar] = positionals as [string, string, string];

await runCli(logger, async () => {
    const session = new FoundrySession({ logger, userAgent });
    try {
        await session.login(username.toLowerCase(), password);
    } catch (err) {
        throw new Error(`Unable to authenticate: ${(err as Error).message}`);
    }
    logger.debug(`Saving cookies to: ${cookiejar}`);
    session.save(cookiejar);
});
