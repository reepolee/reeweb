/**
 * scripts/dev/issue-reporter-client.js
 *
 * Dev-only GitHub issue reporter client. Injected sibling to livereload_client.js
 * and inspector-client.js by inject_live_reload()'s </body> rewrite (dev server
 * only, so absent from the SSG build). Ctrl+Shift+I opens a dialog for filing a
 * GitHub issue against the repo named in package.json "ree.issue_repo".
 *
 * Ported from reepolee-dev's lib/issue_reporter_client.js. The only real change
 * is styling: reepolee's Tailwind semantic tokens (bg-surface, text-danger, ...)
 * do not exist in ree-web, and injected scripts are not scanned by Tailwind
 * anyway, so every style is inline - the dialog must render identically before
 * the page stylesheet loads and across livereload.
 */

const GITHUB_LABELS = [
	{ name: "bug", color: "#d73a4a" },
	{ name: "documentation", color: "#0075ca" },
	{ name: "duplicate", color: "#cfd3d7" },
	{ name: "enhancement", color: "#a2eeef" },
	{ name: "good first issue", color: "#7057ff" },
	{ name: "help wanted", color: "#008672" },
	{ name: "invalid", color: "#e4e669" },
	{ name: "question", color: "#d876e3" },
	{ name: "wontfix", color: "#ffffff" },
];

let dialog_el = null;
let filed_from_url = null; // page URL captured when the dialog opened
let snapshots = []; // ordered list of { label, blob }

const INPUT_STYLE = "width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:4px;background:#f8fafc;padding:6px 8px;color:#1a1a2e;font:inherit";
const BTN_STYLE = "cursor:pointer;border:1px solid #cbd5e1;border-radius:4px;background:#f8fafc;padding:4px 12px;color:#1a1a2e;font:inherit";

function build_dialog() {
	const dialog = document.createElement("dialog");
	dialog.id = "issue-reporter-dialog";
	// showModal() centers the dialog via the native `margin: auto` + `inset: 0`
	// rule, but the page's global reset (`* { margin: 0 }`) overrides that margin
	// and pins the dialog to the top-left. Set it back inline so the dialog stays
	// centered regardless of the page stylesheet.
	dialog.style.cssText = "width:520px;max-width:92vw;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:0;color:#1a1a2e;font:14px/1.5 system-ui,sans-serif;box-shadow:0 10px 15px -3px rgba(0,0,0,0.1),0 4px 6px -4px rgba(0,0,0,0.1)";

	const labels_html = GITHUB_LABELS.map((label) => `
		<label style="margin:2px 10px 2px 0;display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:13px">
			<input type="checkbox" name="labels" value="${label.name}" />
			<span style="display:inline-block;height:10px;width:10px;border-radius:999px;border:1px solid #cbd5e1;background:${label.color}"></span>
			${label.name}
		</label>
	`).join("");

	dialog.innerHTML = `
		<form id="issue-reporter-form" style="display:flex;flex-direction:column;gap:12px;padding:20px">
			<h2 style="margin:0;font-size:16px;font-weight:600">New GitHub Issue</h2>

			<label style="display:flex;flex-direction:column;gap:4px">
				Title:
				<input type="text" name="title" required style="${INPUT_STYLE}" />
			</label>

			<div>
				<div style="margin-bottom:4px">Labels:</div>
				${labels_html}
			</div>

			<label style="display:flex;flex-direction:column;gap:4px">
				Description:
				<textarea name="description" rows="6" style="${INPUT_STYLE};resize:vertical"></textarea>
			</label>

			<div>
				<div style="margin-bottom:4px">Screenshots:</div>

				<div style="margin-bottom:6px;display:flex;flex-wrap:wrap;align-items:center;gap:8px">
					<button type="button" id="issue-reporter-capture-before" class="capture-btn" style="${BTN_STYLE}">Capture before state</button>
					<div id="issue-reporter-before-slot" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px"></div>
				</div>

				<div style="margin-bottom:6px;display:flex;flex-wrap:wrap;align-items:center;gap:8px">
					<button type="button" id="issue-reporter-capture-after" class="capture-btn" style="${BTN_STYLE}">Capture after state</button>
					<div id="issue-reporter-after-slot" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px"></div>
				</div>

				<div style="margin-bottom:6px;display:flex;flex-wrap:wrap;align-items:center;gap:8px">
					<button type="button" id="issue-reporter-add-another" class="capture-btn" style="${BTN_STYLE}">Add another</button>
					<button type="button" id="issue-reporter-paste" style="${BTN_STYLE}">Paste from clipboard</button>
				</div>

				<div id="issue-reporter-extra-slot" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px"></div>

				<div id="issue-reporter-capture-hint" style="margin-bottom:6px;display:none;font-size:12px;color:#b45309">Screen capture needs https - open over your tunnel, or use "Paste from clipboard" instead.</div>
				<span id="issue-reporter-screenshot-status" style="font-size:12px;color:#64748b"></span>
			</div>

			<div id="issue-reporter-error" style="display:none;font-size:13px;color:#dc2626"></div>
			<div id="issue-reporter-success" style="display:none;font-size:13px;color:#16a34a"></div>

			<div style="margin-top:4px;display:flex;justify-content:flex-end;gap:8px">
				<button type="button" id="issue-reporter-cancel" style="${BTN_STYLE}">Cancel</button>
				<button type="submit" id="issue-reporter-submit" style="cursor:pointer;border:1px solid #16a34a;border-radius:4px;background:#16a34a;padding:4px 12px;color:#fff;font:inherit">Create Issue</button>
			</div>
		</form>
	`;

	document.body.appendChild(dialog);
	return dialog;
}

function set_status(message) {
	if (!dialog_el) return;
	const status_el = dialog_el.querySelector("#issue-reporter-screenshot-status");
	if (status_el) status_el.textContent = message;
}

// Enable/disable the capture buttons based on whether getDisplayMedia is
// available in this context, and show the secure-context hint when it is not.
function update_capture_availability() {
	if (!dialog_el) return;
	const supported = screen_capture_supported();
	for (const button of dialog_el.querySelectorAll(".capture-btn")) {
		button.disabled = !supported;
		button.style.opacity = supported ? "1" : "0.5";
		button.style.cursor = supported ? "pointer" : "not-allowed";
	}
	dialog_el.querySelector("#issue-reporter-capture-hint").style.display = supported ? "none" : "block";
}

function add_snapshot(label, blob) {
	snapshots.push({ label: label || "Screenshot", blob });
	render_thumbnails();
}

function build_snapshot_row(snapshot, index) {
	const row = document.createElement("div");
	row.style.cssText = "display:flex;align-items:center;gap:8px";

	const image = document.createElement("img");
	image.src = URL.createObjectURL(snapshot.blob);
	image.style.cssText = "height:54px;width:72px;border-radius:4px;border:1px solid #cbd5e1;object-fit:cover";

	const label = document.createElement("input");
	label.type = "text";
	label.value = snapshot.label;
	label.style.cssText = "width:110px;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:4px;background:#f8fafc;padding:4px 6px;color:#1a1a2e;font:inherit";
	label.addEventListener("change", () => { snapshot.label = label.value.trim() || "Screenshot"; });

	const annotate_btn = document.createElement("button");
	annotate_btn.type = "button";
	annotate_btn.textContent = "Annotate";
	annotate_btn.style.cssText = BTN_STYLE + ";padding:4px 8px;font-size:12px";
	annotate_btn.addEventListener("click", () => re_annotate(index));

	const remove_btn = document.createElement("button");
	remove_btn.type = "button";
	remove_btn.textContent = "Remove";
	remove_btn.style.cssText = "cursor:pointer;border:none;background:none;padding:4px;color:#dc2626;font-size:12px";
	remove_btn.addEventListener("click", () => {
		snapshots.splice(index, 1);
		render_thumbnails();
	});

	row.append(image, label, annotate_btn, remove_btn);
	return row;
}

function render_thumbnails() {
	const slots = {
		before: dialog_el.querySelector("#issue-reporter-before-slot"),
		after: dialog_el.querySelector("#issue-reporter-after-slot"),
		extra: dialog_el.querySelector("#issue-reporter-extra-slot"),
	};
	for (const slot of Object.values(slots)) slot.innerHTML = "";

	snapshots.forEach((snapshot, index) => {
		const row = build_snapshot_row(snapshot, index);
		if (snapshot.label === "Before") slots.before.appendChild(row);
		else if (snapshot.label === "After") slots.after.appendChild(row);
		else slots.extra.appendChild(row);
	});
}

async function paste_from_clipboard() {
	set_status("");
	try {
		const clipboard_items = await navigator.clipboard.read();
		for (const item of clipboard_items) {
			const image_type = item.types.find((t) => t.startsWith("image/"));
			if (image_type) {
				const blob = await item.getType(image_type);
				add_snapshot("Screenshot", blob);
				return;
			}
		}
		set_status("No image found in clipboard");
	} catch (err) {
		const err_name = err instanceof Error ? err.name : "Error";
		const err_message = err instanceof Error ? err.message : String(err);
		set_status(`Clipboard read failed (${err_name}: ${err_message}) - use Ctrl+V in the dialog instead`);
	}
}

function blob_to_image(blob) {
	return new Promise((resolve, reject) => {
		const object_url = URL.createObjectURL(blob);
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("Failed to load image"));
		image.src = object_url;
	});
}

// Screen capture (getDisplayMedia) is only exposed in a secure context (https
// or localhost). On plain http the capture button is disabled with a hint.
function screen_capture_supported() {
	return !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
}

async function capture_viewport_frame() {
	if (!screen_capture_supported()) {
		throw new Error("Screen capture requires a secure context (https or localhost)");
	}
	const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
	try {
		const video = document.createElement("video");
		video.muted = true;
		video.srcObject = stream;
		await new Promise((resolve, reject) => {
			if (video.videoWidth) return resolve();
			video.onloadeddata = resolve;
			video.onerror = () => reject(new Error("Failed to decode the captured stream"));
			video.play().catch(reject);
		});
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		const canvas = document.createElement("canvas");
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;
		canvas.getContext("2d").drawImage(video, 0, 0);
		return canvas;
	} finally {
		stream.getTracks().forEach((track) => track.stop());
	}
}

function reopen_issue_dialog() {
	if (!dialog_el || dialog_el.open) return;
	dialog_el.showModal();
}

async function capture_and_annotate(label) {
	// Close the dialog first so it does not appear in the captured screen.
	dialog_el.close();
	let capture_error = "";
	try {
		const canvas = await capture_viewport_frame();
		// Load the most recent snapshot as a reference so the before and after
		// states are visible side by side while annotating the new capture.
		let reference_canvas = null;
		let reference_label = null;
		if (snapshots.length > 0) {
			const previous = snapshots[snapshots.length - 1];
			try {
				const image = await blob_to_image(previous.blob);
				reference_canvas = document.createElement("canvas");
				reference_canvas.width = image.naturalWidth;
				reference_canvas.height = image.naturalHeight;
				reference_canvas.getContext("2d").drawImage(image, 0, 0);
				reference_label = previous.label || "Previous";
			} catch {
				// Previous snapshot could not be loaded; proceed without a reference.
			}
		}
		return await run_annotation(canvas, reference_canvas, reference_label, label);
	} catch (err) {
		capture_error = err instanceof Error ? err.message : String(err);
		return null;
	} finally {
		// Always restore the issue form, including when the annotation editor is
		// canceled or an unexpected capture/annotation error occurs.
		reopen_issue_dialog();
		if (capture_error) set_status(`Capture failed: ${capture_error}`);
	}
}

async function re_annotate(index) {
	const snapshot = snapshots[index];
	let canvas;
	try {
		const image = await blob_to_image(snapshot.blob);
		canvas = document.createElement("canvas");
		canvas.width = image.naturalWidth;
		canvas.height = image.naturalHeight;
		canvas.getContext("2d").drawImage(image, 0, 0);
	} catch (err) {
		set_status("Failed to load snapshot for annotation");
		return;
	}
	dialog_el.close();
	try {
		const blob = await run_annotation(canvas);
		if (blob) {
			snapshot.blob = blob;
			render_thumbnails();
		}
	} finally {
		// Canceling re-annotation must return to the issue form with the
		// original snapshot still available.
		reopen_issue_dialog();
	}
}

async function on_capture(label) {
	set_status("");
	const blob = await capture_and_annotate(label);
	if (blob) add_snapshot(label, blob);
}

// Sample the captured frame to decide whether it is dark or light, so the
// default annotation color contrasts with the screenshot.
function canvas_is_dark(canvas) {
	try {
		const sample = document.createElement("canvas");
		sample.width = 16;
		sample.height = 16;
		const sample_ctx = sample.getContext("2d", { willReadFrequently: true });
		sample_ctx.drawImage(canvas, 0, 0, 16, 16);
		const data = sample_ctx.getImageData(0, 0, 16, 16).data;
		let luminance = 0;
		for (let i = 0; i < data.length; i += 4) {
			luminance += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
		}
		return luminance / (16 * 16) < 128;
	} catch {
		return false;
	}
}

// Annotation tool settings are persisted in localStorage so QA does not have to
// re-pick the tool, color, and stroke width on every capture.
const ANNOTATION_SETTINGS_KEY = "reeweb.annotation-settings";

function load_annotation_settings() {
	try {
		return JSON.parse(localStorage.getItem(ANNOTATION_SETTINGS_KEY)) || {};
	} catch {
		return {};
	}
}

function save_annotation_settings(settings) {
	try {
		localStorage.setItem(ANNOTATION_SETTINGS_KEY, JSON.stringify(settings));
	} catch {
		// localStorage may be unavailable (private mode / blocked); ignore.
	}
}

// Full-viewport annotation editor. Draws shapes on top of `base_canvas` and
// resolves with the flattened PNG blob, or null when the user cancels.
function run_annotation(base_canvas, reference_canvas, reference_label, active_label) {
	return new Promise((resolve) => {
		const overlay = document.createElement("div");
		overlay.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;user-select:none;background:rgba(0,0,0,0.85)";

		const toolbar = document.createElement("div");
		toolbar.style.cssText = "display:flex;align-items:center;gap:10px;overflow-x:auto;background:rgba(30,32,38,0.95);padding:8px 12px;font-size:14px;color:#fff";

		const tool_select = document.createElement("select");
		tool_select.innerHTML = `
			<option value="arrow">Arrow</option>
			<option value="rect">Rectangle</option>
			<option value="ellipse">Ellipse</option>
			<option value="pen">Pen</option>
			<option value="blur">Blur / redact</option>
			<option value="text">Text</option>
		`;
		tool_select.style.cssText = "height:28px;width:130px;flex-shrink:0;border-radius:4px;border:1px solid #94a3b8;background:#fff;padding:0 8px;color:#1f2328;font:inherit;line-height:1";
		tool_select.style.backgroundImage = 'url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns=\'http://www.w3.org/2000/svg\'%20viewBox=\'0%200%2016%2016\'%3E%3Cpath%20fill=\'%236b7280\'%20d=\'M8%2011%203%206h10z\'/%3E%3C/svg%3E")';
		tool_select.style.backgroundRepeat = "no-repeat";
		tool_select.style.backgroundPosition = "right 8px center";
		tool_select.style.backgroundSize = "12px 12px";

		const saved = load_annotation_settings();
		const is_dark = canvas_is_dark(base_canvas);
		const color_input = document.createElement("input");
		color_input.type = "color";
		color_input.value = saved.color || (is_dark ? "#ffffff" : "#111111");
		color_input.style.cssText = "height:28px;width:32px;cursor:pointer;border:none;background:transparent;padding:0";

		const width_input = document.createElement("input");
		width_input.type = "range";
		width_input.min = "2";
		width_input.max = "24";
		width_input.value = saved.width || "4";
		width_input.style.cssText = "width:90px";

		if (saved.tool && Array.from(tool_select.options).some((option) => option.value === saved.tool)) {
			tool_select.value = saved.tool;
		}

		// Persist tool/width on every change, and color only when the user
		// explicitly picks one - so the auto-contrast default still applies to
		// screenshots of a different brightness until they override it.
		let user_picked_color = false;
		function persist_settings() {
			const settings = load_annotation_settings();
			settings.tool = tool_select.value;
			settings.width = width_input.value;
			if (user_picked_color) settings.color = color_input.value;
			save_annotation_settings(settings);
		}
		tool_select.addEventListener("change", persist_settings);
		width_input.addEventListener("input", persist_settings);
		color_input.addEventListener("input", () => { user_picked_color = true; persist_settings(); });

		function toolbar_button(text) {
			const button = document.createElement("button");
			button.type = "button";
			button.textContent = text;
			button.style.cssText = "display:inline-flex;height:28px;flex-shrink:0;align-items:center;justify-content:center;white-space:nowrap;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.1);padding:0 10px;color:#fff;cursor:pointer;font:inherit;line-height:1";
			return button;
		}

		function toolbar_group(label, control) {
			const group = document.createElement("span");
			group.style.cssText = "display:inline-flex;flex-shrink:0;align-items:center;gap:6px;white-space:nowrap";
			group.append(label, control);
			return group;
		}

		const undo_btn = toolbar_button("Undo");
		const redo_btn = toolbar_button("Redo");
		const clear_btn = toolbar_button("Clear");
		const cancel_btn = toolbar_button("Cancel");
		const done_btn = toolbar_button("Done");
		done_btn.style.cssText = "display:inline-flex;height:28px;flex-shrink:0;align-items:center;justify-content:center;white-space:nowrap;border-radius:4px;border:1px solid #16a34a;background:#16a34a;padding:0 14px;color:#fff;cursor:pointer;font:inherit;line-height:1";

		toolbar.append(
			toolbar_group("Tool", tool_select),
			toolbar_group("Color", color_input),
			toolbar_group("Width", width_input),
			undo_btn,
			redo_btn,
			clear_btn,
			cancel_btn,
			done_btn
		);

		const canvas_wrap = document.createElement("div");
		canvas_wrap.style.cssText = "flex:1;display:flex;align-items:center;justify-content:center;gap:16px;overflow:auto;padding:12px";

		function build_panel(label_text, source_canvas, active) {
			const panel = document.createElement("div");
			panel.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:6px";
			if (reference_canvas) panel.style.flex = "1";
			if (label_text) {
				const label = document.createElement("div");
				label.textContent = label_text;
				label.style.cssText = "font-size:13px;color:#fff;opacity:0.85";
				panel.appendChild(label);
			}
			const el = document.createElement("canvas");
			el.width = source_canvas.width;
			el.height = source_canvas.height;
			el.style.cssText = active
				? "max-height:calc(100vh - 160px);max-width:100%;cursor:crosshair;touch-action:none;background:#fff"
				: "max-height:calc(100vh - 160px);max-width:100%;background:#fff";
			el.getContext("2d").drawImage(source_canvas, 0, 0);
			panel.appendChild(el);
			canvas_wrap.appendChild(panel);
			return { panel, canvas: el };
		}

		const reference_panel = reference_canvas ? build_panel(reference_label || "Previous", reference_canvas, false) : null;
		const canvas = build_panel(active_label || "", base_canvas, true).canvas;

		const ctx = canvas.getContext("2d");

		// Collapse/expand the reference (previous) panel while annotating.
		if (reference_panel) {
			const ref_name = reference_label || "previous";
			const toggle_btn = toolbar_button(`Hide ${ref_name}`);
			toggle_btn.addEventListener("click", () => {
				const was_hidden = reference_panel.panel.style.display === "none";
				reference_panel.panel.style.display = was_hidden ? "" : "none";
				toggle_btn.textContent = `${was_hidden ? "Hide" : "Show"} ${ref_name}`;
			});
			toolbar.insertBefore(toggle_btn, done_btn);
		}

		overlay.append(toolbar, canvas_wrap);
		document.body.appendChild(overlay);

		const actions = []; // completed shapes/blurs, in order
		const redo_stack = [];
		let drawing = null; // in-progress shape

		function canvas_point(event) {
			const rect = canvas.getBoundingClientRect();
			return {
				x: (event.clientX - rect.left) * (canvas.width / rect.width),
				y: (event.clientY - rect.top) * (canvas.height / rect.height),
			};
		}

		function draw_shape(shape) {
			ctx.save();
			ctx.strokeStyle = shape.color;
			ctx.fillStyle = shape.color;
			ctx.lineWidth = shape.size;
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			if (shape.type === "pen") {
				ctx.beginPath();
				ctx.moveTo(shape.points[0][0], shape.points[0][1]);
				for (let i = 1; i < shape.points.length; i++) ctx.lineTo(shape.points[i][0], shape.points[i][1]);
				ctx.stroke();
			} else if (shape.type === "arrow") {
				const dx = shape.x2 - shape.x1;
				const dy = shape.y2 - shape.y1;
				const angle = Math.atan2(dy, dx);
				const head = Math.max(10, shape.size * 3);
				ctx.beginPath();
				ctx.moveTo(shape.x1, shape.y1);
				ctx.lineTo(shape.x2, shape.y2);
				ctx.stroke();
				ctx.beginPath();
				ctx.moveTo(shape.x2, shape.y2);
				ctx.lineTo(shape.x2 - head * Math.cos(angle - Math.PI / 6), shape.y2 - head * Math.sin(angle - Math.PI / 6));
				ctx.moveTo(shape.x2, shape.y2);
				ctx.lineTo(shape.x2 - head * Math.cos(angle + Math.PI / 6), shape.y2 - head * Math.sin(angle + Math.PI / 6));
				ctx.stroke();
			} else if (shape.type === "rect") {
				const x = Math.min(shape.x1, shape.x2);
				const y = Math.min(shape.y1, shape.y2);
				const w = Math.abs(shape.x2 - shape.x1);
				const h = Math.abs(shape.y2 - shape.y1);
				ctx.strokeRect(x, y, w, h);
			} else if (shape.type === "ellipse") {
				const cx = (shape.x1 + shape.x2) / 2;
				const cy = (shape.y1 + shape.y2) / 2;
				const rx = Math.abs(shape.x2 - shape.x1) / 2;
				const ry = Math.abs(shape.y2 - shape.y1) / 2;
				ctx.beginPath();
				ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
				ctx.stroke();
			} else if (shape.type === "text") {
				ctx.font = `${Math.max(12, shape.size * 4)}px system-ui, sans-serif`;
				ctx.fillText(shape.text, shape.x, shape.y);
			}
			ctx.restore();
		}

		function apply_blur(shape) {
			const x = Math.min(shape.x1, shape.x2);
			const y = Math.min(shape.y1, shape.y2);
			const w = Math.abs(shape.x2 - shape.x1);
			const h = Math.abs(shape.y2 - shape.y1);
			if (w < 1 || h < 1) return;
			const radius = Math.max(6, shape.size * 3);
			const tmp = document.createElement("canvas");
			tmp.width = Math.max(1, Math.round(w));
			tmp.height = Math.max(1, Math.round(h));
			tmp.getContext("2d").drawImage(canvas, x, y, w, h, 0, 0, tmp.width, tmp.height);
			ctx.save();
			ctx.filter = `blur(${radius}px)`;
			ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, w, h);
			ctx.restore();
		}

		function apply_action(shape) {
			if (shape.type === "blur") apply_blur(shape);
			else draw_shape(shape);
		}

		function redraw() {
			ctx.filter = "none";
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			ctx.drawImage(base_canvas, 0, 0);
			for (const action of actions) apply_action(action);
			if (drawing) apply_action(drawing);
		}

		function commit_action(shape) {
			actions.push(shape);
			redo_stack.length = 0;
		}

		function place_text(point, event) {
			const input = document.createElement("input");
			input.type = "text";
			input.placeholder = "Type annotation...";
			const input_bg = is_dark ? "rgba(20,22,26,.9)" : "rgba(255,255,255,.95)";
			input.style.cssText = `position:fixed;left:${event.clientX}px;top:${event.clientY}px;z-index:10;border:1px solid ${color_input.value};border-radius:4px;padding:2px 6px;font:${Math.max(12, Number(width_input.value) * 4)}px system-ui,sans-serif;color:${color_input.value};background:${input_bg};`;
			overlay.appendChild(input);
			// Defer focus so the browser's default mousedown focus handling cannot
			// immediately blur (and dismiss) the freshly created input.
			setTimeout(() => input.focus(), 0);
			let committed = false;
			function commit() {
				if (committed) return;
				committed = true;
				const text = input.value.trim();
				if (text) commit_action({ type: "text", text, x: point.x, y: point.y, color: color_input.value, size: Number(width_input.value) });
				input.remove();
				redraw();
			}
			input.addEventListener("keydown", (key_event) => {
				if (key_event.key === "Enter") commit();
				else if (key_event.key === "Escape") { committed = true; input.remove(); }
			});
			input.addEventListener("blur", commit);
		}

		function on_pointer_down(event) {
			const point = canvas_point(event);
			const active_tool = tool_select.value;
			if (active_tool === "text") { event.preventDefault(); place_text(point, event); return; }
			drawing = { type: active_tool, color: color_input.value, size: Number(width_input.value), x1: point.x, y1: point.y, x2: point.x, y2: point.y };
			if (active_tool === "pen") drawing.points = [[point.x, point.y]];
			canvas.setPointerCapture(event.pointerId);
			redraw();
		}

		function on_pointer_move(event) {
			if (!drawing) return;
			const point = canvas_point(event);
			if (drawing.type === "pen") drawing.points.push([point.x, point.y]);
			else { drawing.x2 = point.x; drawing.y2 = point.y; }
			redraw();
		}

		function on_pointer_up(event) {
			if (!drawing) return;
			if (canvas.hasPointerCapture && canvas.hasPointerCapture(event.pointerId)) {
				canvas.releasePointerCapture(event.pointerId);
			}
			commit_action(drawing);
			drawing = null;
			redraw();
		}

		function undo() {
			const action = actions.pop();
			if (action) { redo_stack.push(action); redraw(); }
		}

		function redo() {
			const action = redo_stack.pop();
			if (action) { actions.push(action); redraw(); }
		}

		function clear() {
			actions.length = 0;
			redo_stack.length = 0;
			redraw();
		}

		function cleanup() {
			document.removeEventListener("keydown", on_keydown);
			overlay.remove();
		}

		function finish() {
			redraw();
			canvas.toBlob((blob) => {
				cleanup();
				resolve(blob);
			}, "image/png");
		}

		function cancel() {
			cleanup();
			resolve(null);
		}

		function on_keydown(event) {
			const target = event.target;
			if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
			if (event.key === "Escape") cancel();
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) { event.preventDefault(); undo(); }
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && event.shiftKey) { event.preventDefault(); redo(); }
		}

		canvas.addEventListener("pointerdown", on_pointer_down);
		canvas.addEventListener("pointermove", on_pointer_move);
		canvas.addEventListener("pointerup", on_pointer_up);
		canvas.addEventListener("pointercancel", on_pointer_up);
		undo_btn.addEventListener("click", undo);
		redo_btn.addEventListener("click", redo);
		clear_btn.addEventListener("click", clear);
		cancel_btn.addEventListener("click", cancel);
		done_btn.addEventListener("click", finish);
		document.addEventListener("keydown", on_keydown);
	});
}

async function submit_issue(event) {
	event.preventDefault();

	const form = dialog_el.querySelector("#issue-reporter-form");
	const submit_btn = dialog_el.querySelector("#issue-reporter-submit");
	const error_el = dialog_el.querySelector("#issue-reporter-error");
	const success_el = dialog_el.querySelector("#issue-reporter-success");

	error_el.style.display = "none";
	success_el.style.display = "none";

	const form_data = new FormData(form);
	form_data.set("page_url", filed_from_url || window.location.href);
	for (const snapshot of snapshots) {
		form_data.append("screenshot", snapshot.blob, "screenshot.png");
		form_data.append("screenshot_label", snapshot.label || "Screenshot");
	}

	submit_btn.disabled = true;
	submit_btn.textContent = "Creating...";

	try {
		const response = await fetch("/__issue", { method: "POST", body: form_data });
		const result = await response.json();

		if (!response.ok || !result.ok) {
			error_el.textContent = result.error || "Failed to create issue";
			error_el.style.display = "block";
			return;
		}

		// Upload degrades server-side: the issue is filed even when a screenshot
		// fails. Keep the dialog open in that case so the warning is actually read.
		const screenshot_errors = result.screenshot_errors || [];
		if (screenshot_errors.length > 0) {
			success_el.textContent = `Issue created without screenshot(s): ${result.url}`;
			success_el.style.display = "block";
			error_el.textContent = `Screenshot upload failed: ${screenshot_errors.join("; ")}`;
			error_el.style.display = "block";
			window.open(result.url, "_blank");
			return;
		}

		success_el.textContent = `Issue created: ${result.url}`;
		success_el.style.display = "block";
		window.open(result.url, "_blank");
		dialog_el.close();
	} catch (err) {
		error_el.textContent = err instanceof Error ? err.message : String(err);
		error_el.style.display = "block";
	} finally {
		submit_btn.disabled = false;
		submit_btn.textContent = "Create Issue";
	}
}

function reset_form_state() {
	const error_el = dialog_el.querySelector("#issue-reporter-error");
	const success_el = dialog_el.querySelector("#issue-reporter-success");
	error_el.style.display = "none";
	success_el.style.display = "none";
	dialog_el.querySelector("#issue-reporter-form").reset();
	snapshots = [];
	render_thumbnails();
	set_status("");
	update_capture_availability();
}

function open_issue_dialog() {
	// Ignore when already open: reset_form_state() below would wipe the title,
	// description, and any captured snapshots the user already entered.
	if (dialog_el && dialog_el.open) return;

	if (!dialog_el) {
		dialog_el = build_dialog();
		dialog_el.querySelector("#issue-reporter-form").addEventListener("submit", submit_issue);
		dialog_el.querySelector("#issue-reporter-cancel").addEventListener("click", () => dialog_el.close());
		dialog_el.querySelector("#issue-reporter-paste").addEventListener("click", paste_from_clipboard);
		dialog_el.querySelector("#issue-reporter-capture-before").addEventListener("click", () => on_capture("Before"));
		dialog_el.querySelector("#issue-reporter-capture-after").addEventListener("click", () => on_capture("After"));
		dialog_el.querySelector("#issue-reporter-add-another").addEventListener("click", () => on_capture("Screenshot"));
		dialog_el.addEventListener("paste", (event) => {
			const item = Array.from(event.clipboardData?.items || []).find((i) => i.type.startsWith("image/"));
			if (item) {
				const file = item.getAsFile();
				if (file) add_snapshot("Screenshot", file);
			}
		});
	}

	reset_form_state();
	filed_from_url = window.location.href;
	dialog_el.showModal();
	dialog_el.querySelector('input[name="title"]').focus();
}

document.addEventListener("keydown", (event) => {
	if (event.ctrlKey && event.shiftKey && (event.key === "I" || event.key === "i")) {
		event.preventDefault();
		open_issue_dialog();
	}
});
