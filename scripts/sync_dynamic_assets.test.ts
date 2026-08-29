import { describe, expect, test } from "bun:test";
import { join, resolve } from "path";

type CliResult = {
	exit_code: number;
	stdout: string;
	stderr: string;
};

async function run_without_reepolee_url(args: string[] = []): Promise<CliResult> {
	const environment = { ...Bun.env };
	delete environment.REEPOLEE_API_URL;

	const script_path = join(import.meta.dir, "sync_dynamic_assets.ts");
	const project_root = resolve(import.meta.dir, "..");
	const command = [process.execPath, script_path, ...args];
	const child_process = Bun.spawn(command, {
		cwd: project_root,
		env: environment,
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout_response = new Response(child_process.stdout);
	const stderr_response = new Response(child_process.stderr);
	const [exit_code, stdout, stderr] = await Promise.all([
		child_process.exited,
		stdout_response.text(),
		stderr_response.text(),
	]);
	return { exit_code, stdout, stderr };
}

describe("dynamic asset sync CLI", () => {
	test("skips successfully when Reepolee is not configured", async () => {
		const result = await run_without_reepolee_url();

		expect(result.exit_code).toBe(0);
		expect(result.stdout).toContain(
			"Dynamic asset synchronization skipped: REEPOLEE_API_URL is not set.",
		);
		expect(result.stderr).toBe("");
	});

	test("rejects unknown arguments even when Reepolee is not configured", async () => {
		const result = await run_without_reepolee_url(["--unknown"]);

		expect(result.exit_code).not.toBe(0);
		expect(result.stderr).toContain(
			'Unknown dynamic asset sync argument: "--unknown"',
		);
	});
});
