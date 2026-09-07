ALTER TABLE `notes`
  ADD COLUMN `sender` text
  CONSTRAINT "notes_sender_length"
  CHECK (`sender` IS NULL OR (`sender` = trim(`sender`, ' ' || char(9) || char(10) || char(11) || char(12) || char(13) || char(160) || char(5760) || char(8192) || char(8193) || char(8194) || char(8195) || char(8196) || char(8197) || char(8198) || char(8199) || char(8200) || char(8201) || char(8202) || char(8232) || char(8233) || char(8239) || char(8287) || char(12288) || char(65279)) AND length(`sender`) BETWEEN 1 AND 80));
--> statement-breakpoint
UPDATE `app_metadata` SET `schema_version` = 6 WHERE `id` = 1;
