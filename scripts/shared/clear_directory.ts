import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export function clear_directory(directory: string): void {
	if (!existsSync(directory)) {
		mkdirSync(directory, { recursive: true });
		return;
	}

	const entries = readdirSync(directory);
	for (const entry of entries) {
		const entry_path = join(directory, entry);
		rmSync(entry_path, { recursive: true, force: true });
	}
}
