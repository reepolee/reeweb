import { readFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const [flow_path, replay_headless] = process.argv.slice(2);
const path_value = process.env.PATH ?? process.env.Path ?? "";
const path_entries = path_value.split(delimiter);
const npm_bin_path = path_entries.find((path_entry) => {
	const normalized_path = path_entry.replaceAll("\\", "/");
	return normalized_path.endsWith("/node_modules/.bin");
});

if (!flow_path || !npm_bin_path) {
	throw new Error("Replay runner requires a flow path and npm's transient package directory.");
}

const node_modules_path = dirname(npm_bin_path);
const replay_module_path = join(node_modules_path, "@puppeteer", "replay", "lib", "main.js");
const puppeteer_module_path = join(node_modules_path, "puppeteer", "lib", "puppeteer", "puppeteer.js");
const extension_module_path = join(process.cwd(), "tests", "replay", "full-hd-window.js");
const replay_module = await import(pathToFileURL(replay_module_path).href);
const puppeteer_module = await import(pathToFileURL(puppeteer_module_path).href);

process.env.REPLAY_MAIN_PATH = replay_module_path;
const extension_module = await import(pathToFileURL(extension_module_path).href);

const { createRunner, parse } = replay_module;
const { default: puppeteer } = puppeteer_module;
const { default: FullHdWindowExtension } = extension_module;
const flow_source = await readFile(flow_path, "utf8");
const flow_json = JSON.parse(flow_source);
const flow = parse(flow_json);
const headless = replay_headless === "shell" ? "shell" : replay_headless === "true" || replay_headless === "1";
const browser = await puppeteer.launch({
	headless,
	args: [
		"--disable-features=Translate,TranslateUI",
		"--disable-component-extensions-with-background-pages",
	],
});

try {
	const page = await browser.newPage();
	const extension = new FullHdWindowExtension(browser, page);
	const runner = await createRunner(flow, extension);
	const run_success = await runner.run();
	if (!run_success) process.exitCode = 1;
} finally {
	await browser.close();
}
