/**
 * Tests for the dev inspector class-attribute patcher (edit a plain HTML tag's
 * class in .ree source). Pure string transforms - no filesystem.
 */

import { describe, expect, test } from "bun:test";

import { patch_class_in_source, read_class_from_source } from "./class_write";

describe("read_class_from_source", () => {
	test("reads a literal class on the opening tag at the line", () => {
		const src = "<div class=\"a b\">\n\t<p>x</p>\n</div>";
		const r = read_class_from_source(src, 1, "div");
		expect(r).toEqual({ ok: true, value: "a b", has_attr: true });
	});

	test("reports has_attr false when the tag has no class", () => {
		const src = "<section id=\"hero\">\n</section>";
		const r = read_class_from_source(src, 1, "section");
		expect(r).toEqual({ ok: true, value: "", has_attr: false });
	});

	test("refuses a dynamic class value (contains a template tag)", () => {
		const src = "<div class=\"{= badge(x) }\">\n</div>";
		const r = read_class_from_source(src, 1, "div");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toContain("dynamic");
	});

	test("picks the tag matching the name when two tags share a line", () => {
		const src = "<div class=\"outer\"><p class=\"inner\">x</p></div>";
		expect(read_class_from_source(src, 1, "div")).toEqual({
			ok: true,
			value: "outer",
			has_attr: true,
		});
		expect(read_class_from_source(src, 1, "p")).toEqual({
			ok: true,
			value: "inner",
			has_attr: true,
		});
	});

	test("fails when no matching tag is found at the line", () => {
		const src = "<div>\n<p>x</p>\n</div>";
		const r = read_class_from_source(src, 2, "div");
		expect(r.ok).toBe(false);
	});
});

describe("patch_class_in_source", () => {
	test("replaces an existing literal class, preserving other attrs", () => {
		const src = "<div id=\"h\" class=\"old\" data-x=\"1\">\n</div>";
		const r = patch_class_in_source(src, 1, "div", "new one");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.source).toBe("<div id=\"h\" class=\"new one\" data-x=\"1\">\n</div>");
	});

	test("adds a class attribute when the tag has none", () => {
		const src = "<section id=\"hero\">\n</section>";
		const r = patch_class_in_source(src, 1, "section", "wide");
		expect(r.ok).toBe(true);
		// Inserted right after the tag name.
		if (r.ok) expect(r.source).toBe("<section class=\"wide\" id=\"hero\">\n</section>");
	});

	test("adds a class to a bare tag with no attributes", () => {
		const src = "<ul>\n<li>x</li>\n</ul>";
		const r = patch_class_in_source(src, 1, "ul", "list");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.source).toBe("<ul class=\"list\">\n<li>x</li>\n</ul>");
	});

	test("refuses to patch a dynamic class", () => {
		const src = "<div class=\"{= c }\">\n</div>";
		const r = patch_class_in_source(src, 1, "div", "static");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toContain("dynamic");
	});

	test("empty value on a tag with no class is a no-op success (nothing to remove)", () => {
		const src = "<div>\n</div>";
		const r = patch_class_in_source(src, 1, "div", "   ");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.source).toBe(src);
	});

	test("empty value removes an existing class attribute (and its leading space)", () => {
		const src = "<a href=\"/x\" class=\"btn\">t</a>";
		const r = patch_class_in_source(src, 1, "a", "");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.source).toBe("<a href=\"/x\">t</a>");
	});

	test("empty value removes a class that is the only attribute", () => {
		const src = "<div class=\"hero\">\n</div>";
		const r = patch_class_in_source(src, 1, "div", "  ");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.source).toBe("<div>\n</div>");
	});

	test("refuses to remove a dynamic class", () => {
		const src = "<div class=\"{= c }\">\n</div>";
		const r = patch_class_in_source(src, 1, "div", "");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toContain("dynamic");
	});

	test("patches only the tag on the given line, leaving same-name tags elsewhere", () => {
		const src = "<div class=\"a\">\n<p>x</p>\n</div>\n<div class=\"b\">\n</div>";
		const r = patch_class_in_source(src, 4, "div", "b2");
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.source).toContain("<div class=\"a\">");
			expect(r.source).toContain("<div class=\"b2\">");
		}
	});

	test("preserves single-quoted class delimiters", () => {
		const src = "<div class='old'>\n</div>";
		const r = patch_class_in_source(src, 1, "div", "new");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.source).toBe("<div class='new'>\n</div>");
	});
});
