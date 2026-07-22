import { describe, expect, test } from "bun:test";

import { diff_language_keys, extract_translation_keys, flatten_leaf_paths, strip_route_names } from "./translations";

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

describe("diff_language_keys", () => {
	test("reports per-language gaps against the union, excluding route_name", () => {
		const diff = diff_language_keys({
			en: ["ui.title", "ui.text"],
			sl: ["ui.title", "route_name"],
		}, ["en", "sl"]);

		expect(diff).toEqual({ sl: ["ui.text"] });
	});

	test("returns empty when languages are in sync", () => expect(diff_language_keys({
		en: ["a"],
		sl: ["a"],
	}, ["en", "sl"])).toEqual({}));
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
