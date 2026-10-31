# Phase Roadmap（初期計画の記録）

本書のフェーズ・状態・件数は初期計画と2026年5月当時の記録であり、現在の実装状況や着手順ではない。
現在の判断には [現役ToDo](02_detailed-todo.md)・[issue索引](../../../issues/00_index.md)・[ISMCTS実行計画](ismcts-full-run/README.md) を使う。本書の過去状態を現状へ書き換えない。

## Core Principle

このプロジェクトの最重要方針は、**再利用可能なルールエンジンを先に作ること**です。

- 最初から手動操作専用UIに寄せすぎない。
- 最初からAI専用の入出力にも固定しない。
- まずは UI 非依存・操作主体非依存のルールコアを作り、その上に
  - 手動操作UI
  - AIクライアント
  - 対戦ゲーム用フロント
  を載せられる形にする。

この方針により、MVP 段階では「遊べる見た目」よりも

- ルールの正確性
- 状態遷移の再現性
- ログ/リプレイ可能性
- API からの操作可能性

を優先する。

## 当時のサマリ (2026-05)

以下は当時のスナップショット。新規参加者は [目的別索引](../README.md) と [現役ToDo](02_detailed-todo.md) から現在地を確認する。

- **Phase 0-5: 完了**。ターン構造、コスト、状態処理、盤面操作、バトル骨格まで実装済み（残: バトル `フラッシュ` の custom stack 拡張、バースト/派生誘発の group 整理）。
- **Phase 6 (カードデータ運用): 進行中**。DSL v2 確立済み、カバレッジ 127/621 ≈ 20.4%、目標 80%+。Task A で弾順に追加中（次は BSTH05.5）。DSL ギャップは P3-14、P2-07 の未対応ギミック基盤は完了済み。
- **Phase 7 (AI/UI): 大半完了**。GUI、REST API、デッキ構築、シナリオテストまで実装済み。残: 効果解決キュー UI、複数ブロッカー GUI（エンジン待ち）、SVG/PNG エクスポート、BGM/SE 生成連携。
- **次の主要タスク**: BSTH05.5 effects 追加 (Task A)。詳細は [`02_detailed-todo.md`](./02_detailed-todo.md)。
- **active な技術的負債**: [issues/00_index.md](../../../issues/00_index.md)。鮮度 28 日超は `pnpm docs:lint` で warn される。

各 Phase の状態マーカー: ✅ 完了 / ⏳ 進行中 / 🟡 大半完了。

## Phase 0: 調査基盤を固定する ✅

成果物:

- ソース一覧
- 未解決論点一覧
- AI向け参照構造

完了条件:

- 新しく参加する AI/人が `manual/ai-reference/README.md` から読み始められる。

## Phase 1: ルールコアの骨組みを作る ✅

成果物:

- `GameState`
- `CardDefinition`
- `CardInstance`
- `BattleEntity`
- ステップ遷移器

完了条件:

- ターンを空で 1 周できる。

## Phase 2: コスト・使用・解決を実装する ✅

成果物:

- 軽減計算器
- 支払い処理
- マジック使用パイプライン
- 効果チェーン

完了条件:

- マジック 1 枚を正順で使い、ログと後処理まで通る。

## Phase 3: 状態ベース処理を実装する ✅

成果物:

- 消滅判定
- 待機状態
- 遅延トラッシュ移動
- 対象制限

完了条件:

- 支払い起因消滅と派生効果遅延が再現できる。

## Phase 4: 盤面操作を実装する ✅

成果物:

- スピリット召喚
- ネクサス配置
- コア移動
- コア資源レイヤの分離
- ブレイヴ合体/交換/分離

完了条件:

- 盤面主体の変化が一通り表現できる。
- カード本体移動とコア移動を別処理で追える。

## Phase 5: バトルを実装する ✅

成果物:

- 通常アタック
- battle 中の即時効果解決レイヤ
- フラッシュ窓
- ブロック
- group 単位のバトル解決
- 指定アタック

完了条件:

- 1 回のアタックが、battle 中即時効果と `⑤バトル解決` を取り違えずに、宣言から終了時まで完走する。

補足:

- 現状は、`attack` / `block` 宣言、`activeAttack`、`battleImmediateEffects` による `アタック時` / `ブロック時` / `途中参加` 効果の最小 prompt 解決、`open_battle_flash` / `pass_battle_flash` による `flash_before_block` / `flash_after_block` の最小 open/pass 窓、さらに battle flash 中の最小 `use_magic` / `use_field_card_effect(timing=flash)` legal action、`start_battle_resolution` / `resolve_battle_resolution` による `battleResolutionGroup` の最小 group 解決までは入っている。
- 未実装: battle 窓の `フラッシュ` を custom `stack` まで広げること、`⑤バトル解決` 中のバースト待機 / 派生誘発待機の group 単位整理。

## Phase 6: カードデータ運用を実装する ⏳

成果物:

- カード定義スキーマ
- 取り込みフロー
- キーワードタグ付け
- ソース provenance
- 独自カードサイトの errata / Q&A 取り込み方針
- custom mechanic の extension policy

完了条件:

- 数枚のサンプルカードをデータ駆動で処理できる。
- 公式ルールと独自ギミックの境界、および custom source precedence が明文化されている。

補足:

- Phase 6 の一部は battle と並行で実施済み。
- 実施済み:
  - `displayCostText` を `CardDefinition` に追加した。
  - `黒` / `七色` は `CardColor` に `"black"` を追加して対応した。
- 未実装:
  - `updatedAt` フィールド。
  - `導シンボル`（神シンボルと同カテゴリとして追加）。
  - `cardNo` ベース差し替えの card-data 更新単位。

## Phase 7: AI運用と回帰基盤を固める 🟡

成果物:

- `legalActions` API
- 盤面サマリ
- リプレイ
- ゴールデンテスト

完了条件:

- AI が状態を読んで合法手を選べる。

## 優先順の結論

- 先に「全カード対応」を目指さない。
- 先に「見た目の完成形」を目指さない。
- 先に「再利用可能なルールエンジン」を成立させる。
- 先に
  - ステップ
  - 支払い
  - 効果チェーン
  - 待機状態
  - バトル窓
  を固める。
- 独自カードの継続投入にはカード定義 schema と source metadata の整備が前提。
