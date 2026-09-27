-- The organizer can end a tournament before it has a champion. Games still in progress are
-- force-ended with no winner and end_reason 'cancelled'. Cancelled tournaments are never deleted.
ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_status_check;
ALTER TABLE tournaments ADD CONSTRAINT tournaments_status_check
  CHECK (status IN ('registering','active','finished','cancelled'));

ALTER TABLE games DROP CONSTRAINT IF EXISTS games_end_reason_check;
ALTER TABLE games ADD CONSTRAINT games_end_reason_check
  CHECK (end_reason IN ('normal','resign','forfeit','cancelled'));
