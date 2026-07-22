/**
 * scripts/ssg.test.ts
 *
 * Tests for the content-collection validator (`validate_entries`). The function
 * is exported from ssg.ts; the SSG itself only runs under `import.meta.main`,
 * so importing it here does NOT trigger an SSG pass.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { z } from "$vendor/zod.min.js";

import { validate_entries } from "./ssg";

const schema = z.object({
	title: z.string().min(1),
	published_at: z.coerce.date(),
	authors: z.array(z.string()).optional(),
}).passthrough();

let dir: string;

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "reeweb-collections-"));
	mkdirSync(join(dir, "blog"), { recursive: true });

	const write = (rel: string, body: string) => writeFileSync(join(dir, rel), body);

	write("blog/good.md", `---\ntitle: Hello\npublished_at: "2026-01-02"\nextra: kept\n---\n# Body`);
	write("blog/missing-title.md", `---\npublished_at: "2026-01-02"\n---\n# Body`);
	write("blog/bad-date.md", `---\ntitle: Hi\npublished_at: "not-a-date"\n---\n# Body`);
	write("blog/wrong-type.md", `---\ntitle: 123\npublished_at: "2026-01-02"\n---\n# Body`);
	write("blog/good.sl.md", `---\ntitle: Zdravo\npublished_at: "2026-01-02"\n---\n# Telo`);
	write("blog/bad-variant.sl.md", `---\npublished_at: "2026-01-02"\n---\n# Telo`); // missing title
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("validate_entries", () => {
	test("a valid entry yields no issues (extra keys pass through)", () => {
		const issues = validate_entries(schema, ["blog/good.md"], dir);
		expect(issues).toEqual([]);
	});

	test("a missing required field is reported", () => {
		const issues = validate_entries(schema, ["blog/missing-title.md"], dir);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({ file: "blog/missing-title.md", field: "title" });
	});

	test("an unparseable date is reported", () => {
		const issues = validate_entries(schema, ["blog/bad-date.md"], dir);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({ file: "blog/bad-date.md", field: "published_at" });
	});

	test("a wrong-typed field is reported", () => {
		const issues = validate_entries(schema, ["blog/wrong-type.md"], dir);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({ file: "blog/wrong-type.md", field: "title" });
	});

	test("language variants are each validated", () => {
		const issues = validate_entries(schema, ["blog/good.sl.md", "blog/bad-variant.sl.md"], dir);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({ file: "blog/bad-variant.sl.md", field: "title" });
	});

	test("issues across multiple files are aggregated", () => {
		const files = ["blog/good.md", "blog/missing-title.md", "blog/bad-date.md"];
		const issues = validate_entries(schema, files, dir);
		expect(issues).toHaveLength(2);
	});
});
