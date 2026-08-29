import { spawn } from "node:child_process";
import { child_stdio, get_verbose } from "./reporter";

export type step_result = { code: number; output: string; };

export function run_captured(cmd: string, args: string[]): Promise<step_result> {
	return new Promise((resolve) => {
		const child = spawn(cmd, args, { stdio: child_stdio() });
		let output = "";
		child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
		child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
		child.on("error", (err) => resolve({ code: -1, output: `${output}${err.message}` }));
		child.on("exit", (code) => resolve({ code: code ?? -1, output }));
	});
}

export function run_inherited(cmd: string, args: string[]): Promise<number> {
	return new Promise((resolve) => {
		const child = spawn(cmd, args, { stdio: "inherit" });
		child.on("error", () => resolve(-1));
		child.on("exit", (code) => resolve(code ?? -1));
	});
}

export function with_verbose_flag(args: string[]): string[] {
	return get_verbose() ? [...args, "--verbose"] : args;
}
