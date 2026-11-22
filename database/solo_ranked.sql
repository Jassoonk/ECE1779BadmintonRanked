CREATE TABLE IF NOT EXISTS solo_queue (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS solo_matches (
    id BIGSERIAL PRIMARY KEY,
    player1_id BIGINT NOT NULL REFERENCES users(id),
    player2_id BIGINT NOT NULL REFERENCES users(id),
    player1_rating_before INTEGER NOT NULL,
    player2_rating_before INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'pending_confirmation', 'completed')),
    submitted_by BIGINT REFERENCES users(id),
    proposed_winner_id BIGINT REFERENCES users(id),
    winner_id BIGINT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CHECK (player1_id <> player2_id)
);

CREATE TABLE IF NOT EXISTS solo_rating_history (
    id BIGSERIAL PRIMARY KEY,
    match_id BIGINT NOT NULL REFERENCES solo_matches(id),
    user_id BIGINT NOT NULL REFERENCES users(id),
    rating_before INTEGER NOT NULL,
    rating_after INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (match_id, user_id)
);
