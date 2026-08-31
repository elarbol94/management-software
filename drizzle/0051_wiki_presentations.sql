CREATE TABLE `wiki_presentations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`elements_json` text DEFAULT '[]' NOT NULL,
	`path_json` text DEFAULT '[]' NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `wiki_presentations_updated_idx` ON `wiki_presentations` (`updated_at`);