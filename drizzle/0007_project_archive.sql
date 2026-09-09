ALTER TABLE `chats`
  ADD COLUMN `archived_at` integer
  CONSTRAINT "chats_archive_valid"
  CHECK (`archived_at` IS NULL OR (typeof(`archived_at`) = 'integer' AND `archived_at` >= 0 AND `archived_at` <= 9007199254740991 AND `pinned_at` IS NULL));
--> statement-breakpoint
UPDATE `app_metadata` SET `schema_version` = 7 WHERE `id` = 1;
