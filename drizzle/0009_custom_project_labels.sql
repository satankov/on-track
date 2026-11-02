CREATE TABLE `project_labels` (
	`chat_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`symbol` text,
	`enabled` integer NOT NULL,
	`position` integer NOT NULL,
	`builtin` integer NOT NULL,
	PRIMARY KEY(`chat_id`, `id`),
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_labels_bounds" CHECK(length("project_labels"."name") BETWEEN 1 AND 256 AND length("project_labels"."name_key") BETWEEN 1 AND 256 AND ("project_labels"."symbol" IS NULL OR length("project_labels"."symbol") BETWEEN 1 AND 64) AND "project_labels"."enabled" IN (0,1) AND "project_labels"."builtin" IN (0,1) AND "project_labels"."position" >= 0 AND "project_labels"."position" <= 9007199254740991),
	CONSTRAINT "project_labels_kind" CHECK(("project_labels"."builtin" = 1 AND "project_labels"."id" IN ('pin','attention','todo','decision','open-question','risk','milestone')) OR ("project_labels"."builtin" = 0 AND length("project_labels"."id") = 43 AND substr("project_labels"."id",1,7) = 'custom-')),
	CONSTRAINT "project_labels_permanent" CHECK(("project_labels"."id" NOT IN ('pin','attention')) OR ("project_labels"."enabled" = 1 AND (("project_labels"."id" = 'pin' AND "project_labels"."position" = 0) OR ("project_labels"."id" = 'attention' AND "project_labels"."position" = 1))))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_labels_name` ON `project_labels` (`chat_id`,`name_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_labels_position` ON `project_labels` (`chat_id`,`position`);--> statement-breakpoint
WITH builtins(id, name, symbol, position) AS (VALUES
 ('pin','Pin',NULL,0), ('attention','Attention',NULL,1), ('todo','Todo',NULL,2),
 ('decision','Decision',NULL,3), ('open-question','Open question',NULL,4),
 ('risk','Risk','⚠️',5), ('milestone','Milestone','🎖️',6))
INSERT INTO project_labels(chat_id,id,name,name_key,symbol,enabled,position,builtin)
SELECT chats.id,builtins.id,builtins.name,lower(builtins.name),builtins.symbol,
 CASE WHEN builtins.position < 2 OR EXISTS(SELECT 1 FROM chat_enabled_labels e WHERE e.chat_id=chats.id AND e.label=builtins.id) THEN 1 ELSE 0 END,
 builtins.position,1 FROM chats CROSS JOIN builtins;
--> statement-breakpoint
ALTER TABLE chats ADD COLUMN label_configuration_revision integer NOT NULL DEFAULT 0 CONSTRAINT chats_label_revision CHECK(label_configuration_revision >= 0 AND label_configuration_revision <= 9007199254740991);
--> statement-breakpoint
CREATE UNIQUE INDEX notes_project_identity ON notes(id,chat_id);
--> statement-breakpoint
CREATE TABLE `__new_note_labels` (
	`note_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`label` text NOT NULL,
	PRIMARY KEY(`note_id`, `label`),
	FOREIGN KEY (`note_id`,`chat_id`) REFERENCES `notes`(`id`,`chat_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`,`label`) REFERENCES `project_labels`(`chat_id`,`id`) ON UPDATE no action ON DELETE cascade
);

--> statement-breakpoint
INSERT INTO __new_note_labels(note_id,chat_id,label) SELECT l.note_id,n.chat_id,l.label FROM note_labels l JOIN notes n ON n.id=l.note_id;
--> statement-breakpoint
DROP TABLE note_labels;
--> statement-breakpoint
ALTER TABLE __new_note_labels RENAME TO note_labels;
--> statement-breakpoint
DROP TABLE chat_enabled_labels;
--> statement-breakpoint
UPDATE app_metadata SET schema_version=9 WHERE id=1;
