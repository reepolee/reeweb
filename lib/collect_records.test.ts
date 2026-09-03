import { describe, expect, test } from "bun:test";

import { extract_description, is_index_file, route_record_files } from "$lib/collect_records";

describe("extract_description - frontmatter alias precedence", () => {
	test("description wins over excerpt/summary/abstract", () => expect(extract_description({
		description: "D",
		excerpt: "E",
		summary: "S",
		abstract: "A",
	}, "body")).toBe("D"));

	test("excerpt is used when description is absent", () => expect(extract_description({
		excerpt: "E",
		summary: "S",
	}, "body")).toBe("E"));

	test("falls back to the first body paragraph when no alias is set", () => expect(extract_description(
		{},
		"First paragraph here.\n\nSecond."
	)).toBe("First paragraph here."));
});

describe("route_record_files", () => {
	const files = [
		"blog/index.md", // route listing index → excluded
		"blog/01_index.md", // ordered listing index → excluded
		"blog/02_flat-post.md", // flat post → record
		"blog/my-post/index.md", // folder-per-post → record
		"blog/2024/march/post/index.md", // deeply nested folder-post → record
		"blog/notes/index.ree", // not markdown → ignored
		"docs/01_index.md", // different route → ignored
		"blog.md", // not under the route prefix → ignored
	];

	const got = route_record_files("blog", files);

	test("keeps flat posts and nested folder-per-post indexes", () => {
		expect(got).toContain("blog/02_flat-post.md");
		expect(got).toContain("blog/my-post/index.md");
		expect(got).toContain("blog/2024/march/post/index.md");
	});

	test("excludes the route's own listing index (incl. ordered)", () => {
		expect(got).not.toContain("blog/index.md");
		expect(got).not.toContain("blog/01_index.md");
	});

	test("ignores non-markdown, other routes, and prefix look-alikes", () => {
		expect(got).not.toContain("blog/notes/index.ree");
		expect(got).not.toContain("docs/01_index.md");
		expect(got).not.toContain("blog.md");
	});
});

describe("is_index_file", () => test("matches index.md and ordered index by basename", () => {
	expect(is_index_file("index.md")).toBe(true);
	expect(is_index_file("01_index.md")).toBe(true);
	expect(is_index_file("my-post.md")).toBe(false);
}));
