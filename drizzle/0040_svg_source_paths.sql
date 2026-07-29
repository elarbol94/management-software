ALTER TABLE `wiki_svg_assets` ADD `source_path` text;
--> statement-breakpoint
ALTER TABLE `wiki_svg_assets` ADD `source_sha256` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `wiki_svg_assets_page_source_unique` ON `wiki_svg_assets` (`page_id`,`source_path`);
