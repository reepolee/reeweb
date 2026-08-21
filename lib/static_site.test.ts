import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { collect_page_files, page_is_localized } from "$lib/static_site";

// ---------------------------------------------------------------------------
// page_is_localized
// ---------------------------------------------------------------------------

describe("page_is_localized", () => {
	test("defaults to true when the flag is absent", () => {
		expect(page_is_localized({})).toBe(true);
		expect(page_is_localized({ title: "Hello" })).toBe(true);
	});

	test("is true when localize is explicitly true", () => expect(page_is_localized({
		localize: true,
	})).toBe(true));

	test("is false only when localize is exactly false", () => expect(page_is_localized({
		localize: false,
	})).toBe(false));

	test("does not treat falsy-but-not-false values as opt-out", () => {
		// Guards against a `localize: 0` / `localize: ""` typo silently
		// de-localizing a page.
		expect(page_is_localized({ localize: 0 as unknown as boolean })).toBe(true);
		expect(page_is_localized({ localize: "" as unknown as boolean })).toBe(true);
		expect(page_is_localized({ localize: null as unknown as boolean })).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// collect_page_files
// ---------------------------------------------------------------------------

/** Build a throwaway public dir containing `files` (relative paths). */
function make_public_dir(files: readonly string[]): string {
	const dir = mkdtempSync(join(tmpdir(), "reeweb-collect-"));
	for (const rel of files) {
		const full = join(dir, rel);
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, "x");
	}
	return dir;
}

describe("collect_page_files", () => {
	test("skips layouts", () => {
		const dir = make_public_dir(["index.ree", "layout.ree", "academic.layout.ree"]);
		expect(collect_page_files(dir, ["en-us"]).sort()).toEqual(["index.ree"]);
	});

	test("collapses configured-locale variants onto one canonical entry", () => {
		const dir = make_public_dir(["about/index.en-us.ree", "about/index.sl-si.ree"]);
		expect(collect_page_files(dir, ["en-us", "sl-si"]).sort()).toEqual(["about/index.ree"]);
	});

	test("matches locale variants case-insensitively", () => {
		const dir = make_public_dir(["about/index.en-us.ree"]);
		expect(collect_page_files(dir, ["en-us"]).sort()).toEqual(["about/index.ree"]);
	});

	test("does not publish a variant for a locale the project does not build", () => {
		// Regression: `sl-si` absent from `locales` used to leave index.sl-si.ree
		// unmatched, publishing it as its own /about/index.sl-si/ route.
		const dir = make_public_dir(["about/index.en-us.ree", "about/index.sl-si.ree"]);
		expect(collect_page_files(dir, ["en-us"]).sort()).toEqual(["about/index.ree"]);
	});

	test("drops an unconfigured variant that sits beside a plain page", () => {
		const dir = make_public_dir(["localetest/index.ree", "localetest/index.sl-si.ree"]);
		expect(collect_page_files(dir, ["en-us"]).sort()).toEqual(["localetest/index.ree"]);
	});

	test("keeps a variant-shaped page that has no base sibling", () => {
		// `notes.io.ree` is a page named with a two-letter segment, not a
		// translation of `notes.ree` - it must still be published.
		const dir = make_public_dir(["notes.io.ree", "index.ree"]);
		expect(collect_page_files(dir, ["en-us"]).sort()).toEqual(["index.ree", "notes.io.ree"]);
	});

	test("honours the extensions filter", () => {
		const dir = make_public_dir(["index.ree", "post.md"]);
		expect(collect_page_files(dir, ["en-us"], ["ree"]).sort()).toEqual(["index.ree"]);
		expect(collect_page_files(dir, ["en-us"]).sort()).toEqual(["index.ree", "post.md"]);
	});
});
