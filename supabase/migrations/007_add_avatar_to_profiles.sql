-- 007_add_avatar_to_profiles.sql
-- 適用日: 2026-05-17
-- profiles テーブルにアバター ID 列を追加。
-- 値は apps/playground-web/src/avatars.ts の id (例: "reimu", "marisa") を保持し、
-- 画像パスはクライアントで `/images/avater/${avatar_id}-icon.png` に解決する。
--
-- profiles テーブル自体は orika-react プロジェクトで先行作成されており、
-- 本リポジトリにマイグレーション履歴は存在しない (001 が無いのはそのため)。
-- 既存 RLS:
--   - profiles_select_authenticated: authenticated は全件 read 可
--     → ルーム対戦で相手の avatar_id を fetch できる
--   - profiles_update_own: 本人のみ update 可

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_id text;

COMMENT ON COLUMN public.profiles.avatar_id IS
  'クライアントの AVATARS マスタ ID (例: reimu, marisa)。NULL はデフォルト扱い。';
