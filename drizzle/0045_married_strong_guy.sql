ALTER TABLE `wiki_page_revisions` ADD `citation_style` text DEFAULT 'ieee' NOT NULL;--> statement-breakpoint
ALTER TABLE `wiki_pages` ADD `citation_style` text DEFAULT 'ieee' NOT NULL;