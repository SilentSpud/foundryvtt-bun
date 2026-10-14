/**
 * Cache eviction for downloaded release archives.
 *
 * Archives beyond the keep count are deleted, keeping the most recently
 * *used* ones.  An archive's mtime records its last use: downloads set it,
 * and the entrypoint touches the archive each time a container installs from
 * it.  Evicting by use instead of by version number keeps an older major's
 * release alive in a shared cache as long as some instance still installs it
 * (#1266).
 *
 * Only files matching foundryvtt-*.zip are ever considered: in-progress
 * downloads, lock directories, and state files are never touched.
 */

import { readdirSync, rmSync, statSync } from "node:fs";

import { type Logger } from "./logging.ts";

const ARCHIVE_RE = /^foundryvtt-.*\.zip$/;

/** Cached release archives, most recently used first. */
export function cachedReleases(cacheDir: string): string[] {
    let names: string[];
    try {
        names = readdirSync(cacheDir).filter((name) => ARCHIVE_RE.test(name));
    } catch {
        return [];
    }
    const entries: { name: string; mtime: number }[] = [];
    for (const name of names) {
        try {
            const stat = statSync(`${cacheDir}/${name}`);
            if (stat.isFile()) {
                entries.push({ name, mtime: stat.mtimeMs });
            }
        } catch {
            // vanished
        }
    }
    entries.sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? -1 : 1));
    return entries.map((entry) => entry.name);
}

/** Delete least recently used archives beyond `keep`; returns the count. */
export function cachePrune(
    cacheDir: string,
    keep: number,
    logger: Logger,
): number {
    let removed = 0;
    for (const name of cachedReleases(cacheDir).slice(keep)) {
        logger.warn(
            `Removing least recently used cached release: ${cacheDir}/${name}`,
        );
        rmSync(`${cacheDir}/${name}`, { force: true });
        removed++;
    }
    if (removed > 0) {
        logger.info(`Completed cache cleanup.  Removed ${removed} files.`);
    } else {
        logger.info("No cache cleanup was necessary.");
    }
    return removed;
}
