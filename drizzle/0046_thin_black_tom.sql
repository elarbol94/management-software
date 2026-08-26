ALTER TABLE `wiki_pages` ADD `verified_at` integer;--> statement-breakpoint
ALTER TABLE `wiki_pages` ADD `verified_until` integer;--> statement-breakpoint
ALTER TABLE `wiki_pages` ADD `verified_by` text REFERENCES user(id);--> statement-breakpoint
CREATE INDEX `wiki_pages_verified_until_idx` ON `wiki_pages` (`deleted_at`,`verified_until`);