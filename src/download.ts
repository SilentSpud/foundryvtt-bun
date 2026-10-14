/** HTTP downloads for release archives and patch scripts. */

import { open, stat } from "node:fs/promises";

import { type Logger } from "./logging.ts";

export interface DownloadOptions {
    userAgent: string;
    logger: Logger;
    /**
     * Only download when the remote file is newer than this local file
     * (If-Modified-Since from its mtime).  On a 304 nothing is written.
     */
    newerThan?: string;
    /** Seconds between progress log lines.  0 disables progress. */
    progressInterval?: number;
}

export type DownloadResult = "downloaded" | "not-modified";

function formatBytes(bytes: number): string {
    const units = ["B", "KiB", "MiB", "GiB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/**
 * Stream `url` to `output`.  Throws on network errors and HTTP error
 * statuses, leaving any partial output for the caller to remove.  Data is
 * written as it arrives, so the file's growing size shows other instances
 * sharing the cache that the download is alive.
 */
export async function download(
    url: string,
    output: string,
    options: DownloadOptions,
): Promise<DownloadResult> {
    const { logger } = options;
    const headers: Record<string, string> = { "User-Agent": options.userAgent };
    if (options.newerThan) {
        try {
            const { mtime } = await stat(options.newerThan);
            headers["If-Modified-Since"] = mtime.toUTCString();
        } catch {
            // No local copy: download unconditionally.
        }
    }
    const response = await fetch(url, { headers });
    logger.debug(
        `Download response: ${response.status} ${response.statusText}`,
    );
    if (response.status === 304) {
        await response.body?.cancel();
        logger.info("The cached release is up to date.");
        return "not-modified";
    }
    if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    // fetch decodes any content-encoding, so the length only describes the
    // body we receive when there is none.
    const total = response.headers.get("content-encoding")
        ? 0
        : Number(response.headers.get("content-length")) || 0;
    const interval = (options.progressInterval ?? 5) * 1000;
    let received = 0;
    let lastReport = Date.now();
    const file = await open(output, "w");
    try {
        for await (const chunk of response.body) {
            await file.write(chunk);
            received += chunk.byteLength;
            if (interval > 0 && Date.now() - lastReport >= interval) {
                lastReport = Date.now();
                const percent = total
                    ? ` (${Math.floor((received / total) * 100)}%)`
                    : "";
                logger.info(`Downloaded ${formatBytes(received)}${percent}`);
            }
        }
    } finally {
        await file.close();
    }
    if (total && received !== total) {
        throw new Error(
            `Incomplete download: received ${received} of ${total} bytes`,
        );
    }
    logger.info(`Download complete: ${formatBytes(received)}`);
    return "downloaded";
}
