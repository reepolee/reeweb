/**
 * File System Watcher - detects source file changes and triggers live reload.
 *
 * Mirrors reepolee's lib/watcher.ts structure exactly.
 * TypeScript changes are NOT handled here - bun --hot re-evaluates modules,
 * which triggers the hot-reload path in dev.ts to rebuild state and notify clients.
 *
 * CSS is rebuilt by a persistent `tailwindcss --watch=always` process,
 * spawned once in scripts/dev/orchestrate.ts, not by this watcher. This
 * watcher only watches src/public/css/style.min.css (the build output) and
 * notifies the browser once it changes.
 *
 * `--watch=always` is required: without it, tailwindcss's watcher exits as
 * soon as it detects its stdin has closed, which Bun.spawn's non-interactive
 * stdin triggers almost immediately - the process looks alive but silently
 * stops rebuilding.
 *
 * `--source` in src/css/style.css must use directory paths, not glob
 * patterns (`@source "../lib"`, not `@source "../lib/**\/*"`) - glob patterns
 * are misinterpreted by Tailwind v4's scanner, which then falls back to
 * scanning parent directories broadly enough to catch style.min.css itself,
 * causing the watcher to re-trigger on its own output on every rebuild.
 */

import { watch } from "node:fs";
import { extname } from "node:path";

export type WatcherDeps = { project_root: string; reload_state: () => Promise<void>; notify_clients: () => void; };

let watcher: ReturnType<typeof watch> | null = null;
const file_timestamps = new Map<string, number>();
let reload_timeout: Timer | null = null;

// The [dev] tag itself is applied globally by a console.log wrap in dev.ts
// (that file's module-top-level code), since this process's stdio is
// inherited rather than piped through orchestrate.ts's prefixed_pipe.
function debounced_reload(notify_clients: () => void, message: string) {
	if (reload_timeout) clearTimeout(reload_timeout);
	reload_timeout = setTimeout(() => {
		console.log(message);
		notify_clients();
	}, 100);
}

export function start_watcher(deps: WatcherDeps): void {
	if (watcher) { watcher.close(); }

	watcher = watch(deps.project_root, { recursive: true }, async (event, filename) => {
		if (!filename) return;
		if (filename.includes("node_modules") || filename.includes(".git") || filename.includes(
			"dist"
		)) return;

		const posix_path = filename.replaceAll("\\", "/");
		if (posix_path.endsWith("src/public/css/style.min.css")) {
			debounced_reload(deps.notify_clients, `🎨 CSS rebuilt: ${filename}`);
			return;
		}

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
			debounced_reload(deps.notify_clients, `🔄 Source ${event}: ${filename}`);
		} else if (ext === ".ts") {
			debounced_reload(deps.notify_clients, `🔄 Source ${event}: ${filename}`);
		}
	});

	console.log("👀 Watching for changes...");
}
