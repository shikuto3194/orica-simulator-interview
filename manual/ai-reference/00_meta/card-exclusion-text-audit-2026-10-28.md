# 除外本文と実carrierの全件対応（2026-10-28）

[親受入・検証範囲](card-exclusion-audit-2026-10-28.md)。

## 全文監査表

範囲はpackages/card-data/src全体を検索し、ALL_CARDSの表裏・神技を再帰走査したtextLinesの「除外」42行（41カード）。コメント・sourceText・選択肢labelの重複は本文件数に加えない。以下は移動対象/行き先の監査であり、カード全効果の意味忠実度や本番配備の完了宣言ではない。曖昧・未実装carrierを確認済み扱いにしない。各行はDSLの実carrierを確認、C05のみ他カードの実装へ接続した。変更前C01の2効果はmainで既修正、今回M04を修正した。

独立査読でBSAZ01-C03×M11の複数自己置換と、BSTH08.5-X01のsearch→除外の置換接続に欠落が成立した。表のcarrier実在と区別し、共通除外・本文継続を修正して`card-exclusion-replacement-continuation.test.ts`で完走確認する。変更後のgate/査読・公開確認は[親受入](card-exclusion-audit-2026-10-28.md)の残条件に従う。

round 2ではX04の支払い原資/禁止/通常・ソウル選択の共通経路迂回が成立した。`card-exclusion-replacement-payment.test.ts`とGUIの場コアHUDを追加し、支払い後の本文再開まで同じ受入単位で検証する。全件表のcarrier実在だけでこの反証を棄却しない。

| カード / textLines添字 | 分類 | 本文 | 移動carrier（effects添字は0始まり） |
|---|---|---|---|
| BSAZ01-C03.textLines[3] | カード除外 | 自分の手札/手元/フィールドのカード13枚までを除外することで、除外した枚数により以下の効果を発揮する。この効果は、スタックタイミングで発揮されない。 | .effects.1.steps.0.action.kind=remove_from_game |
| BSAZ02-R02.textLines[8] | カード除外 | 自分のカウント5以下のとき、このアルティメットは、相手の効果を受けない。相手がカードを召喚/配置/使用したとき、自分のカウント+1する。さらにこのアルティメットとバトルしたスピリット/アルティメットは、ただちに除外される。この除外効果は相手の効果で防げない。 | .effects.3.steps.0.action.kind=remove_from_game |
| BSDB01-C09.textLines[0] | カード除外 | 〔ゲームに1回:同名〕トラッシュにあるこのカードは、相手のアタックステップ中、2コスト支払ってスタック効果を使用できる。そうしたとき、このカードを除外する。 | .effects.3.steps.1.action.destination=removed_from_game |
| BSFT01-X01.textLines[2] | カード除外 | 手札/トラッシュにあるこのカードは、自分のメインステップに、同名の自分のアルティメットがいなければ、合体中の自分の鍵ブレイヴ1つを除外することで、召喚コストすべてを支払ったものとして召喚できる。 | .effects.1.steps.0.action.useCostPayment.kind=exclude |
| BSKB01-C05.textLines[4] | カード除外 | 自分の「戦艦ハルバード」のLv2効果で、自分のネクサスを破壊するとき、かわりに、このネクサスを除外することで、その効果を発揮できる。この効果は相手のスタックタイミング元にならない。 | BSKB01-C04 effects[2..4] conditional_cost の選択肢 remove_from_game（C05自身のnoopは単独実装として数えない） |
| BSKB01-X01.textLines[5] | カード除外 | ターンに1回、相手のフィールドのコア3個までをトラッシュに置ける。自分のトラッシュにある系統：「鋼騎士」を持つカード3枚を除外することで、この効果は相手の効果では防げない。 | effects[2].steps[0].action.cost(resource:card) (grant_paid_prevention_immunity) → legal-actions-apply.ts の除外支払い |
| BSLH01-M03.textLines[3] | カード除外 | このカードをコストを支払わずに召喚するか、自分の魂状態の対象にコストを支払わずにセットする。その後、スピリット/アルティメット2体までを除外する。この効果発揮後、除外した対象を持ち主のフィールドに疲労状態でコストを支払わずに召喚する。 | .effects.0.steps.1.action.kind=remove_from_game |
| BSLH01-R06.textLines[4] | カード除外 | 相手のスピリット/アルティメット1体を重疲労でき、相手のトラッシュにあるカード1枚を除外できる。この効果発揮後、このスピリットがLv2以上でバトル中のとき〔ターンに1回：同名〕このスピリットを手札に戻せる。 | .effects.1.steps.1.action.kind=remove_from_game |
| BSLH01-T04.textLines[6] | カード除外 | ターンに1回、相手のスピリット/アルティメット/ネクサス1つを除外できる。 | .effects.1.steps.0.action.kind=remove_from_game |
| BSLH01-T10.textLines[6] | カード除外 | 〔ターンに1回：同名〕相手のスピリット/アルティメット4体を除外する。この効果で離れた対象はフィールドに残せない。 | .effects.1.steps.0.action.kind=remove_from_game |
| BSLH01-X03.textLines[7] | ソウルコア除外 | 【ソウルドライブ・S】自分のフィールド/リザーブの<ソウルコア>1個を除外すると、相手のスピリット/アルティメット2体までをデッキの下に戻し、自分のスピリットすべてを回復させる。この効果は相手の効果では防げない。 | .effects.2.steps.0.action.to.kind=removed_from_game |
| BSLH01-X04.textLines[4] | ソウルコア除外 | 【ソウルドライブ・S】〔ターンに1回：同名〕自分のフィールド/リザーブの<ソウルコア>1個を除外すると、ボイドからコア3個までを自分のライフに置き（ライフは最大5）、自分のスピリットが4体になるまでトラッシュにある系統：「CB」を持つスピリットカードをコストを支払わずに自分のスピリット/アルティメットのコアを0個にせずに召喚できる。 | .effects.1.steps.0.action.to.kind=removed_from_game |
| BSLH01-X05.textLines[4] | ソウルコア除外 | 【ソウルドライブ・S】〔ターンに1回：同名〕自分のフィールド/リザーブの<ソウルコア>1個を除外すると、シンボル合計5つまで相手のスピリット/アルティメット/ネクサスを破壊する。この効果は相手の効果では防げない。 | .effects.1.steps.0.action.to.kind=removed_from_game |
| BSLH01-X06.textLines[7] | ソウルコア除外 | 【ソウルドライブ・S】自分のフィールド/リザーブの<ソウルコア>1個を除外すると、次の自分のスタートステップまで、系統：「CB」を持つ自分のスピリットすべては相手の効果を受けない。 | .effects.2.steps.0.action.to.kind=removed_from_game; .effects.3.steps.0.action.to.kind=removed_from_game |
| BSLH01-X07.textLines[6] | ソウルコア除外 | 【ソウルドライブ・S】〔ターンに1回：同名〕自分のフィールド/リザーブの<ソウルコア>1個を除外すると、自分のデッキを上から6枚オープンする。その中の系統：「CB」を持つカード3枚までをコストを支払わずに召喚し、残りはデッキの下に戻す。 | .effects.2.steps.0.action.to.kind=removed_from_game |
| BSLH01-X08.textLines[4] | ソウルコア除外 | 【ソウルドライブ・S】〔ターンに1回：同名〕自分のフィールド/リザーブの<ソウルコア>1個を除外すると、このターンの間、系統：「CB」を持つ自分のスピリットによるライフの減少は相手の効果では防げない。 | .effects.2.steps.0.action.to.kind=removed_from_game |
| BSLH01-X09.textLines[6] | ソウルコア除外 | 【ソウルドライブ・S】〔ターンに1回：同名〕自分のフィールド/リザーブの<ソウルコア>1個を除外すると、このスピリットのLv1につき、相手のスピリット/アルティメットのコア2個をトラッシュに置き、消滅した対象1体につき自分のトラッシュにある系統：「CB」を持つカード1枚を手札に戻す。 | .effects.2.steps.0.action.to.kind=removed_from_game |
| BSLH01-X10.textLines[4] | ソウルコア除外 | 【ソウルドライブ・S】自分のフィールド/リザーブの<ソウルコア>1個を除外すると、相手のスピリット/アルティメット3体までを破壊し、その効果を発揮させず、このターンの間、このスピリットに赤のシンボル1つを追加する。 | .effects.0.steps.2.action.to.kind=removed_from_game; .effects.1.steps.0.action.to.kind=removed_from_game |
| BSRK01-X02.textLines[5] | カード除外 | 手札/トラッシュの「飛天御剣流」を含むマジックカードのメイン/フラッシュ/スタック効果1つを発揮できる。この効果で発揮するメイン/フラッシュ/スタック効果は、相手の効果を受けない。その後、効果を発揮したカードは破棄する。さらに、バトル終了時、Lv2以上なら、手札/トラッシュのマジックカード1枚を除外することでこのスピリットは回復する。 | .effects.1.steps.0.action.kind=remove_from_game |
| BSSG01-R02.textLines[5] | カード除外 | 相手のスピリット/アルティメットすべてを疲労させ、このターンの間、相手のネクサス/創界神ネクサスすべての効果は発揮されない。この効果は、自分のターンしか発揮されない。その後、このカードを除外する。 | .effects.2.steps.2.action.kind=remove_from_game |
| BSTH01-X07.textLines[6] | カード除外 | BP15000以下の相手のスピリット/アルティメット1体を除外する。 | .effects.2.steps.0.action.kind=remove_from_game |
| BSTH02-M01.textLines[0] | カード除外 | トラッシュに置かれたこのカードは除外する。 | .effects.0.steps.0.action.kind=remove_from_game |
| BSTH02.7-C02.textLines[1] | カード除外 | 自分はデッキの下から2枚ドローできる。または、〔ゲームに1回:同名〕自分のトラッシュにある系統：「幻想」と「動玩」を持つカード3枚を除外することで、次の自分のスタートステップまで、相手のスピリット/アルティメット/ネクサス/創界神ネクサスのシンボルを0に固定する。 | .effects.0.steps.0.choice.0.action.kind=remove_from_game |
| BSTH02.7-C05.textLines[0] | カード除外 | トラッシュにあるこのカードは手札/デッキに戻らず、手元からフラッシュ効果を使用したこのカードは、効果発揮後に除外する。 | .effects.2.steps.1.action.kind=remove_from_game |
| BSTH02.7-C06.textLines[3] | カード除外 | 相手のスピリット/アルティメット2体を指定し、このターンの間、自分のライフは指定した対象によって減らない。または、〔ゲームに1回:同名〕手札/手元にある系統：「幻想」/「動玩」を持つコスト7以下のスピリットカード2枚までを軽減シンボルすべてを満たして召喚できる。このとき、トラッシュにある黄1色のカード8枚までを除外することで、除外したカード4枚につき、召喚するスピリットカード1枚のコストを0にする。 | effects[1].steps[0].choice[0].action.groupedExcludeOverride → grouped-summon-cost-override-choice.ts: moveCardZone(removed_from_game) |
| BSTH02.7-M01.textLines[0] | カード除外 | Lv1 このカードを召喚するとき、自分のトラッシュにあるカード2枚までを除外し、除外したカード1枚につきコストを-1する。 | .effects.0.steps.0.action.useCostPayment.kind=exclude |
| BSTH02.7-TR02(A).textLines[7] | カード除外 | 自分の手札/手元/トラッシュにある黄1色のカード1枚を除外することで、このターン中の次のバトル終了後まで、相手はスタック効果を発揮できず、このスピリットは可能ならこのターンの最初にアタックする。 | .effects.2.steps.0.action.kind=remove_from_game |
| BSTH02.7-X02.textLines[1] | カード除外 | 手札/手元にあるこのカードは召喚できる。このとき、自分のトラッシュにある系統：「幻想」/「導界者」/「導魔」/「動玩」を持つ黄1色のカード4枚までを除外し、除外したカード1枚につき、コストを-1する。自分のライフが3以下のとき、この「除外効果」は相手の効果では防げない。召喚したとき、このターンの間、相手のスピリット/アルティメット3体はアタックできない。。 | .effects.1.steps.0.action.useCostPayment.kind=exclude |
| BSTH03-転醒X01(A).backFace.textLines[3] | カード除外 | ターンに1回、相手のスピリット/アルティメット/ネクサス1つを除外する。この効果は系統：「蓬莱」を持つ一切の効果で防げず、フィールドに残らない。 | .backFace.effects.0.steps.0.action.kind=remove_from_game |
| BSTH05.5-C01.textLines[5] | カード除外 | 相手のデッキを上から2枚除外する。 | .effects.1.steps.0.action.to.zone=removed_from_game; .effects.2.steps.0.action.to.zone=removed_from_game |
| BSTH05.5-C01.textLines[8] | カード除外 | 系統：「緋想」/「竜渡」を持つ自分のスピリット/アルティメットがアタックしたとき、相手のデッキを上から2枚除外する。 | .effects.1.steps.0.action.to.zone=removed_from_game; .effects.2.steps.0.action.to.zone=removed_from_game |
| BSTH05.5-M04.textLines[8] | カード除外 | 相手のスピリット/アルティメット1体を重疲労させる。さらに、自分の青の導界者ネクサスがあるとき、相手のデッキを上から4枚除外する。 | .effects.2.steps.1.action.to.zone=removed_from_game |
| BSTH05.5-X02.textLines[12] | 破棄→除外書換え | 相手への「デッキ破棄効果」すべてを「デッキ除外効果」にする。 | effects[1] redirect_deck_discard_to_exclude → native-move-core-handlers.ts / structured-zone-ops.ts（deckDiscard:trueまたはdiscardのみ） |
| BSTH08-XX01.textLines[9] | カード除外 | 〔このネクサスのコア4個をボイドに置く〕トラッシュにある系統：「幻想」を持つ白/青のカード1枚を除外することで、このバトルの間、自分のライフは減らない。この効果はターンに1回しか使えない。 | .grandwalkerData.divineSkills.0.effects.0.steps.0.action.destination=removed_from_game |
| BSTH08.5-M11.textLines[1] | 自己除外置換 | ■自分がこのカードを除外するとき、かわりに手札に戻せる。 | .effects.0.steps.0.action.resistsOutcome=remove_from_game |
| BSTH08.5-X01.textLines[3] | カード除外 | このスピリットが相手によってフィールドを離れるとき、自分の手元にある系統：「面霊」を持つブレイヴカード1枚を除外することで、同じ状態でフィールドに残る。この効果は相手の効果を受けない。 | .effects.1.steps.0.action.destination=removed_from_game |
| BSTH08.5-X04.textLines[3] | 自己除外置換 | ■自分がこのカードを除外するとき、かわりに1コスト支払うことができる。 | .effects.2.steps.0.action.resistsOutcome=remove_from_game |
| BSTH10-M01.textLines[5] | カード除外 | 手札にあるこのカードは召喚できる。このとき、自分の手札にある黒1色のカード1枚か、自分の手札/トラッシュにある黒1色/系統：「妖精」を持つカード3枚を除外することで、このカードのコストを3にする。 | .effects.2.steps.0.choice.0.action.to.zone=removed_from_game; .effects.2.steps.0.choice.1.action.to.zone=removed_from_game |
| BSTH11-M01.textLines[1] | カード除外 | 手札/手元にあるこのカードは召喚できる。このとき、手札/手元にある系統:「天璋」/「秘神」を持つカード1枚を除外することで、このカードの軽減シンボルすべてを満たす。 | .effects.3.steps.0.action.useCostPayment.kind=exclude |
| BSTH11-R01.textLines[10] | カード除外 | 相手のトラッシュにあるカード2枚を除外できる。そうしたとき、ターンに1回、自分が契約していなければ、このスピリットは回復できる。 | .effects.3.steps.0.action.destination=removed_from_game |
| BSTH11-X02.textLines[4] | カード除外 | 自分の緑の創界神ネクサス/導界者ネクサスにコア合計+2できる。その後、相手のトラッシュにあるカードを好きなだけ除外できる。除外したカード1枚につき、自分のトラッシュにあるカード1枚をデッキの下に戻す。その後、自分のデッキを上から2枚オープンできる。その中の系統：「天璋」/「秘神」を持つコスト7以下のカード1枚をコストを支払わずに召喚/配置できる。残ったカードはデッキの下に戻す。 | .effects.1.steps.1.action.destination=removed_from_game; .effects.2.steps.1.action.destination=removed_from_game |
| BSTS01-M01.textLines[8] | カード除外 | ターンに1回、相手の手元のカード1枚を除外できる。さらに、魂状態を含む自分の「リムル」/「ゴブタ」がいるとき、ボイドからコア2個をこのスピリットに置ける。 | .effects.3.steps.0.action.kind=remove_from_game |

