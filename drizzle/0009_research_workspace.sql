ALTER TABLE `wiki_pages` ADD `status` text DEFAULT 'inbox' NOT NULL;
--> statement-breakpoint
ALTER TABLE `wiki_pages` ADD `citation_locale` text DEFAULT 'de-DE' NOT NULL;
--> statement-breakpoint
ALTER TABLE `wiki_pages` ADD `version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
UPDATE `wiki_pages` SET `status` = 'evergreen';
--> statement-breakpoint
CREATE TABLE `wiki_sources` (
  `id` text PRIMARY KEY NOT NULL, `type` text DEFAULT 'document' NOT NULL,
  `title` text NOT NULL, `subtitle` text DEFAULT '' NOT NULL, `issued_date` text DEFAULT '' NOT NULL,
  `container_title` text DEFAULT '' NOT NULL, `publisher` text DEFAULT '' NOT NULL,
  `institution` text DEFAULT '' NOT NULL, `edition` text DEFAULT '' NOT NULL,
  `volume` text DEFAULT '' NOT NULL, `issue` text DEFAULT '' NOT NULL, `pages` text DEFAULT '' NOT NULL,
  `doi` text DEFAULT '' NOT NULL, `isbn` text DEFAULT '' NOT NULL, `url` text DEFAULT '' NOT NULL,
  `accessed_at` text DEFAULT '' NOT NULL, `language` text DEFAULT '' NOT NULL,
  `abstract` text DEFAULT '' NOT NULL, `notes` text DEFAULT '' NOT NULL,
  `reading_status` text DEFAULT 'toRead' NOT NULL, `version` integer DEFAULT 1 NOT NULL,
  `created_by` text NOT NULL, `updated_by` text NOT NULL, `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL, `deleted_at` integer,
  FOREIGN KEY (`created_by`) REFERENCES `user`(`id`), FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE INDEX `wiki_sources_title_idx` ON `wiki_sources` (`title`);
--> statement-breakpoint
CREATE INDEX `wiki_sources_status_idx` ON `wiki_sources` (`reading_status`);
--> statement-breakpoint
CREATE INDEX `wiki_sources_doi_idx` ON `wiki_sources` (`doi`);
--> statement-breakpoint
CREATE INDEX `wiki_sources_isbn_idx` ON `wiki_sources` (`isbn`);
--> statement-breakpoint
CREATE TABLE `wiki_source_contributors` (`id` text PRIMARY KEY NOT NULL, `source_id` text NOT NULL, `role` text DEFAULT 'author' NOT NULL, `given` text DEFAULT '' NOT NULL, `family` text DEFAULT '' NOT NULL, `literal` text DEFAULT '' NOT NULL, `sort_order` integer DEFAULT 0 NOT NULL, FOREIGN KEY (`source_id`) REFERENCES `wiki_sources`(`id`) ON DELETE CASCADE);
--> statement-breakpoint
CREATE INDEX `wiki_contributors_source_idx` ON `wiki_source_contributors` (`source_id`);
--> statement-breakpoint
CREATE TABLE `wiki_tags` (`id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, `normalized_name` text NOT NULL, `color` text DEFAULT 'indigo' NOT NULL, `created_by` text NOT NULL, `created_at` integer NOT NULL, FOREIGN KEY (`created_by`) REFERENCES `user`(`id`));
--> statement-breakpoint
CREATE UNIQUE INDEX `wiki_tags_normalized_unique` ON `wiki_tags` (`normalized_name`);
--> statement-breakpoint
CREATE TABLE `wiki_page_tags` (`page_id` text NOT NULL, `tag_id` text NOT NULL, PRIMARY KEY (`page_id`,`tag_id`), FOREIGN KEY (`page_id`) REFERENCES `wiki_pages`(`id`) ON DELETE CASCADE, FOREIGN KEY (`tag_id`) REFERENCES `wiki_tags`(`id`) ON DELETE CASCADE);
--> statement-breakpoint
CREATE TABLE `wiki_source_tags` (`source_id` text NOT NULL, `tag_id` text NOT NULL, PRIMARY KEY (`source_id`,`tag_id`), FOREIGN KEY (`source_id`) REFERENCES `wiki_sources`(`id`) ON DELETE CASCADE, FOREIGN KEY (`tag_id`) REFERENCES `wiki_tags`(`id`) ON DELETE CASCADE);
--> statement-breakpoint
CREATE TABLE `wiki_page_sources` (`page_id` text NOT NULL, `source_id` text NOT NULL, `relation` text DEFAULT 'supporting' NOT NULL, PRIMARY KEY (`page_id`,`source_id`,`relation`), FOREIGN KEY (`page_id`) REFERENCES `wiki_pages`(`id`) ON DELETE CASCADE, FOREIGN KEY (`source_id`) REFERENCES `wiki_sources`(`id`) ON DELETE CASCADE);
--> statement-breakpoint
CREATE INDEX `wiki_page_sources_source_idx` ON `wiki_page_sources` (`source_id`);
--> statement-breakpoint
CREATE TABLE `wiki_favorites` (`user_id` text NOT NULL, `entity_type` text NOT NULL, `entity_id` text NOT NULL, `created_at` integer NOT NULL, PRIMARY KEY (`user_id`,`entity_type`,`entity_id`), FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE);
--> statement-breakpoint
CREATE TABLE `wiki_page_revisions` (`id` text PRIMARY KEY NOT NULL, `page_id` text NOT NULL, `version` integer NOT NULL, `title` text NOT NULL, `content_json` text NOT NULL, `status` text NOT NULL, `citation_locale` text NOT NULL, `kind` text DEFAULT 'autosave' NOT NULL, `created_by` text NOT NULL, `created_at` integer NOT NULL, FOREIGN KEY (`page_id`) REFERENCES `wiki_pages`(`id`) ON DELETE CASCADE, FOREIGN KEY (`created_by`) REFERENCES `user`(`id`));
--> statement-breakpoint
CREATE INDEX `wiki_page_revisions_page_idx` ON `wiki_page_revisions` (`page_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `wiki_source_revisions` (`id` text PRIMARY KEY NOT NULL, `source_id` text NOT NULL, `version` integer NOT NULL, `snapshot_json` text NOT NULL, `created_by` text NOT NULL, `created_at` integer NOT NULL, FOREIGN KEY (`source_id`) REFERENCES `wiki_sources`(`id`) ON DELETE CASCADE, FOREIGN KEY (`created_by`) REFERENCES `user`(`id`));
--> statement-breakpoint
CREATE INDEX `wiki_source_revisions_source_idx` ON `wiki_source_revisions` (`source_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `wiki_comment_threads` (`id` text PRIMARY KEY NOT NULL, `page_id` text NOT NULL, `anchor_quote` text DEFAULT '' NOT NULL, `orphaned` integer DEFAULT 0 NOT NULL, `resolved_at` integer, `resolved_by` text, `assignee_id` text, `created_by` text NOT NULL, `created_at` integer NOT NULL, FOREIGN KEY (`page_id`) REFERENCES `wiki_pages`(`id`) ON DELETE CASCADE, FOREIGN KEY (`resolved_by`) REFERENCES `user`(`id`), FOREIGN KEY (`assignee_id`) REFERENCES `user`(`id`), FOREIGN KEY (`created_by`) REFERENCES `user`(`id`));
--> statement-breakpoint
CREATE INDEX `wiki_comment_threads_page_idx` ON `wiki_comment_threads` (`page_id`);
--> statement-breakpoint
CREATE TABLE `wiki_comments` (`id` text PRIMARY KEY NOT NULL, `thread_id` text NOT NULL, `body` text NOT NULL, `created_by` text NOT NULL, `created_at` integer NOT NULL, FOREIGN KEY (`thread_id`) REFERENCES `wiki_comment_threads`(`id`) ON DELETE CASCADE, FOREIGN KEY (`created_by`) REFERENCES `user`(`id`));
--> statement-breakpoint
CREATE INDEX `wiki_comments_thread_idx` ON `wiki_comments` (`thread_id`);
--> statement-breakpoint
CREATE TABLE `wiki_notifications` (`id` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL, `actor_id` text NOT NULL, `type` text NOT NULL, `page_id` text, `thread_id` text, `read_at` integer, `created_at` integer NOT NULL, FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE, FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON DELETE CASCADE, FOREIGN KEY (`page_id`) REFERENCES `wiki_pages`(`id`) ON DELETE CASCADE, FOREIGN KEY (`thread_id`) REFERENCES `wiki_comment_threads`(`id`) ON DELETE CASCADE);
--> statement-breakpoint
CREATE INDEX `wiki_notifications_user_idx` ON `wiki_notifications` (`user_id`,`read_at`,`created_at`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `wiki_sources_fts` USING fts5(`source_id` UNINDEXED, `title`, `contributors`, `metadata`, `abstract`, `notes`);
