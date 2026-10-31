# フォームとデッキ取込の入力検証

通常フォームは React の文字列描画と Supabase のパラメーター渡しを使う。
入力を HTML として解釈せず、SQL へ文字列連結しない。保存権限は既存の RLS と
アカウント連携 RPC の認証・所有者検証で制御する。

## 上限

| 対象 | 上限・形式 |
|---|---|
| 表示名 | 30 Unicode コードポイント。空文字・NULL は従来どおり許可 |
| BS デッキ名 | 100 Unicode コードポイント。空の名前を拒否 |
| メインデッキ / トークンデッキ | それぞれ合計1,000枚、最大1,000エントリー |
| 枚数 / 数値カード ID | 正の安全な整数。枚数は1エントリーでも1,000以下 |
| JSON ファイル | 1 MiB。読み込み・JSON パース前にサイズを検査 |

枚数上限は処理量・メモリの保護用であり、対戦ルール上のデッキ枚数や同名枚数の制限とは別。
絵文字はサロゲートペアを1文字として数え、PostgreSQL の `char_length` と揃える。
HTML・SQL に似た文字列や引用符自体は禁じず、そのまま文字列として扱う。

## 検証する境界

- `apps/playground-web/src/input-validation.ts` をフロントとルーム API の共通入口にする。
- ローカル保存・JSON 取込・URL デッキ復元・クラウド応答・クラウド保存で、配列展開前に総数を検査する。
- 不正なクラウド行は表示対象から除外し、エラーを表示する。不正なローカル保存データは読み込み時に上書きしない。
- `profiles.display_name` と BS の `decks.name/cards/token_deck` は DB の CHECK 制約でも守る。RPC を迂回した INSERT / UPDATE も拒否する。
- デッキ RPC は名前の JSON 型と長さを検証してから trim する。既存の認証・所有者検証を維持する。
- 共有 DB の ACG デッキには今回の BS デッキ制約を適用しない。

## 回帰確認

`input-validation.test.ts` は巨大値・非整数・Infinity・合計超過・旧形式の取込を確認する。
`input-validation-postgres.test.ts` は実 migration を PGlite で実行し、RPC と直接 SQL の拒否、
上限値・絵文字・引用符を含む正常入力、ACG の既存動作を確認する。
`e2e/account-link.spec.ts` はブラウザーからの拒否・保存と REST からの保存・読出しを往復し、
HTML 風の名前が実行されず文字列表示されることを確認する。

適用履歴は [Supabase migrations](../../../supabase/migrations/README.md) を参照。
