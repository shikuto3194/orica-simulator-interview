# Completed Milestones: Phase 7-8

このファイルは、Phase 7 から Phase 8 までの完了履歴です。
通常は [03_completed-milestones.md](./03_completed-milestones.md) から辿ります。

## Phase 7: API / UI / AI

- 2026-09-23: [ルーム招待・PWA優先通知](../25_gui/20_room-invitations.md)。

- [入力検証](03_completed-milestones-phase-7-8-input-validation.md)。

- 2026-09〜10のGUI修正: [GUI fixes](03_completed-milestones-phase-7-8-gui.md)。

- `legalActions` を AI / UI の共通入口として整備。各 legal action に `reason`/target 候補/追加選択情報、`chosenLifeCoreKind` を持てるようにした。
- `CLI` から `rules-core` を読める状態を維持。`playground-web` に最小の状態可視化 UI を用意。
- state summary に `pendingTriggeredEffects`/`pendingBurstChecks`/`setBurstStates`/`revealedBurstStates` 等を反映（`effectQueueSummary`/`pendingLeaveEntities` は `GameState` にあるが `summarizeGameState()` 未反映）。
- バトル画面 GUI 実装: BattleScreen/CardView/FieldArea/HandArea/GameHud/ActionBar/LogPanel + battle.css。clamp()/vw レスポンシブ。Vite プラグインで `/images/` 配信。召喚操作（手札クリック→自動コスト計算・軽減・支払い・コア配置）、ステップ遷移（`advanceStep()`）。GUI デザインリファレンス記録。
- GUI 操作改善: ActionBar からタップ操作完結アクション除外、自動パス、相手自動実行抑制、ブロック操作改善（フィールドタップ宣言+辞退ボタン）、PlayerController 委譲。
- 効果解決キュー UI (`EffectQueueOverlay.tsx`): MTG Arena 風カード画像重ね表示、テキスト抽出精度改善、カード詳細ダブルタップ/右クリック、表示トグル。
- デッキ構築 UI 改善: 転醒カード画像修正、トークンカード表示、バッジ中央寄せ、特殊シンボル表示修正。
- TypeScript エラー全修正（`exactOptionalPropertyTypes` 対応等）。CLI テスト修正。
- REST API (game-api.ts): start/state/actions/action/step/reset の6エンドポイント。Vite dev server middleware。
- 対戦設定画面改善: ランダムデッキにマジック/ネクサス/ブレイヴ追加、P2 にも構築デッキ選択肢追加。
- じゃんけん画面実装（`JankenScreen.tsx`）。先攻T1コアステップブーストスキップ。`initializeGame()` に `firstPlayerIndex` パラメータ追加。
- ソウルコア修正: `void` 削除、全箇所合算表示、選択移動、召喚/マジックコストチェック修正。
- 召喚時コア配置選択UI（−/+ボタン、ソウルコアチェックボックス）。HUD ボイド残数のみに簡素化。レイアウト安定化。
- ネクサス配置を手札タップに統合。手札タップ時の複数アクション選択吹き出し実装。
- カード定義 JSON Schema 作成。source precedence を Cross-cutting Rule に明記。カードデータ更新フロー作成。
- 構造化効果モデル設計: 567枚分析→`StructuredEffect` 型群を `model.ts` に追加。P0 インタプリタ実装（draw/destroy/core_move/bp_modify）。P1 実装（recover/exhaust/search_deck/return_from_trash）。life_damage 実装。TH カード 10 枚 DSL 化。`dsl` シナリオ追加。`runActionMainResolution` に StructuredEffect fallback 接続。
- キーワード能力棚卸し完了（10種、頻度順リスト化）。burst 対応済み、soul_state/double_sided/advent は 6e に残す。
- バースト条件の structured trigger model 移行完了。

## Phase 7: GUI 大幅改善（2026-03-25〜26）

- GUI 操作体系統一: タップ→モーダル、ドラッグ&ドロップ（合体/分離/交換/手札→召喚）、長押し/右クリック→詳細。
- コア操作をフィールドタップ方式に統一（コスト支払い/コア配置/コアシュート/分離）。リアルタイム仮想コア表示。
- ソウルコア確認統一。コスト支払い/コア配置でソウルコアフラグ分離、オーバーライド引き継ぎ。
- ブレイヴ合体（BP加算表示/z-index制御）、分離/交換（ドラッグ&ドロップ/swap優先）。
- フラッシュ: open_battle_flash 自動実行、非アクティブ priority、MagicActionRegistrationLookup 配列化。
- 宣言前スタック 1パスモデル。相手ターン自動進行+ディレイ。
- HUD: ボイドプレイヤー分離、ターン/ステップ安定化、ステップアナウンス。カード詳細 orika-react 準拠。
- BP0 非表示、カード画像 object-fit contain、手札カード幅固定+横スクロール。
- エンジン修正: 先攻1T コア/アタックステップスキップ、ドローステップ zone 変更、コア移動 SBA、includeSoulCore、coreShootSoulCoreInstanceId。
- Telegram Bot: PTY→stream-json 方式、PreToolUse Hook 介入、/force Kill+Resume、画像送受信。
- ソウルコアバグ全10件修正: `soulCoreDisplayOverrides` (Record<string, boolean>) に統一。分離/コア移動/コアシュートの全モードで仮想表示対応。367 tests 通過。
- デッキビルダー orika-react UI 移植: CardDefinition 拡張（isDoubleSided/backFace/relatedTokenCardNos/orikaIndex 等）、変換パイプライン、react-window 仮想スクロール、CardDetailModal/DeckViewModal、トークンデッキ管理、系統オートコンプリート、フィルター強化、JSONインポート/デッキ共有URL、タブスワイプ、ホームタブ、クラウドデッキ対応。
- 対戦設定画面: 保存デッキ一覧選択、40枚未満警告、枚数上限撤廃（バトル時バリデーション）。
- じゃんけん・マリガン: バトル画面内オーバーレイ、先後選択、マリガン先攻→後攻順。`setFirstPlayer`/`mulliganHand` エンジン関数。`preGame` フィールド追加。ルーム対戦 push/poll 同期。
- ルーム管理強化: 退出/ハートビート API、接続状態管理、再接続、自動削除、第三者拒否、polling 取得。issues P1-01〜P1-07 対応。

### Phase 7 追加完了項目（02 から移動）

- GUI と API の状態同期完了（`useGameSync` フック + `PUT /api/game/state`）。
- 効果解決キュー UI 基本実装完了。
- GUI 操作体系の統一完了（タップ/ドラッグ&ドロップ/コア操作/ソウルコア/合体/フラッシュ/スタック/相手ターン自動進行等）。
- エンジン修正完了（先攻1Tスキップ/ドローzone変更/コア移動SBA/フラッシュpriority/宣言前スタック/合体/includeSoulCore/additional_cost DSL）。
- デッキ構築改善完了（orika-react UI 移植: 仮想スクロール/ダブルフェイス/トークンデッキ/エクスポート・インポート）。

### P2-06 Phase 1: エターナル Ver.17.0 ドキュメント改定（2026-04-04）

- `04_state-based-rules.md`: 待機状態統一（消滅待機の追加制約廃止、シンボル軽減可能化、常時効果継続、待機状態間遷移、合体ブレイヴ単体破壊）。バースト発動宣言タイミング縮小。
- `06_core-system.md`: ソウルコア使用強制化。ソウルコア移動効果による自己消滅ルール追加。
- `02_turn-flow-and-timing.md`: マリガンタイミング変更。ゲーム開始手順のソウルコア選択肢削除。
- `08a_advent-rebirth-contract.md`: フラッグネクサス/F契約煌臨追加。`adventCondition.targetCategory` に `"nexus"` 追加。
- `01_glossary-and-card-types.md`: 「属性専用効果」→「キーワード効果」改名、複数所持可能ルール追加、フラッグネクサス追記。
- `03b_resolution-and-interrupts.md`: 常時効果の無効化ルール追加。

### P2-06 Phase 2: エターナル Ver.17.0 エンジン対応（6件完了、2026-04-04）

- ソウルコア強制化: `initializeGame()` の `useSoulCore` 削除、1個+通常3個で固定。
- 軽減計算 vanish 除外撤去、消滅待機特別制約削除: 全待機状態を破壊と統一。
- バースト宣言窓タイミング制約: 手札誘発効果解決後にのみバーストチェック提供。
- 待機状態間遷移: `queuePendingLeave()` で既存 kind 上書き+前チェーン誘発効果除去。
- 合体ブレイヴ単体破壊: 待機状態時に即時合体解除。
- 残り1件（F契約煌臨ターゲット拡張）も後日完了（`getFContractAdventTargets()` の nexus 対応、phase-c-advent.test.ts C-4）。P2-06 は 2026-06-12 に全完了で archive 化（issues/archive/P2-06/）。

### P2-04: バトル情報・継続効果の可視化（2026-04-04）

- **継続効果バッジ**: `CardView.tsx` にオーバーレイバッジ。bp_modifier/unblockable/prevent_attack 等 15 種を視覚マッピング。3件超は「+N」折りたたみ。
- **プレイヤー継続効果**: `GameHud.tsx` にプレイヤー全体対象バッジ（draw_modify/prevent_life_damage 等）。
- **バトル実質BP**: `getEffectiveBp()` で resolvedBp 算出、増減を緑/赤で色分け。旧 `BattleCenterDisplay` でデルタ表示していたが、P2-08 10-3 / 10-4 で廃止、カード右上の `.ac-bp-delta` バッジ（常時表示）に置換。
- **フィールドシンボル**: `getEffectiveSymbols()` で実効シンボル算出、カード左下にアイコン表示。「S一覧」ボタンで色別集計。
- **カウント値/待機状態バッジ**: `countValue > 0` で HUD に `C:N` 表示。`pendingLeaveKind` から破壊(赤)/消滅(紫)/戻り(青)を個別バッジ化。
- CSS: 相手フィールドバッジ逆回転対応。518 tests 通過。

### P2-03 Phase A: GUI ゾーン表示完全化 — トラッシュ閲覧・除外ゾーン表示（2026-04-04）

- **ZoneBrowseModal**: read-only ゾーン閲覧モーダル（カテゴリ順→コスト昇順→名前順ソート、詳細表示連携）。
- **トラッシュ自由閲覧**: 自分・相手の両方を任意タイミングで閲覧可能。
- **除外ゾーン表示**: `GameHud.tsx` に除外カード枚数表示+一覧モーダル（0枚時非表示）。
- BattleScreen 統合（`zoneBrowse` state）。付随修正: BSTH01.ts シンタックスエラー修正。518 tests 通過。

### P3-07 Phase A: カード演出・アニメーション整備（2026-04-04）

- **バースト発動フリップ**: CSS 3D flip（perspective 400px + rotateY 180deg、0.5s）、公開中金枠グロー。
- **破壊/消滅/バウンス**: 破壊（シェイク+赤フラッシュ+縮小、0.5s）、消滅（紫グロー+拡大→縮小、0.5s）、バウンス（手札方向スライド、0.45s/相手逆方向）。
- **ライフダメージ演出**: `lifeNormalCoreCount` 減少検知→赤フラッシュ+スケール揺れ（0.6s）。
- **アタック/ブロック演出強化**: 宣言時回転+スケール（0.35s）、攻撃中赤グロー脈動（1.2s infinite）。
- 全演出 CSS @keyframes + transition のみ。518 tests 通過。Playwright 動作確認。

### P3-07 Phase B: カード演出・アニメーション整備 — 転醒/煌臨/契約演出（2026-04-05）

- **B-1: 転醒カードフリップ**: `definitionId` 変化検知 → CSS 3D `perspective(400px) + rotateY`（0.6s）。B面表示中はシアングローで常時識別。転醒バッジ表示。
- **B-2: 煌臨オーバーレイ演出**: `adventSourceCardIds` 変化検知 → 着地アニメーション（上からドロップ + バウンス + brightness フラッシュ、0.5s）。煌臨中は金色ボーダーグロー + 煌臨中バッジ（スタック数表示）。
- **B-3: 契約視覚表示**: 魂状態（`soulStateInstanceIds`）→ 半透明 + 青紫グロー脈動 + 中央「魂状態」バッジ。契約カード（`contractCardNo`）→ 紫ボーダー + 右上「契」アイコン。
- `CardView.tsx` に 5 props 追加（isRebirthed/isAdventActive/isAdventJustLanded/isSoulState/isContractCard）。`FieldArea.tsx` で状態検知・props 算出。全演出 CSS @keyframes のみ（JS アニメーションライブラリ不使用）。692 tests 通過。

### P2-07 Phase D: アクセル・チェンジ基盤実装（2026-04-04）

- **アクセル基盤**: `AccelData` 型、`useAccelCardAsAction()` / フラッシュ版 / `resolveDeferredAccelStack()` 実装。手札からのみ使用→使用後 `set_aside` 移動。専用コスト/軽減計算。`LegalActionKind` に `"use_accel"` 追加。メイン/フラッシュ/宣言前スタック対応。
- **チェンジ基盤**: `ChangeData`/`ChangeSwapCondition` 型、`useChangeCardAsAction()` / フラッシュ版 / swap 候補列挙実装。入れ替え処理（スピリット→手札、チェンジカード→回復フィールド、召喚イベント不発火）。バトル中 `BattleEntity` 切替。`LegalActionKind` に `"use_change"` 追加。
- **共通基盤**: `ActiveStack.actionKind` に `"accel"`/`"change"` 追加。GUI 統合（ActionBar ラベル/手札タップ/コスト支払いUI）。テスト 20ケース追加（全624テスト通過）。

### P3-08: ゲームログ・操作性改善（2026-04-04）

- **Task 1-3 ログ GUI 表示**: ユーザー判断でスコープ外。`LogPanel.tsx` は `display: none` 維持。
- **Task 4 キーボードショートカット**: Space/Enter=パス、Escape=モーダル閉じ、D=カード詳細、?=ヘルプモーダル。テキスト入力中は無効化。
- **Task 5 ソウルコア移動制限**: UI — コアシュート void 時はソウルコア確認スキップ。エンジン — `applyPendingCoreShootAction` で移動先に応じた正しい分岐（従来の「常に reserve」バグ修正）。
- 518 tests 通過。Playwright ショートカット動作確認。

## Phase 8: テストと運用

- `Vitest` ベースのルール回帰テストを整備した。
- `CLI` import と最小出力のテストを追加した。
- `ESLint` / `Prettier` / `CI` を導入した。
- `format:check`、`lint`、`check`、`test`、`build` を品質ゲートとして運用している。
- `GameState` の invariant を core / queue / battle / trigger 単位に分割して維持しやすくした。
- `manual` と `ToDo` は、各中規模変更の節目で更新する運用を定着させた。
- テストは継続的に増えており、現時点では 364 件の回帰テスト（うちユニット 323 件、実カード統合テスト 40 件、CLI テスト 1 件）がある。
- Playwright e2e シナリオテスト基盤を構築。`playwright.config.ts` + `e2e/` ディレクトリに 7 シナリオ 27 テストを追加。主要 UI コンポーネントに `data-testid` 属性を追加し、セレクタを安定化。

### バグ修正: コードレビュー指摘 3 件 (2026-04-25)

Codex 系コードレビューで挙がった P1×2 / P2×1 を修正。いずれも再現テスト先行で対応。

- **P1: ルーム参加者でないユーザーが state を更新できる** (game-api.ts)
  - 6 桁 roomId を知った任意のログインユーザーが PUT `/api/room/:id/state` / POST `/start` / POST `/heartbeat` で別ルームの state を上書き / ゲーム開始 / heartbeat 偽装できていた。
  - `requireRoomMember(room, authenticatedUserId)` ヘルパーを export し、3 エンドポイントで 403 早期リターン。
  - 単体テスト 5 件追加 (`apps/playground-web/test/game-api.test.ts`)。
  - 残留懸念: GET `/state/full` の観戦許可ポリシーは未着手 → P3-17 で追跡。
- **P1: 複数体召喚でコアが増殖する** (`packages/rules-core/src/structured-effect-interpreter.ts`)
  - `executeSummonOther` の `cardInstances.map` 段で `reserveNormalCoreCount - costToPay` を base から再計算しており、2 体以上同時召喚すると合計コアが reserve を超過していた（reserve=3 / 2 体 / requiredCores=2 でコア +1）。
  - ループ 1 で算出した `forCost` / `forField` / `zoneRoleName` / `minCores` を Map に保存し map 段で参照する形に変更。
  - 回帰テスト 2 件追加 (`packages/rules-core/test/effect-interpreter.test.ts`)。
- **P2: stay_on_field が同時誘発内 BurstCheck を撤回できない** (model.ts / trigger-system.ts / structured-effect-interpreter.ts)
  - `PendingBurstCheck` 型に `simultaneousGroupId` フィールドが定義されておらず、`queuePendingReactionsFromTriggerEvents` の BurstCheck 生成側でも groupId を付与していなかった。`executeStayOnField` の撤回フィルタは型キャストで参照していたが事実上常に空振り。
  - 型に `simultaneousGroupId?: string` を追加、queue 関数で BurstCheck 側にも `simultaneousGroupId` を付与、interpreter の型キャストを撤去。
  - 回帰テスト 5 件追加 (`stay-on-field-action.test.ts` 2 件 / `trigger-system.test.ts` 3 件)。

検証: `pnpm check` (型チェック) + `pnpm test` (1026 件) 全件 pass。<br>
GUI 検証: 自動テストレベルで完了。Playwright で異ルーム JWT を使って 403 を確認するシナリオは未実施（残留懸念）。

### P1-1 残留 e2e 追加 (2026-04-25)

上記「残留懸念」を Playwright e2e で担保。

- 新設: `e2e/security/auth-helpers.ts` (Supabase 認証ヘルパー、anonymous → env credentials の順で fallback)
- 新設: `e2e/security/room-access-control.spec.ts` (5 テストケース)
  - bob JWT で `PUT /state` / `POST /start` / `POST /heartbeat` → 403 `"Not a player in this room."`
  - JWT 無しで `PUT /state` → 401 `"Missing or invalid token."`
  - alice 自身の `PUT /state` は 401/403 を返さない（メンバ検証通過の回帰）
- ルート `package.json` の devDependencies に `@supabase/supabase-js` を追加（テストランナー側で client 認証する用）

実行前提: Supabase Dashboard で Anonymous Sign-Ins を有効化、または `E2E_ALICE_EMAIL/PASSWORD` `E2E_BOB_EMAIL/PASSWORD` 環境変数で事前作成テストユーザーを指定する。<br>
動作確認: spec 一覧表示・lint・format・型チェック clean。実 Supabase 接続を伴う実行はユーザー環境で `npx playwright test e2e/security/` 実施要。

### P3-17 観戦リンク・RLS 補強・実 Supabase 接続 e2e (2026-04-25〜26)

オプトイン観戦 (B 案) 全 Phase: GET 5 経路の認証必須化 (private) / public_link 観戦許可 / 観戦者向け
`sanitizeStateForSpectator` + 観戦専用画面 + RLS 強制 (`004_enforce_rooms_rls.sql`) + 実 Supabase 接続
e2e 18/18 green。詳細: [issues/archive/P3-17](../../../issues/archive/P3-17/index.md) と
[archive/2026-04-26-extracted-p3-17.md](./archive/2026-04-26-extracted-p3-17.md)。

### 手元 (set_aside) ゾーン GUI 再設計 (2026-04-28)

旧 set-aside レイアウト（`.field-center` 内のフロー配置）はカード枚数増減でネクサス行・スピリット行を押し下げる干渉問題があった。手札方式の開閉トグルは不採用とし、ハイブリッド案を実装:

- 各プレイヤーの `.field-center` 内、ネクサス行のトラッシュ側端（画面右）に absolute 配置（自分=`bottom: 0` / 相手=`top: 0`）
- ゾーンサイズ: 縦 1 枚分 / 横 2.5 枚分。カード倍率 0.8 倍（横画面のみ 0.7 倍）
- n 枚を CSS calc で均等配置（`step = (zone_w - card_w) / max(n-1, 1)`）。自分=右端基準で左へ / 相手=左端基準で右へ（逆対称）
- 0 枚時は DOM から外す。1+ 枚で `has-set-aside` クラスを付与しネクサス行に `padding-right` を確保（侵食防止）
- ゾーンタップ → ZoneBrowseModal を `zone="set_aside"` で展開（`ownerPlayerId` ベースのフィルタ）
- 出現遷移は CSS animation で opacity 0→1, 100ms

主な改修: `FieldArea.tsx` (旧 set-aside 削除 + 新 SetAsideZone JSX) / `ZoneBrowseModal.tsx` (zone 型拡張) / `BattleScreen.tsx` (onSetAsideClick 配線) / `battle.css` (新規 `.set-aside-zone` 系統) / `scenarios.ts` (新規シナリオ 5 件: `set-aside-1`/`-3`/`-5`/`-vs`/`-with-nexus`)。

### 解決キュー UX 統合 (2026-05-03)

混在オーナー pending の操作系を ActionBar に集約。overlay 下部の独立「解決」ボタンを撤去し、ボタン位置の二重化を解消:

- ActionBar に出る `select_pending_to_resolve` を effect queue 前面（active = items 末尾）と一致する pending 1 件のみに絞り込み。ラベルを「解決順を選ぶ」→「解決」に変更
- `resolve_pending_triggered_effect` (optional) のラベルを「誘発効果を発揮」→「発揮する」に揃え、`declare_private_triggered_effect` の「発揮する」と統一表記
- `EffectQueueOverlay` の `.effect-queue-resolve-bar` / `inSelectionMode` / `selectedItemId` / `handleResolve` を撤去。前面以外のカードタップで `select_pending_to_resolve(pendingId)` を発火
- `selectedByTurnPlayer === true` な triggered を `displayItems` の末尾に並び替え、ターンプレイヤーが選んだ pending を視覚的に最前面化
- `BattleScreen` の ActionBar フィルタで `buildEffectQueue` を共有計算し、selected があれば selected を、無ければ末尾を「前面」とする

操作モデル: 混在オーナー pending で前面の「発揮する/発揮しない」と後ろカードタップによる選び替え→「解決」発火の 1 押下で順序確定。`select_pending_to_resolve` 発火後の resolve auto-fire まで連動。

主な改修: `EffectQueueOverlay.tsx` / `ActionBar.tsx` / `BattleScreen.tsx` / `battle.css` (`.effect-queue-resolve-*` 系削除)。検証: tsc clean / vitest 1295 件 pass / `?scenario=p3-36-mixed-owner-pending`。

### usageLimit 伝搬漏れ + 同名 private 誘発で詰み (2026-05-03)

snapshot 詰み（turn 9 alice、手札 M01 2 枚並列宣言→select 後に resolve UI 到達不能）。原因 2 段:

1. registration 各 generator の非 choice 分岐で `effect.usageLimit` が乗らず、M01 の `per_card_name turn=1` 等が無効化。triggered だけでなく magic / field-card / battle-immediate にも同伝搬漏れ（紅魔館 / ヴワル魔法図書館 / [導界者]系等 36 件で「ターンに1回」が機能していなかった）。
2. `BattleScreen.tsx` auto-fire useEffect が `pendingTriggeredEffects.length !== 1` で早期 return、ActionBar も `declaredFromPrivateZone` を hide するため複数 declared pending で resolve 経路ゼロ。

修正: registration 4 generator の両分岐に `effect.usageLimit ?? choiceStep?.usageLimit` 伝搬。`trigger-system.ts` で queue 時に `canUseEffectByUsageLimit` + バッチ内重複ガード（同タイミング誘発を 1 件に絞る）。auto-fire を `length === 1 || selectedByTurnPlayer === true` で pick に拡張。`legal-actions-availability.ts` の resolve 側は `usageLimitConsumedOnPrivateDeclaration` を見て二重判定回避。

テスト: `p3-28-private-declaration.test.ts` / `snapshot-2026-05-03-stuck-private-pendings.test.ts` / `usage-limit-registration-propagation.test.ts`。検証: tsc clean / vitest 1354 件 / docs:lint / patchouli GUI。

### P3-50〜53 / P3-55 Phase A (2026-05-06)

P3-50〜53: [archive/P3-50](../../../issues/archive/P3-50/index.md) 〜 [P3-53](../../../issues/archive/P3-53/index.md)。
P3-55 Phase A: [`resolve_battle_resolution`](../../../issues/archive/P3-55/index.md) を `start_battle_resolution` に inline 統合。

### P3-55 Phase B (2026-05-06)

[archive/P3-55](../../../issues/archive/P3-55/index.md)。`start_battle_resolution` 撤去 + 発火 2 系統化: defender の **`decline_block`** + `pass_battle_flash` after_block close からの auto-chain (`executeBattleResolution` helper 共用)。1644 件 pass / `?scenario=attack` 双経路確認。

### P3-61 / P3-62 / P3-63 (2026-05-15〜16)

P3-61: `effect.condition` 伝搬 + 列挙時 gating / `fieldEffectRegistrationIndex` 経由 textRef 抽出。
P3-62 + [archive/P3-63](../../../issues/archive/P3-63/index.md): 発揮不能時の usageLimit /
▶コスト 払い戻しを全 5 経路で完成 + BSTH02-M01 追加ターン burst 実装。1875 vitest PASS。

### ルーム戦バグ修正 3 件 (2026-05-16)

1. sanitize roundtrip による相手手札消滅: PUT `/state` で `_hidden_card_` が DB 定着する重大バグ。`restoreHiddenStateForActor()` で actor 以外を freshRoom.state から復元 (cardInstances/pendingPrivateDeclarations/pendingDeferredTriggeredEffects)。11 ケース追加。
2. 観戦者 viewingPlayerId="alice" 固定: `?viewer=alice|bob` 対応。
3. heartbeat しきい値 30s が hidden interval 30s と等値の誤検知: 45s 緩和。1891 PASS。

### P3-64 Phase A: priority-gated PUT (2026-05-16)

[P3-64](../../../issues/archive/P3-64/index.md): PUT `/state` で
`getCurrentActorPlayerIds` と送信元 role を照合し不一致なら 403。同時 push race / 不正 push 排除。
unit 26 ケース、全 1917 PASS。B/C は需要待ち。

### P3-64 Phase B 基盤 (2026-05-17)

`POST /api/room/:id/action` + `/step` 追加: actor 検証 + `getLegalActions` で legality 検証 +
CAS + SSE broadcast。`executeAction` helper を legacy `/api/game/action` と共有化。
client `useRoomSync` に `dispatchAction` + `dispatchStep` helper を追加。全 1917 PASS、
GUI 回帰なし。残: B-3 BattleScreen 移行 (40 箇所超) / B-4 PUT 廃止 / B-5 削除。

### P3-64 Phase B-3 / B-4 / B-5 (2026-05-17)

Phase B 完遂。`setStateAndSync` を 3-arg シグネチャ `(state, syncAction?, payload?)` に
拡張し、BattleScreen の applyLegalAction / advanceStep 経路 60+ callsite を
`dispatchAction(actionId, payload)` / `dispatchStep()` 化。`executeAction` に
`extractApplyOptionsFromBody` を導入し `ApplyLegalActionOptions` 全 payload (paymentSources /
selectedZoneCardIds / coreSplitDistribution / multiPlacementAllocations /
coreShootDistribution / swapTargetInstanceId / redirectTargetReplacementInstanceId /
skipOptionalEffect / targetInstanceIds / summonEnterFieldCorePlacements 等) を pass-through。

残存 3 callsite (handleClaimVictory / exitCoreMoveMode / confirmSeparation) + preGame 経路に
対しては専用 endpoint 4 種 (`/claim-victory` / `/core-move` / `/brave-separation` /
`/pregame-update`) を追加。`PUT /api/room/:id/state` ハンドラと dead code 化した
`validateGameInvariants` を物理削除。room モード時の状態変更は全て dispatch endpoint
6 種 (`/action` `/step` `/claim-victory` `/core-move` `/brave-separation`
`/pregame-update`) 経由に統一。`setStateAndSync` の旧経路 fallback は room モードで
404 ガードレール化、`handleReset` は room モードで `"skip-sync"`。

検証: 型 (rules-core / playground-web) / 全 1917 件テスト pass / single-player GUI スモーク
(scenario=summon で召喚 + step advance) 成功。

Phase C (server-authoritative + replay) は P3-19 統合検討待ち。設計起案として
`replay_events` テーブル schema と着手ステップ C-1〜C-5 を [P3-64](../../../issues/archive/P3-64/index.md)
issue に追記。

### 勝敗決定時のエンディング BGM 遷移 (2026-06-10)

勝敗確定 (gameResult 設定) でバトル BGM を 1.5 秒フェードアウト →
同作品のエンディング曲に切替え、曲の再生開始 (playing イベント) と同時に
勝敗オーバーレイを表示する。`BgmContext` に `transitionToEnding()` (Promise は
鳴り始めで resolve、再生不可時もタイムアウト 2.5s で表示を止めない) と
`resumeFromEnding()` (「もう一度プレイ」でゲーム曲プールへ復帰) を追加。
manifest にエンディング曲プールを追加 (`classifyTrack` の ending を使用、
無い作品は staff_roll → タイトル曲の順で代用)。エンディングはループ再生し、
遷移中/再生中は通常選曲 (モード切替の選曲・曲終端・スキップ) を凍結、
outside 切替 (ホーム/タイトルへ) で解除。
検証: 全 3009 テスト + Playwright (lethal-attack で確定→1510ms 後に
エンディング曲ロード→21ms 後オーバーレイ表示、もう一度プレイ/ホームに戻る復帰、
エンディング無し作品のタイトル曲代用)。

### BSTH02.7-TX01(A) 転醒コア配置HUDの進行不能（2026-09-04）

- 同一プレイヤーの総数指定→移動元指定をGUIでは一括送信し、不要な1回目のHUDを省略。保存済み総数指定は必要数と配置後総数を確認してから完了する。
- 回帰シナリオ `tx01-rebirth-core-placement` とPlaywrightを追加。Alice GUIのトラッシュ1個のみ・固定4個、Bob RESTのトラッシュ1個のみを検証。

### バトル終了前の誘発待機とTX01のアタックステップ終了（2026-09-04）

- ライフ減少・破壊・離脱の誘発、手札宣言、選択継続、バーストを共通の終了待機条件にし、転醒のコア配置後も当該バトルの終了予約を保持する。
- バトル終了時誘発から効果全体の終了予約が生じる場合も、同じ終了処理内で解決する。終了時効果の対象選択後にも本体を実行し、派生した確認処理まで待つ。実行対象のない誘発は終了待機条件に含めない。
- 実バトル経路のTX01転醒成立/辞退と、ライフ減少・破壊・離脱→バースト→終了時誘発の6ケースと、手札バーストのみの待機を追加。シナリオも実バトル経路へ変更し、Alice GUIとBob RESTで相手エンドステップ到達を確認。

### 効果選択・対戦表示の日本語統一（2026-09-08）

- BSTH01-C21 の `unblockable` 表示を修正。全 Action の日本語辞書を正源に、選択肢・確認文・公開ログを自動生成し、旧スナップショットの英語ラベルも表示時に復元する。
- ゾーン・カテゴリ・能力の辞書を統合。ライフ・バースト・勝敗・画像代替テキスト・英語エラーの代替表示も日本語化。
- 全収録カードの choice 回帰と Alice GUI 新旧ラベル / Bob REST の3ケース、ユーザー提供スナップショットの横画面表示を確認。保守方針は [日本語表示](../25_gui/14_japanese-display.md)。

### コアHUD再監査と単体配置の統一（2026-09-08）

- リンクエイド・発揮前提コア・移動数・通常/ソウル内訳・代替召喚コストを共通HUDへ統合。専用モーダル3種を撤去し、ルームでは権威サーバーへ確定を送る。
- 単体効果召喚と分離は配置先が確定していれば移動元を掴むだけで完了。BSGE01-R01の召喚後コア追加・ドロー、Alice GUI/Bob REST、リセット・上限・種類選択の7ケースを確認。
- 全経路一覧と再発検知は [コア操作再監査](../25_gui/11a_core-operation-audit.md)。check:ssotに専用UIと固定placement_multiの検知を追加。

### リンクエイド後の神機合体（2026-09-08）

- BSGE01-R01復帰時のTR01(A)合体を修正。配置前の遷移イベントを共通の配置pendingに保持し、配置後に誘発へ合流。未合体効果へ同じ本文行の合体中条件が混入する登録推定も修正。
- 両プレイヤー・単一/複数コスト源・同型8種・保存復元・0コア不成立・消滅待機中の合体C05除外の16ケースとAlice GUI/Bob RESTを検証。召喚/契約合体扱いにせず、発生元だけへ合体する。

### バトル進行の修正（2026-09）

[ブレイヴ残留選択・簡易AIの進行停止](03_completed-milestones-phase-7-8-ai-progress.md) を参照。
