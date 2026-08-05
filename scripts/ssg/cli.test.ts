/**
 * Tests for CLI argument parsing. `parse_args` takes an explicit argv slice
 * and an `on_help` override so it can be tested without touching process state.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "path";

import { parse_args } from "./cli";

// parse_args requires SITE_URL and BASE_URL (env) unless their flags are passed
// - it exits(1) otherwise (strict, .env-only). Set them explicitly so these unit
// tests never depend on an ambient .env being auto-loaded.
describe("parse_args", () => {
	let saved_site: string | undefined;
	let saved_base: string | undefined;
	beforeEach(() => {
		saved_site = process.env.SITE_URL;
		saved_base = process.env.BASE_URL;
		process.env.SITE_URL = "https://test.example";
		process.env.BASE_URL = "/";
	});
	afterEach(() => {
		if (saved_site === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = saved_site;
		if (saved_base === undefined) delete process.env.BASE_URL; else process.env.BASE_URL = saved_base;
	});

	test("reads env values when no args are given", () => {
		const opts = parse_args([]);
		expect(opts).toMatchObject({
			public_dir: resolve("./src/public"),
			dist_dir: resolve("./dist"),
			base_url: "/",
			verbose: false,
		});
	});

	test("parses each flag and resolves dir paths to absolute", () => {
		const opts = parse_args([
			"--public",
			"./pub",
			"--dist",
			"./out",
			"--base-url",
			"/app",
			"--verbose",
		]);
		expect(opts).toMatchObject({
			public_dir: resolve("./pub"),
			dist_dir: resolve("./out"),
			base_url: "/app",
			verbose: true,
		});
	});

	test("--site-url flag overrides the SITE_URL env value", () => {
		process.env.SITE_URL = "https://from-env.example";
		expect(parse_args([
			"--site-url",
			"https://from-flag.example",
		]).site_url).toBe("https://from-flag.example");
	});

	test("strips trailing slashes from site_url", () => expect(parse_args([
		"--site-url",
		"https://x.com//",
	]).site_url).toBe("https://x.com"));

	test("--help invokes the on_help callback", () => {
		let called = false;
		parse_args(["--help"], () => called = true);
		expect(called).toBe(true);
	});
});
