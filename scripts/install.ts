#!/usr/bin/env bun

/**
 * Non-interactive project bootstrap for a fresh ReeWeb bun create destination.
 *
 * Uses the current folder name as the package name and avoids prompts so a
 * public starter can be initialized in one command.
 *
 * Ends by committing the bootstrap edits, so everything the developer writes
 * afterwards shows up as a clean diff.
 *
 * Bun removes package.json's bun-create section only in a true bun create
 * destination. The standard postinstall uses that as a hard guard so bun install
 * in source repositories and normal clones cannot mutate package metadata,
 * remove maintainer scripts, or touch Git history.
 */

import { existsSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";

import { heading, note, section, set_verbose, step_done, step_start, success } from "./install/reporter";
import { run_captured, run_inherited, with_verbose_flag } from "./install/run_step";

function readable_project_name(project_name: string): string {
	const words = project_name.split(/[\s_-]+/).filter(Boolean);
	return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ") || "My Site";
}

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
	pkg.version = "0.1.0";
	await Bun.write(pkg_path, JSON.stringify(pkg, null, "\t") + "\n");
}

async function set_site_name(translation_path: string, project_name: string): Promise<void> {
	const translation_raw = await Bun.file(translation_path).text();
	const translations = JSON.parse(translation_raw);
	const site_name = readable_project_name(project_name);

	translations.site_name = site_name;
	if (translations.ui?.welcome_title === "Welcome to My Static Site") {
		translations.ui.welcome_title = `Welcome to ${site_name}`;
	}

	await Bun.write(translation_path, JSON.stringify(translations, null, "\t") + "\n");
}

async function set_og_label(og_config_path: string, project_name: string): Promise<void> {
	const raw = await Bun.file(og_config_path).text();
	const site_name = readable_project_name(project_name);
	const updated = raw.replace(/(label:\s*)"[^"]*"/, `$1"${site_name}"`);

	if (updated === raw) {
		return;
	}

	await Bun.write(og_config_path, updated);
}

async function set_author_from_git(pkg_path: string): Promise<void> {
	const user = await run_cmd_capture("git", ["config", "user.name"]);
	const email = await run_cmd_capture("git", ["config", "user.email"]);
	const git_name = user.stdout.trim();
	const git_email = email.stdout.trim();

	if (!git_name || !git_email) {
		const pkg_raw = await Bun.file(pkg_path).text();
		const pkg = JSON.parse(pkg_raw);

		delete pkg.author;
		delete pkg.contributors;
		await Bun.write(pkg_path, JSON.stringify(pkg, null, "\t") + "\n");
		return;
	}

	const pkg_raw = await Bun.file(pkg_path).text();
	const pkg = JSON.parse(pkg_raw);

	delete pkg.contributors;
	pkg.author = { name: git_name, email: git_email };
	await Bun.write(pkg_path, JSON.stringify(pkg, null, "\t") + "\n");
}

async function set_wrangler_name(wrangler_path: string, project_name: string): Promise<void> {
	if (!existsSync(wrangler_path)) {
		return;
	}

	// wrangler.jsonc has comments, so patch the field in place instead of JSON.parse/stringify.
	const raw = await Bun.file(wrangler_path).text();
	const updated = raw.replace(/("name"\s*:\s*)"[^"]*"/, `$1"${project_name}"`);
	if (updated === raw) {
		return;
	}

	await Bun.write(wrangler_path, updated);
}

async function copy_env(env_example_path: string, env_path: string): Promise<void> {
	if (existsSync(env_path)) {
		return;
	}

	const content = await Bun.file(env_example_path).text();
	await Bun.write(env_path, content);
}

async function is_bun_create_destination(pkg_path: string): Promise<boolean> {
	const pkg = await Bun.file(pkg_path).json();
	return !Object.hasOwn(pkg, "bun-create");
}

/**
 * Drops the maintainer-only release scripts from the generated package.json.
 *
 * `clean-up` deletes itself along with the release scripts, so a starter checkout
 * is left with only the commands a site developer actually runs.
 */
async function remove_release_scripts(): Promise<void> {
	const result = await run_captured("bun", ["run", "clean-up"]);
	if (result.code !== 0) {
		throw new Error(`clean-up failed with exit code ${result.code}: ${result.output.trim()}`);
	}
}

async function format_with_reettier(): Promise<void> {
	const result = await run_captured("reettier", []);
	if (result.code !== 0) { throw new Error(`reettier failed with exit code ${result.code}: ${result.output.trim()}`); }
}

/**
 * Commits the bootstrap edits so the developer's own first change is a clean diff.
 *
 * Returns the reporter detail describing what happened. Skips quietly when there
 * is no repository to commit into or nothing left to commit - neither is an error.
 */
async function commit_bootstrap(is_fresh_repo: boolean): Promise<string> {
	const inside_repo = await run_cmd_capture("git", ["rev-parse", "--is-inside-work-tree"]);
	if (inside_repo.code !== 0 || inside_repo.stdout.trim() !== "true") {
		return "skipped - no git repository";
	}

	const staged = await run_cmd_capture("git", ["add", "-A"]);
	if (staged.code !== 0) {
		throw new Error(`git add failed with exit code ${staged.code}: ${staged.stderr.trim()}`);
	}

	const pending = await run_cmd_capture("git", ["diff", "--cached", "--quiet"]);
	if (pending.code === 0) {
		return "skipped - nothing to commit";
	}

	const message = is_fresh_repo ? "initial commit" : "chore: bootstrap reeweb project";
	const committed = await run_cmd_capture("git", ["commit", "-m", message]);
	if (committed.code !== 0) {
		throw new Error(`git commit failed with exit code ${committed.code}: ${(committed.stderr || committed.stdout).trim()}`);
	}

	return is_fresh_repo ? "initial commit created" : "bootstrap commit created";
}

async function main() {
	const is_verbose = process.argv.includes("--verbose");
	set_verbose(is_verbose);
	const pkg_path = join(process.cwd(), "package.json");
	const wrangler_path = join(process.cwd(), "wrangler.jsonc");
	const og_config_path = join(process.cwd(), "config", "og_images.ts");
	const env_example_path = join(process.cwd(), ".env.example");
	const env_path = join(process.cwd(), ".env");
	const marker_dir = join(process.cwd(), ".reepolee");
	const marker_path = join(marker_dir, "marker");

	if (!existsSync(pkg_path)) { throw new Error("package.json not found in the current directory"); }
	const is_bun_create = await is_bun_create_destination(pkg_path);
	if (!is_bun_create) {
		note("source checkout - bootstrap skipped");
		return;
	}
	if (!existsSync(env_example_path)) {
		throw new Error(".env.example not found in the current directory");
	}

	// The explicit reeweb:install command may be run more than once. The marker
	// keeps re-runs from overwriting package.json's name and author again.
	if (existsSync(marker_path)) {
		note("already bootstrapped - skipping");
		return;
	}

	const project_name = basename(process.cwd()) || "reeweb";
	heading("reeweb");
	const prerequisite_code = await run_inherited("bun", with_verbose_flag(["scripts/install/prerequisites.ts"]));
	if (prerequisite_code !== 0) throw new Error(`prerequisites failed with exit code ${prerequisite_code}`);
	section("Project");
	step_start("project metadata");
	await set_project_name(pkg_path, project_name);
	await set_site_name(join(process.cwd(), "src", "public", "en-us.json"), project_name);
	await set_og_label(og_config_path, project_name);
	await set_author_from_git(pkg_path);
	await set_wrangler_name(wrangler_path, project_name);
	await copy_env(env_example_path, env_path);
	await remove_release_scripts();
	step_done("project metadata", "synced");
	step_start("formatting");
	await format_with_reettier();
	step_done("formatting", "complete");

	mkdirSync(marker_dir, { recursive: true });
	await Bun.write(marker_path, `${new Date().toISOString()}\n`);

	// Last, so every edit above lands in one commit. The marker itself is gitignored.
	step_start("git commit");
	const commit_detail = await commit_bootstrap(true);
	step_done("git commit", commit_detail);

	success(`Ready.`);
	// bun create leaves the shell in the parent directory, so the cd is only
	// worth printing when the caller is not already inside the project folder.
	const invoked_from = process.env.INIT_CWD;
	const is_already_in_project = !invoked_from || resolve(invoked_from) === resolve(process.cwd());
	if (!is_already_in_project) {
		success(`cd ${project_name}`);
	}
	success(`bun dev`);
}

main().catch((err) => {
	console.error(`[install] Error: ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
});
