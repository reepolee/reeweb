#!/usr/bin/env bun

import { hostname } from "node:os";

import { load_publisher_config } from "./publisher/config";
import { render_dashboard } from "./publisher/dashboard";
import { PublisherRunner } from "./publisher/runner";

const config = load_publisher_config();

if (Bun.argv.includes("--render")) {
	const signal_url = `http://127.0.0.1:${config.port}/api/render`;
	const response = await fetch(signal_url, { method: "POST" });
	if (!response.ok) { throw new Error(`Publisher returned ${response.status}`); }
	console.log("Render requested");
	process.exit(0);
}

const runner = new PublisherRunner(config);
const server = Bun.serve({
	hostname: "0.0.0.0",
	port: config.port,
	async fetch(req): Promise<Response> {
		const url = new URL(req.url);

		if (req.method === "GET" && url.pathname === "/api/health") {
			return Response.json({ ok: true, status: runner.status });
		}
		if (req.method === "GET" && url.pathname === "/api/state") {
			return Response.json(runner.view());
		}
		if (req.method === "POST" && url.pathname === "/api/render-signal") {
			runner.signal();
			return new Response(null, { status: 202 });
		}
		if (req.method === "POST" && url.pathname === "/api/render") {
			runner.force_render();
			const redirect_url = new URL("/", url);
			return Response.redirect(redirect_url.href, 303);
		}
		if (req.method === "POST" && url.pathname === "/api/deploy") {
			const deployed = await runner.deploy();
			const redirect_url = new URL(deployed ? "/" : "/?deploy=failed", url);
			return Response.redirect(redirect_url.href, 303);
		}
		if (req.method === "GET" && url.pathname === "/") {
			const request_host = url.hostname || hostname();
			const preview_url = `http://${request_host}:${config.preview_port}/`;
			const html = render_dashboard(runner.view(), preview_url);
			return new Response(html, {
				headers: { "Content-Type": "text/html; charset=utf-8" },
			});
		}

		return new Response("Not Found", { status: 404 });
	},
});

const display_host = Bun.env.SERVER_NAME || hostname();
const publisher_url = `http://${display_host}:${server.port}/`;
console.log(`Publisher ready on ${publisher_url}`);
await runner.start();

async function shutdown(): Promise<void> {
	await runner.stop();
	await server.stop(true);
	process.exit(0);
}

process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
