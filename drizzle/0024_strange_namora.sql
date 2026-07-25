CREATE TABLE `project_schedule_change_items` (
	`id` text PRIMARY KEY NOT NULL,
	`change_set_id` text NOT NULL,
	`project_id` text NOT NULL,
	`before_start_date` text,
	`before_due_date` text,
	`after_start_date` text,
	`after_due_date` text,
	FOREIGN KEY (`change_set_id`) REFERENCES `schedule_change_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_schedule_change_items_set_idx` ON `project_schedule_change_items` (`change_set_id`);--> statement-breakpoint
CREATE INDEX `project_schedule_change_items_project_idx` ON `project_schedule_change_items` (`project_id`);