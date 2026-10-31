# 効果防止の優先順位

親文書: [04_state-based-rules.md](04_state-based-rules.md)。旧 `03c_effect-text-interpretation.md` から `04b_burst-rules.md` へ移設(2026-06-16)後、同ファイルのサイズ上限超過に伴い再分離(2026-07-26)。

- **「防げない」は解決時の防止を貫通する。発揮禁止・発揮前無効化への優先順位ではない。** 公式Q1479/Q1481により、効果自体を発揮できない場合は発揮できず、発揮前には無効にできる（下記）。
- **「防げない」効果は `cannot_*` 効果耐性 (受けない / 破壊されない / 手札に戻らない 等) も貫通する** (公式裁定: 「『防げない』破壊効果は、相手の『装甲』を含む効果・『効果を受けない』・『破壊されない』・『手札/デッキに戻らない』・コア除去対策などを無視する」信頼度 A、2026-05-03 確認 / [P3-43 (archive)](../../../issues/archive/P3-43/index.md))。

実装状況: 型定義済み。`EffectPreventionLevel` (`"unpreventable"` | `"immune"` | `"suppress"` | `"none"`) を全効果登録型に追加済み。比較ヘルパー `comparePreventionLevel()`, `canEffectPenetrateDefense()` あり。`EffectFilterTag` + `getEffectFilterBlockReason()` との統合は未実装。
P3-43 完了: `cannot_*` (effect_resistance) との衝突は `filterOutResistantCards` の `sourcePreventionLevel` 引数経由で `"unpreventable"` を bypass する形で配線済み。registration → ActiveStack → EffectActionContext → executeEffect → 5 executor の経路で伝搬。
カード対象「相手の効果を受けない」(`defense_immune`、`effect_immunity` action) の汎用配線完了 (2026-06-01): GUI 候補列挙 (`getCandidateTargetInstanceIds` → `filterTargetsByPreventionLevel`) に加え、共有述語 `isCardImmuneToOpponentEffect` を `analyzeCoreShootCandidates` (コアシュート) と実行時カード対象解決 `resolveTargets` (destroy 等 ~18 action の "all"/ref/preSelected 経路) に配線。opponent-only gate (acting === controller は対象外) ＋ `canEffectPenetrateDefense` (防げない貫通) を集約。例: 回復状態パチュリー BSTH01-M01 へのコアシュートが no-op。

## 「防げない」と効果自体の無効化

[公式Q1479/Q1481/Q1485と実装差分](04b6_prevention-and-negation.md)を参照。「防げない」効果も発揮前に無効にできる（信頼度A、2026-10-02確認）。

## 「受けない」のプレイヤー範囲（受け手側の文言）

### 効果源の種類はカード状態も含む（2026-09-25確認、信頼度A）

公式エターナル [Q3641](https://www.battlespirits.com/faq/list.php?prodname=BS16&format=eternal)（ミラー `external-qa-official/BS16.md:19`）:

> 「スピリットカード」の状態で発揮される効果ですが、「スピリットの効果」として扱うので、【装甲：赤】によって破壊できません。

[Q5438](https://www.battlespirits.com/faq/list.php?prodname=BS32&format=eternal) も、スピリットカードのフラッシュ効果では「スピリットの効果を受けない」相手を対象にできないとする。
したがって「相手のスピリットの効果を受けない」はスピリットカード由来の効果も防ぐ。戦闘できる実体かを判定する `isCardTextCardState` / `isBattleCapableCategory` を、効果源の種類判定へ流用しない。発生源の種類は `getEffectiveCategory` / `getEffectiveCategories` で照合する。手札・バースト・トラッシュ・手元・表向きのフィールドカード状態について、候補除外と破壊解決を回帰化。

### プレイヤー範囲

- 「**相手の**効果を受けない」= 相手起因のみ（実装既定 `sourcePlayerScope` 省略時 = `"opponent"`）。
- 「**一切の**効果を受けない」= **自分の効果も受けない**（`sourcePlayerScope:"any"`）。公式裁定 3 件が一致（いずれも 2024.10.31、信頼度 A）。Q7010 (BS43-071、`external-qa-official/BS43.md:675`) /  Q7065 (BS43-XX01、同 :952) / Q25555 (BS43-094、同 :1607) — いずれも Q「『（セットしている/）トラッシュにあるこのカードは、一切の効果を受けない』とあるけど、自分の効果も受けないの？」A「はい、その通りです。」
- 「**この効果は**一切の効果を受けない」は**効果対象**であってカード対象ではない（別軸。実装は `effect_resistance` の `source:"all"`）。カード対象の `sourcePlayerScope` と混同しない。

> **解消済み (2026-08-05, P3-144)**: 「一切の効果を受けない」を印字する 7 枚（BSKB01-R04 / BSLH01-C03 /
> BSLH01-C13 / BSLH01-M02 / BSSG01-R01 / BSTH002-M01 / BSTH08-C01）が `sourcePlayerScope` 未指定で
> 自分の効果を止めていなかった card-data 欠落を修正（DSL・判定側は元々対応済み）。card-data 横断テストで
> 「原文に『一切の効果を受けない』を含み、対応 effect が `effect_immunity` のものは
> `sourcePlayerScope:"any"`」を assert し以後の漏れを機械検知する
> (`zettai-immunity-player-scope-scan.test.ts`)。

## 「防げない」文言の 2 型と貫通範囲

原文には意味が真逆の 2 型がある。公式裁定で確定済み（信頼度 A）。

- **「X以外の効果では防げない」「Xを持たない効果では防げない」= X だけが防げる**。
  Q8745 (BS55-XX01、`external-qa-official/BS55.md:888`): 強力な「効果を受けない」を持つスピリットが「【重装甲】/【超装甲】以外では防げない」効果を「受けるの？」→「はい、受けます」。実装は `onlyPreventableBy*`。
- **「Xの効果では防げない」「Xを持つ効果で防げない」= X 以外が防げる**。
  Q9751 (BS60-X01、`external-qa-official/BS60.md:1043`): 「相手の白の効果では防げない」が失効すると「白の効果で防がれます」。実装は `notPreventableBy*`。
- 「一切の」はスコープ内の強調としても使われる（「系統：「蓬莱」を持つ**一切の**効果で防げず」）。blanket と即断しない。
- **「X以外の効果では防げない」（語順: 色+以外+の+効果）は単色一致（mono）で判定し、X を含む多色は満たさない**（信頼度 A、独自カードサイト Q&A）。
  qa-020 (`external-qa/qaData.js:210`、BSTH01-XX02 一般解説): 「・「白以外の効果では防げない」←**白1色の効果**で防いだものとして扱います。」
  — この「1色」の明記は機械的な言い回しではない。公式裁定 Q20554 (BS32-056、`external-qa-official/BS32.md:761`)
  が「赤1色の」と「赤以外としても扱う効果を持っている赤の」を明示的に区別する（後者は前者を満たさない）ことからも、
  「X」と「X1色」は BSS ルール上別概念であり、qa-020 は前者ではなく後者を明示的に選んでいる。
  実装は `EffectSourceFilter.colorMatchMode`（`target-affect-gate.ts:293-330` の
  `matchesEffectSourceFilter`、SSOT 一本化済み）の `"exact"`（`sameStringSet` 完全一致）で表現し、
  未指定時デフォルトの `"includes"`（`source.colors` に 1 つでも含めば一致＝多色可）とは区別する。
  card-data 側の適用状況（2026-08-05 確認）: BSTH002-X01 (`colorMatchMode:"exact"` 設定済み) /
  BSTH01-R11 (同) は「X以外の効果」語順どおり `"exact"`。
  **「Xの効果以外では防げない」（語順: 色+の+効果+以外、例 BSTH03-X01
  `packages/card-data/src/cards/BSTH03.ts:2641`「黄の効果以外では防げない」）は上記 qa-020 の対象語順ではなく、
  別パターンとして扱う。ユーザー確認 (2026-08-05、信頼度 C): この語順は色マッチングの既定 `"includes"`
  （多色黄も可）が正しく、`colorMatchMode` は未指定のままでよい — 「以外の効果」語順との統一を仮定して
  `"exact"` を付与するのは誤り（一度試みて撤回済み）。ai-reference/needs-ruling.jsonl に語順差の裏付けを起票検討。**

**blanket「相手の効果では防げない」の貫通範囲**（3 段構造。target lock だけ別扱い）:

| 文言                         | 「受けない」/`cannot_*`（affect immunity） | 「対象にできず、含めない」(target lock) |
| ---------------------------- | ------------------------------------------ | --------------------------------------- |
| （rider 無し）               | 防がれる                                   | 対象にできない                          |
| 「相手の効果では防げない」   | **貫通**（相手の防止効果）                 | 対象にできない                          |
| 「お互いの効果で防げない」   | **貫通**（お互いの防止効果）               | 対象にできない                          |
| 「一切の効果で防げない」     | **貫通**                                   | **貫通**                                |

**target lock を貫通するのは「一切の効果で防げない」だけ。「お互いの効果で防げない」では貫通しない**（ユーザー確認 2026-08-04）。「お互い」は防止効果の**プレイヤー範囲**を最大化する語であって、防ぐ手段の**種類**を最大化する語ではない（推論。裁定原文が挙げるのは一貫して「一切」のみ）。

既存裁定の適用例（2026-10-16）: BSTH04-C11「審判『ラストジャッジメント』」の全体アタック禁止は、カウント2以上で「相手の効果では防げない」となっても、自分のアタックステップ中のBSTH06-X02「古明地 こいし」を含めない。動的フィルタの戦闘CEも適用時に共通の対象取得ゲートを通し、通常の効果免疫と対象ロックを別々に判定する。回帰: `koishi-target-lock-battle.test.ts`。

確定裁定（ユーザー確認 2026-06-18、`issues/P3-105_effect-target-classification-rulings.md:113`）:「target lock は『受ける/受けない』ではないため、通常の『防げない』では貫通しない。affect immunity / operation-specific immunity は通常の『防げない』で貫通する」。同 :170「『一切の効果で防げない』は target acquisition gate を貫通できる」。

根拠（`P3-105_acquisition-redirect-prevention-profile.md:54`）:「`一切の効果で防げない` は、文言上『防ぐ効果』の集合を最大化している。target lock も『その効果を成立させないための効果』なので、target acquisition gate まで貫通する別 rider として扱う」。実装は `preventionLevel` と `targetLockBypass` の別軸（`canBypassTargetLock` は後者のみ参照）。

affect immunity 行は公式 Q30155 (BS73-AX02、`external-qa-official/BS73.md:1419`) が裏付ける。「**スピリットの効果を受けない**…相手のスピリットを…対象にできるの？」に対し「通常では対象にできませんが、この効果は相手の効果では防げないので、対象にできます…【重装甲】や【超装甲】を含む『効果を受けない』効果…相手の効果では防げません」。**主語は「受けない」であって target lock ではない**（混同注意）。同 A の例外「ただし、【転神】している創界神ネクサスは対象にできません」は、blanket でも貫通しない対象取得ゲートの存在を示し上表 2 行目を補強する。同型 Q&A: `BS46.md:951` / `BS49.md:1137` / `BS53.md:1303` / `BS55.md:1483`。

実装: 限定的防止不可 (`preventionRestriction`) は `sourcePreventionBypass` として防止元 CE の効果源 identity（色/カテゴリ/系統/キーワード）を照合する。`onlyPreventableBy*` は指定スコープに一致する防止元だけを残し、不一致の `cannot_*` / `defense_immune` / target lock を貫通する。`notPreventableBy*`（色/カテゴリ/系統/キーワードの 4 軸すべてに存在、P3-140 で色/カテゴリ/キーワードを追加）は一致する防止元を貫通する（`prevention-restriction-scope.test.ts` / `prevention-restriction-negation-classification.test.ts`）。

> **解消済み (2026-08-05, P3-140)**: 否定形フィールドが系統以外に無く 2 枚（BSTH06-転醒X01(B) / BSTH01-R11）が真逆に符号化されていた問題を修正。`notPreventableByColors` / `notPreventableByCategories` / `notPreventableByKeywords` を追加し、2 枚を `not*` へ移行、13 サイト全件の型対応を横断テストで固定。
> **解消済み (2026-08-05, P3-143)**: 「一切の効果で防げない」1 枚（BSTH001-M01）は P3-141 で `targetLockBypass:{kind:"all_effects"}` を既に付与済みと判明。残タスクだった盤面テスト（一切=貫通／お互い=非貫通／通常=非貫通の3方向）・card-data 横断機械検知 sweep・「系統：「蓬莱」を持つ一切の効果で防げず」型 scope 付き rider の配線確認（`preventionRestriction.notPreventableByTribes` から `derivePreventionProfile` 経由で自動反映済みと判明、追加配線不要）を完了 → [archive/P3-143](../../../issues/archive/P3-143/index.md)。
> **解消済み (2026-08-05, P3-142)**: 防止元 identity（`EffectSourceIdentity.categories`）が合体中ブレイヴ／転神中創界神ネクサス／スピリット状態ブレイヴの二重状態を反映していなかった問題を修正。`getEffectiveCategories()`（mechanics/act-as-spirit.ts）が SSOT → [archive/P3-142](../../../issues/archive/P3-142/index.md)。
> **調査済み (2026-08-06, P3-142残留懸念)**: `EffectSourceIdentity.colors`/`tribes` は `categories` と異なり合体ユニットで union しない設計判断を確定。系統は `05_brave-and-attack-special-cases.md:27`「合算しない要素: 名前、系統」で明示的に対象外。色は同ファイル:26「属性（色が追加）」自体は合体スピリット全体の属性として union されるが、`colorMatchMode:"exact"` の単色判定を崩すリスクがあり、かつ現行カードプールに実害となる組み合わせが無いため見送り（`buildEffectSourceIdentity` の doc コメント、`engine-effective-colors-tribes-combined-unit-union.test.ts` で固定）→ [archive/P3-142](../../../issues/archive/P3-142/index.md) 残留懸念節。

**「受けず、受けるとき、相手の効果が指定する効果/条件で防いだものとする」イディオム**（例: BSTH01-XX02 博麗 霊夢、公式裁定 qa-020 信頼度A）。
「〜では防げない」型の効果を受けたとき、「〜では」の部分を満たして防いだものとして扱う。**防げる条件が 1 つでも存在するなら自動的にそれを満たし、条件が存在しない（「お互いの効果で防げない」「一切の効果で防げない」＝真の blanket）ときのみ防げない。** 上の Q30155 の一般則（blanket は「受けない」を貫通する）に対する明示的な例外。

> **実装済み (2026-08-05, P3-141)**: `effect_immunity` action の `satisfiesPreventionRestriction` marker
> （`EffectImmunityAction.satisfiesPreventionRestriction`、XX02 のみ設定）。防止元 CE がこの marker を
> 持つとき `canSourceBypassResistanceCE` は実 identity 照合をスキップし、`sourcePreventionBypass` が
> 真の blanket（`TargetLockBypassProfile.kind: "all_effects" | "blanket_affect_immunity"`）でない限り
> bypass しない。「一切」(BSTH001-M01) は affect immunity・target lock 両軸を貫通する既存
> `kind:"all_effects"` のまま（[P3-143 (archive)](../../../issues/archive/P3-143/index.md)
> の done-definition と一致、二重定義しない）。「お互い」(BSAZ02-C14) は target lock を貫通しないため、
> affect immunity 軸限定の新設 kind `blanket_affect_immunity` を付与（`all_effects` と異なり
> `canBypassTargetLock` は明示的に false を返す）。残り20サイトはデフォルト（bare
> `preventionLevel:"unpreventable"`, bypass profile 無し = 相手のみ）のまま。

バースト特有の抑止・対価ゲート（「無効」/「発揮できない」のタイミング、バースト発動への対価ゲート、「手札が増えた後」バーストによる事後無効化）は [04b3_burst-suppression-and-paid-gates.md](04b3_burst-suppression-and-paid-gates.md) へ分離した (2026-08-04)。
