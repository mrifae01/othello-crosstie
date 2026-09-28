-- AI coach debriefs: one per (game, coached player, prompt version). Generated on demand and
-- cached, so each game costs at most one Claude call per player until the prompt changes.
-- Token counts are kept to track what coaching costs.
CREATE TABLE IF NOT EXISTS coach_debriefs (
  game_id         uuid        NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player          char(1)     NOT NULL CHECK (player IN ('B','W')),
  prompt_version  smallint    NOT NULL,
  model           text        NOT NULL,
  content         jsonb       NOT NULL,     -- headline, overview, strength, moments, takeaway
  input_tokens    integer,
  output_tokens   integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, player, prompt_version)
);

ALTER TABLE coach_debriefs ENABLE ROW LEVEL SECURITY;
