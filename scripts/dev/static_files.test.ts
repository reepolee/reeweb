/**
 * Tests for generated-artifact detection and the not-built hint.
 * (find_static_file / find_dist_artifact hit the filesystem and are covered by
 * the dev-server smoke checks.)
 */

import { describe, expect, test } from "bun:test";

import { is_generated_artifact, not_built_hint } from "./static_files";

describe("is_generated_artifact", () => {
	test("sitemap and feeds are artifacts", () => {
		expect(is_generated_artifact("/sitemap.xml")).toBe(true);
		expect(is_generated_artifact("/blog/feed.xml")).toBe(true);
		expect(is_generated_artifact("/en/blog/feed.json")).toBe(true);
	});

	// The search index is built into dist/ like the sitemap, so dev has to serve
	// it from there too - otherwise the dialog 404s on every `bun dev` session.
	test("search indexes are artifacts, at the root and under a prefix", () => {
		expect(is_generated_artifact("/search-index.json")).toBe(true);
		expect(is_generated_artifact("/docs/search-index.json")).toBe(true);
	});

	test("regular paths are not artifacts", () => {
		expect(is_generated_artifact("/")).toBe(false);
		expect(is_generated_artifact("/about/")).toBe(false);
		expect(is_generated_artifact("/css/style.css")).toBe(false);
		expect(is_generated_artifact("/robots.txt")).toBe(false);
		expect(is_generated_artifact("/en.json")).toBe(false);
	});
});

describe("not_built_hint", () => test("names the requested artifact and the commands to build it", () => {
	const hint = not_built_hint("/sitemap.xml");
	expect(hint).toContain("/sitemap.xml");
	expect(hint).toContain("ssg");
}));
