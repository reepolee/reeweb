/**
 * scripts/dev/resolve.ts
 *
 * Maps a request URL to a locale + canonical path, then to a concrete
 * template/markdown file (via the route maps, then direct/index file probing).
 */

import { existsSync, readFileSync } from "fs";
import { join, relative } from "path";

import { default_locale, locales } from "$config/supported_locales";
import { parse_frontmatter } from "$lib/static_site";
import { project_hooks } from "$root/src/lib/project_hooks";
import { locale_language, locale_url_segment } from "$root/src/lib/locale";

import { with_trailing_slash } from "../shared/routing";
import type { SiteState } from "./site_state";

export type ResolvedTemplate = { kind: "ree"; rel_path: string; } | { kind: "md"; rel_path: string; layout: string; };

/**
 * Parse locale and canonical path from a request URL.
 *   /                 → { locale: "sl-si", path: "/" }
 *   /en-us/about/     → { locale: "en-us", path: "/about" }
 *   /css/style.css    → { locale: "sl-si", path: "/css/style.css" }
 */
export function resolve_request(url_path: string): { locale: string; path: string; } {
	const normalized = url_path.replace(/\/+$/, "") || "/";
	const segments = normalized.split("/").filter(Boolean);
	const first = segments[0];
	const matched_locale = first ? (locales as readonly string[]).find((locale) => locale_url_segment(
		locale
	) === first.toLowerCase()) : undefined;

	if (matched_locale) {
		const rest = segments.slice(1);
		return { locale: matched_locale, path: rest.length > 0 ? "/" + rest.join("/") : "/" };
	}

	// No locale prefix → default locale.
	return { locale: default_locale, path: normalized };
}

/**
 * Canonical URL a request should have used, or null if it already is canonical.
 *
 * Two non-canonical shapes redirect to the full BCP 47 locale segment:
 *   - a bare language subtag that matches exactly one configured locale's
 *     language part, e.g. "/de/about" -> "/de-de/about/" (only when exactly
 *     one configured locale has that language - an ambiguous subtag, e.g.
 *     "en" when both "en-us" and "en-gb" are configured, is left alone and
 *     falls through to the default-locale path resolution instead).
 *   - a locale segment whose case or slash doesn't match the canonical form,
 *     e.g. "/DE-de" or "/de-de" (missing trailing slash) -> "/de-de/".
 * Query string and fragment are preserved on the redirect target.
 */
export function canonical_redirect_target(url_path: string, search: string): string | null {
	const segments = url_path.split("/").filter(Boolean);
	const first = segments[0];
	if (!first) return null;

	const lowered = first.toLowerCase();
	const all_locales = locales as readonly string[];

	const exact = all_locales.find((locale) => locale_url_segment(locale) === lowered);
	if (exact) {
		// Exact locale match: canonical only if the raw segment was already
		// lowercase and the path carries a trailing slash.
		const canonical_path = with_trailing_slash("/" + [locale_url_segment(exact), ...segments.slice(1)].join("/"));
		if (first === locale_url_segment(exact) && url_path === canonical_path) return null;
		return canonical_path + search;
	}

	// Bare language subtag ("de") matching exactly one configured locale's
	// language part ("de-de") - redirect to the full locale segment.
	const language_matches = all_locales.filter((locale) => locale_url_segment(locale).startsWith(lowered + "-") && locale_language(locale).toLowerCase() === lowered);
	if (language_matches.length === 1) {
		const canonical_path = with_trailing_slash("/" + [locale_url_segment(language_matches[0]!), ...segments.slice(1)].join("/"));
		return canonical_path + search;
	}

	return null;
}

/** Resolve the layout template name for a markdown file from its frontmatter. */
export function resolve_layout_for_md(rel_path: string, public_dir: string): string {
	try {
		const full_path = join(public_dir, rel_path);
		const text = existsSync(full_path) ? readFileSync(full_path, "utf-8") : "";
		const { data: fm } = parse_frontmatter(text);
		// Seam 4: project may override layout resolution; else use the built-in.
		const override = project_hooks.resolve_md_layout?.(rel_path, fm, public_dir);
		if (override) return override;
		const base = String((fm.layout as string) || "layout").replace(/\.ree$/, "").replace(
			/\.layout$/,
			""
		);
		for (const candidate of [`${base}.layout`, base]) {
			if (existsSync(join(public_dir, candidate + ".ree"))) return candidate;
		}
	} catch {}
	return "layout";
}

/**
 * Resolve a canonical path + locale to a template/markdown file, or null.
 * Tries the canonical→template map, then the reverse (localized→canonical) map,
 * then direct `.ree`/`.md` paths, then `index.*` files.
 */
export function resolve_template(canonical: string, locale: string, state: SiteState): ResolvedTemplate | null {
	const public_dir = state.public_dir;

	// 1. Hash-map fast path; 2. reverse route map (localized → canonical).
	let template = state.canonical_to_template.get(canonical);
	if (!template) {
		const resolved_canonical = state.resolve_canonical_from_localized(canonical, locale);
		if (resolved_canonical) { template = state.canonical_to_template.get(resolved_canonical); }
	}

	if (template) {
		if (template.endsWith(".ree")) return { kind: "ree", rel_path: template };
		if (template.endsWith(".md")) return {
			kind: "md",
			rel_path: template,
			layout: resolve_layout_for_md(template, public_dir),
		};
	}

	const without_slash = canonical.replace(
		/^\//,
		""
	);

	// 3. Direct file paths.
	const ree_path = join(public_dir, without_slash + ".ree");
	if (existsSync(ree_path)) return {
		kind: "ree",
		rel_path: relative(public_dir, ree_path).replace(/\\/g, "/"),
	};

	const md_path = join(public_dir, without_slash + ".md");
	if (existsSync(md_path)) {
		const rel = relative(public_dir, md_path).replace(/\\/g, "/");
		return { kind: "md", rel_path: rel, layout: resolve_layout_for_md(rel, public_dir) };
	}

	// 4. index.* files.
	const index_ree = join(public_dir, without_slash, "index.ree");
	if (existsSync(index_ree)) return {
		kind: "ree",
		rel_path: relative(public_dir, index_ree).replace(/\\/g, "/"),
	};

	const index_md = join(public_dir, without_slash, "index.md");
	if (existsSync(index_md)) {
		const rel = relative(public_dir, index_md).replace(/\\/g, "/");
		return { kind: "md", rel_path: rel, layout: resolve_layout_for_md(rel, public_dir) };
	}

	return null;
}
