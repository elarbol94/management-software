ALTER TABLE `user` ADD `username` text;--> statement-breakpoint
ALTER TABLE `user` ADD `displayUsername` text;--> statement-breakpoint
UPDATE `user` SET `username` = lower(`email`), `displayUsername` = `email` WHERE `username` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);