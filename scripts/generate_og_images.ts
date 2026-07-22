#!/usr/bin/env bun

/**
 * Generate one 1200x630 Open Graph image for every rendered HTML page.
 *
 * The card is first written as SVG, then the globally installed `vips` binary
 * rasterizes it to PNG. No package dependency is required.
 *
 * Usage:
 *   bun scripts/generate_og_images.ts --dist ./dist --site-url https://example.com
 */

import { existsSync, mkdirSync, rmSync } from "fs";
import { dirname, join, relative, resolve, sep } from "path";

import { og_images } from "$config/og_images";

type Options = {
	dist_dir: string;
	site_url: string;
};

type Page = {
	html_path: string;
	route_path: string;
	image_path: string;
	title: string;
	code: string;
	logo_data_url: string;
	background_data_url: string | null;
};

function print_usage(): void {
	console.error("Usage: bun scripts/generate_og_images.ts [options]");
	console.error("");
	console.error("Options:");
	console.error("  --dist <dir>        Rendered site directory (default: ./dist)");
	console.error("  --site-url <url>    Public origin, or set SITE_URL in .env");
	console.error("  --help              Print this usage");
}

function parse_args(): Options {
	const args = process.argv.slice(2);
	let dist_dir = "./dist";
	let site_url = process.env.SITE_URL ?? "";

	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--help") {
			print_usage();
			process.exit(0);
		}
		if (arg === "--dist") {
			dist_dir = args[++index] ?? "";
			continue;
		}
		if (arg === "--site-url") {
			site_url = args[++index] ?? "";
			continue;
		}
		console.error(`✗ Unknown argument: ${arg}`);
		print_usage();
		process.exit(1);
	}

	if (!site_url) {
		console.error("✗ --site-url is required, or set SITE_URL in .env");
		process.exit(1);
	}

	return { dist_dir: resolve(dist_dir), site_url: site_url.replace(/\/+$/, "") };
}

function decode_html(value: string): string {
	return value
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&#x27;/gi, "'");
}

function xml_escape(value: string): string {
	const ampersand_escaped = value.replace(/&/g, "&amp;");
	const less_than_escaped = ampersand_escaped.replace(/</g, "&lt;");
	const greater_than_escaped = less_than_escaped.replace(/>/g, "&gt;");
	const quote_escaped = greater_than_escaped.replace(/"/g, "&quot;");
	return quote_escaped.replace(/'/g, "&apos;");
}

function html_to_text(value: string): string {
	const without_tags = value.replace(/<[^>]+>/g, " ");
	const decoded = decode_html(without_tags);
	return decoded.replace(/\s+/g, " ").trim();
}

function read_title(html: string, html_path: string): string {
	const title_match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	if (!title_match?.[1]) {
		throw new Error(`Missing <title> in ${html_path}`);
	}
	return html_to_text(title_match[1]);
}

function read_code(html: string): string {
	const code_match = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
	if (!code_match?.[1]) return "reeweb";
	const text = html_to_text(code_match[1]);
	return text.slice(0, 90) || "reeweb";
}

function image_mime_type(image_path: string): string | null {
	const extension = image_path.split(".").pop()?.toLowerCase();
	if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
	if (extension === "png") return "image/png";
	if (extension === "webp") return "image/webp";
	return null;
}

function bytes_to_base64(bytes: Uint8Array): string {
	const chunk_size = 32_768;
	let binary = "";
	for (let start_index = 0; start_index < bytes.length; start_index += chunk_size) {
		const chunk = bytes.subarray(start_index, start_index + chunk_size);
		binary += String.fromCharCode(...chunk);
	}
	return btoa(binary);
}

async function read_background_image(html: string, dist_dir: string): Promise<string | null> {
	const image_tags = html.match(/<img\b[^>]*>/gi) || [];
	for (const image_tag of image_tags) {
		const source_match = image_tag.match(/\ssrc=["']([^"']+)["']/i);
		const source = source_match?.[1] || "";
		const image_path = source.split(/[?#]/)[0] || "";
		const mime_type = image_mime_type(image_path);
		if (!mime_type || !image_path.startsWith("/images/")) continue;

		const local_path = resolve(dist_dir, "." + decodeURIComponent(image_path));
		const relative_path = relative(dist_dir, local_path);
		if (relative_path.startsWith("..") || !existsSync(local_path)) continue;

		const image_file = Bun.file(local_path);
		const image_bytes = new Uint8Array(await image_file.arrayBuffer());
		return `data:${mime_type};base64,${bytes_to_base64(image_bytes)}`;
	}
	return null;
}

function route_from_html_path(dist_dir: string, html_path: string): string {
	const output_rel = relative(dist_dir, html_path);
	const normalized_rel = output_rel.split(sep).join("/");
	if (normalized_rel === "index.html") return "/";
	const route_dir = normalized_rel.replace(/\/index\.html$/, "");
	return route_dir ? `/${route_dir}/` : "/";
}

function image_path_for_route(route_path: string): string {
	const route_slug = route_path === "/" ? "index" : route_path.replace(/^\/+|\/+$/g, "");
	return `/images/og/${route_slug}.png`;
}

function wrap_text(value: string, maximum_characters: number, maximum_lines: number): string[] {
	const words = value.split(/\s+/);
	const lines: string[] = [];
	let line = "";

	for (const word of words) {
		const candidate = line ? `${line} ${word}` : word;
		if (candidate.length <= maximum_characters || !line) {
			line = candidate;
			continue;
		}
		lines.push(line);
		line = word;
		if (lines.length === maximum_lines) break;
	}

	if (line && lines.length < maximum_lines) lines.push(line);
	const has_more_words = words.join(" ").length > lines.join(" ").length;
	if (has_more_words && lines.length > 0) {
		const last_index = lines.length - 1;
		const last_line = lines[last_index];
		if (last_line) lines[last_index] = `${last_line.slice(0, maximum_characters - 1)}...`;
	}
	return lines;
}

function text_elements(lines: string[], x: number, y: number, line_height: number): string {
	return lines.map((line, index) => {
		const line_y = y + index * line_height;
		return `<text x="${x}" y="${line_y}">${xml_escape(line)}</text>`;
	}).join("\n");
}

function truncate_text(value: string, maximum_characters: number): string {
	if (value.length <= maximum_characters) return value;
	return `${value.slice(0, maximum_characters - 3)}...`;
}

function make_svg(page: Page): string {
	const has_background_image = page.background_data_url !== null;
	const title_maximum_characters = has_background_image ? 28 : (og_images.show_code ? 19 : 34);
	const title_lines = wrap_text(page.title, title_maximum_characters, 4);
	const code_lines = wrap_text(page.code, 26, 4);
	const title_text = text_elements(title_lines, 76, 250, 60);
	const code_text = text_elements(code_lines, 720, 280, 34);
	const route_text = xml_escape(page.route_path);
	const code_route_text = xml_escape(truncate_text(page.route_path, 24));
	const code_panel = og_images.show_code && !has_background_image
		? `<rect x="674" y="160" width="450" height="306" rx="24" fill="#111827" stroke="${og_images.brand_color}" stroke-width="2"/>
	<circle cx="716" cy="204" r="8" fill="${og_images.brand_color}"/>
	<circle cx="744" cy="204" r="8" fill="${og_images.brand_color}" opacity="0.7"/>
	<circle cx="772" cy="204" r="8" fill="${og_images.brand_color}" opacity="0.4"/>
	<text class="comment" x="720" y="252">// ${code_route_text}</text>
	<g class="code">${code_text}</g>`
		: "";
	const background_image = has_background_image
		? `<image href="${page.background_data_url}" width="1200" height="630" preserveAspectRatio="xMidYMid slice"/>
	<rect width="1200" height="630" fill="${og_images.background_color}" opacity="0.62"/>
	<rect width="1200" height="630" fill="url(#background-shade)"/>`
		: "";

	return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
	<defs>
		<linearGradient id="background-shade" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="${og_images.background_color}" stop-opacity="0.36"/>
			<stop offset="1" stop-color="${og_images.brand_color}" stop-opacity="0.22"/>
		</linearGradient>
		<filter id="desaturate">
			<feColorMatrix type="saturate" values="0"/>
		</filter>
	</defs>
	<style>
		.label { fill: ${og_images.brand_color}; font: 700 18px Arial, sans-serif; letter-spacing: 3px; }
		.title { fill: ${og_images.logo_color}; font: 700 54px Arial, sans-serif; }
		.route { fill: #94a3b8; font: 400 22px Arial, sans-serif; }
		.code { fill: #cbd5e1; font: 400 24px monospace; }
		.comment { fill: #64748b; font: 400 20px monospace; }
	</style>
	<rect width="1200" height="630" fill="${og_images.background_color}"/>
	${background_image}
	<image href="${page.logo_data_url}" x="600" y="365" width="700" height="186" opacity="0.14" filter="url(#desaturate)"/>
	<image href="${page.logo_data_url}" x="76" y="52" width="250" height="67"/>
	<text class="label" x="76" y="152">${xml_escape(og_images.label)}</text>
	<g class="title">${title_text}</g>
	<text class="route" x="76" y="548">${route_text}</text>
	${code_panel}
</svg>`;
}

async function run_vips(svg_path: string, png_path: string): Promise<void> {
	const vips_process = Bun.spawn(["vips", "copy", svg_path, png_path], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const exit_code = await vips_process.exited;
	if (exit_code === 0) return;
	const error_output = await new Response(vips_process.stderr).text();
	throw new Error(`vips failed for ${svg_path}: ${error_output.trim()}`);
}

function inject_og_tags(html: string, page: Page, site_url: string): string {
	const image_url = `${site_url}${page.image_path}`;
	const marker_pattern = /\n?\s*<!-- reeweb:og:start -->[\s\S]*?<!-- reeweb:og:end -->/g;
	const without_existing_tags = html.replace(marker_pattern, "");
	const tags = `\n\t\t<!-- reeweb:og:start -->\n\t\t<meta property="og:type" content="website" />\n\t\t<meta property="og:title" content="${xml_escape(page.title)}" />\n\t\t<meta property="og:url" content="${xml_escape(`${site_url}${page.route_path}`)}" />\n\t\t<meta property="og:image" content="${xml_escape(image_url)}" />\n\t\t<meta property="og:image:width" content="1200" />\n\t\t<meta property="og:image:height" content="630" />\n\t\t<meta name="twitter:card" content="summary_large_image" />\n\t\t<!-- reeweb:og:end -->`;
	if (!without_existing_tags.includes("</head>")) {
		throw new Error(`Missing </head> in ${page.html_path}`);
	}
	return without_existing_tags.replace("</head>", `${tags}\n\t</head>`);
}

async function collect_pages(dist_dir: string): Promise<Page[]> {
	const logo_path = join(dist_dir, og_images.logo_path);
	if (!existsSync(logo_path)) throw new Error(`Open Graph logo is missing: ${logo_path}`);
	const logo_svg = await Bun.file(logo_path).text();
	const colored_logo_svg = logo_svg.replace(/currentColor/g, og_images.logo_color);
	const logo_data_url = `data:image/svg+xml;base64,${btoa(colored_logo_svg)}`;
	const html_glob = new Bun.Glob("**/index.html");
	const pages: Page[] = [];
	for await (const output_rel of html_glob.scan({ cwd: dist_dir, onlyFiles: true })) {
		if (output_rel.startsWith("og/")) continue;
		const html_path = join(dist_dir, output_rel);
		const html = await Bun.file(html_path).text();
		const route_path = route_from_html_path(dist_dir, html_path);
		const background_data_url = await read_background_image(html, dist_dir);
		pages.push({
			html_path,
			route_path,
			image_path: image_path_for_route(route_path),
			title: read_title(html, html_path),
			code: read_code(html),
			logo_data_url,
			background_data_url,
		});
	}
	return pages;
}

async function main(): Promise<void> {
	const options = parse_args();
	if (!existsSync(options.dist_dir)) {
		throw new Error(`Dist directory does not exist: ${options.dist_dir} - run bun ssg first`);
	}

	const pages = await collect_pages(options.dist_dir);
	if (pages.length === 0) throw new Error(`No rendered pages found in ${options.dist_dir}`);

	console.log(`🖼️ Generating ${pages.length} Open Graph image(s)...`);
	for (const page of pages) {
		const png_path = join(options.dist_dir, page.image_path);
		const svg_path = png_path.replace(/\.png$/, ".svg");
		mkdirSync(dirname(png_path), { recursive: true });
		const svg = make_svg(page);
		await Bun.write(svg_path, svg);
		try {
			await run_vips(svg_path, png_path);
		} finally {
			if (existsSync(svg_path)) rmSync(svg_path);
		}
		const html = await Bun.file(page.html_path).text();
		const html_with_tags = inject_og_tags(html, page, options.site_url);
		await Bun.write(page.html_path, html_with_tags);
		console.log(`    ✓ ${page.route_path} -> ${page.image_path}`);
	}
	console.log(`✅ Open Graph images written to ${join(options.dist_dir, "images", "og")}`);
}

await main();
