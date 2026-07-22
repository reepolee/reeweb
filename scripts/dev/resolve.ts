/**
 * scripts/dev/resolve.ts
 *
 * Maps a request URL to a language + canonical path, then to a concrete
 * template/markdown file (via the route maps, then direct/index file probing).
 */

import { existsSync, readFileSync } from "fs";
import { join, relative } from "path";

import { default_language, languages } from "$config/supported_languages";
import { parse_frontmatter } from "$lib/static_site";
import { project_hooks } from "$root/src/lib/project_hooks";

import type { SiteState } from "./site_state";

export type ResolvedTemplate = { kind: "ree"; rel_path: string; } | { kind: "md"; rel_path: string; layout: string; };

/**
 * Parse language and canonical path from a request URL.
 *   /              → { lang: "sl", path: "/" }
 *   /en/about/     → { lang: "en", path: "/about" }
 *   /css/style.css → { lang: "sl", path: "/css/style.css" }
 */
export function resolve_request(url_path: string): { lang: string; path: string; } {
	const normalized = url_path.replace(/\/+$/, "") || "/";
	const segments = normalized.split("/").filter(Boolean);
	const first = segments[0];

	if (first && (languages as readonly string[]).includes(first)) {
		const rest = segments.slice(1);
		return { lang: first, path: rest.length > 0 ? "/" + rest.join("/") : "/" };
	}

	// No language prefix → default language.
	return { lang: default_language, path: normalized };
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
 * Resolve a canonical path + language to a template/markdown file, or null.
 * Tries the canonical→template map, then the reverse (localized→canonical) map,
 * then direct `.ree`/`.md` paths, then `index.*` files.
 */
export function resolve_template(canonical: string, lang: string, state: SiteState): ResolvedTemplate | null {
	const public_dir = state.public_dir;

	// 1. Hash-map fast path; 2. reverse route map (localized → canonical).
	let template = state.canonical_to_template.get(canonical);
	if (!template) {
		const resolved_canonical = state.resolve_canonical_from_localized(canonical, lang);
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
