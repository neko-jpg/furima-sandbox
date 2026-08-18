CREATE TABLE `sandbox_command_records_scoped` (
	`operation_id` text NOT NULL,
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
	`expires_at` text NOT NULL,
	PRIMARY KEY(`sandbox_id`, `operation_id`)
);
--> statement-breakpoint
INSERT INTO `sandbox_command_records_scoped` (`operation_id`, `sandbox_id`, `actor_id`, `command`, `mode`, `idempotency_key`, `request_id`, `command_id`, `payload_hash`, `state_version_before`, `state_version_after`, `status`, `result_json`, `created_at`, `expires_at`)
SELECT `operation_id`, `sandbox_id`, `actor_id`, `command`, `mode`, `idempotency_key`, `request_id`, `command_id`, `payload_hash`, `state_version_before`, `state_version_after`, `status`, `result_json`, `created_at`, `expires_at`
FROM `sandbox_command_records`;
--> statement-breakpoint
DROP TABLE `sandbox_command_records`;
--> statement-breakpoint
ALTER TABLE `sandbox_command_records_scoped` RENAME TO `sandbox_command_records`;
--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_command_records_idempotency_idx` ON `sandbox_command_records` (`sandbox_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `sandbox_command_records_sandbox_idx` ON `sandbox_command_records` (`sandbox_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `sandbox_preview_records_scoped` (
	`preview_id` text NOT NULL,
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
	`committed_operation_id` text,
	PRIMARY KEY(`sandbox_id`, `preview_id`)
);
--> statement-breakpoint
INSERT INTO `sandbox_preview_records_scoped` (`preview_id`, `sandbox_id`, `actor_id`, `command`, `payload_json`, `payload_hash`, `base_state_version`, `summary_json`, `status`, `created_at`, `virtual_expires_at`, `retention_expires_at`, `committed_operation_id`)
SELECT `preview_id`, `sandbox_id`, `actor_id`, `command`, `payload_json`, `payload_hash`, `base_state_version`, `summary_json`, `status`, `created_at`, `virtual_expires_at`, `retention_expires_at`, `committed_operation_id`
FROM `sandbox_preview_records`;
--> statement-breakpoint
DROP TABLE `sandbox_preview_records`;
--> statement-breakpoint
ALTER TABLE `sandbox_preview_records_scoped` RENAME TO `sandbox_preview_records`;
--> statement-breakpoint
CREATE INDEX `sandbox_preview_records_sandbox_idx` ON `sandbox_preview_records` (`sandbox_id`,`status`);
--> statement-breakpoint
CREATE INDEX `sandbox_preview_records_retention_idx` ON `sandbox_preview_records` (`retention_expires_at`);
