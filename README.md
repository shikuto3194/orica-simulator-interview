# Orica Simulator

バトルスピリッツ向けの、再利用可能なルールエンジンを中核にしたシミュレーターです。

## 方針

- 先に UI 非依存のルールエンジンを作る
- その上に手動操作 UI、AI 操作、将来的なゲーム画面を載せる
- 全カード対応より先に、状態遷移とルール再現性を固める

## ワークスペース構成

```text
packages/
  rules-core/     ルールエンジン本体
  card-data/      カード定義とサンプルデータ
  ai/             ローカル LLM エージェント基盤 (Ollama tool-call, GUI チャット, 自動 skill / web リサーチ / snapshot 紐付け)
apps/
  cli/            ルールエンジンのCLI確認用
  playground-web/ ブラウザ確認用の最小UI
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

Windows PowerShell で `npm` 実行ポリシーに引っかかる場合は、`npm.cmd` を使う方法もあります。
Corepackのダウンロード/DNS失敗は依存準備の失敗です。ゲート通過とは扱わず、接続と指定pnpmの利用可否を確認して再試行します。

| 作業             | 入口                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| ルールの単体回帰 | [単体テスト](manual/ai-reference/00_meta/unit-test-entry.md)                                                                    |
| GUIのシナリオ    | [正準起動](manual/ai-reference/00_meta/local-tooling.md) → [シナリオ](manual/ai-reference/25_gui/10_scenario-test-reference.md) |
| 認証付き対戦     | [ローカルPC環境](manual/ai-reference/00_meta/local-pc-deployment.md)                                                            |
| 公開用build      | [公開境界と素材](manual/ai-reference/00_meta/public-build.md)                                                                   |

実行環境・認証・素材の前提を各入口で確認します。単体テスト成功だけでは認証付き対戦や配備の確認にはなりません。

### カード画像 (可逆 WebP を Git 管理)

配信用の `images/BS*.webp` を Git 管理し、カード定義も WebP を参照します。
clone で画像が揃うため、公開ビルドにカード画像用のアーカイブ復元は不要です。
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
タイトル背景（WebP）・BGM（AAC/M4A）も Git 管理し、clone だけで公開ビルドできます。
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
1人バトル・バグ報告用スナップショットを含め、検証シナリオ・学習 AI・参考素材は公開ビルドから除外する。
詳細: [公開用 dist の境界](manual/ai-reference/00_meta/public-build.md)。

- `pnpm format:check`
- `pnpm lint`
- `pnpm check`
- `pnpm test`
- `pnpm build`

CIは [workflow](.github/workflows/ci.yml) の `pnpm verify:ci`。検査範囲と再利用条件は [検証運用](manual/ai-reference/00_meta/harness-validation.md)、検査一覧は [gate manifest](scripts/harness/gate-manifest.json) を参照してください。

## 現状と次タスク

実装ステータス・直近着地・次タスクは [manual/ai-reference/30_plan/02_detailed-todo.md](manual/ai-reference/30_plan/02_detailed-todo.md) を参照。完了履歴は [manual/ai-reference/30_plan/03_completed-milestones.md](manual/ai-reference/30_plan/03_completed-milestones.md) を起点に phase 別ファイルへ辿る。

ルール・設計・GUI・ポリシーの詳細は [manual/ai-reference/README.md](manual/ai-reference/README.md) の目的別索引から、運用ルールは [CLAUDE.md](CLAUDE.md) の Cross-cutting Rule を参照。
