CREATE TABLE `wiki_figure_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`source_id` text,
	`relative_path` text DEFAULT '' NOT NULL,
	`attachment_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`literature_source_id` text,
	`sidecar_hash` text DEFAULT '' NOT NULL,
	`last_checked_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `wiki_pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `wiki_figure_sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`literature_source_id`) REFERENCES `wiki_sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wiki_figure_assets_source_path_unique` ON `wiki_figure_assets` (`source_id`,`relative_path`);--> statement-breakpoint
CREATE INDEX `wiki_figure_assets_page_idx` ON `wiki_figure_assets` (`page_id`);--> statement-breakpoint
CREATE TABLE `wiki_figure_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`version` integer NOT NULL,
	`attachment_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `wiki_figure_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wiki_figure_revisions_version_unique` ON `wiki_figure_revisions` (`asset_id`,`version`);--> statement-breakpoint
CREATE TABLE `wiki_figure_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`root_key` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `wiki_pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `wiki_figure_sources_page_idx` ON `wiki_figure_sources` (`page_id`);