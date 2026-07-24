CREATE TABLE `user_profile_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`mark_color` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_profile_preferences_mark_color_unique` ON `user_profile_preferences` (`mark_color`);
--> statement-breakpoint
INSERT INTO `user_profile_preferences` (`user_id`, `mark_color`, `updated_at`)
SELECT `id`,
	CASE ROW_NUMBER() OVER (ORDER BY `createdAt`, `id`)
		WHEN 1 THEN 'amber'
		WHEN 2 THEN 'orange'
		WHEN 3 THEN 'red'
		WHEN 4 THEN 'rose'
		WHEN 5 THEN 'pink'
		WHEN 6 THEN 'fuchsia'
		WHEN 7 THEN 'purple'
		WHEN 8 THEN 'violet'
		WHEN 9 THEN 'indigo'
		WHEN 10 THEN 'blue'
		WHEN 11 THEN 'sky'
		WHEN 12 THEN 'cyan'
		WHEN 13 THEN 'teal'
		WHEN 14 THEN 'emerald'
		WHEN 15 THEN 'green'
		WHEN 16 THEN 'lime'
	END,
	CAST(unixepoch('subsec') * 1000 AS integer)
FROM `user`;
