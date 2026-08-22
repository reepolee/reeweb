#!/usr/bin/env bun

/**
 * scripts/generate_rss.ts
 *
 * Emits per-locale RSS 2.0 (feed.xml) and JSON Feed 1.1 (feed.json) for
 * the blog directory under public/. Reads `.md` files only - no database or
 * runtime dependency, so it works on statically generated sites.
 *
 * Output (default --blog-dir blog):
 *   dist/blog/feed.xml             ← default locale
 *   dist/blog/feed.json            ← default locale
 *   dist/<locale>/blog/feed.xml    ← other active locales (lowercased URL segment)
 *   dist/<locale>/blog/feed.json
 *
 * Usage:
 *   bun scripts/generate_rss.ts --public ./public --dist ./dist --site-url https://example.com
 *   bun scripts/generate_rss.ts --help
 *
 * CLI options (every option also reads its env fallback):
 *   --public <dir>             Source dir (default: ./public)
 *   --dist <dir>               Output dir (default: ./dist)
 *   --site-url <url>           REQUIRED. Absolute origin used for <link>/url fields.
 *   --blog-dir <name>          Sub-directory under --public to scan (or BLOG_DIR)
 *   --formats <list>           Comma list: xml, json, or "xml,json" (default: xml,json)
 *   --max-items <n>            Limit items per feed (default: 50)
 *   --feed-title <text>        Override the feed title (default: "<site_name> - <blog>")
 *   --feed-description <text>  Override the feed description (default: per-locale)
 *   --help                     Print this usage and exit
 *
 * Per-post frontmatter is honored:
 *   title:           string                     - falls back to first H1
 *   description:     string                     - falls back to first paragraph
 *   summary:         string                     - alias for description
 *   abstract:        string                     - alias (academic layout)
 *   published_at:    YYYY-MM-DD or ISO datetime - falls back to file mtime
 *   date:            alias for published_at
 *   author:          string OR { name, email }
 *   authors:         array - first entry is used for RSS, all for JSON Feed
 *   rss:             false                      - opt this post out
 *   noindex:         true                       - also opts out
 */

import { existsSync } from "fs";
import { join, resolve } from "path";

import { active_locales, default_locale, soft_launch_locales } from "$config/supported_locales";
import { collect_records } from "$lib/collect_records";
import { load_all_translations } from "$lib/i18n";
import { build_static_route_map, collect_page_files } from "$lib/static_site";
import { project_hooks } from "$root/src/lib/project_hooks";
import { without_draft_pages } from "$lib/draft_pages";
import { locale_url_segment } from "$root/src/lib/locale";
import { build_json_feed, build_rss_xml, type FeedMeta } from "./feeds";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function print_usage() {
	console.error("Usage: bun scripts/generate_rss.ts [options]");
	console.error("");
	console.error("Options:");
	console.error("  --public <dir>             Source directory (default: ./src/public)");
	console.error("  --dist <dir>               Output directory (default: ./dist)");
	console.error("  --site-url <url>           REQUIRED. Absolute origin (or SITE_URL env)");
	console.error("  --blog-dir <name>          Sub-directory under --public (or BLOG_DIR)");
	console.error("  --formats <list>           Comma list: xml,json (default: xml,json)");
	console.error("  --max-items <n>            Limit items per feed (default: 50)");
	console.error("  --feed-title <text>        Override feed title");
	console.error("  --feed-description <text>  Override feed description");
	console.error("  --help                     Print this usage and exit");
}

type Args = {
	public_dir: string;
	dist_dir: string;
	site_url: string;
	blog_dir: string;
	formats: { xml: boolean; json: boolean; };
	max_items: number;
	feed_title: string | null;
	feed_description: string | null;
};

function parse_args(): Args | null {
	const args = process.argv.slice(2);

	if (args.includes("--help")) {
		print_usage();
		process.exit(0);
	}

	let public_dir = "./src/public";
	let dist_dir = "./dist";
	let site_url: string | undefined = process.env.SITE_URL;
	// An unset blog directory means the project has no blog feeds to generate.
	// The CLI flag allows one-off feed generation without changing .env.
	let blog_dir: string | undefined = process.env.BLOG_DIR;
	let formats_raw = "xml,json";
	let max_items = 50;
	let feed_title: string | null = null;
	let feed_description: string | null = null;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg) continue;

		if (arg === "--public") {
			public_dir = args[++i] ?? public_dir;
		} else if (arg === "--dist") {
			dist_dir = args[++i] ?? dist_dir;
		} else if (arg === "--site-url") {
			site_url = args[++i] ?? site_url;
		} else if (arg === "--blog-dir") {
			blog_dir = args[++i] ?? blog_dir;
		} else if (arg === "--formats") {
			formats_raw = args[++i] ?? formats_raw;
		} else if (arg === "--max-items") {
			const raw = args[++i];
			const parsed = Number(raw);
			if (Number.isFinite(parsed) && parsed > 0) max_items = parsed;
		} else if (arg === "--feed-title") {
			feed_title = args[++i] ?? feed_title;
		} else if (arg === "--feed-description") {
			feed_description = args[++i] ?? feed_description;
		}
	}

	if (!blog_dir) {
		return null;
	}
	if (!site_url) {
		console.error("✗ --site-url is required (or set SITE_URL in .env)");
		print_usage();
		process.exit(1);
	}

	const tokens = formats_raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
	const formats = { xml: tokens.includes("xml"), json: tokens.includes("json") };

	if (!formats.xml && !formats.json) {
		console.error(`✗ --formats must include at least one of: xml, json (got "${formats_raw}")`);
		process.exit(1);
	}

	return {
		public_dir: resolve(public_dir),
		dist_dir: resolve(dist_dir),
		site_url: site_url.replace(/\/+$/, ""),
		blog_dir: blog_dir.replace(/^\/+|\/+$/g, ""),
		formats,
		max_items,
		feed_title,
		feed_description,
	};
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const args = parse_args();
	if (!args) {
		console.log("⏭️  RSS generation skipped: BLOG_DIR is not set");
		return;
	}

	console.log(`📂 Source:    ${args.public_dir}`);
	console.log(`📦 Output:    ${args.dist_dir}`);
	console.log(`📰 Blog dir:  ${args.blog_dir}/`);
	console.log(`🔗 Site URL:  ${args.site_url}`);
	console.log(`🧾 Formats:   ${[args.formats.xml && "xml", args.formats.json && "json"].filter(
		Boolean
	).join(", ")}`);
	console.log("");

	if (!existsSync(args.public_dir)) {
		console.error(`✗ Source directory does not exist: ${args.public_dir}`);
		process.exit(1);
	}
	if (!existsSync(args.dist_dir)) {
		console.error(`✗ Dist directory does not exist: ${args.dist_dir} - run static_build first`);
		process.exit(1);
	}

	const blog_root = join(args.public_dir, args.blog_dir);
	if (!existsSync(blog_root)) {
		console.error(`✗ Blog directory does not exist: ${blog_root}`);
		process.exit(1);
	}

	const translations = await load_all_translations(args.public_dir, active_locales);
	const page_files = without_draft_pages(collect_page_files(args.public_dir, active_locales));

	// Route map is used so we render localized URLs for the home link consistently
	// with the rest of the static build (even though the default install keeps
	// /blog identical across locales).
	const route_map = build_static_route_map(translations, page_files, active_locales);
	const site_url = args.site_url;

	function localized_url(canonical: string, locale: string): string {
		const per_locale = route_map.get(canonical);
		const localized = per_locale?.get(locale) ?? canonical;
		const prefix = locale === default_locale ? "" : `/${locale_url_segment(locale)}`;
		const trimmed = (prefix + localized).replace(/\/+$/, "");
		return site_url + trimmed + "/";
	}

	const build_date = new Date();
	const blog_canonical = "/" + args.blog_dir;
	let total_items = 0;

	for (const locale of active_locales.filter((l) => !soft_launch_locales.includes(l))) {
		const posts = collect_records(
			args.public_dir,
			args.blog_dir,
			locale,
			page_files,
			"date_desc",
			build_date,
			project_hooks.content_visibility
		);
		const limited = posts.slice(0, args.max_items);

		const locale_strings = translations[locale]?.routes ?? {};
		const site_name = typeof locale_strings.site_name === "string" ? locale_strings.site_name : "Site";
		const blog_label = typeof locale_strings?.nav?.blog === "string" ? locale_strings.nav.blog : "Blog";

		const home_url = localized_url(blog_canonical, locale);
		const locale_path_prefix = locale === default_locale ? "" : `/${locale_url_segment(locale)}`;
		const feed_url_xml = args.site_url + locale_path_prefix + "/" + args.blog_dir + "/feed.xml";
		const feed_url_json = args.site_url + locale_path_prefix + "/" + args.blog_dir + "/feed.json";

		const meta: FeedMeta = {
			title: args.feed_title ?? `${site_name} - ${blog_label}`,
			description: args.feed_description ?? `${blog_label} - ${site_name}`,
			home_url,
			feed_url_xml,
			feed_url_json,
			locale,
			build_date,
		};

		const out_dir_rel = locale === default_locale ? args.blog_dir : `${locale_url_segment(locale)}/${args.blog_dir}`;
		const out_dir = join(args.dist_dir, out_dir_rel);

		if (args.formats.xml) {
			const xml = build_rss_xml(meta, limited, args.site_url);
			const path_xml = join(out_dir, "feed.xml");
			await Bun.write(path_xml, xml);
			console.log(
				`    ✓ ${path_xml}  (${limited.length} item${limited.length === 1 ? "" : "s"})`
			);
		}

		if (args.formats.json) {
			const json = build_json_feed(meta, limited, args.site_url);
			const path_json = join(out_dir, "feed.json");
			await Bun.write(path_json, json);
			console.log(
				`    ✓ ${path_json}  (${limited.length} item${limited.length === 1 ? "" : "s"})`
			);
		}

		total_items += limited.length;
	}

	console.log("");
	console.log("═".repeat(50));
	console.log(`✅ RSS generation complete`);
	console.log(`  Locales:      ${active_locales.length}`);
	console.log(`  Total items:  ${total_items}`);
	console.log("═".repeat(50));
}

await main();
