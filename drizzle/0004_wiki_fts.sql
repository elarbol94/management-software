-- Full-text search over wiki pages. Kept in sync manually in the same
-- transaction as every page save/delete (see modules/wiki/actions.ts).
CREATE VIRTUAL TABLE `wiki_pages_fts` USING fts5(
  `page_id` UNINDEXED,
  `title`,
  `content_text`
);
