/**
 * src/lib/dev_template_engine.ts
 *
 * Dev-only subclass of the upstream TemplateEngine that stamps block-level tags
 * with data-ree="<project-root-relative-path>:<line>" as each .ree file is
 * loaded, for the inspector. Keeps upstream lib/ pristine (engine:check would
 * flag any logic change there) by doing all stamping in project code.
 *
 * Every .ree file the engine reads flows through one of:
 *   - loadTemplate / loadLocalized  (pages, layouts)
 *   - includeResolved -> include handler (components, $-alias includes)
 * so we stamp at each of those read sites, tagging the text with its resolved
 * source path before it is compiled. Because each file is stamped as its own
 * source, a component's tags carry the component's line (boundary attribution
 * is automatic).
 *
 * Never constructed by the SSG pipeline, so built output carries no stamps.
 */

import { dirname, join, relative } from "node:path";

import { file } from "bun";
import { default_language } from "$config/supported_languages";
import TemplateEngine from "$lib/template_engine";
import { resolve_include } from "$lib/template/include_resolver";
import type { CompiledFn, ResolveResult } from "$lib/template/types";

import { stamp_ree_i18n, stamp_ree_source } from "./inspector_stamp";

/**
 * Apply both dev stamps to a raw .ree source: block-level data-ree line stamps,
 * then i18n wrapper spans around {_ }/{- } lookups. Block stamping runs first so
 * its line numbers come from the original layout; the i18n pass only touches
 * {_ }/{- } tokens, which block stamping never altered.
 */
function stamp_dev_source(raw: string, file: string): string {
	const block_stamped = stamp_ree_source(raw, file);
	return stamp_ree_i18n(block_stamped, file);
}

export class DevTemplateEngine extends TemplateEngine {
	private project_root: string;

	constructor(config: ConstructorParameters<typeof TemplateEngine>[0] & { project_root: string; }) {
		super(config);
		this.project_root = config.project_root;
		// The base's includeResolved is private (compile-time only) but dispatched
		// dynamically at runtime (this.includeResolved.bind(...) in render()).
		// Rebind it to our stamping variant so component/include text is stamped
		// with its own path. Bracket access sidesteps the TS private declaration.
		(this as any).includeResolved = this.stamped_include_resolved.bind(this);
	}

	/** Absolute .ree path -> project-root-relative, forward-slashed, for the stamp. */
	private stamp_path_for(abs_path: string): string {
		const rel = relative(this.project_root, abs_path);
		return rel.split("\\").join("/");
	}

	// -- Page / layout loads ------------------------------------------------

	override async loadTemplate(name: string): Promise<string> {
		const raw = await super.loadTemplate(name);
		const abs_path = join(this.viewsDir, name + this.ext);
		return stamp_dev_source(raw, this.stamp_path_for(abs_path));
	}

	override async loadLocalized(name: string, lang: string): Promise<{ content: string; resolvedName: string; }> {
		const loaded = await super.loadLocalized(name, lang);
		const abs_path = join(this.viewsDir, loaded.resolvedName + this.ext);
		const stamped = stamp_dev_source(loaded.content, this.stamp_path_for(abs_path));
		return { content: stamped, resolvedName: loaded.resolvedName };
	}

	// -- Component / alias include loads ------------------------------------
	//
	// Reimplemented so component text is stamped with the component's own path
	// before compiling. Mirrors include_resolved_handler for the .ree-file case;
	// template-kind includes route back through render() (already stamped via the
	// loaders), and non-.ree raw files are returned untouched.

	private async stamped_include_resolved(currentName: string, includeName: string, props: Record<string, any>): Promise<string> {
		const info: ResolveResult = resolve_include(
			currentName,
			includeName,
			this.viewsDir,
			this.ext
		);

		if (info.kind === "template") { return await this.render(info.templateName, props); }

		const base_path = info.filePath;
		const exists = await file(base_path).exists();
		if (!exists) throw new Error(`Included file not found: ${base_path}`);

		if (!base_path.endsWith(this.ext)) {
			// Raw non-.ree file injected unescaped - no stamping.
			return await file(base_path).text();
		}

		// Language-variant fallback for .ree includes (e.g. components).
		let resolved_path = base_path;
		const resolve_lang = props?.lang;
		if (resolve_lang) {
			const base_name = base_path.slice(0, -this.ext.length);
			const candidates = [
				`${base_name}.${resolve_lang}${this.ext}`,
				`${base_name}.${default_language}${this.ext}`,
				base_path,
			];
			for (const candidate of candidates) {
				const candidate_exists = await file(candidate).exists();
				if (candidate_exists) {
					resolved_path = candidate;
					break;
				}
			}
		}

		const raw_text = await file(resolved_path).text();
		const stamped_text = stamp_dev_source(raw_text, this.stamp_path_for(resolved_path));
		const compiled_fn: CompiledFn = this.compile(stamped_text);

		const bound_include = this.include.bind(this);
		const rt_include = (name: string, data: Record<string, any>) => this.stamped_include_resolved(
			includeName,
			name,
			data
		);
		const escape = this.autoEscape ? this.escape.bind(this) : (s: any) => String(s ?? "");
		return await (compiled_fn as any)(props, escape, bound_include, rt_include, includeName);
	}
}
