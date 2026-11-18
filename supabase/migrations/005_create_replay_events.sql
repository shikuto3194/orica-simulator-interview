-- replay_events テーブル: ルーム戦の dispatch endpoint 経由で適用された action 列を append-only に記録する。
-- P3-64 Phase C: server-authoritative + replay 経路の永続化層。
--
-- 設計前提:
-- - rooms.state は最新 snapshot (cache)、replay_events は event log (source of truth)
-- - dispatch endpoint 6 種 (action / step / claim-victory / core-move / brave-separation / pregame-update) が
--   CAS update 成功直後に 1 行 INSERT する
-- - state_version は新しい (適用後の) rooms.state_version をそのまま記録 → 順序保証
--
-- 観戦許可ポリシー:
-- - rooms と同じく RLS 有効 + ポリシー無し (anon / authenticated を default deny)
-- - サーバが service_role で RLS bypass して読み書き
-- - 観戦者は GET /api/room/:id/replay 経由で sanitize 済み payload を取得 (game-api.ts 側で制御)

CREATE TABLE IF NOT EXISTS replay_events (
  id                BIGSERIAL PRIMARY KEY,
  room_id           TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  state_version     INTEGER NOT NULL,             -- 適用後の rooms.state_version
  acting_player_id  TEXT NOT NULL,                -- "alice" | "bob"
  endpoint          TEXT NOT NULL                 -- dispatch endpoint 名
                    CHECK (endpoint IN (
                      'action', 'step', 'claim-victory',
                      'core-move', 'brave-separation', 'pregame-update'
                    )),
  payload           JSONB NOT NULL,               -- request body (action 引数の snapshot)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- リプレイ再生: room_id + state_version 範囲で event 列を取得する用
CREATE INDEX IF NOT EXISTS idx_replay_events_room_version
  ON replay_events (room_id, state_version);

-- 期限切れ room 削除時の cascade で大量 event が消えるが、created_at で時系列検索もできるよう保持
CREATE INDEX IF NOT EXISTS idx_replay_events_room_created
  ON replay_events (room_id, created_at);

-- 同一 (room_id, state_version) は 1 行のみ (CAS 成功時の version は単調増加)。
-- 万一の重複 INSERT を防ぐ unique 制約。
CREATE UNIQUE INDEX IF NOT EXISTS uq_replay_events_room_version
  ON replay_events (room_id, state_version);

-- RLS 有効 + ポリシー無し (rooms と同じ default deny 設計)
ALTER TABLE replay_events ENABLE ROW LEVEL SECURITY;

-- 確認用クエリ:
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'replay_events';
--   SELECT polname FROM pg_policy WHERE polrelid = 'replay_events'::regclass;  -- 0 行で OK
