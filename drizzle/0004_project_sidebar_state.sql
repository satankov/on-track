ALTER TABLE `chats`
  ADD COLUMN `pinned_at` integer
  CONSTRAINT "chats_pinned_at_nonnegative"
  CHECK (`pinned_at` IS NULL OR `pinned_at` >= 0);
--> statement-breakpoint
UPDATE `app_metadata` SET `schema_version` = 4 WHERE `id` = 1;
