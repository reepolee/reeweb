import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { handle_dynamic_assets } from "./dynamic_assets";

const temporary_dirs: string[] = [];

function temporary_directory(): string {
	const directory = mkdtempSync(join(tmpdir(), "reeweb-dynamic-handler-"));
	temporary_dirs.push(directory);
	return directory;
}

afterEach(() => {
	for (const temporary_dir of temporary_dirs.splice(0)) {
		rmSync(temporary_dir, { recursive: true, force: true });
	}
});

describe("handle_dynamic_assets", () => {
	test("rewrites nested image and file fields from synchronized local assets", async () => {
		const project_root = temporary_directory();
		await Promise.all([
			Bun.write(
				join(project_root, "assets", "images", "dynamic", "team", "alice.webp"),
				new Uint8Array([1, 2, 3]),
			),
			Bun.write(
				join(project_root, "assets", "files", "dynamic", "documents", "profile.pdf"),
				new Uint8Array([4, 5, 6]),
			),
		]);
		const data = [{
			profile_image: "/images/team/alice.webp",
			documents: [{ profile_file: "files/documents/profile.pdf" }],
		}];

		const result = await handle_dynamic_assets(data, { project_root });

		expect(result[0]?.profile_image).toMatch(
			/^\/images\/responsive\/dynamic\/team\/alice\.jpg\?v=[a-f0-9]{12}$/,
		);
		expect(result[0]?.documents[0]?.profile_file).toMatch(
			/^\/files\/dynamic\/documents\/profile\.pdf\?v=[a-f0-9]{12}$/,
		);
	});

	test("fails when referenced data is not present in the synchronized candidates", async () => {
		const project_root = temporary_directory();

		const operation = handle_dynamic_assets(
			[{ profile_image: "/images/missing.jpg" }],
			{ project_root },
		);

		expect(operation).rejects.toThrow("has not been synchronized");
	});
});
