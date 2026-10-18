import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const workspaces = sqliteTable('workspaces', { id: text('id').primaryKey(), data: text('data').notNull(), version: integer('version').notNull().default(0), mutation: text('mutation') });
export const reviewEvents = sqliteTable('review_events', { id: text('id').primaryKey(), workspace: text('workspace').notNull(), data: text('data').notNull() });
