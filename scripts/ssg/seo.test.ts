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
		locales: ["sl-si", "en-us"] as const,
		soft_launch_locales: [] as const,
		default_locale: "sl-si",
		url_for_locale: (l: string) => (l === "sl-si" ? "/o-nas" : "/en-us/about"),
	};

	test("emits one link per locale (formatted to conventional BCP 47 casing) plus x-default at the default variant", () => {
		const links = build_hreflang_links(base);
		expect(links).toEqual([
			{ locale: "sl-SI", href: "https://x.com/o-nas/" },
			{ locale: "en-US", href: "https://x.com/en-us/about/" },
			{ locale: "x-default", href: "https://x.com/o-nas/" },
		]);
	});

	test("returns empty when no site_url (hreflang needs absolute URLs)", () => expect(build_hreflang_links({
		...base,
		site_url: "",
	})).toEqual([]));

	test("excludes soft-launch locales from the cluster", () => {
		const links = build_hreflang_links({ ...base, soft_launch_locales: ["en-us"] });
		expect(links.map((l) => l.locale)).toEqual(["sl-SI", "x-default"]);
	});
});
