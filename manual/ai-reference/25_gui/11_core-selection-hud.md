# Core Selection HUD — 「掴む → 置く」2 phase 統一仕様

コア選択 GUI の表示・操作仕様。
エンジン側のコア資源モデルは [20_design/06_core-resource-model.md](../20_design/06_core-resource-model.md)、
GUI facade の draft 構造は [coreSelectionFacade.ts](../../../apps/playground-web/src/coreSelectionFacade.ts) を参照。

有料支払いの自動処理は、支払い元が1か所で、支払い可能なのが通常コアだけの場合に限る。
複数の支払い元、または使用可能なソウルコアがあれば、全量必須でもコアHUDで選んで確定する。
通常召喚、マジック、ミラージュ、アクセル/チェンジ、効果文内のコスト支払い（`pay_cost`）、
任意効果の「発揮する」からの再開も同じ（2026-09-26 ユーザー指示）。
判定の正源は `getAutomaticNormalCorePaymentSources()`。コスト0は支払い選択不要。
効果による自己召喚は、固定額・通常軽減などのDSL形状をGUIで再判定せず、エンジンが
解決時の実コストから `pendingEffectSummonCostPayment` を生成し共通HUDへ接続する。
`pendingCoreSourceAllocation` は `buildPendingCoreHud` → `usePendingCoreHud` に統合し、
候補のゾーン変換・タップ・プレビュー・リセット・確定を共通処理する。
画面側で配分payloadや専用の選択状態を再実装しない。

効果召喚は自己・他カード・トークン・分割召喚・参照による持ち主の場への召喚・デッキ公開後の場入りを含め、選べる配置を 「pendingMultiPlacement」 へ接続する。
「activationZone」 や召喚原因の有無を入力待ちの条件にしない。移動元が1か所でも追加配置数や種類を選べるならHUDを開く。配置禁止で最大0の場合と、本文で内訳まで固定された移動だけは選択不要。

経路別の順序と継続契約は[2026-09-27再監査](11a_core-operation-audit.md#2026-09-27-エンジン内部の暗黙選択を廃止)を参照。

共有枠・配置先上限・移動元と配置先の表示は [コア配分HUD](11b_core-distribution-hud.md) を参照。

## ソウルコアの選択確認

- コアの種類を選べて、移動先が固定または選択だけで終わる場面では、移動元をタップして「ソウルコアを含みますか？」で選ぶ。コスト支払いは「コストに含みますか？」。通常/ソウルの種類切替ボタンを出さない（2026-09-13 ユーザー確認）。
- 通常召喚・効果コスト・コアシュートの確認表示は `SoulCoreConfirmation` を共有する。pending の種類選択も同じ部品を使い、「いいえ」はその移動元の通常コアを選ぶ。辞退は支払い間へ持ち越さず、支払い中は通常コアが尽きてもソウルを自動取得しない。リセットで選択と辞退記録を消し、再確認できる。
- 通常/ソウルの片方しか合法に選べない移動元では確認を省略する（支払い・配置・分離・手動移動も共通）。コア数だけを選び、後で持ち主が種類を決める段階では種類確認を出さない。複数の配置先へ実際に置く操作は、既存のgrab/place手順を維持する。
- 通常召喚の支払いと、効果の途中で発生した支払いは確定先が異なる。表示部品の共有と操作コントローラーの共有を区別し、モード別分岐の存在だけでSSOT違反とは判断しない。

## 目的

散在していた効果別コア選択 UI（コスト支払い / placement / コアシュート / 分離 / コア移動 / トラッシュ配分 / multi-zone 配分）を、**「コアを掴む（grab）→ コアを置く（place）」の 2 phase モデル**へ統一する。grab/place のどちらかが省略可能なケースは表で定義し、UI 表記もモード別に正規化する。

## 既存コマンド棚卸し

GUI facade の `DraftCorePurpose` + 周辺 pending を起点に、各経路の grab / place phase の有無を整理した（実装層は P3-46 / P3-47 で着地済）。

| purpose | トリガー | 掴む（grab） | 置く（place） | 数の決定 |
|---------|---------|-------------|--------------|---------|
| `card_cost` | 召喚 / マジック使用 / 効果起動 | **USER**（reserve / 自分 field card 通常+ソウル） | **SKIP**（trash 固定） | コスト数固定、内訳 USER |
| `placement`（単体召喚） | 召喚直後の登場時コア配置 | **USER**（reserve / 自分 field card） | **SKIP**（1 枚固定） | 上限のみ、USER 任意（min ≥ 0） |
| `placement`（複数体同時召喚） | 同上 | **USER** | **USER**（複数 recipient へ配分） | 上限 / 下限あり |
| `shoot` | コアシュート効果 | **USER**（相手 field card） | **SKIP**（void / removed_from_game など効果指定） | 効果指定 |
| `separation` | 合体スピリット分離（leave-field 経由） | **USER**（reserve / 自分 field card、合体本体含む） | **SKIP**（単体の分離先固定） / **USER**（複数先へ配分） | 元保持コア + 任意追加 |
| `core_move` | 任意コア移動 / `core_move` action / `splitDestinations` | **USER** | **USER** | 効果指定 or USER 任意 |
| `core_split` | `core_move.splitDestinations` の deferred 配分（BSTH01-R05 等） | **SKIP**（効果元固定） | **USER**（reserve / trash / life / field 等） | 効果指定 |
| `core_source_allocation` | field_card ソースのコスト支払い配分 | **USER**（候補 field card） | **SKIP**（void / trash 等の効果指定先） | コスト数固定、内訳 USER |
| `trash_distribution` | トラッシュ→フィールド配分（BSTH01-M01 等） | **SKIP**（trash 全コア） | **USER**（候補カード群へ配分） | 数固定 |
| `core_distribute(even)` | 自動均等配分 | （計算） | （計算） — UI 介在なし | — |
| `core_distribute(player_choice, any_movable_self)` | フランドール【フォーオブアカインド】等 | **USER**（reserve / trash / life / 自分 field card 任意混合） | **USER** | min ≥ 1 等 |
| `life_damage_interception`（現存カード） | CE 自動発火 | **SKIP**（事前指定） | **SKIP**（事前指定） — UI 介在なし | event_amount |

### 配置先が確定している場合

- 通常コアの残数とソウルコアの残数は別々に数える。ソウルを選んでも通常枠を減らさず、存在しない通常コアを確認ダイアログから取得しない。合計上限がある場合は両者の合計にも適用する。[混在選択監査](11a_core-operation-audit.md#2026-09-18-通常コアとソウルコアの混在選択)参照。

- 通常召喚・効果召喚・分離とも、配置先が1か所なら移動元のタップで直接 draft を作り、「完了」で確定する。pending の型名やカード番号で2段階へ分岐しない。
- 配置先の判定は facade の getFixedCoreDestination()、grab から draft への変換は createGrabbedCoreMove() を正源とする。複数配置先の配分だけ grab→place を要求する。
- pendingMultiPlacement が単体を含む場合も同じ。通常/ソウル、リザーブ/フィールド/トラッシュ/ボイドの制限と配置上限は維持する。
- 2026-09-08 の全経路再監査と入力アダプター一覧は [11a_core-operation-audit.md](11a_core-operation-audit.md)。

### 配置総数と移動元の選択

[配分HUDの総数・移動元選択](11b_core-distribution-hud.md#配置総数と移動元の選択) を参照。

## フロート要素レイアウト

```
{ <動作文> n / <希望文> m  - 掴んでいるコア <通常>a <ソウル>b - }
```

| 部位 | 内容 |
|------|------|
| `<動作文>` | モード別動詞（後述） |
| `n` | 現在掴んでいるコア合計 = `a + b` |
| `<希望文>` | `残り` / `最低` / `必要` |
| `m` | 必要数 / 下限 / 上限 |
| `a` | 通常コア数 |
| `b` | ソウルコア数 |

### 省略規則

- 希望文 m が「任意」相当（上限/下限なし）→ `/<希望文> m` を全省略 → `{ <動作文> n - 通常 a ソウル b - }`
- n と m が連動して常に同値となる文脈（典型: phase 2 place phase）→ `n /` を省略 → `{ <動作文> <希望文> m - 通常 a ソウル b - }`

### m の動性原則（2026-05-06 改訂）

- **「必要 m」の m は固定値** (例: 総コスト / 総取得数 / 総 grab 数)。n が 0→m に進むことで進捗を表す。
- **「残り m」の m は変動値** (例: phase 2 place phase での残 held buffer)。n 表示は省略 (`omitN=true`) して m 単独カウントダウンを正源とする。
- **「最低 m」の m は固定値** (placement_single の最低達成閾値)。達成後は希望文ごと省略。
- 1 phase mode で「総量固定 + 残数表示」の組合せ (`n / 残り m` で両方変動) は採用しない。総量固定なら必ず「必要 m」を使う。

## モード別 表示テンプレ

| モード | phase | 表示テンプレ |
|--------|------|-------------|
| `card_cost` | 1 | `{ コストを支払う n / 必要 m - 通常 a ソウル b - }` (m=固定総コスト) |
| `shoot` | 1 | `{ コアを掴む n / 必要 m - 通常 a ソウル b - }` (m=固定取得数、自分側が移動元の場合もある) |
| `placement` 単体 | 1 | n<min: `{ コアを置く n / 最低 m - … }` ／ n≥min: `{ コアを置く n - … }` |
| `placement` 複数 | 1 | `{ コアを掴む n / 必要 m - … }` |
| `placement` 複数 | 2 | `{ コアを置く 残り m - … }`（n/省略） |
| `separation` | 1 | `{ コアを掴む n / 必要 m - … }` |
| `separation` | 2 | `{ コアを置く 残り m - … }`（n/省略） |
| `core_move`（自由） | 1 | `{ コアを掴む n - … }`（任意省略） |
| `core_move`（数固定） | 1 | `{ コアを掴む n / 必要 m - … }` |
| `core_move` | 2 | `{ コアを置く 残り m - … }`（n/省略） |
| `core_split` | 1 | `{ コアを置く n / 必要 m - … }` |
| `core_source_allocation` | 1 | `{ コアを掴む n / 必要 m - … }` |
| `trash_distribution` | 1 | `{ コアを置く 残り m - … }`（n/省略） |
| `core_distribute(any_movable_self)` | 1 | `{ コアを掴む n / 必要 m - … }` |
| `core_distribute(any_movable_self)` | 2 | `{ コアを置く 残り m - … }`（n/省略） |

`core_distribute(even)` と現状 `life_damage_interception` は UI 介在なし（自動完了）。

## ボタン規則

| 状況 | 主ボタン | 副ボタン | リセット |
|------|---------|---------|---------|
| `card_cost` | **支払う** | キャンセル | リセット |
| `shoot` | **確定** | キャンセル | リセット |
| 2-phase phase 1 | **コアを置く**（→ phase 2 へ遷移、draft 維持） | キャンセル | リセット |
| 2-phase phase 2 | **完了** | キャンセル | リセット |
| 1-phase placement 系（placement 単体 / `trash_distribution`） | **完了** | キャンセル | リセット |
| pending 解決型（`core_split` / `core_source_allocation`） | **確定** | — | リセット |
| `core_distribute(even)` / 現状 LDI | （ボタンなし、自動完了） | — | — |

## キャンセル / リセット / 戻り規則

### キャンセル（context 別）

| Context | 動作 |
|---------|------|
| `card_cost` | 該当 action（召喚 / マジック / 効果起動）全体を abort。card_cost draft 全消去、`facade.end()`（現仕様踏襲） |
| `card_cost` → `placement` 遷移後の placement phase（1 / 2 共通） | **コスト支払い stage へ戻る**: placement draft（grab + place 両方）を消去、card_cost draft は保持、`facade.transitionMode("card_cost")` で mode を戻し `pendingCostPayment` を再構築 |
| `shoot` | コアシュート全体を abort |
| 2-phase placement 系（複数体召喚 / `separation` / `core_move` / `core_distribute(any_movable_self)`）の phase 1 / phase 2 | 該当 action 全体を abort。draft 全消去、`facade.end()`。**同 mode 内の phase 2→1 戻りは無し**（phase 2 でのキャンセルも全体 abort） |
| `placement` 単体（cost > 0 経由） | コスト支払い stage へ戻る |
| `placement` 単体（cost = 0 経由） / `trash_distribution` | 該当 action 全体を abort |
| `core_split` / `core_source_allocation` | キャンセル不可（pending 解決型。リセットのみ） |
| `core_distribute(even)` / 現状 LDI | キャンセル不可（自動完了） |

### リセット（phase 内、数値だけ戻す）

| Context | 動作 |
|---------|------|
| 任意 phase 1（grab） | grab draft（掴んだコア）をクリア。mode / phase は維持 |
| 任意 phase 2（place） | place draft（置いたコア）をクリア。掴んだコアは保持、phase 2 留まり |
| 1-phase mode | 該当 phase の draft クリア |
| `card_cost` → `placement` 遷移後 | placement draft のみクリア。card_cost draft は保持 |

### 確認ダイアログ

無し。誤タップキャンセル時は再開すれば良い。

## 実装メモ（facade API 連動）

- `placement` → `card_cost` 戻り（cost-payment 復帰）:
  - `coreSelection.removeMovesByPurpose("placement")` で placement 系 draft 一括消去
  - `coreSelection.transitionMode("card_cost")` で mode のみ戻す（既存 API、card_cost draft 保持）
  - `pendingPlacement = null` / `pendingCostPayment` を前回 cost draft から再構築
- `trash_distribution` / `core_distribute(any_movable_self)` の全体 abort:
  - engine 側 `PendingCoreDistribution.priorStateSnapshot` に「pending 提示直前」の `GameState` を保存
  - `abort_pending_core_distribution` legal action で snapshot を復元 → pending 消去 + 後続 effect step 未実行
  - HUD `onCancel` は `actions.find(a => a.kind === "abort_pending_core_distribution")` で引いて dispatch
- 同 mode 内 phase 戻りは存在しない → phase 1 ↔ phase 2 は確定方向のみ
- 全モード `previewState` 由来の表示（`coreDisplayOverrides` / `soulCoreDisplayOverrides`）は既存通り
- `core_split` は確定 action が配分配列だけを受けるため、draft は `coreSplitDestinationIndex` を保持し、確定時に `coreSplitDistribution` へ再構成する。効果元の通常コアは `previewState` へ直接流さず、表示 override で仮想減算する。
- `core_source_allocation` は field card tap の draft を `coreSourceAllocations` へ再構成し、確定 action でコストステップを再実行する。
- 確定前の Lv / BP / シンボルバッジも仮想コアで再計算する（`coreDisplayOverrides` のコア「数」表示と対）:
  - BattleScreen が `previewState` ＋ 掴み中コア（`heldCores`）の source 減算（共通プリミティブ `moveNormalCores` → void / `moveSoulCore` → reserve の sink）を重ねた `coreCalcState` を作り、FieldArea に渡す。
  - FieldArea は `getEffectiveBp` / `getEffectiveLevel` / `getEffectiveSymbolBundles` の算出基盤を `coreCalcState ?? state` に切り替える。全コア選択モードで「コア数」バッジと「Lv / BP / シンボル」バッジが連動して確定前変化する（継続効果込み・act_as_spirit token も host 追従）。
  - モード外は `state` フォールバックで通常表示と一致。
- 単一ソース `trash_distribution` で全配置必須（`minTotal === totalNormalCores`、例: BSTH01-M01「コアすべて」）の場合、grab=SKIP のため held buffer に乗らないソースコアを `coreDisplayOverrides` で明示減算する。発揮確定の時点でソースゾーン（trash / reserve）の通常コアを即 0 相当に、`mustPlaceSoulCore` ならトラッシュのソウルコアも `soulCoreDisplayOverrides["trash"]=false` で消去マークし、仮想的に「全コアを掴んだ」表示にする。部分配分可（`minTotal < total`）は従来通り配置済みのみ減算。
- `core_distribute(any_movable_self)`（フランドール【フォーオブアカインド】等）のソウルコアは `core_move` と同じ **grab→place** で扱う。Phase 1 でソウルの所在ソース（reserve / trash / life / 自分 field カード）を tap すると「ソウルコア確認（はい＝ソウル / いいえ＝通常コア）」ダイアログを出し、held buffer に soul として積む。Phase 2 で他の held コアと同様 face-down 候補へ FIFO で置く（`recomposeTrashDistributionLegalAction` が soul draft を `coreDistributionSoulCoreInstanceId` に集約）。
  - **1-phase `trash_distribution` 専用の「ソウル配置先を選ぶ」補助ボタン（`trashDistSoulMode`）は any_movable では出さない**。grab 前に出る／掴んでもいないのに配置先選択を促すのは不整合のため。soul-only ソース（通常コア 0 で `allowedSources` 非掲載）も grab できるよう `anyMovableSoulLocationId` で tappable に追加する。
- 相手フラッシュで draft が無効化された場合の自動 reset は既存 facade resilience（P3-46 G8）で吸収

## 実装単位

実装は [P3-48](../../../issues/archive/P3-48/index.md) (着地済 / archive) に分割。

## 関連

- エンジン側コア資源モデル: [20_design/06_core-resource-model.md](../20_design/06_core-resource-model.md)
- GUI facade: [coreSelectionFacade.ts](../../../apps/playground-web/src/coreSelectionFacade.ts)
- L1 projection: [core-draft.ts](../../../packages/rules-core/src/core/core-draft.ts)
- 共通プリミティブ: `any_movable_self` / `canMoveCoresFrom` ([archive/P3-47/F-5-multi-zone-core-source.md](../../../issues/archive/P3-47/F-5-multi-zone-core-source.md))
