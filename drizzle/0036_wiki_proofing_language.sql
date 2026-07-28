ALTER TABLE `wiki_pages` ADD `proofing_language` text DEFAULT 'de-DE' NOT NULL;--> statement-breakpoint
UPDATE `wiki_pages` SET `proofing_language` = `citation_locale` WHERE `citation_locale` IN ('de-DE', 'en-US');
