-- rooms テーブル: 対戦ルーム管理（インメモリ → DB 移行）
CREATE TABLE IF NOT EXISTS rooms (
  id             TEXT PRIMARY KEY,             -- 6文字のルームID
  players        JSONB NOT NULL DEFAULT '[]',  -- RoomPlayer[]
  state          JSONB,                        -- GameState (ゲーム開始前は null)
  state_version  INTEGER NOT NULL DEFAULT 0,
  scenario_id    TEXT,
  connected      JSONB NOT NULL DEFAULT '{}',  -- { userId: boolean }
  all_disconnected_at TIMESTAMPTZ,             -- 両方退出した時刻
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 期限切れルーム検索用インデックス
CREATE INDEX IF NOT EXISTS idx_rooms_all_disconnected_at
  ON rooms (all_disconnected_at)
  WHERE all_disconnected_at IS NOT NULL;

-- 注意: 旧コメントの「RLS 無効」は誤った設計前提。004_enforce_rooms_rls.sql 参照。
-- 実態は: rooms は RLS 有効 + ポリシー無し (anon / authenticated は default deny)、
-- サーバが SUPABASE_SERVICE_ROLE_KEY で RLS bypass して操作する設計。
-- クライアント側の supabaseClient.ts は rooms テーブルを直接参照しない。
