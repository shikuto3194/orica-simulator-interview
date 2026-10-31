# Supabase migrations

Supabase の SQL マイグレーション。Supabase ダッシュボードの SQL Editor で 1 ファイルずつ
順に手動適用する。

## 適用手順

1. [Supabase Dashboard](https://supabase.com/dashboard/project/nnthvbizvqpufpfkzlho) を開く
2. 左メニュー > SQL Editor を選択
3. 未適用のファイルを連番順 (002 → 003 → ...) で SQL Editor にコピペして RUN
4. 適用済みファイルには `-- 適用日: YYYY-MM-DD` を追記してコミットして履歴を残す

## 適用状況

| #   | ファイル                                | 説明                                              | 適用日         |
| --- | --------------------------------------- | ------------------------------------------------- | -------------- |
| 002 | `002_create_rooms.sql`                  | rooms テーブル (ルーム戦 state)                   | 適用済         |
| 003 | `003_add_spectator_mode.sql`            | rooms.spectator_mode 列追加 (P3-17)               | 適用済         |
| 004 | `004_enforce_rooms_rls.sql`             | rooms の RLS 明示有効化 (P3-17 セキュリティ)      | 適用済         |
| 005 | `005_create_replay_events.sql`          | replay_events テーブル (P3-64 Phase C event log)  | 2026-05-17     |
| 006 | `006_create_snapshots.sql`              | snapshots テーブル (P3-19 + P3-64 Phase C-4 統合) | 2026-05-17     |
| 007 | `007_add_avatar_to_profiles.sql`        | profiles.avatar_id 列追加 (マイページ アバター)   | 2026-05-17     |
| 008 | `008_add_last_heartbeat_to_rooms.sql`   | rooms.last_heartbeat 列追加 (heartbeat 500 修正)  | 未適用         |
| 009 | `009_commit_room_state_rpc.sql`         | room state + replay event 原子 commit / 冪等化    | 前進移行に包含 |
| 010 | `010_add_replay_restore_checkpoint.sql` | server checkpoint + event 先行時の原子的復旧      | 前進移行に包含 |

## ルーム通信の前進移行

`20261026181917_room_network_atomic_readiness.sql` は009/010相当と、取消fence・heartbeat merge・readiness・旧fallback拒否をまとめる。
2026-10-27 JST、本番へMCPで適用済み。ローカルSQL回帰、SQL/REST readiness、service_role限定権限、実JWTの両画面同期とAPI再起動後の冪等性を確認した。
過去の連番ファイルを再適用して新しいcommit関数を旧版へ戻さない。
詳細は [通信の確定・復旧契約](../../manual/ai-reference/20_design/19_room-network-protocol.md)。

## 検証クエリ

2026-10-02: `20261001150811_operation_notices.sql` を MCP で適用済み。
`20261001153830_operation_notice_migration_check.sql` も適用済み。
日次運営通知・本人限定既読・service_role専用生成状態と掲載RPCを追加。
最新10件の保持・既読の連動削除・同日再実行・権限制御をローカルPostgresで確認し、
実DBのRLS・GRANT・RPC実行権限も確認した。生成状態のポリシーなしは意図したdefault deny。
通知本文は全ログインセッション、既読は本人に許可する（匿名Authセッションを含む）。
SQLだけの修正も適用済みを確認できるよう、service_role専用の真偽値RPCを追加。
固定search_pathのSECURITY DEFINERでmigration履歴だけを照合し、SQL本文は返さない。
詳細は [日次の運営通知](../../manual/ai-reference/25_gui/23_operation-notices.md)。

2026-09-26: `20260925211208_drop_redundant_replay_events_index.sql` を MCP で適用済み。
`replay_events(room_id, state_version)` の非 UNIQUE 索引だけを削除し、同じ定義の
`uq_replay_events_room_version` を保持。削除した索引は344 KiB、利用回数0だった。
定義の一致・代替索引の有効性を検査し、テーブルロックを即時取得できない場合は中止する。
ローカルPostgresでデータ保持・一意性・再適用・代替索引不備時の中止を確認。
実DBで削除前後の検索計画が同じ UNIQUE 索引を使うことと、取得成功を確認した。
CLI作成後、実DBのmigration history versionにファイル名を合わせた。
ロールバックは `CREATE INDEX CONCURRENTLY idx_replay_events_room_version ON public.replay_events (room_id, state_version);`
を単独実行する（データの復元は不要）。

2026-09-23: `20260923084249_room_invitations.sql`、`20260923085345_room_push_priority.sql` を MCP で適用済み。
ルーム招待・端末通知購読テーブルと、招待送信・参加・デッキ登録の原子的RPC、PWA優先の通知経路を追加。
CLI作成後、実DBのmigration history versionにファイル名を合わせた。
両テーブルはservice_role専用のためRLS有効・ポリシーなしが意図した状態。
仕様と検証は [ルーム招待](../../manual/ai-reference/25_gui/20_room-invitations.md)。

2026-09-17: `20260917073409_bs_account_linking.sql` を MCP で適用済み。
CLI で作成後、実 DB の migration history version にファイル名を合わせている。
管理者のメイン／サブ指定と BS デッキ連携 RPC を追加。初期設定は両スイッチともオフ。
詳細は [アカウント・デッキ連携](../../manual/ai-reference/25_gui/17_account-deck-linking.md)。
private の2テーブルは直接アクセスを許可しないため RLS 有効・ポリシーなしが意図した状態。

2026-09-21: `20260921121345_input_form_validation.sql` を MCP で適用済み。
表示名30文字・BSデッキ名100文字・メイン／トークン各1,000枚の CHECK 制約と
RPC の名前型検証を追加。既存データはすべて適合し、書換えなしで制約を有効化した。
CLI 作成後、実 DB の migration history version にファイル名を合わせた。
詳細は [入力検証](../../manual/ai-reference/00_meta/input-validation.md)。

適用後の RLS 確認:

```sql
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN ('rooms', 'replay_events', 'snapshots');
-- すべて relrowsecurity = t (true) なら OK

SELECT polname, polrelid::regclass
FROM pg_policy
WHERE polrelid::regclass::text IN ('rooms', 'replay_events', 'snapshots');
-- 0 行で OK (anon / authenticated は default deny)
```

設計詳細はそれぞれのファイル冒頭コメントを参照。
