CREATE TABLE `sandbox_command_records` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`sandbox_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`command` text NOT NULL,
	`mode` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_id` text,
	`command_id` text,
	`payload_hash` text NOT NULL,
	`state_version_before` integer NOT NULL,
	`state_version_after` integer NOT NULL,
	`status` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_command_records_idempotency_idx` ON `sandbox_command_records` (`sandbox_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `sandbox_command_records_sandbox_idx` ON `sandbox_command_records` (`sandbox_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sandbox_preview_records` (
	`preview_id` text PRIMARY KEY NOT NULL,
	`sandbox_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`command` text NOT NULL,
	`payload_json` text NOT NULL,
	`payload_hash` text NOT NULL,
	`base_state_version` integer NOT NULL,
	`summary_json` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`virtual_expires_at` text NOT NULL,
	`retention_expires_at` text NOT NULL,
	`committed_operation_id` text
);
--> statement-breakpoint
CREATE INDEX `sandbox_preview_records_sandbox_idx` ON `sandbox_preview_records` (`sandbox_id`,`status`);--> statement-breakpoint
CREATE INDEX `sandbox_preview_records_retention_idx` ON `sandbox_preview_records` (`retention_expires_at`);