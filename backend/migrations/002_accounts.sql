-- Optional accounts. Identity is Supabase Auth; this row is our profile for that user.
-- No FK to auth.users: locally the auth database is a different Postgres entirely.
CREATE TABLE IF NOT EXISTS accounts (
  id          uuid        PRIMARY KEY,                -- Supabase auth user id (JWT `sub`)
  username    text        NOT NULL CHECK (username ~ '^[A-Za-z0-9_]{3,20}$'),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_username_lower_idx ON accounts (lower(username));

-- A seat is claimed by a guest (account id NULL) or an account. Seat tokens stay the
-- in-game credential either way; the account id is who that seat belongs to.
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS black_account_id uuid REFERENCES accounts(id),
  ADD COLUMN IF NOT EXISTS white_account_id uuid REFERENCES accounts(id);

CREATE INDEX IF NOT EXISTS games_black_account_idx
  ON games (black_account_id, created_at DESC) WHERE black_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS games_white_account_idx
  ON games (white_account_id, created_at DESC) WHERE white_account_id IS NOT NULL;
