# BSTH005 原文忠実度監査（2026-09-13）

対象 2面。表裏を別件とし、本文とカード本体・mechanic内の全effectsを読み合わせた。機械的なfidelity合格だけを監査済みの根拠にしていない。

## 出典と確認方法

- 原文: [raw/by-pack/BSTH005.js](../../../../packages/card-data/raw/by-pack/BSTH005.js)、[external-qa/cardData.js](../../../../external-qa/cardData.js)。両面・見出し・対象・枚数・接続・任意性・発揮条件・継続期間・回数制限を対照。
- 信頼度 B: 保存本文。運用根拠は [03c](../../10_rules/03c_effect-text-interpretation.md)、[03d](../../10_rules/03d_effect-target-and-prerequisite-gates.md)、[03e](../../10_rules/03e_effect-duration-and-repeat-scope.md)、[08a](../../10_rules/08a_advent-rebirth-contract.md) 等。独自ギミックはローカル裁定を優先。
- external-qa/cardData.jsとのtextLines比較は全担当面で一致。BSTH001エリスの旧raw空欄、BSTH002-M01の旧raw番号不一致はexternal側を参照。対象errataなし。

## 発見と修正

TX01(A): 転醒前のSC移動をフィールド/リザーブ/トラッシュ/ライフから汎用core_moveで実装。カウント上限で事前抑止し、裏返した後の維持コア不足は消滅。バトル離脱も条件に含め、BP0破壊を任意化。

## 全件カバレッジ

| カード番号 | カード名 | 確認範囲 | 本文の識別用抜粋 |
| --- | --- | --- | --- |
| BSTH005-TX01(A) | 魔界 | 照合済 5効果 | Lv1【転醒：自分のカウント9以下（転醒は同時に使えない）】 / 自分のライフが増えた/減ったか、このネクサスが相手によってフィールドを離れるとき、このネクサスに自分の《ソウルコア》を置いて裏返せる。 |
| BSTH005-TX01(B) | ［創造の魔界神］神綺 | 照合済 3効果 | この面に裏返ったとき、フィールドに残り、カウント+1する。 / Lv1-Lv2『このスピリットの転醒時』 |

## 検証と残件

- 担当の基本カード回帰、個別カード回帰、touhou-late-fidelity-audit.test.ts の盤面検証。共通変更は rules-core tsc --noEmit 実行。
- 合体対象、複数ブレイヴ破棄、合体失敗、M02非合体時破壊、refresh限定回復禁止、無償/有償効果召喚を専用回帰で確認。
- 全件テスト・GUI/REST・finish-check:fullは並列重複を避け親エージェントが統合実行し、同監査入口へ記録。
- 統合検証と完了状態は[監査索引](README.md)に記録する。
