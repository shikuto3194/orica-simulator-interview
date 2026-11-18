# 対象コストの複数carrier・分岐の再確認（2026-10-17）

対象は `BSTH04-XX01 effects[1]` と `BSTH06-C03 effects[0]` の
`target_cost_scope_review` 2件。静的な本文句の帰属が複数候補になるため、
検知器の一意性条件を緩めず、現行の本文・定義・正源・通常gate回帰を結合して再確認する。

## 入力と意味

- 本文A: 承認済み共有 `external-qa/cardData.js` の id:132 / id:169、
  `packages/card-data/raw/by-pack/BSTH04.js` / `BSTH06.js`、現行カード定義の本文を照合。
  共有ミラーの正規化hashは `84e44c876d73aa715f8970e49b8b9bb2ac6b4920eb2c8852ae4dfee66cd665e1`。
  配布元revision・取得path・確認日は `scripts/audit-mirror-provenance.json` の承認と一致。
  今回はミラー・provenance・カード定義を変更しない。
- 正源A: [03c:96](../10_rules/03c_effect-text-interpretation.md#本来のコスト) の
  「本来のコスト」はカード記載コスト（公式 Q21662 / Q24243）。
- 正源C: 同[03c:70](../10_rules/03c_effect-text-interpretation.md#さらにその後この効果発揮後の違い)の
  「その後」は前段後に後段を解決し、前段が実行できなくても後段を実行できる。
  任意性と同名制限は既存03c/03eに従う。新しい裁定は追加しない。

## 本文句と実行担当

| 対象 | 本文句・意味 | DSL / consumer | 回帰 |
| --- | --- | --- | --- |
| BSTH04-XX01 | 起幻・黄/紫・自己spiritの本来コスト5以上に、黄/紫各1シンボルとブロック不可 | 2つの同一 `target.filter` の `minCost:5, costBasis:printed`。`override_properties` と `unblockable` が別々の性質を与える | `target-cost-scope-audit.test.ts` は印字4/実効6を両方除外、印字5/実効1と印字6/実効4を両方適用。実シンボルとブロック宣言候補を確認 |
| BSTH06-C03 | 前段は遊精/皇獣2体へvoidから1個ずつ。その後、手札/手元/trashのコスト4以下を固定1、または6以下を固定2で召喚 | `core_distribute` → `on_step` の `choice`、`from_zone.filter.maxCost:4/6`、`fixedPayment:1/2`。本来指定がなく、既定の実効/追加コスト判定を使う | 同回帰は通常召喚・誘発・窓pass・前段選択から後段選択、支払い、維持コア配置まで完走。印字4/6と印字5/追加4・印字7/追加6を使用 |

後者は3体から2体を選ぶ。選んだ2体だけが1→2コア、void10→8。
後段では適格2枚から1枚を選び、各分岐の上限+1のカード入力を拒否してstate不変を確認。
選択後は対象がfieldで維持1コア、非選択・範囲外カードは元ゾーンに残る。
元カードの通常召喚後reserve5から、分岐1では3、分岐2では2へ減り、
trashの通常コアは元召喚支払い2に固定1/2を加えた3/4になる。
関連pendingは解消される。前段辞退・使用制限・印字限定へ壊したfilterは既存
`bsth06-cards.test.ts`、導域のLv/離場/後入りは `domain-unblockable-late-target.test.ts` も参照する。

## 確認の範囲

`card-filter.ts` の通常コスト判定と印字限定判定、継続効果のsymbol/block consumer、
通常召喚からのpending継続を照合した。記録生成自体は実行証明ではなく、指定回帰を
finishの通常gateで実行し、完全diffの独立verifierとverified commitを必須にする。
量化反復の変更はない。GUI・本番配備・ISMCTSの受入、他の65件のreviewは本確認に含めない。
