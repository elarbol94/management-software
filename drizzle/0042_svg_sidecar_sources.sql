ALTER TABLE `wiki_svg_assets` ADD `source_id` text REFERENCES `wiki_sources`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `wiki_svg_assets` ADD `caption` text;
--> statement-breakpoint
ALTER TABLE `wiki_svg_assets` ADD `sidecar_sha256` text;
