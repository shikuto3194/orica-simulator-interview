# 異魔神 / ミラージュ

親索引: `08_advanced-mechanics.md`。既存コード対応状況は `20_design/11_structured-effect-model.md` 参照。
ソース: batspi.com (`cmd=read&page=` で取得、2026-03-29)

---

## 7. 異魔神（Imagin Brave）

系統「異魔神」を持つ特殊ブレイヴ。**2体のスピリットと同時合体**可能。

### 通常ブレイヴとの違い（ルール特記、効果無効化で打ち消せない）

- 右合体条件・左合体条件を個別に持ち、2体合体可能
- **疲労しない**（いかなる効果でも）
- スピリット状態では**アタック/ブロック不可**
- **Lv1コスト0**（コア0でも消滅しない）

### 左右合体

- **形式A**: 右合体条件+【右合体中】、左合体条件+【左合体中】（別々の効果）
- **形式B**: 左右合体条件+【左合体中/右合体中】（共通効果）
- 2体同時合体不可。**1体ずつ処理**。各合体先は独立した合体スピリット
- 異魔神と合体中は他のブレイヴと合体不可

### シンボル計算

異魔神のシンボルは直接カウントせず、**各スピリットに個別加算**。1シンボル異魔神×2体合体 → 合計2シンボル分の軽減。

### 片方離脱

片方がフィールドを離れても、もう片方との合体は継続。「分離させスピリット状態にする」効果なら両方と分離。

### 主要裁定

- 一方のスピリットが装甲を持たない場合、そちらへの効果で異魔神ブレイヴ全体が破壊されうる
- 【マイユニット】で合体中の詩姫を並べるとき、異魔神は分離される

### 実装状況

**部分実装（2026-08-13更新、engine-imagin-brave-dual-combine cluster）。**

```typescript
// CardDefinition.imaginBraveData（model.ts、既存 scaffold のまま）
interface ImaginBraveData {
  leftCondition?: BraveCondition;
  rightCondition?: BraveCondition;
  sharedCondition?: BraveCondition;
}
// CardInstance.imaginRightCombinedWith: string | null を新設。
// 左スロットは既存の汎用単一合体 (attachedToInstanceId / host 側 attachedChildrenIds)
// をそのまま流用し、右スロットだけをこの独立フィールドで追跡する非対称設計
// （右ホスト側 attachedChildrenIds へは反映しない。P3-16 多重合体の相互整合性
// invariant と衝突させないため）。
```

- `isImaginBraveDualCombined()` (model.ts) が左右両スロット充足を判定。
  `Applicability.imaginDualCombined` として `evaluateApplicability` /
  `evaluateTriggeredApplicability` に配線済み（BSTH001-転醒R01(B) 玄爺 effects[1] で使用）。
- legal action は既存の `brave_combine` kind を再利用。対象ブレイヴが既に左スロット
  合体済み (`attachedToInstanceId !== null`) なら
  `getAvailableBraveCombineLegalActions` が右スロット候補（`imaginBraveData.rightCondition
  ?? sharedCondition`）を追加列挙し、`legal-actions-apply.ts` が
  `executeImaginBraveSecondCombine`（コア移動・疲労合流なし）へ分岐する。
- `queueRegisteredBattleImmediateEffects`（battle-immediate-effect-system.ts）は
  host 側 `attachedChildrenIds` 巡回に加え、`imaginRightCombinedWith ===
  sourceCard.instanceId` のブレイヴも member として拾う（右ホストのアタック宣言でも
  ブレイヴ自身の card_event 効果が queue される）。
- 「疲労しない」は `isCardExhaustionForbidden` をSSOTにし、効果の`exhaust`/
  `set_exhaust_state`、アタック/ブロック宣言、疲労コスト候補、SBA正規化へ配線済み。
  防止不可効果でも異魔神ブレイヴ自身の疲労state/eventを発生させない。
- スピリット状態の異魔神ブレイヴは同じSSOTを宣言可否にも用い、アタック／ブロックの
  宣言元から除外する。
- **既知の未解決ギャップ（後続 cluster）**: `target:{kind:"self"}` は
  `resolveSelfReferenceCard`（model.ts SSOT）経由で `attachedToInstanceId`
  （常に左スロットホスト）へ redirect される。右ホスト単独のアタックでも効果は
  常に左ホストへ適用され、実際にアタック宣言したホストへ動的に redirect しない
  （シンボル個別加算・片方離脱時の残存合体と同じく本 cluster のスコープ外）。
  `rightEffects`/`leftEffects`/`sharedEffects` 個別効果セット・「Lv1コスト0」も未配線。

---

## 8. ミラージュ（Mirage）

手札からバーストエリアに**表向き**でセットし、【セット中】効果を永続発揮。バーストとは**別枠**。

### セット方法

- メインステップに**ターン1回**、ミラージュコスト支払い。効果セットはターン制限なし
- 既存ミラージュがあれば**入れ替え**（古い方は**手札に戻る**。手札増加扱いではない）
- バーストの上に重ねて置く。バースト1枚 + ミラージュ1枚の**同時セット可能**
- 手札からのみ（手元からは不可）

### セット中の扱い

- 【セット中】効果を永続発揮。ミラージュ効果以外のスピリット/ネクサス/マジックとしての効果は発揮不可
- フィールドにあるものとして**参照不可**（カード種類/コスト/効果いずれも）
- ミラージュを対象にした効果のみ受ける
- バースト破棄でミラージュは影響を受けない
- 任意破棄/手札戻し不可。入れ替えのみ

### 主要裁定

- ミラージュのコスト/軽減シンボルは手札操作効果で変更されない
- BSTH002-C01 化け化け「セット可能枚数」(2026-10-24ユーザー訂正): セット済み各個体は常に0枠（行動数免除の使用済み状態とは独立）。通常枠を数えるカードは最大1枚。新規セットは、追加または既存1枚との個別交換のうち、交換後の有効枠数が1以下になる候補から選ぶ。全件交換は不可。手札からの自身のセット行動数免除は同名(cardNo)・プレイヤーごとにターン1回で、免除時は通常セット行動数を消費しない。化け化け+Aから通常BはAとの交換のみ、化け化けBは追加/A交換/化け化け交換。化け化け2枚からは追加またはどちらか1枚との交換。
  実装と回帰は `mirage-system.ts` / `bsth002-c01-mirage-set-count-exemption.test.ts`、効果/無償セットも同じ候補を効果解決中に選び、通常行動数/手札免除は消費しない。GUI/RESTは `?scenario=mirage-individual-swap` / `?scenario=mirage-effect-swap`。裁定履歴は `needs-ruling.jsonl`。

### 実装状況

実装済み（`mirage-system.ts` / `model.ts`）:

```typescript
interface MirageData {
  cost: number;
  reduction: SymbolColor[];
  effects?: Effect[];  // timing: "continuous"
}
interface MirageSetState {
  playerId: string;
  cardInstanceId: string;
}
// GameState に mirageSetStates: MirageSetState[] と
// mirageSetPlayerIdsThisTurn: string[] を追加
```

- CardZone `"mirage"` は内部状態管理上の独立ゾーンとして用意する。GUI ではルールどおりバーストエリア内に合成表示し、バースト/ミラージュ両方分の予約枠で斜め重ねにする。
- `useSetMirageAsAction()`: 手札 → ミラージュゾーンへ移動。既存ミラージュは手札へ戻す（handCount のみ差し引き、handIncreasedBy 非加算）。
- `getMirageSetBlockReason()`: メインステップ・アクティブプレイヤー・ターン1回制限・手札起源・MirageData 所持をチェック。
- `removeMirageSetState()`: ミラージュカードがゾーン離脱時に mirageSetStates から除去（共通パイプラインから呼び出し）。

創界神ネクサス / 創界石（グランストーン）は `08d_grandwalker-nexus.md` 参照。
