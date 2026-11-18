-- rooms.spectator_mode: 観戦許可モード
--   'private'     — 参加者のみ閲覧可（デフォルト、A 案相当）
--   'public_link' — roomId を知っていれば誰でも閲覧可（観戦リンク共有）
--
-- 既存行は default 'private' で埋まる。Supabase ダッシュボードの SQL editor で手動適用する。
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS spectator_mode TEXT NOT NULL DEFAULT 'private'
    CHECK (spectator_mode IN ('private', 'public_link'));
