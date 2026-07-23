/**
 * lib/collect_records.ts
 *
 * Shared content-record collector for a route's markdown files. A "record" is
 * one rendered `.md` page (title, description, html, date, authors) collected
 * from a folder under the public dir - the default data source for both the RSS
 * generator and the pagination build step.
 *
 * This is the generic, upstream collector. Projects that need different
 * collection (custom filtering, an external source, a different shape) should
 * NOT edit this file - copy it into `src/lib/` and wire it through
 * `src/lib/project_helpers.ts`. For records that come from an external API, a
 * paginated route can instead export `load_records(lang)` (see config/pagination.ts).
 *
 * Pure functions only - filesystem reads, no writes.
 */

import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";

import type { PaginationRoute } from "$config/pagination";
import { default_language } from "$config/supported_languages";
import { resolve_visibility, type VisibilityOverride } from "$lib/content_visibility";
import { parse_frontmatter, template_to_canonical, type FrontMatter } from "$lib/static_site";

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------

export function strip_markdown(s: string): string {
	let out = s;
	out = out.replace(/!\[[^\]]*\]\([^)]+\)/g, "");
	out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
	out = out.replace(/`([^`]+)`/g, "$1");
	out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
	out = out.replace(/__([^_]+)__/g, "$1");
	out = out.replace(/\*([^*]+)\*/g, "$1");
	out = out.replace(/_([^_]+)_/g, "$1");
	out = out.replace(/~~([^~]+)~~/g, "$1");
	out = out.replace(/^>\s+/gm, "");
	return out.trim();
}

export function first_paragraph(body: string): string {
	const blocks = body.split(/\r?\n\s*\r?\n/);
	for (const block of blocks) {
		const trimmed = block.trim();
		if (!trimmed) continue;
		if (trimmed.startsWith("#")) continue;
		if (trimmed.startsWith("---")) continue;
		if (trimmed.startsWith("```")) continue;
		return trimmed.replace(/\r?\n/g, " ").replace(/\s+/g, " ");
	}
	return "";
}

export function truncate(s: string, limit: number): string {
	if (s.length <= limit) return s;
	const cut = s.slice(0, limit);
	const last_space = cut.lastIndexOf(" ");
	const trimmed = last_space > limit * 0.6 ? cut.slice(0, last_space) : cut;
	return trimmed.replace(/[.,;:!?\s]+$/, "") + "…";
}

export function parse_date(value: unknown, fallback: Date): Date {
	if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = new Date(value.trim());
		if (!Number.isNaN(parsed.getTime())) return parsed;
	}
	return fallback;
}

// ---------------------------------------------------------------------------
// Author normalization
// ---------------------------------------------------------------------------

export type Author = { name: string; email?: string; url?: string; };

export function normalize_authors(fm: FrontMatter): Author[] {
	const out: Author[] = [];

	const raw_authors = fm.authors;
	if (Array.isArray(raw_authors)) {
		for (const entry of raw_authors) {
			if (typeof entry === "string" && entry.trim()) {
				out.push({ name: entry.trim() });
			} else if (entry && typeof entry === "object") {
				const obj = entry as Record<string, unknown>;
				const name = typeof obj.name === "string" ? obj.name.trim() : "";
				if (!name) continue;
				const author: Author = { name };
				if (typeof obj.email === "string" && obj.email.trim()) author.email = obj.email.trim();
				if (typeof obj.url === "string" && obj.url.trim()) author.url = obj.url.trim();
				out.push(author);
			}
		}
	}

	if (out.length === 0) {
		const single = fm.author;
		if (typeof single === "string" && single.trim()) {
			out.push({ name: single.trim() });
		} else if (single && typeof single === "object") {
			const obj = single as Record<string, unknown>;
			const name = typeof obj.name === "string" ? obj.name.trim() : "";
			if (name) {
				const author: Author = { name };
				if (typeof obj.email === "string" && obj.email.trim()) author.email = obj.email.trim();
				if (typeof obj.url === "string" && obj.url.trim()) author.url = obj.url.trim();
				out.push(author);
			}
		}
	}

	return out;
}

// ---------------------------------------------------------------------------
// Record collection
// ---------------------------------------------------------------------------

export type CollectedRecord = {
	rel_path: string;
	canonical_path: string;
	title: string;
	description: string;
	content_html: string;
	published_at: Date;
	authors: Author[];
};

export function extract_md_title(fm: FrontMatter, body: string, fallback: string): string {
	const fm_title = fm.title;
	if (typeof fm_title === "string" && fm_title.trim()) return fm_title.trim();

	const h1 = body.match(/^#\s+(.+?)\s*$/m);
	const h1_text = h1?.[1];
	if (h1_text) return strip_markdown(h1_text);

	return fallback;
}

export function extract_description(fm: FrontMatter, body: string): string {
	const candidates = [fm.description, fm.excerpt, fm.summary, fm.abstract];
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.trim()) {
			return truncate(strip_markdown(candidate), 320);
		}
	}

	const para = first_paragraph(body);
	return truncate(strip_markdown(para), 320);
}

export function is_index_file(rel_path: string): boolean {
	const base = rel_path.split("/").pop() ?? "";
	if (base === "index.md") return true;
	if (/^\d+_index\.md$/.test(base)) return true;
	return false;
}

/**
 * The markdown files under `route_dir` that count as records. Excludes the
 * route's OWN listing index (a file sitting directly at the route root, like
 * blog/index.md or blog/01_index.md) but KEEPS a nested folder-per-post such as
 * blog/my-post/index.md. Pure (no I/O) so it is unit-testable.
 */
export function route_record_files(route_dir: string, page_files: string[]): string[] {
	const route_prefix = route_dir + "/";
	return page_files.filter((rel) => {
		if (!rel.endsWith(".md") || !rel.startsWith(route_prefix)) return false;
		// `sub` has no "/" only when the file is directly at the route root.
		const sub = rel.slice(route_prefix.length);
		if (!sub.includes("/") && is_index_file(sub)) return false;
		return true;
	});
}

export function resolve_md_for_lang(public_dir: string, rel_path: string, lang: string): { content: string; mtime_ms: number; } | null {
	const without_ext = rel_path.replace(/\.md$/, "");
	const candidates = [
		`${without_ext}.${lang}.md`,
		`${without_ext}.${default_language}.md`,
		rel_path,
	];

	for (const candidate of candidates) {
		const full = join(public_dir, candidate);
		if (!existsSync(full)) continue;
		const content = readFileSync(full, "utf-8");
		const mtime_ms = statSync(full).mtimeMs;
		return { content, mtime_ms };
	}

	return null;
}

export type RecordSort = "date_desc" | "date_asc" | "filename";

/**
 * Collect content records from a route's markdown files for one language.
 *
 * Skips the route's OWN listing index (e.g. blog/index.md, blog/01_index.md) and
 * posts opted out via `rss: false` / `noindex: true`. A nested index - i.e. a
 * folder-per-post like blog/my-post/index.md (canonical /blog/my-post) - IS
 * collected, so co-located-asset posts appear in listings and feeds.
 * Resolves per-language variants ({name}.{lang}.md → {name}.{default}.md → {name}.md).
 * Sorted newest-first by default.
 *
 * `now` is the build clock used by the visibility policy (drafts / future-dated
 * posts are excluded from listings + feeds); it defaults to the current time so
 * callers that don't care stay deterministic for already-published content.
 */
export function collect_records(
	public_dir: string,
	route_dir: string,
	lang: string,
	page_files: string[],
	sort: RecordSort = "date_desc",
	now: Date = new Date(),
	override?: VisibilityOverride,
): CollectedRecord[] {
	const route_md_files = route_record_files(route_dir, page_files);

	const records: CollectedRecord[] = [];

	for (const rel_path of route_md_files) {
		const resolved = resolve_md_for_lang(public_dir, rel_path, lang);
		if (!resolved) continue;

		const { data: fm, body } = parse_frontmatter(resolved.content);

		const canonical = template_to_canonical(rel_path);

		// Visibility policy: drop posts hidden from BOTH listings and feeds - i.e.
		// `rss: false` / `noindex: true` opt-outs, plus drafts and future-dated
		// posts (list and feed are coupled in the default). A project `override`
		// (project_hooks.content_visibility) can decouple or reshape them.
		const visibility = resolve_visibility(fm, now, canonical, lang, override);
		if (!visibility.list && !visibility.feed) continue;

		const fallback_title = canonical.split("/").pop() ?? "Untitled";

		const title = extract_md_title(fm, body, fallback_title);
		const description = extract_description(fm, body);

		const raw_html = Bun.markdown.html(body, {
			tables: true,
			strikethrough: true,
			tasklists: true,
			autolinks: { url: true, www: true, email: true },
			headings: { ids: true },
		});

		const published_at = parse_date(fm.published_at ?? fm.date, new Date(resolved.mtime_ms));
		const authors = normalize_authors(fm);

		records.push({
			rel_path,
			canonical_path: canonical,
			title,
			description,
			content_html: raw_html,
			published_at,
			authors,
		});
	}

	if (sort === "filename") {
		records.sort((a, b) => a.rel_path.localeCompare(b.rel_path));
	} else if (sort === "date_asc") {
		records.sort((a, b) => a.published_at.getTime() - b.published_at.getTime());
	} else {
		records.sort((a, b) => b.published_at.getTime() - a.published_at.getTime());
	}

	return records;
}

/**
 * Resolve a paginated route's records for one language, choosing the source per
 * the route config:
 *   - `source: "loader"` (or auto-detected) → the route's index.ts must export
 *     `load_records(lang)`, returning records from anywhere (external API, DB, …).
 *   - otherwise → the default markdown collector over <route>/*.md.
 *
 * Shared by scripts/ssg.ts (static SSG) and scripts/dev.ts (dev server) so
 * the two render the same pages.
 */
export async function resolve_route_records(
	public_dir: string,
	route: PaginationRoute,
	lang: string,
	page_files: string[],
	now: Date = new Date(),
	override?: VisibilityOverride,
): Promise<any[]> {
	const route_dir = route.route.replace(/^\/+|\/+$/g, "");
	const data_rel = `${route_dir}/index.ts`;
	const data_full = join(public_dir, data_rel);
	const wants_loader = route.source === "loader" || (route.source == null && existsSync(data_full));

	if (wants_loader && existsSync(data_full)) {
		const file_url = pathToFileURL(data_full).href;
		const mod = await import(file_url);
		if (typeof mod.load_records === "function") {
			const recs = await mod.load_records(lang);
			return Array.isArray(recs) ? recs : [];
		}
		if (route.source === "loader") {
			console.warn(
				`   ⚠  ${data_rel} does not export load_records() - falling back to markdown`
			);
		}
	}

	return collect_records(
		public_dir,
		route_dir,
		lang,
		page_files,
		route.sort ?? "date_desc",
		now,
		override
	);
}
