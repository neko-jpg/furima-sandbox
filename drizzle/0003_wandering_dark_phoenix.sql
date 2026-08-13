CREATE TABLE `world_snapshots` (
	`world_id` text PRIMARY KEY NOT NULL,
	`state_version` integer DEFAULT 0 NOT NULL,
	`marketplace_state` text DEFAULT '{}' NOT NULL,
	`sandbox_state` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
