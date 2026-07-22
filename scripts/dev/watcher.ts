/**
 * File System Watcher - detects source file changes and triggers live reload.
 *
 * Mirrors reepolee's lib/watcher.ts structure exactly.
 * TypeScript changes are NOT handled here - bun --hot re-evaluates modules,
 * which triggers the hot-reload path in dev.ts to rebuild state and notify clients.
 */

import { watch } from "node:fs";
import { extname } from "node:path";

export type WatcherDeps = { project_root: string; reload_state: () => Promise<void>; notify_clients: () => void; };

let watcher: ReturnType<typeof watch> | null = null;
const file_timestamps = new Map<string, number>();
let reload_timeout: Timer | null = null;

function debounced_reload(notify_clients: () => void, message: string) {
	if (reload_timeout) clearTimeout(reload_timeout);
	reload_timeout = setTimeout(() => {
		console.log(message);
		notify_clients();
	}, 300);
}

export function start_watcher(deps: WatcherDeps): void {
	if (watcher) { watcher.close(); }

	watcher = watch(deps.project_root, { recursive: true }, async (_event, filename) => {
		if (!filename) return;
		if (filename.includes("node_modules") || filename.includes(".git") || filename.includes(
			"dist"
		)) return;

		const now = Date.now();
		const last_event_time = file_timestamps.get(filename) || 0;

		// Ignore duplicate events within 250ms
		if (now - last_event_time < 250) return;
		file_timestamps.set(filename, now);

		const ext = extname(filename).toLowerCase();

		if (ext === ".json" || ext === ".ree" || ext === ".md") {
			// Renames/adds/deletes of .ree/.md change the page inventory (which
			// route resolves to which file); .json can move localized URLs via
			// route_name. Reload state before notifying so a stale route never
			// wins a race against the browser's reload-triggered re-fetch.
			try {
				await deps.reload_state();
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`✗ Failed to reload state: ${msg}`);
				return;
			}
			debounced_reload(deps.notify_clients, `🔄 Change detected: ${filename}`);
		} else if (ext === ".ts") {
			debounced_reload(deps.notify_clients, `🔄 Change detected: ${filename}`);
		}
	});

	console.log("👀 Watching for changes...");
}
