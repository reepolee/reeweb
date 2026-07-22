/**
 * scripts/ssg/translation_merge.ts
 *
 * Pure helpers for navigating and combining the nested translation tree.
 * Used to layer route-specific strings on top of the global "routes" bundle
 * before rendering a template.
 */

/** Traverse a nested translation object by dot-separated path. */
export function get_nested(obj: any, path: string): any {
	if (!path || !obj) return {};

	const parts = path.split(".");
	let current = obj;

	for (const part of parts) {
		if (!current || typeof current !== "object") return {};
		current = current[part];
	}

	return current ?? {};
}

/** Deep-merge source into target (mutates target). */
export function deep_merge(target: any, source: any): any {
	for (const key of Object.keys(source ?? {})) {
		const sv = source[key];
		const tv = target[key];

		if (sv && typeof sv === "object" && !Array.isArray(sv) && tv && typeof tv === "object" && !Array.isArray(
			tv
		)) {
			deep_merge(tv, sv);
		} else {
			target[key] = sv;
		}
	}

	return target;
}

/**
 * Resolve the merged translation strings for a template: the global
 * `routes` bundle for `lang`, overlaid with the route's own namespace.
 */
export function merge_route_strings(translations: Record<string, any>, lang: string, namespace: string): Record<string, any> {
	const global_strings = translations[lang]?.routes ?? {};
	const route_strings = namespace ? get_nested(translations[lang], namespace) : {};
	return deep_merge(structuredClone(global_strings), route_strings);
}
