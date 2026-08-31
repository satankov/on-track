CREATE TABLE `app_metadata` (
	`id` integer PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	CONSTRAINT "app_metadata_single_row" CHECK("app_metadata"."id" = 1),
	CONSTRAINT "app_metadata_version_positive" CHECK("app_metadata"."schema_version" >= 1)
);
--> statement-breakpoint
INSERT INTO `app_metadata` (`id`, `schema_version`) VALUES (1, 1);
