CREATE TABLE `project_dependencies` (
  `id` text PRIMARY KEY NOT NULL,
  `predecessor_type` text NOT NULL,
  `predecessor_id` text NOT NULL,
  `successor_project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_dependencies_predecessor_idx` ON `project_dependencies` (`predecessor_type`,`predecessor_id`);
--> statement-breakpoint
CREATE INDEX `project_dependencies_successor_idx` ON `project_dependencies` (`successor_project_id`);
--> statement-breakpoint
CREATE TABLE `project_task_dependencies` (
  `id` text PRIMARY KEY NOT NULL,
  `predecessor_project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
  `successor_task_id` text NOT NULL REFERENCES `tasks`(`id`) ON DELETE CASCADE,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_task_dependencies_predecessor_idx` ON `project_task_dependencies` (`predecessor_project_id`);
--> statement-breakpoint
CREATE INDEX `project_task_dependencies_successor_idx` ON `project_task_dependencies` (`successor_task_id`);
