/**
 * scripts/shared/sidebar.ts
 *
 * Generic sidebar navigation, shared by the SSG (scripts/ssg/sidebar.ts)
 * and the dev server (scripts/dev/sidebar.ts). Folders whose index.md sets
 * `has_sidebar: true` get a per-language list of links built from their
 * markdown files; `sidebar_links_for` localizes that list for a specific page
 * at render time (marking the active entry).
 *
 * This module holds the algorithm; the ssg/dev wrappers only adapt their
 * own context (config values + a localized-URL resolver) to it.
 */

import { parse_frontmatter, template_to_canonical } from "$lib/static_site";

import { extract_md_title, resolve_md_file } from "../ssg/markdown";

export type SidebarEntry = { title: string; canonical_path: string; };
export type SidebarLink = { title: string; url: string; active: boolean; };
export type SidebarMap = Map<string, Map<string, SidebarEntry[]>>;

export type SidebarBuildOptions = {
	languages: readonly string[];
	default_language: string;
	public_dir: string;
	/** Log a line per sidebar-enabled folder (used by the SSG for visibility). */
	log?: boolean;
};

function is_truthy_flag(value: unknown): boolean {
	return value === true || value === "true" || value === "yes";
}

/** Build folder path → (language → ordered link entries) for sidebar folders. */
export async function build_sidebar_map(md_files: string[], opts: SidebarBuildOptions): Promise<SidebarMap> {
	const { languages, default_language, public_dir, log } = opts;
	const sidebar_map: SidebarMap = new Map();

	for (const base_rel_path of md_files) {
		const base_name = base_rel_path.split("/").pop() ?? "";
		if (base_name !== "index.md" && !/^\d+_index\.md$/.test(base_name)) continue;

		const resolved = await resolve_md_file(
			base_rel_path,
			default_language,
			default_language,
			public_dir
		);
		if (!resolved) continue;

		const { data: frontmatter } = parse_frontmatter(resolved.content);
		if (!is_truthy_flag(frontmatter.has_sidebar)) continue;

		const folder_path = base_rel_path.replace(/\/?(?:\d+_)?index\.md$/, "");
		const folder_md_files = md_files.filter((f) => f.startsWith(folder_path + "/") && f !== base_rel_path).sort((a, b) => a.localeCompare(
			b
		));

		if (folder_md_files.length === 0) continue;

		const per_lang_sidebar = new Map<string, SidebarEntry[]>();

		for (const lang of languages) {
			const links: SidebarEntry[] = [];

			for (const page_rel_path of folder_md_files) {
				const resolved_page = await resolve_md_file(
					page_rel_path,
					lang,
					default_language,
					public_dir
				);
				if (!resolved_page) continue;

				const { data: page_frontmatter } = parse_frontmatter(resolved_page.content);
				if (is_truthy_flag(page_frontmatter["skip-navigation"])) continue;

				links.push({
					title: extract_md_title(resolved_page.content),
					canonical_path: template_to_canonical(page_rel_path),
				});
			}

			per_lang_sidebar.set(lang, links);
		}

		sidebar_map.set(folder_path, per_lang_sidebar);

		if (log) {
			console.log(`📑 Sidebar enabled for /${folder_path} (${folder_md_files.length} page(s))`);
		}
	}

	return sidebar_map;
}

/**
 * Localized sidebar links for a page, or `undefined` if the page is not inside
 * a sidebar-enabled folder. The matching folder's entries are localized for
 * `lang` via `localized_url`, and the entry matching `canonical_path` is
 * flagged active.
 */
export function sidebar_links_for(canonical_path: string, lang: string, sidebar_map: SidebarMap, localized_url: (canonical_path: string, lang: string) => string): SidebarLink[] | undefined {
	for (const [folder_path, per_lang] of sidebar_map) {
		const folder_canonical = "/" + folder_path;
		if (canonical_path === folder_canonical || canonical_path.startsWith(folder_canonical + "/")) {
			return (per_lang.get(lang) ?? []).map((link) => ({
				title: link.title,
				url: localized_url(link.canonical_path, lang),
				active: link.canonical_path === canonical_path,
			}));
		}
	}
	return undefined;
}
