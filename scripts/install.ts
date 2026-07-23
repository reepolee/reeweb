#!/usr/bin/env bun

/**
 * Non-interactive project bootstrap for a fresh ReeWeb starter checkout.
 *
 * Uses the current folder name as the package name and avoids prompts so a
 * public starter can be initialized in one command.
 */

import { existsSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";

function run_cmd(cmd: string, args: string[]): Promise<number> {
	return new Promise((resolve) => {
		const p = spawn(cmd, args, { stdio: "inherit" });
		p.on("error", () => resolve(-1));
		p.on("exit", (code) => resolve(code ?? -1));
	});
}

function run_cmd_capture(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string; }> {
	return new Promise((resolve) => {
		const p = spawn(cmd, args, { stdio: "pipe" });
		let stdout = "";
		let stderr = "";
		p.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
		p.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
		p.on("error", () => resolve({ code: -1, stdout, stderr }));
		p.on("exit", (code) => resolve({ code: code ?? -1, stdout, stderr }));
	});
}

async function set_project_name(pkg_path: string, project_name: string): Promise<void> {
	const pkg_raw = await Bun.file(pkg_path).text();
	const pkg = JSON.parse(pkg_raw);

	pkg.name = project_name;
	await Bun.write(pkg_path, JSON.stringify(pkg, null, "\t") + "\n");
	console.log(`[install] package.json name set to "${project_name}"`);
}

async function set_author_from_git(pkg_path: string): Promise<void> {
	const user = await run_cmd_capture("git", ["config", "user.name"]);
	const email = await run_cmd_capture("git", ["config", "user.email"]);
	const git_name = user.stdout.trim();
	const git_email = email.stdout.trim();

	if (!git_name || !git_email) {
		console.log("[install] git user.name/email not configured, leaving package.json author as-is");
		return;
	}

	const pkg_raw = await Bun.file(pkg_path).text();
	const pkg = JSON.parse(pkg_raw);

	delete pkg.contributors;
	pkg.author = { name: git_name, email: git_email };
	await Bun.write(pkg_path, JSON.stringify(pkg, null, "\t") + "\n");
	console.log(`[install] package.json author set to "${git_name} <${git_email}>", contributors removed`);
}

async function set_wrangler_name(wrangler_path: string, project_name: string): Promise<void> {
	if (!existsSync(wrangler_path)) {
		console.log("[install] wrangler.jsonc not found, skipping");
		return;
	}

	// wrangler.jsonc has comments, so patch the field in place instead of JSON.parse/stringify.
	const raw = await Bun.file(wrangler_path).text();
	const updated = raw.replace(/("name"\s*:\s*)"[^"]*"/, `$1"${project_name}"`);
	if (updated === raw) {
		console.log('[install] wrangler.jsonc has no "name" field, skipping');
		return;
	}

	await Bun.write(wrangler_path, updated);
	console.log(`[install] wrangler.jsonc name set to "${project_name}"`);
}

async function copy_env(env_example_path: string, env_path: string): Promise<void> {
	if (existsSync(env_path)) {
		console.log("[install] .env already exists, leaving it in place");
		return;
	}

	const content = await Bun.file(env_example_path).text();
	await Bun.write(env_path, content);
	console.log("[install] copied .env.example → .env");
}

async function ensure_reettier(): Promise<void> {
	const installed = await run_cmd_capture("reettier", ["--version"]);
	if (installed.code === 0) {
		console.log(`[install] reettier already installed (${installed.stdout.trim()})`);
		return;
	}

	console.log("[install] installing reettier");
	const code = await run_cmd("bun", ["scripts/cli.ts", "reettier"]);
	if (code !== 0) { throw new Error(`bun scripts/cli.ts reettier failed with exit code ${code}`); }
}

async function format_with_reettier(): Promise<void> {
	console.log("[install] formatting with reettier");
	const code = await run_cmd("reettier", []);
	if (code !== 0) { throw new Error(`reettier failed with exit code ${code}`); }
}

// Written once, the moment this installer initializes the repository. It lives
// inside .git rather than the working tree so it can never be committed, never
// ships in the starter, and never survives a clone: a freshly cloned project
// always arrives without it and gets exactly one reinitialization, while every
// later run finds it and leaves the history alone. Deleting .git by hand is
// therefore the only way to ask for a second one.
const GIT_INSTALL_MARKER = join(".git", "reeweb_installed");

async function write_git_install_marker(): Promise<void> {
	const stamp = new Date().toISOString();
	await Bun.write(GIT_INSTALL_MARKER, `initialized by reeweb:install ${stamp}\n`);
}

async function init_git_repo(): Promise<void> {
	if (existsSync(GIT_INSTALL_MARKER)) {
		console.log("[install] git already initialized by a previous install, leaving history untouched");
		return;
	}

	console.log("[install] initializing git");
	if (existsSync(".git")) {
		console.log("[install] removing existing git history");
		rmSync(".git", { recursive: true, force: true });
	}

	const init_result = await run_cmd_capture("git", ["init", "--initial-branch=main"]);
	if (init_result.code !== 0) { throw new Error(`git init failed with exit code ${init_result.code}`); }

	// Recorded before the commit steps below, which have their own early exits -
	// the repository is initialized either way, so this run must be the last one
	// that touches it.
	await write_git_install_marker();

	const user = await run_cmd_capture("git", ["config", "--global", "user.name"]);
	const email = await run_cmd_capture("git", ["config", "--global", "user.email"]);
	if (user.code !== 0 || email.code !== 0 || !user.stdout.trim() || !email.stdout.trim()) {
		console.log("[install] git user.name/email not configured, skipping initial commit");
		return;
	}

	const add_result = await run_cmd_capture("git", ["add", "."]);
	if (add_result.code !== 0) { throw new Error(`git add failed with exit code ${add_result.code}`); }

	const commit_result = await run_cmd_capture("git", ["commit", "-m", "Initial commit by reeweb:install"]);
	if (commit_result.code !== 0) {
		console.log(
			"[install] initial commit failed, leaving repository initialized but uncommitted"
		);
		return;
	}

	console.log("[install] created initial commit");
}

async function main() {
	const pkg_path = join(process.cwd(), "package.json");
	const wrangler_path = join(process.cwd(), "wrangler.jsonc");
	const env_example_path = join(process.cwd(), ".env.example");
	const env_path = join(process.cwd(), ".env");

	if (!existsSync(pkg_path)) { throw new Error("package.json not found in the current directory"); }
	if (!existsSync(env_example_path)) {
		throw new Error(".env.example not found in the current directory");
	}

	const project_name = basename(process.cwd()) || "reeweb";
	await set_project_name(pkg_path, project_name);
	await set_author_from_git(pkg_path);
	await set_wrangler_name(wrangler_path, project_name);
	await copy_env(env_example_path, env_path);

	console.log("[install] running bun install");
	const install_code = await run_cmd("bun", ["install"]);
	if (install_code !== 0) { throw new Error(`bun install failed with exit code ${install_code}`); }

	await ensure_reettier();
	await format_with_reettier();
	await init_git_repo();

	console.log("[install] done");
}

main().catch((err) => {
	console.error(`[install] Error: ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
});
