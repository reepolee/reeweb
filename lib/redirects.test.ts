import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
	build_stub_html,
	check_collisions_and_validate_targets,
	emit_redirects,
	load_and_validate_redirects,
	RedirectsError,
	type Redirect,
} from "$lib/redirects";

// ---------------------------------------------------------------------------
// load_and_validate_redirects
// ---------------------------------------------------------------------------

describe("load_and_validate_redirects", () => {
	test("accepts a well-formed array", () => {
		const input: Redirect[] = [
			{ from: "/resume", to: "/files/resume.pdf" },
			{ from: "/talk", to: "https://youtube.com/watch?v=x", status: 302 },
		];

		const out = load_and_validate_redirects(input);

		expect(out).toEqual([
			{ from: "/resume", to: "/files/resume.pdf", status: undefined },
			{ from: "/talk", to: "https://youtube.com/watch?v=x", status: 302 },
		]);
	});

	test("normalizes trailing slash on `from`", () => {
		const out = load_and_validate_redirects([{ from: "/resume/", to: "/files/r.pdf" }]);

		expect(out[0]?.from).toBe("/resume");
	});

	test("preserves the root `/` form", () => {
		const out = load_and_validate_redirects([{ from: "/", to: "/home" }]);

		expect(out[0]?.from).toBe("/");
	});

	test("rejects non-array input", () => expect(() => load_and_validate_redirects({} as unknown)).toThrow(
		RedirectsError
	));

	test("rejects entry without leading slash on `from`", () => {
		const input = [{ from: "resume", to: "/files/r.pdf" }];

		expect(() => load_and_validate_redirects(input)).toThrow(/must start with "\/"/);
	});

	test("rejects `from` whose last segment has a file extension", () => {
		const input = [{ from: "/files/resume.pdf", to: "/x" }];

		expect(() => load_and_validate_redirects(input)).toThrow(/file extension/);
	});

	test("rejects empty `to`", () => {
		const input = [{ from: "/x", to: "" }];

		expect(() => load_and_validate_redirects(input)).toThrow(/non-empty/);
	});

	test("rejects invalid status code", () => {
		const input = [{ from: "/x", to: "/y", status: 307 }];

		expect(() => load_and_validate_redirects(input)).toThrow(/301 or 302/);
	});

	test("rejects duplicate `from` (including slash variants)", () => {
		const input = [{ from: "/resume", to: "/a.pdf" }, { from: "/resume/", to: "/b.pdf" }];

		expect(() => load_and_validate_redirects(input)).toThrow(/duplicate/);
	});

	test("accepts an empty array", () => expect(load_and_validate_redirects([])).toEqual([]));
});

// ---------------------------------------------------------------------------
// check_collisions_and_validate_targets
// ---------------------------------------------------------------------------

describe("check_collisions_and_validate_targets", () => {
	let tmp = "";

	afterEach(() => {
		if (tmp) {
			rmSync(tmp, { recursive: true, force: true });
			tmp = "";
		}
	});

	function setup_dist(files: string[]): string {
		tmp = mkdtempSync(join(tmpdir(), "reeweb-redirects-"));
		for (const rel of files) {
			const full = join(tmp, rel);
			mkdirSync(join(tmp, rel, ".."), { recursive: true });
			writeFileSync(full, "x");
		}
		return tmp;
	}

	test("passes when target file exists in dist", () => {
		const dist = setup_dist(["files/resume.pdf"]);
		const redirects: Redirect[] = [{ from: "/resume", to: "/files/resume.pdf" }];

		expect(() => check_collisions_and_validate_targets(redirects, dist, new Set(), new Set())).not.toThrow();
	});

	test("passes when target is a directory with index.html", () => {
		const dist = setup_dist(["blog/foo/index.html"]);
		const redirects: Redirect[] = [{ from: "/r", to: "/blog/foo" }];

		expect(() => check_collisions_and_validate_targets(redirects, dist, new Set(), new Set())).not.toThrow();
	});

	test("passes external URL without checking dist", () => {
		const dist = setup_dist([]);
		const redirects: Redirect[] = [{ from: "/talk", to: "https://example.com/x" }];

		expect(() => check_collisions_and_validate_targets(redirects, dist, new Set(), new Set())).not.toThrow();
	});

	test("fails when internal target is missing", () => {
		const dist = setup_dist([]);
		const redirects: Redirect[] = [{ from: "/r", to: "/files/missing.pdf" }];

		expect(() => check_collisions_and_validate_targets(redirects, dist, new Set(), new Set())).toThrow(
			/does not exist/
		);
	});

	test("fails when `from` collides with a generated page (directory form)", () => {
		const dist = setup_dist(["files/resume.pdf"]);
		const redirects: Redirect[] = [{ from: "/about", to: "/files/resume.pdf" }];
		const generated = new Set(["/about/"]);

		expect(() => check_collisions_and_validate_targets(redirects, dist, generated, new Set())).toThrow(
			/collides with a generated page/
		);
	});

	test("fails when `from` collides with a static asset", () => {
		const dist = setup_dist(["files/resume.pdf"]);
		const redirects: Redirect[] = [{ from: "/LICENSE", to: "/files/resume.pdf" }];
		const static_assets = new Set(["/LICENSE"]);

		expect(() => check_collisions_and_validate_targets(
			redirects,
			dist,
			new Set(),
			static_assets
		)).toThrow(/collides with a static asset/);
	});
});

// ---------------------------------------------------------------------------
// emit_redirects + build_stub_html
// ---------------------------------------------------------------------------

describe("emit_redirects", () => {
	let tmp = "";

	afterEach(() => {
		if (tmp) {
			rmSync(tmp, { recursive: true, force: true });
			tmp = "";
		}
	});

	test("writes _redirects with two lines per entry (slash variants)", async () => {
		tmp = mkdtempSync(join(tmpdir(), "reeweb-redirects-emit-"));
		const redirects: Redirect[] = [
			{ from: "/resume", to: "/files/r.pdf" },
			{ from: "/talk", to: "https://x.example/y", status: 302 },
		];

		await emit_redirects(redirects, tmp);

		const text = await Bun.file(join(tmp, "_redirects")).text();
		expect(text).toBe(
			"/resume /files/r.pdf 301\n" + "/resume/ /files/r.pdf 301\n" + "/talk https://x.example/y 302\n" + "/talk/ https://x.example/y 302\n"
		);
	});

	test("writes HTML stub at dist/{from}/index.html", async () => {
		tmp = mkdtempSync(join(tmpdir(), "reeweb-redirects-emit-"));
		await emit_redirects([{ from: "/resume", to: "/files/r.pdf" }], tmp);

		const stub = await Bun.file(join(tmp, "resume/index.html")).text();
		expect(stub).toContain("<meta http-equiv=\"refresh\" content=\"0;url=/files/r.pdf\">");
		expect(stub).toContain("<link rel=\"canonical\" href=\"/files/r.pdf\">");
	});

	test("is a no-op for an empty array", async () => {
		tmp = mkdtempSync(join(tmpdir(), "reeweb-redirects-emit-"));
		await emit_redirects([], tmp);

		expect(await Bun.file(join(tmp, "_redirects")).exists()).toBe(false);
	});
});

describe("build_stub_html", () => {
	test("includes canonical for internal target", () => {
		const html = build_stub_html("/files/r.pdf");

		expect(html).toContain("<link rel=\"canonical\" href=\"/files/r.pdf\">");
	});

	test("omits canonical for external target", () => {
		const html = build_stub_html("https://x.example/y");

		expect(html).not.toContain("rel=\"canonical\"");
	});

	test("HTML-escapes the target", () => {
		const html = build_stub_html("/files/a&b.pdf");

		expect(html).toContain("/files/a&amp;b.pdf");
		expect(html).not.toContain("/files/a&b.pdf");
	});
});
