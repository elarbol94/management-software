CREATE TABLE `performance_events` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`value` real NOT NULL,
	`rating` text,
	`route` text NOT NULL,
	`navigation_type` text,
	`build_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `performance_events_created_idx` ON `performance_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `performance_events_metric_idx` ON `performance_events` (`kind`,`name`,`created_at`);