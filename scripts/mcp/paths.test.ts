import { sep } from "node:path";

import { describe, expect, test } from "bun:test";

import { build_code_search_args, resolve_template_file } from "./paths";

function to_native(posix_path: string): string {
	return posix_path.split("/").join(sep);
}

describe("MCP template paths", () => {
	test("allows .ree and .md files under src/public and src/components", () => {
		expect(resolve_template_file("src/public/index.ree")).toEndWith(
			to_native("src/public/index.ree")
		);
		expect(resolve_template_file("src/public/docs/index.md")).toEndWith(
			to_native("src/public/docs/index.md")
		);
		expect(resolve_template_file("src/components/my-h1.ree")).toEndWith(
			to_native("src/components/my-h1.ree")
		);
	});

	test("rejects environment files, traversal, and arbitrary project files", () => {
		for (const path of [
			".env",
			"src/public/../../.env",
			"src/public/index.ts",
			"package.json",
			"/etc/passwd",
			"src\\components\\my-h1.ree",
			"lib/template_engine.ts",
		]) { expect(() => resolve_template_file(path)).toThrow(); }
	});
});

describe("MCP code search arguments", () => {
	test("excludes secrets, VCS metadata, dependencies, dist, and archives", () => {
		const args = build_code_search_args("password");

		expect(args).toContain("!.env");
		expect(args).toContain("!**/.git/**");
		expect(args).toContain("!**/node_modules/**");
		expect(args).toContain("!**/dist/**");
		expect(args).toContain("!**/*.zip");
	});

	test("rejects an unsafe user-provided glob", () => {
		for (const glob of ["../.env", ".env", "**/.git/**", "**/*secret*"]) {
			expect(() => build_code_search_args("password", glob)).toThrow();
		}
	});
});
