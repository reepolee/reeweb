#!/usr/bin/env bun
/**
 * MCP Server - Operations helpers
 *
 * Static-site operations: test runner, single-page render (the SSG
 * --print-url path), full SSG build, and content validation. The render and
 * build operations run scripts/ssg.ts as a subprocess because the pipeline
 * logs to stdout, which must stay clean for MCP JSON-RPC in this process.
 */

import { spawnSync } from "bun";

import { languages } from "$config/supported_languages";
import { without_draft_pages } from "$lib/draft_pages";
import { collect_page_files, find_ree_md_collisions, walk_dir } from "$lib/static_site";
import { find_schema_files, validate_collections } from "$root/scripts/ssg/collections";

import { assert_mcp_mutation_enabled } from "./capabilities";
import { PROJECT_ROOT, PUBLIC_DIR } from "./paths";

type CommandResult = { success: boolean; stdout: string; stderr: string; };

function run_bun(args: string[], timeout_s: number): CommandResult {
	const result = spawnSync(["bun", ...args], { cwd: PROJECT_ROOT, timeout: timeout_s * 1000 });
	return {
		success: result.exitCode === 0,
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
	};
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

export async function run_project_tests(filter?: string, timeout = 120): Promise<CommandResult> {
	const args = ["test"];
	if (filter) { args.push(filter); }
	return run_bun(args, timeout);
}

// ---------------------------------------------------------------------------
// Single-page render (byte-identical to a full build for that URL)
// ---------------------------------------------------------------------------

export async function render_page(url: string, timeout = 60): Promise<{ url: string; html: string; }> {
	if (!url.startsWith("/")) {
		throw new Error(`url must be a request path starting with "/" (got "${url}")`);
	}

	const result = run_bun(["scripts/ssg.ts", "--print-url", url], timeout);
	if (!result.success) { throw new Error(`render failed: ${result.stderr || result.stdout}`); }

	// print_rendered_page emits the page's full URL on the first line, then the HTML.
	const newline = result.stdout.indexOf("\n");
	const full_url = newline >= 0 ? result.stdout.slice(0, newline) : "";
	const html = newline >= 0 ? result.stdout.slice(newline + 1) : result.stdout;
	return { url: full_url, html };
}

// ---------------------------------------------------------------------------
// Full SSG build (writes dist/ - mutation-gated)
// ---------------------------------------------------------------------------

export async function run_ssg(timeout = 300): Promise<CommandResult> {
	assert_mcp_mutation_enabled();
	return run_bun(["scripts/ssg.ts"], timeout);
}

// ---------------------------------------------------------------------------
// Content validation (read-only)
// ---------------------------------------------------------------------------

export async function validate_content(): Promise<Record<string, any>> {
	const all_files = walk_dir(PUBLIC_DIR);
	const pages = without_draft_pages(collect_page_files(PUBLIC_DIR, languages));
	const ree_files = pages.filter((f) => f.endsWith(".ree"));
	const md_files = pages.filter((f) => f.endsWith(".md"));

	const collisions = find_ree_md_collisions(ree_files, md_files);
	const schema_files = find_schema_files(all_files);
	const collection_issues = schema_files.length > 0 ? await validate_collections(
		all_files,
		PUBLIC_DIR
	) : [];

	return {
		ok: collisions.length === 0 && collection_issues.length === 0,
		collection_schemas: schema_files,
		ree_md_collisions: collisions,
		collection_issues,
	};
}
