import { existsSync, mkdirSync, rmSync, statSync, utimesSync } from "fs";
import { dirname, extname, relative, resolve } from "path";
import { Glob } from "bun";

type CandidateRecord = {
	s3_key?: string;
	updated_at?: string;
};

type CollectionResult = {
	data: CandidateRecord[];
	total: number;
	limit: number;
	offset: number;
};

type DynamicAssetKind = "images" | "files";

type SyncTally = {
	added: number;
	updated: number;
	deleted: number;
	unchanged: number;
};

export type DynamicAssetSyncResult = {
	images: SyncTally;
	files: SyncTally;
};

export type DynamicAssetSyncOptions = {
	base_url: string;
	project_root: string;
	force?: boolean;
};

type Candidate = {
	key: string;
	updated_at_ms: number;
};

const image_extensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const mtime_tolerance_ms = 1000;

function empty_tally(): SyncTally {
	return { added: 0, updated: 0, deleted: 0, unchanged: 0 };
}

function normalize_asset_key(asset_path: string): string {
	if (!asset_path || /^[a-z][a-z0-9+.-]*:/i.test(asset_path) || asset_path.startsWith("//")) {
		throw new Error(`Dynamic asset key must be relative: "${asset_path}"`);
	}
	if (asset_path.includes("\\") || asset_path.includes("?") || asset_path.includes("#")) {
		throw new Error(`Dynamic asset key contains unsupported characters: "${asset_path}"`);
	}

	const without_root = asset_path.replace(/^\/+/, "");
	const raw_segments = without_root.split("/");
	const segments: string[] = [];
	for (const raw_segment of raw_segments) {
		if (!raw_segment) continue;
		const segment = decodeURIComponent(raw_segment);
		if (segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")) {
			throw new Error(`Dynamic asset key escapes its root: "${asset_path}"`);
		}
		segments.push(segment);
	}
	if (segments.length === 0) {
		throw new Error("Dynamic asset key is empty.");
	}
	return segments.join("/");
}

function encoded_url_path(asset_key: string): string {
	const segments = asset_key.split("/");
	const encoded_segments = segments.map((segment) => encodeURIComponent(segment));
	return encoded_segments.join("/");
}

function assert_inside_root(root_dir: string, output_path: string): void {
	const relative_path = relative(root_dir, output_path);
	const outside_root = relative_path === ".." || relative_path.startsWith(`..\\`) ||
		relative_path.startsWith("../");
	if (outside_root) {
		throw new Error(`Dynamic asset output escapes "${root_dir}".`);
	}
}

function candidate_from_record(record: CandidateRecord, kind: DynamicAssetKind): Candidate {
	const key = normalize_asset_key(record.s3_key ?? "");
	if (kind === "images") {
		const extension = extname(key);
		const normalized_extension = extension.toLowerCase();
		if (!image_extensions.has(normalized_extension)) {
			throw new Error(`Dynamic image must be JPG, JPEG, PNG, or WebP: "${key}"`);
		}
	}

	const updated_at_ms = Date.parse(record.updated_at ?? "");
	if (!Number.isFinite(updated_at_ms)) {
		throw new Error(`Dynamic asset has an invalid updated_at value: "${key}"`);
	}
	return { key, updated_at_ms };
}

async function fetch_collection(base_url: string, kind: DynamicAssetKind): Promise<Candidate[]> {
	const records: CandidateRecord[] = [];
	let offset = 0;
	let total = 0;

	do {
		const collection_url = new URL(`/system/${kind}`, base_url);
		collection_url.searchParams.set("limit", "all");
		collection_url.searchParams.set("offset", String(offset));

		const response = await fetch(collection_url, {
			headers: { "Accept": "application/json" },
		});
		if (!response.ok) {
			throw new Error(`Reepolee ${kind} request returned ${response.status}: "${collection_url.href}"`);
		}

		const result = await response.json() as CollectionResult;
		if (!Array.isArray(result.data) || !Number.isFinite(result.total)) {
			throw new Error(`Reepolee ${kind} response is invalid.`);
		}
		records.push(...result.data);
		total = result.total;
		offset += result.data.length;

		if (result.data.length === 0 && offset < total) {
			throw new Error(`Reepolee ${kind} response stopped before all candidates were returned.`);
		}
	} while (offset < total);

	const candidates = records.map((record) => candidate_from_record(record, kind));
	const candidate_keys = new Set<string>();
	for (const candidate of candidates) {
		if (candidate_keys.has(candidate.key)) {
			throw new Error(`Reepolee ${kind} returned duplicate s3_key "${candidate.key}".`);
		}
		candidate_keys.add(candidate.key);
	}
	return candidates;
}

async function scan_local_keys(root_dir: string): Promise<string[]> {
	if (!existsSync(root_dir)) return [];
	const glob = new Glob("**/*");
	const keys: string[] = [];
	for await (const key of glob.scan({ cwd: root_dir, onlyFiles: true })) {
		const normalized_key = key.split("\\");
		keys.push(normalized_key.join("/"));
	}
	return keys;
}

function prepared_output_matches(output_key: string, asset_key: string): boolean {
	const output_parts = output_key.split("/");
	if (/^\d+$/.test(output_parts[0] ?? "")) {
		output_parts.shift();
	}
	const penultimate_index = output_parts.length - 2;
	if (penultimate_index >= 0 && /^\d+$/.test(output_parts[penultimate_index] ?? "")) {
		output_parts.splice(penultimate_index, 1);
	}
	const normalized_output = output_parts.join("/");
	const output_extension = extname(normalized_output);
	const asset_extension = extname(asset_key);
	const output_stem = normalized_output.slice(0, normalized_output.length - output_extension.length);
	const dynamic_asset_key = `dynamic/${asset_key}`;
	const asset_stem = dynamic_asset_key.slice(
		0,
		dynamic_asset_key.length - asset_extension.length,
	);
	return output_stem === asset_stem;
}

async function remove_prepared_image(project_root: string, asset_key: string): Promise<void> {
	const prepared_root = resolve(
		project_root,
		"src",
		"public",
		"images",
		"responsive",
	);
	const output_keys = await scan_local_keys(prepared_root);
	const matching_keys = output_keys.filter((output_key) => prepared_output_matches(output_key, asset_key));
	for (const output_key of matching_keys) {
		const output_path = resolve(prepared_root, output_key);
		assert_inside_root(prepared_root, output_path);
		rmSync(output_path, { force: true });
	}
}

function local_asset_root(project_root: string, kind: DynamicAssetKind): string {
	return resolve(project_root, "assets", kind, "dynamic");
}

function public_file_path(project_root: string, asset_key: string): string {
	return resolve(project_root, "src", "public", "files", "dynamic", asset_key);
}

async function download_candidate(
	base_url: string,
	kind: DynamicAssetKind,
	candidate: Candidate,
	output_path: string,
): Promise<Uint8Array> {
	const encoded_path = encoded_url_path(candidate.key);
	const source_url = new URL(`/${kind}/${encoded_path}`, base_url);
	const response = await fetch(source_url);
	if (!response.ok) {
		throw new Error(`Dynamic asset request returned ${response.status}: "${source_url.href}"`);
	}

	const asset_buffer = await response.arrayBuffer();
	const bytes = new Uint8Array(asset_buffer);
	mkdirSync(dirname(output_path), { recursive: true });
	await Bun.write(output_path, bytes);
	const updated_at = new Date(candidate.updated_at_ms);
	utimesSync(output_path, updated_at, updated_at);
	return bytes;
}

async function sync_kind(
	options: DynamicAssetSyncOptions,
	kind: DynamicAssetKind,
	candidates: Candidate[],
): Promise<SyncTally> {
	const tally = empty_tally();
	const asset_root = local_asset_root(options.project_root, kind);
	mkdirSync(asset_root, { recursive: true });
	const local_keys = await scan_local_keys(asset_root);
	const candidate_map = new Map(candidates.map((candidate) => [candidate.key, candidate]));

	const deleted_keys = local_keys.filter((key) => !candidate_map.has(key));
	const deleted_key_set = new Set(deleted_keys);
	const delete_operations = deleted_keys.map(async (deleted_key) => {
		const local_path = resolve(asset_root, deleted_key);
		assert_inside_root(asset_root, local_path);
		rmSync(local_path, { force: true });
		if (kind === "images") {
			await remove_prepared_image(options.project_root, deleted_key);
		} else {
			const public_path = public_file_path(options.project_root, deleted_key);
			rmSync(public_path, { force: true });
		}
		tally.deleted++;
	});
	await Promise.all(delete_operations);

	if (kind === "files") {
		const public_root = resolve(options.project_root, "src", "public", "files", "dynamic");
		const public_keys = await scan_local_keys(public_root);
		const orphaned_public_keys = public_keys.filter((key) => !candidate_map.has(key));
		const orphan_operations = orphaned_public_keys.map(async (orphaned_key) => {
			const public_path = resolve(public_root, orphaned_key);
			assert_inside_root(public_root, public_path);
			rmSync(public_path, { force: true });
			if (!deleted_key_set.has(orphaned_key)) {
				tally.deleted++;
			}
		});
		await Promise.all(orphan_operations);
	}

	const sync_operations = candidates.map(async (candidate) => {
		const output_path = resolve(asset_root, candidate.key);
		assert_inside_root(asset_root, output_path);
		const file_exists = existsSync(output_path);
		const local_mtime_ms = file_exists ? statSync(output_path).mtimeMs : 0;
		const mtime_difference = Math.abs(local_mtime_ms - candidate.updated_at_ms);
		const needs_download = options.force === true || !file_exists ||
			mtime_difference > mtime_tolerance_ms;

		if (!needs_download) {
			if (kind === "files") {
				const public_path = public_file_path(options.project_root, candidate.key);
				if (!existsSync(public_path)) {
					mkdirSync(dirname(public_path), { recursive: true });
					await Bun.write(public_path, Bun.file(output_path));
				}
			}
			tally.unchanged++;
			return;
		}

		const bytes = await download_candidate(
			options.base_url,
			kind,
			candidate,
			output_path,
		);
		if (kind === "images") {
			await remove_prepared_image(options.project_root, candidate.key);
		} else {
			const public_path = public_file_path(options.project_root, candidate.key);
			mkdirSync(dirname(public_path), { recursive: true });
			await Bun.write(public_path, bytes);
		}

		if (file_exists) {
			tally.updated++;
		} else {
			tally.added++;
		}
	});
	await Promise.all(sync_operations);

	return tally;
}

export async function sync_dynamic_assets(options: DynamicAssetSyncOptions): Promise<DynamicAssetSyncResult> {
	const [image_candidates, file_candidates] = await Promise.all([
		fetch_collection(options.base_url, "images"),
		fetch_collection(options.base_url, "files"),
	]);
	const [images, files] = await Promise.all([
		sync_kind(options, "images", image_candidates),
		sync_kind(options, "files", file_candidates),
	]);
	return { images, files };
}
