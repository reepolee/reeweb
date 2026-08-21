/**
 * scripts/dev/class_ws.ts
 *
 * Dev-only inspector WebSocket messages for editing a plain HTML tag's class
 * attribute in .ree source, carried over the /__reload socket. The browser
 * sends the stamped source file + line + tag name; the server reads or rewrites
 * the literal class attribute in that file.
 *
 * Messages (client -> server):
 *   { type: "class_get",    file, line, tag, id }        -> current class value
 *   { type: "class_update", file, line, tag, value, id } -> patch, return saved
 * Replies (server -> client), echoing `id`:
 *   { type: "class_value",  id, ok, value?, has_attr?, error? }
 *   { type: "class_saved",  id, ok, error? }
 *
 * The file path is validated against the project root (same guard as the
 * /__ree_open editor launcher) before any read or write.
 */

import type { ServerWebSocket } from "bun";

import { patch_class_in_source, read_class_from_source } from "./class_write";
import { validate_open_request } from "./open_in_editor";

type IncomingClass = {
	type: "class_get";
	file: string;
	line: number;
	tag: string;
	id?: string | number;
} | {
	type: "class_update";
	file: string;
	line: number;
	tag: string;
	value: string;
	id?: string | number;
};

/**
 * Handle a parsed inspector class message. Returns true if the message was a
 * class message (handled), false if it was not ours (caller may handle it).
 */
export async function handle_class_message(ws: ServerWebSocket, raw: string, project_root: string): Promise<boolean> {
	let msg: IncomingClass;
	try {
		msg = JSON.parse(raw);
	} catch {
		return false;
	}
	if (msg == null || (msg.type !== "class_get" && msg.type !== "class_update")) return false;

	const reply_type = msg.type === "class_get" ? "class_value" : "class_saved";

	const validation = validate_open_request(project_root, msg.file, String(msg.line));
	if (!validation.ok) {
		ws.send(JSON.stringify({
			type: reply_type,
			id: msg.id,
			ok: false,
			error: validation.reason,
		}));
		return true;
	}
	const file_abs = validation.file_abs;
	const line = validation.line;
	const tag = String(msg.tag ?? "").toLowerCase();
	if (!tag) {
		ws.send(JSON.stringify({ type: reply_type, id: msg.id, ok: false, error: "missing tag" }));
		return true;
	}

	const source = await Bun.file(file_abs).text();

	if (msg.type === "class_get") {
		const result = read_class_from_source(source, line, tag);
		if (!result.ok) {
			ws.send(JSON.stringify({
				type: "class_value",
				id: msg.id,
				ok: false,
				error: result.reason,
			}));
			return true;
		}
		ws.send(JSON.stringify({
			type: "class_value",
			id: msg.id,
			ok: true,
			value: result.value,
			has_attr: result.has_attr,
		}));
		return true;
	}

	// class_update
	const patched = patch_class_in_source(source, line, tag, msg.value);
	if (!patched.ok) {
		ws.send(JSON.stringify({
			type: "class_saved",
			id: msg.id,
			ok: false,
			error: patched.reason,
		}));
		return true;
	}
	await Bun.write(file_abs, patched.source);
	ws.send(JSON.stringify({ type: "class_saved", id: msg.id, ok: true }));
	return true;
}
