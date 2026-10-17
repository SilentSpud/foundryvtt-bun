#!/usr/bin/env bun

/**
 * Health check.  Prefers options.json, which includes setup-UI changes, over
 * the environment, which alone probed http against UI-set https (#1398).
 */

import { readFileSync, writeFileSync } from "node:fs";

type Env = Record<string, string | undefined>;

export interface ProbeTarget {
    url: string;
    unixSocket?: string;
}

const COOKIE_FILE = "/tmp/healthcheck-cookies.json";
const TIMEOUT_MS = 4500;

function readOptions(path: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
        return parsed !== null && typeof parsed === "object"
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}

/** Where to probe, from options.json with environment fallbacks. */
export function probeTarget(env: Env): ProbeTarget {
    const options = readOptions(
        `${env.DATA_DIR || "/data"}/Config/options.json`,
    );
    // Mirrors `jq '.key // empty'`: null, false, and "" fall through.
    const opt = (key: string): string | undefined => {
        const value = options[key];
        return value === null ||
            value === undefined ||
            value === false ||
            value === ""
            ? undefined
            : String(value);
    };
    const sslCert = opt("sslCert") ?? env.FOUNDRY_SSL_CERT;
    const sslKey = opt("sslKey") ?? env.FOUNDRY_SSL_KEY;
    const routePrefix = opt("routePrefix") ?? env.FOUNDRY_ROUTE_PREFIX;
    const unixSocket = opt("unixSocket") ?? env.FOUNDRY_UNIX_SOCKET;
    const port = opt("port") ?? "30000";
    const path = `${routePrefix ? `/${routePrefix}` : ""}/api/status`;

    if (unixSocket) {
        // A unix-socket server has no TCP port; the host is a placeholder.
        return { url: `http://localhost${path}`, unixSocket };
    }
    const protocol = sslCert && sslKey ? "https" : "http";
    return { url: `${protocol}://localhost:${port}${path}` };
}

function loadCookies(path: string): Record<string, string> {
    try {
        return JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
    } catch {
        return {};
    }
}

/**
 * Probe the target.  The session cookie is kept between probes so each
 * check does not create a fresh server session.
 */
export async function checkHealth(
    target: ProbeTarget,
    cookieFile: string = COOKIE_FILE,
): Promise<boolean> {
    const cookies = loadCookies(cookieFile);
    const cookieHeader = Object.entries(cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    let response: Response;
    try {
        response = await fetch(target.url, {
            headers: cookieHeader ? { Cookie: cookieHeader } : {},
            redirect: "manual",
            signal: AbortSignal.timeout(TIMEOUT_MS),
            // Servers commonly use self-signed certificates.
            tls: { rejectUnauthorized: false },
            ...(target.unixSocket ? { unix: target.unixSocket } : {}),
        });
        await response.arrayBuffer();
    } catch {
        return false;
    }
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length > 0) {
        for (const header of setCookies) {
            const pair = header.split(";", 1)[0]!;
            const eq = pair.indexOf("=");
            if (eq > 0) {
                cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
            }
        }
        try {
            writeFileSync(cookieFile, JSON.stringify(cookies), { mode: 0o600 });
        } catch {
            // A read-only /tmp must not fail the probe.
        }
    }
    return response.status < 400;
}

if (import.meta.main) {
    process.exit((await checkHealth(probeTarget(process.env))) ? 0 : 1);
}
