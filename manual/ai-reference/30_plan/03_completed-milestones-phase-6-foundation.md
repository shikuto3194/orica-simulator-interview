# Completed Milestones: Phase 6 — 基盤・カードデータ

このファイルは、Phase 6 の「カードデータ基盤整備・BSTH 各弾 effects 追加（初期〜第1パス）」の完了履歴です。
索引は [03_completed-milestones-phase-6.md](./03_completed-milestones-phase-6.md) から辿ります。

## Phase 6: データと DSL — 基盤・カードデータ追加

- `packages/card-data` に手入力サンプルカード群を用意した。
- `keywordTags`、`textLines`、`sourceUrls`、`sourceConfidence` を使う前提を整えた。
- `04_card-addition-decision-table.md` を追加し、カード追加時の分岐基準を整理した。
- `05_custom-extension-policy.md` を追加し、独自カードサイト由来 mechanic の取り込み方針を整理した。
- `07_custom-orica-mechanics.md` を追加し、独自 mechanic の観測結果と open question を整理した。
- hand-written resolver / hand-written placement policy / registry ベースの暫定拡張路を整えた。
- `導界者ネクサス` / `導シンボル` / `黒` / `七色` / `クォーツ` / `スタック` などは、schema 前倒し候補として plan に明記した。
- card-data schema 前倒しとして以下を実施した（独自カード本格追加前の整備）。
  - `CardColor` 型に `"black"` を追加。`cost-system.ts` の `CARD_COLORS` / `createEmptyColorCounter()` に `"black"` 追加。
  - P2-07 H-3 完了: `exactly six` vs `at least six` 色数比較関数を実装。`countUniqueColors()` / `matchesColorCount()` ユーティリティ + `self_color_count` 条件 + `minColorCount` / `maxColorCount` フィルタ。21テスト追加。
  - P2-07 Phase A 完了: カウントエリア完全化（executeCountIncrease/Rebirth/Decrease/Set）、魂状態（soulStateInstanceIds+アタック/ブロック禁止+軽減除外+効果対象除外）、手元ゾーン（set_aside+召喚/配置許可）。18テスト追加。
  - P2-07 Phase B 完了: 転醒完全化（A面自動復帰・Lv検証・同時不可・バトル中再計算）、契約完全化（ゲーム開始手順・魂状態置換・バースト不発動・魂状態クリーンアップ）。14テスト追加。
  - P2-07 Phase C 完了: 煌臨基盤（AdventData/executeAdvent/煌臨元スタック管理/状態引き継ぎ/合体条件不適合分離/多重煌臨/契約煌臨/F契約煌臨）。33テスト追加（全604テスト通過）。
  - `CardDefinition` に `displayCostText?: string` を追加した（`"C2"` / `"X+3"` などの非数値コスト表示用）。
  - `07_custom-orica-mechanics.md` の `黒/七色` と `導界者ネクサス/導シンボル` の実装含意を更新した。
  - スキップ: `updatedAt`（実カード大量追加時に非破壊で追加可能）、`導シンボル`（神シンボルと同カテゴリ、MVP外）。
- burst 条件の多様性調査を踏まえ、`pendingTriggeredEffects` / `pendingBurstChecks` を共有する structured trigger model へ寄せる方針を確定。`StructuredTriggerEvent` 型を定義し `PendingTriggeredEffect` / `PendingBurstCheck` に接続。マッピング3種（life_reduced/card_destroyed/attack_after）実装。
- registration を `eventKind` 直指定から `TriggerEventMatcher` ベースに移行。`matchesTriggerEvent()` 共通関数追加、`eventMatcher` 未設定時の互換 fallback、`attack_after` の検証を `validationMode` に一般化。テスト2件追加。

- `SpecialSymbol` 型 (`"god"` / `"guide"` / `"ultimate_symbol"` / `"seven"` / `"six"`) と `SymbolColor = CardColor | SpecialSymbol` を `model.ts` に追加した。`reductionSymbols` / `symbolColors` を `SymbolColor[]` に拡張。
- `CardDefinition` に `tribe?`, `image?`, `rarity?`, `pack?`, `maxDeckCount?` フィールドを追加した。
- 567 枚のカードデータを 37 パックに変換した。
  - `packages/card-data/raw/cardData.js` の自然言語データを `packages/card-data/scripts/convert-raw.ts` で `CardDefinition[]` に変換。
  - パック別に `packages/card-data/src/cards/{packCode}.ts` として出力。`generated-index.ts` で統合エクスポート。
  - 色マッピング（赤→red 等）、特殊シンボルマッピング（神→god 等）、2文字シンボル分割（白導→white+guide）、レベルパース、キーワード抽出を実装。
- textLines 空行保持: convert-raw.ts で効果ブロック区切りの空行を `""` として保持。EffectQueueOverlay の `splitTextBlocks()` でブロック区切りとして認識。
- BSTH01-C02「霧雨 魔理沙」効果実装（プロジェクト初の StructuredEffect 定義）:
  - エンジン拡張: `while_on_field` 期間、`count:-1`（全対象）、`ContinuousEffect.targetFilter`（動的BPマッチング）、`PendingDeckReveal`（デッキ公開待ちフロー）、`continuous` timing の summon/place 時実行。
  - trigger system 統合: on_summon を trigger system 経由に変更。`triggerBeforeState` で zone 変化検出。structured effects fallback 追加。optional 効果はプレイヤー選択。
  - UI: `DeckRevealModal.tsx`、ActionBar 誘発効果ボタン、処理中の操作無効化、解決キューからカード詳細モーダル。
  - テスト: 371/371 通過（新規4件追加）。
- BSTH02/02.5/02.7 全38枚の effects 追加完了（DSL型拡張2種含む）。リサーチに基づく修正も同時実施。
- BSTH03 全24枚（＋転醒裏面2枚）の effects 追加完了（effects 79個定義）。
  - 対応効果パターン: deck_reveal/symbol_add/treat_as/core_move/burst/destroy/bounce/send_to_deck/vanish/remove_from_game/exhaust/重疲労/prevent_battle/effect_resistance/rebirth/count_increase/draw/discard_hand/return_from_trash 等 20種以上。stub 付き未対応パターンは別途管理。
  - 型チェック通過、371 unit tests 全通過。
- BSTH03 作業で判明した DSL 型拡張3種を実装: `countValue`（カウント条件）、`lifeValue`（ライフ値条件）、`DiscardHandAction.targetHandSize`/`targetPlayer`、`tribesLogic`（"and"/"or"切替）。BSTH03/02 の関連カードを新型に更新。

- BSTH04 全12枚（＋転醒A面2枚＋転醒B面2枚）の effects 全面再定義完了（effects 52個定義、DSL型拡張6種）。
- BSTH04.5 全1枚の effects 全面再定義完了（effects 3個、DSL型拡張6種: selfCard/maxPreventable/restrictFlash/fieldCard条件/subTiming/fieldCardコア源）。
- BSTH05 全17枚の effects 全面再定義完了（effects 45個定義）。
  - 全カードの textLines を精読し StructuredEffect DSL で effects フィールドを再定義。旧自動変換版を全面修正。
  - 対応効果パターン: deck_reveal/core_move/bounce/exhaust/重疲労/send_to_deck/recover/unblockable/negate/summon_self/effect_immunity/treat_as/bp_modify/restrict_flash/summon_from_zone/discard_hand/symbol_add 等 20種以上。stub 付き未対応パターンは別途管理。
  - DSL型拡張3種: `BounceAction.maxPreventable`、`SendToDeckAction.maxPreventable`、`SummonFromZoneAction`（overrideCost/fullReduction対応）、`burstTrigger`。
  - 型チェック通過、371 unit tests 全通過。

### カードデータ・DSL 追加項目（初期パス）

- StructuredEffect DSL を拡張（bounce / discard_hand / send_to_deck / deck_reveal + noFieldCard 条件）。tribe マッチング修正（複合系統文字列対応）。BraveCondition に minCost / cardNames 追加。
- 全弾にカード効果（effects）を第1パス追加（17 枚）。braveCondition を 50 枚に追加。
- `structured-effect-registrations.ts` で effects → トリガー登録自動生成。GUI（BattleScreen.tsx）と API（game-api.ts）に接続し、effects を追加するだけで GUI 上で効果が自動発火するパイプラインを構築。
- e2e シナリオテストを効果実行結果検証型に改善（DSL / summon テスト）。
- GUI-API 状態同期を実装（`useGameSync` フック + `PUT/GET /api/game/state` エンドポイント）。シナリオモードでも push → API で bob 操作可能。
- DSL シナリオテストを alice=GUI / bob=API 双方向テストに書き換え。20 e2e + 352 unit tests。
- BSTH04/04.5/05 全カードに StructuredEffect を段階的追加（第1パス→スキップ分追記→Task B 着手→全面再定義で完了）。DSL 拡張: `field` コアロケーション、`targetState`（重疲労）、`CountIncreaseAction`、`PreventAttackAction`、`PreventLifeDamageAction`、DiscardHand count:-1、core_move 新パス4種、`VanishAction`、`NegateAction`、`SummonSelfAction`（バーストからのコストなし召喚）、`EffectActivationCost`。366 unit tests 全通過。
- BSTH01〜03 の effects 未定義カード 66 枚に一括追加（BSTH01: 17枚、BSTH02: 14枚、BSTH02.7: 15枚、BSTH03: 20枚）。全パック effects 定義完了。
- BSTH01〜BSTH05 テキスト再評価: bp_modify amount:0 プレースホルダー全廃止、誤解釈修正、欠落効果追加。
  - DSL 拡張: `UnblockableAction`, `EndAttackStepAction`, `EffectImmunityAction`, `CostOverrideAction`, `on_opponent_flash` EffectTiming。
  - symbol_add/bp_modify を ContinuousEffect 基盤に連携（CE 登録で実動作）。
  - BSTH01: 22件修正、BSTH02: 65件修正、BSTH02.7: 多数追加、BSTH03: プレースホルダー廃止+スタック効果追加、BSTH04/04.5/05: bp_modify amount:0 = 0件確認済。
- カード別修正内容: 27枚を textLines 基準で全面修正（symbol_add→treat_as 変換、on_revealed トリガー、バースト後効果、耐性分類整理等）。
  - DSL 型拡張（model.ts）: EffectTiming 4種追加、新アクション型 8種（TreatAs/RemoveFromGame/EffectResistance/PreventBattle/DrawModify/SummonSelfFromHand/LifeFill/AdditionalAttack）、EffectCondition 拡張5種、EffectTarget 拡張4種、DeckRevealAction remainder: `top_or_bottom`、`textRef`/`stub` フィールド、`payCost`。371 unit tests 全通過。
- DSL: `additional_cost` アクション追加（「コストはXとしても扱う」）。BSTH01-C01 に適用。

### Phase 6 追加完了項目（02 から移動）

- BSTH04 effects 全面再定義完了（12枚＋転醒A/B面各2枚、effects 52個）: textLines 基準で全面書き直し。全カードに textRef 追加。欠落効果を補完。転醒B面に effects 配列を新規追加。
- BSTH01-C02 effects 実装完了（プロジェクト初の StructuredEffect 定義）: `while_on_field`/`count:-1`/`targetFilter`/`PendingDeckReveal`/`DeckRevealModal.tsx`/trigger system 統合等。
- textLines 空行保持 + convert-raw.ts effects 自動マージ保持。

- BSTH04.5 effects 全面再定義完了（1枚、effects 3個）。DSL 型拡張 6 種: selfCard, maxPreventable, restrictFlash, fieldCard条件, subTiming, fieldCardコア源。インタプリタに `restrict_flash` stub 追加。371 unit tests 全通過。
