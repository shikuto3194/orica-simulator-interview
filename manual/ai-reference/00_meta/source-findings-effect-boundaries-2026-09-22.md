# 離脱成立・効果発揮後の境界（2026-09-22）

## 採用した根拠

公式はエターナル版のみ。実装で採用する信頼度を以下に明記する。

| 根拠 | 信頼度・採用内容 |
|---|---|
| [公式マニュアル page12](https://www.battlespirits.com/rule/official-rule-manual-eternal/page12.html)、[page14](https://www.battlespirits.com/rule/official-rule-manual-eternal/page14.html) | A。通常バーストは他の効果すべての解決後。「効果発揮後」は本文から誘発した効果の解決も待つ。 |
| [公式 Q7734 / Q11148（2026-06-12更新）](https://www.battlespirits.com/faq/list.php?format=eternal&prodname=&update=2026-06-12) | A。効果の内側から発動した通常バーストも、バースト以外の効果の解決を待つ。「ただちに発動」は例外。 |
| [公式 Q411（2026-09-18更新）](https://www.battlespirits.com/faq/list.php?format=eternal&prodname=&update=2026-09-18) | A。発動宣言と効果発揮を分離。発動を宣言できても、残る非バースト効果を飛ばして効果を発揮しない。 |
| 公式 Q10708 / Q30668（検索ミラー「効果発揮後」） | A。借用した効果ごとの派生・発揮後を閉じてから次の効果へ進む。 |
| [独自Q&A](https://dancing-pixie-db5cc3.netlify.app/) `external-qa/qaData.js` qa-016〜qa-018 | A（独自ルール一次資料）。同一効果の破壊・消滅成立と、実移動・別効果の待機状態参照を分ける。 |
| ユーザー確認（本タスク） | C / 実装採用。同一効果の消滅後処理は誘発・魂状態選択より先。別効果の破壊/消滅/離れるときは現在の待機状態が必要。「離れたとき」は実移動後・通常バースト前。 |
| ユーザー原文修正 BSAZ01-X02 | C / 実装採用。「このとき手札から効果を発揮するマジックカードはフィールドに置く」。手札の対象選択 → フィールド配置 → 本文発揮。先の「本文直後に配置」という回答は撤回された。 |

「内部チェーンのバーストを先に解決する」という当初の仮説は Q7734 により撤回。内側の通常誘発・内側の発揮後・外側の発揮後を解決してから、通常バーストへ進む。内側にも外側と同じ原則を適用する。

## 正源への反映

- [03b](../10_rules/03b_resolution-and-interrupts.md): 未宣言の発揮不能キュー除去。条件未達と、対象不在による空撃ちを分離。宣言済みの不発は通常解決へ渡す。
- [04](../10_rules/04_state-based-rules.md): 同一効果の成立事実と、別効果が読む現在の待機状態。
- [04b](../10_rules/04b_burst-rules.md): 内外チェーンの通常バースト・発揮後の順序。
- [04d](../10_rules/04d_leave-choice-timing.md): 実移動直前の魂状態選択、実移動後の「離れたとき」。

再取得: `node scripts/harvest-official-faq.mjs --freeword '効果発揮後'`（385件）、`--freeword 'バーストの発動を宣言'`（140件）。検索結果・ミラーは生成物であり commit しない。
