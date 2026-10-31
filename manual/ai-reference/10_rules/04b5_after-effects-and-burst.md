# 効果発揮後と通常バーストの順序

親文書: [バースト関連ルール](04b_burst-rules.md)。

## 効果発揮宣言は効果ツリーの解決後（2026-09-12）

- 公式 **Q411**（2026-09-18更新、信頼度 **A**）: 「ただし、バースト効果の発揮は、その効果によって発揮したバースト以外のすべての効果の解決が終わったあとになります。」（`external-qa-official/_freeword-バーストの発動を宣言.md:9`）。[公式エターナルマニュアル「バーストの発動」](https://www.battlespirits.com/rule/official-rule-manual-eternal/page12.html) も、他の効果をすべて解決してからバースト効果を解決すると明記する（同日再確認）。
- 独自の[2段階窓](02b_declaration-timing-window-principle.md#バースト発動の2段階窓)への適用は **C / ユーザー確認、実装採用**。条件成立時に発動宣言を受け付けるが、**効果発揮宣言**は残りの効果と派生誘発をすべて解決／辞退してから行う。対象選択・コア配置等の中断再開を挟んでも、この順序は変わらない。
- 実装: バーストの再開時には常に未解決効果を確認する。`pendingStackCascade.waitForTriggeredEffects` の有無を効果発揮宣言の待機条件にしない。反逆者アリスの同時召喚・コア配置とヨハネスのバーストを実カードで回帰検証する。

## 派生内部のバーストと「効果発揮後」（2026-09-22確認）

- **A / 実装採用**: 公式エターナルQ7734（2026-06-12）は、通常バーストについて「バースト以外の解決待ちの効果を解決した後」とする。内部の派生で条件を満たしただけでは、外側の未解決効果より先に通常バーストを解決しない。
- Q411（2026-09-18更新）は、召喚時本文の「この効果発揮後」より前に発動宣言できても、バースト以外の派生効果をすべて解決してから効果を発揮すると明記。発動宣言と効果解決を区別する。
- 「ただちに発動」の優先は別規則（Q11148）。内部の通常効果・その「効果発揮後」を先に閉じる原則を、通常バーストの優先へ拡張しない。
- 出典: [公式Q7734・Q11148](https://www.battlespirits.com/faq/list.php?format=eternal&prodname=&update=2026-06-12)、[公式Q411](https://www.battlespirits.com/faq/list.php?format=eternal&prodname=&update=2026-09-18)、[公式マニュアル「バーストの発動」](https://www.battlespirits.com/rule/official-rule-manual-eternal/page12.html)。ミラーは `node scripts/harvest-official-faq.mjs --freeword "効果発揮後"` / `--freeword "バーストの発動を宣言"` で再取得。
