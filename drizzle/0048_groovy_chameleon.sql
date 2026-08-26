CREATE TABLE `wiki_embeddings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text NOT NULL,
	`page_number` integer DEFAULT 0 NOT NULL,
	`chunk_index` integer DEFAULT 0 NOT NULL,
	`content_hash` text NOT NULL,
	`text` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wiki_embeddings_chunk_unique` ON `wiki_embeddings` (`kind`,`ref_id`,`page_number`,`chunk_index`);--> statement-breakpoint
CREATE INDEX `wiki_embeddings_ref_idx` ON `wiki_embeddings` (`kind`,`ref_id`);