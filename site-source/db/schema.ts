import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const analysisHistory = sqliteTable("analysis_history", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sourceType: text("source_type").notNull(),
  slidesUrl: text("slides_url"),
  imageCount: integer("image_count").notNull().default(0),
  resultJson: text("result_json").notNull(),
  mediaJson: text("media_json").notNull().default("[]"),
  usageInput: integer("usage_input").notNull().default(0),
  usageOutput: integer("usage_output").notNull().default(0),
  usageTotal: integer("usage_total").notNull().default(0),
  usageCached: integer("usage_cached").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("analysis_history_user_created_idx").on(table.userId, table.createdAt),
]);
