CREATE TABLE `municipality_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`expression_json` text NOT NULL,
	`unit` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `municipality_metrics_owner_updated_idx` ON `municipality_metrics` (`owner_id`,`updated_at`);