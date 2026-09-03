import { afterEach, describe, expect, test } from "bun:test";

import { fetch_collection, fetch_record } from "./reepolee_api";

const servers: Bun.Server<undefined>[] = [];
const original_api_url = Bun.env.REEPOLEE_API_URL;

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.stop(true)));
	if (original_api_url === undefined) { delete Bun.env.REEPOLEE_API_URL; }
	else { Bun.env.REEPOLEE_API_URL = original_api_url; }
});

// Serve a canned response and record the Accept-Language of each request.
function start_server(handler: (req: Request) => Response): string[] {
	const seen_locales: string[] = [];
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			seen_locales.push(request.headers.get("Accept-Language") ?? "");
			return handler(request);
		},
	});
	servers.push(server);
	Bun.env.REEPOLEE_API_URL = `http://127.0.0.1:${server.port}`;
	return seen_locales;
}

describe("reepolee_api locale transport", () => {
	test("sends the locale as Accept-Language", async () => {
		const seen = start_server(() => Response.json({ data: [], total: 0, limit: 20, offset: 0 }));

		await fetch_collection("/team", "sl-si");

		expect(seen).toEqual(["sl-si"]);
	});

	test("fetch_record sends the locale too", async () => {
		const seen = start_server(() => Response.json({ id: 1 }));

		await fetch_record("/team", 1, "sl-si");

		expect(seen).toEqual(["sl-si"]);
	});

	test("rejects a missing locale before any request is made", async () => {
		const seen = start_server(() => Response.json({ data: [], total: 0, limit: 20, offset: 0 }));

		await expect(fetch_collection("/team", "")).rejects.toThrow(/locale is required/);
		expect(seen).toEqual([]);
	});

	test("rejects a malformed locale before any request is made", async () => {
		const seen = start_server(() => Response.json({ data: [], total: 0, limit: 20, offset: 0 }));

		await expect(fetch_collection("/team", "slovenian")).rejects.toThrow(/not a canonical lowercase BCP 47 locale/);
		expect(seen).toEqual([]);
	});

	// Reepolee answers an unsupported locale with a 400 naming what it serves.
	test("surfaces the server's locale rejection message", async () => {
		start_server(() => Response.json(
			{ error: "locale_required", message: "Accept-Language \"ja-jp\" matches no supported locale.", supported_locales: ["en-us", "sl-si"] },
			{ status: 400 },
		));

		const attempt = fetch_collection("/team", "ja-jp");

		await expect(attempt).rejects.toThrow(/matches no supported locale/);
		await expect(fetch_collection("/team", "ja-jp")).rejects.toThrow(/Supported: en-us, sl-si/);
	});

	test("fetch_record maps 404 to null", async () => {
		start_server(() => new Response("not found", { status: 404 }));

		const record = await fetch_record("/team", 99, "en-us");

		expect(record).toBeNull();
	});

	test("falls back to a plain message when the error body is not JSON", async () => {
		start_server(() => new Response("boom", { status: 500 }));

		await expect(fetch_collection("/team", "en-us")).rejects.toThrow(/reepolee API error 500/);
	});
});
