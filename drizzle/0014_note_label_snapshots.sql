CREATE TABLE `note_label_snapshots` (
	`note_id` text NOT NULL,
	`label` text NOT NULL,
	`name` text NOT NULL,
	`symbol` text,
	`position` integer NOT NULL,
	PRIMARY KEY(`note_id`, `label`),
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "note_label_snapshots_custom_id" CHECK(length("note_label_snapshots"."label") = 43 AND substr("note_label_snapshots"."label",1,7) = 'custom-'),
	CONSTRAINT "note_label_snapshots_bounds" CHECK(length("note_label_snapshots"."name") BETWEEN 1 AND 256 AND ("note_label_snapshots"."symbol" IS NULL OR length("note_label_snapshots"."symbol") BETWEEN 1 AND 64) AND typeof("note_label_snapshots"."position") = 'integer' AND "note_label_snapshots"."position" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
UPDATE app_metadata SET schema_version=14 WHERE id=1;
