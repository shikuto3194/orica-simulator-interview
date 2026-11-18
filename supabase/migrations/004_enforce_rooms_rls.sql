-- rooms テーブルの RLS ポリシー明示化（P3-17 セキュリティ補強）。
--
-- 002_create_rooms.sql のコメント「RLS 無効（サーバーサイドAPIミドルウェア経由のみアクセス）」
-- は誤った設計前提だった:
--   anon key (sb_publishable_*) はクライアント JS にバンドルされ公開されているため、
--   RLS OFF だと第三者が Supabase REST API 経由で rooms 全行を読み書きできてしまう
--   （サーバの sanitizeStateForSpectator や requireRoomMember を完全にバイパス可能）。
--
-- 正しい設計:
--   1) rooms は RLS 有効、ポリシー無し（anon / authenticated を default deny）
--   2) サーバ (apps/playground-web/server/game-api.ts) のみ
--      SUPABASE_SERVICE_ROLE_KEY で RLS bypass して操作
--   3) サーバが独自の JWT 検証 + requireRoomMember / authorizeRoomRead で
--      参加者・観戦者制御を行う
--
-- 既存の Supabase はテーブル新規作成時 RLS をデフォルトで有効にするが、
-- 過去に手動で OFF にされた場合に備え、明示的に再有効化する。
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

-- ポリシーを定義しない = anon / authenticated は全 CRUD 拒否。
-- service_role はそもそも RLS の対象外なのでサーバから自由に操作可能。

-- 確認用クエリ (適用後の検証):
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'rooms';
--   -- relrowsecurity = t (true) なら RLS 有効、OK
--   SELECT polname FROM pg_policy WHERE polrelid = 'rooms'::regclass;
--   -- 0 行なら policy 無し、OK
