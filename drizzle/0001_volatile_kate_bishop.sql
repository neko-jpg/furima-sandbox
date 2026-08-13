CREATE TABLE `auction_bids` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`bidder_id` text NOT NULL,
	`amount` integer NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auction_bids_listing_idx` ON `auction_bids` (`listing_id`);--> statement-breakpoint
CREATE INDEX `auction_bids_bidder_idx` ON `auction_bids` (`bidder_id`);--> statement-breakpoint
CREATE TABLE `purchase_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`buyer_id` text NOT NULL,
	`status` text NOT NULL,
	`quantity` integer NOT NULL,
	`quote` integer NOT NULL,
	`expires_at` text NOT NULL,
	`expected_state_version` integer NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `purchase_intents_buyer_idx` ON `purchase_intents` (`buyer_id`);--> statement-breakpoint
CREATE INDEX `purchase_intents_listing_idx` ON `purchase_intents` (`listing_id`);--> statement-breakpoint
CREATE INDEX `purchase_intents_status_idx` ON `purchase_intents` (`status`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`reviewer_id` text NOT NULL,
	`reviewee_id` text NOT NULL,
	`rating` integer NOT NULL,
	`comment` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reviews_transaction_idx` ON `reviews` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `reviews_reviewee_idx` ON `reviews` (`reviewee_id`);--> statement-breakpoint
CREATE TABLE `sandbox_states` (
	`id` text PRIMARY KEY NOT NULL,
	`scenario_id` text NOT NULL,
	`seed` text NOT NULL,
	`state_version` integer NOT NULL,
	`virtual_now` text NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sandbox_states_scenario_idx` ON `sandbox_states` (`scenario_id`);--> statement-breakpoint
CREATE TABLE `wallets` (
	`actor_id` text PRIMARY KEY NOT NULL,
	`available_balance` integer DEFAULT 0 NOT NULL,
	`held_balance` integer DEFAULT 0 NOT NULL,
	`points` integer DEFAULT 0 NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL
);
