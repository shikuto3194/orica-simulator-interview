# GUI Design Reference — インタラクション・演出

[レイアウト](08a_gui-layout-reference.md) / [選択UI監査](../00_meta/source-findings-selection-contract-2026-10-02.md)

## デッキの表示と閲覧

- デッキ上の公開中は、デッキ本体を一番上の公開カードの画像にする。横に別表示しない。公開終了後は裏面に戻す。
- デッキをクリックすると、下→上の既知位置と非公開区間を閲覧できる。現在公開されている自分のカードは、左クリックで legal action に基づく召喚・配置・使用等へ進む。右クリック・長押しは詳細表示。
- 相手の公開カード・操作のないカードは詳細を開く。過去に見た裏向きカードは定義の詳細だけを開き、実体の操作に結び付けない。公開権限・手札扱いは [紺珠伝の裁定](../10_rules/07e_kanjuden-mechanics.md)、既知位置は [情報の可視性](../10_rules/01b_information-visibility.md) に従う。

## 4. バトル演出

[宣言中の傾き・バースト・転醒・煌臨・契約の表示](08c_battle-visual-reference.md)を参照。

---

## 5. レスポンシブ設計（実装済み）

### 5.1 画面サイズ

- `100vw × 100vh` で画面全体を使用。スクロールなし。
- PC / モバイル両方で動作。

### 5.2 カードサイズの自動調整

- `clamp()` で viewport 幅に応じてカード・コア・バッジを自動スケーリング。
- 大画面ではカードが大きく、小画面では縮小。
- フィールドは CSS Grid 3 カラム（左サイド | 中央フィールド | 右サイド）。
- 相手フィールドは `direction: rtl` + `flex-direction: column-reverse` で左右・上下反転。

### 5.3 ゲーム中の長押し

- 盤面とそこから開くカード詳細・効果一覧では、ブラウザの文字選択・画像メニューを抑止する。入力欄・textarea・contenteditableの選択と編集メニューは残す。
- カードの長押し／右クリックによる詳細表示、手札のゲーム用ドラッグ、説明・一覧のスクロールは維持する。移動・タッチ中断・アンマウント時には長押しタイマーを解除する。
- `touch-action` やviewportのズーム設定は変更しない。OSの戻る・システムジェスチャーまで無効にする機能ではなく、Android実機固有のメニューは別途確認する。
- 根拠（信頼度A、実装に採用）: [W3C Pointer Events](https://w3c.github.io/pointerevents/#the-touch-action-css-property)（選択はtouch-actionの対象外）、[Apple Safari CSS](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariCSSRef/Articles/StandardCSSProperties.html)（iOSのtouch-callout）。回帰: `e2e/scenario-game-long-press.spec.ts`。

---

## 6. 技術スタック

- **React 19** + **Vite 7** (`apps/playground-web/`)
- **CSS Grid / Flexbox** でフィールドレイアウト
- **clamp() / vw 単位** でレスポンシブサイズ
- CSS Transitions + `@keyframes` でアニメーション（パルス枠、トーストフェード）
- `@orica/rules-core` の `getLegalActions()` / `applyLegalAction()` で UI ↔ エンジン接続
- Vite プラグインで `/images/` をプロジェクトルートから配信

### 6.1 画像アセット

| ファイル | 用途 |
|---------|------|
| `images/ForGUI/card-back.jpg` | デッキ山、バースト裏面、相手手札 |
| `images/ForGUI/core.png` | 通常コア（青い六角形） |
| `images/ForGUI/soul-core.png` | ソウルコア（赤い五角形） |
| `images/{cardNo}.webp` | カード画像。個別の参照先はカード定義の `image` |

---

## 7. 画面遷移

```
タイトル画面
  ├─ デッキ構築画面
  ├─ 対戦設定画面 (プレイヤー選択、デッキ選択)
  │    └─ バトル画面
  │         ├─ プレゲームオーバーレイ (.bjk-overlay)
  │         │    契約提示 → 契約確認 → じゃんけん → 先攻/後攻 → マリガン
  │         │    ※ 契約なしデッキは契約提示/確認 (4.7) をスキップ
  │         ├─ ステップ進行
  │         ├─ アクション選択
  │         ├─ カード詳細ポップアップ
  │         ├─ バトル演出
  │         └─ 結果画面
  └─ ?scenario=<name> → バトル画面 (シチュエーションテスト)
```

### 7.1 シチュエーションテスト

詳細は [10_scenario-test-reference.md](10_scenario-test-reference.md) を参照。

---

## 8. デッキ構築画面の設計指針

`orika-react` の既存デッキ構築 UI を参考にする。

### 8.1 カードプール表示
- **リスト表示**: カード画像小 + 名前・コスト・色・タイプ・効果テキスト。
- **グリッド表示**: カード画像大（アスペクト比 5:7）、枚数バッジ、+/- ボタン重ね表示。
- `react-window` による仮想スクロール（全カードプールを軽量描画）。
- フィルター: カテゴリ、色、テキスト検索、パック。

### 8.2 デッキリスト
- タイプ別ソート順: 契約 → スピリット → アルティメット → ブレイヴ → ネクサス（創界神→導界者→他）→ マジック。
- 同タイプ内はコスト昇順 → 名前順（`sortDeckEntries`。パック順は使わない）。
- デッキサムネイル: 代表カード 1 枚の画像。
- リスト/グリッド切替。
- トークンデッキは別枠管理。

### 8.3 カード詳細（デッキ構築時）
- ダブルフェイスカードの表裏切替。
- 関連トークンカードへのリンク。
- BP/レベルをテーブル表示（OC、合体中ブースト含む）。

### 8.4 保存/読み込み
- ローカルストレージでデッキ保存/読み込み（初期実装）。
- ログイン時は Supabase のクラウドデッキも保存/読み込み可能。
- 共有: 「デッキ共有URL」（`DeckBuilder.tsx` の `getShareUrl`）。取り込み: JSON ファイル（`input-validation.ts` の `readDeckFile`）。デッキ単体の JSON/テキスト書き出しは未実装（SVG/PNG エクスポートは `30_plan/02_detailed-todo.md` Phase 7 に残件）。

---

## 9. 効果解決キュー

MTG Arena のスタック表示を参考に、全ての効果解決待ちを視覚的に表示するパネル（UIコンポーネント名は「キュー」）。

### 9.1 MTG Arena リサーチ（参考）

スタックを画面右側に縦積み（最新が最上段）、何もできない場面は自動パス、`Ctrl` でフルコントロール、トリガー順序の自動/手動切替、1アクション30秒のロープタイマーなどを参考にした。ソース:
- [MTG Arena Interface Guide - Hipsters of the Coast](https://www.hipstersofthecoast.com/2018/03/how-to-play-mtg-arena-the-in-match-screen/)
- [Arena Hot Keys and Interface Guide - MTG Arena Zone](https://mtgazone.com/arena-hot-keys-and-interface-guide-simplify-your-game-with-these-easy-tricks/)
- [Stack - MTG Wiki](https://mtg.fandom.com/wiki/Stack)

### 9.2 orica-simulator への適用設計（v2 確定）

フィールド中央にオーバーレイでカード画像を重ねて表示する。MTG Arena のスタック表示を参考にしつつ、UIコンポーネントは「キュー」と命名。最前面（解決中）のカードが手前に大きく表示される。

**表示対象（効果解決待ち + 非効果キューの発動可否）:**

| GameState フィールド | 内容 | 表示 |
|---------------------|------|------|
| `pendingTriggeredEffects[]` | 誘発効果待ち | カード画像 + 該当効果テキスト |
| `battleImmediateEffects[]` | バトル即時効果待ち | カード画像 + 該当効果テキスト |
| `pendingPrivateDeclarations[]` | 非公開の誘発効果宣言待ち（自分の分のみ） | カード画像 + 該当効果テキスト |
| `pendingBurstChecks[]` | バースト発動可否待ち | viewer legal action がある場合だけ、セット中バーストをカード画像 + 該当バーストテキストで表示 |
| `stackWindow` | スタック窓（全ステップ。旧名 `mainStepStackWindow`） | カード画像 + 効果テキスト |
| `preDeclarationStackWindow` | 宣言前スタック窓 | カード画像 + 効果テキスト |

**除外:**
- `battleResolutionGroup` — バトル解決（BP比較）は効果ではない

- バーストチェック段階は `pendingBurstChecks` を EffectQueue に載せる。伏せ情報を漏らさないため、表示は viewer の `resolve_pending_burst_check` / `decline_pending_burst_check` legal action がある場合に限る。発動宣言後（表向き確定後）のバーストスタック窓も従来どおり stack item として表示する。
- 1効果1カード。同一カードから複数効果がある場合は別々のカードとして積む。
- **1 イベント複数 responder = 1 pending 複数カード**:
  - 1 つの誘発イベント（例: スピリット召喚）に複数カードが反応する場合（召喚カード自身の『召喚時』＋別カードの「〜が召喚されたとき」）、engine は 1 pending に集約しつつ responder ごとに `resolve_pending_triggered_effect` を生成する。
  - overlay は `buildEffectQueue` で **responder（source）ごとに 1 カードへ展開**し、前面カード ID を BattleScreen へ返す。ActionBar はその前面カード自身の操作 action と 1:1 対応する半透明ボタンだけを表示する。
  - `pendingId` だけで前面を絞ると同一 pending の全 responder がボタン化し「画像 1 枚・ボタン複数」の不一致になる（2026-05-30 リグレッション。空撃ち実装で対象不在の任意効果が発揮可能化し顕在化）。
  - 前面カードだけが、自分に claim された `pendingId + sourceInstanceId + registrationIndex`（バーストは `checkId + sourceInstanceId + registrationIndex`）一致の action を ActionBar に表示する。
  - **効果テキスト/ラベルは responder の effect 単位で解決する**: source の `registrationIndex` → 登録 → `effectIndex` を引き、`effects[effectIndex].textRef` でピンポイント抽出（見出し『』を持たない `game_event` トリガーが本文全体を誤抽出するのを防ぐ）。タイミングラベルは `timing.kind` で分岐し、`card_event`=「召喚時」/ `game_event`=「召喚されたとき」のように self と responder を区別する（同一 `eventKind=summon` でも文言が違う）。
  - 既知の制約: orika 本文が同一 textLine に複数効果を詰める場合（紅魔館 Lv2 = 破壊耐性＋召喚誘発が 1 行）、textRef は当該行全体を返す。effect 単位までは絞れるが行内の更なる分割は行わない。
  - **解決途中の表示ソース**: 一部 responder を解決済みの pending では、`pendingTriggeredEffects.resolvedSourceInstanceIds` は「解決済み = 表示除外」を意味する（engine: `legal-actions-apply` が resolve のたびに追加し残りを scan で再取得）。`resolution-items.ts` の source 確定は、この値を表示ソースに流用してはならず、private 宣言の pre-bind（`declaredFromPrivateZone`）でのみ使用する。direct-path は applicability スキャン（解決済みを除外し残りを返す）に委ねる。誤って解決済み responder を表示すると、残る legal action と source 不一致でボタンが消える（空撃ち時に顕在化したバグ）。
  - ガード: `effect-queue-action-routing.test.ts` / `effect-queue-multi-responder.test.ts`。

**種別ごとの色分け（バッジ）:**

| 種別 | 色 | バッジ位置 |
|------|-----|----------|
| 宣言（非公開の誘発効果宣言待ち `pendingPrivateDeclarations`。旧「マジック使用」種別は無い） | 紫 | 左上 |
| バトル即時効果 | 赤 | 左上 |
| 誘発効果 | 緑 | 左上 |
| バースト発動 | 青 | 左上 |
| スタック応答 | オレンジ | 左上 |

プレイヤーラベル（緑=自分 / 赤=相手）を右上に表示。

**カード表示:**
- 幅 220px、画像部分は高さ 120px でトリミング（`object-fit: cover; object-position: center 20%`）
- 画像の下に該当効果テキスト全文表示（フォントサイズ 0.7rem）
- 背面カードは左にずらして重ねる（`translate + scale`）

**操作体系（実装済み。`EffectQueueOverlay.tsx` の `handleCardPrimary` / `useLongPress`）:**
- **クリック／一覧** → 前面化。画面外にはみ出す時だけ一覧入口を表示（画像・本文付き）。発揮は ActionBar。
- **右クリック／長押し** → カード詳細モーダル。

**表示/非表示トグル:**
- 画面右上の共通ボタン `board-peek-toggle`（画面に1つ）。効果キューでは「盤面確認」⇔「解決待ち N」でカードと ActionBar をまとめて隠す。対象選択モーダル・ActionBar のみの場面も同じボタン（層の優先度は [15](15_effect-queue-text.md) の「ドック配置」）。

**同時誘発効果の解決順選択（前面化 + ActionBar 確定モデル, P3-35 Phase 3）:**
- 通常と同じ重ね表示レイアウト。**解決順番号バッジは廃止**。順序は事前確定せず「次に解決する 1 件をタップで前面化 → ActionBar で発揮/解決」とするため、配列位置ベースの固定番号は確定順を意味せず誤解を招く（旧 `effect-queue-order` / `effect-queue-resolve-bar` / 並び替えボタンも撤去済み）。
- 前面（focusStack 末尾）カードを橙色アウトラインで強調。後ろカードのタップは前面化のみ行い、cross-pending の `select_pending_to_resolve` は前面カードに対応する ActionBar から確定する。同一 pending 内 responder は overlay ローカル focus。

**実装ステップ:**
1. ~~`buildEffectQueue()` — GameState + getDefinition → EffectQueueItem[] 変換~~ 完了
2. ~~`EffectQueueOverlay.tsx` — フィールド中央オーバーレイコンポーネント~~ 完了
3. ~~BattleScreen 組み込み（フィールドエリア内 position: absolute）~~ 完了
4. ~~CSS（battle.css に追加。レスポンシブ対応）~~ 完了
5. ~~テキスト抽出精度改善 — `splitTextBlocks()` でタイミングヘッダー分割、`matchIndex` で同タイミング複数効果を区別~~ 完了
6. ~~同時誘発の並び替え + 「解決」ボタン（← → ボタン版）~~ 実装後に P3-35 Phase 3 で撤去し、前面化 + ActionBar 確定モデルへ置換（上記）。
7. ~~スマホ対応（レスポンシブ）~~ 幅 480px 以下でカード幅・画像高を縮める `@media` が `battle.css` にある（実機での確認は未記録）。

---

## 参考資料

### 解決途中のオープン対象（2026-10-03）

- 現在の表示用stateで候補がすべて閲覧可能な `revealed` にあるときは、既存 `DeckRevealModal` のカード表示を再利用する。候補外を含む同じ所有者の公開カードも表示し、対象外・選択中を明示する。
- 固定1枚・候補1枚でもタップはdraft変更に留め、確定ボタンで効果へ送る。盤面確認から戻ってもdraftを保持し、キャンセルと別pendingへの移行では解除する。
- クォーツ配置待ちのHUDには、選択済みの公開カードと選択元だけを表示する（未選択の公開カードはHUDに出さない）。分岐前の効果選択モーダルには公開カード列を重ねず、選択肢ボタンを画面内に保つ（高さ592pxで検査）。分岐前の公開カードは盤面確認の「オープン中のカード」から閲覧する。右クリック/長押し詳細はHUDの切り抜きを受けないportalで表示する。
- 混在ゾーンは通常のゾーン候補を保ち、公開カード閲覧を併用する。手札選択・借用・相手視点の待機中も、公開中のカードを閲覧できる。画像の復元には過去履歴や内部状態を使わない。
- 私的閲覧は現在のviewerの公開権限を守る。監査・再現根拠は [全カード監査記録](../30_plan/03_completed-milestones-phase-7-8-revealed-target-selection.md)。

- コネクテッドバトラーズ バトル画面: `images/reference/cb-pv2-004.jpg`, `cb-pv2-007.jpg`
- コネクテッドバトラーズ VS 画面: `images/reference/cb-pv2-005.jpg`
- コネクテッドバトラーズ ショップ画面: `images/reference/cb-pv2-006.jpg`
- プレイマット: `images/reference/cb-pv2-008.jpg`
- orika-react デッキ構築 UI: `C:\Users\kensh\OneDrive\ドキュメント\orika-react\src\`（CardList.jsx, DeckViewModal.jsx, App.jsx）
- 公式サイト: https://www.cs.furyu.jp/battlespirits/
- 4gamer 記事: https://www.4gamer.net/games/567/G056759/20220224064/
