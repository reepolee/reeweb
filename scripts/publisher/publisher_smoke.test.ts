import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

const test_port = 28_901;
const preview_port = 28_902;
const dev_port = 28_900;
let publisher_process: Bun.Subprocess;

async function wait_for_publisher(): Promise<void> {
	const health_url = `http://127.0.0.1:${test_port}/api/health`;
	for (let attempt = 0; attempt < 30; attempt++) {
		try {
			const response = await fetch(health_url);
			if (response.ok) return;
		} catch {}
		await Bun.sleep(100);
	}
	throw new Error("Publisher did not start");
}

beforeAll(async () => {
	const publisher_path = join(import.meta.dir, "..", "publisher.ts");
	publisher_process = Bun.spawn(["bun", publisher_path], {
		cwd: join(import.meta.dir, "..", ".."),
		env: {
			...Bun.env,
			TEST_PORT: String(test_port),
			PORT: String(dev_port),
			PUBLISHER_PORT: String(test_port),
			PUBLISHER_PREVIEW_PORT: String(preview_port),
			PUBLISHER_BRANCH: "__publisher_smoke_test__",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	await wait_for_publisher();
});

afterAll(async () => {
	publisher_process.kill();
	await publisher_process.exited;
});

describe("Publisher HTTP service", () => {
	test("reports health and accepts render signals while release rendering is paused", async () => {
		const health_response = await fetch(`http://127.0.0.1:${test_port}/api/health`);
		const health = await health_response.json();
		const signal_response = await fetch(
			`http://127.0.0.1:${test_port}/api/render-signal`,
			{ method: "POST" },
		);

		expect(health.ok).toBe(true);
		expect(signal_response.status).toBe(202);
	});

	test("serves the LAN dashboard", async () => {
		const response = await fetch(`http://127.0.0.1:${test_port}/`);
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain("Ree-web Publisher");
	});
});
