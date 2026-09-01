CREATE TABLE `notes_new` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notes_body_length" CHECK(length("notes_new"."body") <= 10000)
);
--> statement-breakpoint
INSERT INTO `notes_new` (`id`, `chat_id`, `body`, `created_at`)
	SELECT `id`, `chat_id`, `body`, `created_at` FROM `notes`;
--> statement-breakpoint
DROP TABLE `notes`;
--> statement-breakpoint
ALTER TABLE `notes_new` RENAME TO `notes`;
--> statement-breakpoint
CREATE INDEX `notes_chat_history_idx` ON `notes` (`chat_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE TABLE `note_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`filename` text NOT NULL,
	`media_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`content` blob NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "note_attachments_filename_length" CHECK(length(trim("note_attachments"."filename")) BETWEEN 1 AND 255),
	CONSTRAINT "note_attachments_media_type_length" CHECK(length(trim("note_attachments"."media_type")) BETWEEN 1 AND 255),
	CONSTRAINT "note_attachments_byte_size_positive" CHECK("note_attachments"."byte_size" > 0),
	CONSTRAINT "note_attachments_content_length" CHECK(length("note_attachments"."content") = "note_attachments"."byte_size")
);
--> statement-breakpoint
CREATE INDEX `note_attachments_note_idx` ON `note_attachments` (`note_id`,`created_at`,`id`);
--> statement-breakpoint
UPDATE `app_metadata` SET `schema_version` = 2 WHERE `id` = 1;
