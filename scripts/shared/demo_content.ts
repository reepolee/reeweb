/**
 * Removal of the template's demo content - the starter homepage, about/contact
 * pages, sample blog posts, and the reepolee docs pages (served from a
 * separate docs site, not project content). Run once when starting a real
 * project from this template.
 *
 * Deletion is immediate - no dry-run, no confirmation. Recovery is git or
 * re-extracting the template, not this tool's job.
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { languages } from "$config/supported_languages";

import { PUBLIC_DIR } from "../mcp/paths";

const DEMO_PATHS = [
	"index.ts",
	"about",
	"contact",
	"blog/01_starter-blog-post.md",
	"blog/02_dunning-kruger-mid-level-ai-team-lead.md",
	"blog/03_language-difference-apps-pages.md",
	"blog/academic-paper-sample.md",
	"blog/index.ree",
	"docs",
	"team.json",
	"academic.layout.ree",
	"plain.layout.ree",
];

// Demo-only keys in the root en.json/sl.json. ui.pagination.* and the
// language-switcher names are shared infrastructure and are kept.
const DEMO_TRANSLATION_KEYS = [
	"nav.about",
	"nav.blog",
	"nav.contact",
	"ui.welcome_title",
	"ui.welcome_text",
	"ui.learn_more",
	"ui.feature_1_title",
	"ui.feature_1_text",
	"ui.feature_2_title",
	"ui.feature_2_text",
	"ui.feature_3_title",
	"ui.feature_3_text",
	"ui.starwars_title",
	"ui.team_title",
];

function delete_dotted(obj: Record<string, any>, key: string): boolean {
	const parts = key.split(".");
	let cursor = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		const next = cursor[parts[i] as string];
		if (!next || typeof next !== "object") return false;
		cursor = next;
	}
	const last = parts[parts.length - 1] as string;
	if (!(last in cursor)) return false;
	delete cursor[last];
	return true;
}

function strip_demo_translation_keys(public_dir: string, lang: string): { file: string; keys_removed: string[]; } | null {
	const file_path = join(public_dir, `${lang}.json`);
	if (!existsSync(file_path)) return null;

	const raw_text = readFileSync(file_path, "utf-8");
	const json = JSON.parse(raw_text);

	const keys_removed: string[] = [];
	for (const key of DEMO_TRANSLATION_KEYS) {
		if (delete_dotted(json, key)) keys_removed.push(key);
	}
	if (keys_removed.length === 0) return null;

	const indent_match = raw_text.match(/\n([\t ]+)\S/);
	const indent = indent_match ? (indent_match[1] as string)[0] === "\t" ? "\t" : (indent_match[1] as string) : "\t";
	Bun.write(file_path, `${JSON.stringify(json, null, indent)}\n`);

	return { file: `src/public/${lang}.json`, keys_removed };
}

// Nav links in the shared layout that point at demo pages being removed.
// Matches a single `<a href="{~ localized_path('/x') }">...</a>` line.
const LAYOUT_FILE = "layout.ree";
const DEMO_NAV_ROUTES = ["about", "contact", "blog", "docs"];

function strip_demo_nav_links(public_dir: string): string[] {
	const file_path = join(public_dir, LAYOUT_FILE);
	if (!existsSync(file_path)) return [];

	const original = readFileSync(file_path, "utf-8");
	let updated = original;
	const removed_routes: string[] = [];

	for (const route of DEMO_NAV_ROUTES) {
		const line_re = new RegExp(`\\n[ \\t]*<a href="\\{~ localized_path\\('/${route}'\\) \\}">[^\\n]*</a>`);
		if (line_re.test(updated)) {
			updated = updated.replace(line_re, "");
			removed_routes.push(route);
		}
	}

	if (updated !== original) Bun.write(file_path, updated);
	return removed_routes;
}

// index.ree is the site's home route - bun dev breaks without one, so its
// demo content is replaced rather than deleted.
const HOME_PAGE = "index.ree";
const HOME_PAGE_STUB = "<h1>Home</h1>\n";

export type DemoContentReport = {
	removed: string[];
	replaced: string[];
	not_found: string[];
	translation_keys_removed: Array<{ file: string; keys_removed: string[]; }>;
	layout_nav_links_removed: string[];
};

/** Delete all demo pages/files, strip demo-only translation keys, and remove their layout nav links. */
export function remove_demo_content(public_dir: string = PUBLIC_DIR): DemoContentReport {
	const removed: string[] = [];
	const replaced: string[] = [];
	const not_found: string[] = [];

	const home_page_abs = join(public_dir, HOME_PAGE);
	if (existsSync(home_page_abs)) {
		Bun.write(home_page_abs, HOME_PAGE_STUB);
		replaced.push(`src/public/${HOME_PAGE}`);
	} else {
		not_found.push(`src/public/${HOME_PAGE}`);
	}

	for (const rel of DEMO_PATHS) {
		const abs = join(public_dir, rel);
		if (!existsSync(abs)) {
			not_found.push(`src/public/${rel}`);
			continue;
		}
		rmSync(abs, { recursive: true, force: true });
		removed.push(`src/public/${rel}`);
	}

	const translation_keys_removed: Array<{ file: string; keys_removed: string[]; }> = [];
	for (const lang of languages) {
		const result = strip_demo_translation_keys(public_dir, lang);
		if (result) translation_keys_removed.push(result);
	}

	const layout_nav_links_removed = strip_demo_nav_links(public_dir);

	return { removed, replaced, not_found, translation_keys_removed, layout_nav_links_removed };
}

export { DEMO_PATHS, DEMO_TRANSLATION_KEYS };
