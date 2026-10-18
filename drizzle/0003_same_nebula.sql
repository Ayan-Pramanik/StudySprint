CREATE TABLE IF NOT EXISTS `annotation_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace` text NOT NULL,
	`note` text NOT NULL,
	`hash` text NOT NULL,
	`result` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `annotation_operations_note` ON `annotation_operations` (`workspace`,`note`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `annotation_sets` (
	`base` text PRIMARY KEY NOT NULL,
	`workspace` text NOT NULL,
	`note` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`mutation` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `annotations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace` text NOT NULL,
	`note` text NOT NULL,
	`base` text NOT NULL,
	`data` text NOT NULL,
	`version` integer NOT NULL,
	`bytes` integer NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `annotations_note` ON `annotations` (`workspace`,`note`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `document_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace` text NOT NULL,
	`note` text NOT NULL,
	`job` text NOT NULL,
	`object_key` text NOT NULL,
	`data` text NOT NULL,
	`published` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `document_assets_note` ON `document_assets` (`workspace`,`note`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `document_bases` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace` text NOT NULL,
	`note` text NOT NULL,
	`job` text NOT NULL,
	`object_key` text NOT NULL,
	`data` text NOT NULL,
	`published` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `document_bases_note` ON `document_bases` (`workspace`,`note`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `document_files` (
	`object_key` text PRIMARY KEY NOT NULL,
	`workspace` text NOT NULL,
	`note` text NOT NULL,
	`job` text NOT NULL,
	`kind` text NOT NULL,
	`published` integer DEFAULT 0 NOT NULL,
	`expires` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `document_files_note` ON `document_files` (`workspace`,`note`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `document_files_job` ON `document_files` (`job`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `reconversions` (
	`job` text PRIMARY KEY NOT NULL,
	`workspace` text NOT NULL,
	`note` text NOT NULL,
	`expected_updated` text NOT NULL,
	`body_key` text NOT NULL,
	`conversion` text NOT NULL,
	`applied_version` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `restore_documents` (
	`job` text NOT NULL,
	`workspace` text NOT NULL,
	`note` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`object_key` text,
	`data` text NOT NULL,
	PRIMARY KEY(`job`, `kind`, `id`)
);
