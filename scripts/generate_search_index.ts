#!/usr/bin/env bun

/**
 * scripts/generate_search_index.ts
 *
 * Emits a static search index per configured source (config/search.ts) by
 * walking the rendered HTML in dist/. Each index is a flat list of
 * section-level records ({ url, anchor, title, heading, text }) that the
 * client-side fuzzy search (src/public/js/site-search.js) fetches on first use
 * of the Cmd/Ctrl+K dialog. No external dependencies, and no separate crawl:
 * the index reflects exactly what the static build rendered.
 *
 * Like sitemap/rss, the output lands in dist/ and is served by the dev server
 * as a previously-built artifact (scripts/dev/static_files.ts), so search works
 * in dev after a `bun ssg` (or `bun ssg:search`).
 *
 * Usage:
 *   bun scripts/generate_search_index.ts --public ./src/public --dist ./dist
 *   bun scripts/generate_search_index.ts --help
 *
 * Visibility follows the sitemap rules: drafts, future-dated pages, and
 * `noindex: true` pages are rendered but excluded. Only the default language is
 * indexed.
 */

import { existsSync } from "fs";
import { join, resolve } from "path";

import { search, type SearchSource } from "$config/search";
import { active_languages, default_language } from "$config/supported_languages";
import { resolve_visibility } from "$lib/content_visibility";
import { without_draft_pages } from "$lib/draft_pages";
import { load_all_translations } from "$lib/i18n";
import {
	build_static_route_map,
	collect_page_files,
	read_frontmatter,
	template_to_canonical,
} from "$lib/static_site";
import { project_hooks } from "$root/src/lib/project_hooks";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function print_usage() {
	console.error("Usage: bun scripts/generate_search_index.ts [options]");
	console.error("");
	console.error("Options:");
	console.error("  --public <dir>   Source directory with page templates (default: ./src/public)");
	console.error("  --dist <dir>     Rendered site; indexes are written under it (default: ./dist)");
	console.error("  --help           Print this usage and exit");
}

function parse_args() {
	const args = process.argv.slice(2);

	if (args.includes("--help")) {
		print_usage();
		process.exit(0);
	}

	let public_dir = "./src/public";
	let dist_dir = "./dist";

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg) continue;

		if (arg === "--public") {
			public_dir = args[++i] ?? public_dir;
		} else if (arg === "--dist") {
			dist_dir = args[++i] ?? dist_dir;
		}
	}

	return { public_dir: resolve(public_dir), dist_dir: resolve(dist_dir) };
}

// ---------------------------------------------------------------------------
// HTML → plain-text extraction
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Page → title
// ---------------------------------------------------------------------------

function title_for(html: string, frontmatter: Record<string, unknown>, canonical: string): string {
	const fm_title = frontmatter.title;
	if (typeof fm_title === "string" && fm_title.trim()) return fm_title.trim();

	const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
	if (h1) {
		const text = html_to_text(h1[1]!);
		if (text) return text;
	}

	const slug = canonical.split("/").filter(Boolean).pop() ?? "";
	return slug.replace(/-/g, " ");
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/**
 * Page templates belonging to one source. A source without a prefix covers the
 * whole site; otherwise it takes the pages under its root plus the landing page
 * sitting at the prefix itself.
 */
export function pages_for(source: SearchSource, page_files: readonly string[]): string[] {
	const root = source.root ?? source.prefix.replace(/^\//, "");
	if (!root) return [...page_files];

	return page_files.filter((rel) =>
		rel.startsWith(root + "/") || template_to_canonical(rel) === source.prefix
	);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function build_source_index(
	source: SearchSource,
	page_files: string[],
	public_dir: string,
	dist_dir: string,
	url_for: (canonical: string) => string,
	now: Date,
): Promise<{ pages: number; records: number; skipped: number; output_path: string; }> {
	const source_pages = pages_for(source, page_files);

	const records: SearchRecord[] = [];
	let pages = 0;
	let skipped = 0;

	for (const rel_path of source_pages) {
		const canonical = template_to_canonical(rel_path);
		const source_path = join(public_dir, rel_path);
		const frontmatter = existsSync(source_path) ? read_frontmatter(source_path) : {};

		// Same policy as the rendered page's robots meta: drafts, future-dated
		// pages, and noindex pages are built but stay out of search.
		if (!resolve_visibility(
			frontmatter,
			now,
			canonical,
			default_language,
			project_hooks.content_visibility
		).index) {
			skipped++;
			continue;
		}

		const url = url_for(canonical);
		const html_path = join(dist_dir, url, "index.html");
		if (!existsSync(html_path)) {
			console.warn(`  ⚠ No rendered HTML for ${url} - run the build first`);
			skipped++;
			continue;
		}

		const html = await Bun.file(html_path).text();
		const title = title_for(html, frontmatter, canonical);

		records.push(...page_records(html, { url, title }, search.strip));
		pages++;
	}

	const output_path = join(dist_dir, source.prefix, "search-index.json");
	await Bun.write(output_path, JSON.stringify({ site: source.prefix, records }));

	return { pages, records: records.length, skipped, output_path };
}

async function main() {
	const { public_dir, dist_dir } = parse_args();

	if (!search.enabled) {
		console.log("↷ Search is disabled in config/search.ts - nothing to do.");
		return;
	}

	console.log(`📂 Source:   ${public_dir}`);
	console.log(`📦 Output:   ${dist_dir}/<prefix>/search-index.json`);
	console.log("");

	if (!existsSync(public_dir)) {
		console.error(`✗ Source directory does not exist: ${public_dir}`);
		process.exit(1);
	}
	if (!existsSync(dist_dir)) {
		console.error(`✗ Dist directory does not exist: ${dist_dir} - run the build first`);
		process.exit(1);
	}

	const translations = await load_all_translations(public_dir, active_languages);
	const page_files = without_draft_pages(collect_page_files(public_dir, active_languages));
	const route_map = build_static_route_map(translations, page_files, active_languages);

	// Default-language URL for a canonical path, mirroring the sitemap's
	// resolution so localized routes land on the URL that was actually rendered.
	function url_for(canonical: string): string {
		return route_map.get(canonical)?.get(default_language) ?? canonical;
	}

	const now = new Date();
	let total_records = 0;

	console.log("═".repeat(50));
	for (const source of search.sources) {
		const result = await build_source_index(source, page_files, public_dir, dist_dir, url_for, now);
		total_records += result.records;
		const label = source.prefix || "/";
		const skipped_note = result.skipped > 0 ? ` (${result.skipped} skipped)` : "";
		console.log(`  ${label}: ${result.pages} pages → ${result.records} records${skipped_note}`);
	}
	console.log("═".repeat(50));
	console.log(`✅ Search index written (${search.sources.length} source(s), ${total_records} records)`);
}

if (import.meta.main) { await main(); }
