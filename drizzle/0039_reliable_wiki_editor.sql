ALTER TABLE `wiki_pages` ADD `content_version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
UPDATE `wiki_pages` SET `content_version` = `version`;
--> statement-breakpoint
ALTER TABLE `wiki_page_revisions` ADD `content_version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `wiki_page_revisions` ADD `content_hash` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `wiki_page_revisions` ADD `label` text;
--> statement-breakpoint
UPDATE `wiki_page_revisions` SET `content_version` = `version`;
--> statement-breakpoint
CREATE TABLE `wiki_page_edit_leases` (
	`page_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`heartbeat_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `wiki_pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wiki_page_edit_leases_heartbeat_idx` ON `wiki_page_edit_leases` (`heartbeat_at`);
--> statement-breakpoint
CREATE INDEX `wiki_page_edit_leases_user_idx` ON `wiki_page_edit_leases` (`user_id`);
--> statement-breakpoint
CREATE TABLE `wiki_svg_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`attachment_id` text NOT NULL,
	`current_svg` text NOT NULL,
	`bindings_json` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `wiki_pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wiki_svg_assets_attachment_unique` ON `wiki_svg_assets` (`attachment_id`);
--> statement-breakpoint
CREATE INDEX `wiki_svg_assets_page_idx` ON `wiki_svg_assets` (`page_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `wiki_svg_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`version` integer NOT NULL,
	`svg` text NOT NULL,
	`bindings_json` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `wiki_svg_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wiki_svg_revisions_asset_version_unique` ON `wiki_svg_revisions` (`asset_id`,`version`);
--> statement-breakpoint
CREATE INDEX `wiki_svg_revisions_asset_created_idx` ON `wiki_svg_revisions` (`asset_id`,`created_at`);
