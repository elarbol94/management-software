CREATE TABLE `funding_income_links` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`accounting_entry_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `funding_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `funding_income_links_entry_idx` ON `funding_income_links` (`accounting_entry_id`);--> statement-breakpoint
CREATE INDEX `funding_income_links_project_idx` ON `funding_income_links` (`project_id`);