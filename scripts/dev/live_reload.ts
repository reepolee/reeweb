/**
 * scripts/dev/live_reload.ts
 *
 * WebSocket live-reload: a small client script injected into every HTML
 * response, plus a hub that tracks connected clients and broadcasts reloads.
 *
 * The clients Set is stored on globalThis so it survives bun --hot
 * re-evaluations of this module.
 */

import type { ServerWebSocket } from "bun";
import { join } from "path";

export const clients = new Set<ServerWebSocket>();

let _client_script: string | null = null;
let _inspector_script: string | null = null;
let _issue_reporter_script: string | null = null;
let _markdown_editor_script: string | null = null;

async function get_client_script(): Promise<string> {
	if (_client_script === null) {
		try {
			_client_script = await Bun.file(join(import.meta.dir, "livereload_client.js")).text();
		} catch {
			_client_script = "";
		}
	}
	return _client_script;
}

async function get_inspector_script(): Promise<string> {
	if (_inspector_script === null) {
		try {
			_inspector_script = await Bun.file(join(import.meta.dir, "inspector-client.js")).text();
		} catch {
			_inspector_script = "";
		}
	}
	return _inspector_script;
}

async function get_issue_reporter_script(): Promise<string> {
	if (_issue_reporter_script === null) {
		try {
			_issue_reporter_script = await Bun.file(join(import.meta.dir, "issue-reporter-client.js")).text();
		} catch {
			_issue_reporter_script = "";
		}
	}
	return _issue_reporter_script;
}

// The issue reporter dialog's Description field uses the <markdown-editor>
// web component. It must be defined before the reporter client runs, so it is
// inlined ahead of issue-reporter-client.js (dev pages only, like the other
// injected clients - absent from the SSG build).
async function get_markdown_editor_script(): Promise<string> {
	if (_markdown_editor_script === null) {
		try {
			_markdown_editor_script = await Bun.file(join(import.meta.dir, "markdown-editor.js")).text();
		} catch {
			_markdown_editor_script = "";
		}
	}
	return _markdown_editor_script;
} export async function inject_live_reload(html: string): Promise<string> {
	const reload_script = await get_client_script();
	const inspector_script = await get_inspector_script();
	const markdown_editor_script = await get_markdown_editor_script();
	const issue_reporter_script = await get_issue_reporter_script();
	const tag = `<script>${reload_script}</script><script>${inspector_script}</script><script>${markdown_editor_script}</script><script>${issue_reporter_script}</script>`;
	if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${tag}</body>`);
	return html + tag;
}

export function notify_clients(): void {
	for (const ws of clients) {
		if (ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ type: "reload" })); }
	}
}
