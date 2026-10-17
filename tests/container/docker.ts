/** Helpers for driving the image under test with the docker CLI. */

import { readFileSync } from "node:fs";

export const PROJECT_VERSION = readFileSync("src/version.txt", "utf8").trim();
/** The image under test; defaults to the tag `bun run image` builds. */
export const IMAGE =
    process.env.IMAGE_TAG || `ghcr.io/felddy/foundryvtt:${PROJECT_VERSION}`;
export const FOUNDRY_VERSION = PROJECT_VERSION.split(".").slice(0, 2).join(".");
export const READY_MESSAGE = "Server started and listening on port";

const REDACTIONS = [
    // AWS S3 pre-signed URL
    /AWSAccessKeyId=(.*?)&Signature=(.*?)&/g,
    // Cloudflare R2 pre-signed URL
    /\?verify=([0-9]+-[a-zA-Z0-9%]+)/g,
];

/** Mask credentials embedded in presigned URLs. */
export function redact(text: string): string {
    let result = text;
    for (const regex of REDACTIONS) {
        result = result.replace(regex, (match, ...groups: unknown[]) => {
            let masked = match;
            for (const group of groups) {
                if (typeof group === "string" && group) {
                    masked = masked.replace(group, "*".repeat(group.length));
                }
            }
            return masked;
        });
    }
    return result;
}

export interface Result {
    code: number;
    stdout: string;
    stderr: string;
}

export async function docker(...args: string[]): Promise<Result> {
    const proc = Bun.spawn(["docker", ...args], {
        stdout: "pipe",
        stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    return { code: await proc.exited, stdout, stderr };
}

/** `--user` arguments matching the test runner, so bind mounts are writable. */
export function userArgs(): string[] {
    const uid = process.getuid?.();
    const gid = process.getgid?.();
    return uid === undefined || gid === undefined
        ? []
        : ["--user", `${uid}:${gid}`];
}

/** Poll a container's logs until `predicate` matches or it stops logging. */
export async function waitForLog(
    name: string,
    predicate: (logs: string) => boolean,
    { quietTimeoutMs = 60_000, print = false } = {},
): Promise<string> {
    let lastLength = -1;
    let lastChange = Date.now();
    for (;;) {
        const { stdout, stderr } = await docker("logs", name);
        const logs = stdout + stderr;
        if (logs.length !== lastLength) {
            if (print) {
                process.stdout.write(
                    redact(logs.slice(Math.max(lastLength, 0))),
                );
            }
            lastLength = logs.length;
            lastChange = Date.now();
        }
        if (predicate(logs)) {
            return logs;
        }
        const state = (
            await docker("inspect", "--format", "{{.State.Status}}", name)
        ).stdout.trim();
        if (state !== "running" && state !== "created") {
            throw new Error(
                `Container ${name} is ${state}.  Logs:\n${redact(logs)}`,
            );
        }
        if (Date.now() - lastChange > quietTimeoutMs) {
            throw new Error(
                `Container ${name} logged nothing for ${quietTimeoutMs}ms.  Logs:\n${redact(logs)}`,
            );
        }
        await Bun.sleep(1000);
    }
}

export const uniqueName = (prefix: string) =>
    `${prefix}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
