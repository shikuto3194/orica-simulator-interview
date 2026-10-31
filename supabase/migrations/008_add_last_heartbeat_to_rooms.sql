-- 008_add_last_heartbeat_to_rooms.sql
-- 適用日: 未適用
-- rooms テーブルに last_heartbeat 列を追加。
--
-- 背景: server (game-api.ts) の POST /heartbeat は
--   updateRoom(roomId, { connected, all_disconnected_at, last_heartbeat })
-- で last_heartbeat を書き込むが、002_create_rooms.sql には当該列が無く、コードだけが
-- 先行して列を参照していた。このため heartbeat の UPDATE が PostgREST で
-- "column rooms.last_heartbeat does not exist" を返し、updateRoom が throw → 500 を
-- 返し続けていた (heartbeat は非致命なのでゲーム進行は継続するが、相手切断検知が機能せず
-- ブラウザコンソールに 500 が出続ける)。
--
-- 形式: { [supabaseUserId: string]: ISO8601 文字列 }。既定は空オブジェクト。

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS last_heartbeat JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN rooms.last_heartbeat IS
  'プレイヤーごとの最終 heartbeat 時刻 { userId: ISO8601 }。相手切断タイムアウト判定に使用。';
