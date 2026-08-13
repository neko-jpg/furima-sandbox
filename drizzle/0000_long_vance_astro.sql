CREATE TABLE `addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`label` text NOT NULL,
	`postal_code` text NOT NULL,
	`prefecture` text NOT NULL,
	`city` text NOT NULL,
	`line1` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auctions` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`start_price` integer NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text NOT NULL,
	`highest_bid_id` text,
	`winner_id` text,
	`purchase_deadline` text
);
--> statement-breakpoint
CREATE TABLE `bids` (
	`id` text PRIMARY KEY NOT NULL,
	`auction_id` text NOT NULL,
	`bidder_id` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `blocks` (
	`blocker_id` text NOT NULL,
	`blocked_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`blocker_id`, `blocked_id`)
);
--> statement-breakpoint
CREATE TABLE `bundle_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`buyer_id` text NOT NULL,
	`seller_id` text NOT NULL,
	`listing_ids` text NOT NULL,
	`requested_total_price` integer NOT NULL,
	`status` text NOT NULL,
	`expires_at` text NOT NULL,
	`bundle_listing_id` text
);
--> statement-breakpoint
CREATE TABLE `cancellation_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`reason` text NOT NULL,
	`reason_detail` text DEFAULT '' NOT NULL,
	`return_required` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`responded_at` text
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_id` text
);
--> statement-breakpoint
CREATE TABLE `category_attribute_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`required` integer DEFAULT false NOT NULL,
	`options` text
);
--> statement-breakpoint
CREATE TABLE `checkout_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`buyer_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`payment_method_id` text NOT NULL,
	`shipping_address_id` text NOT NULL,
	`points_used` integer DEFAULT 0 NOT NULL,
	`item_price` integer NOT NULL,
	`payment_fee` integer DEFAULT 0 NOT NULL,
	`shipping_charge` integer DEFAULT 0 NOT NULL,
	`discount` integer DEFAULT 0 NOT NULL,
	`total` integer NOT NULL,
	`listing_version` integer NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `collection_items` (
	`collection_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`collection_id`, `listing_id`)
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `disputes` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`opened_by` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`attachments` text DEFAULT '[]' NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `follows` (
	`follower_id` text NOT NULL,
	`followed_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`follower_id`, `followed_user_id`)
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`condition` text NOT NULL,
	`defect_description` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `likes` (
	`user_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `listing_id`)
);
--> statement-breakpoint
CREATE TABLE `listing_attributes` (
	`listing_id` text NOT NULL,
	`definition_id` text NOT NULL,
	`value` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`listing_id`, `definition_id`)
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `listing_images` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`url` text NOT NULL,
	`sort_order` integer NOT NULL,
	`width` integer,
	`height` integer
);
--> statement-breakpoint
CREATE TABLE `listing_revisions` (
	`listing_id` text NOT NULL,
	`version` integer NOT NULL,
	`changed_fields` text NOT NULL,
	`changed_at` text NOT NULL,
	PRIMARY KEY(`listing_id`, `version`)
);
--> statement-breakpoint
CREATE TABLE `listings` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`seller_id` text NOT NULL,
	`category_id` text NOT NULL,
	`brand_id` text,
	`attributes` text DEFAULT '{}' NOT NULL,
	`price` integer NOT NULL,
	`sale_type` text DEFAULT 'FIXED_PRICE' NOT NULL,
	`shipping_payer` text NOT NULL,
	`shipping_method` text NOT NULL,
	`shipping_origin` text NOT NULL,
	`shipping_days` integer NOT NULL,
	`package_size` text NOT NULL,
	`is_anonymous` integer DEFAULT true NOT NULL,
	`status` text NOT NULL,
	`availability` text DEFAULT 'AVAILABLE' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`views_count` integer DEFAULT 0 NOT NULL,
	`search_count` integer DEFAULT 0 NOT NULL,
	`likes_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`published_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `moderation_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`reason` text NOT NULL,
	`reported_by` text NOT NULL,
	`status` text NOT NULL,
	`action` text
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payment_methods` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`method` text NOT NULL,
	`amount` integer NOT NULL,
	`fee` integer DEFAULT 0 NOT NULL,
	`points_used` integer DEFAULT 0 NOT NULL,
	`balance_used` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`paid_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `price_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`buyer_id` text NOT NULL,
	`requested_price` integer NOT NULL,
	`status` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ratings` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`from_user_id` text NOT NULL,
	`to_user_id` text NOT NULL,
	`rating` integer NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`payment_id` text NOT NULL,
	`amount` integer NOT NULL,
	`type` text NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`category` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `returns` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`reason` text NOT NULL,
	`shipping_method` text,
	`tracking_number` text,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `saved_items` (
	`user_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `listing_id`)
);
--> statement-breakpoint
CREATE TABLE `saved_searches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`query` text NOT NULL,
	`filters` text DEFAULT '{}' NOT NULL,
	`notification_enabled` integer DEFAULT true NOT NULL,
	`notification_frequency` text DEFAULT 'INSTANT' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `seller_proceeds` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`seller_id` text NOT NULL,
	`gross` integer NOT NULL,
	`platform_fee` integer NOT NULL,
	`shipping_fee` integer NOT NULL,
	`adjustments` integer DEFAULT 0 NOT NULL,
	`net` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shipments` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`carrier` text NOT NULL,
	`service` text NOT NULL,
	`tracking_number` text,
	`package_size` text NOT NULL,
	`shipping_fee` integer NOT NULL,
	`sender_pays` integer NOT NULL,
	`anonymous` integer NOT NULL,
	`origin` text NOT NULL,
	`destination` text NOT NULL,
	`status` text NOT NULL,
	`shipped_at` text,
	`delivered_at` text
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`entity_id` text NOT NULL,
	`due_at` text,
	`completed_at` text
);
--> statement-breakpoint
CREATE TABLE `transaction_events` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`type` text NOT NULL,
	`actor_id` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transaction_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`body` text NOT NULL,
	`attachments` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`seller_id` text NOT NULL,
	`buyer_id` text NOT NULL,
	`transaction_status` text NOT NULL,
	`payment_status` text NOT NULL,
	`fulfillment_status` text NOT NULL,
	`buyer_rating_status` text NOT NULL,
	`seller_rating_status` text NOT NULL,
	`dispute_status` text NOT NULL,
	`checkout_id` text NOT NULL,
	`payment_id` text NOT NULL,
	`shipment_id` text NOT NULL,
	`shipping_address_snapshot` text NOT NULL,
	`expected_listing_version` integer NOT NULL,
	`item_price` integer NOT NULL,
	`platform_fee` integer NOT NULL,
	`shipping_fee` integer NOT NULL,
	`total` integer NOT NULL,
	`shipping_deadline` text NOT NULL,
	`completed_at` text,
	`canceled_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`notification_enabled` integer DEFAULT true NOT NULL,
	`language` text DEFAULT 'ja' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`avatar` text DEFAULT '' NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`identity_verification_status` text DEFAULT 'UNVERIFIED' NOT NULL,
	`phone_verified` integer DEFAULT false NOT NULL,
	`rating_average` real DEFAULT 0 NOT NULL,
	`rating_count` integer DEFAULT 0 NOT NULL,
	`seller_level` integer DEFAULT 1 NOT NULL,
	`sales_balance` integer DEFAULT 0 NOT NULL,
	`points` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
