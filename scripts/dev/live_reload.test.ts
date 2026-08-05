/**
 * Tests for live-reload client-script injection.
 */

import { describe, expect, test } from "bun:test";

import { inject_live_reload } from "./live_reload";

describe("inject_live_reload", () => {
	test("inserts the client script before </body>", async () => {
		const out = await inject_live_reload("<html><body><h1>Hi</h1></body></html>");
		expect(out).toContain("/__reload");
		expect(out.indexOf("/__reload")).toBeLessThan(out.indexOf("</body>"));
	});

	test("appends the script when there is no </body>", async () => {
		const out = await inject_live_reload("<h1>Hi</h1>");
		expect(out.startsWith("<h1>Hi</h1>")).toBe(true);
		expect(out).toContain("/__reload");
	});

	test("only injects the live-reload client once (first </body>)", async () => {
		const out = await inject_live_reload("<body></body>");
		// The live-reload client's function definition appears once per injection
		// (the inspector client also references /__reload, so a /__reload count
		// would double). This asserts the live-reload script itself isn't repeated.
		expect(out.match(/function connectLiveReload/g)?.length).toBe(1);
	});

	test("injects both the live-reload and inspector clients", async () => {
		const out = await inject_live_reload("<body></body>");
		expect(out.match(/<script>/g)?.length).toBe(2);
	});
});
