CREATE TABLE `calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#6D5EF7' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calendars_owner_idx` ON `calendars` (`owner_id`);
--> statement-breakpoint
CREATE INDEX `calendars_visibility_idx` ON `calendars` (`visibility`);
--> statement-breakpoint
CREATE TABLE `calendar_memberships` (
	`calendar_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`calendar_id`, `user_id`),
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calendar_memberships_user_idx` ON `calendar_memberships` (`user_id`);
--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`calendar_id` text NOT NULL,
	`kind` text DEFAULT 'event' NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`start_date` text,
	`end_date` text,
	`start_at` integer,
	`end_at` integer,
	`timezone` text DEFAULT 'Europe/Berlin' NOT NULL,
	`availability` text DEFAULT 'busy' NOT NULL,
	`recurrence_rule` text,
	`linked_task_id` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linked_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `calendar_events_calendar_idx` ON `calendar_events` (`calendar_id`);
--> statement-breakpoint
CREATE INDEX `calendar_events_timed_range_idx` ON `calendar_events` (`start_at`, `end_at`);
--> statement-breakpoint
CREATE INDEX `calendar_events_all_day_range_idx` ON `calendar_events` (`start_date`, `end_date`);
--> statement-breakpoint
CREATE INDEX `calendar_events_linked_task_idx` ON `calendar_events` (`linked_task_id`);
--> statement-breakpoint
CREATE TABLE `calendar_event_attendees` (
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`response` text DEFAULT 'needs_action' NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`event_id`, `user_id`),
	FOREIGN KEY (`event_id`) REFERENCES `calendar_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calendar_event_attendees_user_idx` ON `calendar_event_attendees` (`user_id`);
--> statement-breakpoint
CREATE TABLE `calendar_event_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`occurrence_key` text NOT NULL,
	`cancelled` integer DEFAULT false NOT NULL,
	`override_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `calendar_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_event_exceptions_occurrence_idx` ON `calendar_event_exceptions` (`event_id`, `occurrence_key`);
--> statement-breakpoint
CREATE TABLE `calendar_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`minutes_before` integer DEFAULT 15 NOT NULL,
	`channel` text DEFAULT 'in_app' NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `calendar_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calendar_reminders_user_idx` ON `calendar_reminders` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_reminders_unique_idx` ON `calendar_reminders` (`event_id`, `user_id`, `minutes_before`);
--> statement-breakpoint
CREATE TABLE `calendar_reminder_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`reminder_id` text NOT NULL,
	`occurrence_key` text NOT NULL,
	`delivered_at` integer NOT NULL,
	FOREIGN KEY (`reminder_id`) REFERENCES `calendar_reminders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_reminder_deliveries_unique_idx` ON `calendar_reminder_deliveries` (`reminder_id`, `occurrence_key`);
--> statement-breakpoint
CREATE TABLE `calendar_saved_views` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`view` text DEFAULT 'week' NOT NULL,
	`filter_json` text DEFAULT '{}' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calendar_saved_views_user_idx` ON `calendar_saved_views` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_saved_views_name_idx` ON `calendar_saved_views` (`user_id`, `name`);
--> statement-breakpoint
CREATE TABLE `calendar_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`timezone` text DEFAULT 'Europe/Berlin' NOT NULL,
	`week_starts_on` integer DEFAULT 1 NOT NULL,
	`working_day_start` text DEFAULT '08:00' NOT NULL,
	`working_day_end` text DEFAULT '17:00' NOT NULL,
	`working_days_json` text DEFAULT '[1,2,3,4,5]' NOT NULL,
	`default_view` text DEFAULT 'week' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
