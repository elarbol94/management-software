CREATE TABLE `wiki_pdf_annotation_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`annotation_id` text NOT NULL,
	`body` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`annotation_id`) REFERENCES `wiki_pdf_annotations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `wiki_pdf_annotation_comments_annotation_idx` ON `wiki_pdf_annotation_comments` (`annotation_id`,`created_at`);