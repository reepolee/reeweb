import { join, resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import { resolve_include, resolve_layout } from "$lib/template/include_resolver";

// A fictitious but realistic layout: <project_root>/src/public is views_dir,
// <project_root>/src/{components,routes,lib} are what the $ aliases reach.
const project_root = resolve("/fake/project/src");
const views_dir = join(project_root, "public");
const ext = ".ree";

describe("resolve_include - legitimate paths still resolve", () => {
	test("bare views-root-relative name -> template", () => {
		expect(resolve_include("index", "about/index", views_dir, ext)).toEqual({
			kind: "template",
			template_name: "about/index",
		});
	});

	test("leading slash is stripped -> template", () => {
		expect(resolve_include("index", "/layouts/base", views_dir, ext)).toEqual({
			kind: "template",
			template_name: "layouts/base",
		});
	});

	test("./ relative to current template dir -> template", () => {
		expect(resolve_include("blog/index", "./sidebar", views_dir, ext)).toEqual({
			kind: "template",
			template_name: "blog/sidebar",
		});
	});

	test("../ one level up still inside views_dir -> template", () => {
		expect(resolve_include("blog/index", "../shared/footer", views_dir, ext)).toEqual({
			kind: "template",
			template_name: "shared/footer",
		});
	});

	test("explicit .ree extension, non-alias -> template, extension stripped", () => {
		expect(resolve_include("index", "./partial.ree", views_dir, ext)).toEqual({
			kind: "template",
			template_name: "partial",
		});
	});

	test("non-.ree extension -> raw file under views_dir", () => {
		const result = resolve_include("index", "./data.json", views_dir, ext);
		expect(result).toEqual({ kind: "raw", file_path: join(views_dir, "data.json") });
	});

	test("$components/ alias, no extension -> raw .ree path under src/components", () => {
		const result = resolve_include("index", "$components/card", views_dir, ext);
		expect(result).toEqual({ kind: "raw", file_path: join(project_root, "components/card.ree") });
	});

	test("$lib/ alias, explicit .ree extension -> raw path under src/lib", () => {
		const result = resolve_include("index", "$lib/helpers.ree", views_dir, ext);
		expect(result).toEqual({ kind: "raw", file_path: join(project_root, "lib/helpers.ree") });
	});

	test("$routes/ alias with nested path -> raw path under src/routes", () => {
		const result = resolve_include("index", "$routes/home/hero", views_dir, ext);
		expect(result).toEqual({ kind: "raw", file_path: join(project_root, "routes/home/hero.ree") });
	});
});

describe("resolve_include - traversal is blocked for every branch", () => {
	test("non-alias relative traversal past views_dir (no extension -> would-be template)", () => {
		expect(() => resolve_include("index", "../../secret", views_dir, ext)).toThrow(
			"Include path escapes base directory"
		);
	});

	test("non-alias relative traversal with explicit .ree extension", () => {
		expect(() => resolve_include("index", "../../secret.ree", views_dir, ext)).toThrow(
			"Include path escapes base directory"
		);
	});

	test("non-alias traversal with a non-.ree extension (raw file)", () => {
		expect(() => resolve_include("index", "../../../etc/passwd.txt", views_dir, ext)).toThrow(
			"Include path escapes base directory"
		);
	});

	test("deep traversal from a nested template still caught", () => {
		expect(() => resolve_include("a/b/c/index", "../../../../../../secret", views_dir, ext)).toThrow(
			"Include path escapes base directory"
		);
	});

	// Regression: alias paths had no containment check at all before this fix -
	// $lib/../../../secret_outside_repo resolved (and rendered) a template from
	// outside the entire project directory, not just outside views_dir.
	test("$lib/ traversal past the project root, no extension (was unchecked)", () => {
		expect(() => resolve_include("index", "$lib/../../../secret_outside_repo", views_dir, ext)).toThrow(
			"Include path escapes base directory"
		);
	});

	test("$components/ traversal past the project root, explicit .ree extension (was unchecked)", () => {
		expect(() => resolve_include("index", "$components/../../../secret.ree", views_dir, ext)).toThrow(
			"Include path escapes base directory"
		);
	});

	test("$routes/ traversal with a non-.ree extension (already checked pre-fix, still works)", () => {
		expect(() => resolve_include("index", "$routes/../../../secret.txt", views_dir, ext)).toThrow(
			"Include path escapes base directory"
		);
	});
});

// Layout names are never extension-sniffed: ".layout" in "docs.layout" is a
// naming convention, not a file extension. Resolution is co-location-first
// with a views-root fallback.
describe("resolve_layout - co-location first, views root fallback", () => {
	const no_files = () => false;
	const co_located_only = (file_path: string) => file_path.replace(/\\/g, "/").endsWith("/about/wallpaper.layout.ree");

	test("dotted convention name is kept intact, not read as an extension", () => {
		expect(resolve_layout("about/index", "docs.layout", views_dir, ext, no_files)).toBe("docs.layout");
	});

	test("bare name falls back to the views root when nothing is co-located", () => {
		expect(resolve_layout("about/index", "layout", views_dir, ext, no_files)).toBe("layout");
	});

	test("a co-located layout wins over the views root", () => {
		expect(resolve_layout("about/index", "wallpaper.layout", views_dir, ext, co_located_only)).toBe("about/wallpaper.layout");
	});

	test("explicitly relative name resolves against the page directory", () => {
		expect(resolve_layout("about/index", "./wallpaper.layout", views_dir, ext, no_files)).toBe("about/wallpaper.layout");
	});

	test("root-level page resolves at the views root", () => {
		expect(resolve_layout("index", "layout", views_dir, ext, no_files)).toBe("layout");
	});

	test("render_string (empty current name) is treated as the views root", () => {
		expect(resolve_layout("", "layout", views_dir, ext, no_files)).toBe("layout");
	});

	test("traversal out of the views directory is blocked", () => {
		expect(() => resolve_layout("about/index", "../../secret.layout", views_dir, ext, no_files)).toThrow("Include path escapes base directory");
	});
});
