# BSTH10.5 原文忠実度監査（2026-09-13）

対象 3面。表裏を別件とし、本文とカード本体・mechanic内の全effectsを読み合わせた。機械的なfidelity合格だけを監査済みの根拠にしていない。

## 出典と確認方法

- 原文: [raw/by-pack/BSTH10.5.js](../../../../packages/card-data/raw/by-pack/BSTH10.5.js)、[external-qa/cardData.js](../../../../external-qa/cardData.js)。両面・見出し・対象・枚数・接続・任意性・発揮条件・継続期間・回数制限を対照。
- 信頼度 B: 保存本文。運用根拠は [03c](../../10_rules/03c_effect-text-interpretation.md)、[03d](../../10_rules/03d_effect-target-and-prerequisite-gates.md)、[03e](../../10_rules/03e_effect-duration-and-repeat-scope.md)、[08a](../../10_rules/08a_advent-rebirth-contract.md) 等。独自ギミックはローカル裁定を優先。
- external-qa/cardData.jsとのtextLines比較は全担当面で一致。BSTH001エリスの旧raw空欄、BSTH002-M01の旧raw番号不一致はexternal側を参照。対象errataなし。

## 発見と修正

全3登録の本文、スタック、遅延神技、domainHooksを照合。今回のカードDSL修正なし。

## 全件カバレッジ

| カード番号 | カード名 | 確認範囲 | 本文の識別用抜粋 |
| --- | --- | --- | --- |
| BSTH10.5-R21 | 財禍「ブラックピジョン」 | 照合済 3効果 | このカードは、系統：「幻想」を持つ。 / 自分はデッキの上から3枚ドローした後、手札1枚を破棄する。 |
| BSTH10.5-R22 | 貧符「超貧乏玉」 | 照合済 3効果 | このカードは、系統：「幻想」を持つ。 / 自分はデッキの上から2枚ドローした後、手札1枚を破棄する。 |
| BSTH10.5-X01 | [創界神]依神 紫苑 | 照合済 1効果＋grandwalkerData | このネクサスは創界神ネクサス対象の効果しか受けない。このネクサスには神託と創界神ネクサス対象の効果でしかコアを置けず、そのコアは創界神ネクサス対象の効果しか受けず移動できない。 / 【神託：〔依神＆ネクサス〕… |

## 検証と残件

- 担当の基本カード回帰、個別カード回帰、touhou-late-fidelity-audit.test.ts の盤面検証。共通変更は rules-core tsc --noEmit 実行。
- 合体対象、複数ブレイヴ破棄、合体失敗、M02非合体時破壊、refresh限定回復禁止、無償/有償効果召喚を専用回帰で確認。
- 全件テスト・GUI/REST・finish-check:fullは並列重複を避け親エージェントが統合実行し、同監査入口へ記録。
- 統合検証と完了状態は[監査索引](README.md)に記録する。
