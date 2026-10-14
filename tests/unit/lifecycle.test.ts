import { describe, expect, test } from "bun:test";

import { exitStatus, runChild } from "../../src/lifecycle.ts";
import { isWindows } from "../helpers/tmp.ts";

const BUN = process.execPath;

test("exitStatus maps signals to 128 + number", () => {
    expect(exitStatus({ exitCode: 3, signalCode: null })).toBe(3);
    expect(exitStatus({ exitCode: null, signalCode: "SIGKILL" })).toBe(137);
    expect(exitStatus({ exitCode: null, signalCode: "SIGTERM" })).toBe(143);
});

test("a clean exit reports 0", async () => {
    expect(await runChild([BUN, "-e", "process.exit(0)"])).toBe(0);
});

test("a nonzero exit is reported unchanged", async () => {
    expect(await runChild([BUN, "-e", "process.exit(7)"])).toBe(7);
});

describe.skipIf(isWindows)("signals", () => {
    test("a signal-killed child reports 128 + signal", async () => {
        expect(await runChild(["bash", "-c", "kill -KILL $$"])).toBe(137);
    });

    test("SIGTERM is forwarded and the parent waits for the child's shutdown", async () => {
        // A parent that forwards TERM to a child needing time to clean up
        // (Foundry flushing data) must report the child's real exit code
        // only after the child is done — not the 143 of an interrupted wait.
        const parent = `
            import { runChild } from ${JSON.stringify(`${import.meta.dir}/../../src/lifecycle.ts`)};
            const code = await runChild(
                ["bash", "-c", 'trap "sleep 1; echo child-done; exit 5" TERM; echo child-ready; sleep 30 >/dev/null 2>&1 & wait $!'],
                { forward: ["SIGTERM"] },
            );
            console.log("parent-saw=" + code);
            process.exit(code);
        `;
        const proc = Bun.spawn([BUN, "-e", parent], {
            stdout: "pipe",
            stderr: "pipe",
        });
        const reader = proc.stdout.getReader();
        let stdout = "";
        const decoder = new TextDecoder();
        while (!stdout.includes("child-ready")) {
            const { value, done } = await reader.read();
            if (done) break;
            stdout += decoder.decode(value);
        }
        proc.kill("SIGTERM");
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            stdout += decoder.decode(value);
        }
        await proc.exited;
        expect(stdout).toContain("child-done");
        expect(stdout).toContain("parent-saw=5");
        expect(stdout.indexOf("child-done")).toBeLessThan(
            stdout.indexOf("parent-saw=5"),
        );
        expect(proc.exitCode).toBe(5);
    });
});
