ALTER TABLE `subthread_origins` ADD `source_note_created_at` integer;--> statement-breakpoint
ALTER TABLE `subthread_origins` ADD `source_note_position_id` text;
--> statement-breakpoint
UPDATE subthread_origins SET source_note_created_at = (SELECT created_at FROM notes WHERE id = source_note_id), source_note_position_id = source_note_id;
--> statement-breakpoint
UPDATE app_metadata SET schema_version=11 WHERE id=1;
