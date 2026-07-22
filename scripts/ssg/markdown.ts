/**
 * scripts/ssg/markdown.ts
 *
 * Markdown source resolution helpers: language-variant file lookup and
 * title extraction. Kept free of rendering concerns so they can be
 * exercised against a fixture folder in isolation.
 */

import { existsSync } from "fs";
import { join } from "path";

import { parse_frontmatter } from "$lib/static_site";

/**
 * Resolve the most specific .md file for a given language with fallback chain:
 *   {name}.{lang}.md → {name}.{default_lang}.md → {name}.md
 * Returns the file content and resolved relative path, or null if none found.
 */
export async function resolve_md_file(base_rel_path: string, lang: string, default_language: string, public_dir: string): Promise<{ content: string; resolved_path: string; } | null> {
	const name_without_ext = base_rel_path.replace(/\.md$/, "");
	const candidates = [
		`${name_without_ext}.${lang}.md`,
		`${name_without_ext}.${default_language}.md`,
		base_rel_path,
	];

	for (const candidate of candidates) {
		const full_path = join(public_dir, candidate);
		if (existsSync(full_path)) {
			const content = await Bun.file(full_path).text();
			return { content, resolved_path: candidate };
		}
	}

	return null;
}

/**
 * Extract a page title from markdown content.
 * Checks frontmatter.title first, then first # Heading.
 */
export function extract_md_title(content: string): string {
	const { data: frontmatter, body } = parse_frontmatter(content);
	if (frontmatter.title) return String(frontmatter.title);

	const h1_match = body.match(/^#\s+(.+)$/m);
	if (h1_match?.[1]) return h1_match[1].trim();

	return "Untitled";
}
