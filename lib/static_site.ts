/**
 * lib/static_site.ts
 *
 * Shared helpers for the static-build pipeline. Used by:
 *   - scripts/static_build.ts (renders .ree templates → HTML)
 *   - scripts/generate_sitemap.ts (emits dist/sitemap.xml)
 *
 * Pure functions only - no I/O side effects beyond filesystem reads.
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

import { slugify } from "$lib/route_aliases";

// ---------------------------------------------------------------------------
// Filesystem traversal
// ---------------------------------------------------------------------------

/** Recursively walk a directory and return file paths relative to `root`. */
export function walk_dir(root: string, dir: string = root, files: string[] = []): string[] {
	const entries = readdirSync(dir, { withFileTypes: true });

	for (const entry of entries) {
		const full_path = join(dir, entry.name);

		if (entry.isDirectory()) {
			walk_dir(root, full_path, files);
		} else {
			const rel = relative(root, full_path);
			files.push(rel.replace(/\\/g, "/"));
		}
	}

	return files;
}

// ---------------------------------------------------------------------------
// Path → route helpers
// ---------------------------------------------------------------------------

const PAGE_EXT_RE = /\.(ree|md)$/;

/**
 * Compute the translation namespace for a template path.
 *
 *   "blog/post.ree"   → "blog.post"
 *   "blog/index.ree"  → "blog"
 *   "index.ree"       → ""
 */
export function path_to_namespace(rel_path: string): string {
	const without_ext = rel_path.replace(PAGE_EXT_RE, "");
	const normalized = without_ext.replace(/[/\\]/g, ".");
	return normalized.replace(/\.index$/, "");
}

/**
 * Derive the canonical route from a template path.
 * Strips ordering prefixes (\d+_) from each path segment.
 *
 *   "index.ree"                  → "/"
 *   "about/index.ree"            → "/about"
 *   "blog/02_post.md"            → "/blog/post"
 *   "docs/01_index.md"           → "/docs"
 *   "docs/029_authentication.md" → "/docs/authentication"
 */
export function template_to_canonical(rel_path: string): string {
	const without_ext = rel_path.replace(PAGE_EXT_RE, "");
	const without_order = without_ext.replace(/(^|\/)\d+_/g, "$1");
	const normalized = without_order.replace(/\\/g, "/");
	const stripped = normalized === "index" ? "" : normalized.replace(/\/index$/, "");
	return stripped ? "/" + stripped : "/";
}

/**
 * Build a map of canonical → (locale → localized path), walking the
 * translation tree segment-by-segment and substituting `route_name` where
 * present.
 */
export function build_static_route_map(translations: Record<string, any>, page_files: string[], locales: readonly string[]): Map<string, Map<string, string>> {
	const route_map = new Map<string, Map<string, string>>();

	for (const rel_path of page_files) {
		const canonical_path = template_to_canonical(rel_path);
		const per_locale = new Map<string, string>();

		for (const locale of locales) {
			const segments = canonical_path.split("/").filter(Boolean);
			const localized_segments: string[] = [];

			let current: Record<string, any> | undefined = translations[locale];

			for (const segment of segments) {
				if (!current || typeof current !== "object") {
					localized_segments.push(segment);
					continue;
				}

				const candidate = current[segment];

				if (candidate && typeof candidate === "object" && typeof candidate.route_name === "string" && candidate.route_name) {
					localized_segments.push(slugify(candidate.route_name));
					current = candidate;
				} else {
					localized_segments.push(segment);
					current = candidate ?? undefined;
				}
			}

			per_locale.set(locale, "/" + localized_segments.join("/"));
		}

		route_map.set(canonical_path, per_locale);
	}

	return route_map;
}

// ---------------------------------------------------------------------------
// Page collection: walk + dedup locale variants + filter layouts
// ---------------------------------------------------------------------------

/**
 * Collect renderable page files from `public_dir`.
 *
 *   - skips top-level `layout.ree` (used only via {#layout()})
 *   - collapses locale-variant siblings into one canonical entry:
 *     `about.en-us.ree` + `about.sl-si.ree` → `about.ree`
 *   - drops variants for locales this project does not configure, so a
 *     leftover `about.sl-si.ree` with `sl-si` absent from `locales` does not
 *     get published as its own `/about/index.sl-si/` route (and indexed in
 *     the sitemap)
 *
 * `extensions` defaults to `["ree", "md"]`. Pass `["ree"]` to limit to templates
 * the template engine can render.
 */
export function collect_page_files(public_dir: string, locales: readonly string[], extensions: readonly string[] = [
	"ree",
	"md",
]): string[] {
	const all = walk_dir(public_dir);
	const ext_group = extensions.join("|");
	const ext_re = new RegExp(`\\.(${ext_group})$`);
	const locale_segments = locales.map((locale) => locale.toLowerCase());
	const locale_variant_re = new RegExp(`\\.(${locale_segments.join("|")})\\.(${ext_group})$`, "i");
	// Any `.xx.` / `.xx-YY.` segment before the extension is variant-shaped,
	// whether or not the project configures that locale.
	const any_variant_re = new RegExp(`\\.([a-z]{2}(?:-[A-Za-z0-9]{2,8})?)\\.(${ext_group})$`, "i");

	const candidates = all.filter((rel) => ext_re.test(rel) && rel !== "layout.ree" && !rel.endsWith(
		".layout.ree"
	));

	// Bases contributed by real pages: plain files and configured-locale
	// variants. An unconfigured-locale variant is only dropped when one of
	// these already covers its base, so a page that merely looks variant-shaped
	// (`notes.io.ree`, with no `notes.ree` sibling) is still published.
	const page_bases = new Set<string>();
	for (const rel of candidates) {
		const match = rel.match(locale_variant_re);
		page_bases.add(match ? rel.replace(locale_variant_re, `.${match[2]}`) : rel);
	}

	const out: string[] = [];
	const seen = new Set<string>();

	for (const rel of candidates) {
		const match = rel.match(locale_variant_re);

		if (!match) {
			const other = rel.match(any_variant_re);
			const other_base = other ? rel.replace(any_variant_re, `.${other[2]}`) : "";
			// Variant-shaped, for a locale we don't build, and the base is
			// already a page: this file is a translation, not a route.
			if (other && !locale_segments.includes((other[1] ?? "").toLowerCase()) && page_bases.has(other_base)) continue;
		}

		const base = match ? rel.replace(locale_variant_re, `.${match[2]}`) : rel;

		if (!seen.has(base)) {
			seen.add(base);
			out.push(base);
		}
	}

	return out;
}

/**
 * A route served by both a `.ree` template and a `.md` file. `.ree` wins at
 * render time (the dev resolver probes `.ree` first; the build renders `.ree`
 * templates before markdown), so the `.md` is silently shadowed.
 */
export type ReeMdCollision = { canonical: string; ree: string; md: string; };

/**
 * Find routes backed by both a `.ree` and a `.md` source file. Callers collect
 * page files via `collect_page_files` (which already dedups locale variants),
 * split them by extension, and pass both lists here. The collision key is the
 * canonical URL, so numeric order prefixes and `index` are normalized away
 * (`03_quick-start.md` and `quick-start.ree` collide).
 *
 * Dev warns on these; the static build fails loud.
 */
export function find_ree_md_collisions(ree_files: readonly string[], md_files: readonly string[]): ReeMdCollision[] {
	const ree_by_canonical = new Map<string, string>();
	for (const ree of ree_files) {
		ree_by_canonical.set(template_to_canonical(ree), ree);
	}

	const collisions: ReeMdCollision[] = [];
	for (const md of md_files) {
		const canonical = template_to_canonical(md);
		const ree = ree_by_canonical.get(canonical);
		if (ree) { collisions.push({ canonical, ree, md }); }
	}

	return collisions;
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

export type FrontMatter = Record<string, unknown>;

/**
 * Whether a page should be treated as independently localized.
 *
 * By default every page is localized - each active locale gets its own
 * canonical, indexable URL with reciprocal hreflang alternates. Setting
 * `localize: false` in frontmatter marks a page whose content is identical
 * across locales (English-only docs, an English-only blog). For such a page
 * only the default locale is canonical; every other-locale URL is a
 * duplicate that:
 *
 *   - carries `<link rel="canonical">` pointing at the default-locale URL,
 *   - is dropped from the sitemap, and
 *   - is left out of the hreflang cluster (advertising a byte-identical page
 *     as a different locale is a false signal and makes Google discard the
 *     whole cluster).
 *
 * The other-locale URLs are still rendered and reachable - this only governs
 * the SEO signals, not whether the page exists.
 */
export function page_is_localized(frontmatter: FrontMatter): boolean {
	return frontmatter.localize !== false;
}

/**
 * Parse YAML frontmatter from a string. Uses Bun's built-in YAML parser
 * for proper nested structures (arrays, objects, block scalars), falling
 * back to a simple line-by-line parser for flat scalars.
 */
export function parse_frontmatter(text: string): { data: FrontMatter; body: string; } {
	const open_re = /^---\r?\n/;
	if (!open_re.test(text)) { return { data: {}, body: text }; }

	const after_open = text.indexOf("\n") + 1;
	const tail = text.slice(after_open);
	const close_match = tail.match(/\r?\n---\r?\n/);

	if (!close_match || close_match.index === undefined) { return { data: {}, body: text }; }

	const fm_text = tail.slice(0, close_match.index);
	const body = tail.slice(close_match.index + close_match[0].length);

	const parsed = Bun.YAML.parse(fm_text);
	const data: FrontMatter = parsed !== null && typeof parsed === "object" && !Array.isArray(
		parsed
	) ? (parsed as FrontMatter) : parse_line_by_line(fm_text);

	return { data, body };
}

/** Fallback: key: value pairs without nested structure. */
function parse_line_by_line(fm_text: string): FrontMatter {
	const data: FrontMatter = {};
	for (const line of fm_text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const colon = trimmed.indexOf(":");
		if (colon < 0) continue;

		const key = trimmed.slice(0, colon).trim();
		let raw = trimmed.slice(colon + 1).trim();

		if ((raw.startsWith("\"") && raw.endsWith("\"")) || (raw.startsWith("'") && raw.endsWith(
			"'"
		))) { raw = raw.slice(1, -1); }

		let value: unknown = raw;
		if (raw === "true") value = true; else if (raw === "false") value = false; else if (raw === "null") value = null; else if (raw !== "" && !Number.isNaN(Number(
			raw
		))) value = Number(raw);

		data[key] = value;
	}
	return data;
}

/**
 * Read a file from disk and return its parsed frontmatter. Returns an empty
 * object when the file doesn't exist or has no frontmatter block.
 */
export function read_frontmatter(file_path: string): FrontMatter {
	try {
		const text = readFileSync(file_path, "utf-8");
		return parse_frontmatter(text).data;
	} catch {
		return {};
	}
}

/**
 * Return the file's modification time as an ISO-8601 date string (YYYY-MM-DD).
 * Used for sitemap `<lastmod>` when no frontmatter override is supplied.
 */
export function file_mtime_iso_date(file_path: string): string {
	const mtime = statSync(file_path).mtime;
	return mtime.toISOString().slice(0, 10);
}
