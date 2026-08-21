import { describe, expect, test } from "bun:test";

import { diff_locale_keys, extract_translation_keys, flatten_leaf_paths, strip_route_names } from "./translations";

describe("extract_translation_keys", () => {
	test("finds escaped, raw, and markdown translation tags", () => {
		const tpl = `
			<h1>{_ ui.welcome_title}</h1>
			<p>{- ui.rich_text }</p>
			<div>{@ docs.body}</div>
			<a href="{~ localized_path('/about') }">{_ ui.learn_more}</a>
			<span>{= user_name }</span>
		`;
		expect(extract_translation_keys(tpl)).toEqual([
			"docs.body",
			"ui.learn_more",
			"ui.rich_text",
			"ui.welcome_title",
		]);
	});

	test("ignores expression tags and CSS-like braces", () => expect(extract_translation_keys(
		"{= foo.bar } {~ raw } { -webkit-line-clamp: 2; }"
	)).toEqual([]));
});

describe("flatten_leaf_paths", () => test("flattens nested trees to dotted leaf paths", () => {
	const tree = { ui: { title: "Hi", nested: { deep: "x" } }, route_name: "o-nas", plain: "y" };
	expect(flatten_leaf_paths(tree).sort()).toEqual([
		"plain",
		"route_name",
		"ui.nested.deep",
		"ui.title",
	]);
}));

describe("diff_locale_keys", () => {
	test("reports per-locale gaps against the union, excluding route_name", () => {
		const diff = diff_locale_keys({
			"en-us": ["ui.title", "ui.text"],
			"sl-si": ["ui.title", "route_name"],
		}, ["en-us", "sl-si"]);

		expect(diff).toEqual({ "sl-si": ["ui.text"] });
	});

	test("returns empty when locales are in sync", () => expect(diff_locale_keys({
		"en-us": ["a"],
		"sl-si": ["a"],
	}, ["en-us", "sl-si"])).toEqual({}));
});

describe("strip_route_names", () => test("removes route_name keys at every level", () => {
	const tree = {
		route_name: "o-nas",
		ui: { title: "Hi" },
		blog: { route_name: "novice", post: { title: "T" } },
	};
	expect(strip_route_names(tree)).toEqual({
		ui: { title: "Hi" },
		blog: { post: { title: "T" } },
	});
}));
