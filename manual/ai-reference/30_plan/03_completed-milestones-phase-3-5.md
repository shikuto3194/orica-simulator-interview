# Completed Milestones: Phase 3-5

このファイルは、Phase 3 から Phase 5 までの完了履歴です。
通常は [03_completed-milestones.md](./03_completed-milestones.md) から辿ります。

## オンライン選択と宣言済み誘発の進行監査（2026-10-03）

[2件の原因・共通修正・同類監査・回帰](./03_completed-milestones-phase-3-5-snapshot-progress.md)。

## Phase 3: 状態ベース処理

- コア不足による消滅判定（`pendingLeaveKind="vanish"`）。
- `cost_payment` 起因の消滅遅延（`deferZoneMoveUntilChainEnd`）。
- `消滅待機状態` の効果フィルタ（通常効果は弾き、`vanish_related` / `leave_field_related` を許可）。→ **Ver.17.0 で廃止**: 全待機状態を破壊と統一し、消滅待機の効果フィルタ特別制約を撤廃。
- `runActionMainResolution()` で `resolver -> SBA -> flush` の共通流れ。
- `pendingLeave` とコア移動先 override 接続。カード本体移動とコア移動の分離。
- 軽減計算で消滅待機中のみシンボル除外、ネクサスはコア0でも消滅しない。→ **Ver.17.0 で変更**: 軽減計算の vanish 除外フィルタ撤去。全待機状態でシンボル軽減可能に。
- 不正バーストセット検知と `GameResult` によるゲーム終了モデル。
- 「離れるとき」(pre-leave) と「離れたとき」(post-leave) 誘発の分離。
- 同時バースト発動時の防御側優先解決。
- `gameResult` 設定後のゲーム進行停止。

### 契約カード・合体ブレイヴの離脱選択（2026-09-09）

公式 Q1501 / Q1533 / Q27659 と Q420 / Q436 / Q480 を確認。発動宣言は待機入り時、魂状態・ブレイヴ残留の選択は離脱関連効果と派生効果の解決後、実移動直前に統一した。
同行ブレイヴをホストと同じ離脱チェーンで確定し、魂状態辞退時のフィールド残留を修正。辞退済みバーストの再宣言、離脱効果の二重誘発、魂状態で条件を失ったバーストの取消も整備。
回帰テスト: `leave-choice-resolution-boundary.test.ts`、既存の離脱・バトル・カードテスト、`e2e/scenario-contract-leave-choice.spec.ts`（alice GUI / bob REST、魂状態の両選択）。ルール根拠は [離脱選択](../10_rules/04d_leave-choice-timing.md) に記録。

## Phase 4: 盤面操作

- アルティメット召喚条件（`summonCondition` predicate）。
- `summon` / `place_nexus` を legal action と direct runner の両方で実行可能に。
- 手札からカードを使う実行系整理（validation / resolution / placement-policy / placement-execution）。
- 召喚/配置の直後 self-effect と target 付き効果を shared resolver 経由で実行。
- field-card effect の共通 action runner。
- 特殊初期コア配置ルール（`required_minimum` / `optional` / `forbidden`）。
- `keywordTags` と hand-written placement policy registry の併用。
- コア資源レイヤの一次分離（`normalCoreCount` / `soulCoreLocation` / `void` / `removed_from_game`）。
- `moveNormalCores` / `moveSoulCore` / `refreshTrashCoresToReserve` / `resolveCardLeavesFieldCores` 追加。

## Phase 5: バトル

### 基本アタック/ブロック
- `attack` / `block` legal action。アタック宣言・疲労・attack window 遷移。
- `activeAttack`（target / blockAssignments / symbolResolutionOrder）。
- `joinActiveAttackAsAction` で複数体アタック。
- `battleImmediateEffects`（attack / block / join timing）。
- アタック中スピリット離脱時のライフダメージなし処理。

### フラッシュ/スタック窓
- `flash_before_block` / `flash_after_block` の open/pass 窓。
- battle flash 中の `use_magic` / `use_field_card_effect`（`timing=flash` / `timing=stack`）。
- `ActiveStack` + `pendingStackAction` で linked stack / LIFO 解決。
- `Window` に `stack_before_block` / `stack_after_block` 追加。
- stack 解決前の target field 存在再確認。

### アタック/ブロック宣言前スタック窓
- `PreDeclarationStackWindow` で仮宣言→相手 stack 応答→有効性再確認→確定/キャンセル。
- magic / field effect サポート（2-pass 解決モデル）。

### バトル解決
- `battleResolutionGroup` / `start_battle_resolution` / `resolve_battle_resolution`。
- unblocked ライフ減少、blocked BP 比較、battle 起因の破壊待機と flush。
- battle group 終端で `pendingTriggeredEffects` / `pendingBurstChecks` に積む collector。

### 指定アタック
- `AttackLegalAction.targetInstanceId` で spirit-targeted attack。
- 宣言確定後に `attack_after` burst → tentative revalidation → still-valid なら強制 block / 消失なら通常 attack fallback。
- 強制ブロックも `pre_declaration_stack` を経由。stack 中に対象消失で fallback。

### battle 外 stack
- `main_step_stack`（`timing=flash` magic / field effect → 相手 `stack` 応答 → 解決）。
- `timing=main` magic、`timing=normal` field effect にも拡張。
- `summon` / `place_nexus` も main step stack 経由。
- バースト発動の 2 段階スタック窓（発動宣言 / 効果発揮宣言）。
- `hasFollowUp=true` バーストの main_step_stack 経由解決。

### ブレイヴ
- ブレイヴのスピリット状態召喚を実装。`getHandCardLegalActionKind` と `isBattleCapableCategory` に `brave` を追加。シンボル有無はカード定義に依存。
- ブレイヴ合体を実装。`BraveCondition` 型（categories/colors/tribes）を `CardDefinition` に追加。`BraveCombineLegalAction` でフィールドのブレイヴをスピリットに合体（`attachedToInstanceId` / `attachedChildrenIds` 更新）。1体1ブレイヴ制限。
- 合体条件喪失時の強制分離を実装。`collectStateBasedActions` に `brave_forced_separation` チェックを追加。SBA で `braveCondition` を再評価し、条件未達なら合体リンクを解除。
- 合体スピリット破壊時のブレイヴ残存処理を実装。`flushPendingLeaves` でホストが破壊される際、合体中ブレイヴの `attachedToInstanceId` を解除してフィールドに残す。ブレイヴのコアが Lv1 未満なら既存 SBA で消滅。
- ブレイヴ分離を実装。`BraveSeparateLegalAction` + `getAvailableBraveSeparateLegalActions` + `applyLegalAction` の `brave_separate` ケース。分離後の疲労状態引き継ぎ済み。ActionBar に「分離」ラベル追加。
- ブレイヴ交換を実装。`BraveSwapLegalAction` + `getAvailableBraveSwapLegalActions`。合体中ブレイヴを別の未合体スピリットに移動。合体条件チェック付き。コア移動なし。
- 分離時の追加コア補填を実装。ブレイヴの Lv1 必要コア不足分をリザーブから自動補填。リザーブ不足時は分離合法手から除外。
- ブレイヴ合体のドラッグ&ドロップ UI を実装。フィールドのブレイヴをスピリットにドラッグして合体。
- 合体スピリットの合成表示を実装。合体済みブレイヴをスピリットの斜め上に小さく重ねて表示。
- ブレイヴ/アルティメットのスピリット状態召喚 validation を修正（2026-05-28）。`getHandCardAndDefinition` の `expectedCategory` が `"spirit"` 固定で brave/ultimate を弾いていた（`Card category does not match action` で silent failure）バグ。`expectedCategories` 配列化し summon は spirit/ultimate/brave 許可。
- 直接合体召喚を実装（2026-05-28）。`BraveCombineSummonLegalAction` + `getAvailableBraveCombineSummonLegalActions`（手札ブレイヴ × 合体条件を満たすホスト）。`playBraveCombineSummonEnterFieldAsAction` が `combineHostInstanceId` で場入りと同時に attach（場入り解決中の SBA 消滅回避）→ ブレイヴ上のコアをホストへ移動。コア配置は任意 (min 0)。GUI はカードアクションに「直接合体召喚」を追加し合体先選択 → コスト支払い → 配置フローへ。
  - フォローアップ（2026-06-06）: ブレイヴ召喚のスタック窓 + 合体決定タイミングを修正。詳細裁定は memory `project_brave_combine_summon_stack_window`。
    - 正しい手順: 宣言→コスト支払い→スタック窓→（窓クローズ後の解決時に）合体可否+host を決める（合体可否はスタック窓より後。`02_turn-flow-and-timing.md:188` +`05_brave-and-attack-special-cases.md`「召喚時にすぐに合体」=場入りの一部）。修正前は「窓を開かない」バグ、中間修正で「宣言時に host 選択」の誤りがあった。
    - 実装: 通常 `summon` でスタックを開き、窓クローズ後に `pendingBraveCombineChoice`（新 state）で `resolve_brave_combine_choice`（host or null=スピリット状態）→ `pendingEnterFieldPlacement`（合体=min 0 / スピリット=Lv1）→ 場入り。候補 host は解決時点の盤面から `getValidBraveCombineHosts` で算出。`brave_combine_summon` 宣言時アクション + 宣言時 host 選択は廃止。GUI「直接合体しますか？」は engine pending 駆動。
    - affordability: 合体先があれば場入りコア 0 で足りるため summon を実効最小配置 0 で提示（合体先なしは Lv1 必須）、合体選択のスピリット状態は Lv1 を払える時のみ提示（soft-lock 回避。共通ヘルパー `getAvailablePlacementCoreCount`）。
    - 窓中に合体先が離れ スピリット状態 Lv1 も払えない稀ケース（裁定 2026-06-06）: 召喚は無効化せず、場入りコア最小値を 0 に緩めて 0 コアで場入り → コア最低Lv未満を既存 SBA に委ねトラッシュ消滅（`04_state-based-rules.md`:63 / `05_brave:75`）。テスト 12 件 + GUI シナリオ `brave-combine-summon`。
- 合体中ブレイヴを SBA コア欠損消滅の対象外に修正（2026-05-28）。`collectStateBasedActions` で `attachedToInstanceId !== null` のカードはコア欠損判定をスキップ。Lv1 必要コア≥1 のブレイヴ（X09 等）が合体時にコア 0 で消滅していた取りこぼしも併せて解消。
- ブレイヴ/アルティメットの誘発・field・burst・battle 効果が silent drop されていた重大バグを修正（2026-05-28）。`source_kind_category_mismatch` チェック 4 箇所（trigger/burst/field/battle）が `printedCategory === sourceKind` で素朴比較しており、登録 sourceKind="spirit" のブレイヴ（printedCategory="brave"）/アルティメット（"ultimate"）が全て弾かれていた。`source-kinds.ts` に `isCategoryCompatibleWithSourceKind` を追加し 4 チェックを互換判定に統一（spirit↔{spirit,brave,ultimate}、battle のみ ultimate↔ultimate）。アルティメット 38 枚・ブレイヴ 74 枚の効果が発火するように。
- ブレイヴ自身の「召喚時」効果を発火可能に修正（2026-05-28）。`collectTriggerEventsFromStateDelta` で zoneRoleName="brave" も summon イベントを発行（通常召喚・直接合体の両方）。ブレイヴ召喚はスピリット召喚ではないため、汎用 responder（game_event:summon / burst:summon）は `isBraveSummonEvent` で除外し、ブレイヴ自身の card_event:summon のみ発火。oracle は既存 zoneRoleName チェックで brave 除外済みのため変更不要。`sourceKind` も召喚カテゴリ由来に精緻化（spirit/ultimate/brave→spirit、nexus）。回帰テスト 5 件追加。
  - 残留: 汎用 game_event:summon responder はブレイヴ被召喚を一律除外する。将来「ブレイヴが召喚されたとき」型 responder を追加する場合は triggerFilter への category フィルタ対応が必要。

### ライフダメージ確定ブロック
- ブロック宣言成立後にブロッカーが消滅してもライフダメージなし — `createBattleResolutionGroup` がスナップショットベースで `blockedBy` を保持するため、既に正しく動作していることを確認。

### コスト支払い元選択 UI
- フィールドカードからのコスト支払い元選択 UI を実装。召喚/配置/マジック使用時にフィールド上のカード（コア搭載済み）からもコストを支払えるように。リザーブ分は自動計算、フィールドカード分は +/− で手動割当。コア不足で消滅するカードも正しく処理される。
- 召喚/配置の legal action 生成時にコア配置分のリザーブ確保を検証するチェックを追加。`canFullyPay` だけでなく `reserveAvailable - minPlacement + fieldCoreTotal >= finalCost` を確認し、実行不能な合法手が生成されないようにした。
- フィールドからのコスト支払いに関するユニットテストを追加（`applyCardCostPayments` のフィールドカード支払い、消滅マーク、支払い元列挙、配置コア不足での合法手除外、混合支払いでの召喚実行）。

### ターン開始時誘発効果ウィンドウ
- `advanceStep()` でスタートステップ到達時に `start_step` の `PendingTriggeredEffect` を自動キュー。
- `TriggerEventKind` に `"start_step"` を追加、`StructuredTriggerEventFamily` に `"step_timing"` を追加。
- `trigger-system.ts` の `triggerEventKindToMatcher` / `triggerEventKindToStructuredEvent` を拡張。
- デッキ0枚敗北時（`gameResult` 設定済み）はキューしない。
- ユニットテスト 5 件追加。

### ターン終了時効果ウィンドウ（2段階）
- `advanceStep()` を3フェーズに分割:
  1. attack→end: `window: "end_step_effects"` を設定し `end_step` の `PendingTriggeredEffect` をキュー。
  2. end_step_effects→end_step_cleanup: `removeExpiredContinuousEffects()` で `this_turn` / `until_end_of_opponent_turn` 効果を除去。
  3. end_step_cleanup→start: 次ターンのスタートステップへ遷移。
- `TriggerEventKind` に `"end_step"` を追加。
- `enterEndStep()` / `advanceFromEndStep()` を分離ヘルパー化。
- レガシー互換: `step="end", window="none"` は `advanceFromEndStep` に直行。
- ユニットテスト 6 件追加。

### 合体スピリットのホスト破壊後ブレイヴアタック継続
- `getOrCreateCombatBattleEntity` で合体スピリットのブレイヴも `memberInstanceIds` に含めるよう変更。
- `queueBattleResolutionDestroys` でブレイヴ（`attachedToInstanceId !== null`）はバトル破壊対象から除外。ホスト破壊時に `flushPendingLeaves` が自動で分離。
- `resetBattleEntitiesAfterResolution` で部分生存を許容: 生存メンバーだけに絞って BattleEntity を保持。
- ユニットテスト 2 件追加。

### P3-14 A-1 アクティベーションコスト（ことで構文）
- `effect-interpreter.ts`: `didNonCardActionChangeState()` 関数追加。非カード移動アクション（count_decrease/core_move/life_damage 等）の `succeeded` 判定を実際の状態変化検出に修正。従来は `affected.length > 0`（カードゾーン変化のみ）で、`conditional_cost` のロールバックが誤発動していた。
- `structured-effect-interpreter.ts`: `executeCoreMove` に不足パス4種追加（`this_card→void`, `reserve→void`, `trash→void`, `reserve→this_card`）。
- ユニットテスト 8 件追加（count_decrease コスト成功/失敗/amount>1、core_move this_card/reserve コスト成功/失敗、discard コスト、sequential follow-up）。
- 830→838 tests。

### ライフ 0 敗北判定 + 致死ライフダメージのクランプ (2026-05-30)
- `resolveLifeDamage()`: `context` 付き呼び出し（バトル / `life_damage` DSL）で残ライフを超えるダメージを 0 まで頭打ちにクランプ。従来は throw して `Not enough life cores` でバトル解決がクラッシュしていた。context 無しの低レベルプリミティブ用途は不変条件として throw 維持。
- `applyLegalAction()` を `applyLegalActionCore` + 後処理ラッパーに分割。`isSafeStateForContinuousRebuild()` で「全窓が閉じた安定状態」を検出した瞬間にのみ `applyLifeZeroDefeat()` を評価（ライフ減少を引き金にしたバースト/フラッシュのライフ回復が解決し切ってから判定）。ライフ 0 が 1 人 → `player_loss` (`reason: "life_zero"`)、複数同時 → `draw`。
- 公式ルール根拠: 勝敗判定はライフ減少直後（[01_glossary-and-card-types.md](../10_rules/01_glossary-and-card-types.md)）。`life_zero` は従来 overlay ラベルのみで production 未設定だった。
- シナリオ `lethal-attack` 追加。テスト: `resolveLifeDamage` クランプ 2 件 + battle 経由 `life_zero` 敗北 1 件。

### その他
- `end_attack_step` アクション。
- `StackInteractionWindowState` / `stack-window-shared.ts` で timing 判定・nested stack・pass priority を共通化。
- リフレッシュステップの自動処理（疲労回復 + トラッシュ→リザーブ）を `advanceStep()` に統合。

### 攻撃者離脱後のバトル存続を共通化 (2026-09-07)

- ユウの【雷鎚：ショット】に対するグランギニョルのバウンス・転醒後、攻撃者不在でも防御側から前半フラッシュを行い、双方パス後のバトル終了時にアタックステップを終了する。
- 参加体除去の保持オプションと転醒・ブレイヴ辞退側のバトル破棄を撤去。共通ヘルパーが成立済み参照を保ち、既存の終了処理へ渡す。BP比較・ライフ計算は現在のメンバーと照合し、場に残る非参加者の履歴による誤破壊や同時アタックのライフ下限混入を防ぐ。`check:ssot` に離脱経路からの破棄を検出する規則を追加。
- 根拠: [バトルの存続と終了](../10_rules/02c_battle-lifetime-and-resolution.md)、公式エターナル Q17092（信頼度A）。回帰: `bsge01-shot-tx01-battle-continuation.test.ts`（魂状態選択/辞退）、ブレイヴ継続辞退・ブロッカー離脱。GUI/REST 再現: `?scenario=shot-rebirth-battle&manualOpponent=1`。

### 同一効果の派生誘発と離脱確定順序 (2026-09-11)

- 入力は `orica-snapshot-2026-09-11T08-41-26-959Z.json`。操作ログが空で魂状態選択の時刻も残っていないため、保存盤面から使用側カウント2・手札5枚、被破壊ユウを1コアのスピリット状態へ戻して再現した。過去操作の厳密なリプレイではない。修正前はサイレントクライの対象選択後、カウント減少誘発より魂状態選択・待機解除が先行した。
- 9月9日 `03025d250` は、離脱時誘発の宣言とその子孫チェーンだけを追跡した。同じ元効果の別処理から出るカウント等の誘発は、破壊専用チェーンと関係付かず取りこぼした。前回テストも「離脱時効果→カウント増加」の方向だけだった。
- 共通の差分収集時に、効果による新規離脱と同じ区間の別イベントの pending ID を関連付ける。離脱時反応は従来の離脱者別追跡を共用。非公開宣言・deferred・宣言済み応答スタック・派生効果を待ち、操作完了・スタックガード解除直後・内部の継続再開前の共通処理で離脱を再判定する。カード別分岐は追加しない。
- `after_triggers` は直前1処理ではなく区間全体を収集する。途中選択をまたぐ開始状態を `SerializedStepContext` に保持し、閲覧用サニタイズでは除去する。既収集イベントの区間への引き継ぎで重複誘発を防ぐ。外側のコスト支払い待機と、内側の「この効果発揮後」前の離脱を区別する。
- 回帰テストは増加・減少・ドロー、破壊・バウンス・除外・コア不足消滅、非契約、非公開宣言の保留、解決／辞退、JSON保存復元、無関係な離脱を検証。途中選択の復元後も、解決／辞退とも離脱選択が済むまで「この効果発揮後」を再開しない。リンクエイドの既存2ケースも「復帰誘発→ブレイヴ離脱選択」へ期待値を訂正した。
- 実カードシナリオ `?scenario=count-leave-order&manualOpponent=1` は合法手の発揮・応答・対象選択から構成。Alice GUIの発揮／辞退をAPIで確認し、Bob RESTで同等の状態遷移を検証。既存の魂状態・同行ブレイヴGUI/RESTと合わせ8ケース。単独シナリオはAPI更新の画面ポーリングをしない既存仕様のため、REST後の状態を画面の更新済み状態とは扱わない。
- 根拠・適用信頼度: [04d](../10_rules/04d_leave-choice-timing.md)。検証: `pnpm codex:finish-check:full` 成功（型・format/lint・docs・SSOT・wiring・カード台帳・全件テスト 876ファイル/11,381件成功、既定7件skip）。GUI/REST 8件成功。実行ログはローカル `artifacts/count-leave-order/`。

### 複数離脱の未選択カード保留（2026-09-11）

- 入力 `orica-snapshot-2026-09-11T10-04-49-647Z.json`。公開履歴37/43は両者のアリサの置換効果登録、39/44はアタック/ブロック、保存盤面はAliceのcard-9が魂状態、Bobのcard-48がトラッシュ。過去操作ログは空のため、同名2枚のBP比較から再現した。
- 原因は魂状態・煌臨元置換の走査が1件目でreturnし、未選択の後続カードを実移動から除外していなかったこと。相手起因判定はバトルを含み、両者の効果登録も成立する。契約カード・同じ所有者の複数破壊・破壊とデッキ下戻しでも同じ欠陥が発生する。
- 全適格カードを待機させ、表示は1件ずつ。選択解決後は原因効果と派生継続を保持して後続選択を再判定する。魂状態のハンドラ内にあった終了処理を外側の実移動後へ移し、離脱の選択がある間はバトル終了時の処理を保留する。
- 回帰: 攻守反転×契約/非契約×双方keep/decline、2体破壊・破壊＋デッキ下戻し、置換なしの通常離脱、複数の煌臨元置換（同一/両プレイヤー、異なるチェーン、受諾/辞退）。未選択側のコア・待機・移動先と最終盤面を確認する。
- GUI/REST: `?scenario=mutual-soul-state&manualOpponent=1`。Alice/BobそれぞれのGUIでkeep/declineし、相手のREST選択まで完了する4ケース。根拠・適用信頼度は [04d](../10_rules/04d_leave-choice-timing.md)。
- 検証: `pnpm codex:finish-check` 成功（型・lint・docs・SSOT・配線）、GUI/REST 4件成功、関連127件成功。`codex:finish-check:full` のformat・全体型・カード台帳等は成功。全件再実行は11,530件成功/8件失敗/7件skipで、失敗は並行作業のアタック本人条件に対する既存モルターテストの盤面不足のみ。別作業による盤面修正後、同8件の再実行も成功した。ログ: `artifacts/mutual-soul-*.log`。Active Board更新なし。

### ライフ0の即時敗北（2026-09-11）

- 入力: ユーザー裁定と `orica-snapshot-2026-09-11T10-55-58-672Z.json`。Bobの通常/ソウルライフがともに0、敗北防止効果なし、フラッシュ窓中で勝敗未確定。裁定は [勝利条件](../10_rules/01_glossary-and-card-types.md) に信頼度C・実装採用として記録。
- 原因は勝敗判定を継続効果の安定状態まで待たせていたこと。通常/ソウルコアの共通移動直後で敗北を確定し、後続の効果本文・派生誘発・バーストを進めない。既にライフ0の保存状態からの操作も本体を実行する前に敗北にする。
- 敗北防止効果の共通判定を維持し、効果期間/エンドステップで防止が失効したら次の処理前に敗北する。煌臨のライフソウル消費も移動プリミティブへ統一し、通常ライフを余分に引く旧処理を除去した。
- 回帰テスト: フラッシュ窓中の通常/ソウルライフ、致死/非致死効果の後続処理、敗北後の回復、敗北防止と失効、煌臨コスト。旧仕様を期待するテストを訂正し、ライフ0で別機能を検証する盤面は敗北防止を明示した。
- GUI/REST: `core-count-select&lethal=1` のAlice GUIと `&owner=bob` のBob REST、既存致死アタックの計4件成功。`orica-scenario-test` に従い最終ライフ・ボイド・勝敗・合法手なしを確認。Active Board更新なし。
- 最終検証: `pnpm codex:finish-check:full` 成功（882ファイル/11,620テスト成功、既定7件skip）。専用回帰テスト10件は追加の型チェックも成功。GUI/REST 4件成功。ログ: `artifacts/life-zero-finish-check.log` / `artifacts/life-zero-gui.log`。未解決なし。

### 合体先離脱後の残留ブレイヴの強制継続（2026-09-12）

- アタック/ブロック中の合体スピリット/アルティメット離脱後、残留ブレイヴがスピリット状態で参加可能なら選択なしで継続。攻防不可なら参加者を除去し、空バトルと成立済みブロックを保持する。
- 通常離脱・魂状態置換で継続選択を生成する旧 P2-10 処理を削除し、参加者更新・BP/シンボル再計算を共通処理に統一。旧選択の型/ハンドラは既存スナップショット/棋譜との互換用に維持する。
- 根拠: [05 合体先離脱後の継続](../10_rules/05_brave-and-attack-special-cases.md)。回帰は brave-battle-continuation.test.ts の48ケース（攻撃/防御 × spirit/ultimate × 破壊/消滅/手札戻し × 攻防制限）と魂状態・空バトルの既存テスト。GUI/REST は brave-attack-continuation の8ケースで確認。

### 同時誘発の効果単位選択と戦闘中のスタック応答（2026-09-12）

戦闘フラッシュ内の応答窓を残りの同時誘発より優先し、合法アクションと操作権判定を統一。一つの公開イベントに相手の複数効果が待機する場合も、ターンプレイヤーが発揮元・登録効果単位で選択する。選択した発揮元・登録効果とキュー前面の照合も統一。契約合体によるカウント増加と転醒の両解決順、相手ターンの選択・発揮/辞退、両者のスタックパスを回帰対象にした。ルール根拠は [02b 同時誘発](../10_rules/02b_declaration-timing-window-principle.md) に記録。

### キリトの同時消滅待機とライフ移動先変更（2026-09-12）

- 添付 `orica-snapshot-2026-09-12T06-11-22-566Z.json` のキリト＋夜空の剣の組み合わせを確認し、実カードシナリオで再現。スナップショットは解決後の盤面であり、過去の全操作を復元したものではない。
- 原因1: 複数体の離脱をまとめた誘発に対し、待機解除ゲートが代表個体だけを照合していた。公開・非公開・宣言中とも全関連個体を照合し、記憶開放術の選択・ライフ移動を終えてから魂状態を選ぶ。
- 原因2: キリトの任意変更を1回のフィールドコア除去だけに限定していた。アタック中・3コア以上・同一の合体スピリットという範囲で、ライフ移動にもリザーブ／トラッシュの選択を追加。
- 先頭ステップの選択再開も、保存済みコンテキストを持つ解決継続として扱う。誘発元情報のない再発揮判定で記憶開放術を不成立にしない。
- 根拠と範囲: [離脱選択](../10_rules/04d_leave-choice-timing.md)／[キリトの変更範囲](../10_rules/07d_night-sword-combination-audit.md)。共通コア移動とステップ選択を使用。
- 検証: 全体889ファイル・11,743件成功（既定7件skip）、追加回帰12件を含む。新規GUI／REST 2件・既存シナリオ4件成功。`pnpm check`、`codex:finish-check`、本文監査、開発サーバーチェック、変更19ファイルの整形確認が成功。
- `codex:finish-check:full` は並行作業の未追跡 `scripts/artifact-storage-policy.json` の整形エラーで停止。対象外ファイルには手を加えず、後続検証を個別実行した。現役 ToDo・issue の変更なし。

### バースト効果発揮宣言と効果ツリーの解決待ち（2026-09-12）

- 入力: `orica-snapshot-2026-09-12T11-41-09-559Z.json`。ヨハネスの効果発揮宣言窓中に、反逆者アリスとロニエの召喚時誘発が残存。操作ログがないため、同カードの同時召喚・発動宣言・残りのコア配置から再現した。
- 原因: コア配置等の入力待ちで cascade を再構築すると待機フラグが消え、再開側が誘発待ちを省略していた。バースト再開時は常に未解決効果を確認する。通常スタックの発揮前チェックポイントと、バーストを待つ継続の循環回避は維持。
- 根拠: [04b 効果発揮宣言](../10_rules/04b_burst-rules.md#効果発揮宣言は効果ツリーの解決後2026-09-12)、公式Q411（A）と2段階窓への適用（C / ユーザー確認）。
- 回帰: `burst-effect-tree-drain.test.ts`（所有者反転、正規アクションでコア配置・残り誘発の辞退・バースト破壊と2ドローまで）。GUI/REST: `e2e/scenario-burst-effect-tree.spec.ts`、Alice GUIのコア配置とBob RESTの同等手順を確認。Active Board・issue更新なし。
- 検証: `pnpm check`、rules-core `tsc --noEmit`、docs・SSOT・配線・カード台帳、変更コードのlintが成功。全件テスト892ファイル/11,756件成功（既定7件skip）、GUI/REST 2件成功。`codex:finish-check:full` は並行する容量改善の未追跡 `scripts/lib/stored-file-sizes.mjs:16` の `URL` no-undef で停止したため、後続チェックを個別実行した。ログ: `artifacts/burst-effect-tree/`。

### 合体中効果へのスタックと離脱確定（2026-09-13）

- 入力: `orica-snapshot-2026-09-12T15-29-38-120Z.json`。TR01(B)対象選択と、同行選択済みのホスト/ブレイヴの手札戻し待機が共存。BSTH08-C01の実スタックで再現した。
- カスケードの開始/再開で離脱選択を待ち、選択済み離脱の実移動後に外側効果を再検査する。残留/同行とも合体中効果は不発。使用回数は付与元ブレイヴの記録を取り消す。
- 根拠: [04 原因チェーン閉鎖原則](../10_rules/04_state-based-rules.md#フラッシュのタイミング原則)、具体例は [04d](../10_rules/04d_leave-choice-timing.md)。回帰は実移動ログが元効果の不発より先であることも検証。
- GUI/REST: `combined-effect-stack`。Aliceの残留/同行操作とBobのREST同行操作で、対象選択・カウント減少・破壊なし、同行は双方手札、残留はブレイヴのみ場に残ることを確認。証跡: `artifacts/combined-effect-gui-review.log`。現役ToDo・issue変更なし。
- 検証: `codex:finish-check:full` 成功（894ファイル/11,778件成功、既定7件skip）。最終差分の関連5ファイル66件成功、GUI/REST 3ケース成功。ログ: `artifacts/combined-effect-finish-check.log`。

### 空バースト修正（2026-09-13）

過去ログ再収集・GUI登録漏れを修正。[原因・回帰検証](../25_gui/15_effect-queue-text.md#空のバースト発動キュー2026-09-13)。

