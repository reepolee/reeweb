import { process_docs_markdown } from "$lib/markdown_docs";
import type { MarkdownStyles } from "$lib/markdown_docs";
import { tw_merge } from "$lib/tw_merge";

function merge_image_classes(raw_html: string, default_classes: string): string {
	if (!default_classes) return raw_html;

	return raw_html.replace(/<img\b([^>]*)>/g, (image_html, attributes: string) => {
		const class_match = attributes.match(/\sclass=(["'])(.*?)\1/);
		if (!class_match) return `<img class="${default_classes}"${attributes}>`;

		const authored_classes = class_match[2] ?? "";
		const merged_classes = tw_merge(default_classes, authored_classes);
		const class_attribute = class_match[0];
		const merged_attribute = ` class="${merged_classes}"`;
		const merged_attributes = attributes.replace(class_attribute, merged_attribute);
		return `<img${merged_attributes}>`;
	});
}

export function process_project_markdown(raw_html: string, styles: MarkdownStyles) {
	const image_html = merge_image_classes(raw_html, styles.img);
	const styles_without_image_defaults = { ...styles, img: "" };
	return process_docs_markdown(image_html, styles_without_image_defaults);
}
