/**
 * Tests for demo content removal. Uses a temp public dir fixture so the
 * real src/public is never touched.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { remove_demo_content } from "./demo_content";

let pub: string;

beforeAll(async () => {
	pub = mkdtempSync(join(tmpdir(), "reeweb-demo-content-"));

	mkdirSync(join(pub, "about"), { recursive: true });
	mkdirSync(join(pub, "contact"), { recursive: true });
	mkdirSync(join(pub, "blog"), { recursive: true });
	mkdirSync(join(pub, "docs"), { recursive: true });

	await Bun.write(join(pub, "index.ree"), "demo homepage");
	await Bun.write(join(pub, "index.ts"), "demo loader");
	await Bun.write(join(pub, "about", "index.en.ree"), "demo about");
	await Bun.write(join(pub, "contact", "index.ree"), "demo contact");
	await Bun.write(join(pub, "blog", "01_starter-blog-post.md"), "demo post");
	await Bun.write(join(pub, "blog", "index.ree"), "demo blog index");
	await Bun.write(join(pub, "blog", "_schema.ts"), "export const schema = {};");
	await Bun.write(join(pub, "docs", "index.md"), "demo docs");
	await Bun.write(join(pub, "team.json"), "{}");
	await Bun.write(join(pub, "academic.layout.ree"), "demo layout");
	await Bun.write(join(pub, "plain.layout.ree"), "demo layout");

	await Bun.write(join(pub, "en.json"), JSON.stringify({
		nav: { home: "Home", about: "About", blog: "Blog", contact: "Contact" },
		site_name: "My Site",
		ui: {
			welcome_title: "Welcome",
			welcome_text: "Text",
			feature_1_title: "F1",
			pagination: { next: "Next", previous: "Previous" },
		},
	}, null, "\t") + "\n");

	await Bun.write(join(pub, "layout.ree"), [
		"<nav>",
		'\t<a href="{~ localized_path(\'/\') }">Home</a>',
		'\t<a href="{~ localized_path(\'/about\') }">{_ nav.about}</a>',
		'\t<a href="{~ localized_path(\'/contact\') }">{_ nav.contact}</a>',
		'\t<a href="{~ localized_path(\'/blog\') }">{_ nav.blog}</a>',
		'\t<a href="{~ localized_path(\'/docs\') }">Docs</a>',
		"</nav>",
	].join("\n"));
});

afterAll(() => rmSync(pub, { recursive: true, force: true }));

describe("remove_demo_content", () => {
	test("deletes demo paths and keeps non-demo files", () => {
		const report = remove_demo_content(pub);

		expect(report.replaced).toContain("src/public/index.ree");
		expect(report.removed).not.toContain("src/public/index.ree");
		expect(report.removed).toContain("src/public/index.ts");
		expect(report.removed).toContain("src/public/about");
		expect(report.removed).toContain("src/public/contact");
		expect(report.removed).toContain("src/public/docs");
		expect(report.removed).toContain("src/public/team.json");
		expect(report.removed).toContain("src/public/academic.layout.ree");
		expect(report.removed).toContain("src/public/plain.layout.ree");

		expect(existsSync(join(pub, "blog", "_schema.ts"))).toBe(true);
		expect(existsSync(join(pub, "layout.ree"))).toBe(true);
	});

	test("replaces index.ree with a stub instead of deleting it", async () => {
		expect(existsSync(join(pub, "index.ree"))).toBe(true);

		const home = await Bun.file(join(pub, "index.ree")).text();
		expect(home).toBe("<h1>Home</h1>\n");
	});

	test("strips demo translation keys but keeps shared keys", async () => {
		const en = await Bun.file(join(pub, "en.json")).json();

		expect(en.nav.home).toBe("Home");
		expect(en.site_name).toBe("My Site");
		expect(en.ui.pagination).toEqual({ next: "Next", previous: "Previous" });

		expect(en.nav.about).toBeUndefined();
		expect(en.nav.blog).toBeUndefined();
		expect(en.nav.contact).toBeUndefined();
		expect(en.ui.welcome_title).toBeUndefined();
		expect(en.ui.feature_1_title).toBeUndefined();
	});

	test("removes demo nav links from layout.ree but keeps the home link", async () => {
		const layout = await Bun.file(join(pub, "layout.ree")).text();

		expect(layout).toContain("localized_path('/')");
		expect(layout).not.toContain("localized_path('/about')");
		expect(layout).not.toContain("localized_path('/contact')");
		expect(layout).not.toContain("localized_path('/blog')");
		expect(layout).not.toContain("localized_path('/docs')");
	});

	test("reports not_found for paths already absent, without throwing", () => {
		const report = remove_demo_content(pub);
		expect(report.removed).toEqual([]);
		expect(report.replaced).toContain("src/public/index.ree");
		expect(report.not_found).not.toContain("src/public/index.ree");
	});
});
