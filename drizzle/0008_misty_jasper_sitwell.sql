CREATE TABLE `entry_payment_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`date` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`recipient` text DEFAULT '' NOT NULL,
	`amount_cents` integer NOT NULL,
	`payment_method` text DEFAULT 'bank' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entry_payment_lines_entry_idx` ON `entry_payment_lines` (`entry_id`);--> statement-breakpoint
INSERT INTO `entry_payment_lines` (`id`, `entry_id`, `date`, `description`, `recipient`, `amount_cents`, `payment_method`, `sort_order`)
SELECT lower(hex(randomblob(16))), `id`, `date`, `description`, `counterparty`, `gross_amount_cents`, `payment_method`, 0 FROM `entries`;
