# 正規コア移動のボイド先一覧（2026-10-28）

[除外全般の親監査](card-exclusion-audit-2026-10-28.md)の分類別一覧。

## 正規のコア→void（カード除外と別）

core_move.to.kind:voidは46 action / 41カード。以下は既存の通常コアのボイド移動であり、カードの除外先置換の対象にしない。BSTH08-XX01の本文は「コア4個をボイド」と「カード1枚を除外」を同時に含み、神技コストとカード除外を分けて確認した。BSLH01-X03〜X10のソウルコアはcore_move.to.kind:removed_from_game。ソウルコアをvoidへ送る新しい例外は設けない。

| カード | core_move.to.kind:void の全パス |
|---|---|
| BSES01-C03 | effects.2.steps.0.action |
| BSES01-CX01 | effects.1.steps.0.action; effects.2.steps.0.action |
| BSES01-M04 | effects.2.steps.0.choice.0.action |
| BSFT01-TR04(A) | effects.1.steps.1.action |
| BSGE01-M03 | effects.3.steps.1.action |
| BSGE01-M04 | effects.3.steps.1.action |
| BSKB01-M02 | effects.2.steps.1.action |
| BSKB01-TX01(A) | backFace.effects.0.steps.0.action |
| BSLH01-C11 | effects.2.steps.0.action |
| BSLH01-M01 | effects.1.steps.4.action |
| BSLH01-R02 | effects.0.steps.3.action |
| BSLH01-R03 | effects.0.steps.0.choice.1.action; effects.1.steps.0.action |
| BSLH01-X05 | effects.0.steps.0.action |
| BSRK01-R02 | effects.0.steps.1.action |
| BSSG01-M04 | effects.1.steps.2.action |
| BSSG01-X03 | effects.1.steps.2.action |
| BSTH001-X01 | effects.0.steps.0.action |
| BSTH001-X02 | effects.0.steps.0.action |
| BSTH003-M03 | effects.1.steps.0.action |
| BSTH003-X01 | effects.0.steps.0.action |
| BSTH003-X03 | effects.0.steps.0.action |
| BSTH003-X04 | effects.1.steps.0.action |
| BSTH01-X07 | effects.1.steps.0.action |
| BSTH01-X08 | effects.0.steps.0.action |
| BSTH02-M03 | effects.1.steps.0.action; effects.2.steps.0.action |
| BSTH02-R03 | effects.1.steps.0.action |
| BSTH02-X01 | effects.1.steps.0.action |
| BSTH02.7-TR01(A) | effects.1.steps.0.action |
| BSTH03-M03 | effects.0.steps.0.action |
| BSTH04.5-X01 | effects.2.steps.0.action |
| BSTH05-C11 | effects.1.steps.0.choice.0.action |
| BSTH05-C12 | effects.1.steps.0.choice.0.action |
| BSTH05.5-M03 | effects.0.steps.0.action; effects.0.steps.1.action |
| BSTH05.5-XX01 | effects.2.steps.0.action |
| BSTH07-M03 | effects.0.steps.0.action |
| BSTH07.8-C05 | effects.3.steps.0.action |
| BSTH08-C04 | effects.1.steps.0.action; effects.2.steps.0.action |
| BSTH08.5-R13 | effects.0.steps.1.action |
| BSTH09-M03 | effects.0.steps.0.action |
| BSTH11-R03 | effects.1.steps.1.action |
| BSTH11-X03 | effects.1.steps.1.choice.0.action |

