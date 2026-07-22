#!/usr/bin/env bun
/**
 * Auto-discovers vendored files, GitHub repos, and global tools for updates.
 * Globs vendor/ and static/ for *.min.js, auto-maps get:* scripts to packages.
 *
 * Works across projects without hardcoding-detects what each project uses.
 *
 * Usage: bun vendor:check
 */

import { readFileSync, globSync } from "fs";
import { resolve } from "path";

const BOLD = "\u001b[1m";
const RESET = "\u001b[0m";
const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const RED = "\u001b[31m";
const DIM = "\u001b[2m";

function ok(msg: string) { console.log(`  ${GREEN}✓${RESET} ${msg}`); }
function warn(msg: string) { console.log(`  ${YELLOW}!${RESET} ${msg}`); }
function err(msg: string) { console.log(`  ${RED}✗${RESET} ${msg}`); }
function info(msg: string) { console.log(`  ${DIM}~${RESET} ${msg}`); }

type PackageJson = { scripts: Record<string, string>; devDependencies: Record<string, string>; };

type CheckItem = {
	label: string;
	pkg_name: string;
	get_script: string;
	file_path?: string;
	repo_name?: string;
};

const root = resolve(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as PackageJson;

// Extract version from a get:* script URL, e.g. zod@4.4.3 or @4.4.3
function version_from_script(script_name: string): string | null {
	const cmd = pkg.scripts[script_name] ?? "";
	const m = cmd.match(/@([\d]+\.[\d]+\.[\d]+[\w.-]*)/);
	return m?.[1] ?? null;
}

// Read the first 500 bytes of a file and look for a version like pkg@x.y.z
function version_from_file(file_path: string, pkg_name: string): string | null {
	try {
		const head = readFileSync(resolve(root, file_path), { encoding: "utf8" }).slice(0, 500);
		// Match "pkg_name@x.y.z" anywhere in the header
		const escaped = pkg_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const pattern = new RegExp(escaped + "@([\\d]+\\.[\\d]+\\.[\\d]+[\\w.-]*)");
		const m = head.match(pattern);
		return m?.[1] ?? null;

	} catch {
		return null;
	}
}

async function latest_npm(pkg: string): Promise<string | null> {
	try {
		const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`);
		if (!res.ok) return null;
		const data = await res.json() as { version: string; };
		return data.version;
	} catch {
		return null;
	}
}

async function latest_github_tag(repo: string): Promise<string | null> {
	try {
		const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
			headers: { Accept: "application/vnd.github+json" },
		});
		if (!res.ok) return null;
		const data = await res.json() as { tag_name: string; };
		return data.tag_name.replace(/^v/, "");
	} catch {
		return null;
	}
}

function cmp(current: string, latest: string): "ok" | "outdated" {
	if (current === latest) return "ok";
	const a = current.split(".").map(Number);
	const b = latest.split(".").map(Number);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const diff = (b[i] ?? 0) - (a[i] ?? 0);
		if (diff > 0) return "outdated";
		if (diff < 0) return "ok";
	}
	return "ok";
}

function report(name: string, current: string | null, latest: string | null, getScript?: string) {
	if (!current) {
		warn(`${name}: could not determine current version`);
		return;
	}
	if (!latest) {
		warn(`${name}: current=${current}  (could not fetch latest)`);
		return;
	}
	if (cmp(current, latest) === "ok") {
		ok(`${name}: ${current} (up to date)`);
	} else {
		const fix = getScript ? `  →  bun ${getScript}` : "";
		err(`${name}: ${current}  →  ${BOLD}${latest}${RESET}${fix}`);
	}
}

// Extract package name from get:* script (just the short name)
function pkg_name_from_get_script(script_name: string): string | null {
	const m = script_name.match(/^get:(.+)$/);
	return m?.[1] ?? null;
}

// Extract GitHub repo from get:* script URL (e.g., owner/repo)
function git_hub_repo_from_script(script_name: string): string | null {
	const cmd = pkg.scripts[script_name] ?? "";
	const m = cmd.match(
		/github\.com\/([^/]+\/[^/]+)\//
	);
	return m?.[1] ?? null;
}

// Discover vendor files from glob
function discover_vendor_files(): CheckItem[] {
	const files = globSync([
		"vendor/**/*.{min,bundle}.js",
		"static/**/*.{min,bundle}.js",
		"src/public/**/*.{min,bundle}.js",
	], { cwd: root });
	const get_scripts = Object.keys(pkg.scripts).filter((s) => s.startsWith("get:"));

	const result: CheckItem[] = [];

	for (const file of files) {
		const full_path = resolve(root, file);
		const file_name = file.split("/").pop()!;

		// Try to match with get:* script
		let matched_script = "";
		let matched_pkg: string | null = null;

		// Strategy 1: name-based matching
		const normalized_file_name = file_name.replace(".min.js", "").replace(/[._-]/g, "");
		const match = get_scripts.find((s) => {
			const script_part = s.replace("get:", "").replace(/[._-]/g, "");
			return normalized_file_name === script_part || normalized_file_name.includes(
				script_part
			);
		});

		if (match) {
			matched_script = match;
			matched_pkg = pkg_name_from_get_script(match);
		}

		// Strategy 2: version-based matching (if name didn't work)
		if (!matched_script) {
			const file_version = version_from_file(full_path, ""); // Extract version from file
			if (file_version) {
				const version_match = get_scripts.find((s) => version_from_script(s) === file_version);
				if (version_match) {
					matched_script = version_match;
					matched_pkg = pkg_name_from_get_script(version_match);
				}
			}
		}

		// Strategy 3: extract from file header
		if (!matched_pkg) {
			const head = readFileSync(full_path, { encoding: "utf8" }).slice(0, 500);
			const pkg_match = head.match(
				/(?:\/\/|<!--|{|})?\s*(@?[\w-]+)@([\d]+\.[\d]+\.[\d]+[\w.-]*)/
			);
			if (pkg_match) { matched_pkg = pkg_match[1].replace(/^@/, ""); }
		}

		if (matched_pkg) {
			result.push({
				label: file,
				pkg_name: matched_pkg,
				get_script: matched_script,
				file_path: full_path,
			});
		}
	}

	return result;
}

// Discover global tools and pinned get:* scripts
function discover_get_scripts(vendor_files: CheckItem[]): CheckItem[] {
	const get_scripts = Object.keys(pkg.scripts).filter((s) => s.startsWith("get:"));
	const vendor_scripts = new Set(vendor_files.map((v) => v.get_script));

	const result: CheckItem[] = [];

	for (const script of get_scripts) {
		const version = version_from_script(script);
		if (!version) continue;

		// Skip if already covered by vendor files
		if (vendor_scripts.has(script)) continue;

		const pkg_name = pkg_name_from_get_script(script);
		if (!pkg_name) continue;

		const repo_name = git_hub_repo_from_script(script);
		result.push({
			label: `${script}${repo_name ? " (GitHub)" : " (global tool)"}`,
			pkg_name: pkg_name,
			get_script: script,
			repo_name: repo_name,
		});
	}

	return result;
}

async function main() {
	const vendor_files = discover_vendor_files();
	const discovered_paths = new Set(vendor_files.map((v) => v.file_path));

	// Check for orphaned vendor files (no get:* script)
	const all_files = globSync([
		"vendor/**/*.{min,bundle}.js",
		"static/**/*.{min,bundle}.js",
		"src/public/**/*.{min,bundle}.js",
	], { cwd: root });

	for (const file of all_files) {
		const full_path = resolve(root, file);
		if (!discovered_paths.has(full_path)) {
			warn(`${file}: no get:* script found (add to package.json to track updates)`);
		}
	}

	if (vendor_files.length > 0) {
		console.log(`\n${BOLD}Vendored files${RESET}`);
		await Promise.all(vendor_files.map(async ({ label, pkg_name, get_script, file_path }) => {
			const current = get_script ? (version_from_script(get_script) ?? version_from_file(
				file_path!,
				pkg_name
			)) : version_from_file(file_path!, pkg_name);
			const latest = await latest_npm(pkg_name);
			report(label, current, latest, get_script);
		}));
	}

	const get_scripts = discover_get_scripts(vendor_files);

	if (get_scripts.length > 0) {
		console.log(`\n${BOLD}Global tools & pinned packages${RESET}`);
		await Promise.all(
			get_scripts.map(async ({ label, pkg_name, get_script, repo_name }) => {
				const current = version_from_script(get_script);
				if (!current) return;

				if (repo_name) {
					// GitHub repo
					const latest = await latest_github_tag(repo_name);
					if (!latest) {
						info(`${label}: no release found for ${repo_name}`);
					} else {
						report(label, current, latest, get_script);
					}
				} else {
					// npm package
					const latest = await latest_npm(pkg_name);
					report(label, current, latest, get_script);
				}
			})
		);
	}

	if (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0) {
		console.log(`\n${BOLD}Dev dependencies${RESET}`);
		await Promise.all(Object.entries(pkg.devDependencies).map(async ([name, pinned]) => {
			const current = pinned.replace(/^[\^~]/, "");
			const latest = await latest_npm(name);
			report(name, current, latest);
		}));
	}

	console.log();
	process.exit(0);
}

main();
