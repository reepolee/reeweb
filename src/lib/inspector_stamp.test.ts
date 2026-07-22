/**
 * Tests for the dev inspector stamping functions.
 */

import { describe, expect, test } from "bun:test";

import { scan_md_blocks, stamp_md_html, stamp_ree_i18n, stamp_ree_source } from "./inspector_stamp";

describe("stamp_ree_source", () => {
	test("stamps block and interactive tags with file:line, skips text-inline tags", () => {
		const src = "<div class=\"x\">\n\t<h1>title</h1>\n\t<a href=\"/y\">link</a>\n\t<span>lbl</span>\n</div>";
		const out = stamp_ree_source(src, "src/public/p.ree");
		expect(out).toContain("<div data-ree=\"src/public/p.ree:1\"");
		expect(out).toContain("<h1 data-ree=\"src/public/p.ree:2\"");
		// <a> is interactive - now stamped so its class is editable.
		expect(out).toContain("<a data-ree=\"src/public/p.ree:3\"");
		// <span> is text-inline - still not stamped (high noise, rarely a style target).
		expect(out).not.toContain("<span data-ree");
	});

	test("stamps interactive/form tags (button, label, img, input, select, textarea)", () => {
		const src = "<button>a</button>\n<label>b</label>\n<img src=\"x\" />\n<input type=\"text\">\n<select></select>\n<textarea></textarea>";
		const out = stamp_ree_source(src, "f.ree");
		expect(out).toContain("<button data-ree=\"f.ree:1\"");
		expect(out).toContain("<label data-ree=\"f.ree:2\"");
		expect(out).toContain("<img data-ree=\"f.ree:3\"");
		expect(out).toContain("<input data-ree=\"f.ree:4\"");
		expect(out).toContain("<select data-ree=\"f.ree:5\"");
		expect(out).toContain("<textarea data-ree=\"f.ree:6\"");
	});

	test("does not stamp tags inside {{ }} raw-JS blocks", () => {
		const src = "<section>\n{{ const s = \"<div>literal</div>\"; }}\n<p>real</p>\n</section>";
		const out = stamp_ree_source(src, "f.ree");
		// The literal <div> inside {{ }} must be untouched.
		expect(out).toContain("\"<div>literal</div>\"");
		expect(out).not.toContain("<div data-ree");
		// Real blocks are stamped.
		expect(out).toContain("<section data-ree=\"f.ree:1\"");
		expect(out).toContain("<p data-ree=\"f.ree:3\"");
	});

	test("stamps <pre> itself but not tags inside its body", () => {
		const src = "<pre><code>\n<div>in code</div>\n</code></pre>";
		const out = stamp_ree_source(src, "f.ree");
		expect(out).toContain("<pre data-ree=\"f.ree:1\"");
		// <div> inside pre/code body is literal - not stamped.
		expect(out).not.toContain("<div data-ree");
	});

	test("stamps correct line for tags nested in directives", () => {
		const src = "<ul>\n{#each items as i}\n<li>x</li>\n{/each}\n</ul>";
		const out = stamp_ree_source(src, "f.ree");
		expect(out).toContain("<ul data-ree=\"f.ree:1\"");
		expect(out).toContain("<li data-ree=\"f.ree:3\"");
	});
});

describe("scan_md_blocks", () => {
	test("reports source line for each top-level block", () => {
		const md = ["# H", "", "para", "", "## H2", "", "- item"].join("\n");
		const blocks = scan_md_blocks(md);
		expect(blocks.map((b) => b.line)).toEqual([1, 3, 5, 7]);
	});

	test("treats a fenced code block as one block", () => {
		const md = ["text", "", "```js", "code", "more", "```", "", "after"].join("\n");
		const blocks = scan_md_blocks(md);
		// text(1), fence-open(3), after(8)
		expect(blocks.map((b) => b.line)).toEqual([1, 3, 8]);
	});
});

describe("stamp_md_html", () => {
	test("zips block lines onto output blocks in order", () => {
		const html = "<h1>H</h1>\n<p>para</p>\n<pre><code>x</code></pre>";
		const out = stamp_md_html(html, "src/public/docs/d.md", [1, 3, 5]);
		expect(out).toContain("<h1 data-md=\"src/public/docs/d.md:1\"");
		expect(out).toContain("<p data-md=\"src/public/docs/d.md:3\"");
		expect(out).toContain("<pre data-md=\"src/public/docs/d.md:5\"");
	});

	test("leaves extra output blocks unstamped rather than mis-attributing", () => {
		const html = "<h1>H</h1>\n<p>a</p>\n<p>b</p>";
		const out = stamp_md_html(html, "d.md", [1]);
		expect(out).toContain("<h1 data-md=\"d.md:1\"");
		// Only one line provided - second/third blocks not stamped.
		const count = (out.match(/data-md=/g) || []).length;
		expect(count).toBe(1);
	});
});

describe("stamp_ree_i18n", () => {
	test("wraps {_ } (escaped) with raw=0 and {- } (markup) with raw=1", () => {
		const src = "<h1>{_ ui.title}</h1>\n<div>{- ui.body}</div>";
		const out = stamp_ree_i18n(src, "src/public/p.ree");
		expect(out).toContain(
			"<span data-ree-i18n=\"ui.title\" data-ree-i18n-file=\"src/public/p.ree\" data-ree-i18n-raw=\"0\">{_ ui.title}</span>"
		);
		expect(out).toContain(
			"<span data-ree-i18n=\"ui.body\" data-ree-i18n-file=\"src/public/p.ree\" data-ree-i18n-raw=\"1\">{- ui.body}</span>"
		);
	});

	test("wraps {@ } (markdown) with raw=1 (edited as source in the dialog)", () => {
		const src = "<article>{@ docs.intro}</article>";
		const out = stamp_ree_i18n(src, "f.ree");
		expect(out).toContain(
			"<span data-ree-i18n=\"docs.intro\" data-ree-i18n-file=\"f.ree\" data-ree-i18n-raw=\"1\">{@ docs.intro}</span>"
		);
	});

	test("does not wrap a translation lookup used as an attribute value", () => {
		const src = "<confirm-dialog title=\"{_ ui.reset }\"></confirm-dialog>";
		const out = stamp_ree_i18n(src, "f.ree");
		// The attribute lookup must stay intact - wrapping a span there breaks the tag.
		expect(out).toContain("title=\"{_ ui.reset }\"");
		expect(out).not.toContain("data-ree-i18n=\"ui.reset\"");
	});

	test("does not wrap lookups inside {{ }} raw-JS", () => {
		const src = "{{ const s = \"{_ ui.x}\"; }}\n<p>{_ ui.y}</p>";
		const out = stamp_ree_i18n(src, "f.ree");
		expect(out).not.toContain("data-ree-i18n=\"ui.x\"");
		expect(out).toContain("data-ree-i18n=\"ui.y\"");
	});

	test("leaves non-translation braces untouched", () => {
		const src = "<p>{= props.name}</p>";
		const out = stamp_ree_i18n(src, "f.ree");
		expect(out).toBe(src);
	});
});
