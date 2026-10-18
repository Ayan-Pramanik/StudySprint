CREATE TABLE IF NOT EXISTS `backup_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace` text NOT NULL,
	`object_key` text NOT NULL,
	`upload_id` text NOT NULL,
	`name` text NOT NULL,
	`size` integer NOT NULL,
	`parts` text DEFAULT '[]' NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`original_key` text NOT NULL,
	`media_type` text NOT NULL,
	`size` integer NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`new_subject` text DEFAULT '' NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`note_id` text,
	`error` text,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `import_jobs_workspace` ON `import_jobs` (`workspace`,`created`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `note_revisions` (
	`workspace` text NOT NULL,
	`note` text NOT NULL,
	`version` integer NOT NULL,
	`body` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`workspace`, `note`, `version`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `note_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace` text NOT NULL,
	`note` text NOT NULL,
	`original_key` text NOT NULL,
	`preview_key` text,
	`name` text NOT NULL,
	`media_type` text NOT NULL,
	`size` integer NOT NULL,
	`preview_type` text NOT NULL,
	`derived_preview` integer DEFAULT 0 NOT NULL,
	`ocr` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `sources_note` ON `note_sources` (`workspace`,`note`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sources_workspace` ON `note_sources` (`workspace`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `notes` (
	`workspace` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	`body` text NOT NULL,
	`hash` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`workspace`, `id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `restore_notes` (
	`job` text NOT NULL,
	`workspace` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	`body` text NOT NULL,
	`hash` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`job`, `id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `restore_revisions` (
	`job` text NOT NULL,
	`workspace` text NOT NULL,
	`note` text NOT NULL,
	`version` integer NOT NULL,
	`body` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`job`, `note`, `version`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `restore_sources` (
	`job` text NOT NULL,
	`id` text NOT NULL,
	`workspace` text NOT NULL,
	`note` text NOT NULL,
	`original_key` text NOT NULL,
	`preview_key` text,
	`name` text NOT NULL,
	`media_type` text NOT NULL,
	`size` integer NOT NULL,
	`preview_type` text NOT NULL,
	`derived_preview` integer DEFAULT 0 NOT NULL,
	`ocr` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`job`, `id`)
);

--> statement-breakpoint
INSERT OR IGNORE INTO notes(workspace,id,data,body) SELECT w.id,json_extract(n.value,'$.id'),json_remove(n.value,'$.body','$.versions','$.source'),json_extract(n.value,'$.body') FROM workspaces w,json_each(w.data,'$.notes') n;
--> statement-breakpoint
INSERT OR IGNORE INTO note_revisions(workspace,note,version,body,at) SELECT w.id,json_extract(n.value,'$.id'),json_extract(v.value,'$.version'),json_extract(v.value,'$.body'),json_extract(v.value,'$.at') FROM workspaces w,json_each(w.data,'$.notes') n,json_each(n.value,'$.versions') v;
--> statement-breakpoint
UPDATE workspaces SET data=json_set(data,'$.notes',json('[]'));
