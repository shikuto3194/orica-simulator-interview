-- snapshots テーブル: GameSnapshot のサーバ側永続化。
-- P3-19 Phase A + P3-64 Phase C-4 統合実装。
--
-- 設計:
-- - point-in-time の state (GameSnapshot 形式) + 関連 replay_events range を pair で保存
-- - room_id / from_version / to_version で event 列との対応関係を表現 (任意)
-- - room 由来でない snapshot (manual / scenario) は room_id NULL 可
-- - is_public: 共有 URL から read-only で復元可能にする
-- - 認可ロジックはサーバ側 (game-api.ts) で実装。RLS は default deny

CREATE TABLE IF NOT EXISTS snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   UUID,                          -- 作成者 (匿名共有を許す場合 NULL)
  room_id         TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  -- snapshot 由来の replay_events 範囲 (任意)
  from_version    INTEGER,
  to_version      INTEGER,
  label           TEXT,
  origin          TEXT NOT NULL DEFAULT 'manual' -- 'scenario' | 'room' | 'manual'
                  CHECK (origin IN ('scenario', 'room', 'manual')),
  state           JSONB NOT NULL,                -- GameSnapshot 全体 (schemaVersion / savedAt / state)
  is_public       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 自分のスナップショット一覧表示用
CREATE INDEX IF NOT EXISTS idx_snapshots_owner_created
  ON snapshots (owner_user_id, created_at DESC)
  WHERE owner_user_id IS NOT NULL;

-- 共有 URL アクセス用 (is_public=true のみ。WHERE 句で部分インデックス)
CREATE INDEX IF NOT EXISTS idx_snapshots_public_created
  ON snapshots (created_at DESC)
  WHERE is_public = true;

-- room 由来 snapshot の検索用 (replay_events range pairing 表示)
CREATE INDEX IF NOT EXISTS idx_snapshots_room
  ON snapshots (room_id, to_version)
  WHERE room_id IS NOT NULL;

-- RLS 有効 + ポリシー無し (rooms / replay_events と同じ設計)。
-- サーバが service_role で RLS bypass + JWT 検証 + is_public/owner 検証する。
ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;

-- 確認用:
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'snapshots';
--   SELECT polname FROM pg_policy WHERE polrelid = 'snapshots'::regclass; -- 0 行
