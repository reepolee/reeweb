/**
 * Tests for request URL → locale + canonical path parsing.
 * (Template/file resolution touches the filesystem and is covered by the
 * dev-server smoke checks instead.)
 */

import { describe, expect, test } from "bun:test";

import { default_locale, locales } from "$config/supported_locales";
import { locale_url_segment } from "$root/src/lib/locale";

import { canonical_redirect_target, resolve_request } from "./resolve";

// Any configured non-default locale works as the "prefixed" example; falls
// back to the default itself when only one locale is configured.
const other_locale = locales.find((l) => l !== default_locale) ?? default_locale;
const other_segment = locale_url_segment(other_locale);

describe("resolve_request", () => {
	test("root → default locale", () => expect(resolve_request("/")).toEqual({
		locale: default_locale,
		path: "/",
	}));

	test("locale-prefixed root (lowercased URL segment)", () => expect(resolve_request(`/${other_segment}/`)).toEqual({
		locale: other_locale,
		path: "/",
	}));

	test("default-locale nested path", () => expect(resolve_request("/about/")).toEqual({
		locale: default_locale,
		path: "/about",
	}));

	test("locale-prefixed nested path", () => expect(resolve_request(`/${other_segment}/about/`)).toEqual({
		locale: other_locale,
		path: "/about",
	}));

	test("non-locale first segment stays in the default locale path", () => expect(resolve_request(
		"/css/style.css"
	)).toEqual({ locale: default_locale, path: "/css/style.css" }));

	test("trailing slashes are normalized", () => expect(
		resolve_request(
			`/${other_segment}/blog///`
		)
	).toEqual({ locale: other_locale, path: "/blog" }));

	test("matches the locale segment case-insensitively", () => expect(resolve_request(
		`/${other_segment.toUpperCase()}/about/`
	)).toEqual({ locale: other_locale, path: "/about" }));
});

describe("canonical_redirect_target", () => {
	test("root and default-locale paths are already canonical", () => {
		expect(canonical_redirect_target("/", "")).toBeNull();
		expect(canonical_redirect_target("/about", "")).toBeNull();
	});

	test("static/non-locale paths are left alone", () => {
		expect(canonical_redirect_target("/css/style.css", "")).toBeNull();
	});

	test("canonical locale-prefixed path is left alone", () => {
		expect(canonical_redirect_target(`/${other_segment}/about/`, "")).toBeNull();
	});

	test("missing trailing slash on a locale path redirects", () => {
		expect(canonical_redirect_target(`/${other_segment}/about`, "")).toBe(`/${other_segment}/about/`);
	});

	test("wrong-case locale segment redirects to the lowercase canonical form", () => {
		expect(canonical_redirect_target(`/${other_segment.toUpperCase()}/about/`, "")).toBe(`/${other_segment}/about/`);
	});

	test("bare language subtag redirects to the full locale segment when unambiguous", () => {
		const language = locale_url_segment(other_locale).split("-")[0]!;
		const language_matches = locales.filter((l) => locale_url_segment(l).split("-")[0] === language);
		if (language_matches.length !== 1) return; // ambiguous in this config, skip
		expect(canonical_redirect_target(`/${language}/about`, "")).toBe(`/${other_segment}/about/`);
	});

	test("preserves the query string on redirect", () => {
		expect(canonical_redirect_target(`/${other_segment}/about`, "?x=1")).toBe(`/${other_segment}/about/?x=1`);
	});
});
