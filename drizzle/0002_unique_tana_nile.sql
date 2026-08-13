CREATE TABLE `actor_profiles` (
	`actor_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`avatar` text NOT NULL,
	`rating` integer DEFAULT 0 NOT NULL,
	`ratings_count` integer DEFAULT 0 NOT NULL,
	`completed_sales` integer DEFAULT 0 NOT NULL,
	`completed_purchases` integer DEFAULT 0 NOT NULL,
	`is_verified` integer DEFAULT false NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `return_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`requester_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`requested_at` text NOT NULL,
	`decided_at` text,
	`received_at` text,
	`refunded_at` text
);
--> statement-breakpoint
CREATE INDEX `return_cases_transaction_idx` ON `return_cases` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `return_cases_status_idx` ON `return_cases` (`status`);--> statement-breakpoint
CREATE TABLE `support_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text,
	`reporter_id` text NOT NULL,
	`category` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`evidence` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `support_tickets_reporter_idx` ON `support_tickets` (`reporter_id`);--> statement-breakpoint
CREATE INDEX `support_tickets_status_idx` ON `support_tickets` (`status`);--> statement-breakpoint
CREATE TABLE `transaction_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`body` text NOT NULL,
	`read_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `transaction_messages_transaction_idx` ON `transaction_messages` (`transaction_id`);