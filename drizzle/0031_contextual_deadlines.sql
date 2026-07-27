ALTER TABLE `tasks` ADD `kind` text DEFAULT 'task' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `deadline_at` integer;--> statement-breakpoint
CREATE INDEX `tasks_kind_deadline_idx` ON `tasks` (`kind`,`deadline_at`);