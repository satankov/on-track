CREATE TABLE `workspace_preferences` (
	`id` integer PRIMARY KEY NOT NULL,
	`theme` text DEFAULT 'light' NOT NULL,
	`show_examples` integer DEFAULT 1 NOT NULL,
	`collapsed_pinned` integer DEFAULT 0 NOT NULL,
	`collapsed_projects` integer DEFAULT 0 NOT NULL,
	`collapsed_archive` integer DEFAULT 0 NOT NULL,
	`collapsed_examples` integer DEFAULT 0 NOT NULL,
	`initialized` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "workspace_preferences_single_row" CHECK("workspace_preferences"."id" = 1),
	CONSTRAINT "workspace_preferences_theme" CHECK("workspace_preferences"."theme" IN ('light', 'neutral', 'dark')),
	CONSTRAINT "workspace_preferences_booleans" CHECK("workspace_preferences"."show_examples" IN (0,1) AND "workspace_preferences"."collapsed_pinned" IN (0,1) AND "workspace_preferences"."collapsed_projects" IN (0,1) AND "workspace_preferences"."collapsed_archive" IN (0,1) AND "workspace_preferences"."collapsed_examples" IN (0,1) AND "workspace_preferences"."initialized" IN (0,1))
);

--> statement-breakpoint
INSERT INTO workspace_preferences (id) VALUES (1);
--> statement-breakpoint
UPDATE app_metadata SET schema_version = 8 WHERE id = 1;
