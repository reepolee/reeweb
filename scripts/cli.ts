import { record_global_tool, type global_tool_name } from "./install/ownership";
import { install_reettier } from "./install/reettier";
import { install_reesql } from "./install/reesql";
import { install_tailwind } from "./install/tailwind";
import { install_tsc } from "./install/tsc";
import { install_vips } from "./install/vips";

const args = process.argv.slice(2);

const command = args[0];

async function record_added_tool(tool: global_tool_name, detail: string): Promise<void> {
	if (detail === "added") await record_global_tool(tool);
}

switch (command) {
	case "reettier":
		{
			const detail = await install_reettier();
			await record_added_tool("reettier", detail);
			process.exit(0);
			break;
		}
	case "vips":
		{
			const version_arg = args.find((a) => a.startsWith("--version="));
			const version = version_arg?.split("=")[1] ?? "latest";

			const detail = await install_vips({ version, get_task: "get:vips" });
			await record_added_tool("libvips", detail);
			process.exit(0);
			break;
		}
	case "reesql":
		{
			const detail = await install_reesql();
			await record_added_tool("reesql", detail);
			process.exit(0);
			break;
		}
	case "tw":
		{
			const version_arg = args.find((a) => a.startsWith("--version="));
			const version = version_arg?.split("=")[1] ?? "latest";

			const detail = await install_tailwind({ version });
			await record_added_tool("tailwindcss", detail);
			console.log(`[tailwindcss] ${detail}`);
			process.exit(0);
			break;
		}
	case "tsc":
		{
			const version_arg = args.find((a) => a.startsWith("--version="));
			const version = version_arg?.split("=")[1] ?? "latest";

			const detail = await install_tsc({ version, get_task: `get:${command}` });
			await record_added_tool("typescript", detail);
			console.log(`[tsc] ${detail}`);
			process.exit(0);
			break;
		}
	default:
		console.log(`
Usage:
  bun scripts/cli.ts vips --version=latest
  bun scripts/cli.ts vips --version=8.15.3
  bun scripts/cli.ts reettier
  bun scripts/cli.ts reesql
  bun scripts/cli.ts tw --version=latest
  bun scripts/cli.ts tw --version=4.3.3
  bun scripts/cli.ts tsc --version=latest
  bun scripts/cli.ts tsc --version=7.0.2
		`);
}
