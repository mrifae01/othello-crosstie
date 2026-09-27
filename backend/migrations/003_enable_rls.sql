-- On Supabase, every table in `public` is exposed through its Data API to anyone holding the
-- publishable key, which ships to every browser. All access here goes through our API, which
-- connects as the tables' owner (row-level security doesn't apply to owners). So: RLS on,
-- no policies. The Data API sees nothing; the app is unaffected. Harmless on plain Postgres.
ALTER TABLE games             ENABLE ROW LEVEL SECURITY;
ALTER TABLE moves             ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
