CREATE TABLE `domain_events` (
	`id` text PRIMARY KEY NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`type` text NOT NULL,
	`actor_id` text NOT NULL,
	`correlation_id` text NOT NULL,
	`state_version` integer NOT NULL,
	`payload` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `domain_events_aggregate_idx` ON `domain_events` (`aggregate_type`,`aggregate_id`);--> statement-breakpoint
CREATE INDEX `domain_events_correlation_idx` ON `domain_events` (`correlation_id`);--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`type` text NOT NULL,
	`quantity` integer NOT NULL,
	`reason` text NOT NULL,
	`reference_id` text,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inventory_movements_listing_idx` ON `inventory_movements` (`listing_id`);--> statement-breakpoint
CREATE TABLE `listings` (
	`id` text PRIMARY KEY NOT NULL,
	`seller_id` text NOT NULL,
	`sku` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`price` integer NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`reserved_quantity` integer DEFAULT 0 NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listings_sku_unique_idx` ON `listings` (`sku`);--> statement-breakpoint
CREATE INDEX `listings_status_idx` ON `listings` (`status`);--> statement-breakpoint
CREATE INDEX `listings_seller_idx` ON `listings` (`seller_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`status` text NOT NULL,
	`method` text NOT NULL,
	`amount` integer NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payments_transaction_idx` ON `payments` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `sandbox_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`event_id` text,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sandbox_notifications_actor_idx` ON `sandbox_notifications` (`actor_id`);--> statement-breakpoint
CREATE TABLE `sandbox_users` (
	`id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`name` text NOT NULL,
	`authenticated` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sandbox_users_role_idx` ON `sandbox_users` (`role`);--> statement-breakpoint
CREATE TABLE `shipments` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`status` text NOT NULL,
	`tracking_number` text,
	`method` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shipments_transaction_idx` ON `shipments` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`buyer_id` text NOT NULL,
	`seller_id` text NOT NULL,
	`status` text NOT NULL,
	`price_snapshot` integer NOT NULL,
	`total` integer NOT NULL,
	`reservation_id` text NOT NULL,
	`payment_id` text NOT NULL,
	`shipment_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_order_unique_idx` ON `transactions` (`order_id`);--> statement-breakpoint
CREATE INDEX `transactions_buyer_idx` ON `transactions` (`buyer_id`);--> statement-breakpoint
CREATE INDEX `transactions_seller_idx` ON `transactions` (`seller_id`);--> statement-breakpoint
CREATE INDEX `transactions_status_idx` ON `transactions` (`status`);