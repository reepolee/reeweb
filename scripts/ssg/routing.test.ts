/**
 * Tests for routing helpers: output-path math and the route resolver.
 * These were previously buried as closures/inline blocks in build.ts.
 */

import { describe, expect, test } from "bun:test";

import { create_route_resolver, normalize_internal_page_links, output_target, with_trailing_slash } from "./routing";

describe("output_target", () => {
	test("home page, default language → index.html at root", () => {
		const t = output_target("/", "sl", "sl");
		expect(t).toMatchObject({
			output_rel: "index.html",
			verbose_label: "(root)/index.html",
			lang_url_prefix: "",
			request_url: "/",
			is_default: true,
		});
	});

	test("home page, non-default language → {lang}/index.html", () => {
		const t = output_target("/", "en", "sl");
		expect(t).toMatchObject({
			output_rel: "en/index.html",
			lang_url_prefix: "/en",
			request_url: "/en/",
			is_default: false,
		});
	});

	test("nested localized path, default language", () => {
		const t = output_target("/o-nas", "sl", "sl");
		expect(t).toMatchObject({
			output_rel: "o-nas/index.html",
			request_url: "/o-nas/",
			verbose_label: "(root)/o-nas/index.html",
		});
	});

	test("nested localized path, non-default language gets lang prefix", () => {
		const t = output_target("/about", "en", "sl");
		expect(t).toMatchObject({
			output_rel: "en/about/index.html",
			request_url: "/en/about/",
			verbose_label: "en/about/index.html",
		});
	});
});

describe("create_route_resolver", () => {
	const route_map = new Map([["/about", new Map([["sl", "/o-nas"], ["en", "/about"]])]]);
	const resolver = create_route_resolver(route_map, "sl");

	test("resolve_localized_path returns localized variant", () => {
		expect(resolver.resolve_localized_path("/about", "sl")).toBe("/o-nas");
		expect(resolver.resolve_localized_path("/about", "en")).toBe("/about");
	});

	test("resolve_localized_path falls back to canonical when unmapped", () => {
		expect(resolver.resolve_localized_path("/missing", "sl")).toBe("/missing");
		expect(resolver.resolve_localized_path("/about", "de")).toBe("/about");
	});

	test("localized_url_for_lang prefixes non-default languages only", () => {
		expect(resolver.localized_url_for_lang("/about", "sl")).toBe("/o-nas/");
		expect(resolver.localized_url_for_lang("/about", "en")).toBe("/en/about/");
	});
});

describe("with_trailing_slash", () => {
	test("appends a slash to a slashless page path", () => {
		expect(with_trailing_slash("/media-kit")).toBe("/media-kit/");
		expect(with_trailing_slash("/en/about")).toBe("/en/about/");
		expect(with_trailing_slash("/engineering-notes/boring-ui-wins")).toBe("/engineering-notes/boring-ui-wins/");
	});

	test("leaves root and already-slashed paths untouched", () => {
		expect(with_trailing_slash("")).toBe("");
		expect(with_trailing_slash("/")).toBe("/");
		expect(with_trailing_slash("/about/")).toBe("/about/");
	});

	test("leaves paths whose last segment has a file extension untouched", () => {
		expect(with_trailing_slash("/engineering-notes/feed.xml")).toBe("/engineering-notes/feed.xml");
		expect(with_trailing_slash("/images/responsive/hero-blog.jpg")).toBe("/images/responsive/hero-blog.jpg");
	});
});

describe("normalize_internal_page_links", () => {
	test("adds slashes to root-relative page links while preserving URL suffixes", () => {
		const html = '<a href="/docs/install">Install</a><a href="/docs/install?tab=one">Query</a><a href="/docs/install#one">Fragment</a>';
		const normalized = normalize_internal_page_links(html);
		expect(normalized).toContain('href="/docs/install/"');
		expect(normalized).toContain('href="/docs/install/?tab=one"');
		expect(normalized).toContain('href="/docs/install/#one"');
	});

	test("leaves assets and external links unchanged", () => {
		const html = '<link href="/css/site.css"><a href="https://example.com/docs">External</a>';
		expect(normalize_internal_page_links(html)).toBe(html);
	});
});
