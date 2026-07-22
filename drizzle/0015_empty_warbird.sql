ALTER TABLE `wiki_comment_threads` ADD `anchor_type` text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE `wiki_comment_threads` ADD `anchor_node_id` text;--> statement-breakpoint
ALTER TABLE `wiki_comment_threads` ADD `anchor_data` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
UPDATE `wiki_comment_threads` SET `anchor_type` = CASE WHEN `anchor_quote` = '' THEN 'page' ELSE 'text' END;
