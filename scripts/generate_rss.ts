#!/usr/bin/env bun

/**
 * scripts/generate_rss.ts
 *
 * Emits per-language RSS 2.0 (feed.xml) and JSON Feed 1.1 (feed.json) for
 * the blog directory under public/. Reads `.md` files only - no database or
 * runtime dependency, so it works on statically generated sites.
 *
 * Output (default --blog-dir blog):
 *   dist/blog/feed.xml          ← default language
 *   dist/blog/feed.json         ← default language
 *   dist/<lang>/blog/feed.xml   ← other active languages
 *   dist/<lang>/blog/feed.json
 *
 * Usage:
 *   bun scripts/generate_rss.ts --public ./public --dist ./dist --site-url https://example.com
 *   bun scripts/generate_rss.ts --help
 *
 * CLI options (every option also reads its env fallback):
 *   --public <dir>             Source dir (default: ./public)
 *   --dist <dir>               Output dir (default: ./dist)
 *   --site-url <url>           REQUIRED. Absolute origin used for <link>/url fields.
 *   --blog-dir <name>          Sub-directory under --public to scan (default: blog)
 *   --formats <list>           Comma list: xml, json, or "xml,json" (default: xml,json)
 *   --max-items <n>            Limit items per feed (default: 50)
 *   --feed-title <text>        Override the feed title (default: "<site_name> - <blog>")
 *   --feed-description <text>  Override the feed description (default: per-lang)
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

import { active_languages, default_language, language_locales, soft_launch_languages } from "$config/supported_languages";
import { collect_records, type CollectedRecord } from "$lib/collect_records";
import { load_all_translations } from "$lib/i18n";
import { build_static_route_map, collect_page_files } from "$lib/static_site";
import { project_hooks } from "$root/src/lib/project_hooks";
import { without_draft_pages } from "$lib/draft_pages";

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
	console.error("  --blog-dir <name>          Sub-directory under --public (default: blog)");
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

function parse_args(): Args {
	const args = process.argv.slice(2);

	if (args.includes("--help")) {
		print_usage();
		process.exit(0);
	}

	let public_dir = "./src/public";
	let dist_dir = "./dist";
	let site_url: string | undefined = process.env.SITE_URL;
	// BLOG_DIR is env-only (strict, set in .env); --blog-dir overrides it. No
	// hidden code default - a missing value with no flag is an ingress error.
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

	if (!site_url) {
		console.error("✗ --site-url is required (or set SITE_URL in .env)");
		print_usage();
		process.exit(1);
	}
	if (!blog_dir) {
		console.error("✗ --blog-dir is required (or set BLOG_DIR in .env)");
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
// String helpers
// ---------------------------------------------------------------------------

function xml_escape(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(
		/"/g,
		"&quot;"
	).replace(/'/g, "&apos;");
}

function cdata_wrap(s: string): string {
	const safe = s.replace(/]]>/g, "]]]]><![CDATA[>");
	return `<![CDATA[${safe}]]>`;
}

function rfc822(date: Date): string { return date.toUTCString(); }

function to_iso(date: Date): string { return date.toISOString(); }

// ---------------------------------------------------------------------------
// Feed builders
// ---------------------------------------------------------------------------

type FeedMeta = {
	title: string;
	description: string;
	home_url: string;
	feed_url_xml: string;
	feed_url_json: string;
	lang: string;
	locale: string;
	build_date: Date;
};

function build_rss_xml(meta: FeedMeta, items: CollectedRecord[], site_url: string): string {
	const item_xml = items.map((post) => {
		const url = site_url + post.canonical_path + "/";
		const author = post.authors[0];
		// RSS 2.0 <author> is defined as an email address, so it is emitted only
		// when a real email exists - never fabricate one. The human-readable name
		// always rides on <dc:creator> (the dc namespace is declared on the feed).
		let author_tag = "";
		if (author) {
			if (author.email) {
				author_tag += `      <author>${xml_escape(author.email)} (${xml_escape(author.name)})</author>\n`;
			}
			author_tag += `      <dc:creator>${xml_escape(author.name)}</dc:creator>\n`;
		}

		return [
			`    <item>`,
			`      <title>${xml_escape(post.title)}</title>`,
			`      <link>${xml_escape(url)}</link>`,
			`      <guid isPermaLink="true">${xml_escape(url)}</guid>`,
			`      <pubDate>${rfc822(post.published_at)}</pubDate>`,
			`      <description>${cdata_wrap(post.description)}</description>`,
			`      <content:encoded>${cdata_wrap(post.content_html)}</content:encoded>`,
			author_tag.trimEnd(),
			`    </item>`,
		].filter(Boolean).join("\n");
	}).join("\n");

	return [
		`<?xml version="1.0" encoding="UTF-8"?>`,
		`<rss version="2.0"`,
		`     xmlns:atom="http://www.w3.org/2005/Atom"`,
		`     xmlns:content="http://purl.org/rss/1.0/modules/content/"`,
		`     xmlns:dc="http://purl.org/dc/elements/1.1/">`,
		`  <channel>`,
		`    <title>${xml_escape(meta.title)}</title>`,
		`    <link>${xml_escape(meta.home_url)}</link>`,
		`    <description>${xml_escape(meta.description)}</description>`,
		`    <language>${xml_escape(meta.locale)}</language>`,
		`    <lastBuildDate>${rfc822(meta.build_date)}</lastBuildDate>`,
		`    <atom:link href="${xml_escape(meta.feed_url_xml)}" rel="self" type="application/rss+xml" />`,
		item_xml,
		`  </channel>`,
		`</rss>`,
		``,
	].join("\n");
}

function build_json_feed(meta: FeedMeta, items: CollectedRecord[], site_url: string): string {
	const json = {
		version: "https://jsonfeed.org/version/1.1",
		title: meta.title,
		description: meta.description,
		home_page_url: meta.home_url,
		feed_url: meta.feed_url_json,
		language: meta.locale,
		items: items.map((post) => {
			const url = site_url + post.canonical_path + "/";
			const item: Record<string, unknown> = {
				id: url,
				url,
				title: post.title,
				summary: post.description,
				content_html: post.content_html,
				date_published: to_iso(post.published_at),
			};
			if (post.authors.length > 0) {
				item.authors = post.authors.map((a) => {
					const author: Record<string, unknown> = { name: a.name };
					if (a.url) author.url = a.url;
					return author;
				});
			}
			return item;
		}),
	};

	return JSON.stringify(json, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const args = parse_args();

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

	const translations = await load_all_translations(args.public_dir, active_languages);
	const page_files = without_draft_pages(collect_page_files(args.public_dir, active_languages));

	// Route map is used so we render localized URLs for the home link consistently
	// with the rest of the static build (even though the default install keeps
	// /blog identical across languages).
	const route_map = build_static_route_map(translations, page_files, active_languages);

	function localized_url(canonical: string, lang: string): string {
		const per_lang = route_map.get(canonical);
		const localized = per_lang?.get(lang) ?? canonical;
		const prefix = lang === default_language ? "" : `/${lang}`;
		const trimmed = (prefix + localized).replace(/\/+$/, "");
		return args.site_url + trimmed + "/";
	}

	const build_date = new Date();
	const blog_canonical = "/" + args.blog_dir;
	let total_items = 0;

	for (const lang of active_languages.filter((l) => !soft_launch_languages.includes(l))) {
		const posts = collect_records(
			args.public_dir,
			args.blog_dir,
			lang,
			page_files,
			"date_desc",
			build_date,
			project_hooks.content_visibility
		);
		const limited = posts.slice(0, args.max_items);

		const lang_strings = translations[lang]?.routes ?? {};
		const site_name = typeof lang_strings.site_name === "string" ? lang_strings.site_name : "Site";
		const blog_label = typeof lang_strings?.nav?.blog === "string" ? lang_strings.nav.blog : "Blog";
		const locale = language_locales[lang] ?? lang;

		const home_url = localized_url(blog_canonical, lang);
		const lang_path_prefix = lang === default_language ? "" : `/${lang}`;
		const feed_url_xml = args.site_url + lang_path_prefix + "/" + args.blog_dir + "/feed.xml";
		const feed_url_json = args.site_url + lang_path_prefix + "/" + args.blog_dir + "/feed.json";

		const meta: FeedMeta = {
			title: args.feed_title ?? `${site_name} - ${blog_label}`,
			description: args.feed_description ?? `${blog_label} - ${site_name}`,
			home_url,
			feed_url_xml,
			feed_url_json,
			lang,
			locale,
			build_date,
		};

		const out_dir_rel = lang === default_language ? args.blog_dir : `${lang}/${args.blog_dir}`;
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
	console.log(`  Languages:    ${active_languages.length}`);
	console.log(`  Total items:  ${total_items}`);
	console.log("═".repeat(50));
}

await main();
