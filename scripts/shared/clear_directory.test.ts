import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { clear_directory } from "./clear_directory";

const temporary_dirs: string[] = [];

function temporary_directory(): string {
	const directory = mkdtempSync(join(tmpdir(), "reeweb-clear-directory-"));
	temporary_dirs.push(directory);
	return directory;
}

afterEach(() => {
	for (const temporary_dir of temporary_dirs.splice(0)) {
		rmSync(temporary_dir, { recursive: true, force: true });
	}
});

describe("clear_directory", () => {
	test("removes child entries while preserving the directory", async () => {
		const directory = temporary_directory();
		await Bun.write(join(directory, "nested", "index.html"), "page");
		await Bun.write(join(directory, "asset.css"), "body{}");

		clear_directory(directory);

		expect(existsSync(directory)).toBe(true);
		expect(readdirSync(directory)).toEqual([]);
	});

	test("creates a missing directory", () => {
		const parent_dir = temporary_directory();
		const directory = join(parent_dir, "dist");

		clear_directory(directory);

		expect(existsSync(directory)).toBe(true);
		expect(readdirSync(directory)).toEqual([]);
	});
});
