#!/usr/bin/env bun

/**
 * scripts/dev/orchestrate.ts
 *
 * Replaces the `conc` (concurrently) wrapper around `bun dev`. Runs the
 * one-shot setup steps (dynamic asset sync, image prep, initial CSS build),
 * then spawns a persistent `tailwindcss --watch=always` process alongside the
 * dev server. `--watch=always` is required: without it, tailwindcss's watcher
 * exits as soon as it detects its stdin has closed, which Bun.spawn's
 * non-interactive stdin triggers almost immediately - the process looks alive
 * but silently stops rebuilding. The dev server's own watcher
 * (dev/watcher.ts) doesn't rebuild CSS itself - it only watches
 * src/public/css/style.min.css (tailwindcss's output) and notifies the
 * browser once it changes.
 *
 * src/css/style.css's `@source` directives must use directory paths, not
 * glob patterns - glob patterns are misinterpreted by Tailwind v4's scanner,
 * which then falls back to scanning parent directories broadly enough to
 * catch style.min.css itself, causing the watcher to re-trigger on its own
 * output on every rebuild.
 *
 * .env and config/ are read once at process start (Bun.env / static imports),
 * so bun --hot's module re-evaluation can't pick up changes to them the way
 * it does for the rest of the app. This orchestrator watches both and kills
 * + respawns the whole `development` child process when either changes.
 */

import { existsSync, watch } from "node:fs";
import { join } from "node:path";

const project_root = process.cwd();

const env_path = join(project_root, ".env");
if (!existsSync(env_path)) {
	console.error("[dev] .env not found - run `bun reeweb:install` first, then `bun dev`.");
	process.exit(1);
}

const tag_colors: Record<string, string> = {
	sync: "\x1b[36m",
	img: "\x1b[35m",
	css: "\x1b[33m",
	tw: "\x1b[33m",
	env: "\x1b[35m",
};
const color_reset = "\x1b[0m";

function prefixed_pipe(stream: ReadableStream<Uint8Array> | number | null, tag: string): Promise<void> {
	if (!stream || typeof stream === "number") return Promise.resolve();
	const decoder_stream = new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>;
	const reader = stream.pipeThrough(decoder_stream).getReader();
	let buffer = "";
	const color = tag_colors[tag] ?? "";
	const label = `${color}[${tag}]${color_reset}`;

	return (async () => {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += value;
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) console.log(`${label} ${line}`);
		}
		if (buffer) console.log(`${label} ${buffer}`);
	})();
}

async function run_to_completion(tag: string, cmd: string[]): Promise<void> {
	const child = Bun.spawn(cmd, { cwd: project_root, stdout: "pipe", stderr: "pipe" });
	await Promise.all([
		prefixed_pipe(child.stdout, tag),
		prefixed_pipe(child.stderr, tag),
	]);
	const exit_code = await child.exited;
	if (exit_code !== 0) {
		console.error(`[${tag}] exited with code ${exit_code}`);
		process.exit(exit_code);
	}
}

const responsive_images_dir = join(project_root, "src/public/images/responsive");
const is_first_run = !existsSync(responsive_images_dir);
if (is_first_run) {
	console.log("[dev] First run detected - generating responsive images and CSS, this can take a while. Only happens once.");
}

await run_to_completion("sync", ["bun", "run", "dynamic:sync"]);
await run_to_completion("img", ["bun", "run", "prepare:images"]);
await run_to_completion("css", ["bun", "run", "css:build"]);

function spawn_dev(): Bun.Subprocess<"ignore", "inherit", "inherit"> {
	return Bun.spawn(["bun", "run", "development"], { cwd: project_root, stdout: "inherit", stderr: "inherit" });
}

function spawn_tw(): Bun.Subprocess<"ignore", "pipe", "pipe"> {
	return Bun.spawn(["bun", "run", "css:watch"], { cwd: project_root, stdout: "pipe", stderr: "pipe" });
}

const tw = spawn_tw();
prefixed_pipe(tw.stdout, "tw");
prefixed_pipe(tw.stderr, "tw");
tw.exited.then((code) => { console.error(`${tag_colors.tw}[tw]${color_reset} process exited with code ${code}`); });

let dev = spawn_dev();
let shutting_down = false;
let restarting = false;
let restart_timeout: ReturnType<typeof setTimeout> | null = null;

function debounced_restart(reason: string): void {
	if (restart_timeout) clearTimeout(restart_timeout);
	restart_timeout = setTimeout(() => {
		restart_timeout = null;
		restarting = true;
		console.log(`${tag_colors.env}[env]${color_reset} 🔁 Restarting dev server (${reason})`);
		dev.kill();
	}, 100);
}

const env_config_watch_targets = [".env", "config"];

watch(project_root, { recursive: true }, (event, filename) => {
	if (!filename) return;
	const posix_path = filename.replaceAll("\\", "/");
	const is_watched = env_config_watch_targets.some((target) => posix_path === target || posix_path.startsWith(`${target}/`));
	if (!is_watched) return;
	debounced_restart(`${event}: ${filename}`);
});

async function shutdown(): Promise<void> {
	shutting_down = true;
	if (restart_timeout) clearTimeout(restart_timeout);
	tw.kill();
	dev.kill();
	await dev.exited;
	process.exit(0);
}

process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });

for (;;) {
	const exit_code = await dev.exited;
	if (shutting_down) process.exit(exit_code);
	if (!restarting) process.exit(exit_code);
	restarting = false;
	dev = spawn_dev();
}
