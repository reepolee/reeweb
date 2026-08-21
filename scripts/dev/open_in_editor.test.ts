/**
 * Tests for the inspector open-request path guard. The launcher itself
 * (Bun.spawnSync code --goto) is not exercised here - it spawns an external
 * editor - but the validation gate that guards it is fully covered.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { IDE_COMMANDS, configured_ide, open_in_editor_at, validate_open_request } from "./open_in_editor";

const project_root = resolve(".");

describe("validate_open_request", () => {
	test("accepts a real source-relative file with a line", () => {
		const r = validate_open_request(project_root, "package.json", "5");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.line).toBe(5);
	});

	test("defaults line to 1 when missing or non-numeric", () => {
		const r = validate_open_request(project_root, "package.json", null);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.line).toBe(1);
	});

	test("rejects a path escaping the project root (403)", () => {
		const r = validate_open_request(project_root, "../../../../etc/passwd", "1");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.status).toBe(403);
	});

	test("rejects a sneaky mid-path traversal (403)", () => {
		const r = validate_open_request(project_root, "src/../../secrets.ts", "1");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.status).toBe(403);
	});

	test("rejects an absolute path (400)", () => {
		const r = validate_open_request(project_root, resolve("package.json"), "1");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.status).toBe(400);
	});

	test("rejects a missing file param (400)", () => {
		const r = validate_open_request(project_root, null, "1");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.status).toBe(400);
	});

	test("rejects a nonexistent in-root file (404)", () => {
		const r = validate_open_request(project_root, "src/public/__nope__.ree", "1");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.status).toBe(404);
	});
});

describe("IDE selection (OPEN_IDE, strict)", () => {
	let saved: string | undefined;
	beforeEach(() => saved = process.env.OPEN_IDE);
	afterEach(() => {
		if (saved === undefined) delete process.env.OPEN_IDE; else process.env.OPEN_IDE = saved;
	});

	test("configured_ide reads OPEN_IDE from the environment", () => {
		process.env.OPEN_IDE = "zed";
		expect(configured_ide()).toBe("zed");
	});

	test("launch fails clearly when OPEN_IDE is unset (no default)", () => {
		delete process.env.OPEN_IDE;
		const r = open_in_editor_at("/tmp/x.ree", 3);
		expect(r.success).toBe(false);
		expect(r.error).toContain("OPEN_IDE is not set");
	});

	test("launch fails clearly on an unknown OPEN_IDE key", () => {
		process.env.OPEN_IDE = "notepad";
		const r = open_in_editor_at("/tmp/x.ree", 3);
		expect(r.success).toBe(false);
		expect(r.error).toContain("unknown OPEN_IDE");
	});

	test("every IDE_COMMANDS template carries {file} and {line} placeholders", () => {
		for (const [key, argv] of Object.entries(IDE_COMMANDS)) {
			const joined = argv.join(" ");
			expect(joined, `${key} missing {file}`).toContain("{file}");
			expect(joined, `${key} missing {line}`).toContain("{line}");
		}
	});
});
