-- B1 tables (PRD B1.6), for B2's migration setup. Mirrors the B1Store interface in store.ts.
-- Postgres dialect; JSON columns hold contract types verbatim.

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mode_state (
  user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mode           TEXT NOT NULL DEFAULT 'work' CHECK (mode IN ('work', 'play')),
  active_pet_id  TEXT
);

CREATE TABLE IF NOT EXISTS connector_tokens (
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider           TEXT NOT NULL,
  email              TEXT,
  scopes             TEXT[] NOT NULL,
  enc_refresh_token  TEXT NOT NULL,          -- AES-256-GCM (auth/crypto.ts); never plaintext
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

CREATE TABLE IF NOT EXISTS runs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id      TEXT NOT NULL,
  text        TEXT NOT NULL,
  status      TEXT NOT NULL,
  steps       JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS run_events (
  run_id  TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq     INTEGER NOT NULL,                  -- SSE id; replay = WHERE seq > Last-Event-ID
  event   JSONB NOT NULL,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, seq)
);

CREATE TABLE IF NOT EXISTS approvals (
  action_id     TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step_id       TEXT NOT NULL,
  tool          TEXT NOT NULL,
  kind          TEXT NOT NULL,
  payload       JSONB NOT NULL,              -- exact payload executed on approve
  preview       JSONB NOT NULL,
  content_hash  TEXT NOT NULL,
  status        TEXT NOT NULL,               -- pending|approved|denied|expired|superseded
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  decided_at    TIMESTAMPTZ
);
-- transitionApproval(): UPDATE approvals SET status=$to, decided_at=now()
--                       WHERE action_id=$id AND status=$from RETURNING action_id;

CREATE TABLE IF NOT EXISTS undo_log (
  id      BIGSERIAL PRIMARY KEY,
  run_id  TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  tool    TEXT NOT NULL,
  undo    JSONB NOT NULL,
  at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
