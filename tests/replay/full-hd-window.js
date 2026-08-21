import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const cli_path = process.argv[1] ?? "";
const cli_directory = dirname(cli_path);
const replay_module_path = process.env.REPLAY_MAIN_PATH ?? join(cli_directory, "main.js");
const replay_module_url = pathToFileURL(replay_module_path).href;
const replay_module = await import(replay_module_url);
const { PuppeteerRunnerExtension } = replay_module;

export default class FullHdWindowExtension extends PuppeteerRunnerExtension {
	async beforeAllSteps(flow) {
		await super.beforeAllSteps(flow);

		if (process.env.PUPPETEER_HEADLESS === "true") return;

		const cdp_session = await this.page.target().createCDPSession();
		const window_info = await cdp_session.send("Browser.getWindowForTarget");
		const window_bounds = {
			left: window_info.bounds.left,
			top: window_info.bounds.top,
			width: 1920,
			height: 1080,
			windowState: "normal",
		};

		await cdp_session.send("Browser.setWindowBounds", {
			windowId: window_info.windowId,
			bounds: window_bounds,
		});
		await cdp_session.detach();
	}

	async runStep(step, flow) {
		// Intercept typing steps to type with randomized human-like delays
		if (
			process.env.PUPPETEER_HEADLESS !== "true" &&
			step.type === "change" &&
			typeof step.value === "string"
		) {
			const css_selector = find_css_selector(step.selectors);
			if (css_selector) {
				try {
					await this.page.waitForSelector(css_selector, { timeout: 3000 });

					// Clear existing value (select all + backspace)
					await this.page.click(css_selector, { clickCount: 3 });
					await this.page.keyboard.press("Backspace");

					// Type character-by-character with random human delays (50ms to 160ms)
					for (const char of step.value) {
						const randomDelay = Math.floor(Math.random() * (160 - 50 + 1)) + 50;
						await this.page.type(css_selector, char, { delay: randomDelay });
					}

					// Return early as we handled the input change step manually
					return;
				} catch (_) {
					// Fallback to default replay runner if custom selector fails
				}
			}
		}

		// Default step execution for clicks, navigation, etc.
		await super.runStep(step, flow);
	}

	async beforeEachStep(step, flow) {
		await super.beforeEachStep(step, flow);

		if (process.env.PUPPETEER_HEADLESS === "true") return;

		const css_selector = find_css_selector(step.selectors);
		const is_click = step.type === "click" || step.type === "doubleClick";
		if (!css_selector && !this.cursor_position) return;

		if (css_selector) {
			try {
				await this.page.waitForSelector(css_selector, { timeout: 2000 });
			} catch (_) {
				// Fallback to coordinates if selector isn't found immediately
			}
		}

		const pointer_position = await this.page.evaluate(
			(selector, offset_x, offset_y, should_show_click, starting_position) => {
				let cursor = document.querySelector("#replay-virtual-cursor");
				let cursor_created = false;

				if (!cursor) {
					cursor_created = true;
					cursor = document.createElement("div");
					cursor.id = "replay-virtual-cursor";

					// Set Popover attribute to float in Top Layer over native <dialog> elements
					cursor.setAttribute("popover", "manual");

					cursor.innerHTML = `
                        <div class="cursor-pointer"></div>
                        <div class="cursor-ripple"></div>
                    `;

					const cursor_style = document.createElement("style");
					cursor_style.id = "replay-virtual-cursor-style";
					cursor_style.textContent = `
                        #replay-virtual-cursor[popover] {
                            position: fixed;
                            inset: auto;
                            top: 0;
                            left: 0;
                            margin: 0;
                            padding: 0;
                            border: none;
                            background: transparent;
                            overflow: visible;
                            pointer-events: none;
                            z-index: 2147483647;
                            transition: transform 300ms cubic-bezier(0.22, 1, 0.36, 1);
                            will-change: transform;
                        }
                        #replay-virtual-cursor .cursor-pointer {
                            width: 20px;
                            height: 20px;
                            background: rgba(244, 63, 94, 0.9);
                            border: 2px solid #ffffff;
                            border-radius: 50%;
                            box-shadow: 0 0 8px rgba(0, 0, 0, 0.4);
                        }
                        #replay-virtual-cursor .cursor-ripple {
                            position: absolute;
                            top: -10px;
                            left: -10px;
                            width: 40px;
                            height: 40px;
                            border: 3px solid #f43f5e;
                            border-radius: 50%;
                            opacity: 0;
                            transform: scale(0.2);
                        }
                        #replay-virtual-cursor.is-clicking .cursor-ripple {
                            animation: replay-ripple-effect 600ms ease-out;
                        }
                        @keyframes replay-ripple-effect {
                            0% { transform: scale(0.2); opacity: 1; }
                            100% { transform: scale(2.5); opacity: 0; }
                        }
                    `;
					document.head.appendChild(cursor_style);
					document.body.appendChild(cursor);

				}

				// Locate target element position
				const target = selector ? document.querySelector(selector) : null;
				let posX = starting_position?.x ?? 100;
				let posY = starting_position?.y ?? 100;

				if (target) {
					const rect = target.getBoundingClientRect();
					posX = rect.left + (offset_x ?? rect.width / 2);
					posY = rect.top + (offset_y ?? rect.height / 2);
				}

				if (cursor_created) {
					cursor.style.transition = "none";
				}

				// Position fixed cursor relative to viewport
				cursor.style.transform = `translate3d(${posX}px, ${posY}px, 0)`;

				if (cursor_created) {
					try {
						cursor.showPopover();
					} catch (_) {}
					void cursor.offsetWidth;
					cursor.style.transition = "transform 300ms cubic-bezier(0.22, 1, 0.36, 1)";
				}

				// Trigger click ripple animation
				cursor.classList.remove("is-clicking");
				if (should_show_click) {
					void cursor.offsetWidth; // Force reflow
					cursor.classList.add("is-clicking");
				}

				return { pos_x: posX, pos_y: posY };
			},
			css_selector,
			step.offsetX,
			step.offsetY,
			is_click,
			this.cursor_position
		);

		if (pointer_position) {
			this.cursor_position = {
				x: pointer_position.pos_x,
				y: pointer_position.pos_y,
			};
		}

		if (pointer_position && is_click) {
			// Allow click animation time to play before executing step action
			await new Promise((resolve) => setTimeout(resolve, 800));
		}
	}

	async afterEachStep(step, flow) {
		await super.afterEachStep(step, flow);

		if (process.env.PUPPETEER_HEADLESS === "true" || step.type !== "navigate") return;

		await this.page.keyboard.press("Escape");
	}
}

function find_css_selector(selectors) {
	if (!selectors) return null;

	for (const selector_path of selectors) {
		const selector = selector_path[0];
		if (
			typeof selector === "string" &&
			!selector.startsWith("aria/") &&
			!selector.startsWith("xpath/")
		) {
			return selector;
		}
	}

	return null;
}
