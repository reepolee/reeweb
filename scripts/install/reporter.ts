const RESET = "\u001b[0m";
const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const GREEN = "\u001b[32m";
const RED = "\u001b[31m";
const LABEL_WIDTH = 18;

let is_verbose = false;

export function set_verbose(value: boolean): void { is_verbose = value; }
export function get_verbose(): boolean { return is_verbose; }
export function child_stdio(): "inherit" | "pipe" { return is_verbose ? "inherit" : "pipe"; }

function write(text: string): void { process.stdout.write(text); }
function pad_label(label: string, has_detail: boolean): string { return has_detail ? label.padEnd(LABEL_WIDTH) : label; }

export function heading(title: string): void { process.stdout.write(`\n${BOLD}${title}${RESET}\n`); }
export function section(title: string): void { write(`\n  ${DIM}${title}${RESET}\n`); }

export function step_start(label: string): void {
	write(`  ${DIM}pulling ${label}...${RESET}\n`);
}

export function step_done(label: string, detail?: string): void {
	const suffix = detail ? ` ${DIM}${detail}${RESET}` : "";
	const line = `  ${GREEN}+${RESET} ${pad_label(label, Boolean(detail))}${suffix}`;
	if (is_verbose) { write(`${line}\n`); return; }
	write(`${line}\n`);
}

export function step_fail(label: string, output?: string): void {
	const line = `  ${RED}x${RESET} ${pad_label(label, true)}${RED}failed${RESET}`;
	if (is_verbose) { write(`${line}\n`); return; }
	write(`${line}\n`);
	for (const out_line of (output ?? "").trim().split("\n")) {
		if (out_line) write(`      ${DIM}${out_line}${RESET}\n`);
	}
}

export function note(text: string): void { write(`  ${DIM}${text}${RESET}\n`); }
export function success(text: string): void {
	write(`\n${GREEN}${text}${RESET}\n`);
}
