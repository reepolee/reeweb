/**
 * scripts/ssg/types.ts
 *
 * Shared types for the static-build modules. `BuildContext` is the
 * dependency bundle injected into every render phase (mirrors the
 * `*Deps` interfaces the template engine modules use): it carries the
 * engine, resolved options, translation/language data, and the route
 * resolver so the phases stay pure functions of their inputs.
 */

import type TemplateEngine from "$lib/template_engine";

/** Parsed, resolved CLI options (see cli.ts). */
export type BuildOptions = {
	public_dir: string;
	dist_dir: string;
	base_url: string;
	site_url: string;
	verbose: boolean;
	/** Canonical request path (e.g. "/" or "/en/about/") to print after the build, or undefined. */
	print_url: string | undefined;
	/** With --print-url, render the page with is_dev: true (dev-only template blocks show). */
	dev: boolean;
};

/** A single hreflang alternate link for a page's <head>. */
export type HreflangLink = { lang: string; href: string; };

/** A resolved sidebar navigation entry (view-model passed to templates). */
export type SidebarLink = { title: string; url: string; active: boolean; };

/** A sidebar link before per-request localization (stored in the sidebar map). */
export type SidebarEntry = { title: string; canonical_path: string; };

/**
 * A single schema violation found in a collection entry's frontmatter.
 *   file:    the entry's path relative to public_dir (e.g. "blog/02_post.md")
 *   field:   the offending top-level frontmatter key (or "(root)")
 *   message: the Zod issue message
 */
export type CollectionIssue = { file: string; field: string; message: string; };

/** Render outcome counters returned by each render phase. */
export type RenderTally = { rendered: number; errors: number; };

export type { RouteResolver } from "../shared/routing";

/**
 * The dependency bundle shared by all render phases. Assembled by
 * pipeline.ts after translations are loaded and the route map is built.
 */
export type BuildContext = {
	engine: TemplateEngine;
	options: BuildOptions;

	// Language configuration (from $config/supported_languages).
	languages: readonly string[];
	active_languages: readonly string[];
	default_language: string;
	language_names: Record<string, string>;
	language_locales: Record<string, string>;
	soft_launch_languages: readonly string[];

	// Derived per-build language data.
	language_self_names: Record<string, string>;
	language_urls: Record<string, string>;

	translations: Record<string, any>;
	route_resolver: RouteResolver;

	/** Build-wide constant: current year (footer copyright, etc.). */
	year: number;

	/** Routes produced by this build - populated by phases, used for redirect collision checks. */
	generated_routes: Set<string>;
};
