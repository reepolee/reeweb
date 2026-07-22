/**
 * Tests for the inspector translation write-back: file resolution + key write.
 * Uses a temp public dir fixture so no real translation file is touched.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { candidate_files, resolve_i18n_target, write_i18n_value } from "./i18n_write";

let pub: string;

beforeAll(async () => {
	pub = mkdtempSync(join(tmpdir(), "reeweb-i18n-"));
	// routes (root) file - tab-indented, matching the repo's real translation files.
	await Bun.write(join(pub, "en.json"), JSON.stringify({
		ui: { welcome: "Welcome" },
		nav: { home: "Home" },
	}, null, "\t") + "\n");
	// namespaced (about) file
	await Bun.write(
		join(pub, "about", "en.json"),
		JSON.stringify({ heading: "About us" }, null, "\t") + "\n"
	);
});

afterAll(() => rmSync(pub, { recursive: true, force: true }));

describe("candidate_files", () => {
	test("namespace file first, then routes file", () => {
		const files = candidate_files(pub, "about/index.ree", "en");
		expect(files[0]).toBe(join(pub, "about", "en.json"));
		expect(files[1]).toBe(join(pub, "en.json"));
	});

	test("root page only has the routes file", () => {
		const files = candidate_files(pub, "index.ree", "en");
		expect(files).toEqual([join(pub, "en.json")]);
	});
});

describe("resolve_i18n_target", () => {
	test("resolves a routes key from the root file", () => {
		const r = resolve_i18n_target(pub, "index.ree", "en", "ui.welcome");
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.file).toBe(join(pub, "en.json"));
			expect(r.current).toBe("Welcome");
		}
	});

	test("prefers the namespace file when it defines the key", () => {
		const r = resolve_i18n_target(pub, "about/index.ree", "en", "heading");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.file).toBe(join(pub, "about", "en.json"));
	});

	test("a missing key targets the most specific existing file", () => {
		const r = resolve_i18n_target(pub, "about/index.ree", "en", "brand_new");
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.file).toBe(join(pub, "about", "en.json"));
			expect(r.current).toBeUndefined();
		}
	});

	test("rejects an invalid key", () => {
		const r = resolve_i18n_target(pub, "index.ree", "en", "ui.a b");
		expect(r.ok).toBe(false);
	});
});

describe("write_i18n_value", () => {
	test("updates an existing key, preserving siblings", async () => {
		const w = await write_i18n_value(pub, "index.ree", "en", "ui.welcome", "Hi there");
		expect(w.ok).toBe(true);
		const json = await Bun.file(join(pub, "en.json")).json();
		expect(json.ui.welcome).toBe("Hi there");
		expect(json.nav.home).toBe("Home"); // untouched
	});

	test("creates a missing key", async () => {
		const w = await write_i18n_value(pub, "index.ree", "en", "ui.tagline", "Build fast");
		expect(w.ok).toBe(true);
		const json = await Bun.file(join(pub, "en.json")).json();
		expect(json.ui.tagline).toBe("Build fast");
	});

	test("writes a namespaced key into the namespace file", async () => {
		const w = await write_i18n_value(pub, "about/index.ree", "en", "heading", "About Reeweb");
		expect(w.ok).toBe(true);
		const ns = await Bun.file(join(pub, "about", "en.json")).json();
		expect(ns.heading).toBe("About Reeweb");
		// The routes file must not gain the key.
		const root = await Bun.file(join(pub, "en.json")).json();
		expect(root.heading).toBeUndefined();
	});

	test("preserves tab indentation instead of reformatting to spaces", async () => {
		await write_i18n_value(pub, "index.ree", "en", "ui.welcome", "Hi again");
		const text = await Bun.file(join(pub, "en.json")).text();
		expect(text).toContain('\n\t"ui"');
		expect(text).toContain('\n\t\t"welcome"');
		expect(text).not.toMatch(/\n {2}"ui"/);
	});

	test("preserves space indentation when the source file uses spaces", async () => {
		const space_file = join(pub, "space-lang.json");
		await Bun.write(space_file, JSON.stringify({ ui: { hello: "Hello" } }, null, 4) + "\n");
		await write_i18n_value(pub, "index.ree", "space-lang", "ui.hello", "Hi there");
		const text = await Bun.file(space_file).text();
		expect(text).toContain('\n    "ui"');
		expect(text).toContain('\n        "hello"');
	});
});
