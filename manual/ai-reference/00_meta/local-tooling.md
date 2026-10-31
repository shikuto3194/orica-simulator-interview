# Local Tooling Notes

この文書は、日常作業で使うローカルコマンドとデバッグ成果物の置き場をまとめる。
運用ルールの正源は `CLAUDE.md` の Cross-cutting Rule。

## テスト実行

```powershell
# 対象repo/worktreeのrootから。修正中の単体確認（完了証跡はfinish）。
pnpm test:unit packages/rules-core/test/after-triggers-connector.test.ts

# 型チェック（rules-core 単体）
pnpm exec tsc -p packages/rules-core/tsconfig.json --noEmit

# dev サーバー起動（ポート 4173）
npx vite --config apps/playground-web/vite.config.ts --port 4173
```

これはprimary working treeの正準dev起動コマンド。`vite.config.ts` が登録する
ルーム・認証用 Game API middleware を欠く別起動では、ルーム画面で
「認証を確認できませんでした。戻って再度ログインしてください。」になる。
AI hook は bare `vite` / `pnpm dev:web` / `vite preview` と config・port 不足を拒否する。
Vite は `strictPort` のため 4173 使用中に別 port へ自動退避せず fail する。
dev サーバーはバックグラウンド起動（即応答）で扱う。並列 worktree のみ、
`scripts/new-worktree.ps1` が割り当てた port を明示して同じ config で起動する。

`packages/rules-core/src/` または `packages/card-data/src/` の変更時は、
ブラウザと Game API が同じルール/カードデータを参照するよう Vite server が自動再起動する。
通常の画面実装変更は再起動せず HMR を継続する。

`node scripts/vitest-with-jest-aliases.mjs` は先頭に `run` を付け、対象0件は失敗にする。
`... .mjs run` と打つと 2 個目の `run` が**ファイル名フィルタ**になり全件走らない。
全件は引数なし、絞るなら対象パスだけを渡す。

検証profile、同時実行制御、結果の鮮度とhook契約は [harness-validation.md](harness-validation.md)。

## ワークスペース参照の解決先（src / dist）

`@orica/card-data` と `@orica/rules-core` は **3 経路すべてで src に解決される**。

| 経路       | 設定                                      |
| ---------- | ----------------------------------------- |
| ブラウザ   | `apps/playground-web/vite.config.ts` alias |
| vitest     | `vitest.config.ts` alias                  |
| 型チェック | `tsconfig.base.json` の `paths`           |

本番ブラウザの rules-core は `src/runtime.ts`（実行用 API）、dev / テストは
`src/index.ts`（runtime と学習 API の再公開）を使う。詳細は [公開用 dist](public-build.md)。

2026-08-02 まで vitest だけ alias が無く、package.json の `exports`
(`./dist/index.js`) に解決されていた。`pnpm test` は card-data を再ビルドしないため
**src を壊してもテストが緑のまま通る**状態だった（発覚時 dist は 06-11 ビルドで
567 枚 / src 580 枚、BSTH11 弾は dist に存在せず）。

`pnpm check` (`tsc -b`) が dist を再ビルドするため `pnpm verify`
（check → test の順）では内容が一致してしまい、この乖離を隠していた。
退行検知は `apps/playground-web/test/workspace-alias-resolution.test.ts`
（モジュール同一性で判定。内容比較では上記の理由で検知できない）。

## デバッグスクリーンショット

Playwright MCP / preview ツールのスクリーンショットは必ず `debug-screenshots/` 配下に保存する。
`filename` は `debug-screenshots/<name>.png` 形式にし、ルートに散らさない。
同ディレクトリは `.gitignore` 済み。

## 実行成果物と自動統合

保存先の契約は `CLAUDE.md` の Cross-cutting Rule が正源。CLI の trace / baseline /
policy / effect-debug 出力と shared primary の収集結果は、ルート `artifacts/` 配下に保存する。
既存の出力パス・参照・checkpoint を移動せず、Git の除外をルート単位に統一する。
診断ログは `logs/`、手作業の一時ファイルは `.codex-temp/`、Playwright の出力先は
`playwright.config.ts` の `outputDir` を使う。既定の `test-results/` もディレクトリ全体で除外する。

### 再発の根拠（2026-09-08 調査）

| 発生日 | 生成物と停止 | 履歴・ログの根拠 |
| --- | --- | --- |
| 2026-08-25 | Playwright 失敗成果物が clean 判定を阻害 | `c81bf7941`: `.last-run.json` の単体除外から `test-results/` 全体へ変更 |
| 2026-09-02 | `artifacts/policy-shadow/` の追加後、primary の未追跡 `artifacts/` で複数回停止 | durable follow-up `0123e4a1fde9746c553a` / `a4251e440dd7fa2aed5f` / `c824ba334062850b5b80`、修正 `fd5fd485e` |
| 2026-09-08 | Supervisor の stdout/stderr ログ6件で primary が dirty | durable follow-up `014372099441e7addc8a` / `28bce5f11f7f18e0cb28`、個別修正 `3a4112a1f` |

原因は、任意の生成元が出力を追加できる共有ディレクトリに対し、Git の除外だけが
生成元・ファイル名の列挙だったこと。2026-09-08 の調査時点で `git ls-files artifacts` は0件。
同日の fuzz 失敗は別要因であり、成果物の除外で解消したものとして扱わない。

### 再発防止の検証

`pnpm test:supervisor-handoff` は一時 Git リポジトリで次を検証する（`pnpm test` に含む）。

- 未知の生成元・拡張子・深さの成果物と Playwright 失敗成果物を作っても、auto-merge と同じ
  `git status --porcelain` が clean を保つ。
- verified-commit と同じ `git add -A -- .` で実行成果物がステージされない。
- ソース・仕様・テスト fixture は検出・ステージされ、別階層の `artifacts` という名前も隠れない。
- 過去に追跡された成果物があっても、その変更は dirty として検出する。

実データは削除せず保持する。共有 primary と各 worktree は、同期した `.gitignore` を通して
同じ Git 判定を使う。成果物から回帰 fixture を採用する場合は、必要な部分を関連テストの
fixture ディレクトリへコピーしてレビュー対象にする。
