/**
 * Tests for translation tree navigation and merging.
 */

import { describe, expect, test } from "bun:test";

import { deep_merge, get_nested, merge_route_strings } from "./translation_merge";

describe("get_nested", () => {
	const tree = { blog: { post: { title: "Hi" } }, ui: { nav: "Menu" } };

	test("resolves a dot-separated path", () => {
		expect(get_nested(tree, "blog.post")).toEqual({ title: "Hi" });
		expect(get_nested(tree, "ui.nav")).toBe("Menu");
	});

	test("returns {} for missing paths or empty input", () => {
		expect(get_nested(tree, "blog.missing")).toEqual({});
		expect(get_nested(tree, "")).toEqual({});
		expect(get_nested(null, "a.b")).toEqual({});
	});
});

describe("deep_merge", () => {
	test("recursively merges nested objects, source wins on scalars", () => {
		const target = { a: { x: 1, y: 2 }, b: 1 };
		const result = deep_merge(target, { a: { y: 9, z: 3 }, c: 4 });
		expect(result).toEqual({ a: { x: 1, y: 9, z: 3 }, b: 1, c: 4 });
	});

	test("arrays are replaced, not merged", () => expect(
		deep_merge({ list: [1, 2] }, { list: [3] })
	).toEqual({ list: [3] }));
});

describe("merge_route_strings", () => {
	// Route namespaces resolve on translations[lang] directly (sibling to `routes`),
	// while the global strings come from translations[lang].routes.
	const translations = { sl: { routes: { ui: { nav: "Meni" } }, blog: { title: "Blog SL" } } };

	test("overlays the route namespace on top of global routes", () => {
		const merged = merge_route_strings(translations, "sl", "blog");
		expect(merged).toMatchObject({ ui: { nav: "Meni" }, title: "Blog SL" });
	});

	test("empty namespace yields just the global routes (cloned, not shared)", () => {
		const merged = merge_route_strings(translations, "sl", "");
		expect(merged).toEqual({ ui: { nav: "Meni" } });
		merged.ui.nav = "mutated";
		expect(translations.sl.routes.ui.nav).toBe("Meni");
	});
});
