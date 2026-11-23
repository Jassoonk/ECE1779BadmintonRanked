-- Create the initial PostgreSQL schema in one transaction.
BEGIN;

-- Store player profiles, current ratings, sign-in details, and the latest lobby heartbeat.
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    display_name VARCHAR(100) NOT NULL,
    rating INTEGER NOT NULL DEFAULT 1000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMPTZ,
    email TEXT UNIQUE,
    password_hash TEXT
);

-- Store session token digests with their expiration. Deleting a player also deletes their sessions.
CREATE TABLE IF NOT EXISTS user_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    invite_code_verified BOOLEAN NOT NULL DEFAULT FALSE
);

-- A pending invitation becomes a queued duo when the partner accepts.
CREATE TABLE IF NOT EXISTS doubles_parties (
    id BIGSERIAL PRIMARY KEY,
    leader_id BIGINT NOT NULL REFERENCES users(id),
    partner_id BIGINT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    queued_at TIMESTAMPTZ,
    -- Disallow self-pairing and require a party without a partner to be queued.
    CHECK (partner_id <> leader_id),
    CHECK (partner_id IS NOT NULL OR queued_at IS NOT NULL)
);

-- Track the result workflow from an active match through confirmation and completion.
CREATE TABLE IF NOT EXISTS doubles_matches (
    id BIGSERIAL PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_confirmation', 'completed')),
    submitted_by BIGINT REFERENCES users(id),
    winning_team SMALLINT CHECK (winning_team IN (1, 2)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Record team membership and the before and after ratings for each participant.
CREATE TABLE IF NOT EXISTS doubles_match_players (
    match_id BIGINT NOT NULL REFERENCES doubles_matches(id),
    user_id BIGINT NOT NULL REFERENCES users(id),
    team SMALLINT NOT NULL CHECK (team IN (1, 2)),
    rating_before INTEGER NOT NULL,
    rating_after INTEGER,
    PRIMARY KEY (match_id, user_id)
);

-- Allow each player only one match without a finalized rating.
CREATE UNIQUE INDEX IF NOT EXISTS doubles_one_open_match_per_player
    ON doubles_match_players (user_id) WHERE rating_after IS NULL;

-- Store one admin-set invite code for the lobby.
CREATE TABLE IF NOT EXISTS lobby_settings (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    invite_code TEXT NOT NULL CHECK (invite_code ~ '^[0-9]{6}$')
);

-- Set the initial code without overwriting an admin's saved code.
INSERT INTO lobby_settings (invite_code)
VALUES ('123456')
ON CONFLICT (singleton) DO NOTHING;

COMMIT;
