/**
 * scripts/dev/site_state.ts
 *
 * Mutable server state for the dev server: translations, the page-file
 * inventory, and the route maps derived from them. `reload()` re-scans the
 * public dir and re-reads translations, so a page rename/add/delete (route_name
 * edits can also move localized URLs) is picked up without restarting the
 * server. The resolver methods read the current maps rather than closing over
 * a snapshot.
 */

import { locales, default_locale } from "$config/supported_locales";
import { load_all_translations } from "$lib/i18n";
import { build_static_route_map, collect_page_files, template_to_canonical } from "$lib/static_site";

import { without_draft_pages } from "$lib/draft_pages";
import { locale_url_segment } from "$root/src/lib/locale";

import { create_route_resolver, type RouteResolver } from "../shared/routing";
import { merge_route_strings } from "../ssg/translation_merge";

export class SiteState {
	readonly public_dir: string;

	// Page-file inventory (rebuilt on reload() - source files can be renamed,
	// added, or deleted during a dev session).
	all_page_files: string[];
	ree_files: string[];
	md_files: string[];
	canonical_to_template: Map<string, string>;
	readonly locale_urls: Record<string, string>;

	// Route-dependent state (rebuilt on reload()).
	translations: Record<string, any>;
	route_resolver: RouteResolver;
	locale_self_names: Record<string, string>;

	private constructor(public_dir: string, translations: Record<string, any>) {
		this.public_dir = public_dir;
		this.translations = translations;

		this.all_page_files = [];
		this.ree_files = [];
		this.md_files = [];
		this.canonical_to_template = new Map();

		// Default locale at root (""), others at "/{locale}" (lowercased).
		this.locale_urls = {};
		for (const locale of locales) {
			this.locale_urls[locale] = locale === default_locale ? "" : `/${locale_url_segment(locale)}`;
		}

		this.route_resolver = create_route_resolver(new Map(), default_locale);
		this.locale_self_names = {};
		this.rebuild_page_inventory();
		this.rebuild_route_state();
	}

	/** Load translations and build the initial state. */
	static async create(public_dir: string): Promise<SiteState> {
		const translations = await load_all_translations(public_dir, locales);
		return new SiteState(public_dir, translations);
	}

	/** Re-scan the public dir and re-read translations, then rebuild the route-dependent maps. */
	async reload(): Promise<void> {
		this.translations = await load_all_translations(this.public_dir, locales);
		this.rebuild_page_inventory();
		this.rebuild_route_state();
	}

	/** (Re)build the page-file inventory and the canonical→template map. */
	private rebuild_page_inventory(): void {
		this.all_page_files = without_draft_pages(collect_page_files(this.public_dir, locales));
		this.ree_files = this.all_page_files.filter((f) => f.endsWith(".ree"));
		this.md_files = this.all_page_files.filter((f) => f.endsWith(".md"));

		// canonical → template path, the reverse of template_to_canonical. When a
		// route has both a .ree and a .md source, .ree wins deterministically -
		// NOT by filesystem walk order, which readdirSync leaves unsorted (so a
		// bare "first wins" would render whichever the OS happened to list first).
		// This matches the direct-file probe in dev/resolve.ts and the build,
		// which both prefer .ree. The build fails loud on the collision; dev warns.
		this.canonical_to_template = new Map();
		for (const rel_path of this.all_page_files) {
			const canonical = template_to_canonical(rel_path);
			const existing = this.canonical_to_template.get(canonical);
			const ree_beats_md = existing !== undefined && existing.endsWith(".md") && rel_path.endsWith(".ree");
			if (existing === undefined || ree_beats_md) {
				this.canonical_to_template.set(canonical, rel_path);
			}
		}
	}

	/** (Re)build route_map, the reverse map, and locale self-names. */
	private rebuild_route_state(): void {
		const route_map = build_static_route_map(this.translations, this.all_page_files, locales);
		this.route_resolver = create_route_resolver(route_map, default_locale);

		// Self-names for the switcher come from each locale's own translation file.
		this.locale_self_names = {};
		for (const locale of locales) {
			this.locale_self_names[locale] = this.translations[locale]?.routes?.ui?.language_names?.[locale] ?? locale;
		}
	}

	resolve_localized_path(canonical_path: string, locale: string): string {
		return this.route_resolver.resolve_localized_path(canonical_path, locale);
	}

	resolve_canonical_from_localized(localized_path: string, locale: string): string | null {
		return this.route_resolver.resolve_canonical_from_localized(localized_path, locale);
	}

	localized_url_for_locale(canonical_path: string, target_locale: string): string {
		return this.route_resolver.localized_url_for_locale(canonical_path, target_locale);
	}

	/** Global `routes` strings for `locale`, overlaid with a route namespace. */
	merge_strings(locale: string, namespace: string): Record<string, any> {
		return merge_route_strings(this.translations, locale, namespace);
	}
}
