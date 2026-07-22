/**
 * scripts/shared/markdown.ts
 *
 * Markdown-to-body conversion shared by the SSG markdown phase
 * (scripts/ssg/render_markdown.ts) and the dev markdown handler
 * (scripts/dev/render.ts). Keeps the Bun.markdown feature flags and the
 * doc-styling pass in lock-step so dev previews match the built output.
 *
 * Also expands `@include <path> [lang]` directives at ssg/dev time (see
 * expand_includes) so previews and builds inline the same file contents.
 *
 * (File/title resolution lives in scripts/ssg/markdown.ts.)
 */

import { extname, isAbsolute, resolve } from "path";

import { process_docs_markdown } from "$lib/markdown_docs";
import { markdown_styles } from "$root/src/lib/markdown_styles";
import { scan_md_blocks, stamp_md_html } from "$root/src/lib/inspector_stamp";

import { normalize_internal_page_links } from "./routing";

/**
 * Where an @include resolves relative paths from: the .md file's folder.
 * `stamp_file` (dev inspector only) is the project-root-relative path of the .md
 * source; when set, rendered block elements are stamped with data-md for the
 * inspector. Absent in the SSG build, so built output carries no stamps.
 */
export type IncludeContext = { source_dir: string; stamp_file?: string; };

// Map a file extension to a code-fence language for the web languages we document;
// anything else falls back to the bare extension so any highlight.js-known language works.
const lang_by_ext: Record<string, string> = {
	ree: "html",
	mjs: "js",
	cjs: "js",
	yml: "yaml",
	ps1: "powershell",
	sh: "bash",
	svg: "xml",
	md: "markdown",
};

function fence_lang_for(file_path: string): string {
	const raw_ext = extname(file_path).slice(1);
	const ext = raw_ext.toLowerCase();
	if (!ext) return "";
	return lang_by_ext[ext] ?? ext;
}

// Pick a backtick fence longer than any backtick run in the content, so a file that
// itself contains ``` fences (e.g. a markdown file) still nests cleanly (CommonMark).
function fence_for(content: string): string {
	const runs = content.match(/`+/g) ?? [];
	let longest = 0;
	for (const run of runs) {
		if (run.length > longest) longest = run.length;
	}
	const width = Math.max(3, longest + 1);
	return "`".repeat(width);
}

/**
 * Expand `@include <path> [lang]` directives (each on its own line) by inlining
 * the referenced file as a fenced code block, read at ssg/dev time. An absolute
 * path (e.g. C:\proj\lib\x.ts or /proj/lib/x.ts) is used as-is - includes routinely
 * come from sibling projects - while a relative path resolves against the .md file's
 * folder. `lang` overrides the fence language (else it is inferred from the
 * extension). Wrap a path containing spaces in double quotes. A missing file throws
 * - no silent empty block. Directives inside fenced code regions are left untouched
 * so the syntax can be documented literally.
 */
export async function expand_includes(markdown_body: string, ctx: IncludeContext): Promise<string> {
	const result = await expand_includes_tracked(markdown_body, ctx);
	return result.expanded;
}

/**
 * Like expand_includes, but also returns `host_line_for`: for each 0-based line
 * of the expanded output, the 1-based line in the original body it came from.
 * Lines synthesized from an @include (the wrapping fences + the file body) all
 * map to the @include directive's own host line. Used by the dev inspector to
 * stamp .md blocks with authored source lines despite expansion drift.
 */
export async function expand_includes_tracked(markdown_body: string, ctx: IncludeContext): Promise<{ expanded: string; host_line_for: number[]; }> {
	const lines = markdown_body.split("\n");
	const out: string[] = [];
	const host_line_for: number[] = [];

	let in_fence = false;
	let fence_char = "";

	for (let host_i = 0; host_i < lines.length; host_i++) {
		const line = lines[host_i] ?? "";
		const host_line = host_i + 1;

		// Track fenced code regions (``` or ~~~) so an example directive is not expanded.
		const fence_match = line.match(/^\s*(`{3,}|~{3,})/);
		if (fence_match) {
			const fence_marker = fence_match[1] ?? "";
			const char = fence_marker[0] ?? "`";
			if (!in_fence) {
				in_fence = true;
				fence_char = char;
			} else if (char === fence_char) {
				in_fence = false;
				fence_char = "";
			}
			out.push(line);
			host_line_for.push(host_line);
			continue;
		}

		const include_match = in_fence ? null : line.match(
			/^@include\s+(?:"([^"]+)"|(\S+))(?:\s+([\w-]+))?\s*$/
		);
		if (!include_match) {
			out.push(line);
			host_line_for.push(host_line);
			continue;
		}

		const raw_path = include_match[1] ?? include_match[2] ?? "";
		const lang_override = include_match[3];
		const full_path = isAbsolute(raw_path) ? resolve(raw_path) : resolve(
			ctx.source_dir,
			raw_path
		);

		const file = Bun.file(full_path);
		const exists = await file.exists();
		if (!exists) { throw new Error(`@include ${raw_path}: file not found (${full_path})`); }

		const content = await file.text();
		const body = content.replace(/\s+$/, "");
		const fence = fence_for(body);
		const lang = lang_override ?? fence_lang_for(full_path);
		// All synthesized lines (open fence, body lines, close fence) attribute to
		// the @include directive's own host line.
		const body_lines = body.split("\n");
		out.push(`${fence}${lang}`);
		host_line_for.push(host_line);
		for (const body_line of body_lines) {
			out.push(body_line);
			host_line_for.push(host_line);
		}
		out.push(fence);
		host_line_for.push(host_line);
	}

	return { expanded: out.join("\n"), host_line_for };
}

/** Convert a markdown body to styled HTML + extracted headings, expanding @include directives first. */
export async function render_markdown_body(markdown_body: string, include_ctx: IncludeContext): Promise<{ html: string; headings: ReturnType<typeof process_docs_markdown>["headings"]; }> {
	const expansion = await expand_includes_tracked(markdown_body, include_ctx);
	const expanded = expansion.expanded;
	const raw_html = Bun.markdown.html(expanded, {
		tables: true,
		strikethrough: true,
		tasklists: true,
		autolinks: { url: true, www: true, email: true },
		headings: { ids: true },
	});
	const processed = process_docs_markdown(raw_html, markdown_styles);
	const normalized_html = normalize_internal_page_links(processed.html);

	// Dev inspector only: stamp top-level blocks with their authored source line.
	if (!include_ctx.stamp_file) return { html: normalized_html, headings: processed.headings };

	const expanded_blocks = scan_md_blocks(expanded);
	const host_lines = expanded_blocks.map((block) => host_line_for_index(
		expansion.host_line_for,
		block.line
	));
	const stamped_html = stamp_md_html(normalized_html, include_ctx.stamp_file, host_lines);
	return { html: stamped_html, headings: processed.headings };
}

/** Map a 1-based expanded line to its 1-based host line via the tracked map. */
function host_line_for_index(host_line_for: number[], expanded_line: number): number {
	const idx = expanded_line - 1;
	const mapped = host_line_for[idx];
	return mapped ?? expanded_line;
}
