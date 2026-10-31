# 公開カード自身の選択者と原因条件

2026-10-17のM01原文監査で確認。M05の継続書換とは別件。

## 原文と規則

- 共有 `external-qa/cardData.js` は `scripts/audit-mirror-provenance.json` の承認版
  `f51f8ba814654a725e7d36554ada87265293bde9`。本文Aとしてrepo画像と照合した。
- BSTH09-M01（id:239、`images/BSTH09-M01.webp`）は原因系統を勇傑/妖戒に限定し、
  「自分の効果」とは限定しない。自分の空きバースト枠に任意でセットする。
- BSTH01-C21（id:59、`images/BSTH01-C21.webp`）は「自分の黄の効果」での
  デッキオープン/破棄に限定する。トラッシュから回収した場合だけ黄の導界者へコア1個を置く。
- [任意性](../10_rules/03c_effect-text-interpretation.md)と
  [バースト枠](../10_rules/04b_burst-rules.md)を適用する。
  [導界者の対象規則](../10_rules/07_custom-orica-mechanics.md#1-導界者ネクサス--導シンボル)は、
  明記された導界者を対象に含め、無印ネクサスの既定除外とは区別する。
- 共有Q&AをC21番号/名前で検索した範囲では本文を上書きする個別裁定は見つからなかった。
  全Q&Aの不在を証明するものではない。

## 実装で観測した不足と修復

- M01を2枚同時に選ぶと同一所有者の `setBurstStates` が2件になった。
  共通の排他グループを候補上限・GUI・サーバ検証・AI入力生成で使い、解決時も空き枠を再検査する。
- 相手効果による公開でも、自己効果の受諾/辞退は公開カードの所有者が選ぶ。
  `revealedChoiceParentPlayerId` に元効果の選択者を保持し、残札処理の前に戻す。
- C21の定義には色/デッキ起点のみがあり、相手の黄の効果でも候補になった。
  既存の `trigger_source_player:self` を併記する。M01へこの限定を加えない。
- C21のコア配置は `tribes:[導界者]` だけでは既定除外に入り、実ログが
  `core_move:void->field:0:no-targets` となった。導界者を明示的に含める既存filterを指定する。

## 盤面回帰

- `bsth09-cards.test.ts`: 原因系統・辞退・自分/相手の既存枠を区別した最終ゾーン。
- `bsth09-m01-revealed-burst-slot.test.ts`: 二重セット/重複ID/古い入力の原子的拒否、
  AI入力全候補、所有者選択の保存復元と元選択者への復帰。C21を混在させて原因限定の差を検証する。
- `bsth01-c21-cause-owner.test.ts`: 両所有者×自分/相手の原因×公開/破棄の8通りを完走。
  回収の有無、最終ゾーンと手札数、コアが自分の破棄回収時だけ+1になることを確認する。
- `scenario-revealed-burst-slot.spec.ts`: Alice GUI/Bob REST、所有者偽装と二重セット拒否、
  選択者が戻った後のAlice GUIによる残札処理を通す。

## 独立反証で確認した原因境界の修復

初回査読は不合格。相手デッキを開いたAliceからM01の選択をBobへ移すと、
元効果の `beforePickSteps` はAliceとして実行される一方、外側のSBA最終化は
選択前pendingのBobを使っていた。最後のコアを失ったBobのカードが自己原因で
離脱し、「相手によって離れるとき」の残留誘発を失うメモリ内反証と対照を得た。
単純にすべての原因をAliceへ変えると、公開カード自身の効果を誤帰属する。

正源Aは[04d:27](../10_rules/04d_leave-choice-timing.md#複数体の離脱選択2026-09-11)の
公式Q9284の相手効果による消滅と、同章の「各離脱の原因と移動先を保持する」要件。
新規裁定ではない。自己効果のゾーン移動・配置を所有者側で確定した後、元の公開を
既存 `pendingAfterTriggersContinuations` と `resume_deck_reveal` で再開し、
親側の独立したbefore-state・効果主・発揮元で最終化する。自己配置とbonusは
親の子チェーンへ接続し、そこから派生する反応が残る間は親を再開しない。
自己召喚は共通の維持コア入力へ進み、場入りログはその確定時だけ出す。

- `revealed-choice-cause-boundary.test.ts`: 両所有者×受諾/辞退×前処理/移動前/後続の12通り。
  原因・発揮元・離脱待機・相手効果誘発を確認し、辞退後の実離脱まで完走する。
- 同回帰の8通りは自己配置/ミラージュの継続効果によるSBA、自己召喚の維持コア、保存済みbonus carrier。
  自己効果の所有者・発揮元と親の待機/再開、通知の重複を確認する。
  bonusの2件はhandlerの保存carrier検証であり、デッキ本文からそのcarrierを生成する検証ではない。
- `revealed-burst-slot&owner=bob&foreign=1&boundary=1`: 実カードC03の最終コアを元効果が除去。
  Bob RESTでM01選択後の原因と誘発を照合し、Alice GUIで残札処理へ戻る。

この記録はC21のフラッシュ全体や全カードの正しさを認定するものではない。
M05の反証は[別記録](source-findings-bsth03-m05-continuous-rewrite-2026-10-16.md)で保持する。

## 固定評価入力の再確認

固定8デッキの「暴嵐」「花映塚」がC21を1枚ずつ含む。基点`7f1b362f7`のC21へ
今回の原因条件と導界者filterの3フィールドだけを加えた定義は、現行catalogのC21へ一致した。
各デッキのC21を基点の旧定義へ戻すと、8件すべてが旧`definitionsSha256`へ完全一致した。
現行8件は通常validatorでも合法。番号列・順序・枚数・保存元・理由・profile・seedを維持する。

| デッキ | 旧定義hash | 再確認した定義hash |
|---|---|---|
| 暴嵐 | `704b4e95ad8672fdd2e5536004c2d4621e3f5b8843a43b0eb8b15c58d78133d6` | `3d57f0c17fef164d02fc2d2bf46276c97ba59cb98a9a6afcd77aa3928904a78c` |
| 花映塚 | `585670cc61c1b7bc2edd1ec112567700d647c023da50fc1e2eab6deb7f92334e` | `81fc24668fa426b12a05b77ad12916012e8ffa5e19be0783b79b61ece8c30170` |

残る6件の定義hashは不変。manifest hashは`118b5ec322c572707e9f34d2a2861ef469dc6e981e8b8383d7aa5671c532d4d2`から
`1737a093cb9bdf939ac66442454ea61a42d5d8cdec48f7453024c60fcddf78f0`へ更新する。
実測と再現scriptは `artifacts/ultimate-audit-20261016/fixed-input-review.json` と
`review-fixed-inputs.mjs --check-only`。これは入力の再確認であり、実戦/校正/学習の成功証跡を作らない。

## 原文UI監査snapshotの再確認

保存された再生成sourceを読み、読取専用で旧C21を与えると旧snapshot全体を再現した。
現行C21で648面を再生成した差分は、C21の`allActionKinds`への`trigger_source_player`追加と
既に照合したモジュールhashだけだった。残る647面、本文152行、分類、補助source hash、
借用時の非選択手札を秘匿する`runtimeEvidence`は一致した。過去の訂正記録を保持し、
今回の`sourceCorrections`を追加する。証跡は`raw-ui-snapshot-review.json`と
`review-raw-ui-snapshot.cjs`（同artifactディレクトリ）。通常gateの
`revealed-target-ui-audit.test.ts`でも再検証する。
