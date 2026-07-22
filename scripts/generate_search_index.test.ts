import { describe, expect, test } from "bun:test";

import {
	apply_strip,
	extract_article,
	extract_main,
	html_to_text,
	page_records,
	pages_for,
	split_sections,
} from "./generate_search_index";

// ---------------------------------------------------------------------------
// html_to_text
// ---------------------------------------------------------------------------

describe("html_to_text", () => {
	test("strips tags and collapses whitespace", () => {
		expect(html_to_text("<p class=\"x\">Hello\n  <strong>world</strong></p>")).toBe("Hello world");
	});

	test("decodes entities", () => {
		expect(html_to_text("a &amp; b &lt;c&gt; &quot;d&quot;")).toBe("a & b <c> \"d\"");
	});

	test("drops script and style blocks wholesale", () => {
		expect(html_to_text("before<script>var x = \"gone\";</script>after")).toBe("before after");
		expect(html_to_text("a<style>.x{color:red}</style>b")).toBe("a b");
	});
});

// ---------------------------------------------------------------------------
// extract_article / extract_main
// ---------------------------------------------------------------------------

describe("extract_article", () => {
	test("returns the article-body inner HTML", () => {
		const html = "<main><div>banner</div><article class=\"article-body mx-auto\"><h1 id=\"t\">T</h1><p>body</p></article><div>footer</div></main>";
		expect(extract_article(html)).toBe("<h1 id=\"t\">T</h1><p>body</p>");
	});

	test("returns null when there is no article-body wrapper", () => {
		expect(extract_article("<main><p>landing page</p></main>")).toBeNull();
	});
});

describe("extract_main", () => {
	test("returns the main inner HTML", () => {
		expect(extract_main("<body><main class=\"x\"><p>hi</p></main></body>")).toBe("<p>hi</p>");
	});

	test("returns null without a main element", () => {
		expect(extract_main("<body><p>hi</p></body>")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// apply_strip
// ---------------------------------------------------------------------------

describe("apply_strip", () => {
	test("removes every occurrence of each configured fragment", () => {
		expect(apply_strip("a BANNER b BANNER c", ["BANNER"])).toBe("a b c");
	});

	test("collapses the whitespace left behind", () => {
		expect(apply_strip("keep  BANNER   this", ["BANNER"])).toBe("keep this");
	});

	test("is a no-op for an empty config", () => {
		expect(apply_strip("untouched text", [])).toBe("untouched text");
	});
});

// ---------------------------------------------------------------------------
// split_sections
// ---------------------------------------------------------------------------

const page = { url: "/docs/page", title: "Page Title" };

describe("split_sections", () => {
	test("splits at h1-h3 headings with ids and deep-links each section", () => {
		const body = "<h1 id=\"page\">Page Title</h1><p>intro text</p>" + "<h2 id=\"install\" class=\"y\" data-intersect=\"install\">Install</h2><p>run bun install</p>" + "<h3 id=\"flags\">Flags</h3><p>use --force</p>";
		const records = split_sections(body, page);

		expect(records.map((r) => r.anchor)).toEqual(["page", "install", "flags"]);
		expect(records[0]).toEqual({
			url: "/docs/page",
			anchor: "page",
			title: "Page Title",
			heading: "Page Title",
			text: "intro text",
		});
		expect(records[1]!.heading).toBe("Install");
		expect(records[1]!.text).toBe("run bun install");
	});

	test("keeps h4-h6 content inside the enclosing section", () => {
		const body = "<h2 id=\"a\">A</h2><p>one</p><h4 id=\"deep\">Deep</h4><p>two</p>";
		const records = split_sections(body, page);

		expect(records).toHaveLength(1);
		expect(records[0]!.text).toBe("one Deep two");
	});

	test("content before the first heading becomes an anchor-less lead", () => {
		const body = "<p>lead paragraph</p><h2 id=\"a\">A</h2><p>body</p>";
		const records = split_sections(body, page);

		expect(records[0]).toEqual({
			url: page.url,
			anchor: "",
			title: page.title,
			heading: page.title,
			text: "lead paragraph",
		});
	});

	test("drops an empty lead when the page starts with its h1", () => {
		const body = "<h1 id=\"t\">Page Title</h1><p>intro</p>";
		const records = split_sections(body, page);

		expect(records).toHaveLength(1);
		expect(records[0]!.anchor).toBe("t");
	});

	test("keeps text-less sections that have an addressable heading", () => {
		const body = "<h2 id=\"a\">A</h2><h2 id=\"b\">B</h2><p>b text</p>";
		const records = split_sections(body, page);

		expect(records.map((r) => r.anchor)).toEqual(["a", "b"]);
		expect(records[0]!.text).toBe("");
	});

	test("caps section text length", () => {
		const body = `<h2 id="a">A</h2><p>${"x".repeat(5000)}</p>`;
		const records = split_sections(body, page);
		expect(records[0]!.text.length).toBe(1500);
	});

	test("applies the strip list to every section", () => {
		const body = "<h2 id=\"a\">A</h2><p>keep CHROME me</p>";
		const records = split_sections(body, page, ["CHROME"]);
		expect(records[0]!.text).toBe("keep me");
	});
});

// ---------------------------------------------------------------------------
// page_records
// ---------------------------------------------------------------------------

describe("page_records", () => {
	test("prefers the article body when present", () => {
		const html = "<main><div>banner</div>" + "<article class=\"article-body\"><h1 id=\"t\">Page Title</h1><p>doc text</p></article></main>";
		const records = page_records(html, page, []);

		expect(records).toHaveLength(1);
		expect(records[0]!.text).toBe("doc text");
	});

	// ReeWeb renders markdown straight into <main> with heading ids and no
	// article wrapper, so sections have to come out of <main> too - otherwise
	// every page collapses to one undeep-linkable record.
	test("splits <main> into sections when there is no article wrapper", () => {
		const html = "<body><main><h1 id=\"t\">Page Title</h1><p>intro</p><h2 id=\"a\">A</h2><p>a text</p></main></body>";
		const records = page_records(html, page, []);

		expect(records.map((r) => r.anchor)).toEqual(["t", "a"]);
		expect(records[1]!.text).toBe("a text");
	});

	test("subtracts configured chrome from the indexed text", () => {
		const html = "<body><main><h1 id=\"t\">Page Title</h1><p>Ship fast. Cookie notice</p></main></body>";
		const records = page_records(html, page, ["Cookie notice"]);

		expect(records[0]!.text).toBe("Ship fast.");
	});

	test("returns no records when neither article nor main exists", () => {
		expect(page_records("<body><p>x</p></body>", page, [])).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// pages_for
// ---------------------------------------------------------------------------

describe("pages_for", () => {
	const files = ["index.ree", "about/index.ree", "docs/index.md", "docs/guide/setup.md"];

	test("a source without a prefix covers the whole site", () => {
		expect(pages_for({ prefix: "", brand: "" }, files)).toEqual(files);
	});

	test("a prefixed source takes its subtree plus its own landing page", () => {
		expect(pages_for({ prefix: "/docs", brand: "Docs" }, files)).toEqual([
			"docs/index.md",
			"docs/guide/setup.md",
		]);
	});

	test("an explicit root overrides the prefix", () => {
		expect(pages_for({ prefix: "/handbook", brand: "H", root: "docs" }, files)).toEqual([
			"docs/index.md",
			"docs/guide/setup.md",
		]);
	});
});
