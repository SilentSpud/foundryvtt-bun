/**
 * Arbitrate release downloads between container instances that share a
 * CONTAINER_CACHE volume.
 *
 * Coordination is purely filesystem-based, so it works across containers,
 * hosts, and cluster nodes mounting the same cache volume:
 *   * mutual exclusion — atomic mkdir of a per-release lock directory
 *   * liveness — progress of the in-progress download files, measured as
 *     size deltas between our own successive polls (immune to clock skew
 *     between nodes and to NFS attribute-cache lag)
 *   * crash recovery — a stalled holder's lock is stolen with an atomic
 *     rename, so two waiters can never both claim the same stale lock
 *
 * Tunables (mainly for tests):
 *   DOWNLOAD_LOCK_POLL_SECONDS  seconds between polls          (default 5)
 *   DOWNLOAD_LOCK_STALL_TICKS   polls without progress before the holder
 *                               is presumed dead               (default 60)
 *   DOWNLOAD_LOCK_STEAL_LIMIT   stale locks stolen before giving up
 *                                                              (default 3)
 */

import {
    mkdirSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { basename, dirname } from "node:path";

import { type Logger } from "./logging.ts";
import {
    isDirectory,
    isFile,
    parseNonNegativeInt,
    sleep,
    wildcardToRegExp,
} from "./util.ts";

export enum SlotState {
    /** Slot acquired: download, then call release(). */
    Acquired = 0,
    /** The release file appeared: nothing to download, no lock held. */
    Cached = 1,
    /** Locking impossible (e.g. read-only cache), no lock held. */
    Unarbitrated = 2,
    /** Steal limit reached on a stalled lock, no lock held. */
    GaveUp = 3,
}

type Env = Record<string, string | undefined>;

export interface LockTunables {
    pollSeconds: number;
    stallTicks: number;
    stealLimit: number;
}

/** Read the tunables from the environment, falling back on garbage. */
export function lockTunables(env: Env, logger: Logger): LockTunables {
    let pollSeconds = 5;
    const poll = env.DOWNLOAD_LOCK_POLL_SECONDS;
    if (poll !== undefined && poll !== "") {
        // A zero interval would busy-spin waiters.
        if (/^[0-9]*\.?[0-9]+$/.test(poll) && Number(poll) > 0) {
            pollSeconds = Number(poll);
        } else {
            logger.warn(
                `DOWNLOAD_LOCK_POLL_SECONDS must be a positive number.  Found: '${poll}'.  Using 5.`,
            );
        }
    }
    const integer = (name: string, fallback: number): number => {
        const raw = env[name];
        if (raw === undefined || raw === "") {
            return fallback;
        }
        const parsed = parseNonNegativeInt(raw);
        if (parsed === undefined) {
            logger.warn(
                `${name} must be a non-negative integer.  Found: '${raw}'.  Using ${fallback}.`,
            );
            return fallback;
        }
        return parsed;
    };
    return {
        pollSeconds,
        stallTicks: integer("DOWNLOAD_LOCK_STALL_TICKS", 60),
        stealLimit: integer("DOWNLOAD_LOCK_STEAL_LIMIT", 3),
    };
}

/**
 * In a container the entrypoint's PID is fixed and a restarted container
 * keeps its hostname, so this id is stable per run but not across runs —
 * which is exactly what the owner file (debug info only) needs.
 */
export function instanceId(env: Env = process.env): string {
    return `${env.HOSTNAME || "unknown"}-${process.pid}`;
}

/**
 * Signature of every in-progress file matching the glob.  A change between
 * two of our own polls means the download is alive; comparing our successive
 * observations avoids trusting any node's clock.
 */
export function progressSignature(tempGlob: string): string {
    const dir = dirname(tempGlob);
    const matcher = wildcardToRegExp(basename(tempGlob));
    let names: string[];
    try {
        names = readdirSync(dir)
            .filter((name) => matcher.test(name))
            .sort();
    } catch {
        return "";
    }
    let signature = "";
    for (const name of names) {
        const path = `${dir}/${name}`;
        try {
            const stat = statSync(path);
            if (stat.isFile()) {
                signature += `${path}=${stat.size};`;
            }
        } catch {
            signature += `${path}=?;`;
        }
    }
    return signature;
}

export class DownloadLock {
    /** Lock directory currently held by this process, if any. */
    private held = "";
    private readonly id: string;
    readonly tunables: LockTunables;

    constructor(
        private readonly logger: Logger,
        env: Env = process.env,
        tunables?: LockTunables,
    ) {
        this.id = instanceId(env);
        this.tunables = tunables ?? lockTunables(env, logger);
    }

    /** 0 acquired / 1 busy / 2 cannot lock */
    private tryLock(lockDir: string): 0 | 1 | 2 {
        try {
            mkdirSync(lockDir);
        } catch {
            return isDirectory(lockDir) ? 1 : 2;
        }
        this.held = lockDir;
        // Debug info only: PIDs are meaningless across containers and
        // nodes, so liveness is judged by download progress, never by this.
        try {
            writeFileSync(`${lockDir}/owner`, this.id);
        } catch {
            // ignore
        }
        return 0;
    }

    /**
     * Release the lock if this process holds one.  Safe to call
     * unconditionally, including from exit paths.
     */
    release(): void {
        if (!this.held) {
            return;
        }
        // Only remove the directory if it is still the one this process
        // created.  After a steal-and-reacquire the same path belongs to a
        // newer holder, and deleting it would break mutual exclusion.  A
        // missing owner file is treated as "not ours": it may be a new
        // holder's mkdir caught before its owner write, and an ownerless
        // lock of our own is self-healing (it stalls and gets stolen).
        let owner = "";
        try {
            owner = readFileSync(`${this.held}/owner`, "utf8");
        } catch {
            // missing owner
        }
        if (owner === this.id) {
            this.logger.debug(`download_lock: releasing ${this.held}`);
            try {
                rmSync(this.held, { recursive: true, force: true });
            } catch {
                // ignore
            }
        } else {
            this.logger.debug(
                `download_lock: not removing ${this.held}: owner is '${owner || "unknown"}', not us`,
            );
        }
        this.held = "";
    }

    async acquire(
        lockDir: string,
        releaseFile: string,
        tempGlob: string,
    ): Promise<SlotState> {
        const { pollSeconds, stallTicks, stealLimit } = this.tunables;
        let steals = 0;
        for (;;) {
            // The release may have been produced since we last looked.
            if (isFile(releaseFile)) {
                return SlotState.Cached;
            }
            const rc = this.tryLock(lockDir);
            if (rc === 0) {
                // Double-check after winning: another instance may have
                // finished between our release check and the mkdir.
                if (isFile(releaseFile)) {
                    this.release();
                    return SlotState.Cached;
                }
                this.logger.debug(`download_lock: acquired ${lockDir}`);
                return SlotState.Acquired;
            }
            if (rc === 2) {
                this.logger.warn(
                    `Cannot create download lock '${lockDir}'.  Proceeding without download arbitration.`,
                );
                return SlotState.Unarbitrated;
            }

            // Lock is busy: wait, watching the holder's progress.
            this.logger.info(
                "Another instance is downloading this release.  Waiting for it to finish...",
            );
            let lastSignature = progressSignature(tempGlob);
            let ticks = 0;
            while (isDirectory(lockDir)) {
                if (isFile(releaseFile)) {
                    return SlotState.Cached;
                }
                const signature = progressSignature(tempGlob);
                if (signature !== lastSignature) {
                    lastSignature = signature;
                    ticks = 0;
                } else if (++ticks >= stallTicks) {
                    if (steals >= stealLimit) {
                        this.logger.error(
                            `Download lock '${lockDir}' is stalled and the steal limit (${stealLimit}) is reached.  Giving up.`,
                        );
                        return SlotState.GaveUp;
                    }
                    // Atomic rename claims the stale lock: exactly one
                    // waiter's rename succeeds, so two waiters can never both
                    // steal.  The random suffix keeps a leftover stale
                    // directory from turning this into a move-into-directory.
                    // Attempts count against the budget whether or not the
                    // rename succeeds: where it persistently fails (e.g. a
                    // sticky-bit cache directory) an uncounted failure would
                    // loop stall -> failed steal -> stall forever.
                    steals++;
                    const staleDir = `${lockDir}.stale.${this.id}-${Math.floor(Math.random() * 32768)}`;
                    try {
                        renameSync(lockDir, staleDir);
                        this.logger.warn(
                            `Download lock holder is not making progress.  Stole stale lock (steal ${steals}/${stealLimit}).`,
                        );
                        rmSync(staleDir, { recursive: true, force: true });
                    } catch {
                        this.logger.warn(
                            `Download lock holder is not making progress, and the stale lock could not be claimed (attempt ${steals}/${stealLimit}).`,
                        );
                    }
                    // Whether we, another waiter, or nobody claimed it, retry.
                    break;
                }
                await sleep(pollSeconds * 1000);
            }
            // Lock gone (released or stolen): loop and try again.
        }
    }
}
