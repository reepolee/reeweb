import { join } from "node:path";

import type { FileChange } from "./files";
import type { PublisherView } from "./runner";

const template_path = join(import.meta.dir, "dashboard.html");
const template_file = Bun.file(template_path);
const dashboard_template = await template_file.text();

function escape_html(value: string): string {
	const ampersands_escaped = value.replaceAll("&", "&amp;");
	const less_than_escaped = ampersands_escaped.replaceAll("<", "&lt;");
	const greater_than_escaped = less_than_escaped.replaceAll(">", "&gt;");
	return greater_than_escaped.replaceAll('"', "&quot;");
}

function render_change(change: FileChange): string {
	const label = `${change.kind.toUpperCase()} ${change.path}`;
	let details = `<p>${change.old_size} bytes to ${change.new_size} bytes</p>`;
	if (change.old_text !== undefined || change.new_text !== undefined) {
		const old_text = escape_html(change.old_text ?? "");
		const new_text = escape_html(change.new_text ?? "");
		details += `<div class="text-diff"><section><h4>Deployed</h4><pre>${old_text}</pre></section><section><h4>Candidate</h4><pre>${new_text}</pre></section></div>`;
	} else {
		const old_hash = escape_html(change.old_hash || "none");
		const new_hash = escape_html(change.new_hash || "none");
		details += `<p><code>${old_hash}</code><br><code>${new_hash}</code></p>`;
	}
	return `<details><summary class="${change.kind}">${escape_html(label)}</summary>${details}</details>`;
}

function replace_placeholders(
	template: string,
	replacements: Record<string, string>,
): string {
	let html = template;
	for (const [placeholder, value] of Object.entries(replacements)) {
		html = html.replaceAll(placeholder, value);
	}
	return html;
}

export function render_dashboard(view: PublisherView, preview_url: string): string {
	const changes = view.changes.map(render_change);
	const change_html = changes.length > 0 ? changes.join("") : "<p>No generated file changes.</p>";
	const publish_disabled = view.status !== "ready" || view.changes.length === 0;
	const disabled = publish_disabled ? " disabled" : "";
	const error_html = view.error ? `<p class="error">${escape_html(view.error)}</p>` : "";
	const output = escape_html(view.output.join("\n"));
	const preview_link = view.preview_running
		? `<a class="button" href="${escape_html(preview_url)}" target="_blank">Open candidate preview</a>`
		: "";
	const busy_statuses = ["starting", "waiting", "rendering", "deploying"];
	const busy = busy_statuses.includes(view.status);
	const refresh_meta = busy ? '<meta http-equiv="refresh" content="2">' : "";

	return replace_placeholders(dashboard_template, {
		"__REFRESH_META__": refresh_meta,
		"__STATUS__": escape_html(view.status),
		"__BRANCH__": escape_html(view.branch),
		"__HEAD__": escape_html(view.head.slice(0, 8)),
		"__ERROR_HTML__": error_html,
		"__PREVIEW_LINK__": preview_link,
		"__PUBLISH_DISABLED__": disabled,
		"__CHANGE_COUNT__": String(view.changes.length),
		"__CHANGE_HTML__": change_html,
		"__OUTPUT__": output,
	});
}
