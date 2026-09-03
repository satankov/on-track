CREATE TABLE `chat_enabled_labels` (
	`chat_id` text NOT NULL,
	`label` text NOT NULL,
	PRIMARY KEY(`chat_id`, `label`),
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chat_enabled_labels_label_allowed" CHECK(`label` IN ('todo', 'decision', 'open-question', 'risk', 'milestone'))
);
--> statement-breakpoint
CREATE TABLE `note_labels` (
	`note_id` text NOT NULL,
	`label` text NOT NULL,
	PRIMARY KEY(`note_id`, `label`),
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "note_labels_label_allowed" CHECK(`label` IN ('pin', 'attention', 'todo', 'decision', 'open-question', 'risk', 'milestone'))
);
--> statement-breakpoint
INSERT INTO `chat_enabled_labels` (`chat_id`, `label`)
	SELECT `id`, 'todo' FROM `chats`;
--> statement-breakpoint
INSERT INTO `chat_enabled_labels` (`chat_id`, `label`)
	SELECT `id`, 'milestone' FROM `chats`;
--> statement-breakpoint
UPDATE `app_metadata` SET `schema_version` = 3 WHERE `id` = 1;
