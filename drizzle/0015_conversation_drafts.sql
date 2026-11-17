CREATE TABLE `conversation_drafts` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`revision` text NOT NULL,
	`body` text NOT NULL,
	`sender` text NOT NULL,
	`timestamp` text NOT NULL,
	`sender_open` integer NOT NULL,
	`timestamp_open` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "draft_bounds" CHECK(length("conversation_drafts"."revision") = 36 AND length("conversation_drafts"."body") <= 10000 AND length("conversation_drafts"."sender") <= 80 AND length("conversation_drafts"."timestamp") <= 32 AND "conversation_drafts"."sender_open" IN (0,1) AND "conversation_drafts"."timestamp_open" IN (0,1))
);
--> statement-breakpoint
CREATE TABLE `__new_note_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_chat_id` text,
	`position` integer,
	`note_id` text,
	`filename` text NOT NULL,
	`media_type` text NOT NULL,
	`storage_path` text NOT NULL,
	`byte_size` integer NOT NULL,
	`modified_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`draft_chat_id`) REFERENCES `conversation_drafts`(`chat_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "attachment_owner" CHECK(("__new_note_attachments"."note_id" IS NULL) <> ("__new_note_attachments"."draft_chat_id" IS NULL)),
	CONSTRAINT "attachment_position" CHECK(("__new_note_attachments"."note_id" IS NOT NULL AND "__new_note_attachments"."position" IS NULL) OR (typeof("__new_note_attachments"."position") = 'integer' AND "__new_note_attachments"."position" BETWEEN 0 AND 9)),
	CONSTRAINT "note_attachments_filename_length" CHECK(length(trim("__new_note_attachments"."filename")) BETWEEN 1 AND 255),
	CONSTRAINT "note_attachments_media_type_length" CHECK(length(trim("__new_note_attachments"."media_type")) BETWEEN 1 AND 255),
	CONSTRAINT "note_attachments_storage_path_length" CHECK(length("__new_note_attachments"."storage_path") BETWEEN 1 AND 1024),
	CONSTRAINT "note_attachments_byte_size_nonnegative" CHECK("__new_note_attachments"."byte_size" >= 0),
	CONSTRAINT "note_attachments_modified_at_nonnegative" CHECK("__new_note_attachments"."modified_at" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_note_attachments`("id", "draft_chat_id", "position", "note_id", "filename", "media_type", "storage_path", "byte_size", "modified_at", "created_at") SELECT "id", NULL, NULL, "note_id", "filename", "media_type", "storage_path", "byte_size", "modified_at", "created_at" FROM `note_attachments`;--> statement-breakpoint
DROP TABLE `note_attachments`;--> statement-breakpoint
ALTER TABLE `__new_note_attachments` RENAME TO `note_attachments`;--> statement-breakpoint
CREATE UNIQUE INDEX `note_attachments_storage_path_unique` ON `note_attachments` (`storage_path`);--> statement-breakpoint
CREATE INDEX `note_attachments_draft_idx` ON `note_attachments` (`draft_chat_id`,`position`);--> statement-breakpoint
CREATE INDEX `note_attachments_note_idx` ON `note_attachments` (`note_id`,`created_at`,`id`);
--> statement-breakpoint
UPDATE app_metadata SET schema_version = 15 WHERE id = 1;
