ALTER TABLE chats ADD COLUMN accent_style text NOT NULL DEFAULT 'plain'
  CONSTRAINT chats_accent_style_allowed CHECK (accent_style IN ('plain', 'gradient'));
--> statement-breakpoint
UPDATE app_metadata SET schema_version = 13 WHERE id = 1;
