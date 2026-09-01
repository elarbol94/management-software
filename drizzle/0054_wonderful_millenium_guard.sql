CREATE TABLE `wiki_presentation_live_sessions` (
	`presentation_id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`host_user_id` text NOT NULL,
	`step_index` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`heartbeat_at` integer NOT NULL,
	FOREIGN KEY (`presentation_id`) REFERENCES `wiki_presentations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wiki_presentation_live_sessions_code_idx` ON `wiki_presentation_live_sessions` (`code`);