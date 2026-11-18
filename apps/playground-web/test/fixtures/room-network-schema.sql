CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE TABLE public.rooms (id TEXT PRIMARY KEY, state JSONB, state_version INTEGER NOT NULL DEFAULT 0,
  players JSONB NOT NULL DEFAULT '[]', connected JSONB NOT NULL DEFAULT '{}', last_heartbeat JSONB NOT NULL DEFAULT '{}', all_disconnected_at TIMESTAMPTZ);
CREATE TABLE public.replay_events (id BIGSERIAL PRIMARY KEY, room_id TEXT REFERENCES public.rooms(id), state_version INTEGER NOT NULL,
  acting_player_id TEXT NOT NULL, endpoint TEXT NOT NULL CHECK (endpoint IN ('action','step')), payload JSONB NOT NULL, UNIQUE(room_id,state_version));
CREATE TABLE public.snapshots (id TEXT PRIMARY KEY, state JSONB);
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.replay_events ENABLE ROW LEVEL SECURITY;
