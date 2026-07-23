import { resolve } from "node:path";

export type PublisherConfig = {
	project_root: string;
	port: number;
	preview_port: number;
	publish_branch: string;
	dev_reload_url: string;
};

function require_env(name: string): string {
	const value = Bun.env[name]?.trim();
	if (!value) { throw new Error(`${name} is required in .env`); }
	return value;
}

function require_port(name: string): number {
	const raw_value = require_env(name);
	const port = Number(raw_value);
	if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
		throw new Error(`${name} must be a valid TCP port`);
	}
	return port;
}

export function load_publisher_config(): PublisherConfig {
	const port = require_port("PUBLISHER_PORT");
	const preview_port = require_port("PUBLISHER_PREVIEW_PORT");
	const dev_port = require_port("PORT");
	const publish_branch = require_env("PUBLISHER_BRANCH");

	if (port === preview_port || port === dev_port || preview_port === dev_port) {
		throw new Error("PORT, PUBLISHER_PORT, and PUBLISHER_PREVIEW_PORT must be different");
	}

	return {
		project_root: resolve("."),
		port,
		preview_port,
		publish_branch,
		dev_reload_url: `http://127.0.0.1:${dev_port}/__publisher_reload`,
	};
}
