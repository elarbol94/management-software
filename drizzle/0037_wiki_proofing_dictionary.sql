CREATE TABLE `wiki_proofing_words` (
	`id` text PRIMARY KEY NOT NULL,
	`language` text NOT NULL,
	`word` text NOT NULL,
	`normalized_word` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wiki_proofing_words_language_word_unique` ON `wiki_proofing_words` (`language`,`normalized_word`);
