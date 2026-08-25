#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { install_reesql } from "./reesql";
import { install_reettier } from "./reettier";
import { install_tailwind } from "./tailwind";
import { install_tsc } from "./tsc";
import { install_vips } from "./vips";
import { record_global_tool, type global_tool_name } from "./ownership";
import { section, set_verbose, step_done, step_fail, step_start } from "./reporter";

type download = { label: string; version: string; url: string; out: string; license_url: string; };

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

async function fetch_to_file(url: string, out_path: string): Promise<void> {
	const res = await fetch(url);
	if (!res.ok) { throw new Error(`GET ${url} -> ${res.status}`); }
	const buf = await res.arrayBuffer();
	await Bun.write(out_path, buf);
}

async function run_tool(label: string, tool: global_tool_name, task: () => Promise<string | void>): Promise<void> {
	step_start(label);
	try {
		const detail = await task();
		if (detail === "added") await record_global_tool(tool);
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
	const tsc_version = extract_flag_version(scripts["get:tsc"] ?? "", "typescript");
	const vips_version = extract_flag_version(scripts["get:vips"] ?? "", "vips");

	await mkdir(join(process.cwd(), "vendor"), { recursive: true });
	section("Prerequisites");
	const downloads: download[] = [
		{
			label: "zod",
			version: zod_version,
			url: `https://cdn.jsdelivr.net/npm/zod@${zod_version}/+esm`,
			out: join("vendor", "zod.min.js"),
			license_url: `https://cdn.jsdelivr.net/npm/zod@${zod_version}/LICENSE`,
		},
		{
			label: "highlight.js",
			version: hljs_version,
			url: `https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@${hljs_version}/highlight.min.js`,
			out: join("vendor", "highlight.min.js"),
			license_url: `https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@${hljs_version}/LICENSE`,
		},
		{
			label: "highlight theme",
			version: hljs_version,
			url: `https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@${hljs_version}/styles/atom-one-dark.min.css`,
			out: join("vendor", "highlight-atom-one-dark.min.css"),
			license_url: `https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@${hljs_version}/LICENSE`,
		},
	];
	// Downloads are independent of each other, but the reporter draws one line
	// at a time - so fetch concurrently, then report in a stable order.
	for (const item of downloads) step_start(item.label);

	const download_tasks = downloads.map(async (item) => {
		const res = await fetch(item.url);
		if (!res.ok) { throw new Error(`GET ${item.url} -> ${res.status}`); }
		const body = await res.arrayBuffer();
		return { item, body };
	});

	const fetched = await Promise.allSettled(download_tasks);

	for (let i = 0; i < downloads.length; i++) {
		const item = downloads[i]!;
		const outcome = fetched[i]!;
		if (outcome.status === "rejected") {
			const reason = outcome.reason;
			const message = reason instanceof Error ? reason.message : String(reason);
			step_fail(item.label, message);
			throw new Error(`${item.label} download failed`);
		}
		await Bun.write(item.out, outcome.value.body);
		// The license text travels with the asset - vendor/ is gitignored, so this
		// is the only copy a user ends up with.
		await fetch_to_file(item.license_url, `${item.out}.LICENSE.txt`);
		step_done(item.label, item.version);
	}

	section("Global tools");

	await run_tool("tailwindcss", "tailwindcss", () => install_tailwind({ version: tw_version }));
	await run_tool("typescript", "typescript", () => install_tsc({ version: tsc_version, get_task: "get:tsc" }));
	await run_tool("libvips", "libvips", () => install_vips({ version: vips_version, get_task: "get:vips" }));
	await run_tool("reettier", "reettier", install_reettier);
	await run_tool("reesql", "reesql", install_reesql);
}

if (import.meta.main) {
	main().catch((err) => {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[31mPrerequisite install failed: ${message}[0m`);
		process.exit(1);
	});
}
