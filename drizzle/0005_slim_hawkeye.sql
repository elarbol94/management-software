CREATE TABLE `budget_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_plans_category_year_month_idx` ON `budget_plans` (`category_id`,`year`,`month`);--> statement-breakpoint
CREATE INDEX `budget_plans_year_idx` ON `budget_plans` (`year`);