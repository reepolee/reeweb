/**
 * Tests for SEO link construction: absolute URLs and hreflang clusters.
 */

import { describe, expect, test } from "bun:test";

import { abs_url, build_hreflang_links } from "./seo";

describe("abs_url", () => test("joins site URL and path with a single trailing slash", () => {
	expect(abs_url("https://x.com", "/blog")).toBe("https://x.com/blog/");
	expect(abs_url("https://x.com", "/blog/")).toBe("https://x.com/blog/");
	expect(abs_url("https://x.com", "/")).toBe("https://x.com/");
}));

describe("build_hreflang_links", () => {
	const base = {
		site_url: "https://x.com",
		languages: ["sl", "en"] as const,
		soft_launch_languages: [] as const,
		default_language: "sl",
		url_for_lang: (l: string) => (l === "sl" ? "/o-nas" : "/en/about"),
	};

	test("emits one link per language plus x-default at the default variant", () => {
		const links = build_hreflang_links(base);
		expect(links).toEqual([
			{ lang: "sl", href: "https://x.com/o-nas/" },
			{ lang: "en", href: "https://x.com/en/about/" },
			{ lang: "x-default", href: "https://x.com/o-nas/" },
		]);
	});

	test("returns empty when no site_url (hreflang needs absolute URLs)", () => expect(build_hreflang_links({
		...base,
		site_url: "",
	})).toEqual([]));

	test("excludes soft-launch languages from the cluster", () => {
		const links = build_hreflang_links({ ...base, soft_launch_languages: ["en"] });
		expect(links.map((l) => l.lang)).toEqual(["sl", "x-default"]);
	});
});
