-- Single-elimination tournaments (2..8 players, accounts only).
CREATE TABLE IF NOT EXISTS tournaments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  organizer_id  uuid        NOT NULL REFERENCES accounts(id),   -- runs it; plays only if also entered
  status        text        NOT NULL DEFAULT 'registering'
                            CHECK (status IN ('registering','active','finished')),
  max_players   smallint    NOT NULL CHECK (max_players BETWEEN 2 AND 8),
  rounds        smallint    NOT NULL DEFAULT 0,                 -- log2(bracket size), set on start
  winner_id     uuid        REFERENCES accounts(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz
);

CREATE INDEX IF NOT EXISTS tournaments_created_idx ON tournaments (created_at DESC);

CREATE TABLE IF NOT EXISTS tournament_entries (
  tournament_id uuid        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  account_id    uuid        NOT NULL REFERENCES accounts(id),
  seed          smallint,                                       -- NULL until start
  joined_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, account_id)
);

-- Every match of the bracket is created on start; later rounds fill in as winners advance.
-- Status is derived: winner_id set → decided; game_id set → playing; else pending.
CREATE TABLE IF NOT EXISTS tournament_matches (
  tournament_id uuid        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round         smallint    NOT NULL CHECK (round >= 1),
  slot          smallint    NOT NULL CHECK (slot >= 0),
  black_id      uuid        REFERENCES accounts(id),
  white_id      uuid        REFERENCES accounts(id),
  game_id       uuid        UNIQUE REFERENCES games(id),
  winner_id     uuid        REFERENCES accounts(id),
  PRIMARY KEY (tournament_id, round, slot)
);

-- Tournament games are created with both seats assigned to accounts but no seat tokens yet:
-- each player claims theirs (POST /api/games/:id/seat) when they sit down.
ALTER TABLE games ALTER COLUMN black_token_hash DROP NOT NULL;

ALTER TABLE games DROP CONSTRAINT IF EXISTS games_end_reason_check;
ALTER TABLE games ADD CONSTRAINT games_end_reason_check CHECK (end_reason IN ('normal','resign','forfeit'));

ALTER TABLE tournaments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_matches ENABLE ROW LEVEL SECURITY;
