CREATE TABLE `review_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`mutation` text
);
