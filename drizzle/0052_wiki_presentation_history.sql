CREATE TABLE `wiki_presentation_edit_leases` (
	`presentation_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`heartbeat_at` integer NOT NULL,
	FOREIGN KEY (`presentation_id`) REFERENCES `wiki_presentations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wiki_presentation_edit_leases_heartbeat_idx` ON `wiki_presentation_edit_leases` (`heartbeat_at`);--> statement-breakpoint
CREATE TABLE `wiki_presentation_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`presentation_id` text NOT NULL,
	`title` text NOT NULL,
	`elements_json` text NOT NULL,
	`path_json` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`presentation_id`) REFERENCES `wiki_presentations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `wiki_presentation_revisions_presentation_idx` ON `wiki_presentation_revisions` (`presentation_id`,`created_at`);