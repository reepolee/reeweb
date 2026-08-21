import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

import { clear_directory } from "../shared/clear_directory";

export type FileChange = {
	path: string;
	kind: "added" | "changed" | "deleted";
	old_size: number;
	new_size: number;
	old_hash: string;
	new_hash: string;
	old_text?: string;
	new_text?: string;
};

type FileSnapshot = {
	size: number;
	hash: string;
	text?: string;
};

const TEXT_EXTENSIONS = new Set([
	".css",
	".csv",
	".html",
	".js",
	".json",
	".map",
	".md",
	".svg",
	".txt",
	".xml",
]);

function assert_project_path(project_root: string, target_path: string): void {
	const relative_path = relative(project_root, target_path);
	const is_outside = relative_path.startsWith("..") || resolve(target_path) === resolve(project_root);
	if (is_outside) { throw new Error(`Unsafe Publisher path: ${target_path}`); }
}

function content_hash(bytes: Uint8Array): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(bytes);
	return hasher.digest("hex");
}

async function scan_directory(directory: string): Promise<Map<string, FileSnapshot>> {
	const files = new Map<string, FileSnapshot>();
	if (!existsSync(directory)) return files;

	const glob = new Bun.Glob("**/*");
	for await (const relative_path of glob.scan({ cwd: directory, onlyFiles: true })) {
		const normalized_path = relative_path.replaceAll("\\", "/");
		const file = Bun.file(join(directory, relative_path));
		const bytes = new Uint8Array(await file.arrayBuffer());
		const raw_extension = extname(relative_path);
		const extension = raw_extension.toLowerCase();
		const snapshot: FileSnapshot = {
			size: bytes.byteLength,
			hash: content_hash(bytes),
		};
		if (TEXT_EXTENSIONS.has(extension) || !extension) {
			const decoder = new TextDecoder();
			snapshot.text = decoder.decode(bytes);
		}
		files.set(normalized_path, snapshot);
	}

	return files;
}

export async function diff_directories(
	deployed_dir: string,
	dist_dir: string,
): Promise<FileChange[]> {
	const [old_files, new_files] = await Promise.all([
		scan_directory(deployed_dir),
		scan_directory(dist_dir),
	]);
	const paths = new Set([...old_files.keys(), ...new_files.keys()]);
	const sorted_paths = [...paths];
	sorted_paths.sort();
	const changes: FileChange[] = [];

	for (const path of sorted_paths) {
		const old_file = old_files.get(path);
		const new_file = new_files.get(path);
		if (old_file?.hash === new_file?.hash) continue;

		const kind = !old_file ? "added" : !new_file ? "deleted" : "changed";
		changes.push({
			path,
			kind,
			old_size: old_file?.size ?? 0,
			new_size: new_file?.size ?? 0,
			old_hash: old_file?.hash ?? "",
			new_hash: new_file?.hash ?? "",
			old_text: old_file?.text,
			new_text: new_file?.text,
		});
	}

	return changes;
}

export function restore_dist(project_root: string): void {
	const dist_dir = join(project_root, "dist");
	const deployed_dir = join(project_root, ".deployed");
	assert_project_path(project_root, dist_dir);
	assert_project_path(project_root, deployed_dir);

	clear_directory(dist_dir);
	if (existsSync(deployed_dir)) {
		cpSync(deployed_dir, dist_dir, { recursive: true });
	}
}

export function snapshot_deployment(project_root: string): void {
	const dist_dir = join(project_root, "dist");
	const deployed_dir = join(project_root, ".deployed");
	assert_project_path(project_root, dist_dir);
	assert_project_path(project_root, deployed_dir);
	if (!existsSync(dist_dir)) { throw new Error("dist does not exist after deployment"); }

	if (existsSync(deployed_dir)) { rmSync(deployed_dir, { recursive: true, force: true }); }
	mkdirSync(deployed_dir, { recursive: true });
	cpSync(dist_dir, deployed_dir, { recursive: true });
}
