CREATE INDEX `entries_status_date_created_idx` ON `entries` (`status`,`date`,`created_at`);--> statement-breakpoint
CREATE INDEX `projects_status_updated_idx` ON `projects` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `tasks_column_sort_idx` ON `tasks` (`column_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `tasks_assignee_due_idx` ON `tasks` (`assignee_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `wiki_comment_threads_page_created_idx` ON `wiki_comment_threads` (`page_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `wiki_comments_thread_deleted_created_idx` ON `wiki_comments` (`thread_id`,`deleted_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `wiki_pages_deleted_status_updated_idx` ON `wiki_pages` (`deleted_at`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `wiki_sources_deleted_updated_idx` ON `wiki_sources` (`deleted_at`,`updated_at`);