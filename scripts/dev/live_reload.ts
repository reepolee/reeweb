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

export async function inject_live_reload(html: string): Promise<string> {
	const reload_script = await get_client_script();
	const inspector_script = await get_inspector_script();
	const tag = `<script>${reload_script}</script><script>${inspector_script}</script>`;
	if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${tag}</body>`);
	return html + tag;
}

export function notify_clients(): void {
	for (const ws of clients) {
		if (ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ type: "reload" })); }
	}
}
