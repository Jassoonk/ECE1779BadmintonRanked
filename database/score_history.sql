-- Store actual and corrected doubles match scores.
ALTER TABLE doubles_matches
ADD COLUMN IF NOT EXISTS team1_score INTEGER;

ALTER TABLE doubles_matches
ADD COLUMN IF NOT EXISTS team2_score INTEGER;

ALTER TABLE doubles_matches
ADD COLUMN IF NOT EXISTS corrected_team1_score INTEGER;

ALTER TABLE doubles_matches
ADD COLUMN IF NOT EXISTS corrected_team2_score INTEGER;
-- Allow a corrected score to wait for the original submitter.
ALTER TABLE doubles_matches
DROP CONSTRAINT IF EXISTS doubles_matches_status_check;

ALTER TABLE doubles_matches
ADD CONSTRAINT doubles_matches_status_check
CHECK (status IN (
  'active',
  'pending_confirmation',
  'pending_correction',
  'completed'
));
