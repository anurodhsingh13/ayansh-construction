-- Seed the default site settings and services that the original SQLite server created on first start.
INSERT INTO "settings" ("key", "value") VALUES
  ('business_name', 'Ayansh Construction'),
  ('owner', 'Brijendra Singh Chauhan'),
  ('location', 'Lucknow'),
  ('phone', '9450559009'),
  ('email', ''),
  ('about_text', 'We bring clarity to every stage of a build—from the first conversation and careful planning to skilled workmanship and a considered handover. Our focus is straightforward communication, thoughtful details, and dependable delivery.')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "services" ("title", "description", "image_url", "position") VALUES
  ('Residential construction', 'Thoughtfully planned homes, built around the way you want to live.', 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1000&q=85', 0),
  ('Commercial construction', 'Practical, welcoming spaces designed for teams, customers, and growth.', 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1000&q=85', 1),
  ('Renovation and refurbishment', 'Give an existing space a new chapter with considered upgrades and care.', 'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1000&q=85', 2),
  ('Public sector and infrastructure', 'An open invitation to discuss public works and infrastructure needs.', 'https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=1000&q=85', 3);
