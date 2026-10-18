import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const workspaces = sqliteTable('workspaces', { id: text('id').primaryKey(), data: text('data').notNull(), version: integer('version').notNull().default(0), mutation: text('mutation') });
export const reviewEvents = sqliteTable('review_events', { id: text('id').primaryKey(), workspace: text('workspace').notNull(), data: text('data').notNull() });
export const users = sqliteTable('users', { id: text('id').primaryKey(), email: text('email').notNull().unique(), name: text('name').notNull(), password: text('password').notNull(), workspace: text('workspace').notNull().unique(), failures: integer('failures').notNull().default(0), locked: integer('locked').notNull().default(0), created: integer('created').notNull() });
export const sessions = sqliteTable('sessions', { id: text('id').primaryKey(), user: text('user').notNull(), expires: integer('expires').notNull() });
