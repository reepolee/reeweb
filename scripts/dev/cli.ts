/**
 * scripts/dev/cli.ts
 *
 * Argument parsing for the dev server. Takes the argv slice explicitly so it
 * can be unit-tested without touching process state.
 */

import { resolve } from "path";

export type DevOptions = { public_dir: string; port: number; };

export function parse_dev_args(argv: string[] = process.argv.slice(2), on_help: () => void = () => {
	console.log("Usage: bun scripts/dev.ts [--public ./src/public] [--port 3000]");
	process.exit(0);
}): DevOptions {
	let public_dir = "./src/public";
	// PORT is env-only (strict, set in .env); --port overrides it. No hidden
	// code default - a missing PORT with no flag is an ingress error.
	let port_raw: string | undefined = process.env.PORT;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg) continue;

		if (arg === "--public" || arg === "--dir") {
			public_dir = argv[++i] ?? public_dir;
		} else if (arg === "--port" || arg === "-p") {
			port_raw = argv[++i] ?? port_raw;
		} else if (arg === "--help" || arg === "-h") {
			on_help();
		}
	}

	const port = Number(port_raw);
	if (!port_raw || !Number.isFinite(port) || port <= 0) {
		console.error("✗ port is required (set PORT in .env or pass --port)");
		process.exit(1);
	}

	return { public_dir: resolve(public_dir), port };
}
