/**
 * scripts/prepare_images.ts
 *
 * Build-time responsive-image generator for Reeweb projects.
 *
 * Port of the old SvelteKit `prepareImages.js` (which used `sharp`) onto the
 * Reeweb/Reepolee stack using **`Bun.Image`** - Bun's built-in, native image
 * pipeline. No external dependency at all: no `sharp`, no `vips`/libvips, no
 * `fast-glob`, no `fs-extra`.
 *
 * What it does
 * ------------
 * Reads original images from a source folder (committed to git) and emits, for
 * every image, a full-size recode plus a set of width-resized variants in
 * **WebP** (primary) and **JPEG** (fallback). Output lands in the served tree so
 * the dev server and the static build pick it up with zero extra plumbing. The
 * generated folder is meant to be git-ignored - only originals are committed.
 *
 *   in:  assets/images/hero-2.png
 *   out: src/public/images/responsive/hero-2.png        (full-size, JPEG bytes)
 *        src/public/images/responsive/hero-2.webp
 *        src/public/images/responsive/300/hero-2.png     (300px wide, JPEG bytes)
 *        src/public/images/responsive/300/hero-2.webp
 *        …500/ …800/ …1440/
 *
 * On AVIF: `Bun.Image` uses the OS-native codec (`backend: system`), which has
 * no AV1 encoder on many machines (e.g. Intel macOS, most Linux CI), so AVIF is
 * intentionally NOT generated here. The `<responsive-image>` component keeps its AVIF
 * `<source>` commented out to match - re-enable both together if you adopt an
 * AVIF-capable pipeline. WebP already covers ~97% of browsers; JPEG is the
 * universal fallback.
 *
 * The URL layout matches the `webp()/jpeg()` helpers in
 * `lib/images.ts` and the `<responsive-image>` component, so templates
 * need no changes.
 *
 * Note on the ".png holds JPEG bytes" behaviour: the original script wrote the
 * JPEG-format fallback into a file that kept the source extension (so a `.png`
 * source yields a `.png` file containing JPEG data). That's reproduced here on
 * purpose, because the `<img src>` fallback relies on it. WebP sources use a
 * `.jpg` fallback so the WebP and JPEG outputs have distinct paths. Switch
 * `KEEP_SOURCE_EXT_FOR_JPEG` to false for a clean port.
 *
 * Usage
 * -----
 *   bun scripts/prepare_images.ts
 *   bun scripts/prepare_images.ts --in ./assets/images --out ./src/public/images/responsive
 *   bun scripts/prepare_images.ts --widths 300,500,800,1440 --quality 80
 *   bun scripts/prepare_images.ts --quality-webp 75 --quality-jpeg 82
 *   bun scripts/prepare_images.ts --force          # rebuild even if outputs exist
 *   bun scripts/prepare_images.ts --help
 */

import { existsSync, mkdirSync, statSync } from "fs";
import { dirname, extname, join, resolve } from "path";
import { Glob } from "bun";

import { responsive_quality, responsive_widths, screenshot_quality } from "$config/responsive_images";

// ---------------------------------------------------------------------------
// Bun.Image typing (not yet in the installed @types/bun)
// ---------------------------------------------------------------------------

type BunImageInstance = {
	resize(width: number): BunImageInstance;
	jpeg(opts?: { quality?: number; }): BunImageInstance;
	webp(opts?: { quality?: number; lossless?: boolean; }): BunImageInstance;
	bytes(): Promise<Uint8Array>;
	metadata(): Promise<{ width: number; height: number; format: string; }>;
};
type BunImageCtor = new (data: ArrayBuffer | Uint8Array) => BunImageInstance;

const BunImage: BunImageCtor = (() => {
	const ctor = (Bun as unknown as { Image?: BunImageCtor; }).Image;
	if (typeof ctor !== "function") {
		console.error("✗ Bun.Image is not available - upgrade Bun (needs a recent version).");
		process.exit(1);
	}
	return ctor;
})();

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_IN = "./assets/images";
const DEFAULT_OUT = "./src/public/images/responsive";
const DEFAULT_CONCURRENCY = Math.max(2, Math.min(8, navigator.hardwareConcurrency || 4));

// Widths and per-format quality come from config/responsive_images.ts (the single source of
// truth shared with the <responsive-image> srcset). CLI flags override them.
const DEFAULT_WIDTHS = [...responsive_widths];
const DEFAULT_QUALITY_WEBP = responsive_quality.webp;
const DEFAULT_QUALITY_JPEG = responsive_quality.jpeg;

/** Reproduce the legacy behaviour where the JPEG fallback keeps the source
 *  extension (so `foo.png` → a `.png` file containing JPEG bytes). */
const KEEP_SOURCE_EXT_FOR_JPEG = true;

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

type Quality = {
	webp: number;
	jpeg: number;
	lossless_webp?: boolean;
	// Set when a CLI flag pinned the value, so the PNG routing stands aside.
	webp_overridden?: boolean;
	jpeg_overridden?: boolean;
};

type Options = {
	in_dir: string;
	out_dir: string;
	widths: number[];
	quality: Quality;
	concurrency: number;
	force: boolean;
};

function parse_args(): Options {
	const args = process.argv.slice(2);
	let in_dir = DEFAULT_IN;
	let out_dir = DEFAULT_OUT;
	let widths = DEFAULT_WIDTHS;
	const quality: Quality = { webp: DEFAULT_QUALITY_WEBP, jpeg: DEFAULT_QUALITY_JPEG };
	let concurrency = DEFAULT_CONCURRENCY;
	let force = false;

	const to_q = (v: string | undefined, fallback: number) => {
		const n = parseInt(v ?? "", 10);
		return Number.isFinite(n) && n > 0 && n <= 100 ? n : fallback;
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--help" || arg === "-h") {
			print_help();
			process.exit(0);
		} else if (arg === "--in") {
			in_dir = args[++i] ?? in_dir;
		} else if (arg === "--out") {
			out_dir = args[++i] ?? out_dir;
		} else if (arg === "--widths") {
			widths = (args[++i] ?? "").split(",").map((w) => parseInt(w.trim(), 10)).filter((w) => Number.isFinite(
				w
			) && w > 0);
		} else if (arg === "--quality" || arg === "-q") {
			const q = to_q(args[++i], NaN);
			if (Number.isFinite(q)) {
				quality.webp = quality.jpeg = q;
				quality.webp_overridden = quality.jpeg_overridden = true;
			}
		} else if (arg === "--quality-webp") {
			quality.webp = to_q(args[++i], quality.webp);
			quality.webp_overridden = true;
		} else if (arg === "--quality-jpeg") {
			quality.jpeg = to_q(args[++i], quality.jpeg);
			quality.jpeg_overridden = true;
		} else if (arg === "--concurrency" || arg === "-c") {
			concurrency = Math.max(1, parseInt(args[++i] ?? String(concurrency), 10));
		} else if (arg === "--force" || arg === "-f") {
			force = true;
		} else {
			console.error(`✗ Unknown argument: ${arg}`);
			print_help();
			process.exit(1);
		}
	}

	return {
		in_dir: resolve(in_dir),
		out_dir: resolve(out_dir),
		widths,
		quality,
		concurrency,
		force,
	};
}

function print_help(): void {
	console.error("Prepare responsive images (Bun.Image) for a Reeweb project.\n");
	console.error("Usage: bun scripts/prepare_images.ts [options]\n");
	console.error("  --in <dir>         Source originals dir   (default: ./assets/images)");
	console.error(
		"  --out <dir>        Output dir             (default: ./src/public/images/responsive)"
	);
	console.error("  --widths <list>    Comma-separated widths (default: 300,500,800,1440)");
	console.error(`  --quality, -q <n>  Set both formats' quality 1-100`);
	console.error(`  --quality-webp <n> WebP quality          (default: ${DEFAULT_QUALITY_WEBP})`);
	console.error(`  --quality-jpeg <n> JPEG quality          (default: ${DEFAULT_QUALITY_JPEG})`);
	console.error("  --concurrency, -c  Parallel source images (default: CPU-based)");
	console.error("  --force, -f        Re-encode even if outputs already exist");
	console.error("  --help, -h         Show this help");
}

// ---------------------------------------------------------------------------
// Per-image work
// ---------------------------------------------------------------------------

type SourceImage = {
	full_path: string; // absolute path to the original
	rel_path: string; // path relative to in_dir, e.g. "people/ales.jpg"
	name: string; // "ales"
	ext: string; // ".jpg" / ".png" / ".webp" (original extension, lower-cased)
};

type Outputs = { dir: string; webp: string; jpeg: string; };

/**
 * PNG sources are screenshots: sharp text and flat colour, which lossy WebP
 * softens, so they encode as lossless WebP with a higher-quality JPEG twin.
 * Photographic and WebP sources keep the configured lossy settings.
 * An explicit --quality* flag overrides the routing for every source.
 */
export function quality_for(source_ext: string, base: Quality): Quality {
	if (source_ext !== ".png") return base;
	const jpeg = base.jpeg_overridden ? base.jpeg : screenshot_quality.jpeg;
	return { webp: base.webp, jpeg, lossless_webp: !base.webp_overridden };
}

export function jpeg_output_name(name: string, source_ext: string): string {
	// Legacy quirk: JPEG fallback keeps the source extension.
	if (source_ext === ".webp") return `${name}.jpg`;
	return KEEP_SOURCE_EXT_FOR_JPEG ? `${name}${source_ext}` : `${name}.jpg`;
}

function outputs_for(out_base: string, rel_dir: string, name: string, source_ext: string): Outputs {
	const dir = join(out_base, rel_dir);
	return {
		dir,
		webp: join(dir, `${name}.webp`),
		jpeg: join(dir, jpeg_output_name(name, source_ext)),
	};
}

/**
 * Encode one variant set (WebP + JPEG) from the source bytes. `resize_to` is the
 * target width in px, or null for a full-size recode. JPEG bytes are written to
 * the JPEG path regardless of its extension (preserving the `.png`-holds-JPEG
 * quirk via the explicit `.jpeg()` encoder).
 */
async function encode_variant(buf: ArrayBuffer, resize_to: number | null, out: Outputs, q: Quality): Promise<void> {
	mkdirSync(out.dir, { recursive: true });
	const make = () => (resize_to ? new BunImage(buf).resize(resize_to) : new BunImage(buf));
	const webp_opts = q.lossless_webp ? { lossless: true } : { quality: q.webp };
	const [webp_bytes, jpeg_bytes] = await Promise.all([
		make().webp(webp_opts).bytes(),
		make().jpeg({ quality: q.jpeg }).bytes(),
	]);
	await Promise.all([Bun.write(out.webp, webp_bytes), Bun.write(out.jpeg, jpeg_bytes)]);
}

async function process_image(img: SourceImage, opts: Options): Promise<number> {
	const src_mtime = statSync(img.full_path).mtimeMs;
	const rel_dir = dirname(img.rel_path) === "." ? "" : dirname(img.rel_path);

	// Each target = a variant set: the full-size recode (width null) + each width.
	const targets: { out: Outputs; width: number | null; }[] = [
		{ out: outputs_for(opts.out_dir, rel_dir, img.name, img.ext), width: null },
		...opts.widths.map((w) => ({
			out: outputs_for(join(opts.out_dir, String(w)), rel_dir, img.name, img.ext),
			width: w,
		})),
	];

	// Skip up-to-date targets first (mtime check) - avoids reading the file at all
	// on a warm run, keeping `bun dev` startup near-instant.
	const todo = opts.force ? targets : targets.filter((t) => !up_to_date(t.out, src_mtime));
	if (todo.length === 0) return 0;

	const buf = await Bun.file(img.full_path).arrayBuffer();
	const orig_width = (await new BunImage(buf).metadata()).width;
	const quality = quality_for(img.ext, opts.quality);

	for (const t of todo) {
		// Never upscale: clamp the target width to the original's width.
		const resize_to = t.width !== null && t.width < orig_width ? t.width : null;
		await encode_variant(buf, resize_to, t.out, quality);
	}
	return todo.length;
}

/**
 * A variant set is up to date when both outputs exist AND neither is older than
 * the source original. This gives partial regeneration: editing or adding one
 * original rebuilds only that image; unchanged originals are skipped.
 */
function up_to_date(out: Outputs, src_mtime: number): boolean {
	for (const p of [out.webp, out.jpeg]) {
		if (!existsSync(p)) return false;
		if (statSync(p).mtimeMs < src_mtime) return false;
	}
	return true;
}

// ---------------------------------------------------------------------------
// Concurrency pool
// ---------------------------------------------------------------------------

async function map_pool(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const idx = next++;
			await fn(items[idx]);
		}
	});
	await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const opts = parse_args();
	const started = Date.now();

	console.log("🖼️ Preparing responsive images (Bun.Image)");
	console.log(`    Source:  ${opts.in_dir}`);
	console.log(`    Output:  ${opts.out_dir}`);
	console.log(
		`    Widths:  ${opts.widths.join(", ")}  •  Quality: webp ${opts.quality.webp}/jpeg ${opts.quality.jpeg}  •  Concurrency: ${opts.concurrency}`
	);

	if (!existsSync(opts.in_dir)) {
		console.error(`✗ Source directory does not exist: ${opts.in_dir}`);
		process.exit(1);
	}

	// Discover originals.
	const glob = new Glob("**/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG,WEBP}");
	const images: SourceImage[] = [];
	for await (const rel of glob.scan({ cwd: opts.in_dir, onlyFiles: true })) {
		const ext = extname(rel).toLowerCase();
		const base = rel.split(/[\\/]/).pop() ?? rel; // filename with extension
		const name = base.slice(0, base.length - extname(base).length);
		images.push({ full_path: join(opts.in_dir, rel), rel_path: rel, name, ext });
	}

	if (images.length === 0) {
		console.warn("⚠  No .jpg/.png source images found - nothing to do.");
		return;
	}
	console.log(`    Found ${images.length} original image(s)\n`);

	let total_encoded = 0;
	let processed = 0;
	await map_pool(images, opts.concurrency, async (img) => {
		try {
			const n = await process_image(img, opts);
			total_encoded += n;
			processed++;
			const tag = n === 0 ? "· (cached)" : `✓ ${n} variant set(s)`;
			console.log(`    [${processed}/${images.length}] ${img.rel_path}  ${tag}`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`    ✗ ${img.rel_path}: ${msg}`);
			process.exitCode = 1;
		}
	});

	const secs = ((Date.now() - started) / 1000).toFixed(1);
	console.log("");
	console.log("─".repeat(50));
	console.log(
		`✅ Done in ${secs}s - ${total_encoded} variant set(s) encoded across ${images.length} image(s)`
	);
	console.log(`  (${opts.force ? "forced full rebuild" : "skipped up-to-date outputs"})`);
}

if (import.meta.main) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
