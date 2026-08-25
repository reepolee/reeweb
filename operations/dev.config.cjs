// pm2 start operations/dev.config.cjs
// pm2 logs

module.exports = {
	apps: [
		{
			name: "dev",
			script: "bun",
			args: "development",
			watch: true,
		},
	],
};
