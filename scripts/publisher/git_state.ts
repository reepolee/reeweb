export type GitState = {
	branch: string;
	head: string;
	clean: boolean;
	error: string;
};

function run_git(project_root: string, args: string[]): { output: string; error: string; } {
	const result = Bun.spawnSync(["git", ...args], {
		cwd: project_root,
		stdout: "pipe",
		stderr: "pipe",
	});
	const decoder = new TextDecoder();
	const raw_output = decoder.decode(result.stdout);
	const raw_error = decoder.decode(result.stderr);
	return {
		output: raw_output.trim(),
		error: result.exitCode === 0 ? "" : raw_error.trim(),
	};
}

export function read_git_state(project_root: string): GitState {
	const branch_result = run_git(project_root, ["branch", "--show-current"]);
	const head_result = run_git(project_root, ["rev-parse", "HEAD"]);
	const status_result = run_git(project_root, ["status", "--porcelain"]);
	const error = branch_result.error || head_result.error || status_result.error;

	return {
		branch: branch_result.output,
		head: head_result.output,
		clean: status_result.output === "",
		error,
	};
}
