/**
 * ── Project-specific helpers ─────────────────────────────────
 *
 * The top-level `lib/` folder mirrors the upstream `reeweb` library and
 * should NOT be modified directly. Changes there make it harder to
 * pull in upstream fixes, features, or structural updates.
 *
 * Instead, put any project-specific helpers, utilities, overrides,
 * or glue code in this file. If you need to customize behaviour
 * that currently lives in `lib/`, either:
 *
 *   1. Add a new helper here and call it from your templates/scripts.
 *   2. Propose the change upstream so everyone benefits.
 *
 * This keeps upgrades smooth and the diff against upstream clean.
 */

import { process_docs_markdown } from "$lib/markdown_docs";
import { markdown_styles } from "$root/src/lib/markdown_styles";

// ---------------------------------------------------------------------------
// Inline markdown
// ---------------------------------------------------------------------------

/**
 * Render a short string of inline markdown to HTML.
 * Converts literal `\n` to actual newlines before rendering since .ree
 * template strings escape backslashes ("\n" in .ree → `\n` as text).
 * Supports **bold**, [text](url), <br>, inline HTML and emoji.
 */
export function md(text: string): string {
	if (!text) return "";
	// .ree template strings use double-escaped \n - convert to real newlines
	const normalized = String(text).replace(/\\\\n/g, "\n");
	return Bun.markdown.html(normalized, {
		tables: true,
		strikethrough: true,
		autolinks: { url: true, www: true, email: true },
	});
}

/**
 * Strip the common leading indentation off every line. `<md-text type="code">`
 * blocks sit inside indented .ree markup, so the fence and its content inherit
 * that indentation verbatim - left as-is, the indentation shows up as literal
 * whitespace in the rendered code, and a tab-indented closing fence can be
 * indented enough (CommonMark treats a tab as a 4-space stop) that it no
 * longer counts as a valid fence closer and gets swallowed as code content.
 */
function dedent(text: string): string {
	const lines = text.split("\n");
	// The opening/closing fence markers are unreliable as an indentation
	// reference: reettier sometimes puts the opener flush against the tag
	// (0 indent) and sometimes on its own indented line, depending on
	// surrounding formatting. The body lines between them are always
	// indented consistently, so measure only those.
	const non_blank_indices = lines.map((_, i) => i).filter((i) => lines[i]!.trim() !== "");
	const body_indices = non_blank_indices.slice(1, -1);
	const measured = body_indices.length > 0 ? body_indices : non_blank_indices;

	let min_indent = Infinity;
	for (const i of measured) {
		const match = lines[i]!.match(/^[\t ]*/);
		min_indent = Math.min(min_indent, match ? match[0].length : 0);
	}
	if (!Number.isFinite(min_indent) || min_indent === 0) return text.trim();
	return lines.map((line) => {
		const match = line.match(/^[\t ]*/);
		const leading = match ? match[0].length : 0;
		return line.slice(Math.min(leading, min_indent));
	}).join("\n").trim();
}

/**
 * Render markdown through the same pipeline real .md doc pages use
 * (Bun.markdown.html + process_docs_markdown/markdown_styles), so fenced code
 * blocks written inside a .ree file get the identical server-side hljs
 * highlighting and heading/link/table styling as a .md page - .ree pages have
 * no client-side highlighter, so plain `hljs language-x` classes are inert
 * without running content through this same filter.
 */
export function md_code(text: string): string {
	if (!text) return "";
	const normalized = dedent(String(text).replace(/\\\\n/g, "\n"));
	const raw_html = Bun.markdown.html(normalized, {
		tables: true,
		strikethrough: true,
		tasklists: true,
		autolinks: { url: true, www: true, email: true },
		headings: { ids: true },
	});
	return process_docs_markdown(raw_html, markdown_styles).html;
}

// ---------------------------------------------------------------------------
// Project helpers object for template injection
// ---------------------------------------------------------------------------

/**
 * Object of project-specific helper functions to merge into template helpers
 * via `create_template_helpers(data, project_helper_functions)`.
 */
export const project_helper_functions: Record<string, unknown> = { md, md_code };
