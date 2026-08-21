/**
 * <tailwind-size> and <browser-data> custom elements - dev-only viewport/breakpoint inspector.
 *
 * <tailwind-size> renders live window/viewport dimensions plus which Tailwind
 * breakpoint (xs/sm/md/lg/xl/2xl) is currently active, along with orientation
 * and hover/touch capability. <browser-data> wraps it in a fixed corner toggle
 * button, remembering its open state in localStorage and bound to the "/" key.
 *
 * Both elements only render their content when props.is_dev is true - the
 * layout only includes the script tag in dev, so this file is a no-op in prod.
 */

(function () {
	"use strict";

	const STORAGE_KEY = "info-visible";

	class TailwindSize extends HTMLElement {
		connectedCallback() {
			const one_line = this.hasAttribute("one-line");
			this.className = one_line ? "flex items-center gap-1" : "flex flex-col items-center gap-1";
			this.render();
			this._on_resize = () => this.render();
			window.addEventListener("resize", this._on_resize);
		}

		disconnectedCallback() {
			window.removeEventListener("resize", this._on_resize);
		}

		render() {
			const inner_w = window.innerWidth;
			const inner_h = window.innerHeight;
			const outer_w = window.outerWidth;
			const outer_h = window.outerHeight;

			this.innerHTML = `
				<div>Outer: ${outer_w} x ${outer_h}</div>
				<div>Inner: ${inner_w} x ${inner_h}</div>
				<div>
					<span class="landscape:hidden">P</span>
					<span class="portrait:hidden">L</span>

					<span class="has-touch">touch</span>
					<span class="can-hover">hover</span>

					<span class="inline-flex sm:hidden">xs</span>
					<span class="hidden sm:inline-flex md:hidden">sm</span>
					<span class="hidden md:inline-flex lg:hidden">md</span>
					<span class="hidden lg:inline-flex xl:hidden">lg</span>
					<span class="hidden xl:inline-flex 2xl:hidden">xl</span>
					<span class="hidden 2xl:inline-flex">2xl</span>
				</div>
			`;
		}
	}

	class BrowserData extends HTMLElement {
		connectedCallback() {
			let visible = false;
			try {
				visible = JSON.parse(localStorage.getItem(STORAGE_KEY) || "false");
			} catch (e) {
				/* private mode or corrupt value */
			}

			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "fixed right-4 bottom-4 z-10 rounded-lg bg-[black] px-4 py-2 text-center text-sm text-[white]";
			btn.hidden = !visible;

			const size = document.createElement("tailwind-size");
			size.setAttribute("one-line", "");
			btn.appendChild(size);

			btn.addEventListener("click", () => this.set_visible(btn, btn.hidden));

			this.replaceChildren(btn);
			this._btn = btn;

			this._on_keyup = (event) => {
				if (event.key === "/") this.set_visible(btn, btn.hidden);
			};
			window.addEventListener("keyup", this._on_keyup);
		}

		disconnectedCallback() {
			window.removeEventListener("keyup", this._on_keyup);
		}

		set_visible(btn, visible) {
			btn.hidden = !visible;
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(visible));
			} catch (e) {
				/* private mode */
			}
		}
	}

	customElements.define("tailwind-size", TailwindSize);
	customElements.define("browser-data", BrowserData);
})();
