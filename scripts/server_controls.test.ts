import { describe, expect, test } from "bun:test";

import { listen_for_open_key, open_browser_command } from "./server_controls";

describe("server controls", () => {
	test("builds the browser command for each supported platform", () => {
		expect(open_browser_command("http://localhost:3000/", "darwin")).toEqual([
			"open",
			"http://localhost:3000/",
		]);
		expect(open_browser_command("http://localhost:3000/", "win32")).toEqual([
			"cmd.exe",
			"/c",
			"start",
			"",
			"http://localhost:3000/",
		]);
		expect(open_browser_command("http://localhost:3000/", "linux")).toEqual([
			"xdg-open",
			"http://localhost:3000/",
		]);
	});

	test("opens the serving URL for lowercase and uppercase o", () => {
		const data_listeners: Array<(data: string) => void> = [];
		const spawned_commands: string[][] = [];
		const input = {
			isTTY: true,
			setRawMode() {},
			resume() {},
			on(_event: "data", listener: (data: string) => void) { data_listeners.push(listener); },
		};
		const cleanup = listen_for_open_key("http://localhost:3000/", input, (command) => spawned_commands.push(
			command
		), "linux");

		data_listeners[0]?.("o");
		data_listeners[0]?.("O");
		data_listeners[0]?.("x");
		cleanup();

		expect(spawned_commands).toEqual([
			["xdg-open", "http://localhost:3000/"],
			["xdg-open", "http://localhost:3000/"],
		]);
	});
});
