import { extname, resolve } from "path";

type DynamicAssetKind = "image" | "file";

export type DynamicAssetHandlerOptions = {
	project_root?: string;
};

function default_project_root(): string {
	return resolve(import.meta.dir, "../..");
}

function asset_kind(property_name: string): DynamicAssetKind | null {
	if (property_name.endsWith("_image")) return "image";
	if (property_name.endsWith("_file")) return "file";
	return null;
}

function normalize_asset_key(asset_path: string, kind: DynamicAssetKind): string {
	if (/^[a-z][a-z0-9+.-]*:/i.test(asset_path) || asset_path.startsWith("//")) {
		throw new Error(`Dynamic asset path must be relative: "${asset_path}"`);
	}
	if (asset_path.includes("\\") || asset_path.includes("?") || asset_path.includes("#")) {
		throw new Error(`Dynamic asset path contains unsupported characters: "${asset_path}"`);
	}

	let normalized_path = asset_path.replace(/^\/+/, "");
	const route_prefix = kind === "image" ? "images/" : "files/";
	if (normalized_path.startsWith(route_prefix)) {
		normalized_path = normalized_path.slice(route_prefix.length);
	}

	const raw_segments = normalized_path.split("/");
	const segments: string[] = [];
	for (const raw_segment of raw_segments) {
		if (!raw_segment) continue;
		const segment = decodeURIComponent(raw_segment);
		if (segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")) {
			throw new Error(`Dynamic asset path escapes its root: "${asset_path}"`);
		}
		segments.push(segment);
	}

	if (segments.length === 0) {
		throw new Error("Dynamic asset path is empty.");
	}
	return segments.join("/");
}

function content_fingerprint(bytes: Uint8Array): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(bytes);
	const digest = hasher.digest("hex");
	return digest.slice(0, 12);
}

function encoded_url_path(asset_key: string): string {
	const segments = asset_key.split("/");
	const encoded_segments = segments.map((segment) => encodeURIComponent(segment));
	return encoded_segments.join("/");
}

async function local_public_url(
	kind: DynamicAssetKind,
	asset_path: string,
	project_root: string,
): Promise<string> {
	const asset_key = normalize_asset_key(asset_path, kind);
	const asset_subdir = kind === "image" ? "images" : "files";
	const asset_file_path = resolve(project_root, "assets", asset_subdir, "dynamic", asset_key);
	const asset_file = Bun.file(asset_file_path);
	if (!await asset_file.exists()) {
		throw new Error(`Dynamic ${kind} has not been synchronized: "${asset_path}"`);
	}

	if (kind === "image") {
		const extension = extname(asset_key);
		const normalized_extension = extension.toLowerCase();
		if (![".jpg", ".jpeg", ".png", ".webp"].includes(normalized_extension)) {
			throw new Error(`Dynamic image must be JPG, JPEG, PNG, or WebP: "${asset_path}"`);
		}
	}

	const bytes = await asset_file.bytes();
	const fingerprint = content_fingerprint(bytes);
	let public_asset_key = asset_key;
	const source_extension = extname(asset_key);
	if (kind === "image" && source_extension.toLowerCase() === ".webp") {
		const asset_stem = asset_key.slice(0, asset_key.length - source_extension.length);
		public_asset_key = `${asset_stem}.jpg`;
	}
	const encoded_path = encoded_url_path(public_asset_key);
	const public_prefix = kind === "image" ? "/images/responsive/dynamic" : "/files/dynamic";
	return `${public_prefix}/${encoded_path}?v=${fingerprint}`;
}

async function rewrite_value(
	value: unknown,
	project_root: string,
	url_cache: Map<string, Promise<string>>,
): Promise<void> {
	if (Array.isArray(value)) {
		const operations = value.map((entry) => rewrite_value(entry, project_root, url_cache));
		await Promise.all(operations);
		return;
	}
	if (value === null || typeof value !== "object") return;

	const record = value as Record<string, unknown>;
	const entries = Object.entries(record);
	const operations = entries.map(async ([property_name, property_value]) => {
		const kind = asset_kind(property_name);
		if (kind && typeof property_value === "string" && property_value !== "") {
			const cache_key = `${kind}:${property_value}`;
			let public_url = url_cache.get(cache_key);
			if (!public_url) {
				public_url = local_public_url(kind, property_value, project_root);
				url_cache.set(cache_key, public_url);
			}
			record[property_name] = await public_url;
			return;
		}
		await rewrite_value(property_value, project_root, url_cache);
	});
	await Promise.all(operations);
}

export async function handle_dynamic_assets<T>(
	data: T,
	options: DynamicAssetHandlerOptions = {},
): Promise<T> {
	const project_root = options.project_root ?? default_project_root();
	const url_cache = new Map<string, Promise<string>>();
	await rewrite_value(data, project_root, url_cache);
	return data;
}
