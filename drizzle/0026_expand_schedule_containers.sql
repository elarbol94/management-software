-- Widen existing summary tasks around every scheduled descendant. The CASE
-- expressions preserve authored slack, making this migration idempotent.
WITH RECURSIVE `task_tree` (`ancestor_id`, `descendant_id`) AS (
  SELECT `parent_task_id`, `id`
  FROM `tasks`
  WHERE `parent_task_id` IS NOT NULL
  UNION
  SELECT `task_tree`.`ancestor_id`, `child`.`id`
  FROM `task_tree`
  INNER JOIN `tasks` AS `child`
    ON `child`.`parent_task_id` = `task_tree`.`descendant_id`
)
UPDATE `tasks`
SET
  `start_date` = CASE
    WHEN (
      SELECT min(`descendant`.`start_date`)
      FROM `task_tree`
      INNER JOIN `tasks` AS `descendant`
        ON `descendant`.`id` = `task_tree`.`descendant_id`
      WHERE `task_tree`.`ancestor_id` = `tasks`.`id`
    ) IS NULL THEN `start_date`
    WHEN `start_date` IS NULL OR (
      SELECT min(`descendant`.`start_date`)
      FROM `task_tree`
      INNER JOIN `tasks` AS `descendant`
        ON `descendant`.`id` = `task_tree`.`descendant_id`
      WHERE `task_tree`.`ancestor_id` = `tasks`.`id`
    ) < `start_date` THEN (
      SELECT min(`descendant`.`start_date`)
      FROM `task_tree`
      INNER JOIN `tasks` AS `descendant`
        ON `descendant`.`id` = `task_tree`.`descendant_id`
      WHERE `task_tree`.`ancestor_id` = `tasks`.`id`
    )
    ELSE `start_date`
  END,
  `due_date` = CASE
    WHEN (
      SELECT max(`descendant`.`due_date`)
      FROM `task_tree`
      INNER JOIN `tasks` AS `descendant`
        ON `descendant`.`id` = `task_tree`.`descendant_id`
      WHERE `task_tree`.`ancestor_id` = `tasks`.`id`
    ) IS NULL THEN `due_date`
    WHEN `due_date` IS NULL OR (
      SELECT max(`descendant`.`due_date`)
      FROM `task_tree`
      INNER JOIN `tasks` AS `descendant`
        ON `descendant`.`id` = `task_tree`.`descendant_id`
      WHERE `task_tree`.`ancestor_id` = `tasks`.`id`
    ) > `due_date` THEN (
      SELECT max(`descendant`.`due_date`)
      FROM `task_tree`
      INNER JOIN `tasks` AS `descendant`
        ON `descendant`.`id` = `task_tree`.`descendant_id`
      WHERE `task_tree`.`ancestor_id` = `tasks`.`id`
    )
    ELSE `due_date`
  END
WHERE `id` IN (SELECT `ancestor_id` FROM `task_tree`);
--> statement-breakpoint
-- Projects are minimum containers too. Summary bounds were widened above, so
-- considering every task also preserves intentional slack on root tasks.
UPDATE `projects`
SET
  `planned_start_date` = CASE
    WHEN (
      SELECT min(`tasks`.`start_date`)
      FROM `tasks`
      WHERE `tasks`.`project_id` = `projects`.`id`
    ) IS NULL THEN `planned_start_date`
    WHEN `planned_start_date` IS NULL OR (
      SELECT min(`tasks`.`start_date`)
      FROM `tasks`
      WHERE `tasks`.`project_id` = `projects`.`id`
    ) < `planned_start_date` THEN (
      SELECT min(`tasks`.`start_date`)
      FROM `tasks`
      WHERE `tasks`.`project_id` = `projects`.`id`
    )
    ELSE `planned_start_date`
  END,
  `target_end_date` = CASE
    WHEN (
      SELECT max(`tasks`.`due_date`)
      FROM `tasks`
      WHERE `tasks`.`project_id` = `projects`.`id`
    ) IS NULL THEN `target_end_date`
    WHEN `target_end_date` IS NULL OR (
      SELECT max(`tasks`.`due_date`)
      FROM `tasks`
      WHERE `tasks`.`project_id` = `projects`.`id`
    ) > `target_end_date` THEN (
      SELECT max(`tasks`.`due_date`)
      FROM `tasks`
      WHERE `tasks`.`project_id` = `projects`.`id`
    )
    ELSE `target_end_date`
  END;
