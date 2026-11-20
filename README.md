# 幻想符 Simulator

バトルスピリッツのルールに沿った対戦をブラウザーで進める個人開発のシミュレーターです。カードごとに異なる発動条件や処理順をデータとして定義し、画面から独立したルールエンジンで扱います。

本作は個人制作の同人作品で、非売品です。

## 対戦デモ

[![対戦中の2人分の盤面とカード効果の表示](https://github.com/shikuto3194/orica-simulator-interview/releases/download/portfolio-demo-20261120/match-demo.webp)](https://github.com/shikuto3194/orica-simulator-interview/releases/download/portfolio-demo-20261120/match-demo.mp4)

[対戦動画をダウンロード（4分21秒・音声あり・MP4）](https://github.com/shikuto3194/orica-simulator-interview/releases/download/portfolio-demo-20261120/match-demo.mp4)

録画では、上段と下段にそれぞれのプレイヤーの画面を表示しています。冒頭で招待とデッキ選択、0:35付近から対戦開始、2:08付近で手札からの選択、3:25付近でカード効果の表示と盤面への反映を確認できます。

## 開発で担当したこと

個人開発として、目的と仕様の整理、AIへの実装指示、改善方針の判断、動作確認を担当しました。コード作成にはAIを活用しています。

効果定義の見直しと、操作後の盤面まで確認する検証手順の改善を進めました。

## 設計の工夫

- **カード効果を手順に分ける。** 効果が適用される範囲、発動タイミング、条件、処理手順を定義します。対象を選び、条件に応じてコストを払い、その結果を後続の処理へ渡すような効果を、共通処理の組み合わせで表現します。[DSL仕様](manual/ai-reference/20_design/12_dsl-specification.md) · [型定義](packages/rules-core/src/dsl-types.ts)
- **対戦ルールをUIから分ける。** ブラウザーで受けた操作を対戦APIへ渡し、ルール処理で状態を更新して盤面に反映します。[ルールエンジン](packages/rules-core) · [対戦API](apps/playground-web/server/game-api.ts)
- **操作の結果を盤面で確認する。** ログ上は成功しても盤面に反映されないケースを経験し、ルールの回帰テストに加えて、手動操作とAIを使った画面確認で期待する変化を追うようにしました。[単体テストの入口](manual/ai-reference/00_meta/unit-test-entry.md) · [GUIシナリオ](manual/ai-reference/25_gui/10_scenario-test-reference.md)

**主な技術**　TypeScript、React、Vite、Node.js

## ワークスペース構成

```text
packages/
  rules-core/     ルールエンジン本体
  card-data/      カード定義 (ALL_CARDS) と検査用サンプル (SAMPLE_CARDS)
  ai/             ローカル LLM エージェント基盤 (Ollama tool-call, GUI チャット, 自動 skill / web リサーチ / snapshot 紐付け)
  replay-codec/   棋譜 (replay-delta) の共通 codec。package.json を持たない共有モジュール
apps/
  cli/            ルールエンジンのCLI確認用。トレース検証・学習指標の TypeScript 実装も置く。ラッパーはルート scripts/
  playground-web/ ブラウザUI (1人バトル・デッキ構築・対戦ルーム) と対戦APIサーバー (server/)
manual/           調査と設計ドキュメント
```

## 推奨環境

- Node.js `>=22.16.0`
- pnpm `10.15.1`

Node/pnpmの要求は [package.json](package.json)。以下はrepo rootで実行します。

## セットアップ

```bash
corepack enable
corepack prepare pnpm@10.15.1 --activate
pnpm install
pnpm check
npx vite --config apps/playground-web/vite.config.ts --port 4173
```

Windows PowerShell で `pnpm` / `npx` が実行ポリシーに引っかかる場合は、`pnpm.cmd` / `npx.cmd` を使う方法もあります。
Corepackのダウンロード/DNS失敗は依存準備の失敗です。ゲート通過とは扱わず、接続と指定pnpmの利用可否を確認して再試行します。

| 作業             | 入口                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| ルールの単体回帰 | [単体テスト](manual/ai-reference/00_meta/unit-test-entry.md)                                                                    |
| GUIのシナリオ    | [正準起動](manual/ai-reference/00_meta/local-tooling.md) → [シナリオ](manual/ai-reference/25_gui/10_scenario-test-reference.md) |
| 認証付き対戦     | [ローカルPC環境](manual/ai-reference/00_meta/local-pc-deployment.md)                                                            |
| 公開用build      | [公開境界と素材](manual/ai-reference/00_meta/public-build.md)                                                                   |

実行環境・認証・素材の前提を各入口で確認します。単体テスト成功だけでは認証付き対戦や配備の確認にはなりません。

この公開スナップショットは文書のみを更新しています。文書に記載された現行仕様と、同梱のソースに実装済みの範囲は異なる場合があります。配備用の画像・音声素材は開発リポジトリで管理しています。公開ソースの型検査には `pnpm check` を利用できます。

### カード画像 (開発リポジトリで可逆 WebP を管理)

配信用の `images/BS*.webp` を Git 管理し、カード定義も WebP を参照します。
開発リポジトリの clone で画像が揃うため、配備用ビルドにカード画像用のアーカイブ復元は不要です。
ビルドは参照される表裏画像だけを `apps/playground-web/dist/images/` にコピーし、
必要な画像が欠けていれば失敗します。

画像追加・更新時は元 PNG を `images/` に置き、次を実行します:

```bash
pnpm images:prepare
```

解像度を変えず可逆 WebP に変換し、全画像の表示画素と透明度の一致を検証します。
生成した WebP と、それを参照するカード定義を一緒に commit します。
元 PNG は削除せず、Git・dist・アプリの事前ダウンロード対象から除外します。
完全透明な画素の見えない RGB 値は一致判定から除きます。

編集用の元 PNG を復元する旧 `pnpm fetch-images` も利用できます。
既定は `C:/dev/orica-card-images-archive/orica-card-images-2026-04-27.tar.gz`、
別アーカイブは `ORICA_IMAGES_TARBALL` で指定します。
開発リポジトリではタイトル背景（WebP）・BGM（AAC/M4A）も Git 管理し、clone した素材で配備用ビルドを作れます。
元素材を更新したときは `pnpm bgm:prepare` で圧縮・検証します（FFmpeg / ffprobe が必要）。
詳細は[公開用 dist の素材管理](manual/ai-reference/00_meta/public-build.md#タイトル背景bgm-の配備前提)を参照してください。

## 主なコマンド

```bash
pnpm check
pnpm lint
pnpm format:check
pnpm build
pnpm test
npx vite --config apps/playground-web/vite.config.ts --port 4173
```

## 品質ゲート

公開先には `apps/playground-web/dist/` を指定する。開発ソースの push は従来どおりでよい。
公開ビルドは1人バトルとバグ報告用スナップショットを含む。検証シナリオ・学習 AI・参考素材は除外する。
詳細: [公開用 dist の境界](manual/ai-reference/00_meta/public-build.md)。

- `pnpm format:check`
- `pnpm lint`
- `pnpm check`
- `pnpm test`
- `pnpm build`

上記は個別に実行できる全体検査。完了・push・CIで必要な検査は変更内容と影響範囲から選ぶ（`pnpm codex:finish-check` / `pnpm verify:push` / `pnpm verify:ci`、全体は `pnpm verify`）。

開発リポジトリのCIは `pnpm verify:ci`。検査範囲と再利用条件は [検証運用](manual/ai-reference/00_meta/harness-validation.md)、検査一覧は [gate manifest](scripts/harness/gate-manifest.json) を参照してください。

## 現状と次タスク

現況 (Current Snapshot) と現役タスク (Active Board) は [manual/ai-reference/30_plan/02_detailed-todo.md](manual/ai-reference/30_plan/02_detailed-todo.md) を参照。完了履歴は [manual/ai-reference/30_plan/03_completed-milestones.md](manual/ai-reference/30_plan/03_completed-milestones.md) を起点に phase 別ファイルへ辿る。

ルール・設計・GUI・ポリシーの詳細は [manual/ai-reference/README.md](manual/ai-reference/README.md) の目的別索引から、運用ルールは [CLAUDE.md](CLAUDE.md) の Cross-cutting Rule を参照。

## 関連作品

- [ACGマネージャー](https://github.com/shikuto3194/acg-react-interview)
- [オリカマネージャー](https://github.com/shikuto3194/orika-react-interview)
