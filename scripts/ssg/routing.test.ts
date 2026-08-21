/**
 * Tests for routing helpers: output-path math and the route resolver.
 * These were previously buried as closures/inline blocks in build.ts.
 */

import { describe, expect, test } from "bun:test";

import { create_route_resolver, normalize_internal_page_links, output_target, with_trailing_slash } from "./routing";

describe("output_target", () => {
	test("home page, default locale → index.html at root", () => {
		const t = output_target("/", "sl-si", "sl-si");
		expect(t).toMatchObject({
			output_rel: "index.html",
			verbose_label: "(root)/index.html",
			locale_url_prefix: "",
			request_url: "/",
			is_default: true,
		});
	});

	test("home page, non-default locale → {locale}/index.html", () => {
		const t = output_target("/", "en-us", "sl-si");
		expect(t).toMatchObject({
			output_rel: "en-us/index.html",
			locale_url_prefix: "/en-us",
			request_url: "/en-us/",
			is_default: false,
		});
	});

	test("nested localized path, default locale", () => {
		const t = output_target("/o-nas", "sl-si", "sl-si");
		expect(t).toMatchObject({
			output_rel: "o-nas/index.html",
			request_url: "/o-nas/",
			verbose_label: "(root)/o-nas/index.html",
		});
	});

	test("nested localized path, non-default locale gets locale prefix", () => {
		const t = output_target("/about", "en-us", "sl-si");
		expect(t).toMatchObject({
			output_rel: "en-us/about/index.html",
			request_url: "/en-us/about/",
			verbose_label: "en-us/about/index.html",
		});
	});
});

describe("create_route_resolver", () => {
	const route_map = new Map([["/about", new Map([["sl-si", "/o-nas"], ["en-us", "/about"]])]]);
	const resolver = create_route_resolver(route_map, "sl-si");

	test("resolve_localized_path returns localized variant", () => {
		expect(resolver.resolve_localized_path("/about", "sl-si")).toBe("/o-nas");
		expect(resolver.resolve_localized_path("/about", "en-us")).toBe("/about");
	});

	test("resolve_localized_path falls back to canonical when unmapped", () => {
		expect(resolver.resolve_localized_path("/missing", "sl-si")).toBe("/missing");
		expect(resolver.resolve_localized_path("/about", "de-de")).toBe("/about");
	});

	test("localized_url_for_locale prefixes non-default locales only", () => {
		expect(resolver.localized_url_for_locale("/about", "sl-si")).toBe("/o-nas/");
		expect(resolver.localized_url_for_locale("/about", "en-us")).toBe("/en-us/about/");
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
