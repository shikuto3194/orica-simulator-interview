# オープン後の強制/任意回収の全監査（2026-09-20）

## 範囲・原文・判定

- 580枚・表裏634面を全走査。変更前のdeck_reveal 103箇所を照合し、霖之助/橙の二重公開分岐を統合した変更後は101箇所。公開されたカード自身の効果32件も別枠で照合。
- 原文は [raw/by-pack](../../../packages/card-data/raw/by-pack)、実装は [cards](../../../packages/card-data/src/cards)。原文の「オープン/公開」を含む文を原文側からも列挙し、TS本文の欠落がないことを逆方向に検証。
- 文言判定は [03c](../10_rules/03c_effect-text-interpretation.md)。「オープンできる」の任意性は公開まで。「加える」は指定枚数の強制、「加えられる」「N枚まで」は0枚を許す。対象不足は存在する枚数まで、対象0枚なら0枚で進む。
- 二択の順序は [07cの確定裁定](../10_rules/07c_card-observed-mechanics-extra.md)。2026-07-12ユーザー裁定を実装へ反映。今回の新規裁定はなし。
- 信頼度: カード独自本文はC（保存原文）、二択順序は既存確定裁定。推測による必須化はしない。
- 全件の原文引用・DSLパス・各pickの枚数/任意性・公開のexecutionModeは [監査fixture](../../../packages/rules-core/test/fixtures/reveal-retrieval-audit.json)。同一本文を持つ別効果も省略せず別行で照合する。
- BSDB01-C07/BSSG01-C08は本文全体に別件の差分があるが、公開/回収に関係する原文は一致。対象外の本文全体一致を主張しない。

## 修正

| カード | 原文上の回収 | 修正 |
| --- | --- | --- |
| BSLH01-TR01(A) | CB1枚を加える | pickを強制化 |
| BSSA01-C02 | 夜錆1枚を加える | pickを強制化 |
| BSTH01-C02 | 黄導界者1枚・黄幻想スピリット1枚・導魔ブレイヴ2枚 | 3枠を強制化 |
| BSTH01-C04 | 紅魔/夜族スピリット1枚・紅魔1枚 | 2枠を強制化 |
| BSTH01-R04 | 紅魔2枚 | pickを強制化 |
| BSTH01-XX01 | 幻想1枚 | 導技のpickを強制化 |
| BSTH01-M03 | 導界者全部、または1コストで幻想スピリット2枚まで | 公開後に二択。無料側は全回収、有料側は0枚でも支払う |
| BSTH02-C03 | 妖戒スピリット2枚、または1コストでネクサス1枚 | 公開後に二択。どちらの回収も強制 |
| BSAZ01-X01 | 公開した地球マジック1枚の効果を発揮する | 回収ではなく借用元選択だが、同じpick経路の指定漏れを強制化 |

共通処理のcount:-1（すべて）は、合法手の選択上限を候補数に正規化。BSAZ02-TX01(A)でもGUIが全候補を選べる。
支払い不能な有料分岐で回収を逃れないよう、解決中choiceに支払い額を伝え、共通コスト判定で表示と確定の両方を検証する。
公開途中のchoiceは既存beforePickStepsとmove_card/対象選択/支払いを使う。公開の直後に選択を待ち、途中処理のrefをその公開のカードに限定する。追加の専用Effectフィールド・LegalActionKindはない。
二択画面にも公開中カードの画像と名前を表示し、内容を確認してから選べる。表示用サニタイズ済みstateと継続中の公開結果を参照する。
前回修正済みのBSTH04-C01/C02も全件fixtureと既存回帰で維持する。

## 全公開処理の対照一覧

「必」は候補があるとき指定数を回収/処理する。「任」は0枚を許す。「全」は該当全枚数。
行き先fieldは召喚/配置、hand_swap等は交換であり、通常の手札回収と区別して照合。内容を見るだけ・並べ替え・回収なしも漏れ確認のため収録。
公開自体の任意指定と原文全文は上記fixtureで保持する。

| カード | DSLパス | 各pick（本文順） |
| --- | --- | --- |
| BSAZ01-C02 | effects[0].steps[0].action | 必1→hand |
| BSAZ01-C16 | effects[0].steps[0].action | 必1→hand、必1→hand |
| BSAZ01-C17 | effects[0].steps[0].action | 必1→field |
| BSAZ01-CX01 | effects[1].steps[0].action | 任3→field、必1→field |
| BSAZ01-X01 | effects[0].steps[0].action | 必1→hand |
| BSAZ02-C06 | effects[0].steps[0].action | 必1→hand |
| BSAZ02-C12 | effects[0].steps[0].action | 必1→hand |
| BSAZ02-C13 | effects[1].steps[0].action | 必6→hand、必1→hand |
| BSAZ02-C16 | effects[2].steps[1].action | 必1→hand、必1→field |
| BSAZ02-TX01(A) | effects[1].steps[0].action | 必全→hand |
| BSAZ02-X01 | effects[3].steps[0].action | 回収pickなし（別処理/確認） |
| BSAZ02-X01 | effects[4].steps[0].action | 回収pickなし（別処理/確認） |
| BSDB01-C05 | effects[0].steps[1].action | 必1→hand |
| BSES01-C01 | effects[2].steps[0].action | 必1→hand |
| BSES01-C02 | effects[2].steps[0].action | 任1→hand |
| BSFT01-TR12(A) | effects[1].steps[0].action | 必1→hand |
| BSGE01-M04 | effects[1].steps[1].action | 必1→mirage_set、必1→hand |
| BSGE01-M04 | effects[2].steps[1].action | 必1→mirage_set、必1→hand |
| BSKB01-C02 | effects[1].steps[0].action | 任2→hand |
| BSKB01-M01 | effects[0].steps[0].action | 任1→field、任1→trash |
| BSLH01-C01 | effects[3].steps[0].action | 回収pickなし（別処理/確認） |
| BSLH01-C04 | effects[0].steps[2].action | 必1→hand |
| BSLH01-C09 | effects[0].steps[1].action | 必1→hand |
| BSLH01-C11 | effects[1].steps[0].action | 回収pickなし（別処理/確認） |
| BSLH01-C14 | effects[2].steps[0].action | 任1→hand |
| BSLH01-M04 | effects[2].steps[0].action | 回収pickなし（別処理/確認） |
| BSLH01-R04 | effects[0].steps[0].action | 必2→hand |
| BSLH01-R06 | effects[2].steps[0].action | 必1→hand |
| BSLH01-TR01(A) | effects[0].steps[1].action | 必1→hand |
| BSLH01-X01 | grandwalkerData.divineSkills[0].effects[0].steps[0].action | 回収pickなし（別処理/確認） |
| BSLH01-X07 | effects[2].steps[1].action | 任3→field |
| BSRK01-C01 | effects[0].steps[0].action | 任1→hand_swap |
| BSRK01-C01 | effects[0].steps[1].action | 任1→hand |
| BSRK01-C02 | effects[0].steps[0].action | 任1→hand |
| BSRK01-R03 | effects[0].steps[0].action | 任1→hand |
| BSSA01-C02 | effects[0].steps[1].action | 必1→hand |
| BSSA01-R01 | effects[1].steps[1].action | 任3→hand |
| BSSG01-C01 | effects[1].steps[1].action | 必1→hand |
| BSSG01-C02 | effects[1].steps[1].action | 必1→hand |
| BSSG01-C08 | effects[3].steps[0].action | 任1→field |
| BSSG02-C01 | effects[1].steps[1].action | 必1→hand |
| BSTH001-C01 | effects[1].steps[0].action | 必1→field、必1→hand |
| BSTH001-C02 | effects[1].steps[0].action | 必1→field、必1→hand |
| BSTH002-C02 | effects[0].steps[1].action | 必1→hand、必1→hand |
| BSTH002-C03 | effects[0].steps[0].action | 必1→hand、必1→hand |
| BSTH003-C01 | effects[1].steps[0].action | 必1→hand、必1→hand、必1→hand |
| BSTH003-C02 | effects[1].steps[0].action | 必1→hand、必1→hand、必1→hand |
| BSTH01-C02 | effects[0].steps[0].action | 必1→hand、必1→hand、必2→hand |
| BSTH01-C04 | effects[0].steps[0].action | 必1→hand、必1→hand |
| BSTH01-M03 | effects[1].steps[0].action | 公開後: 全枚強制 / 支払後0〜2枚 |
| BSTH01-M03 | effects[2].steps[0].action | 回収pickなし（別処理/確認） |
| BSTH01-M03 | effects[2].steps[1].action | 回収pickなし（別処理/確認） |
| BSTH01-R04 | effects[0].steps[0].action | 必2→hand |
| BSTH01-X02 | effects[0].steps[0].action | 回収pickなし（別処理/確認） |
| BSTH01-XX01 | grandwalkerData.divineSkills[0].effects[0].steps[0].action | 必1→hand |
| BSTH02.7-C03 | effects[0].steps[0].action | 任1→hand |
| BSTH02.7-C04 | effects[0].steps[0].action | 必1→hand、必1→hand |
| BSTH02.7-TR02(A) | effects[1].steps[0].action | 回収pickなし（別処理/確認） |
| BSTH02-C02 | effects[1].steps[0].action | 必1→hand、必1→hand |
| BSTH02-C03 | effects[0].steps[0].action | 公開後: 必2枚 / 支払後必1枚 |
| BSTH03-C01 | effects[1].steps[0].action | 必1→hand、必1→hand、必1→hand |
| BSTH03-C01 | effects[2].steps[0].action | 必1→hand、必1→hand、必1→hand |
| BSTH03-C02 | effects[0].steps[0].action | 必1→hand、必1→hand、必1→hand |
| BSTH03-C02 | effects[1].steps[0].action | 必1→hand、必1→hand、必1→hand |
| BSTH03-C04 | effects[1].steps[1].action | 必1→hand、必1→hand |
| BSTH04-C01 | effects[1].steps[0].action | 必1→hand、必1→hand |
| BSTH04-C02 | effects[1].steps[0].action | 必1→hand、必1→hand |
| BSTH05.5-C02 | effects[0].steps[0].action | 必1→hand、必1→hand |
| BSTH05.5-C03 | effects[0].steps[0].action | 必1→hand、必1→hand、必1→hand |
| BSTH05.5-XX01 | grandwalkerData.divineSkills[0].effects[0].steps[0].action | 任1→hand |
| BSTH05-C01 | effects[0].steps[1].action | 必1→hand、必1→hand |
| BSTH05-C02 | effects[0].steps[1].action | 必1→hand、必1→hand |
| BSTH06-C01 | effects[1].steps[0].action | 必1→hand、必1→hand |
| BSTH06-C02 | effects[1].steps[1].action | 必1→hand、必1→hand |
| BSTH07.8-C01 | effects[1].steps[1].action | 必1→hand |
| BSTH07.8-C02 | effects[1].steps[1].action | 必1→hand |
| BSTH07.8-C03 | effects[1].steps[0].action | 必1→hand、必1→hand |
| BSTH07.8-C04 | effects[1].steps[0].action | 必1→hand、必1→hand |
| BSTH07.8-C05 | effects[2].steps[0].action | 必1→hand |
| BSTH07.8-M01 | effects[1].steps[2].action | 必1→hand、必1→hand |
| BSTH07-C01 | effects[0].steps[0].action | 必1→hand、必1→hand |
| BSTH07-C02 | effects[0].steps[0].action | 必1→hand、必1→hand |
| BSTH08.5-C20 | accelData.effects[0].steps[0].action | 必1→hand、必1→hand、任2→hand |
| BSTH08.5-C23 | accelData.effects[0].steps[0].action | 必全→hand_or_set_aside_choice、必3→hand_or_set_aside_choice |
| BSTH08.5-X03 | grandwalkerData.divineSkills[0].effects[0].steps[0].action | 必全→hand、必1→hand |
| BSTH08-C02 | effects[1].steps[1].action | 必1→hand、必1→hand |
| BSTH08-C03 | effects[1].steps[1].action | 必1→hand、必1→hand |
| BSTH08-転醒R02(B) | effects[0].steps[0].action | 必1→hand |
| BSTH09.2-C01 | effects[1].steps[0].action | 必1→hand、必1→hand |
| BSTH09-C01 | effects[0].steps[1].action | 任1→hand_or_set_aside_swap、任1→hand_or_set_aside_swap、任1→hand_or_set_aside_swap |
| BSTH09-C02 | effects[0].steps[1].action | 任1→hand_or_set_aside_swap、任1→hand_or_set_aside_swap、任1→hand_or_set_aside_swap |
| BSTH09-C03 | effects[0].steps[1].action | 任1→hand_or_set_aside_swap、任1→hand_or_set_aside_swap、任1→hand_or_set_aside_swap |
| BSTH09-C04 | effects[0].steps[1].action | 任1→hand_or_set_aside_swap、任1→hand_or_set_aside_swap、任1→hand_or_set_aside_swap |
| BSTH09-C05 | effects[0].steps[1].action | 任1→hand_or_set_aside_swap、任1→hand_or_set_aside_swap、任1→hand_or_set_aside_swap |
| BSTH09-TR01(B) | effects[1].steps[0].action | 任1→field |
| BSTH11-C01 | effects[1].steps[1].action | 必1→hand、必1→hand |
| BSTH11-C02 | effects[1].steps[1].action | 必1→hand、必1→hand |
| BSTH11-C03 | effects[1].steps[1].action | 必2→hand |
| BSTH11-X02 | effects[1].steps[3].action | 任1→field |
| BSTH11-X02 | effects[2].steps[3].action | 任1→field |
| BSTS01-C03 | effects[1].steps[0].action | 回収pickなし（別処理/確認） |

## 公開されたカード自身の効果

元の公開効果の回収枠とは独立。自身の「加えられる」を断っても、公開元の強制回収はスキップできない。

| カード | 効果パス | 発揮 |
| --- | --- | --- |
| BSAZ02-C13 | effects[0] | 任意 |
| BSDB01-C07 | effects[0] | 任意 |
| BSDB01-C10 | effects[0] | 任意 |
| BSES01-C01 | effects[0] | 任意 |
| BSES01-C04 | effects[2] | 強制（回収妨害） |
| BSES01-R02 | effects[0] | 任意 |
| BSFT01-C01 | effects[0] | 任意 |
| BSFT01-C02 | effects[0] | 任意 |
| BSFT01-C03 | effects[0] | 任意 |
| BSFT01-C04 | effects[0] | 任意 |
| BSLH01-M05 | effects[0] | 任意 |
| BSSG01-C07 | effects[0] | 任意 |
| BSSG01-C08 | effects[0] | 任意 |
| BSSG01-R02 | effects[0] | 任意 |
| BSTH001-C05 | effects[1] | 任意 |
| BSTH001-C06 | effects[1] | 任意 |
| BSTH003-R03 | effects[1] | 任意 |
| BSTH01-C11 | effects[0] | 任意 |
| BSTH01-C21 | effects[0] | 任意 |
| BSTH01-R12 | effects[0] | 任意 |
| BSTH02-R11 | effects[0] | 任意 |
| BSTH03-C11 | effects[1] | 任意 |
| BSTH03-C12 | effects[0] | 任意 |
| BSTH03-C31 | effects[1] | 任意 |
| BSTH05.5-R10 | effects[1] | 任意 |
| BSTH05-C11 | effects[0] | 任意 |
| BSTH05-C12 | effects[0] | 任意 |
| BSTH05-C13 | effects[0] | 任意 |
| BSTH07.8-C05 | effects[1] | 任意 |
| BSTH07.8-R04 | effects[1] | 任意 |
| BSTH09-M01 | effects[0] | 任意 |
| BSTH09-R03 | effects[0] | 任意 |

## 検証・管理

- 全件原文照合: reveal-retrieval-audit.test.ts（新しい公開処理や公開時効果を未監査のまま追加すると失敗）。
- 盤面: reveal-retrieval-required-picks.test.ts / reveal-then-choose-retrieval.test.ts。強制0枚拒否、複数枚の不足拒否、候補不足、全回収、任意0枚、支払後0〜2枚、二択の排他性を確認。
- 既存のBSTH04回帰・公開中継続・支払い・アタック時二択も確認。
- GUI/REST: reveal-retrieval-audit.spec.ts（Alice GUI / Bob REST、全回収・任意0枚・公開後二択・支払い後0枚）。
- 完了ゲート: pnpm codex:finish-check:full（成功はコミット時のharness履歴と最終報告に記録）。
- 02: 現役タスクの追加/変更なし。issues: 本監査で新規残件なし。
