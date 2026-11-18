# Project Structure

実装対象と、その根拠・検証を探すための地図。現在の残作業は [ToDo](../30_plan/02_detailed-todo.md)、作業規則は [CLAUDE.md](../../../CLAUDE.md) を参照する。

## 全体像

| 場所 | 責務 |
|---|---|
| [packages/rules-core](../../../packages/rules-core/) | UIに依存しないルールエンジン |
| [packages/card-data](../../../packages/card-data/) | 印字情報・効果定義・カード索引 |
| [packages/ai](../../../packages/ai/) | AI操作・推論・学習・評価 |
| [apps/cli](../../../apps/cli/) | CLIによるエンジン確認 |
| [apps/playground-web](../../../apps/playground-web/) | GUI・対戦・認証とGame API |
| [e2e](../../../e2e/) | Playwrightによる操作・表示・API連携の検査 |
| [scripts](../../../scripts/) | データ監査・検証・運用入口 |
| [supabase](../../../supabase/) | 対戦・アカウント用のスキーマと関数 |
| [manual](../../) / [issues](../../../issues/) | 根拠・設計・現役作業・履歴 |

## rules-coreの入口

| 責務 | 主なソース |
|---|---|
| 状態とカードの型 | [model.ts](../../../packages/rules-core/src/model.ts) |
| DSLの型 | [dsl-types.ts](../../../packages/rules-core/src/dsl-types.ts) |
| コア移動・支払い | [core-system.ts](../../../packages/rules-core/src/core/core-system.ts) / [payment-system.ts](../../../packages/rules-core/src/core/payment-system.ts) |
| 召喚・配置 | [play-card-system.ts](../../../packages/rules-core/src/play/play-card-system.ts) |
| バトル | [battle-system.ts](../../../packages/rules-core/src/battle/battle-system.ts) |
| 合法手の列挙・実行 | [legal-actions.ts](../../../packages/rules-core/src/legal/legal-actions.ts) / [legal-actions-apply.ts](../../../packages/rules-core/src/legal/legal-actions-apply.ts) |
| 効果の登録・解決 | [構造化効果の実装ナビゲーション](11_structured-effect-model.md) |
| 状態ベース処理 | [state-based-actions.ts](../../../packages/rules-core/src/state-based-actions.ts) |
| ターン進行 | [turn-system.ts](../../../packages/rules-core/src/turn-system.ts) |
| 公開エントリポイント | [index.ts](../../../packages/rules-core/src/index.ts) / [runtime.ts](../../../packages/rules-core/src/runtime.ts) |
| ルール回帰 | [test](../../../packages/rules-core/test/) |

網羅的なファイル一覧はここで複製せず、必要なディレクトリを `rg --files` で調べる。
ソースの存在と公開エントリポイントへの配線は別に確認する。

## card-dataとGUI

- カード定義は [src/cards](../../../packages/card-data/src/cards/) にパック単位で置く。[generated-index.ts](../../../packages/card-data/src/generated-index.ts) が `ALL_CARDS` / `getCardByNo()` を公開する。ルール処理本体はここへ書かない。
- 追加は [カード追加判断表](../28_policy/04_card-addition-decision-table.md)、訂正は [更新フロー](../28_policy/06_card-data-update-flow.md) を参照する。
- GUIの入口は [BattleScreen.tsx](../../../apps/playground-web/src/components/BattleScreen.tsx)、APIは [game-api.ts](../../../apps/playground-web/server/game-api.ts)。画面ごとの詳細は [目的別索引](../README.md) から辿る。
- [scenarios.ts](../../../apps/playground-web/src/scenarios.ts) と [e2e](../../../e2e/) は盤面・操作の検証入口。scenarioとroomで確認できる同期方向が異なるため、[検証範囲](../25_gui/12_bidirectional-e2e-pattern.md)を確認する。

## 件数と検証

カードやテストの件数は変動するため、この構成図には固定値を置かない。
カード面とnested effectsの集計は `pnpm cards:coverage`、カードとテストの対応は `pnpm cards:test-coverage`、実行ケース数は対象テストの実行結果を使う。
結果を記録する場合は対象tree・日時・集計単位を併記し、構造上の件数を意味的な実装済み件数と取り違えない。

CIは [.github/workflows/ci.yml](../../../.github/workflows/ci.yml)、検査の選択と正源は [検証運用](../00_meta/harness-validation.md) を参照する。
`dist`、`node_modules`、`*.tsbuildinfo` は生成物であり、通常の実装調査はソースから始める。

## 読み始める順

1. [目的別索引](../README.md) と [現役ToDo](../30_plan/02_detailed-todo.md) で対象を特定する。
2. ルールを扱う作業は関連する `10_rules`・[出典](../00_meta/source-map.md) を先に確認し、未確定の点だけ [未解決質問](../00_meta/open-questions.md) を辿る。
3. この地図から該当ソース・回帰テストへ進み、根拠と実装の一致を確認する。

battleの設計は [バトルモデル](07_battle-and-effect-model.md)、コアの設計は [コア資源モデル](06_core-resource-model.md)、独自拡張は [拡張方針](../28_policy/05_custom-extension-policy.md) を参照する。
