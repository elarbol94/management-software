CREATE TABLE `evidence_links` (
	`id` text PRIMARY KEY NOT NULL,
	`annotation_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`annotation_id`) REFERENCES `wiki_pdf_annotations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_links_unique` ON `evidence_links` (`annotation_id`,`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `evidence_links_target_idx` ON `evidence_links` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `wiki_pdf_annotations` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`document_id` text NOT NULL,
	`page_number` integer NOT NULL,
	`kind` text NOT NULL,
	`selected_text` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`color` text DEFAULT 'yellow' NOT NULL,
	`geometry_json` text DEFAULT '[]' NOT NULL,
	`preview_stored_name` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`source_id`) REFERENCES `wiki_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `wiki_pdf_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `wiki_pdf_annotations_document_idx` ON `wiki_pdf_annotations` (`document_id`,`page_number`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `wiki_pdf_annotations_source_idx` ON `wiki_pdf_annotations` (`source_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `wiki_pdf_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`attachment_id` text NOT NULL,
	`role` text DEFAULT 'primary' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`page_count` integer DEFAULT 0 NOT NULL,
	`progress_page` integer DEFAULT 0 NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`locked_at` integer,
	`next_attempt_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`source_id`) REFERENCES `wiki_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wiki_pdf_documents_attachment_unique` ON `wiki_pdf_documents` (`attachment_id`);--> statement-breakpoint
CREATE INDEX `wiki_pdf_documents_source_idx` ON `wiki_pdf_documents` (`source_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `wiki_pdf_documents_queue_idx` ON `wiki_pdf_documents` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `wiki_pdf_pages` (
	`document_id` text NOT NULL,
	`page_number` integer NOT NULL,
	`width` real DEFAULT 0 NOT NULL,
	`height` real DEFAULT 0 NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`text_layer_json` text DEFAULT '[]' NOT NULL,
	`extraction_method` text DEFAULT 'empty' NOT NULL,
	`thumbnail_stored_name` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`document_id`, `page_number`),
	FOREIGN KEY (`document_id`) REFERENCES `wiki_pdf_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wiki_pdf_pages_document_idx` ON `wiki_pdf_pages` (`document_id`,`page_number`);--> statement-breakpoint
CREATE VIRTUAL TABLE `wiki_pdf_pages_fts` USING fts5(
	`document_id` UNINDEXED,
	`page_number` UNINDEXED,
	`source_id` UNINDEXED,
	`text`,
	tokenize = 'unicode61 remove_diacritics 2'
);

--> statement-breakpoint
CREATE UNIQUE INDEX `attachments_wiki_source_pdf_sha_unique` ON `attachments` (`sha256`) WHERE `mime_type` = 'application/pdf' AND `entity_type` = 'wikiSource';
