CREATE TABLE `project_phases` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_phases_project_sort_idx` ON `project_phases` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `schedule_change_items` (
	`id` text PRIMARY KEY NOT NULL,
	`change_set_id` text NOT NULL,
	`task_id` text NOT NULL,
	`before_start_date` text,
	`before_due_date` text,
	`after_start_date` text,
	`after_due_date` text,
	FOREIGN KEY (`change_set_id`) REFERENCES `schedule_change_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `schedule_change_items_set_idx` ON `schedule_change_items` (`change_set_id`);--> statement-breakpoint
CREATE INDEX `schedule_change_items_task_idx` ON `schedule_change_items` (`task_id`);--> statement-breakpoint
CREATE TABLE `schedule_change_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`created_by` text NOT NULL,
	`status` text DEFAULT 'applied' NOT NULL,
	`created_at` integer NOT NULL,
	`reverted_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `schedule_change_sets_created_by_idx` ON `schedule_change_sets` (`created_by`,`created_at`);--> statement-breakpoint
CREATE TABLE `task_dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`predecessor_task_id` text NOT NULL,
	`successor_task_id` text NOT NULL,
	`dependency_type` text DEFAULT 'finish_to_start' NOT NULL,
	`lag_workdays` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`predecessor_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`successor_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_dependencies_predecessor_idx` ON `task_dependencies` (`predecessor_task_id`);--> statement-breakpoint
CREATE INDEX `task_dependencies_successor_idx` ON `task_dependencies` (`successor_task_id`);--> statement-breakpoint
CREATE INDEX `task_dependencies_pair_idx` ON `task_dependencies` (`predecessor_task_id`,`successor_task_id`);--> statement-breakpoint
ALTER TABLE `project_columns` ADD `is_completed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `manager_id` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `projects` ADD `planned_start_date` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `target_end_date` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `phase_id` text REFERENCES project_phases(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `start_date` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `progress` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `is_milestone` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `tasks_phase_sort_idx` ON `tasks` (`phase_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `tasks_schedule_idx` ON `tasks` (`start_date`,`due_date`);--> statement-breakpoint
INSERT INTO `project_phases` (`id`, `project_id`, `name`, `sort_order`, `created_at`, `updated_at`)
SELECT 'phase_' || `id`, `id`, 'Allgemein', 1000, unixepoch() * 1000, unixepoch() * 1000
FROM `projects`;--> statement-breakpoint
UPDATE `tasks`
SET `phase_id` = 'phase_' || `project_id`;--> statement-breakpoint
UPDATE `project_columns`
SET `is_completed` = true
WHERE `sort_order` = (
  SELECT max(`last_column`.`sort_order`)
  FROM `project_columns` AS `last_column`
  WHERE `last_column`.`project_id` = `project_columns`.`project_id`
);--> statement-breakpoint
UPDATE `tasks`
SET `progress` = 100
WHERE `column_id` IN (
  SELECT `id` FROM `project_columns` WHERE `is_completed` = true
);
