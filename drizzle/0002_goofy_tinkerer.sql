CREATE TABLE IF NOT EXISTS `note_search` (
	`workspace` text NOT NULL,
	`id` text NOT NULL,
	`content` text NOT NULL,
	PRIMARY KEY(`workspace`, `id`)
);
