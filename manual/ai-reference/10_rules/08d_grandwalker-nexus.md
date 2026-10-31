# 創界神ネクサス / 創界石（グランストーン）

親索引: `08_advanced-mechanics.md`。関連: `08c_imagin-mirage-grandwalker.md`（異魔神/ミラージュ）。既存コード対応状況は `20_design/11_structured-effect-model.md` 参照。
ソース: batspi.com (`cmd=read&page=` で取得、2026-03-29)

---

## 9. 創界神ネクサス（Grandwalker Nexus）

特殊ネクサス。通常ネクサスとコア管理・効果受付が根本的に異なる。

### 基本特性

- 配置時にコアを置け**ない**
- フィールドでは**「創界神ネクサス」を対象にした効果しか受けない**（通常のネクサス破壊/バウンス/維持コスト変更は不適用）
- コアは「創界神ネクサス」対象の効果（主に《神託》）でのみ置ける。通常コア移動効果の対象外
- **「ボイドからコアを増やしたとき」反応系トリガーの除外（裁定 2026-08-02, ユーザー確認）**:
  神託等でボイド→創界神ネクサス（導界者/創界石含む、`hasIndependentCoreManagement()`）へ
  コアが移動しても、`void_core_decrease` game event（BSSL01-C02「タンク」の「相手が相手の
  効果でボイドからコアを増やしたとき」型トリガー）は発火しない。上記「コアは創界神ネクサス
  対象の効果でのみ置ける＝汎用コア移動ソース除外」の裏返しとして発火面にも適用する（例:
  「自分のスピリット/創界神ネクサスにコア1個ずつまで置く」でスピリット0個・創界神1個を
  選んだ場合は反応しない）。(契約)カウント+N（`executeCountIncrease` がボイドから
  カウントエリアへ概念上コアを移動、`voidNormalCoreCount` を直接減算）も同様に除外する。
  実装は `collectTriggerEventsFromStateDelta`（`trigger-system.ts`）が独立コア管理カードへの
  着地分・カウント増加分を減算してから発火判定する。
- **解釈パターン（裁定 2026-08-02, ユーザー確認）**: 上記の「フィールドは創界神ネクサスを対象にした
  効果しか受けない」という既定を、カード文中の「[名前]以外の創界神ネクサスを**含む**フィールド/
  リザーブの…」という言い回しは明示的に打ち消し、対象プールを [名前以外の創界神ネクサス] ∪
  [通常のフィールド] ∪ [リザーブ] の3カテゴリ加算として再定義する。既定の除外ルールに対する
  カード文側の明示的な再包含として読む（BSTH02-X01『西行妖』の「「西行妖」以外の創界神ネクサスを
  含むフィールド/リザーブのコア1個をボイドに置く」で確認、`needs-ruling.jsonl` 該当エントリ参照）。
- **ソウルコア配置不可**
- フィールド離脱時、上のコアは**ボイドへ**（通常ネクサスはリザーブ）
- フィールド外では通常の「ネクサスカード」扱い

### 「参照する」と「効果を受ける」の区別（2026-09-19）

- **確定 A: 公式エターナル Q1532（2024.10.31）**。「参照する効果であれば、ネクサスとして参照できます」。フィールドの通常の創界神・契約創界神とも、存在・枚数・離脱などの誘発条件・効果の発生源の照合ではネクサスとして扱う。破壊・移動・修飾など、カード自身が受ける効果の対象制限とは区別する。
- 本文確認元: `external-qa-official/_freeword-契約カード.md` Q1532。公式検索: `https://www.battlespirits.com/faq/list.php?format=eternal&freeword=契約カード`。今回のWeb再取得は失敗したため既存公式ミラーを根拠とする。
- **適用例**: BSTS01-X02 が相手の創界神を破壊すると、自分のアタックステップ・Lv2以上の BSTS01-M02 は「相手のネクサスがフィールドを離れるとき」を参照し、任意のライフ→リザーブ処理を発揮できる。創界神自身にライフ減少効果を与える処理ではない。
- **独自種への適用 C**: 導界者・創界石もネクサスとして参照する。導界者を「創界神として」数えない qa-002 の制約は維持する（[独自裁定](07_custom-orica-mechanics.md)）。`grandwalkerKind` / `only` の限定を無視してよいという意味ではない。
- 魂状態は別の参照制限を持つ。Q1532後段どおり、魂状態の明示など既存の参照許可が必要。
- 実装: `matchesCardReferenceFilter` は既定の特殊ネクサス対象ロックだけを外す。作用対象には従来の `matchesCardFilter` を使う。監査範囲・分類は [創界神系参照の全監査](../30_plan/03_completed-milestones-phase-6-special-nexus-reference-audit.md)。

### 【神秘】などによる効果抑止

神技・神託の抑止と常時効果の例外は [創界神の効果抑止](08d1_grandwalker-effect-suppression.md) を参照。

### 契約域とカウントによるLv（2026-09-20）

- **A**: エターナルQ637（2024.10.31、`external-qa-official/_freeword-契約カード.md`）。契約創界神のLv2は上のコアではなく自分のカウントを参照する。
- **適用 C**: 画像のBSTH02.7-CX01「C1」、BSES01-CX01「C4」もカウント1/4でLv2。コア支払いでLvは下がらない。`LevelDefinition.requiredCount` で指定し、表示・条件は実効Lvを使う。
- 領域は一律の常時効果ではない。誘発・期間・回数は各本文に従う。出典・調査経路・実装は [全24カード監査](../30_plan/03_completed-milestones-phase-6-domain-audit.md) を参照。

### サブシステム

| 名称 | 仕組み |
|------|--------|
| **神託** | 対応系統の召喚/煌臨/配置/使用時にコア+1（任意。2019年4月〜）。配置時は3枚破棄→対象分+1。旧標準は同名不在ゲート、新契約型は同名ターン1台帳 |
| **神域** | 創界神上のコアが条件数以上のとき発揮する効果。Lv条件あり |
| **神技** | 創界神上のコアを**ボイドに置く**ことで発動する効果 |
| **転神** | 創界神上のコアをボイドに置き、スピリットとしても扱う。Lv1コスト0で消滅しない。創界神ネクサス以外では破壊されない。BPを持ちアタック/ブロック可能 |
| **界放** | 創界神上のコアを消費して追加効果。事前に神託で十分なコアが必要 |

**【現界】** 条件節の対象があるとき、指定の対価を払って手札から「出す」効果。
2026-09-26再確認（独自Q&A qa-046: A、BSTH10-X05への適用はユーザー確認: C、実装採用）。
qa-046原文: 「カードの使用ではありますが、「召喚/煌臨」ではないため、【神託】の「対象の自分のスピリットを召喚/煌臨したとき」の条件は満たしません。」
BSTH10-X05の現界も `put` であり、神託・自身や他カードの「召喚」を条件とする効果を発揮しない。
「現界時」を指定した効果は `put` / `effectScope:genkai` で発揮する。
維持コア配置の自動処理・対話選択後の再開、神域で手札扱いのデッキ上から出す場合にも適用する。
調査・回帰の記録は [BSTH10調査](../00_meta/source-findings-bsth10.md#現界は召喚ではない2026-09-26) を参照。

- 神託条件の併記 `スタック効果&マジック` / `スタック効果＆マジック` は、配置時神託では「デッキ上3枚をトラッシュに置き、その中の**スタック効果を持つマジックカード**の枚数」を数え、使用時神託では「**マジックカードのスタック効果を使用した**」イベントを条件にする（裁定2026-06-18、BSTH10.5-X01）。
- `OracleCondition` の `categories` は**必ず明示する**（省略＝無制限ではなく実装バグの温床）。`〔幻想＆コスト3以上〕`のように bracket が種別キーワードを含まない条件は、bullet1「対象の自分のスピリット/ネクサス」等の記載範囲に合わせ `categories` を明示する。召喚/煌臨/配置イベントはカード種別で自然に絞られる（マジックは配置されない）ため見落としやすいが、配置時神託のデッキ上3枚カウントはカード種別を問わず全カードを走査するため、`categories` 省略時はマジックカードが誤って対象カードとしてカウントされる（裁定2026-07-05、BSTH04-XX01 等13枚で確認・修正）。

### 創界石（グランストーン）

創界神とは**別カテゴリ**（創界神対象の効果も受けない）。転醒（ダブルフェイス）機能を持ち、A面ネクサス/B面スピリット（またはブレイヴ）。

独自カード（BSTH 系 5 枚）の本文から確定した共通ルール:

- このネクサスは**創界石ネクサス対象の効果しか受けない**（通常効果・創界神対象効果の対象外）
- コアは**解封と創界石ネクサス対象の効果でしか置けず**、上のコアは創界石対象の効果しか受けず移動できない
- 配置時にコアを置けない / ソウルコア generic 配置不可（公式裁定の禁止先 4 箇所に創界石が明記）
- フィールド離脱時、上のコアはボイドへ（創界神と同型）

| 機構 | 仕組み |
|------|--------|
| **解封** | 【解封：〔条件〕】成立時、ボイドからコア1個をこのネクサスに置ける（任意）。条件はカードイベント系（自分のスピリットの召喚/アタック/転醒 + 名前/系統フィルタ）と手札増加系（「〜を持つ自分の効果による自分の手札の増加」= 原因効果の発揮元カードで判定）の 2 系統。ネクサスの**配置**は解封トリガーに含めない（裁定2026-06-10: 本文の「召喚/転醒」列挙どおり）。原因効果カードの色は**実効色**で判定（「色としても扱う」反映後、系統/シンボル判定と同様） |
| **転醒** | 「このネクサスのコアが N 個以上になったとき、裏返せる」= **誘発**（08a:83）。「**以上**」のため閾値跨ぎ (2→3) **だけでなく既に閾値以上での増加 (3→4 等) も「N個以上になった」に含む**（裁定2026-06-10）。＝コアが増加し結果が閾値以上のたびに任意発動。辞退後の再挑戦には新たなコア増加が要る。裏返すとき残置コア数（全コア/1個残し）以外を**ボイド**に置き、カウント+1。転醒後の追加処理（転醒後ブレイヴの自分スピリットへの合体 / フィールド・リザーブから転醒後スピリットへの任意コア配置）を持つカードがある。裏返してコア不足（B面最低Lv未満）なら表面の転醒時効果は発揮できるが転醒は成功せず消滅・カウント増えず（08a:83。現行5枚のB面はすべて requiredCores:0 で不足は生じない） |
| **神秘** | キーワードラベルのみ共通で、効果本文はカードごとに異なる（軽減補助/交換/効果抑止/手札耐性等）。通常の effects として個別表現する |

表記ゆれ: 本文中「解放」とヘッダ【解封】は同一機構の表記ゆれ（裁定2026-06-10）。

### 実装状況

実装済み（`oracle-system.ts` / `model.ts`）。導界者ネクサスもこの型で表現する。

```typescript
interface GrandwalkerData {
  kind: "grandwalker" | "guided";
  oracleConditions: OracleCondition[];  // OR結合
  oracleExecutionMode?: "mandatory" | "optional";  // 省略時 optional
  oracleTriggerKinds: readonly [OracleTriggerKind, ...OracleTriggerKind[]];  // 本文の通常イベント。空不可
  placementOracle?: false | { revealCount?: number; sameNameGate?: boolean; turnLimit?: "per_card_name" };
  divineSkills?: DivineSkillEntry[];
}
interface OracleCondition {
  tribes?: string[];
  categories?: CardCategory[];
  minCost?: number;
  hasMechanic?: ("mirage" | "accel" | "change" | "burst" | "zero_counter" | "rebirth")[];
}
interface DivineSkillEntry {
  label: "divine_skill" | "guided_skill" | "divine_release" | "contract_skill";
  coreCost: number;
  timing: DivineSkillTiming;  // "flash" | "main" | { step; whose }
  minLevel?: number;
  maxLevel?: number;
  turnLimit?: "once" | "once_per_name";
  effects?: EffectAction[];
}
interface DivineTransformState {
  bpByLevel: { level: number; bp: number }[];
  colors?: CardColor[];
  symbols?: SymbolColor[];
  protectedFromNonGrandwalker: boolean;
}
// CardInstance.divineTransformState: DivineTransformState | null（ターン毎リセット）
// コアは通常の normalCoreCount で管理（grandwalkerCores という独立フィールドは設けない）
```

- 配置制限は `enter_field_core_placement_forbidden` で既存実装。
- 通常神託は空でない `oracleTriggerKinds` の本文列挙だけに反応し、未指定はキューしない。収集・宣言・解決とアクセルの区別は[通常神託イベント](08d1_normal-oracle-events.md)を参照。
- `checkAndQueuePlacementOracle()` / `resolvePlacementOracleMechanic()`: 配置時神託。
  発火（デッキ上 N 枚トラッシュ）は「置ける」＝任意なので `placement_oracle` mechanic 誘発としてキューし、発揮宣言でスタック窓を開く（`02:186`）。
  旧標準は `sameNameGate` 既定 true。BSES01-CX01 / BSTH02.7-CX01 型は `sameNameGate:false` + `turnLimit:"per_card_name"` で通常/復活配置を共有制限。
  マッチ分コア+1 は終止形＝強制で、発揮時の解決内で自動配置する。専用 `pendingPlacementOracle` / `resolve_placement_oracle` は廃止。
- 神技/界放/契約技/導技（`DivineSkillEntry`）の**発揮宣言もスタック窓を開く**（`02:186`「常時以外の効果発揮」。`applyDivineSkillAction` が actionKind `divine_skill` の ActiveStack を開き、窓クローズ後の `resolveDeferredDivineSkillStack` で発揮コスト（コア→ボイド＝効果文内）支払い＋ effects 実行）。コア消費を窓の前に行わないのは「コアをボイドに置く」が使用コストでなく効果文内のため。
- 神域（domain effects）・転神（`DivineTransformState`）の各サブシステムは型・処理とも拡充済み。
- 両タイプ持ち（BSTH05.5-XX01 龍神 = 創界神・導界者）は `GrandwalkerData.alsoCountsAs` で表現し、種別判定は `grandwalkerKindMatches()`（SSOT）を通す（2026-06-10）。

### 創界石の実装状況

実装済み（`grandstone-system.ts` / `model.ts`、2026-06-10）。

```typescript
interface GrandstoneData {
  unsealConditions: UnsealCondition[];   // OR 結合
  rebirthCoreThreshold?: number;         // コア N 個以上「になったとき」
  rebirthMaxCount?: number;              // 転醒条件: 自分のカウント N 以下
  rebirthRetainCores?: number;           // 残すコア数（残りはボイドへ。省略時 0）
  postRebirth?: "combine_with_own_spirit" | "charge_cores_from_field_reserve";
  rebirthExcludedFromUnseal?: boolean;   // 「この転醒で【解封】はできない」
}
interface UnsealCondition {
  events: ("summon" | "attack" | "rebirth" | "hand_increase")[];
  cardFilter?: { nameContains?; tribes?; categories? };  // カードイベント系
  causeFilter?: { tribes?; colors? };                    // 手札増加系（原因効果の発揮元）
}
```

- 対象制限: `CardFilter.targetsGrandstone` / v1 `EffectTarget.includeGrandstone`（創界神とは別軸）。
- コア管理: `hasIndependentCoreManagement()` で創界神/導界者/創界石を一括判定（汎用コア移動ソース除外・離脱時コア→ボイド）。
- 解封検出: `collectAndQueueTriggerReactions` 内の delta フック（summon/rebirth/increase_hand）+ アタック宣言（battle-actions）。手札増加はイベントの `cause:self_effect` と `relatedInstanceId`（増加を起こした効果元）で判定する。バースト・内包された自己回収でも外側の効果元で上書きしない。解封/転醒の選択待ちは mechanic 付き誘発エントリ（P3-92: `pendingTriggeredEffects`）に乗り、`resolve_pending_triggered_effect` の発揮する/しないで解決する。
- 転醒: 「コアが増加し結果が閾値以上」のたびに `checkAndQueueStoneRebirthChoices` が検出 → mechanic `stone_rebirth` を誘発キューへ（受諾で executeRebirth、`returnedCoresDest:"void"` 拡張）。転醒後合体は `pendingStoneFlipCombine`（`resolve_brave_combine_choice` 共用）、転醒後コア配置は `pendingCoreDistribution`（any_movable）を流用。B面最低Lv不足の中断は executeRebirth の標準 lv-deficit 経路（現5枚は requiredCores:0）。
- 「転醒は同時に使えない」の待機誘発の排他範囲は原因の発生・プレイヤー単位（[08a §2](08a_advent-rebirth-contract.md)）。直接呼出し等の旧経路のみ `actionStartLogIndex` を使用する。
