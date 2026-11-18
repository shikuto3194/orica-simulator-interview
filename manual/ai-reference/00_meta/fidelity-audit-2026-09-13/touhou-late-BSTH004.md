# BSTH004 原文忠実度監査（2026-09-13）

対象 1面。表裏を別件とし、本文とカード本体・mechanic内の全effectsを読み合わせた。機械的なfidelity合格だけを監査済みの根拠にしていない。

## 出典と確認方法

- 原文: [raw/by-pack/BSTH004.js](../../../../packages/card-data/raw/by-pack/BSTH004.js)、[external-qa/cardData.js](../../../../external-qa/cardData.js)。両面・見出し・対象・枚数・接続・任意性・発揮条件・継続期間・回数制限を対照。
- 信頼度 B: 保存本文。運用根拠は [03c](../../10_rules/03c_effect-text-interpretation.md)、[03d](../../10_rules/03d_effect-target-and-prerequisite-gates.md)、[03e](../../10_rules/03e_effect-duration-and-repeat-scope.md)、[08a](../../10_rules/08a_advent-rebirth-contract.md) 等。独自ギミックはローカル裁定を優先。
- external-qa/cardData.jsとのtextLines比較は全担当面で一致。BSTH001エリスの旧raw空欄、BSTH002-M01の旧raw番号不一致はexternal側を参照。対象errataなし。

## 発見と修正

X03: 転召、夢月在場耐性、創界神/導界者不在条件、カウント0回復を照合。転醒禁止はrestrict_manifestのrebirth限定・current_effectへ修正。同一カードの通常離脱効果を残すため共通キューの抑止をregistration単位にした。「さらに」回復を同じ効果へ統合し、破壊の不在条件とは独立に評価。

## 全件カバレッジ

| カード番号 | カード名 | 確認範囲 | 本文の識別用抜粋 |
| --- | --- | --- | --- |
| BSTH004-X03 | 幻月 | 照合済 2効果＋tenshoSummon | 【転召：3／幻想＆コスト6以上／ボイド】 / 召喚コスト支払い後、対象の自分のスピリット1体の上のコアすべて（最低3個）をボイドに置かなければならない。 |

## 検証と残件

- 担当の基本カード回帰、個別カード回帰、touhou-late-fidelity-audit.test.ts の盤面検証。共通変更は rules-core tsc --noEmit 実行。
- 合体対象、複数ブレイヴ破棄、合体失敗、M02非合体時破壊、refresh限定回復禁止、無償/有償効果召喚を専用回帰で確認。
- 全件テスト・GUI/REST・finish-check:fullは並列重複を避け親エージェントが統合実行し、同監査入口へ記録。
- 統合検証と完了状態は[監査索引](README.md)に記録する。
