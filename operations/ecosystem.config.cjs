const path = require("node:path");
const project_root = path.resolve(__dirname, "..");

module.exports = {
	apps: [
		{
			name: "reeweb",
			script: process.env.BUN_BIN || "bun",
			args: "run preview",
			cwd: project_root,
			autorestart: true,
			watch: ["scripts", "src", "lib", "config", "package.json", "bun.lock", "wrangler.jsonc"],
			ignore_watch: [".git", "node_modules", "dist", ".agents", "assets", "vendor"],
			watch_delay: 1000,
			windowsHide: true,
		},
	],
};
