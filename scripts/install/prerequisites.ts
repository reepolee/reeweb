#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { install_reesql } from "./reesql";
import { install_reettier } from "./reettier";
import { install_tailwind } from "./tailwind";
import { install_vips } from "./vips";
import { section, set_verbose, step_done, step_fail, step_start } from "./reporter";

type download = { label: string; version: string; url: string; out: string; };

async function read_scripts(): Promise<Record<string, string>> {
	const pkg = await Bun.file(join(process.cwd(), "package.json")).json();
	return pkg.scripts ?? {};
}

export function extract_version(script: string, package_name: string): string {
	const escaped = package_name.replace(/[/@\-.]/g, "\\$&");
	const match = script.match(new RegExp(`${escaped}@([\\d.]+)`));
	if (!match?.[1]) throw new Error(`Could not read ${package_name} version from package.json`);
	return match[1];
}

function extract_flag_version(script: string, label: string): string {
	const version = script.match(/--version=([\d.]+)/)?.[1];
	if (!version) throw new Error(`Could not read ${label} version from package.json`);
	return version;
}

async function fetch_download(item: download): Promise<{ item: download; body: ArrayBuffer; }> {
	const response = await fetch(item.url);
	if (!response.ok) throw new Error(`GET ${item.url} -> ${response.status}`);
	return { item, body: await response.arrayBuffer() };
}

async function run_tool(label: string, task: () => Promise<string | void>): Promise<void> {
	step_start(label);
	try {
		const detail = await task();
		step_done(label, detail ?? undefined);
	}
	catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		step_fail(label, message);
		throw err;
	}
}

async function main(): Promise<void> {
	set_verbose(process.argv.includes("--verbose"));
	const scripts = await read_scripts();
	const zod_version = extract_version(scripts["get:zod"] ?? "", "zod");
	const hljs_version = extract_version(scripts["get:hljs"] ?? "", "@highlightjs/cdn-assets");
	const tw_version = extract_flag_version(scripts["get:tw"] ?? "", "tailwindcss");
	const vips_version = extract_flag_version(scripts["get:vips"] ?? "", "vips");

	await mkdir(join(process.cwd(), "vendor"), { recursive: true });
	section("Prerequisites");
	const downloads: download[] = [
		{ label: "zod", version: zod_version, url: `https://cdn.jsdelivr.net/npm/zod@${zod_version}/+esm`, out: join("vendor", "zod.min.js") },
		{ label: "highlight.js", version: hljs_version, url: `https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@${hljs_version}/highlight.min.js`, out: join("vendor", "highlight.min.js") },
		{ label: "highlight theme", version: hljs_version, url: `https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@${hljs_version}/styles/atom-one-dark.min.css`, out: join("vendor", "highlight-atom-one-dark.min.css") },
	];
	const fetched = await Promise.all(downloads.map(fetch_download));
	for (const { item, body } of fetched) {
		step_start(item.label);
		await Bun.write(item.out, body);
		step_done(item.label, item.version);
	}
	await run_tool("reettier", install_reettier);
	await run_tool("reesql", install_reesql);
	await run_tool("tailwindcss", () => install_tailwind({ version: tw_version }));
	await run_tool("libvips", () => install_vips({ version: vips_version }));
}

if (import.meta.main) {
	main().catch((err) => {
		console.error(`[install] Error: ${err instanceof Error ? err.message : String(err)}`);
		process.exit(1);
	});
}
