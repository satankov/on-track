CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`accent` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "chats_title_length" CHECK(length(trim("chats"."title")) BETWEEN 1 AND 80),
	CONSTRAINT "chats_accent_allowed" CHECK(accent IN ('coral', 'amber', 'moss', 'ocean', 'iris', 'slate'))
);
--> statement-breakpoint
CREATE INDEX `chats_activity_idx` ON `chats` (`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notes_body_length" CHECK(length(trim("notes"."body")) BETWEEN 1 AND 10000)
);
--> statement-breakpoint
CREATE INDEX `notes_chat_history_idx` ON `notes` (`chat_id`,`created_at`,`id`);