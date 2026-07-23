/**
 * lib/hooks.ts
 *
 * The project-hooks contract. This is the *upstream* seam between the
 * (project-agnostic) ssg/dev scripts and per-project behaviour: scripts call
 * these hooks at fixed points, and each project supplies an implementation in
 * `src/lib/project_hooks.ts`. Every hook is optional - an omitted hook means
 * "use the upstream default", so base Reeweb (which ships no hooks) produces
 * byte-identical output to having no hooks at all.
 *
 * Rule of thumb: scripts/ and lib/ stay identical across projects; all
 * variation lives in src/config/* (data/flags) and src/lib/project_hooks.ts
 * (behaviour). See PLAN_script_extension_points.md.
 */

import type { Heading } from "$lib/markdown_docs";
import type { Visibility, VisibilityInput } from "$lib/content_visibility";

// The visibility concern owns its own types in lib/content_visibility.ts; we
// re-export here so consumers can reference `Visibility` / `VisibilityInput`
// from the hooks module too, without hooks.ts becoming a grab-bag of types.
export type { Visibility, VisibilityInput };

/** Context handed to `page_data_extras` so it never reaches back into scripts. */
export type PageDataCtx = { is_dev: boolean; languages: readonly string[]; default_language: string; };

/** Everything a project needs to (re)shape a rendered markdown page. */
export type ShapeMdInput = {
	/** Canonical, language-agnostic path (e.g. "/docs/intro"). */
	canonical_path: string;
	lang: string;
	/** Parsed frontmatter of the resolved markdown file. */
	frontmatter: Record<string, any>;
	/** Post-processed body HTML (after the docs markdown pass). */
	html_body: string;
	/** Headings extracted by the docs markdown pass (for a table of contents). */
	headings: Heading[];
	public_dir: string;
	/** All markdown files in the site (relative paths) - e.g. to build a sidebar. */
	md_files: readonly string[];
	languages: readonly string[];
	default_language: string;
};

/** Result of `shape_md_page`: the final body plus any extra render fields. */
export type ShapeMdResult = {
	/** Final body markup injected into the template as `body`. */
	body: string;
	/** Extra fields merged into the page render data (toc, sidebar groups, …). */
	fields?: Record<string, unknown>;
};

/**
 * Per-project behaviour hooks. All optional; omit to keep upstream defaults.
 */
export type ProjectHooks = {
	/**
	 * Seam 1 - extra functions exposed to every template via `data.helpers`.
	 * Merged into the built-in helpers (see create_template_helpers).
	 */
	helper_functions?: Record<string, (...args: any[]) => unknown>;

	/**
	 * Seam 2 - extra fields merged into every page's render data (e.g. version
	 * pills read once from package.json). Called per render; projects that read
	 * from disk should compute once at module load and return the cached object.
	 */
	page_data_extras?(ctx: PageDataCtx): Record<string, unknown>;

	/**
	 * Seam 3 (SSG only) - SEO policy: is this canonical path a genuinely
	 * localized page? Default `true`. Return `false` for English-only subtrees
	 * (blog, product docs) so they are dropped from the hreflang cluster and
	 * canonicalize to the default-language URL.
	 */
	is_localized_path?(canonical_path: string, lang: string): boolean;

	/**
	 * Seam 4 - override markdown layout resolution. Return `undefined` to fall
	 * back to the built-in (`<name>.layout.ree` → `<name>.ree` → `layout`).
	 */
	resolve_md_layout?(rel_path: string, frontmatter: Record<string, any>, public_dir: string): string | undefined;

	/**
	 * Seam 5 - shape a markdown page: transform the body HTML and contribute
	 * extra render fields (table of contents, docs sidebar groups, coming-soon
	 * body, page_title, …). Default: body unchanged, no extra fields.
	 */
	shape_md_page?(input: ShapeMdInput): ShapeMdResult;

	/**
	 * Seam 6 - per-page visibility. Receives the upstream default decision (from
	 * default_visibility: render / list / feed / sitemap / index) plus the page's
	 * frontmatter, canonical path and language; returns the final decision. Use
	 * it to express project statuses (draft / review / published), path-based
	 * rules, etc. Default: the upstream decision is used unchanged.
	 */
	content_visibility?(input: VisibilityInput): Visibility;
};
