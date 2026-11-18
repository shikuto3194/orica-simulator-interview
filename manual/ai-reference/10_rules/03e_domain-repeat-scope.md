# 領域の対象別回数制限

親: [効果の継続性・反復スコープ](03e_effect-duration-and-repeat-scope.md)。

BSTH05-X02「各対象がターンに1回ずつ」の神域は、発揮元自身の使用回数と区別する。同時にバトルを終えた場合も、主語ごとに任意発揮できる。「重複しない」と併記されるため、同名の発揮元を替えても使用済みの主語は再使用できない。

実離脱・再登場した主語は別個体として扱う。発揮元だけが出直した場合は、場に残っている主語の使用済み回数をリセットしない。次ターンには再使用できる。

根拠: 独自本文 `external-qa/cardData.js`、BSTH05-X02カード画像の照合（信頼度C、2026-09-20）。個体の実離脱による制限の終了は親章の2026-09-12ユーザー確認に従う。

実装: `per_trigger_related_instance` と `no_duplicate` の併用時に同名発揮元間で使用を共有し、主語の `fieldInstanceGeneration` を記録する。回帰: `packages/rules-core/test/domain-battle-multi.test.ts`。
