CREATE TABLE `accounting_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`name` text NOT NULL,
	`placed_in_service_on` text NOT NULL,
	`acquisition_cost_cents` integer NOT NULL,
	`useful_life_years` integer NOT NULL,
	`rule_version` text DEFAULT 'AT-2026-review-required' NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounting_assets_entry_idx` ON `accounting_assets` (`entry_id`);--> statement-breakpoint
CREATE TABLE `business_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`state` text DEFAULT '' NOT NULL,
	`municipality` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `employees` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`personnel_number` text DEFAULT '' NOT NULL,
	`employment_type` text NOT NULL,
	`location_id` text,
	`joined_on` text,
	`left_on` text,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `business_locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `entry_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`action` text NOT NULL,
	`snapshot` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`changed_by` text NOT NULL,
	`changed_at` integer NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`changed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entry_audit_entry_idx` ON `entry_audit_log` (`entry_id`);--> statement-breakpoint
CREATE TABLE `entry_tax_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`net_amount_cents` integer NOT NULL,
	`vat_rate` integer NOT NULL,
	`vat_amount_cents` integer NOT NULL,
	`gross_amount_cents` integer NOT NULL,
	`input_vat_deductible_percent` integer DEFAULT 100 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entry_tax_lines_entry_idx` ON `entry_tax_lines` (`entry_id`);--> statement-breakpoint
CREATE TABLE `accounting_vehicles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`vehicle_type` text NOT NULL,
	`registration` text DEFAULT '' NOT NULL,
	`input_vat_eligible` integer DEFAULT false NOT NULL,
	`business_use_percent` integer DEFAULT 100 NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE `categories` ADD `template` text DEFAULT 'standard_expense' NOT NULL;--> statement-breakpoint
ALTER TABLE `entries` ADD `document_date` text;--> statement-breakpoint
ALTER TABLE `entries` ADD `document_number` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `entries` ADD `service_period_start` text;--> statement-breakpoint
ALTER TABLE `entries` ADD `service_period_end` text;--> statement-breakpoint
ALTER TABLE `entries` ADD `status` text DEFAULT 'finalized' NOT NULL;--> statement-breakpoint
ALTER TABLE `entries` ADD `deductible_percent` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `entries` ADD `warning_override_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `entries` ADD `special_fields` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `entries` ADD `voided_at` integer;--> statement-breakpoint
ALTER TABLE `entries` ADD `voided_by` text REFERENCES user(id);--> statement-breakpoint

-- Safe category-template migration: only known defaults receive specialist
-- behavior. User-created or renamed expense categories stay generic.
UPDATE `categories` SET `template` = 'standard_income' WHERE `kind` = 'income';--> statement-breakpoint
UPDATE `categories` SET `template` = 'grant_income' WHERE `name` = 'Förderungen' AND `kind` = 'income';--> statement-breakpoint
UPDATE `categories` SET `template` = 'hospitality' WHERE `name` = 'Bewirtung' AND `kind` = 'expense';--> statement-breakpoint
UPDATE `categories` SET `template` = 'travel' WHERE `name` = 'Reisekosten' AND `kind` = 'expense';--> statement-breakpoint
UPDATE `categories` SET `template` = 'vehicle' WHERE `name` = 'KFZ-Kosten' AND `kind` = 'expense';--> statement-breakpoint
UPDATE `categories` SET `template` = 'asset' WHERE `name` = 'GWG (geringwertige Wirtschaftsgüter)' AND `kind` = 'expense';--> statement-breakpoint
UPDATE `categories` SET `template` = 'svs' WHERE `name` = 'Sozialversicherung (SVS)' AND `kind` = 'expense';--> statement-breakpoint
UPDATE `categories` SET `template` = 'tax_levy' WHERE `name` = 'Steuern & Abgaben' AND `kind` = 'expense';--> statement-breakpoint

INSERT INTO `categories` (`id`, `name`, `kind`, `color`, `template`, `sort_order`, `archived`)
SELECT lower(hex(randomblob(16))), 'Personalkosten', 'expense', '#8b5e3c', 'personnel', 185, false
WHERE NOT EXISTS (SELECT 1 FROM `categories` WHERE `name` = 'Personalkosten' AND `kind` = 'expense');--> statement-breakpoint

UPDATE `entries` SET `document_date` = `date` WHERE `document_date` IS NULL;--> statement-breakpoint
INSERT INTO `entry_tax_lines` (`id`, `entry_id`, `description`, `net_amount_cents`, `vat_rate`, `vat_amount_cents`, `gross_amount_cents`, `input_vat_deductible_percent`, `sort_order`)
SELECT lower(hex(randomblob(16))), `id`, '', `net_amount_cents`, `vat_rate`, `vat_amount_cents`, `gross_amount_cents`, 100, 0 FROM `entries`;
