import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { diff_directories, restore_dist, snapshot_deployment } from "./files";

const temporary_dirs: string[] = [];

function temporary_project(): string {
	const project_root = mkdtempSync(join(tmpdir(), "reeweb-publisher-"));
	temporary_dirs.push(project_root);
	return project_root;
}

afterEach(() => {
	for (const temporary_dir of temporary_dirs.splice(0)) {
		rmSync(temporary_dir, { recursive: true, force: true });
	}
});

describe("publisher files", () => {
	test("classifies added, changed, and deleted generated files", async () => {
		const project_root = temporary_project();
		const deployed_dir = join(project_root, ".deployed");
		const dist_dir = join(project_root, "dist");
		await Bun.write(join(deployed_dir, "same.html"), "same");
		await Bun.write(join(deployed_dir, "changed.html"), "old");
		await Bun.write(join(deployed_dir, "deleted.txt"), "gone");
		await Bun.write(join(dist_dir, "same.html"), "same");
		await Bun.write(join(dist_dir, "changed.html"), "new");
		await Bun.write(join(dist_dir, "added.css"), "body{}");

		const changes = await diff_directories(deployed_dir, dist_dir);
		const summary = changes.map((change) => `${change.kind}:${change.path}`);

		expect(summary).toEqual([
			"added:added.css",
			"changed:changed.html",
			"deleted:deleted.txt",
		]);
	});

	test("snapshots a successful deployment and restores failed output", async () => {
		const project_root = temporary_project();
		const dist_file = join(project_root, "dist", "index.html");
		const deployed_file = join(project_root, ".deployed", "index.html");
		await Bun.write(dist_file, "deployed");

		snapshot_deployment(project_root);
		expect(await Bun.file(deployed_file).text()).toBe("deployed");

		await Bun.write(dist_file, "partial");
		restore_dist(project_root);

		expect(await Bun.file(dist_file).text()).toBe("deployed");
	});

	test("clears partial dist without removing it when no deployment snapshot exists", async () => {
		const project_root = temporary_project();
		const dist_dir = join(project_root, "dist");
		await Bun.write(join(dist_dir, "partial.html"), "partial");

		restore_dist(project_root);

		const glob = new Bun.Glob("**/*");
		const scan = glob.scan({ cwd: dist_dir });
		const entries = await Array.fromAsync(scan);
		expect(existsSync(dist_dir)).toBe(true);
		expect(entries).toEqual([]);
	});
});
