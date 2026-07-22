/**
 * Tests for dev-server argument parsing.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "path";

import { parse_dev_args } from "./cli";

// PORT is env-only (strict); parse_dev_args exits(1) if PORT is unset and no
// --port is passed. Set it explicitly so these tests never depend on an
// ambient .env being auto-loaded.
describe("parse_dev_args", () => {
	let saved: string | undefined;
	beforeEach(() => {
		saved = process.env.PORT;
		process.env.PORT = "3000";
	});
	afterEach(() => {
		if (saved === undefined) delete process.env.PORT; else process.env.PORT = saved;
	});

	test("reads PORT from the environment", () => expect(parse_dev_args([])).toEqual({
		public_dir: resolve("./src/public"),
		port: 3000,
	}));

	test("--port / -p override the PORT env value", () => {
		process.env.PORT = "3000";
		expect(parse_dev_args(["--public", "./site", "--port", "8080"])).toEqual({
			public_dir: resolve("./site"),
			port: 8080,
		});
		expect(parse_dev_args(["--dir", "./site", "-p", "9000"])).toEqual({
			public_dir: resolve("./site"),
			port: 9000,
		});
	});

	test("--help invokes the on_help callback", () => {
		let called = false;
		parse_dev_args(["--help"], () => called = true);
		expect(called).toBe(true);
	});
});
