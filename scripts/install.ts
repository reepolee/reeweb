#!/usr/bin/env bun

/**
 * Non-interactive project bootstrap for a fresh ReeWeb starter checkout.
 *
 * Uses the current folder name as the package name and avoids prompts so a
 * public starter can be initialized in one command.
 *
 * Never touches git. Deciding what happens to the template's history belongs
 * to whoever created the checkout: `bun create` hands over a tarball with no
 * history and runs `git init` itself, and a developer who cloned deliberately
 * keeps the history they cloned.
 *
 * Bun runs this through package.json's bun-create.postinstall after dependencies
 * are installed. A developer who cloned the repository runs it explicitly
 * after their normal bun install routine.
 */

import { existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
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

async function format_with_reettier(): Promise<void> {
	const result = await run_captured("reettier", []);
	if (result.code !== 0) { throw new Error(`reettier failed with exit code ${result.code}: ${result.output.trim()}`); }
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
	step_done("project metadata", "synced");
	step_start("formatting");
	await format_with_reettier();
	step_done("formatting", "complete");

	mkdirSync(marker_dir, { recursive: true });
	await Bun.write(marker_path, `${new Date().toISOString()}\n`);

	success(`Ready.`);
	success(`cd ${project_name} && bun dev`);
}

main().catch((err) => {
	console.error(`[install] Error: ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
});
