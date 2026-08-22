/**
 * Markdown HTML post-processor (generic pipeline).
 *
 * Runs on the HTML Bun.markdown.html() produces:
 *   - Discovers heading ids (Bun's auto-ids), records text + level for the TOC.
 *   - Injects `data-intersect` markers on h2+ (consumed by the signals-ui
 *     bootstrap to drive the active-section signal).
 *   - Runs build-time syntax highlighting via highlight.js (no client JS needed).
 *   - Opens external links in a new tab.
 *   - Injects per-project CSS classes onto headings, code blocks, links, and
 *     common block tags - supplied via the `styles` argument.
 *
 * This file is the upstream-generic pipeline and carries NO project styling.
 * The project's Tailwind class strings live in `src/lib/markdown_styles.ts`
 * and are passed in by the caller; the default here is style-free (plain
 * semantic HTML), so the pipeline works standalone and stays upgradeable.
 *
 * Called from scripts/ssg.ts and scripts/dev.ts after Bun.markdown.html()
 * and before the resulting HTML is handed to the layout.
 */

import hljs from "$vendor/highlight.min";
import { register_ree_language } from "$lib/ree_language";

// Register the `.ree` template language so ```ree fenced code blocks in the
// docs highlight against the shared hljs singleton.
register_ree_language(hljs);

// REE template tokens: {= }, {~ }, {_ }, {- }, {# }, {: }, {/ }, {{ }}.
// Used to detect `.ree` markup inside blocks fenced as html/xml (or untagged),
// so docs blocks written as ```html still get REE tokens highlighted without
// re-tagging every block by hand.
const ree_token_pattern = /\{[=~_\-#/:]|\{\{/;

// HTML-ish fences that may actually hold `.ree` markup. Real HTML-only blocks
// stay `xml`; only blocks that contain REE tokens are promoted to `ree`.
const html_like_langs = new Set(["html", "xml", "ree"]);

/**
 * Choose the effective highlight language for a code block. Promotes an
 * html/xml/untagged block to `ree` when its body contains REE template tokens;
 * otherwise returns the original language unchanged.
 */
function resolve_code_language(lang: string, code: string): string {
	if (lang === "ree") return "ree";
	const is_html_like = lang === "" || html_like_langs.has(lang);
	if (is_html_like && ree_token_pattern.test(code)) return "ree";
	return lang;
}

export type Heading = { id: string; text: string; level: number; };

/**
 * CSS classes injected onto rendered markdown elements. Each value is the raw
 * contents of a `class="..."` attribute; an empty string omits the attribute
 * entirely. Override per project - see `src/lib/markdown_styles.ts`.
 */
export type MarkdownStyles = {
	/** class string for a heading of the given level (1–6) */
	heading: (level: number) => string;
	/** class string for the <pre> wrapper of code blocks */
	pre: string;
	/** class string for anchors */
	anchor: string;
	paragraph: string;
	inline_code: string;
	blockquote: string;
	ul: string;
	ol: string;
	li: string;
	/** class string for <img> elements */
	img: string;
	/** class string for the <table> element */
	table: string;
	/** class string for the wrapping <div> (when set, tables are wrapped) */
	table_wrapper: string;
	thead: string;
	tbody: string;
	th: string;
	td: string;
};

/** Neutral defaults: no classes - plain semantic HTML. Override per project. */
export const default_markdown_styles: MarkdownStyles = {
	heading: () => "",
	pre: "",
	anchor: "",
	paragraph: "",
	inline_code: "",
	blockquote: "",
	ul: "",
	ol: "",
	li: "",
	img: "",
	table: "",
	table_wrapper: "",
	thead: "",
	tbody: "",
	th: "",
	td: "",
};

function decode_entities(s: string): string {
	return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(
		/&quot;/g,
		"\""
	).replace(/&#39;/g, "'");
}

/** Build a ` class="..."` attribute fragment, or "" when there are no classes. */
function cls(value: string): string { return value ? ` class="${value}"` : ""; }

/** Replace a bare `<tag>` with `<tag class="...">`, leaving it untouched when empty. */
function inject_class(html: string, tag: string, value: string): string {
	if (!value) return html;
	return html.replaceAll(`<${tag}>`, `<${tag} class="${value}">`);
}

export function process_docs_markdown(raw_html: string, styles: MarkdownStyles = default_markdown_styles): { html: string; headings: Heading[]; } {
	let html = raw_html;
	const headings: Heading[] = [];

	// 1. Headings: collect for the TOC + inject classes and data-intersect.
	html = html.replace(/<h([1-6]) id="([^"]+)">([\s\S]*?)<\/h\1>/g, (_, level_str, id, inner) => {
		const level = parseInt(level_str, 10);
		const text = inner.replace(/<[^>]*>/g, "").trim();
		headings.push({ id, text, level });

		const class_attr = cls(styles.heading(level));
		const intersect = level > 1 ? ` data-intersect="${id}"` : "";

		return `<h${level} id="${id}"${class_attr}${intersect}>${inner}</h${level}>`;
	});

	// 2. Syntax-highlight code blocks server-side.
	html = html.replace(/<pre><code class="language-(\w+)">([\s\S]*?)<\/code><\/pre>/g, (_, fence_lang, encoded) => {
		const code = decode_entities(encoded);
		const lang = resolve_code_language(fence_lang, code);
		const highlighted = hljs.getLanguage(lang) ? hljs.highlight(code, {
			language: lang,
			ignoreIllegals: true,
		}).value : hljs.highlightAuto(code).value;
		return `<pre${cls(styles.pre)}><code class="hljs language-${lang}">${highlighted}</code></pre>`;
	});

	html = html.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (_, encoded) => {
		const code = decode_entities(encoded);
		const lang = resolve_code_language("", code);
		const highlighted = hljs.getLanguage(lang) ? hljs.highlight(code, {
			language: lang,
			ignoreIllegals: true,
		}).value : hljs.highlightAuto(code).value;
		const lang_attr = lang ? ` language-${lang}` : "";
		return `<pre${cls(styles.pre)}><code class="hljs${lang_attr}">${highlighted}</code></pre>`;
	});

	// 3. Anchors with href: inject classes + open external links in a new tab.
	html = html.replace(/<a href="([^"]+)"/g, (_, href) => {
		const external = /^https?:\/\//.test(href);
		const extra = external ? " target=\"_blank\" rel=\"noopener noreferrer\"" : "";
		return `<a${cls(styles.anchor)}${extra} href="${href}"`;
	});

	// 4. Inline element classes.
	html = inject_class(html, "p", styles.paragraph);
	html = inject_class(html, "code", styles.inline_code);
	html = inject_class(html, "blockquote", styles.blockquote);
	html = inject_class(html, "ul", styles.ul);
	html = inject_class(html, "ol", styles.ol);
	html = inject_class(html, "li", styles.li);

	// Images: <img> keeps its src/alt attributes, so it needs a class inserted
	// rather than the bare-tag swap `inject_class` does for p/ul/ol/li.
	if (styles.img) {
		html = html.replace(/<img /g, `<img class="${styles.img}" `);
	}

	// Tables: optionally wrap in a styled <div>; optionally class the <table>.
	if (styles.table_wrapper) {
		html = html.replaceAll("<table>", `<div class="${styles.table_wrapper}"><table${cls(
			styles.table
		)}>`);
		html = html.replaceAll("</table>", "</table></div>");
	} else {
		html = inject_class(html, "table", styles.table);
	}
	html = inject_class(html, "thead", styles.thead);
	html = inject_class(html, "tbody", styles.tbody);
	html = inject_class(html, "th", styles.th);
	html = inject_class(html, "td", styles.td);

	return { html, headings };
}
