/**
 * Feed builders for scripts/generate_rss.ts - pure RSS 2.0 (feed.xml) and
 * JSON Feed 1.1 (feed.json) serializers. No I/O: given feed metadata and
 * collected records they return the full feed document as a string.
 */
import type { CollectedRecord } from "$lib/collect_records";

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

export type FeedMeta = {
	title: string;
	description: string;
	home_url: string;
	feed_url_xml: string;
	feed_url_json: string;
	locale: string;
	build_date: Date;
};

export function build_rss_xml(meta: FeedMeta, items: CollectedRecord[], site_url: string): string {
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

export function build_json_feed(meta: FeedMeta, items: CollectedRecord[], site_url: string): string {
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
