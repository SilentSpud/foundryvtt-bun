/**
 * Client for the foundryvtt.com account pages: log in, list license keys,
 * and request presigned release download URLs.
 *
 * Cookies live in a tough-cookie jar.  The entrypoint keeps the session in
 * memory; the command-line utilities persist it to a JSON file so separate
 * invocations can share it.  Proxies are honored through Bun's fetch, which
 * reads HTTP_PROXY, HTTPS_PROXY, and NO_PROXY from the environment.
 */

import { readFileSync, writeFileSync } from "node:fs";

import fetchCookie from "fetch-cookie";
import { Cookie, CookieJar } from "tough-cookie";

import { type Logger, silentLogger } from "./logging.ts";
import { sleep } from "./util.ts";

export const BASE_URL = "https://foundryvtt.com";
/** Cookie domain used to hand the resolved username between utilities. */
export const LOCAL_DOMAIN = "felddy.com";
export const DEFAULT_USER_AGENT = `Bun/${Bun.version}`;
const INITIAL_RETRY_DELAY_S = 120; // 2 minutes
const USERNAME_RE = /\/community\/(?<username>.+)/;

export interface SessionOptions {
    logger?: Logger;
    userAgent?: string;
    /** Site root.  Overridable for tests. */
    baseUrl?: string;
}

/** Attribute values of every element matching `selector`, in order. */
export function selectAttributes(
    html: string,
    selector: string,
    attribute: string,
): string[] {
    const values: string[] = [];
    new HTMLRewriter()
        .on(selector, {
            element(element) {
                const value = element.getAttribute(attribute);
                if (value !== null) {
                    values.push(value);
                }
            },
        })
        .transform(html);
    return values;
}

export class FoundrySession {
    readonly jar: CookieJar;
    readonly baseUrl: string;
    readonly logger: Logger;
    private readonly headers: Record<string, string>;
    private readonly fetch: typeof fetch;

    constructor(options: SessionOptions = {}, jar = new CookieJar()) {
        this.jar = jar;
        this.baseUrl = options.baseUrl ?? BASE_URL;
        this.logger = options.logger ?? silentLogger;
        this.headers = {
            DNT: "1",
            Referer: this.baseUrl,
            "Upgrade-Insecure-Requests": "1",
            "User-Agent": options.userAgent || DEFAULT_USER_AGENT,
        };
        this.fetch = fetchCookie(fetch, jar) as unknown as typeof fetch;
    }

    /** Restore a session saved with save(). */
    static load(path: string, options: SessionOptions = {}): FoundrySession {
        const jar = CookieJar.deserializeSync(readFileSync(path, "utf8"));
        return new FoundrySession(options, jar);
    }

    save(path: string): void {
        writeFileSync(path, JSON.stringify(this.jar.serializeSync()), {
            mode: 0o600,
        });
    }

    /** Account username resolved at login (never the e-mail address). */
    get username(): string | undefined {
        const cookies = this.jar.getCookiesSync(`http://${LOCAL_DOMAIN}`);
        if (cookies.length > 1) {
            throw new Error(
                `Wrong number of cookies found for ${LOCAL_DOMAIN}.  Expected 1, found ${cookies.length}`,
            );
        }
        return cookies[0]?.value;
    }

    private set username(value: string) {
        const cookie = Cookie.parse(
            `username=${value}; Domain=${LOCAL_DOMAIN}; Path=/`,
        );
        this.jar.setCookieSync(cookie!.toString(), `http://${LOCAL_DOMAIN}`);
    }

    private async request(
        url: string,
        init: RequestInit = {},
    ): Promise<Response> {
        this.logger.debug(`Fetching: ${url}`);
        return this.fetch(url, { ...init, headers: this.headers });
    }

    private async text(url: string, init?: RequestInit): Promise<string> {
        const response = await this.request(url, init);
        if (!response.ok) {
            throw new Error(
                `Unexpected response ${response.status} ${response.statusText}`,
            );
        }
        return response.text();
    }

    /** Fetch the CSRF form token (the cookie token lands in the jar). */
    private async csrfToken(): Promise<string> {
        this.logger.info(`Requesting CSRF tokens from ${this.baseUrl}`);
        const body = await this.text(this.baseUrl);
        const token = selectAttributes(
            body,
            'input[name="csrfmiddlewaretoken"]',
            "value",
        )[0]?.trim();
        if (!token) {
            throw new Error("Could not find the CSRF middleware token.");
        }
        return token;
    }

    /**
     * Log in and return the account's username, lowercased.  A user may log
     * in with an e-mail address, so the username is resolved from the page.
     */
    async login(username: string, password: string): Promise<string> {
        const csrfmiddlewaretoken = await this.csrfToken();
        const form = new URLSearchParams({
            csrfmiddlewaretoken,
            next: "/",
            password,
            username,
        });
        this.logger.info(`Logging in as: ${username}`);
        const body = await this.text(`${this.baseUrl}/auth/login/`, {
            body: form,
            method: "POST",
        });

        const session = this.jar
            .getCookiesSync(this.baseUrl)
            .find((cookie) => cookie.key === "sessionid");
        if (!session) {
            throw new Error(
                `Unable to log in as ${username}, verify your credentials...`,
            );
        }

        const communityURL = selectAttributes(
            body,
            "#login-welcome a",
            "href",
        )[0];
        this.logger.debug(`Community URL: ${communityURL}`);
        if (!communityURL) {
            throw new Error("Could not find the community URL.");
        }
        const loggedIn = communityURL.match(USERNAME_RE)?.groups?.username;
        if (!loggedIn) {
            throw new Error(`Unable to resolve username from ${communityURL}`);
        }
        this.logger.info(`Successfully logged in as: ${loggedIn}`);
        // The site preserves case, but the licenses URL needs it lowercased.
        this.username = loggedIn.toLowerCase();
        return loggedIn.toLowerCase();
    }

    /** License keys on the account, formatted without dashes. */
    async licenses(): Promise<string[]> {
        const username = this.username;
        if (!username) {
            throw new Error(
                `No username cookie found for ${LOCAL_DOMAIN}.  Log in first.`,
            );
        }
        this.logger.info("Fetching licenses.");
        const body = await this.text(
            `${this.baseUrl}/community/${username}/licenses`,
        );
        return selectAttributes(body, "div.license label.copy input", "value")
            .map((value) => value.replace(/-/g, ""))
            .filter(Boolean);
    }

    /**
     * Pick one license key.  `select` is a 1-based index; without a numeric
     * index a random key is returned.  Out-of-range indexes are clamped.
     */
    async license(
        select?: string,
        random: () => number = Math.random,
    ): Promise<string> {
        const keys = await this.licenses();
        const count = keys.length;
        const username = this.username;
        if (count === 0) {
            throw new Error(
                `Could not find any license keys associated with account ${username}`,
            );
        }
        this.logger.info(
            `Found ${count} license ${count === 1 ? "key" : "keys"} associated with account ${username}`,
        );
        if (count === 1) {
            this.logger.debug("Returning single license.");
            return keys[0]!;
        }
        const requested = Number.parseInt(select ?? "");
        if (!requested) {
            const index = Math.floor(random() * count) + 1;
            this.logger.info(`License key #${index} randomly selected.`);
            return keys[index - 1]!;
        }
        let index = requested;
        if (index > count) {
            this.logger.warn(
                `Invalid license key index ${index} selected by user.  Using ${count}.`,
            );
            index = count;
        }
        if (index < 1) {
            this.logger.warn(
                `Invalid license key index ${index} selected by user.  Using 1.`,
            );
            index = 1;
        }
        this.logger.info(`License key #${index} selected by user.`);
        return keys[index - 1]!;
    }

    /** Exponential sleep before a retry, logging the time remaining. */
    private async retryDelay(
        attempt: number,
        initialDelay: number,
    ): Promise<void> {
        const delay = Math.ceil(
            initialDelay * 2 ** (attempt - 1) + Math.random() * initialDelay,
        );
        this.logger.info(`Sleeping for ${delay} seconds before retrying...`);
        const end = Date.now() + delay * 1000;
        while (Date.now() < end) {
            await sleep(Math.min(1000, end - Date.now()));
            const remaining = Math.ceil((end - Date.now()) / 1000);
            if (remaining % 10 === 0 || remaining < 10) {
                this.logger.info(`${remaining} seconds remaining...`);
            }
        }
    }

    /**
     * Presigned download URL for a release ("generation.build").
     *
     * The endpoint is keyed on the build number alone, so requesting a
     * nonexistent generation (e.g. 11.331 when build 331 belongs to v12)
     * returns a different generation's release.  The presigned URL embeds the
     * real version, so a mismatch is caught before any download.  Best
     * effort: an unparseable URL skips the check, and the entrypoint verifies
     * the archive contents as the backstop.
     */
    async releaseUrl(
        version: string,
        retries = 0,
        initialRetryDelay = INITIAL_RETRY_DELAY_S,
    ): Promise<string> {
        const build = version.split(".").pop();
        if (!build) {
            throw new Error(
                `Unable to extract build number from version: ${version}`,
            );
        }
        this.logger.info(
            `Fetching presigned release URL for build ${build}...`,
        );
        const url = `${this.baseUrl}/releases/download?build=${build}&platform=node&response_type=json`;
        let presigned: string | undefined;
        for (let attempt = 1; attempt <= 1 + retries; attempt++) {
            if (attempt > 1) {
                await this.retryDelay(attempt, initialRetryDelay);
            }
            this.logger.debug(`Attempt ${attempt} of ${1 + retries}`);
            const response = await this.request(url);
            if (response.status !== 200) {
                this.logger.warn(
                    `Unexpected response ${response.status}: ${response.statusText}`,
                );
                continue;
            }
            const json = (await response.json()) as { url?: string };
            presigned = json.url;
            break;
        }
        if (presigned === undefined) {
            throw new Error("Failed to fetch release URL.");
        }
        if (!presigned) {
            throw new Error("Could not fetch a release URL.");
        }
        this.logger.debug(`Presigned URL: ${presigned}`);
        const urlVersion = presigned.match(
            /(?:releases\/|foundryvtt[^/]*?-)(\d+\.\d+(?:\.\d+)?)/i,
        )?.[1];
        if (urlVersion && urlVersion !== version) {
            throw new Error(
                `Build ${build} belongs to Foundry Virtual Tabletop ${urlVersion}, ` +
                    `not the requested ${version}.  Version ${version} does not appear to exist.`,
            );
        }
        return presigned;
    }
}
