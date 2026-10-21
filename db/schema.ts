import { pgTable, serial, text, integer, bigint } from "drizzle-orm/pg-core";

// Property names mirror the column names so API responses keep the shape the frontend expects.
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const services = pgTable("services", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  image_url: text("image_url").notNull().default(""),
  position: integer("position").notNull().default(0),
});

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  location: text("location").notNull(),
  description: text("description").notNull(),
  image_url: text("image_url").notNull().default(""),
  featured: integer("featured").notNull().default(0),
});

export const enquiries = pgTable("enquiries", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull().default(""),
  project_type: text("project_type").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("New"),
  created_at: text("created_at").notNull(),
});

export const sessions = pgTable("sessions", {
  token_hash: text("token_hash").primaryKey(),
  csrf_token: text("csrf_token").notNull(),
  expires_at: bigint("expires_at", { mode: "number" }).notNull(),
});

export const loginAttempts = pgTable("login_attempts", {
  ip: text("ip").primaryKey(),
  count: integer("count").notNull(),
  until: bigint("until", { mode: "number" }).notNull(),
});
