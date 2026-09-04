ALTER TABLE `chats`
  ADD COLUMN `collapse_long_messages` integer DEFAULT 1 NOT NULL
  CONSTRAINT "chats_collapse_long_messages_boolean"
  CHECK (`collapse_long_messages` IN (0, 1));
--> statement-breakpoint
UPDATE `app_metadata` SET `schema_version` = 5 WHERE `id` = 1;
