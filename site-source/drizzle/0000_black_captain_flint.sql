CREATE TABLE `analysis_history` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_type` text NOT NULL,
	`slides_url` text,
	`image_count` integer DEFAULT 0 NOT NULL,
	`result_json` text NOT NULL,
	`media_json` text DEFAULT '[]' NOT NULL,
	`usage_input` integer DEFAULT 0 NOT NULL,
	`usage_output` integer DEFAULT 0 NOT NULL,
	`usage_total` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analysis_history_user_created_idx` ON `analysis_history` (`user_id`,`created_at`);