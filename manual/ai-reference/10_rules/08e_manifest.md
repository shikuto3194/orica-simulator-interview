# 顕現の条件と召喚

親索引: [08_advanced-mechanics.md](08_advanced-mechanics.md)。タイミングは
[02_turn-flow-and-timing.md](02_turn-flow-and-timing.md)、独自ネクサスの対象は
[07_custom-orica-mechanics.md](07_custom-orica-mechanics.md) を参照。

## 正源（2026-10-02確認）

- **A、条件・支払い・維持コアの実装に使用**: 公式エターナル Q28184
  （2025-01-17、`external-qa-official/BS71.md:9`）。
  「自分のカウントが条件で指定されたカウント以上のとき」と定める。
  [公式Q&A](https://www.battlespirits.com/faq/list.php?format=eternal&prodname=BS71)。
- **A、支払い先の実装に使用**: [公式エターナルマニュアル・顕現](https://www.battlespirits.com/rule/official-rule-manual-eternal/page12.html)。
  指定されたネクサスからの1コスト支払いは「コア1個をトラッシュに置く」。
  ソウルコアもトラッシュへ移し、手札から召喚する。召喚後の維持コアはフィールドと
  リザーブから置ける。神技のボイド支払い・離脱時のコア返却とは別の処理である。
- **A、独自本文の確認**: 共有ミラーの承認版
  `f51f8ba814654a725e7d36554ada87265293bde9` と BSTH02.7-X03 のカード画像は、
  「アリス」＆導界者ネクサス＆C2以上、自分のメインステップという条件で一致する。
  [配布元画像](https://dancing-pixie-db5cc3.netlify.app/images/BSTH02.7-X03.png)。
  独自Q&A qa-002 の対象区分に従って導界者を対象にする。C2はカウント2であり、
  ネクサス上のコア2個という追加制約は本文にない。

## 実装と検証

- 対象の名前・種別は `ManifestData.targetFilter`、プレイヤーのカウントは
  `ManifestData.condition` と共通 `evaluateCondition()` で判定する。
- 対象フィルタには場の `state`・定義resolver・共通の魂状態／下カードスコープを渡す。
  [裏向き素性](04c_face-down-identity.md)に従い、印字Aliceの札でもフランドール分身等の
  実効スピリットは対象にしない。窓中の素性変化も支払い前に再判定する。
- 発揮宣言で独自スタック窓を開き、窓後に条件を再判定して、本文内の支払い・場入り・
  維持コア配置を行う。宣言だけではコアを払わない。
- 顕現は効果による召喚なので、召喚禁止を適用する。通常召喚だけを禁止する効果は
  適用しない。窓後に召喚禁止・ソウルコア使用不可・カウント不足になった場合は、
  支払いを行わず不発にする。
- 本文監査は見出し・本体・対象フィルタ・自分のカウント条件・ソウルコアの行き先が
  一致する場合だけ carrier とする。未印字の対象コア下限や追加条件は拒否する。
- 回帰: `packages/rules-core/test/bsth02-7-x03-manifest.test.ts`。
  カウント0/1/2/3、対象コア0/1、相手ターン・アタックステップの不許可、
  窓中の条件喪失、トラッシュへの支払いと維持コア配置後の最終盤面を確認する。
- GUI/REST: `?scenario=manifest-count-payment`、`count=1/2`、`owner=bob`。
  AliceのGUI操作とBobのREST操作で宣言・窓・維持コア配置後の最終状態を確認する。

同カードの既存【界放】本文は今回変更しないが、顕現後に誘発するためカウントの境界も回帰する。
「数まで追加で発揮」の句は共通量化抽出器でも検出し、任意反復を欠くDSLと
verifier対応表で未該当・句欠落とする記録を拒否する。複数手順の静的な範囲が
曖昧な場合はfidelity reviewに残し、抽出失敗を未該当とは扱わない。
X03はこの表とN=0/1/2の最終盤面回帰を根拠に、当該findingだけを内容hash付き
`confirmed_correct`として記録する。他カードの類似候補は未確認のまま残す。

| 本文句 | 意味 | DSL・解決担当 | 盤面反証 |
|---|---|---|---|
| 「この効果を自分のカウントの数まで追加で発揮」 | 基本1回に最大N回追加する | `bp0.repeat.additional=count_value` と `repeat.optional`。`structured-effect-registrations.ts` の追加回数選択と `effect-interpreter.ts` のBP修正 | `bsth02-7-summon-attack-shared-usage.test.ts` のN=0/1/2は別対象1/2/3体へBP-10000し、後続を辞退してpendingなしまで完走する |
| 「〔ターンに1回:同名〕」 | 発揮全体で共有し、内部の追加回数を1回へ縮約しない | 単一 `card_event:[summon,attack]` と `per_card_name/turn` | 同回帰の召喚時使用済み→同一ターンのアタック時非列挙と、N=2の3体の実効BPを確認する |
