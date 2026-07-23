import { existsSync } from "node:fs";
import { join } from "node:path";

import type { PublisherConfig } from "./config";
import { diff_directories, type FileChange, restore_dist, snapshot_deployment } from "./files";
import { read_git_state, type GitState } from "./git_state";

export type PublisherStatus =
	| "starting"
	| "paused"
	| "waiting"
	| "rendering"
	| "ready"
	| "deploying"
	| "error";

export type PublisherView = {
	status: PublisherStatus;
	branch: string;
	head: string;
	clean: boolean;
	changes: FileChange[];
	error: string;
	output: string[];
	preview_running: boolean;
};

const QUIET_PERIOD_MS = 2_000;
const GIT_POLL_MS = 2_000;
const DEV_RELOAD_DEBOUNCE_MS = 300;
const MAX_OUTPUT_LINES = 200;

export class PublisherRunner {
	readonly config: PublisherConfig;
	status: PublisherStatus = "starting";
	changes: FileChange[] = [];
	error = "";
	output: string[] = [];
	git_state: GitState = { branch: "", head: "", clean: false, error: "" };
	private last_rendered_head = "";
	private render_requested = false;
	private render_timer: ReturnType<typeof setTimeout> | undefined;
	private reload_timer: ReturnType<typeof setTimeout> | undefined;
	private render_process: Bun.Subprocess | undefined;
	private preview_process: Bun.Subprocess | undefined;
	private deploy_process: Bun.Subprocess | undefined;
	private git_timer: ReturnType<typeof setInterval> | undefined;

	constructor(config: PublisherConfig) {
		this.config = config;
	}

	async start(): Promise<void> {
		await this.refresh_git_state();
		this.git_timer = setInterval(() => { void this.poll_git(); }, GIT_POLL_MS);
		this.request_render(0);
	}

	async stop(): Promise<void> {
		if (this.render_timer) clearTimeout(this.render_timer);
		if (this.reload_timer) clearTimeout(this.reload_timer);
		if (this.git_timer) clearInterval(this.git_timer);
		this.render_process?.kill();
		this.deploy_process?.kill();
		const preview_exit = this.stop_preview();
		const exits: Promise<unknown>[] = [preview_exit];
		if (this.render_process) exits.push(this.render_process.exited);
		if (this.deploy_process) exits.push(this.deploy_process.exited);
		await Promise.all(exits);
	}

	view(): PublisherView {
		return {
			status: this.status,
			branch: this.git_state.branch,
			head: this.git_state.head,
			clean: this.git_state.clean,
			changes: this.changes,
			error: this.error,
			output: this.output,
			preview_running: this.preview_process !== undefined,
		};
	}

	signal(): void {
		this.schedule_dev_reload();
		this.request_render(QUIET_PERIOD_MS);
	}

	force_render(): void {
		this.request_render(0);
	}

	async deploy(): Promise<boolean> {
		await this.refresh_git_state();
		if (this.status !== "ready" || this.changes.length === 0 || !this.release_allowed()) {
			this.error = "The current candidate is not eligible for deployment";
			return false;
		}

		this.status = "deploying";
		this.error = "";
		this.output = [];
		let process: Bun.Subprocess;
		try {
			process = Bun.spawn(["bun", "run", "cf:deploy"], {
				cwd: this.config.project_root,
				stdout: "pipe",
				stderr: "pipe",
			});
		} catch (error) {
			this.status = "error";
			this.error = error instanceof Error ? error.message : String(error);
			return false;
		}
		this.deploy_process = process;
		await this.capture_process(process);
		const exit_code = await process.exited;
		this.deploy_process = undefined;

		if (exit_code !== 0) {
			this.status = "error";
			this.error = `Cloudflare deployment failed with exit code ${exit_code}`;
			return false;
		}

		try {
			snapshot_deployment(this.config.project_root);
		} catch (error) {
			this.status = "error";
			const message = error instanceof Error ? error.message : String(error);
			this.error = `Cloudflare deployed, but .deployed could not be updated: ${message}`;
			return false;
		}
		this.changes = [];
		this.status = "ready";
		if (this.render_requested) { this.schedule_render(QUIET_PERIOD_MS); }
		return true;
	}

	private release_allowed(): boolean {
		return !this.git_state.error
			&& this.git_state.clean
			&& this.git_state.branch === this.config.publish_branch;
	}

	private request_render(delay_ms: number): void {
		this.render_requested = true;
		if (this.render_process) {
			this.render_process.kill();
			return;
		}
		if (this.deploy_process) return;
		this.schedule_render(delay_ms);
	}

	private schedule_render(delay_ms: number): void {
		if (this.render_timer) clearTimeout(this.render_timer);
		this.status = "waiting";
		this.render_timer = setTimeout(() => {
			this.render_timer = undefined;
			void this.render();
		}, delay_ms);
	}

	private async render(): Promise<void> {
		await this.refresh_git_state();
		if (!this.release_allowed()) {
			this.status = "paused";
			this.error = this.git_state.error
				|| `Release rendering requires a clean ${this.config.publish_branch} branch`;
			return;
		}

		this.render_requested = false;
		await this.stop_preview();
		this.status = "rendering";
		this.error = "";
		this.output = [];
		let process: Bun.Subprocess;
		try {
			process = Bun.spawn(["bun", "run", "ssg"], {
				cwd: this.config.project_root,
				stdout: "pipe",
				stderr: "pipe",
			});
		} catch (error) {
			restore_dist(this.config.project_root);
			this.status = "error";
			this.error = error instanceof Error ? error.message : String(error);
			return;
		}
		this.render_process = process;
		await this.capture_process(process);
		const exit_code = await process.exited;
		this.render_process = undefined;

		if (exit_code !== 0) {
			restore_dist(this.config.project_root);
			this.status = this.render_requested ? "waiting" : "error";
			this.error = this.render_requested
				? ""
				: `Static generation failed with exit code ${exit_code}`;
			if (this.render_requested) { this.schedule_render(QUIET_PERIOD_MS); }
			return;
		}

		const deployed_dir = join(this.config.project_root, ".deployed");
		const dist_dir = join(this.config.project_root, "dist");
		try {
			this.changes = await diff_directories(deployed_dir, dist_dir);
		} catch (error) {
			restore_dist(this.config.project_root);
			this.status = "error";
			this.error = error instanceof Error ? error.message : String(error);
			return;
		}
		this.last_rendered_head = this.git_state.head;
		await this.refresh_git_state();
		this.status = this.release_allowed() ? "ready" : "paused";
		if (this.status === "paused") {
			this.error = `Release rendering changed the working tree. Commit the generated source changes before publishing.`;
		}
		this.start_preview();
		if (this.render_requested) { this.schedule_render(QUIET_PERIOD_MS); }
	}

	private async capture_process(process: Bun.Subprocess): Promise<void> {
		const stdout = this.capture_stream(process.stdout);
		const stderr = this.capture_stream(process.stderr);
		await Promise.all([stdout, stderr]);
	}

	private async capture_stream(stream: ReadableStream<Uint8Array> | number | undefined): Promise<void> {
		if (!stream || typeof stream === "number") return;
		const response = new Response(stream);
		const text = await response.text();
		const lines = text.split(/\r?\n/);
		this.output.push(...lines.filter(Boolean));
		if (this.output.length > MAX_OUTPUT_LINES) {
			this.output = this.output.slice(-MAX_OUTPUT_LINES);
		}
	}

	private start_preview(): void {
		const args = [
			"wrangler",
			"dev",
			"--ip",
			"0.0.0.0",
			"--port",
			String(this.config.preview_port),
		];
		const preview_env = { ...Bun.env, REEWEB_RELEASE_PREVIEW: "true" };
		const preview_vars = join(this.config.project_root, ".dev.vars.release-preview");
		if (existsSync(preview_vars)) { args.push("--env-file", preview_vars); }

		try {
			const preview_process = Bun.spawn(args, {
				cwd: this.config.project_root,
				env: preview_env,
				stdout: "inherit",
				stderr: "inherit",
			});
			this.preview_process = preview_process;
			void preview_process.exited.then(() => {
				if (this.preview_process === preview_process) {
					this.preview_process = undefined;
				}
			});
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
		}
	}

	private async stop_preview(): Promise<void> {
		if (!this.preview_process) return;
		const preview_process = this.preview_process;
		this.preview_process = undefined;
		preview_process.kill();
		await preview_process.exited;
	}

	private schedule_dev_reload(): void {
		if (this.reload_timer) clearTimeout(this.reload_timer);
		this.reload_timer = setTimeout(() => {
			this.reload_timer = undefined;
			const reload_request = fetch(this.config.dev_reload_url, { method: "POST" });
			void reload_request.catch(() => {});
		}, DEV_RELOAD_DEBOUNCE_MS);
	}

	private async refresh_git_state(): Promise<void> {
		this.git_state = read_git_state(this.config.project_root);
	}

	private async poll_git(): Promise<void> {
		const previous_head = this.git_state.head;
		await this.refresh_git_state();
		const new_clean_commit = this.release_allowed()
			&& this.git_state.head !== previous_head
			&& this.git_state.head !== this.last_rendered_head;
		if (new_clean_commit) { this.request_render(QUIET_PERIOD_MS); }
		if (this.status === "paused" && this.release_allowed() && this.render_requested) {
			this.schedule_render(QUIET_PERIOD_MS);
		}
	}
}
