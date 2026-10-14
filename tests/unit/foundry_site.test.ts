import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { FoundrySession, selectAttributes } from "../../src/foundry_site.ts";
import { tmpDir } from "../helpers/tmp.ts";

/** A stand-in for the foundryvtt.com pages the client uses. */
function fakeSite(licenses: string[]) {
    let releaseFailures = 0;
    const server = Bun.serve({
        port: 0,
        async fetch(request) {
            const url = new URL(request.url);
            const cookies = request.headers.get("cookie") ?? "";
            if (url.pathname === "/" && request.method === "GET") {
                const welcome = cookies.includes("sessionid=s3cr3t")
                    ? '<div id="login-welcome"><a href="/community/MixedCase">Welcome</a></div>'
                    : "";
                return new Response(
                    `<html><form><input name="csrfmiddlewaretoken" value=" form-token "></form>${welcome}</html>`,
                    {
                        headers: {
                            "Set-Cookie": "csrftoken=cookie-token; Path=/",
                        },
                    },
                );
            }
            if (url.pathname === "/auth/login/" && request.method === "POST") {
                const form = await request.formData();
                const ok =
                    cookies.includes("csrftoken=cookie-token") &&
                    form.get("csrfmiddlewaretoken") === "form-token" &&
                    form.get("username") === "user@example.com" &&
                    form.get("password") === "hunter2";
                if (!ok) {
                    return new Response("<html>bad login</html>");
                }
                // Like the real site: set the session and redirect home.
                return new Response(null, {
                    status: 302,
                    headers: {
                        Location: "/",
                        "Set-Cookie": "sessionid=s3cr3t; Path=/; HttpOnly",
                    },
                });
            }
            if (url.pathname === "/community/mixedcase/licenses") {
                if (!cookies.includes("sessionid=s3cr3t")) {
                    return new Response("forbidden", { status: 403 });
                }
                const inputs = licenses
                    .map(
                        (key) =>
                            `<div class="license"><label class="copy"><input value="${key}"></label></div>`,
                    )
                    .join("");
                return new Response(`<html>${inputs}</html>`);
            }
            if (url.pathname === "/releases/download") {
                const build = url.searchParams.get("build");
                if (
                    build === "429" ||
                    (build === "500" && releaseFailures++ < 1)
                ) {
                    return new Response("slow down", { status: 429 });
                }
                const version =
                    url.searchParams.get("build") === "331"
                        ? "12.331"
                        : `13.${url.searchParams.get("build")}`;
                return Response.json({
                    url: `https://r2.example/releases/${version}/FoundryVTT-Node-${version}.zip?verify=x`,
                    lifetime: 300,
                });
            }
            return new Response("not found", { status: 404 });
        },
    });
    return server;
}

describe("FoundrySession", () => {
    let server: ReturnType<typeof Bun.serve>;
    let baseUrl: string;
    beforeAll(() => {
        server = fakeSite(["AAAA-BBBB-CCCC", "DDDD-EEEE-FFFF"]);
        baseUrl = `http://localhost:${server.port}`;
    });
    afterAll(() => server.stop(true));

    async function loggedIn() {
        const session = new FoundrySession({ baseUrl });
        await session.login("user@example.com", "hunter2");
        return session;
    }

    test("login resolves the lowercased username", async () => {
        const session = await loggedIn();
        expect(session.username).toBe("mixedcase");
    });

    test("bad credentials are rejected", async () => {
        const session = new FoundrySession({ baseUrl });
        await expect(
            session.login("user@example.com", "wrong"),
        ).rejects.toThrow(/verify your credentials/);
    });

    test("licenses are listed without dashes", async () => {
        expect(await (await loggedIn()).licenses()).toEqual([
            "AAAABBBBCCCC",
            "DDDDEEEEFFFF",
        ]);
    });

    test("license selection by index, clamped, or random", async () => {
        const session = await loggedIn();
        expect(await session.license("2")).toBe("DDDDEEEEFFFF");
        expect(await session.license("9")).toBe("DDDDEEEEFFFF");
        expect(await session.license("-3")).toBe("AAAABBBBCCCC");
        expect(await session.license(undefined, () => 0.99)).toBe(
            "DDDDEEEEFFFF",
        );
    });

    test("the session survives a save/load round trip", async () => {
        const file = `${tmpDir()}/cookiejar.json`;
        (await loggedIn()).save(file);
        const restored = FoundrySession.load(file, { baseUrl });
        expect(restored.username).toBe("mixedcase");
        expect(await restored.licenses()).toHaveLength(2);
    });

    test("release URL for a matching version", async () => {
        expect(await (await loggedIn()).releaseUrl("13.351")).toContain(
            "13.351",
        );
    });

    test("a build belonging to another generation is rejected (#1051)", async () => {
        await expect((await loggedIn()).releaseUrl("11.331")).rejects.toThrow(
            /belongs to Foundry Virtual Tabletop 12.331/,
        );
    });

    test("retries after an error status", async () => {
        const session = await loggedIn();
        expect(await session.releaseUrl("13.500", 1, 0)).toContain("13.500");
    });

    test("gives up when retries are exhausted", async () => {
        const session = await loggedIn();
        await expect(session.releaseUrl("13.429", 1, 0)).rejects.toThrow(
            "Failed to fetch release URL.",
        );
    });
});

test("selectAttributes returns every match in document order", () => {
    const html = '<p><a href="1"></a><span><a href="2"></a></span><a></a></p>';
    expect(selectAttributes(html, "p a", "href")).toEqual(["1", "2"]);
});
