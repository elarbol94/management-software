CREATE TABLE `employment_contract_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`employment_type` text NOT NULL,
	`input_mode` text DEFAULT 'gross' NOT NULL,
	`monthly_amount_cents` integer NOT NULL,
	`weekly_minutes` integer NOT NULL,
	`workdays_per_week` integer DEFAULT 5 NOT NULL,
	`special_payments_enabled` integer DEFAULT true NOT NULL,
	`holiday_pay_month` integer DEFAULT 6 NOT NULL,
	`christmas_pay_month` integer DEFAULT 11 NOT NULL,
	`vacation_weeks_hundredths` integer DEFAULT 500 NOT NULL,
	`expected_sick_hours_hundredths` integer DEFAULT 0 NOT NULL,
	`training_hours_hundredths` integer DEFAULT 0 NOT NULL,
	`internal_hours_hundredths` integer DEFAULT 0 NOT NULL,
	`overhead_rate_basis_points` integer DEFAULT 0 NOT NULL,
	`sales_markup_basis_points` integer DEFAULT 0 NOT NULL,
	`collective_agreement` text DEFAULT '' NOT NULL,
	`one_off_payments_json` text DEFAULT '[]' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `employment_contract_employee_valid_idx` ON `employment_contract_periods` (`employee_id`,`valid_from`);--> statement-breakpoint
CREATE TABLE `funding_cost_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`divisor_mode` text DEFAULT 'productive_hours' NOT NULL,
	`fixed_annual_divisor` integer,
	`eligible_components_json` text DEFAULT '[]' NOT NULL,
	`hourly_cap_cents` integer,
	`max_annual_hours_hundredths` integer,
	`overhead_rate_basis_points` integer DEFAULT 0 NOT NULL,
	`rounding_mode` text DEFAULT 'cent' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `funding_cost_profile_name_version_idx` ON `funding_cost_profiles` (`name`,`version`);--> statement-breakpoint
CREATE TABLE `personnel_funding_project_links` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`funding_project_id` text NOT NULL,
	`funding_profile_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`funding_project_id`) REFERENCES `funding_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`funding_profile_id`) REFERENCES `funding_cost_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `personnel_funding_project_link_idx` ON `personnel_funding_project_links` (`project_id`,`funding_project_id`);--> statement-breakpoint
CREATE TABLE `personnel_month_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`payroll_month` text NOT NULL,
	`rule_version` text NOT NULL,
	`rule_status` text NOT NULL,
	`input_json` text NOT NULL,
	`result_json` text NOT NULL,
	`checksum` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `personnel_month_snapshots_checksum_unique` ON `personnel_month_snapshots` (`checksum`);--> statement-breakpoint
CREATE INDEX `personnel_snapshot_month_idx` ON `personnel_month_snapshots` (`payroll_month`,`created_at`);--> statement-breakpoint
CREATE TABLE `personnel_postings` (
	`id` text PRIMARY KEY NOT NULL,
	`payroll_month` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`kind` text DEFAULT 'regular' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `personnel_month_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `personnel_postings_month_idx` ON `personnel_postings` (`payroll_month`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `personnel_postings_snapshot_idx` ON `personnel_postings` (`snapshot_id`);--> statement-breakpoint
CREATE TABLE `personnel_scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text,
	`source_scenario_id` text,
	`name` text NOT NULL,
	`kind` text DEFAULT 'scenario' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`planning_year` integer NOT NULL,
	`input_json` text NOT NULL,
	`result_json` text NOT NULL,
	`rule_version` text NOT NULL,
	`checksum` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `personnel_scenarios_employee_year_idx` ON `personnel_scenarios` (`employee_id`,`planning_year`);--> statement-breakpoint
CREATE TABLE `personnel_tax_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`taxable_benefits_cents` integer DEFAULT 0 NOT NULL,
	`commuter_allowance_cents` integer DEFAULT 0 NOT NULL,
	`commuter_euro_cents` integer DEFAULT 0 NOT NULL,
	`family_bonus_cents` integer DEFAULT 0 NOT NULL,
	`sole_earner_credit_cents` integer DEFAULT 0 NOT NULL,
	`single_parent_credit_cents` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `personnel_tax_employee_valid_idx` ON `personnel_tax_profiles` (`employee_id`,`valid_from`);--> statement-breakpoint
CREATE TABLE `project_hour_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`project_id` text NOT NULL,
	`payroll_month` text NOT NULL,
	`planned_minutes` integer NOT NULL,
	`cost_rate_cents` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_hours_employee_project_month_idx` ON `project_hour_allocations` (`employee_id`,`project_id`,`payroll_month`);--> statement-breakpoint
CREATE INDEX `project_hours_project_month_idx` ON `project_hour_allocations` (`project_id`,`payroll_month`);--> statement-breakpoint
ALTER TABLE `employees` ADD `user_id` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `employees` ADD `birth_date` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `collective_agreement` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `employees_user_idx` ON `employees` (`user_id`);