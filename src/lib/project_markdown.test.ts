import { describe, expect, test } from "bun:test";

import { markdown_styles } from "$root/src/lib/markdown_styles";
import { process_project_markdown } from "$root/src/lib/project_markdown";

describe("process_project_markdown", () => {
	test("uses the default classes for an unclassed image", () => {
		const raw_html = '<img src="/images/example.svg" alt="Example">';
		const processed = process_project_markdown(raw_html, markdown_styles);

		expect(processed.html).toContain(`class="${markdown_styles.img}"`);
	});

	test("merges authored image classes with authored conflicts taking precedence", () => {
		const raw_html = '<img src="/images/example.svg" alt="Example" class="max-w-48 border-0">';
		const processed = process_project_markdown(raw_html, markdown_styles);

		expect(processed.html).toContain(
			'class="block rounded-xl border-divider mb-6 max-w-48 border-0"'
		);
		expect(processed.html).not.toContain('class="block rounded-xl border border-divider');
	});
});
