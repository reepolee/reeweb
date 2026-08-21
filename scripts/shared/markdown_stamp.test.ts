/**
 * Regression: the SSG path (render_markdown_body without a stamp_file) must
 * emit zero inspector stamps, so built output stays clean. The dev path
 * (stamp_file set) does stamp.
 */

import { describe, expect, test } from "bun:test";

import { render_markdown_body } from "./markdown";

const md_body = ["# Heading", "", "A paragraph.", "", "## Sub"].join("\n");
const links_md_body = [
	"[Page](/docs/getting-started)",
	"[Query](/docs/getting-started?tab=install)",
	"[Fragment](/docs/getting-started#install)",
	"[Asset](/guide.pdf)",
	"[External](https://example.com/docs)",
].join("\n\n");

describe("render_markdown_body inspector gating", () => {
	test("SSG path (no stamp_file) emits no data-md", async () => {
		const { html } = await render_markdown_body(md_body, { source_dir: import.meta.dir });
		expect(html).not.toContain("data-md");
	});

	test("dev path (stamp_file set) stamps blocks", async () => {
		const { html } = await render_markdown_body(md_body, {
			source_dir: import.meta.dir,
			stamp_file: "src/public/docs/x.md",
		});
		expect(html).toContain("data-md=\"src/public/docs/x.md:1\"");
		expect(html).toContain("data-md=\"src/public/docs/x.md:3\"");
	});

	test("normalizes root-relative page links without changing assets or external links", async () => {
		const { html } = await render_markdown_body(links_md_body, { source_dir: import.meta.dir });
		expect(html).toContain('href="/docs/getting-started/"');
		expect(html).toContain('href="/docs/getting-started/?tab=install"');
		expect(html).toContain('href="/docs/getting-started/#install"');
		expect(html).toContain('href="/guide.pdf"');
		expect(html).toContain('href="https://example.com/docs"');
	});
});
