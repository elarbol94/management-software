CREATE TABLE `task_contexts` (
	`task_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`entity_id` text DEFAULT '' NOT NULL,
	`route` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`anchor_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_contexts_type_entity_idx` ON `task_contexts` (`type`,`entity_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`column_id` text,
	`last_open_column_id` text,
	`phase_id` text,
	`parent_task_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`assignee_id` text,
	`due_date` text,
	`start_date` text,
	`progress` integer DEFAULT 0 NOT NULL,
	`is_milestone` integer DEFAULT false NOT NULL,
	`constraint_type` text DEFAULT 'asap' NOT NULL,
	`constraint_date` text,
	`priority` text DEFAULT 'medium' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`completed_at` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`column_id`) REFERENCES `project_columns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_open_column_id`) REFERENCES `project_columns`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`phase_id`) REFERENCES `project_phases`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "project_id", "column_id", "last_open_column_id", "phase_id", "parent_task_id", "title", "description", "assignee_id", "due_date", "start_date", "progress", "is_milestone", "constraint_type", "constraint_date", "priority", "status", "completed_at", "sort_order", "created_by", "created_at", "updated_at")
SELECT "id", "project_id", "column_id",
	CASE WHEN EXISTS (SELECT 1 FROM `project_columns` pc WHERE pc.id = tasks.column_id AND pc.is_completed = 1) OR progress >= 100 THEN NULL ELSE "column_id" END,
	"phase_id", "parent_task_id", "title", "description", "assignee_id", "due_date", "start_date", "progress", "is_milestone", "constraint_type", "constraint_date", "priority",
	CASE WHEN EXISTS (SELECT 1 FROM `project_columns` pc WHERE pc.id = tasks.column_id AND pc.is_completed = 1) OR progress >= 100 THEN 'done' ELSE 'open' END,
	CASE WHEN EXISTS (SELECT 1 FROM `project_columns` pc WHERE pc.id = tasks.column_id AND pc.is_completed = 1) OR progress >= 100 THEN "updated_at" ELSE NULL END,
	"sort_order", "created_by", "created_at", "updated_at"
FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `tasks_project_idx` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `tasks_column_idx` ON `tasks` (`column_id`);--> statement-breakpoint
CREATE INDEX `tasks_assignee_idx` ON `tasks` (`assignee_id`);--> statement-breakpoint
CREATE INDEX `tasks_column_sort_idx` ON `tasks` (`column_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `tasks_assignee_due_idx` ON `tasks` (`assignee_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `tasks_status_assignee_priority_idx` ON `tasks` (`status`,`assignee_id`,`priority`);--> statement-breakpoint
CREATE INDEX `tasks_phase_sort_idx` ON `tasks` (`phase_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `tasks_parent_sort_idx` ON `tasks` (`parent_task_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `tasks_schedule_idx` ON `tasks` (`start_date`,`due_date`);--> statement-breakpoint
ALTER TABLE `wiki_notifications` ADD `task_id` text;
