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
CREATE INDEX `budget_plans_year_idx` ON `budget_plans` (`year`);--> statement-breakpoint
CREATE TABLE `funding_booking_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`budget_item_id` text NOT NULL,
	`accounting_entry_id` text,
	`booking_date` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`actual_amount_cents` integer NOT NULL,
	`evidence_status` text DEFAULT 'missing' NOT NULL,
	`evidence_note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `funding_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`budget_item_id`) REFERENCES `funding_budget_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `funding_booking_allocations_project_idx` ON `funding_booking_allocations` (`project_id`);--> statement-breakpoint
CREATE INDEX `funding_booking_allocations_budget_idx` ON `funding_booking_allocations` (`budget_item_id`);--> statement-breakpoint
CREATE INDEX `funding_booking_allocations_entry_idx` ON `funding_booking_allocations` (`accounting_entry_id`);--> statement-breakpoint
CREATE TABLE `funding_budget_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`cost_type` text NOT NULL,
	`custom_cost_type` text DEFAULT '' NOT NULL,
	`description` text NOT NULL,
	`work_package` text DEFAULT '' NOT NULL,
	`supplier_or_person` text DEFAULT '' NOT NULL,
	`quantity_thousandths` integer DEFAULT 1000 NOT NULL,
	`unit_label` text DEFAULT 'Stk.' NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`planned_month` text,
	`total_cents` integer NOT NULL,
	`eligible_amount_cents` integer NOT NULL,
	`necessity_justification` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `funding_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `funding_budget_items_project_idx` ON `funding_budget_items` (`project_id`);--> statement-breakpoint
CREATE TABLE `funding_disbursements` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`label` text NOT NULL,
	`planned_date` text,
	`amount_cents` integer NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`received_at` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `funding_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `funding_disbursements_project_idx` ON `funding_disbursements` (`project_id`);--> statement-breakpoint
CREATE TABLE `funding_evidence_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`budget_item_id` text,
	`booking_allocation_id` text,
	`name` text NOT NULL,
	`status` text DEFAULT 'missing' NOT NULL,
	`due_date` text,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `funding_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`budget_item_id`) REFERENCES `funding_budget_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`booking_allocation_id`) REFERENCES `funding_booking_allocations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `funding_evidence_items_project_idx` ON `funding_evidence_items` (`project_id`);--> statement-breakpoint
CREATE TABLE `funding_financing_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_type` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`amount_cents` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `funding_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `funding_financing_sources_project_idx` ON `funding_financing_sources` (`project_id`);--> statement-breakpoint
CREATE TABLE `funding_program_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`structure_json` text DEFAULT '{}' NOT NULL,
	`is_custom` integer DEFAULT false NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `funding_program_templates_key_idx` ON `funding_program_templates` (`key`);--> statement-breakpoint
CREATE TABLE `funding_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text,
	`program_name` text DEFAULT '' NOT NULL,
	`funding_body` text NOT NULL,
	`name` text NOT NULL,
	`submission_deadline` text,
	`planned_submission_date` text,
	`project_start` text,
	`project_end` text,
	`status` text DEFAULT 'planning' NOT NULL,
	`funding_rate_basis_points` integer DEFAULT 0 NOT NULL,
	`funding_cap_cents` integer,
	`approved_funding_cents` integer DEFAULT 0 NOT NULL,
	`contact_name` text DEFAULT '' NOT NULL,
	`contact_email` text DEFAULT '' NOT NULL,
	`funding_number` text DEFAULT '' NOT NULL,
	`vat_deductible` integer DEFAULT false NOT NULL,
	`de_minimis_relevant` integer DEFAULT false NOT NULL,
	`other_aid_cents` integer DEFAULT 0 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `funding_program_templates`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `funding_projects_status_idx` ON `funding_projects` (`status`);--> statement-breakpoint
CREATE INDEX `funding_projects_template_idx` ON `funding_projects` (`template_id`);