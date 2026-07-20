CREATE TABLE `payroll_month_contexts` (
	`payroll_month` text PRIMARY KEY NOT NULL,
	`internal_payroll_cents` integer DEFAULT 0 NOT NULL,
	`external_payroll_cents` integer DEFAULT 0 NOT NULL,
	`external_marginal_payroll_cents` integer DEFAULT 0 NOT NULL,
	`marginal_payroll_cents` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `business_locations` (`id`, `name`, `state`, `municipality`, `active`)
SELECT 'location-graz-styria', 'Graz / Steiermark', 'Steiermark', 'Graz', true
WHERE NOT EXISTS (
	SELECT 1 FROM `business_locations`
	WHERE lower(`state`) = 'steiermark' AND lower(`municipality`) = 'graz'
);
--> statement-breakpoint
UPDATE `employees`
SET `location_id` = (
	SELECT `id` FROM `business_locations`
	WHERE lower(`state`) = 'steiermark' AND lower(`municipality`) = 'graz'
	LIMIT 1
)
WHERE `location_id` IS NULL;
--> statement-breakpoint
UPDATE `employees`
SET `employment_type` = 'managing_director_asvg'
WHERE `employment_type` = 'managing_director';
--> statement-breakpoint
UPDATE `entries`
SET `special_fields` = json_set(
	`special_fields`,
	'$.employmentType', 'managing_director_asvg',
	'$.migrationReviewRequired', true
)
WHERE json_extract(`special_fields`, '$.employmentType') = 'managing_director';
--> statement-breakpoint
UPDATE `entries`
SET `special_fields` = json_set(
	`special_fields`,
	'$.calculationMode', 'manual',
	'$.overrideReason', 'Bestandsdatensatz vor Einführung der Automatik; Werte prüfen.'
)
WHERE `category_id` IN (SELECT `id` FROM `categories` WHERE `template` = 'personnel')
	AND json_extract(`special_fields`, '$.calculationMode') IS NULL;
