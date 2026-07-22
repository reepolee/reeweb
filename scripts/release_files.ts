import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { tmpdir } from "os";

const RELEASE_IGNORE = ".releaseignore";
const OVERRIDE_SUFFIX_RE = /\.override(\.[^./\\]+)?$/;
const HASH_COMMENT_RE = /^\/\/\s*@release-sync-hash:\s*([a-f0-9]+)/m;

type IgnoreRule = {
	negate: boolean;
	dir_only: boolean;
	regex: RegExp;
};

type ReleaseEntry = {
	rel_path: string;
	abs_path: string;
	is_dir: boolean;
};

function override_path_for_original(original_path: string): string {
	const extension_match = /(?<=[^/\\])\.[^./\\]+$/.exec(original_path);
	if (!extension_match) return original_path + ".override";
	return original_path.slice(0, extension_match.index) + ".override" + extension_match[0];
}

function original_path_for_override(override_path: string): string | null {
	const match = OVERRIDE_SUFFIX_RE.exec(override_path);
	if (!match) return null;
	return override_path.slice(0, match.index) + (match[1] ?? "");
}

function parse_ignore_file(file_path: string): IgnoreRule[] {
	const rules: IgnoreRule[] = [];
	const text = readFileSync(file_path, "utf-8");

	for (const raw_line of text.split(/\r?\n/)) {
		const line = raw_line.trim();
		if (!line || line.startsWith("#")) continue;

		let pattern = line;
		const negate = pattern.startsWith("!");
		if (negate) pattern = pattern.slice(1);
		const dir_only = pattern.endsWith("/");
		if (dir_only) pattern = pattern.slice(0, -1);
		const anchored = pattern.startsWith("/");
		if (anchored) pattern = pattern.slice(1);

		let regex_source = "";
		for (let index = 0; index < pattern.length; index++) {
			const char = pattern[index]!;
			if (char === "*" && pattern[index + 1] === "*" && (pattern[index + 2] === "/" || index + 2 >= pattern.length)) {
				regex_source += index + 2 >= pattern.length ? ".*" : "(?:.+/)?";
				index += 2;
			} else if (char === "*") {
				regex_source += "[^/]*";
			} else if (char === "?") {
				regex_source += "[^/]";
			} else if (".+^${}()|[]\\".includes(char)) {
				regex_source += "\\" + char;
			} else {
				regex_source += char;
			}
		}

		const suffix = dir_only ? "/?" : "";
		const full_regex = anchored ? `^${regex_source}${suffix}$` : `(?:^|/)${regex_source}${suffix}$`;
		rules.push({ negate, dir_only, regex: new RegExp(full_regex) });
	}

	return rules;
}

function is_ignored(rules: IgnoreRule[], rel_path: string, is_dir: boolean): boolean {
	let ignored = false;
	const test_path = is_dir ? rel_path + "/" : rel_path;

	for (const rule of rules) {
		if (rule.dir_only && !is_dir) continue;
		if (rule.regex.test(test_path)) ignored = !rule.negate;
	}

	return ignored;
}

function collect_release_files(root: string, rules: IgnoreRule[]): ReleaseEntry[] {
	const entries: ReleaseEntry[] = [];

	function walk(dir_rel: string): void {
		const dir_abs = join(root, dir_rel);
		for (const name of readdirSync(dir_abs)) {
			const rel_path = dir_rel ? `${dir_rel}/${name}` : name;
			const abs_path = join(dir_abs, name);
			const is_dir = statSync(abs_path).isDirectory();

			if (is_ignored(rules, rel_path, is_dir)) continue;
			if (!is_dir && OVERRIDE_SUFFIX_RE.test(rel_path)) continue;

			entries.push({ rel_path, abs_path, is_dir });
			if (is_dir) walk(rel_path);
		}
	}

	walk("");
	entries.sort((left, right) => {
		if (left.is_dir !== right.is_dir) return left.is_dir ? -1 : 1;
		return left.rel_path.localeCompare(right.rel_path);
	});
	return entries;
}

function file_hash(file_path: string): string {
	const hasher = new Bun.CryptoHasher("sha1");
	hasher.update(readFileSync(file_path));
	return hasher.digest("hex").slice(0, 8);
}

function validate_override_hashes(source_dir: string): void {
	function walk(dir: string): void {
		for (const name of readdirSync(dir)) {
			const abs_path = join(dir, name);
			if (statSync(abs_path).isDirectory()) {
				walk(abs_path);
				continue;
			}

			const original_path = original_path_for_override(abs_path);
			if (!original_path || !existsSync(original_path)) continue;
			const stored_hash = HASH_COMMENT_RE.exec(readFileSync(abs_path, "utf-8"))?.[1];
			if (!stored_hash) continue;
			const actual_hash = file_hash(original_path);
			if (stored_hash !== actual_hash) {
				throw new Error(`Override is stale: ${relative(source_dir, abs_path)}`);
			}
		}
	}

	walk(source_dir);
}

async function populate_stage(stage_dir: string, entries: ReleaseEntry[]): Promise<number> {
	let override_count = 0;

	for (const entry of entries) {
		const destination = join(stage_dir, entry.rel_path);
		if (entry.is_dir) {
			mkdirSync(destination, { recursive: true });
			continue;
		}

		mkdirSync(dirname(destination), { recursive: true });
		const override_path = override_path_for_original(entry.abs_path);
		if (existsSync(override_path)) {
			const content = readFileSync(override_path, "utf-8");
			const filtered = content.split("\n").filter((line) => !HASH_COMMENT_RE.test(line)).join("\n");
			await Bun.write(destination, filtered);
			override_count++;
		} else {
			cpSync(entry.abs_path, destination);
		}
	}

	return override_count;
}

function mirror_stage(stage_dir: string, public_dir: string): void {
	if (!existsSync(join(public_dir, ".git"))) {
		throw new Error(`Public ReeWeb checkout not found: ${public_dir}`);
	}

	for (const name of readdirSync(public_dir)) {
		if (name === ".git") continue;
		rmSync(join(public_dir, name), { recursive: true, force: true });
	}

	for (const name of readdirSync(stage_dir)) {
		cpSync(join(stage_dir, name), join(public_dir, name), { recursive: true });
	}
}

export async function stage_and_mirror_release_files(source_dir: string, public_dir: string, dry_run: boolean): Promise<{ entry_count: number; override_count: number; }> {
	const source_path = resolve(source_dir);
	const ignore_path = join(source_path, RELEASE_IGNORE);
	if (!existsSync(ignore_path)) throw new Error(`${RELEASE_IGNORE} not found: ${source_path}`);

	validate_override_hashes(source_path);
	const entries = collect_release_files(source_path, parse_ignore_file(ignore_path));
	if (dry_run) return { entry_count: entries.length, override_count: 0 };

	const stage_dir = mkdtempSync(join(tmpdir(), "ree-web-release-"));
	try {
		const override_count = await populate_stage(stage_dir, entries);
		mirror_stage(stage_dir, resolve(public_dir));
		return { entry_count: entries.length, override_count };
	} finally {
		rmSync(stage_dir, { recursive: true, force: true });
	}
}
