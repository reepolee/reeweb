#!/usr/bin/env bun

/**
 * Runs the Chrome DevTools Recorder smoke flows against the built static site.
 * The runner is intentionally dependency-free: npm downloads the pinned replay
 * tools for the invocation and uses an already-installed Chrome executable.
 * Set PUPPETEER_HEADLESS=true for an invisible CI run.
 */

import { existsSync } from "fs";

const test_port = 3099;
const npm_path = Bun.which("npm");
const replay_headless = process.env.PUPPETEER_HEADLESS ?? "false";
const chrome_path = process.platform === "win32"
	? "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
	: process.env.PUPPETEER_EXECUTABLE_PATH;

if (!chrome_path || !existsSync(chrome_path)) {
	throw new Error("Chrome is required. Set PUPPETEER_EXECUTABLE_PATH to its executable path.");
}

if (!npm_path) {
	throw new Error("npm is required to run the transient Recorder tools.");
}

const flow_glob = new Bun.Glob("tests/replay/*.json");
const flow_paths: string[] = [];
for await (const flow_path of flow_glob.scan(".")) {
	flow_paths.push(flow_path);
}

if (flow_paths.length === 0) {
	throw new Error("No Recorder flows found in tests/replay.");
}

const preview_url = `http://127.0.0.1:${test_port}/`;
const preview_deadline = Date.now() + 10_000;

let preview_ready = false;
while (!preview_ready && Date.now() < preview_deadline) {
	try {
		const preview_response = await fetch(preview_url);
		preview_ready = preview_response.ok;
	} catch {
		await Bun.sleep(100);
	}
}

if (!preview_ready) {
	throw new Error(`Preview server did not respond at ${preview_url}. Start the site on port ${test_port} first.`);
}

for (const flow_path of flow_paths) {
	const replay_process = Bun.spawn(
		[
			npm_path,
			"exec",
			"--yes",
			"--package=@puppeteer/replay@4.0.2",
			"--package=puppeteer@25.4.0",
			"--",
			"node",
			"tests/replay/replay-runner.js",
			flow_path,
			replay_headless,
		],
		{
			cwd: process.cwd(),
			stdout: "inherit",
			stderr: "inherit",
			env: {
				...process.env,
				PUPPETEER_SKIP_DOWNLOAD: "true",
				PUPPETEER_EXECUTABLE_PATH: chrome_path,
			},
		}
	);

	const replay_exit_code = await replay_process.exited;
	if (replay_exit_code !== 0) {
		throw new Error(`${flow_path} failed with exit code ${replay_exit_code}.`);
	}
}
