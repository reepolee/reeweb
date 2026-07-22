/**
 * scripts/dev/i18n_ws.ts
 *
 * Dev-only inspector WebSocket messages for in-place translation editing,
 * carried over the existing /__reload socket. The browser sends the page URL it
 * is viewing plus a dotted key; the server resolves the language + template from
 * the URL (same way the HTTP renderer does) to locate and edit the right
 * {lang}.json file.
 *
 * Messages (client -> server):
 *   { type: "i18n_get",    url, key, id }        -> current value for the key
 *   { type: "i18n_update", url, key, value, id } -> write value, return saved
 * Replies (server -> client), echoing `id`:
 *   { type: "i18n_value",  id, ok, value?, file?, error? }
 *   { type: "i18n_saved",  id, ok, value?, file?, error? }
 */

import type { ServerWebSocket } from "bun";

import type { SiteState } from "./site_state";
import { resolve_request, resolve_template } from "./resolve";
import { resolve_i18n_target, write_i18n_value } from "./i18n_write";

type IncomingI18n = { type: "i18n_get"; url: string; key: string; id?: string | number; } | {
	type: "i18n_update";
	url: string;
	key: string;
	value: string;
	id?: string | number;
};

/** Resolve a viewed page URL to its language + template rel_path, or null. */
function page_for_url(url: string, state: SiteState): { lang: string; rel_path: string; } | null {
	const pathname = new URL(
		url,
		"http://localhost",
	).pathname;
	const request = resolve_request(pathname);
	const resolved = resolve_template(request.path, request.lang, state);
	if (!resolved) return null;
	return { lang: request.lang, rel_path: resolved.rel_path };
}

/**
 * Handle a parsed inspector i18n message. Returns true if the message was an
 * i18n message (handled), false if it was not ours (caller may handle it).
 */
export async function handle_i18n_message(ws: ServerWebSocket, raw: string, state: SiteState): Promise<boolean> {
	let msg: IncomingI18n;
	try {
		msg = JSON.parse(raw);
	} catch {
		return false;
	}
	if (msg == null || (msg.type !== "i18n_get" && msg.type !== "i18n_update")) return false;

	const page = page_for_url(msg.url, state);
	if (!page) {
		const reply_type = msg.type === "i18n_get" ? "i18n_value" : "i18n_saved";
		ws.send(JSON.stringify({
			type: reply_type,
			id: msg.id,
			ok: false,
			error: "page not found for url",
		}));
		return true;
	}

	if (msg.type === "i18n_get") {
		const target = resolve_i18n_target(state.public_dir, page.rel_path, page.lang, msg.key);
		if (!target.ok) {
			ws.send(JSON.stringify({
				type: "i18n_value",
				id: msg.id,
				ok: false,
				error: target.reason,
			}));
			return true;
		}
		ws.send(JSON.stringify({
			type: "i18n_value",
			id: msg.id,
			ok: true,
			value: target.current ?? "",
			file: target.file,
		}));
		return true;
	}

	// i18n_update
	const result = await write_i18n_value(
		state.public_dir,
		page.rel_path,
		page.lang,
		msg.key,
		msg.value
	);
	if (!result.ok) {
		ws.send(JSON.stringify({
			type: "i18n_saved",
			id: msg.id,
			ok: false,
			error: result.reason,
		}));
		return true;
	}
	ws.send(JSON.stringify({
		type: "i18n_saved",
		id: msg.id,
		ok: true,
		value: msg.value,
		file: result.file,
	}));
	return true;
}
