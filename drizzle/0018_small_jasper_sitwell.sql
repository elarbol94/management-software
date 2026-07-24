CREATE TABLE `wiki_document_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`settings_json` text NOT NULL,
	`content_json` text DEFAULT '' NOT NULL,
	`constraints_json` text DEFAULT '[]' NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `wiki_document_templates_name_idx` ON `wiki_document_templates` (`name`);--> statement-breakpoint
ALTER TABLE `wiki_page_revisions` ADD `document_mode` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `wiki_page_revisions` ADD `document_settings_json` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `wiki_page_revisions` ADD `document_template_id` text REFERENCES wiki_document_templates(id);--> statement-breakpoint
ALTER TABLE `wiki_pages` ADD `document_mode` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `wiki_pages` ADD `document_settings_json` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `wiki_pages` ADD `document_template_id` text REFERENCES wiki_document_templates(id);