/**
 * src/lib/inspector_stamp.ts
 *
 * Dev-only source stamping for the inspector. Two pure functions:
 *
 *   stamp_ree_source(src, file)  - inject data-ree="<file>:<line>" on block-level
 *                                  HTML tags in a raw .ree template, BEFORE the
 *                                  engine preprocesses it. Skips tags that live
 *                                  inside {{ }} raw-JS or raw-text element bodies.
 *
 *   stamp_md_html(html, blocks)  - inject data-md="<file>:<line>" on top-level
 *                                  block elements of rendered markdown HTML, by
 *                                  positional zip against a source-order block
 *                                  line list (see scan_md_blocks).
 *
 * Both stamps use the same "<project-root-relative-path>:<line>" convention so
 * the browser client (scripts/dev/inspector-client.js) resolves them with one
 * DOM walk-up, and so the /__ree_open path guard validates them against the
 * project root.
 *
 * Project code, dev-only: never invoked by the SSG pipeline, so built output
 * carries no stamps.
 */

// Tags that get stamped: block-level structure plus interactive/form elements
// (a, button, label, img, input, select, textarea) so their class is directly
// editable and they open in the editor. Pure text-inline tags (span, strong,
// em, code, br, ...) are deliberately excluded - high noise, rarely a style
// target - so a click on one resolves up to its nearest stamped ancestor.
const BLOCK_TAGS = new Set(
	[
		"section",
		"div",
		"article",
		"header",
		"footer",
		"nav",
		"main",
		"aside",
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"p",
		"ul",
		"ol",
		"li",
		"table",
		"thead",
		"tbody",
		"tr",
		"td",
		"th",
		"blockquote",
		"pre",
		"figure",
		"figcaption",
		"form",
		"fieldset",
		// Interactive / form elements - targetable for class editing.
		"a",
		"button",
		"label",
		"img",
		"input",
		"select",
		"textarea",
	],
);

// Elements whose BODY is raw text: a <tag> written inside them is literal, not a
// real element to stamp. The opening tag of these elements is still stamped (it
// sits outside its own body range).
const RAW_TEXT_TAGS = ["pre", "script", "code", "textarea", "style"];

// Opening tag matcher: <name ...attrs...> or <name .../>. Hyphen-free names only,
// so we never collide with the custom-element (ReeTag) rewrite the engine owns.
const OPEN_TAG_RE = /<([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

function line_of_offset(src: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset; i++) {
		if (src[i] === "\n") line++;
	}
	return line;
}

/**
 * Ranges of the source that must not be stamped: {{ ... }} raw-JS blocks and the
 * bodies (not opening tags) of raw-text elements.
 */
function ree_skip_ranges(src: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];

	const js_re = /\{\{[\s\S]*?\}\}/g;
	let js_match: RegExpExecArray | null;
	while ((js_match = js_re.exec(src)) !== null) {
		const start = js_match.index;
		const end = start + js_match[0].length;
		ranges.push([start, end]);
	}

	for (const tag of RAW_TEXT_TAGS) {
		const body_re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
		let body_match: RegExpExecArray | null;
		while ((body_match = body_re.exec(src)) !== null) {
			const open_end = body_match.index + body_match[0].indexOf(">") + 1;
			const close_len = `</${tag}>`.length;
			const body_end = body_match.index + body_match[0].length - close_len;
			ranges.push([open_end, body_end]);
		}
	}
	return ranges;
}

function in_any_range(pos: number, ranges: Array<[number, number]>): boolean {
	for (const [start, end] of ranges) {
		if (pos >= start && pos < end) return true;
	}
	return false;
}

/**
 * Stamp block-level tags in a raw .ree template with data-ree="<file>:<line>".
 * `file` is the project-root-relative source path (e.g. "src/public/index.ree").
 */
export function stamp_ree_source(src: string, file: string): string {
	const ranges = ree_skip_ranges(src);
	let out = "";
	let last = 0;
	OPEN_TAG_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = OPEN_TAG_RE.exec(src)) !== null) {
		const raw_name = match[1] ?? "";
		const tag_name = raw_name.toLowerCase();
		if (!BLOCK_TAGS.has(tag_name)) continue;

		const match_start = match.index;
		if (in_any_range(match_start, ranges)) continue;

		const line = line_of_offset(src, match_start);
		const name_end = match_start + 1 + raw_name.length;
		const stamp = ` data-ree="${file}:${line}"`;
		out += src.slice(last, name_end) + stamp;
		last = name_end;
	}
	out += src.slice(last);
	return out;
}

// Translation lookup in template output: {_ dotted.path} (escaped text),
// {- dotted.path} (raw/markup), or {@ dotted.path} (markdown). Restricted to a
// simple dotted path - the same shape the engine's emit_translation_lookup
// accepts - so we never wrap an arbitrary expression.
const I18N_LOOKUP_RE = /\{([_@-])\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\}/g;

/**
 * Wrap each {_ path}/{- path} translation lookup in a dev-only marker span so
 * the inspector can target the exact rendered string and offer in-place editing.
 * The span carries the key path; namespace + language are resolved server-side
 * from the page URL at edit time (they are not known at file-load time).
 *
 * Skips lookups inside {{ }} raw-JS, raw-text element bodies, and HTML attribute
 * values (wrapping a span inside an attribute would corrupt the tag). `file` is
 * the project-root-relative source path, echoed for convenience.
 */
export function stamp_ree_i18n(src: string, file: string): string {
	const skip = ree_skip_ranges(src);
	const attr_ranges = attribute_value_ranges(src);
	let out = "";
	let last = 0;
	I18N_LOOKUP_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = I18N_LOOKUP_RE.exec(src)) !== null) {
		const start = match.index;
		if (in_any_range(start, skip) || in_any_range(start, attr_ranges)) continue;

		const prefix = match[1] ?? "_";
		const key = match[2] ?? "";
		// {- } (markup) and {@ } (markdown) both edit as source in the dialog
		// (raw=1); {_ } (plain text) edits in place (raw=0).
		const raw_flag = prefix === "-" || prefix === "@" ? "1" : "0";
		const lookup = match[0];
		const wrapped = `<span data-ree-i18n="${key}" data-ree-i18n-file="${file}" data-ree-i18n-raw="${raw_flag}">${lookup}</span>`;
		out += src.slice(last, start) + wrapped;
		last = start + lookup.length;
	}
	out += src.slice(last);
	return out;
}

/**
 * Ranges covering the inside of double/single-quoted HTML attribute values, so a
 * translation lookup used as an attribute value (title="{_ ui.x}") is not wrapped
 * in a span. Only scans within opening tags.
 */
function attribute_value_ranges(src: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	const tag_re = /<[a-zA-Z][^>]*>/g;
	let tag_match: RegExpExecArray | null;
	while ((tag_match = tag_re.exec(src)) !== null) {
		const tag_start = tag_match.index;
		const tag_text = tag_match[0];
		const attr_re = /=\s*("([^"]*)"|'([^']*)')/g;
		let attr_match: RegExpExecArray | null;
		while ((attr_match = attr_re.exec(tag_text)) !== null) {
			const quoted = attr_match[1] ?? "";
			const value_start = tag_start + attr_match.index + attr_match[0].length - quoted.length;
			ranges.push([value_start, value_start + quoted.length]);
		}
	}
	return ranges;
}

export type MdBlock = { line: number; };

// Top-level block elements emitted by Bun.markdown.html(), in the order they can
// appear. We stamp the FIRST such opening tag of each output block, walking the
// scanned source lines in lockstep (positional zip). Nested elements (li, td,
// inline) attribute up to their block via the client's ancestor walk.
const MD_BLOCK_OPEN_RE = /<(h[1-6]|p|ul|ol|blockquote|pre|table|figure|hr)\b/gi;

/**
 * Stamp rendered markdown HTML with data-md="<file>:<line>" on each top-level
 * block, by positional zip against `block_lines` (source-order host lines from
 * scan_md_blocks, already mapped through @include offsets). Extra output blocks
 * beyond the scanned list (rare parser splits) are left unstamped rather than
 * mis-attributed.
 */
export function stamp_md_html(html: string, file: string, block_lines: number[]): string {
	let out = "";
	let last = 0;
	let block_index = 0;
	MD_BLOCK_OPEN_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = MD_BLOCK_OPEN_RE.exec(html)) !== null) {
		if (block_index >= block_lines.length) break;
		const line = block_lines[block_index];
		block_index++;
		if (line === undefined) continue;
		const tag_end = match.index + match[0].length;
		const stamp = ` data-md="${file}:${line}"`;
		out += html.slice(last, tag_end) + stamp;
		last = tag_end;
	}
	out += html.slice(last);
	return out;
}

/**
 * Scan (already @include-expanded) markdown for top-level block starts, in
 * source order, returning the host line for each. Line numbers account for
 * @include expansion drift via `line_offset_at` when supplied by the caller;
 * here we simply report the expanded-text line, and the caller maps it to the
 * host line (see scripts/shared/markdown.ts).
 */
export function scan_md_blocks(expanded_md: string): MdBlock[] {
	const lines = expanded_md.split("\n");
	const blocks: MdBlock[] = [];
	let in_fence = false;
	let fence_char = "";

	for (let i = 0; i < lines.length; i++) {
		const line_text = lines[i] ?? "";
		const trimmed = line_text.trim();

		const fence_match = trimmed.match(/^(`{3,}|~{3,})/);
		if (fence_match) {
			const fence_marker = fence_match[1] ?? "";
			const char = fence_marker[0] ?? "`";
			if (!in_fence) {
				in_fence = true;
				fence_char = char;
				blocks.push({ line: i + 1 });
			} else if (char === fence_char) {
				in_fence = false;
				fence_char = "";
			}
			continue;
		}
		if (in_fence) continue;
		if (trimmed === "") continue;

		const is_heading = /^#{1,6}\s/.test(trimmed);
		const is_blockquote = /^>/.test(trimmed);
		const is_list = /^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed);
		const is_table = /^\|/.test(trimmed);
		const prev = blocks.length > 0 ? blocks[blocks.length - 1] : null;

		// Merge consecutive lines of the same running block (blockquote/list/table/
		// paragraph) into the first line - top-level block granularity only.
		const is_continuation = prev != null && prev.line === i;
		if (is_heading) {
			blocks.push({ line: i + 1 });
		} else if (!is_continuation) {
			// blockquote / list / table / paragraph all open a block on the first line
			blocks.push({ line: i + 1 });
		}
	}
	return blocks;
}
