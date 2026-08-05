import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { sync_dynamic_assets } from "./sync";

const temporary_dirs: string[] = [];
const servers: Bun.Server<undefined>[] = [];

function temporary_directory(): string {
	const directory = mkdtempSync(join(tmpdir(), "reeweb-dynamic-sync-"));
	temporary_dirs.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.stop(true)));
	for (const temporary_dir of temporary_dirs.splice(0)) {
		rmSync(temporary_dir, { recursive: true, force: true });
	}
});

describe("sync_dynamic_assets", () => {
	test("downloads only added or changed candidates and removes deleted files", async () => {
		let image_bytes = new Uint8Array([1, 2, 3, 4]);
		const file_bytes = new Uint8Array([5, 6, 7]);
		let image_updated_at = "2026-07-23T10:00:00.000Z";
		let image_downloads = 0;
		let file_downloads = 0;
		const server = Bun.serve({
			port: 0,
			fetch(request) {
				const url = new URL(request.url);
				if (url.pathname === "/system/images") {
					return Response.json({
						data: [{
							s3_key: "team/alice.webp",
							updated_at: image_updated_at,
						}],
						total: 1,
						limit: 500,
						offset: 0,
					});
				}
				if (url.pathname === "/system/files") {
					return Response.json({
						data: [{
							s3_key: "documents/profile.pdf",
							updated_at: "2026-07-23T10:00:00.000Z",
						}],
						total: 1,
						limit: 500,
						offset: 0,
					});
				}
				if (url.pathname === "/images/team/alice.webp") {
					image_downloads++;
					return new Response(image_bytes);
				}
				if (url.pathname === "/files/documents/profile.pdf") {
					file_downloads++;
					return new Response(file_bytes);
				}
				return new Response("not found", { status: 404 });
			},
		});
		servers.push(server);

		const project_root = temporary_directory();
		const stale_image = join(project_root, "assets", "images", "dynamic", "stale.jpg");
		const stale_file = join(project_root, "src", "public", "files", "dynamic", "stale.pdf");
		const stale_prepared = join(
			project_root,
			"src",
			"public",
			"images",
			"responsive",
			"dynamic",
			"stale.webp",
		);
		await Promise.all([
			Bun.write(stale_image, "stale"),
			Bun.write(stale_file, "stale"),
			Bun.write(stale_prepared, "stale"),
		]);

		const base_url = `http://127.0.0.1:${server.port}`;
		const first_result = await sync_dynamic_assets({ base_url, project_root });

		const synchronized_image = join(
			project_root,
			"assets",
			"images",
			"dynamic",
			"team",
			"alice.webp",
		);
		const synchronized_file = join(
			project_root,
			"assets",
			"files",
			"dynamic",
			"documents",
			"profile.pdf",
		);
		const public_file = join(
			project_root,
			"src",
			"public",
			"files",
			"dynamic",
			"documents",
			"profile.pdf",
		);

		expect(await Bun.file(synchronized_image).bytes()).toEqual(image_bytes);
		expect(await Bun.file(synchronized_file).bytes()).toEqual(file_bytes);
		expect(await Bun.file(public_file).bytes()).toEqual(file_bytes);
		expect(existsSync(stale_image)).toBe(false);
		expect(existsSync(stale_file)).toBe(false);
		expect(existsSync(stale_prepared)).toBe(false);
		expect(first_result.images).toEqual({ added: 1, updated: 0, deleted: 1, unchanged: 0 });
		expect(first_result.files).toEqual({ added: 1, updated: 0, deleted: 1, unchanged: 0 });
		expect(image_downloads).toBe(1);
		expect(file_downloads).toBe(1);

		const second_result = await sync_dynamic_assets({ base_url, project_root });

		expect(second_result.images.unchanged).toBe(1);
		expect(second_result.files.unchanged).toBe(1);
		expect(image_downloads).toBe(1);
		expect(file_downloads).toBe(1);

		image_bytes = new Uint8Array([8, 9, 10]);
		image_updated_at = "2026-07-23T11:00:00.000Z";
		await Bun.write(
			join(
				project_root,
				"src",
				"public",
				"images",
				"responsive",
				"dynamic",
				"team",
				"alice.webp",
			),
			"old prepared image",
		);

		const third_result = await sync_dynamic_assets({ base_url, project_root });

		expect(third_result.images.updated).toBe(1);
		expect(image_downloads).toBe(2);
		expect(await Bun.file(synchronized_image).bytes()).toEqual(image_bytes);
		const prepared_image = join(
			project_root,
			"src",
			"public",
			"images",
			"responsive",
			"dynamic",
			"team",
			"alice.webp",
		);
		expect(existsSync(prepared_image)).toBe(false);

		const force_result = await sync_dynamic_assets({ base_url, project_root, force: true });

		expect(force_result.images.updated).toBe(1);
		expect(force_result.files.updated).toBe(1);
		expect(image_downloads).toBe(3);
		expect(file_downloads).toBe(2);
	});
});
