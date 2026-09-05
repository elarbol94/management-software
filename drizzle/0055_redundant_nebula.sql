CREATE TABLE `wiki_presentation_access` (
	`presentation_id` text PRIMARY KEY NOT NULL,
	`restricted` integer DEFAULT false NOT NULL,
	`coediting` integer DEFAULT false NOT NULL,
	`public_token_hash` text,
	FOREIGN KEY (`presentation_id`) REFERENCES `wiki_presentations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wiki_presentation_access_public_token_hash_unique` ON `wiki_presentation_access` (`public_token_hash`);--> statement-breakpoint
CREATE TABLE `wiki_presentation_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`presentation_id` text NOT NULL,
	`element_id` text,
	`body` text NOT NULL,
	`author_id` text NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`presentation_id`) REFERENCES `wiki_presentations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `wiki_presentation_comments_idx` ON `wiki_presentation_comments` (`presentation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `wiki_presentation_library` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`document_json` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `wiki_presentation_members` (
	`id` text PRIMARY KEY NOT NULL,
	`presentation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	FOREIGN KEY (`presentation_id`) REFERENCES `wiki_presentations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wiki_presentation_member_idx` ON `wiki_presentation_members` (`presentation_id`,`user_id`);