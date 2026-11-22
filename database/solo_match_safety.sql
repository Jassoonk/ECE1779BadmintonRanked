CREATE INDEX IF NOT EXISTS idx_solo_queue_joined
ON solo_queue(joined_at);

CREATE INDEX IF NOT EXISTS idx_solo_matches_player1
ON solo_matches(player1_id, status);

CREATE INDEX IF NOT EXISTS idx_solo_matches_player2
ON solo_matches(player2_id, status);

CREATE OR REPLACE FUNCTION prevent_duplicate_solo_match()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM solo_matches
        WHERE status IN ('active', 'pending_confirmation')
          AND (
              player1_id IN (NEW.player1_id, NEW.player2_id)
              OR player2_id IN (NEW.player1_id, NEW.player2_id)
          )
          AND id IS DISTINCT FROM NEW.id
    ) THEN
        RAISE EXCEPTION 'Player already has an active solo match';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_solo_match
ON solo_matches;

CREATE TRIGGER trg_prevent_duplicate_solo_match
BEFORE INSERT OR UPDATE ON solo_matches
FOR EACH ROW
EXECUTE FUNCTION prevent_duplicate_solo_match();
