-- Separate 2v2 schema: leave historical solo records untouched.
BEGIN;
CREATE TABLE IF NOT EXISTS doubles_presence (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS doubles_invites (
  id BIGSERIAL PRIMARY KEY,
  inviter_id BIGINT NOT NULL REFERENCES users(id),
  invitee_id BIGINT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '3 minutes'),
  CHECK(inviter_id <> invitee_id)
);
CREATE INDEX IF NOT EXISTS idx_doubles_invites_received ON doubles_invites(invitee_id, status);
CREATE SEQUENCE IF NOT EXISTS doubles_party_id_seq;
CREATE TABLE IF NOT EXISTS doubles_queue (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  party_id BIGINT NOT NULL,
  party_size SMALLINT NOT NULL CHECK (party_size IN (1,2)),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_doubles_queue_joined ON doubles_queue(joined_at);
CREATE TABLE IF NOT EXISTS doubles_matches (
  id BIGSERIAL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending_confirmation','completed')),
  submitted_by BIGINT REFERENCES users(id),
  proposed_winning_team SMALLINT CHECK (proposed_winning_team IN (1,2)),
  winning_team SMALLINT CHECK (winning_team IN (1,2)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS doubles_match_players (
  match_id BIGINT NOT NULL REFERENCES doubles_matches(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  team SMALLINT NOT NULL CHECK (team IN (1,2)),
  rating_before INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY(match_id,user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_doubles_one_active_match_per_user
 ON doubles_match_players(user_id) WHERE active;
CREATE TABLE IF NOT EXISTS doubles_rating_history (
  match_id BIGINT NOT NULL REFERENCES doubles_matches(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  rating_before INTEGER NOT NULL,
  rating_after INTEGER NOT NULL,
  PRIMARY KEY(match_id,user_id)
);
COMMIT;
