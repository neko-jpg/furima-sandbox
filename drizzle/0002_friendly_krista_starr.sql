CREATE INDEX `idx_agent_actions_run_created` ON `agent_actions` (`run_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_agent_runs_world_status` ON `agent_runs` (`world_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_ledger_entries_wallet_created` ON `ledger_entries` (`wallet_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ledger_entries_transaction` ON `ledger_entries` (`transaction_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_wallets_world_owner` ON `wallets` (`world_id`,`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_world_events_world_occurred` ON `world_events` (`world_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_world_events_correlation` ON `world_events` (`correlation_id`);--> statement-breakpoint
PRAGMA optimize;
