ALTER TABLE `tasks` ADD `constraint_type` text DEFAULT 'asap' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `constraint_date` text;--> statement-breakpoint
-- Existing plans were built against a push-only cascade, so pin every scheduled
-- task to its current start. Nothing is pulled earlier on deploy; new tasks
-- default to 'asap' and follow their predecessors in both directions.
UPDATE `tasks`
SET `constraint_type` = 'start_no_earlier_than', `constraint_date` = `start_date`
WHERE `start_date` IS NOT NULL;