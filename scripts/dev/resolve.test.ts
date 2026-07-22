/**
 * Tests for request URL → language + canonical path parsing.
 * (Template/file resolution touches the filesystem and is covered by the
 * dev-server smoke checks instead.)
 */

import { describe, expect, test } from "bun:test";

import { default_language, languages } from "$config/supported_languages";

import { resolve_request } from "./resolve";

// Any configured non-default language works as the "prefixed" example; falls
// back to the default itself when only one language is configured.
const other_lang = languages.find((l) => l !== default_language) ?? default_language;

describe("resolve_request", () => {
	test("root → default language", () => expect(resolve_request("/")).toEqual({
		lang: default_language,
		path: "/",
	}));

	test("language-prefixed root", () => expect(resolve_request(`/${other_lang}/`)).toEqual({
		lang: other_lang,
		path: "/",
	}));

	test("default-language nested path", () => expect(resolve_request("/about/")).toEqual({
		lang: default_language,
		path: "/about",
	}));

	test("language-prefixed nested path", () => expect(resolve_request(`/${other_lang}/about/`)).toEqual({
		lang: other_lang,
		path: "/about",
	}));

	test("non-language first segment stays in the default language path", () => expect(resolve_request(
		"/css/style.css"
	)).toEqual({ lang: default_language, path: "/css/style.css" }));

	test("trailing slashes are normalized", () => expect(
		resolve_request(
			`/${other_lang}/blog///`
		)
	).toEqual({ lang: other_lang, path: "/blog" }));
});
