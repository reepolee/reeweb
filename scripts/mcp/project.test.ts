import { describe, expect, test } from "bun:test";

import { analyze_template, list_pages } from "./project";

describe("analyze_template", () => test("extracts layout, components, variables, and translation keys", () => {
	const tpl = `
			{#layout('layout.ree')}
			<my-h1>{_ ui.welcome_title}</my-h1>
			{#if posts}
				{#each posts as post}<p>{= post.title }</p>{/each}
			{:else}
				<p>{_ ui.empty}</p>
			{/if}
		`;
	const result = analyze_template(tpl);

	expect(result.layout).toBe("layout.ree");
	expect(result.components).toContain("my-h1");
	expect(result.translation_keys).toEqual(["ui.empty", "ui.welcome_title"]);
	expect(result.conditionals).toBe(1);
	expect(result.loops).toBe(1);
	expect(result.hasElse).toBe(true);
}));

describe("list_pages", () => test("lists real project pages with canonical routes", () => {
	const pages = list_pages();
	const home = pages.find((p) => p.route === "/");

	expect(pages.length).toBeGreaterThan(0);
	expect(home).toBeDefined();
	expect(home?.kind).toBe("ree");
	for (const page of pages) {
		expect(page.route.startsWith("/")).toBe(true);
		expect(["ree", "md"]).toContain(page.kind);
	}
}));
