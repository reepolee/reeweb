#!/usr/bin/env bun

/**
 * scripts/dev.ts
 *
 * Development server for src/public/ pages. Serves .ree templates and .md files
 * directly with live reload - no build step required.
 *
 * Usage:
 *   bun scripts/dev.ts                         # serve ./src/public on :3000
 *   bun scripts/dev.ts --port 8080             # custom port
 *   bun scripts/dev.ts --public ./src          # custom source dir
 *
 * This file is a thin orchestrator; the server's pieces live in scripts/dev/
 * (same thin-orchestrator-plus-modules shape as scripts/ssg/):
 *
 *   dev/cli.ts          - argument parsing
 *   dev/site_state.ts   - translations + route maps + resolvers (reloadable)
 *   dev/resolve.ts      - request URL → language + template/markdown file
 *   dev/render.ts       - .ree / .md render handlers
 *   dev/pagination.ts   - paginated-route matching + rendering
 *   dev/page_data.ts    - the shared dev render-data object
 *   dev/sidebar.ts      - generic sidebar navigation
 *   dev/static_files.ts - static assets + dist/ build artifacts
 *   dev/live_reload.ts  - WebSocket live-reload clients + notify
 *   dev/watcher.ts      - source file watcher (.ree/.md/.json only; .ts handled by --hot)
 *   dev/responses.ts / dev/mime.ts - HTTP response helpers
 *
 * Two execution paths (mirrors reepolee's server.ts pattern):
 *   First run  - full initialization: create state, engine, server, watcher.
 *   Hot reload - bun --hot re-evaluated this module after a .ts change;
 *                reload state in place and notify connected browsers.
 */

import { existsSync } from "fs";
import { join, resolve } from "path";
import { hostname } from "node:os";

import { active_languages, default_language } from "$config/supported_languages";
import { find_ree_md_collisions } from "$lib/static_site";
import { DevTemplateEngine } from "$root/src/lib/dev_template_engine";

import { parse_dev_args } from "./dev/cli";
import { handle_class_message } from "./dev/class_ws";
import type { DevContext } from "./dev/context";
import { clients, notify_clients } from "./dev/live_reload";
import { handle_i18n_message } from "./dev/i18n_ws";
import { handle_open_request } from "./dev/open_in_editor";
import { match_pagination, render_pagination } from "./dev/pagination";
import { kill_port } from "./dev/port_release";
import { render_md, render_ree } from "./dev/render";
import { resolve_request, resolve_template } from "./dev/resolve";
import { respond_file, respond_html, respond_not_found } from "./dev/responses";
import { build_dev_sidebar_map } from "./dev/sidebar";
import type { ServerWebSocket } from "bun";

import { SiteState } from "./dev/site_state";
import { find_dist_artifact, find_static_file, is_generated_artifact, not_built_hint } from "./dev/static_files";
import { listen_for_open_key } from "./server_controls";
import { start_watcher } from "./dev/watcher";

/**
 * Route an inspector WS message to the right handler. Class-attribute edits
 * (class_write) and translation edits (i18n) both ride the /__reload socket;
 * each handler ignores messages that are not its own, so order is irrelevant.
 */
async function dispatch_inspector_message(ws: ServerWebSocket, raw: string, state: SiteState, project_root: string): Promise<void> {
	const handled_class = await handle_class_message(ws, raw, project_root);
	if (handled_class) return;
	await handle_i18n_message(ws, raw, state);
}

declare global {
	var __dev_server: Bun.Server | undefined;
	var __dev_state: SiteState | undefined;
}

const is_first_run = !globalThis.__dev_server;

if (!is_first_run) {
	//
	// HOT RELOAD - bun --hot re-evaluated this module after a .ts change.
	// Re-initialize site state in place and notify connected browsers.
	//
	console.log("🔄 Hot reload - reloading state in-place");
	try {
		await globalThis.__dev_state!.reload();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`  ✗ Failed to reload state: ${msg}`);
	}
	// Browser reload handled by the watcher for all file types.
} else {
	//
	// FIRST RUN - cold start: initialize everything.
	//

	const { public_dir, port } = parse_dev_args();

	// Kill any process already listening on the port before starting.
	console.log(`🔌 Releasing port ${port}...`);
	await kill_port(port);
	console.log(`🔌 Port ${port} ready`);

	const project_root = resolve(".");
	const static_dir = join(project_root, "static");
	const dist_dir = join(project_root, "dist");

	if (!existsSync(public_dir)) {
		console.error(`✗ Source directory not found: ${public_dir}`);
		process.exit(1);
	}

	console.log("📖 Loading translations...");
	const state = await SiteState.create(public_dir);
	globalThis.__dev_state = state;
	console.log(`    ✓ translations loaded`);
	console.log(
		`    📄 ${state.ree_files.length} template(s), 📝 ${state.md_files.length} markdown file(s)`
	);

	// A route backed by both a .ree and a .md is ambiguous: .ree wins and the
	// .md is shadowed. Dev only warns (the static build fails; see scripts/ssg).
	// The warning is loud at boot (A) and repeated per-request when a shadowed
	// route is served (B), because a single boot line is easy to scroll past.
	const ree_md_collisions = find_ree_md_collisions(state.ree_files, state.md_files);
	const shadowed_canonicals = new Set(ree_md_collisions.map((c) => c.canonical || "/"));
	// (B) is throttled to once per route per boot - a page reload / live-reload
	// re-fetch re-serves the route, and we don't want the warning on every hit.
	const warned_shadowed = new Set<string>();
	if (ree_md_collisions.length > 0) {
		const bar = "─".repeat(64);
		console.warn(`\n\x1b[1;31m${bar}\x1b[0m`);
		console.warn(`\x1b[1;31m⚠  ROUTE COLLISION: ${ree_md_collisions.length} route(s) have both a .ree and a .md source.\x1b[0m`);
		console.warn(`\x1b[1;31m   .ree wins; the .md is shadowed. The static build (bun ssg) will FAIL.\x1b[0m`);
		for (const collision of ree_md_collisions) {
			console.warn(`\x1b[31m     ${collision.canonical || "/"}  —  ${collision.ree}  vs  ${collision.md}\x1b[0m`);
		}
		console.warn(`\x1b[1;31m${bar}\x1b[0m\n`);
	}

	const engine = new DevTemplateEngine({
		views: public_dir,
		ext: ".ree",
		cache: false,
		auto_escape: true,
		project_root,
	});
	const sidebar_map = await build_dev_sidebar_map(state);
	const ctx: DevContext = { engine, state, sidebar_map };

	start_watcher({ project_root, reload_state: () => state.reload(), notify_clients });

	const server = Bun.serve(
		{
			port,
			fetch: async (req: Request): Promise<Response | undefined> => {
				const pathname = new URL(req.url).pathname;

				// WebSocket live reload.
				if (pathname === "/__reload") {
					if (server.upgrade(req)) return;
					return new Response("Expected WebSocket upgrade", { status: 426 });
				}

				// Inspector: open a stamped source file in the editor (dev only).
				if (pathname === "/__ree_open") { return handle_open_request(project_root, new URL(req.url)); }

				const { lang, path: canonical } = resolve_request(pathname);

				// Pagination routes (page 1 and /page/N) take precedence.
				const pmatch = match_pagination(canonical, lang, state);
				if (pmatch) return await render_pagination(ctx, pmatch, lang);

				// Template / markdown resolution.
				const resolved = resolve_template(canonical, lang, state);
				if (resolved?.kind === "ree") {
					// (B) Re-surface the collision the first time the shadowed route
					// is hit - the moment you'd wonder why your .md isn't rendering.
					// Once per route per boot (reloads re-serve the same route).
					if (shadowed_canonicals.has(canonical) && !warned_shadowed.has(canonical)) {
						warned_shadowed.add(canonical);
						console.warn(`\x1b[33m⚠  ${canonical} served from .ree — its .md is shadowed (see boot warning; build will fail)\x1b[0m`);
					}
					return await render_ree(ctx, resolved.rel_path, lang);
				}
				if (resolved?.kind === "md") return await render_md(
					ctx,
					resolved.rel_path,
					resolved.layout,
					lang
				);

				// Static assets (public/ then static/).
				const static_file = find_static_file(pathname, { public_dir, static_dir });
				if (static_file) return respond_file(static_file);

				// Generated build artifacts (sitemap, feeds) served from dist/ as a convenience.
				const dist_artifact = find_dist_artifact(pathname, dist_dir);
				if (dist_artifact) return respond_file(dist_artifact);
				if (is_generated_artifact(pathname)) return respond_html(
					not_built_hint(pathname),
					404
				);

				return respond_not_found();
			},
			websocket: {
				open(ws) { clients.add(ws); },
				close(ws) { clients.delete(ws); },
				message(ws, message) {
					// Inspector edits ride the live-reload socket: translation edits
					// (class_ handles plain-tag class attributes, i18n_ handles keys).
					const raw = typeof message === "string" ? message : message.toString();
					void dispatch_inspector_message(ws, raw, state, project_root);
				},
			},
		}
	);

	globalThis.__dev_server = server;

	console.log(`🖥️ Dev server ready`);
	console.log("");
	const display_host = Bun.env.SERVER_NAME || hostname();
	const serving_url = `http://${display_host}:${port}/`;
	console.log(`    \x1b[32m${serving_url}\x1b[0m`);
	console.log("");
	console.log(`    📂 Source: ${public_dir}`);
	console.log(`    🌐 Languages: ${active_languages.map((l) => `${l}${l === default_language ? " (default)" : ""}`).join(
		", "
	)}`);
	console.log(`    🔄 Live reload: active`);
	console.log("");
	listen_for_open_key(serving_url);
}
