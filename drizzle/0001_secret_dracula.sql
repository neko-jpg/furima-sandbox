CREATE TABLE `agent_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`world_id` text NOT NULL,
	`run_id` text NOT NULL,
	`event_id` text,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`input` text DEFAULT '{}' NOT NULL,
	`output` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`world_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`correlation_id` text NOT NULL,
	`goal` text NOT NULL,
	`status` text NOT NULL,
	`budget` integer NOT NULL,
	`selected_item_id` text,
	`transaction_id` text,
	`result` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`world_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`configuration` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`world_id` text NOT NULL,
	`wallet_id` text NOT NULL,
	`transaction_id` text,
	`correlation_id` text NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`description` text NOT NULL,
	`balance_after` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wallets` (
	`id` text PRIMARY KEY NOT NULL,
	`world_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`owner_type` text NOT NULL,
	`available_balance` integer DEFAULT 0 NOT NULL,
	`escrow_balance` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `world_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`world_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_type` text NOT NULL,
	`target_id` text,
	`caused_by` text,
	`correlation_id` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `worlds` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`seed` integer NOT NULL,
	`status` text DEFAULT 'PAUSED' NOT NULL,
	`speed` integer DEFAULT 1 NOT NULL,
	`simulated_at` text NOT NULL,
	`tick` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
