# BSSG02 原文忠実度監査（2026-09-13）

対象: 1 登録・1 面。

原文: `packages/card-data/raw/by-pack/BSSG02.js`、`external-qa/cardData.js`。
QA/訂正: `external-qa/qaData.js`、`external-qa/errataData.js`、既存 needs-ruling。
基準: 10_rules の 02（タイミング）、03c–e（効果/任意/つなぎ）、08a（煌臨/転醒）、08a2（名前）。
信頼度 C（独自本文）。本表は全カード・両面・mechanic内effectsの意味を対照した記録。
機械fidelityの合格を、意味の一致や実挙動の確認の代わりにしない。

共通観点: 使用ゾーン/レベル/窓、主体/対象/部分名称、独立任意文、同名/個体回数、
支払い成立と後続、移動先/順序、耐性と対象ロック、mechanic内の誘発/継続。

| カード/面 | 個別確認・差分 | 状態 |
| --- | --- | --- |
| BSSG02-C01 マリア・カデンツァヴナ・イヴ | 唯一性・召喚コア/装者公開・効果不可/攻撃不可・聖詠。二つの任意選択と強制pickを修正。 | 修正・回帰確認済み |

## 検証・残件

本文対照と発見差分の修正・担当回帰を完了。変更を要しないカードは「本文対照済み」とし、個別の実盤面回帰追加と混同しない。
2026-09-13 担当全94ファイル・1226テスト成功、rules-core と GUI の `tsc --noEmit --incremental false --composite false` 成功。
専用回帰20件に加え、各pack既存回帰を更新・拡張。公開残りのデッキ下/破棄と枚数0選択は Alice GUI / Bob REST 6件成功。共有の全テスト/finish-checkはrootが一括実施。
