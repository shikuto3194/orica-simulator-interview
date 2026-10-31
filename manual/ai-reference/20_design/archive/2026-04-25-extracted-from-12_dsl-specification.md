# 12_dsl-specification.md 退避: 旧設計スナップショット + 過去型拡張ログ

退避日: 2026-04-25 (P6-01 Phase 5: docs:lint 警告解消)

退避元: `manual/ai-reference/20_design/12_dsl-specification.md`

退避理由: 行数 / 長行ともに reference 系閾値超過。旧 DSL v2 設計スナップショットの参考リンクと、過去の型拡張履歴は実装の正源（`dsl-types.ts`）と独立しており、ドリフトもあるため日常参照の優先度が低い。

---

## 旧 DSL v2 設計スナップショット（2026-04-25 時点で参考のみ）

`manual/_legacy/dsl-v2-design/` 配下は P3-12 以前の初期設計。

| ファイル | 役割 | ステータス |
|---------|------|-----------|
| [`dsl-v2-foundation.ts`](/manual/_legacy/dsl-v2-design/dsl-v2-foundation.ts) | 初期設計スナップショット（基盤型・フィルタ・軸1〜3） | 参考のみ／ドリフトあり |
| [`dsl-v2-effects.ts`](/manual/_legacy/dsl-v2-design/dsl-v2-effects.ts) | 初期設計スナップショット（軸4: アクション） | 参考のみ／ドリフトあり |
| [`dsl-v2-examples.ts`](/manual/_legacy/dsl-v2-design/dsl-v2-examples.ts) | 初期設計の実例カード（パチュリー、青い薔薇の花言葉、アリス契約ネクサス、転醒カード） | 参考のみ |
| [`dsl-v2.ts`](/manual/_legacy/dsl-v2-design/dsl-v2.ts) | 初期設計のエントリポイント（re-export） | 参考のみ |

P3-09〜P3-14 で以下を拡張しているが、上記初期設計には反映していない:

- `DynamicCount.source` に `count_value` / `event_amount` 追加 + `offset`
- `CardFilter.targetsGrandwalker` / `battleState`
- `StepCondition.ref_count` / `ref_choice` と全変種 `not?`
- `EffectStep.chooser` / `retrigger`
- `Effect.limitGroupId` / `cardEventDisposition` / `timingScope` / `stub`
- Action 追加種: `stay_on_field` / `enter_soul_state` / `leave_soul_state` / `count_decrease` / `count_set` / `move_self` / `divine_transform` / `additional_attack` / `life_damage_interception` 等

新規仕様の参照は `packages/rules-core/src/dsl-types.ts` を一次ソースとする。

## 過去の型拡張ログ

DSL 表現力不足を解消するため実施した主な拡張（履歴ログ。現行型は `dsl-types.ts` を参照）:

| 拡張 | 対象型 | 解消パターン |
|------|--------|-------------|
| `Effect.timingScope` | dsl-types.ts | continuous 効果のステップ限定（メインステップの間等） |
| `game_event.triggerFilter` | model.ts (Timing) | 召喚トリガーのカードフィルタ条件（系統・コスト・色） |
| `DeckRevealAction.player` | dsl-types.ts | 相手デッキのオープン |
| `SymbolAddAction.symbol[]` | dsl-types.ts | デュアルカラーシンボル（赤/紫として扱うシンボル） |
| `Effect.limitGroupId` | dsl-types.ts + model.ts | 召喚/アタック分離効果の使用回数共有 |
| `activated.deferredTo` | model.ts (Timing) | バトル終了時への遅延実行 |
| `BurstTrigger` 構造化 | model.ts | ライフ減少後等の型安全なバースト条件 |

P3-09 / P3-10 / P3-11 は完了済み（2026-04-15 に issue ファイル削除、履歴は git log 参照）。以降の DSL 表現力の残課題は `issues/P3-14/index.md` で管理。
