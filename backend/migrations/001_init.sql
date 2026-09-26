CREATE TABLE IF NOT EXISTS games (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  status            text        NOT NULL DEFAULT 'waiting'
                                CHECK (status IN ('waiting','active','finished')),
  black_name        text        NOT NULL,
  white_name        text,
  black_token_hash  text        NOT NULL,          -- sha256 hex of playerToken
  white_token_hash  text,
  board             char(64)    NOT NULL,          -- current position, boardToString()
  turn              char(1)     CHECK (turn IN ('B','W')),  -- NULL unless active
  black_count       smallint    NOT NULL DEFAULT 2,
  white_count       smallint    NOT NULL DEFAULT 2,
  winner            text        CHECK (winner IN ('B','W','draw')),
  end_reason        text        CHECK (end_reason IN ('normal','resign')),
  analysis_status   text        NOT NULL DEFAULT 'none'
                                CHECK (analysis_status IN ('none','pending','running','done','failed')),
  analysis_error    text,
  analyzed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,                   -- set on join
  finished_at       timestamptz
);

CREATE INDEX IF NOT EXISTS games_finished_idx
  ON games (finished_at DESC) WHERE status = 'finished';

CREATE TABLE IF NOT EXISTS moves (
  game_id         uuid        NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ply             smallint    NOT NULL CHECK (ply >= 1),
  player          char(1)     NOT NULL CHECK (player IN ('B','W')),
  square          smallint    CHECK (square BETWEEN 0 AND 63),   -- NULL = pass
  flipped         smallint[]  NOT NULL DEFAULT '{}',
  board_after     char(64)    NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- ---- analysis: NULL until the AnalysisRunner writes this row ----
  eval_before     real,                                        -- Black POV, discs
  eval_after      real,                                        -- Black POV, discs
  loss            real        CHECK (loss >= 0),               -- mover POV
  best_square     smallint    CHECK (best_square BETWEEN 0 AND 63),
  classification  text        CHECK (classification IN
                              ('best','good','inaccuracy','mistake','blunder','forced')),
  is_blunder      boolean     GENERATED ALWAYS AS (classification = 'blunder') STORED,
  candidates      jsonb,                                       -- CandidateMove[] (top 3)
  motifs          text[]      NOT NULL DEFAULT '{}',
  search_depth    smallint,
  is_exact        boolean,

  PRIMARY KEY (game_id, ply)
);
