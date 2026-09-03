/**
 * HTML → plain-text extraction for search indexing.
 *
 * Turns a rendered page's HTML into heading-delimited plain-text sections
 * (SearchRecord), so each section can be matched and deep-linked separately.
 */

/** One searchable unit: a heading-delimited section of a rendered page. */
export interface SearchRecord {
	/** Canonical page URL, e.g. "/docs/translations". */
	url: string;
	/** Heading id for deep links ("" for content without an addressable heading). */
	anchor: string;
	/** Page title (shared by every record of the page). */
	title: string;
	/** Section heading text (equals `title` for the lead section). */
	heading: string;
	/** Plain-text section body, capped at MAX_SECTION_CHARS. */
	text: string;
}

/** Cap per-section text: plenty for matching + snippets, keeps the JSON small. */
const MAX_SECTION_CHARS = 1500;

function decode_entities(s: string): string {
	return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(
		/&quot;/g,
		"\""
	).replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ");
}

/** Strip tags and collapse whitespace, keeping the human-readable text. */
export function html_to_text(html: string): string {
	const without_blocks = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ");
	const without_tags = without_blocks.replace(/<[^>]+>/g, " ");
	return decode_entities(without_tags).replace(/\s+/g, " ").trim();
}

/**
 * The rendered markdown body of a page (scripts/ssg/render_markdown.ts wraps it
 * in <article class="article-body ...">). Returns null for pages without one,
 * such as `.ree` landing pages.
 */
export function extract_article(html: string): string | null {
	const start_match = html.match(/<article class="article-body[^"]*"[^>]*>/);
	if (!start_match || start_match.index === undefined) return null;

	const start = start_match.index + start_match[0].length;
	const end = html.lastIndexOf("</article>");
	if (end <= start) return null;

	return html.slice(start, end);
}

/** The <main> element's inner HTML, or null. Fallback for non-markdown pages. */
export function extract_main(html: string): string | null {
	const start_match = html.match(/<main[^>]*>/);
	if (!start_match || start_match.index === undefined) return null;

	const start = start_match.index + start_match[0].length;
	const end = html.indexOf("</main>", start);
	if (end === -1) return null;

	return html.slice(start, end);
}

const HEADING_RE = /<h([1-6]) id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g;

/**
 * Split rendered body HTML into section records at h1-h3 boundaries (Bun's
 * markdown renderer gives every heading an id, so each section deep-links via
 * its anchor). h4-h6 text stays inside the enclosing section. Content before
 * the first heading becomes an anchor-less lead section.
 */
export function split_sections(
	body_html: string,
	page: { url: string; title: string; },
	strip: readonly string[] = [],
): SearchRecord[] {
	interface Cut { index: number; end: number; anchor: string; heading: string; }
	const cuts: Cut[] = [];

	HEADING_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = HEADING_RE.exec(body_html)) !== null) {
		const level = parseInt(m[1]!, 10);
		if (level > 3) continue;
		cuts.push({
			index: m.index,
			end: m.index + m[0].length,
			anchor: m[2]!,
			heading: html_to_text(m[3]!),
		});
	}

	const records: SearchRecord[] = [];

	function push(anchor: string, heading: string, html: string) {
		const text = apply_strip(html_to_text(html), strip).slice(0, MAX_SECTION_CHARS);
		// Text-less sections are only worth keeping when their heading is
		// addressable (an empty lead before the first h1 would duplicate the title).
		if (!text && !anchor) return;
		records.push({ url: page.url, anchor, title: page.title, heading, text });
	}

	const lead_end = cuts.length > 0 ? cuts[0]!.index : body_html.length;
	push("", page.title, body_html.slice(0, lead_end));

	for (let i = 0; i < cuts.length; i++) {
		const cut = cuts[i]!;
		const next = cuts[i + 1];
		push(cut.anchor, cut.heading, body_html.slice(cut.end, next ? next.index : body_html.length));
	}

	return records;
}

/** Remove repeated page chrome (config `strip`) from an extracted string. */
export function apply_strip(text: string, strip: readonly string[]): string {
	let out = text;
	for (const fragment of strip) {
		if (fragment) out = out.split(fragment).join(" ");
	}
	return out.replace(/\s+/g, " ").trim();
}

/**
 * Records for one rendered page, split per heading so results deep-link to the
 * section that matched.
 *
 * Prefers the markdown <article class="article-body"> wrapper when a project
 * renders one, and otherwise indexes <main> directly - both carry the heading
 * ids that `split_sections` cuts on. Pages with no headings collapse to a
 * single whole-page record.
 */
export function page_records(
	html: string,
	page: { url: string; title: string; },
	strip: readonly string[],
): SearchRecord[] {
	const body = extract_article(html) ?? extract_main(html);
	if (body === null) return [];

	return split_sections(body, page, strip);
}
