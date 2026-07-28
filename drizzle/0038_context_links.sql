CREATE TABLE `context_links` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text DEFAULT '' NOT NULL,
	`relation` text DEFAULT 'related' NOT NULL,
	`route` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`anchor_json` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `context_links_owner_idx` ON `context_links` (`owner_type`,`owner_id`);
--> statement-breakpoint
CREATE INDEX `context_links_target_idx` ON `context_links` (`target_type`,`target_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `context_links_unique` ON `context_links` (`owner_type`,`owner_id`,`target_type`,`target_id`,`relation`,`route`);
--> statement-breakpoint
INSERT INTO `context_links` (
	`id`,
	`owner_type`,
	`owner_id`,
	`target_type`,
	`target_id`,
	`relation`,
	`route`,
	`label`,
	`anchor_json`,
	`created_by`,
	`created_at`,
	`updated_at`
)
SELECT
	'legacy-' || `task_contexts`.`task_id`,
	'task',
	`task_contexts`.`task_id`,
	`task_contexts`.`type`,
	`task_contexts`.`entity_id`,
	'origin',
	`task_contexts`.`route`,
	`task_contexts`.`label`,
	`task_contexts`.`anchor_json`,
	`tasks`.`created_by`,
	`task_contexts`.`created_at`,
	`task_contexts`.`updated_at`
FROM `task_contexts`
INNER JOIN `tasks` ON `tasks`.`id` = `task_contexts`.`task_id`;
