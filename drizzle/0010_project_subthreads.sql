ALTER TABLE chats ADD COLUMN project_id text REFERENCES chats(id) ON DELETE CASCADE CONSTRAINT chats_project_not_self CHECK(project_id IS NULL OR project_id != id);
--> statement-breakpoint
CREATE INDEX chats_project_idx ON chats(project_id);
--> statement-breakpoint
CREATE TABLE subthread_origins (
  chat_id text PRIMARY KEY NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  source_chat_id text REFERENCES chats(id) ON DELETE SET NULL,
  source_note_id text REFERENCES notes(id) ON DELETE SET NULL,
  CONSTRAINT subthread_origin_not_self CHECK(source_chat_id IS NULL OR source_chat_id != chat_id)
);
--> statement-breakpoint
CREATE INDEX subthread_origins_source_chat_idx ON subthread_origins(source_chat_id);
--> statement-breakpoint
CREATE INDEX subthread_origins_source_note_idx ON subthread_origins(source_note_id);
--> statement-breakpoint
UPDATE app_metadata SET schema_version=10 WHERE id=1;
