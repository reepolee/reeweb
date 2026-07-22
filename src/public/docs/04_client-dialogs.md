---
layout:layout.ree
title:Dialogs
---

# Dialogs

<a name="introduction"></a>

## Introduction

reepolee leans on the native `<dialog>` element for every modal in the framework. The browser handles modal behaviour, focus trap, escape-key dismissal, and the `::backdrop` pseudo-element. Opening and closing happen through HTML attributes - `commandfor` and `command` - with no JavaScript at all. The only piece of JS reepolee ships is a tiny ~15-line script that wires up confirmation buttons.

The shipped file is `static/dialog-confirm.js`. Include it on pages where you have a confirm action; skip it otherwise.

<a name="loading-it"></a>

## Loading It

Include the script once on any page that uses a confirm dialog:

```html
<script src="/dialog-confirm.js?v={= props.version}"></script>
```

That's the only setup. Open/close need nothing - they're native HTML.

<a name="creating-a-dialog"></a>

## Creating a Dialog

A dialog is a `<dialog>` element. Open it with a button that has `commandfor` pointing at the dialog's id and `command="show-modal"`. Close it with a button inside the dialog that has `commandfor` pointing back at the same id and `command="close"`:

```html
<button commandfor="confirm_delete_dialog" command="show-modal">Delete…</button>

<dialog id="confirm_delete_dialog" class="p-0 rounded-xl shadow-2xl w-100">
	<div class="p-6">
		<h2 class="text-lg font-semibold">Delete this record?</h2>
		<p class="text-slate-600 mt-2">This cannot be undone.</p>

		<div class="mt-6 flex justify-end gap-2">
			<button class="px-3 py-1 rounded bg-slate-200" commandfor="confirm_delete_dialog" command="close">
				Cancel
			</button>
			<button class="px-3 py-1 rounded bg-reepolee text-white" data-dialog-confirm>Delete</button>
		</div>
	</div>
</dialog>
```

Three things to notice:

- **Trigger button uses `commandfor` + `command="show-modal"`** - the browser opens the dialog when the button is clicked. No `onclick`, no `Alpine`, no JS.
- **Cancel button uses `commandfor` + `command="close"`** - same mechanism, closing this time.
- **Confirm button has `data-dialog-confirm`** - the global handler in `dialog-confirm.js` picks this up.

<a name="confirmation-flow"></a>

## Confirmation Flow

The shipped `dialog-confirm.js` is a single delegated click listener:

```js
document.addEventListener("click", (e) => {
	const btn = e.target.closest("[data-dialog-confirm]");
	if (!btn) return;
	const dialog = btn.closest("dialog");
	if (!dialog) return;
	dialog.dispatchEvent(new CustomEvent("confirm"));
	dialog.close();
});
```

When the user clicks a confirm button, the script dispatches a `"confirm"` CustomEvent on the dialog and closes it. Your page listens for that event to do the actual work:

```html
<script>
	$("#confirm_delete_dialog").addEventListener("confirm", () => {
		document.getElementById("delete-form").submit();
	});
</script>
```

That's the entire convention. Open/close is HTML, confirm is one event listener.

<a name="form-method-dialog"></a>

## form method="dialog" - Native Submit-To-Close

For dialogs that just need to close on a button press without running custom logic, the native `<form method="dialog">` pattern works without any JS - the browser closes the dialog on submit and reports which button was used through `dialog.returnValue`:

```html
<dialog id="info_dialog">
	<p>Just an FYI.</p>
	<form method="dialog">
		<button value="ok">OK</button>
	</form>
</dialog>
```

The language-mismatch dialog in `routes/layout.ree` uses this pattern for its dismiss button (the "switch to other language" choice is just an `<a href="?lang=…">` next to the form).

<a name="canonical-examples"></a>

## Canonical Examples

Two generator templates show the convention end-to-end:

- **Bulk-action confirm** - `generator/templates/index.ree`. A "Bulk action" button opens `action_dialog`; a confirm button inside fires the `"confirm"` event; the page listener reads the selected checkbox values and runs the action.
- **Delete confirm** - `generator/templates/form.ree`. An "action_delete" button opens `action_delete_dialog`; confirming submits the form with `_action=delete`.

Both follow the same shape: trigger button with `commandfor` + `command="show-modal"`, cancel button with `commandfor` + `command="close"`, confirm button with `data-dialog-confirm`, and a one-line `addEventListener("confirm", …)` block.

<a name="styling-the-backdrop"></a>

## Styling the Backdrop

The `::backdrop` pseudo-element styles the dimmed area behind the dialog. The reference layout uses a subtle blur for the language-mismatch dialog:

```css
#lang_mismatch_dialog::backdrop {
	background: rgba(0, 0, 0, 0.3);
	backdrop-filter: blur(4px);
	-webkit-backdrop-filter: blur(4px);
}
```

For project-wide defaults, target every dialog backdrop in your base styles:

```css
dialog::backdrop {
	background: rgba(15, 23, 42, 0.2);
	backdrop-filter: blur(1px);
}
```

<a name="positioning"></a>

## Positioning

Native `<dialog>` centres itself on the viewport by default. To override - for a settings panel that slides in from the right, say - set `position`, `top`, and `left` (or `right`) on the dialog element directly:

```css
#settings_dialog {
	position: fixed;
	top: 0;
	right: 0;
	bottom: 0;
	margin: 0;
	width: 320px;
	border-radius: 0;
}
```

The browser keeps the modal behaviour (focus trap, backdrop) regardless of where you position it.

<a name="animations"></a>

## Animations

Native dialogs don't animate by default - they snap open and snap closed. To add an enter animation, use a CSS keyframe triggered by the dialog's open state:

```css
dialog[open] {
	animation: dialog-in 0.2s ease-out;
}

@keyframes dialog-in {
	from {
		opacity: 0;
		transform: scale(0.95);
	}
	to {
		opacity: 1;
		transform: scale(1);
	}
}
```

For exit animations the story is more involved (the browser removes the element from the layout immediately on close), and most production apps either skip the exit animation or use `:starting-style` and `transition-behavior: allow-discrete` for the small set of browsers that support it. The trade-off is usually not worth the complexity for an internal admin UI.

<a name="opening-from-javascript"></a>

## Opening From JavaScript

If you need to open a dialog from code rather than a button click, use the native `showModal()` method directly:

```js
document.getElementById("lang_mismatch_dialog")?.showModal();
```

This is how the layout opens the language-mismatch dialog when the page-language and preferred-language differ - a one-liner at the bottom of the rendered dialog.

<a name="browser-support"></a>

## Browser Support

Native `<dialog>` is supported in every evergreen browser. The `commandfor` + `command` invoker attributes are newer - they're available in current Chrome and Edge and ship as Baseline in 2025-era browsers. For older Safari and Firefox, the same buttons can fall back to `onclick="document.getElementById('confirm_delete_dialog').showModal()"`, but for the audience reepolee targets, the native attributes are the simplest path.
