import { describe, expect, test } from "bun:test";

import { default_visibility, is_published, resolve_visibility } from "$lib/content_visibility";

const NOW = new Date("2026-06-23T12:00:00Z");
const PAST = "2025-01-01";
const FUTURE = "2099-01-01";

describe("is_published", () => {
	test("a plain page is published", () => expect(is_published({}, NOW)).toBe(true));

	test("draft: true is not published", () => expect(is_published({ draft: true }, NOW)).toBe(
		false
	));

	test("published: false (inverse alias) is not published", () => expect(is_published({
		published: false,
	}, NOW)).toBe(false));

	test("a past published_at is published", () => expect(is_published({ published_at: PAST }, NOW)).toBe(
		true
	));

	test("a future published_at is not published", () => expect(is_published({
		published_at: FUTURE,
	}, NOW)).toBe(false));

	test("compound: past date but draft:true is not published", () => expect(is_published({
		published_at: PAST,
		draft: true,
	}, NOW)).toBe(false));

	test("an unparseable date does not suppress", () => expect(is_published({
		published_at: "not-a-date",
	}, NOW)).toBe(true));

	test("a Date object in the future is not published", () => expect(is_published({
		published_at: new Date(FUTURE),
	}, NOW)).toBe(false));
});

describe("default_visibility - published pages preserve historical opt-outs", () => {
	test("a plain published page is visible everywhere", () => expect(default_visibility({}, NOW)).toEqual({
		render: true,
		list: true,
		feed: true,
		sitemap: true,
		index: true,
	}));

	test("rss: false drops listings+feeds, keeps render+sitemap+index", () => expect(default_visibility({
		rss: false,
	}, NOW)).toEqual({ render: true, list: false, feed: false, sitemap: true, index: true }));

	test("sitemap: false drops only the sitemap", () => expect(default_visibility(
		{ sitemap: false },
		NOW
	)).toEqual({ render: true, list: true, feed: true, sitemap: false, index: true }));

	test("noindex: true drops index+listings+feeds+sitemap, keeps render", () => expect(default_visibility({
		noindex: true,
	}, NOW)).toEqual({ render: true, list: false, feed: false, sitemap: false, index: false }));
});

describe("default_visibility - unpublished pages are built but hidden", () => {
	const hidden = { render: true, list: false, feed: false, sitemap: false, index: false };

	test("a draft renders but is absent from every aggregation and noindexed", () => expect(default_visibility({
		draft: true,
	}, NOW)).toEqual(hidden));

	test("a future-dated post is hidden the same way", () => expect(default_visibility({
		published_at: FUTURE,
	}, NOW)).toEqual(hidden));
});

describe("resolve_visibility - project override", () => {
	test("no override returns the default unchanged", () => expect(resolve_visibility(
		{ rss: false },
		NOW,
		"/blog/x",
		"en"
	)).toEqual(default_visibility({ rss: false }, NOW)));

	test("override receives the default and its decision wins", () => {
		const seen: any[] = [];
		const got = resolve_visibility({ status: "review" }, NOW, "/blog/x", "en", (input) => {
			seen.push(input);
			return { ...input.default, index: false };
		});
		expect(got.index).toBe(false);
		expect(got.render).toBe(true);
		expect(seen[0].canonical_path).toBe("/blog/x");
		expect(seen[0].lang).toBe("en");
		expect(seen[0].default).toEqual(default_visibility({ status: "review" }, NOW));
	});

	test("override can decouple list from feed", () => {
		const got = resolve_visibility({}, NOW, "/blog/x", "en", (input) => ({
			...input.default,
			feed: false,
		}));
		expect(got.list).toBe(true);
		expect(got.feed).toBe(false);
	});
});
