# 反復発揮の処理

## 「この効果を○○につき追加で発揮する」(反復発揮)

- 「この効果を自分のカウント1につき追加で発揮し」(BSTH04-X02) 等は、当該 step の action を**基本 1 回に加えて** N 回（解決時に動的評価）追加実行する＝合計 1+N 回。語尾が**終止形/連用形（「発揮し」「発揮する」）= 強制**、**「発揮できる」= 任意**（[「する」と「できる」の解釈](03c_effect-text-interpretation.md)を参照）。
- 反復する BP マイナスは、同じカードにも複数回指定できる。全回分の対象を確定してから同時に適用する。対象化への応答は全回分の確定後に行う。[公式 Q8150](https://www.battlespirits.com/faq/list.php?format=eternal&prodname=BS51)・[公式 Q8519・Q8527](https://www.battlespirits.com/faq/list.php?format=eternal&prodname=BS54)
- ピッコロの「このスピリットのみにする」が同時指定に割り込んだ場合、確定済みの BP 減少はピッコロだけに適用する。この独自カードへの適用は 2026-11-15 ユーザー確定。[公式 Q14170・Q14172・Q14173](https://www.battlespirits.com/faq/list.php?format=eternal&prodname=CB13)
- **「追加で」なしの「この効果を○○1につき1回発揮できる」**は基本回を加算しない。量化値 N 回だけ、一連の効果全体を実行する。`repeat.additional` を使う場合は N-1 を指定し、N=0 を発揮不可にする前提条件を別途置く。〔ターンに1回：同名〕のような発揮制限は効果全体の宣言可否であり、この N 回を 1 回に縮約しない。
- 実装（engine-drain）: `EffectStep.repeat.additional` を floor 評価し native パスを追加実行する。`deck_reveal` は継続情報に固定済みの追加回数と次の反復 index を保存して、選択・残札配置後に同じ step の未実行回を再開する。他の pending action に `repeat` を載せるときは、この継続再開が実装済みかを個別に確認し、未対応なら静的に完了扱いにしない。`condition` は `evaluateCondition` 真でのみ追加、`braves_on_source` は発動元の合体ブレイヴ数。BSTH04-X02（強制反復）と BSTH09-TR01(B)（N 回の任意反復）は着地。
- 任意反復は `repeat.optional: true` で choice 化。固定1回は追加有無、動的0..N は対象数から追加回数を復元。追加コスト連動は `count_decrease selected_targets` + `repeat.executionAdditional` で選択回数分支払う。BSGE01-C08 は契約合体時とアタック時の双方で、追加回数を決めてから全対象をまとめて確定する。[全弾の反復 BP 監査](../00_meta/repeated-bp-target-audit-2026-11-15.md)を参照。

