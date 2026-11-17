ALTER TABLE chats ADD COLUMN manual_alert integer NOT NULL DEFAULT 0
  CONSTRAINT chats_manual_alert_boolean CHECK (manual_alert IN (0,1));
--> statement-breakpoint
ALTER TABLE workspace_preferences ADD COLUMN always_show_message_time integer NOT NULL DEFAULT 1
  CONSTRAINT workspace_preferences_message_time_boolean CHECK (always_show_message_time IN (0,1));
--> statement-breakpoint
UPDATE app_metadata SET schema_version = 12 WHERE id = 1;
