# アタック時効果の期間指定

## 『このスピリットのアタック時』見出しでの性質/キーワード付与（期間指定なし）— scope precedent

「このスピリットのアタック時、ブロックされず〜」のように**見出しラベルが『アタック時』のみ**で、本文中に「このターンの間」「このバトル中」等の**明示的な時間指定語彙がない**、unblockable / `override_properties`（カテゴリ除外等）系の性質付与効果は、`duration.scope` を `"turn"` ではなく **`"attack"` または `"battle"`** にする。

根拠 (card-data precedent 5 件、いずれも同型『アタック時』見出し + 明示期間指定なし):

- `BSTH03.ts`（アルティメット, M01, `min_level:5`）: `duration: { scope: "battle" }`（unblockable・`override_properties.excludeCategory:"ultimate"` 両方）
- `BSTH01.ts:3444,3454`（XX02, Lv4）: `duration: { scope: "battle" }`（unblockable・`override_properties.excludeCategory:"spirit"` 両方、BSTH03-M01 precedent 準拠で確定、テスト `bsth01-xx02-lv4-category-negation.test.ts`）
- `BSLH01.ts:2289`（M03、Lv2-Lv3『アタック時』unblockable） / `BSDB01.ts:2168`: `duration: { scope: "attack" }`
- `BSFT01.ts:2511` / `BSTH001.ts:1205`: `duration: { scope: "battle" }`

`scope: "turn"` を使う precedent はこのパターンで**存在しない**（model.ts の doc コメント上も `"turn"` は「このターンの間」という明示テキストへの対応値であり、無指定効果への既定ではない）。`scope: "turn"` を無指定『アタック時』効果に使うと、同一ターン内の複数バトルへ効果が不当残存するバグになる。

信頼度: B（独自カードサイト Q&A に直接該当エントリなし。card-data 5件の一貫した実装 precedent + `model.ts:661-665` の scope 語彙対応表からの構造推論）。

関連: [期間と回数制限](03e_effect-duration-and-repeat-scope.md)。

## BSLH01-X03: 常時部分と即時部分の混在

根拠: 独自Q&A qa-009（`external-qa/qaData.js`、信頼度B）、2026-09-27および2026-10-01ユーザー確認（信頼度C）。qa-009は「『このスピリットのアタック時』このスピリットのシンボルを2つに固定する」に対し、「アタック中に発揮する効果は常時効果です」と回答する。見出しだけで本文全体を誘発に分類しない。スタック窓は回復の発揮宣言に発生し、常時のシンボル追加には発生しない。

BSLH01-X03への適用:
「このスピリットに黒シンボル1つを追加する」は、アタック/ブロック中の常時効果。
「さらに、ステップに1回、このスピリットは回復できる」は即時効果の任意回復。
同じ本文の各部分で分類が異なり、シンボル追加を発揮のたびに永続加算しない。
通常1シンボル、各アタック/ブロック中2シンボル、参加終了後1シンボルとなる。
回復の実行・辞退・同一ステップでの使用済みは、常時部分の適用を変えない。

DSLでは同じ `textRef:[0,1]` の常時定義（`in_battle` 条件）と即時定義へ分け、
既存の継続効果再計算とstep単位の任意回復・回数制限で処理する。
回帰: `packages/rules-core/test/bslh01-x03-battle-symbol.test.ts`。
