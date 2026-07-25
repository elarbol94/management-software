ALTER TABLE `tasks` ADD `parent_task_id` text REFERENCES tasks(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `tasks_parent_sort_idx` ON `tasks` (`parent_task_id`,`sort_order`);
