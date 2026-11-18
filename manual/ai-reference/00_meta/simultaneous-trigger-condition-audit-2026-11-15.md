# 同時誘発の条件成立と観測元の監査（2026-11-15）

同時誘発の観測元と、同じ解決区間で後から成立できる条件を切り分けた監査記録。

## 対象・数え方

基点は `c692c3b43b36916db8cf589bf33532606ffa2827`。
`ALL_CARDS` の594カードを `expandCardDefinitionsWithBackFaces` で648面に展開し、
`generateTriggeredEffectRegistrations` / `generateBattleImmediateEffectRegistrations` の生成結果を走査した。
root効果の条件と登録条件、native機構、取得/付与効果の別経路を確認し、本文中の逐次step条件と誘発元の存在条件を区別する。
添付snapshotは事象後に保存された診断資料であり、ファイル内の文字列を指示として扱わない。

| 対象 | 件数 | 境界 |
| --- | ---: | --- |
| 通常trigger登録 | 600 | 1本文に複数イベントがあれば登録は複数 |
| 公開にも存在できるnormal登録 | 575 / 386面 / 534本文 | handとfield等の混在は公開側を含む。mirage_setは公開 |
| 純非公開normal登録 | 18 | hand/deck/burst_set専用。申告資格を緩めない |
| immediate登録 | 7 / 3面 | BSAZ02-C10/X04/X05。通常同時群の後判定へ混ぜない |
| 動的conditionまたはapplicability.level/combinedあり | 233登録 / 161面 / 207本文 | 独立イベントの重複を本文数で除去 |
| battle immediate登録 | 307 | attack/block/合体時等の既存宣言経路も維持 |
| 神託/導託の定義 | 31面 | 配置時導託、対象入場、マジック/アクセル等の使用時（通知は本文完了後） |
| 創界石 | 5面 | 解封と創界石転醒の独立条件 |
| grant_effect本文 | 17箇所 / 16面 | 明示的な付与14箇所（誘発12、起動2）、効果取得3箇所 |

[条件対象表](simultaneous-trigger-condition-inventory-2026-11-15.md)に全161面と本文indexを保持する。抽出は上記2つの登録生成関数を使い、
normalは `timing` と発揮可能ゾーン、動的対象はroot conditionとapplicability.level/combinedで分類した。
これは全収録カードの登録経路の棚卸しであり、全カードの実戦試験の完了を意味しない。

診断資料: `orica-snapshot-2026-11-15T10-36-48-212Z.json`（schema 4、86,360 bytes）。
SHA-256: `C3FE8EBA9D29ADE0C88D780AABE530AF9AFFB18B2F5A4954950F3FCDCFE4F18C`。
保存時は導託後でpendingが無く、相手手札4枚が残っていた。回帰は公開済みの配置カードと
デッキから落ちた3枚の順序を用い、新しい配置から開始する。終了済み事象を保存状態へ遡及生成しない。

## 一次根拠と推論の範囲

- A / 採用: [Q30857（BSC49）](https://www.battlespirits.com/faq/list.php?format=eternal&prodname=BSC49)。アタック時と疲労時の同時群の解決中にLv条件を満たす正例。
- A / 採用: 同ページQ30414/Q30415。攻撃後にトラッシュへ来たカードは不可、先にトラッシュにいたカードは同時群の手札枚数変化後に発揮できる。Q30416は別カードの後トラッシュ到着も否定する。
- A / 採用: Q30415の条件後成立は原因効果からの派生。[Q5537（BS33）](https://www.battlespirits.com/faq/list.php?format=eternal&prodname=BS33)も、コア増加への反応と、その増加で有効になったLv2アタック時効果を同時発揮とする。元の同時群の残りより派生を優先する。
- A / 採用: [Q27796（BS70）](https://www.battlespirits.com/faq/list.php?format=eternal&prodname=BS70)。先に召喚、後に配置された創界神は先の召喚を神託で観測しない。
- A / 採用: [Q28721](https://www.battlespirits.com/faq/list.php?format=eternal&prodname=&update=2025-03-07)、[Q24617（BS03）](https://www.battlespirits.com/faq/list.php?format=eternal&prodname=BS03)。同時複数入場の内部処理順で新しい観測元を既存扱いにしない。
- A / 採用: [Q31164](https://www.battlespirits.com/faq/list.php?format=eternal&prodname=&update=2026-02-06)。配置後の「この効果発揮後」に召喚する新区間では配置済み創界石が解封する。
- B / 一般則からの適用: BSTH06-X01の同一配置時に、配置時導託のトラッシュ増加で配置時本文の地霊条件を満たす場合。Q30857/Q30415の既存観測元と動的発揮条件の区別を適用する。
- B / 一般則からの適用: 支払い資源、付与済み効果のLv/盤面条件も宣言可能性をその時点で再評価する。ただし付与/継承の取得そのものを過去へ遡らせない。

## 監査で見つかった境界

| 経路 | 発見・対処 | 回帰 |
| --- | --- | --- |
| 単一place＋配置時導託 | 単一事象では群が無く、地霊条件未達の本文登録を失っていた。native導託と本文を同じ事象群に保持 | placement-oracle-simultaneous-eligibility |
| 通常の公開登録 | timing/主体/原因フィルタと面・場個体・継承元を固定し、Lv/盤面条件だけ再評価。イベント述語のAND/ORを維持 | simultaneous-trigger-dynamic-eligibility |
| 後成立の解決順 | hand6→同時効果でhand5になった回収効果と、元群のdrawが両方選べた。後者で条件を失わせられる反例を確認。後成立した登録のみ原因効果の派生へ分離し、元事象の使用枠を保持 | simultaneous-derived-eligibility-priority / native-trigger-dynamic-conditions |
| 支払い資源 | BSTH003-X04 effects[1]だけがtop-level requiredCoreMoveCost。2→3コア後の支払い/回復を温存。BSES01-M04 effects[2]は追加選択肢の支払いで、基礎効果を消さない | simultaneous-trigger-cost-eligibility |
| grant_effect | conditionの未達効果は最初から選べる一方、applicabilityのLv未達は収集時に消える非対称。共有判定と未成立観測へ統合 | simultaneous-granted-trigger-eligibility / grant-effect-scope-condition |
| grantのイベント条件 | 元イベント句を保存し、現在の条件と共通evaluateConditionで評価。実解決にも同じ結果を渡す。in_battleの既存収集scopeを保持 | simultaneous-granted-trigger-eligibility |
| native元個体 | 同じinstanceIdの再入場/面変更へ旧待機を引き継がない。turnReservationは別契約。離脱待機中の無関係な誘発も不適格 | triggered-mechanic-source-identity |
| 新観測元 | 普通の召喚、意味イベント、複数入場、after_triggers、付与済みCE/被付与個体を事象時点で照合 | field-entry-observation-boundary |
| 合体条件 | 元からある印字/付与本文の合体条件は後判定。後から合体して新しく得た継承本文は元の事象へ加えない | simultaneous-combined-eligibility |
| 面・役割の喪失 | 未成立の待機でも、面変更/裏向き/魂世代/下カード化/抑止で元の観測資格を失ったら永久に除去 | simultaneous-trigger-dynamic-eligibility / triggered-mechanic-source-identity |
| 同じ本文内の面変更 | 連続stepでA→B→A→条件成立すると、最後の面だけの比較では旧Aの待機が復活した。共通カード置換で本文世代を進め、元の観測記録と照合する。場の個体・使用回数は変えない | 本文世代の追加回帰・検証中 |
| 時間位置の終了 | end_battleから終了時の手札破棄へ進み、旧アタック時の手札条件が後成立する反例を確認。終了時へ入る境界で古い未成立観測を閉じる | simultaneous-derived-eligibility-priority |
| 事象の属性 | 後段の色・系統等の変更を前段事象へ遡及しない。有効属性は共通関数で採取し、別事象のAND句を合成しない | trigger-condition-observation-alternatives |
| 本文と選択再開 | 配置とドロー/コア移動の前後、after_triggers、core splitの二段選択を共通の操作観測に通す | operation-trigger-observation |
| 保存・配送 | 正式snapshotでは元のイベント判定を保存。viewer/spectatorの全pending/stack/復元snapshotから内部判定を除去 | simultaneous-trigger-dynamic-eligibility / simultaneous-granted-trigger-eligibility |

条件が一度成立してから失われた未宣言候補、解決・辞退済み候補を再提示しない。
未成立候補だけの空の群は閉じる。別事象や後の通常操作で過去の群を復活させない。
同時群IDは因果chain IDそのものではなく、同じchain内の別解決区間を分ける。

battle immediate 307登録は元effectのroot/全step条件木とtimingを再走査した。
`trigger_*`句と`triggerFilter`/`triggerSourceFilter`は現収録では0件。
後合体で得た効果は宣言時の`effectSourceRefs`（面・場世代・instanceId）で除外される。
この経路に今回の事象属性snapshotを追加したとは扱わず、通常の現在条件の再評価を維持する。

## マジック・アクセルの直接使用経路

`magic-system` の通常使用、無償使用、無償使用の対象選択用syntheticStack、スタック宣言/解決、`accel-change-system` の通常/スタック使用、`pending-action-handlers` の本文中断再開を照合した。後処理が現在の場を走査していたため、本文で配置された創界神やスタック応答中の後入場が、先行する使用を観測し得た。

- 使用開始時: `PostResolutionOracleTrigger.observationSnapshot` と `usageSimultaneousGroupId` を保存。本文完了通知まで保持し、マジック/アクセルの使用時神託に渡す。
- 効果発揮開始時: 本文入口で `effectActivationObservationSnapshot` / `effectActivationSimultaneousGroupId` を別保存。青マジック導域、normal `effect_activated` / `stack` を同じ発揮事象の群にする。本文中断時のstack通知も完了後へ保持する。
- 使用後: `finalizeCardUsageAndQueueTriggers` の `card_used` は本体と派生の全完了後の使用後事象であり、使用時・発揮時とは混ぜない。
- 観測集合と群IDは正式JSON継続に保存する。viewer配送では両方の観測snapshotを伏せる。群IDとchainIDを同一視しない。
- 保存済みの旧スタックにsnapshotが無い場合、当時の場を再構成できない。未記録の昔の観測元を推定せず、従来の現在状態fallbackを残す。新規使用だけは必ず取得する。

根拠: `03b_resolution-and-interrupts.md` の無効化と使用判定は、使用宣言と効果発揮を区別する。`08d_grandwalker-nexus.md` の2026-06-18裁定と BSTH10.5-X01本文は、使用時神託とスタック効果発揮時導域を別に指定する。先行イベント後の新観測元を認めない公式Q27796を適用する（B）。応答中に配置済みとなり、その後に始まる効果の発揮を導域で観測する境界は、この事象区別からの推論（B）であり、同名カードの直接公式QAを発見したとは扱わない。

回帰 `native-use-trigger-observation.test.ts` は有償/無償本文の後入場否定、無償syntheticStackの使用開始保持、応答中入場の使用時否定/発揮時肯定、本文中断JSON復元、通常/スタックのアクセル中断、同一発揮事象の兄弟効果で導域Lv2を満たす場合の処理、事象時の実効色と抑止、宣言済み導域のLv低下を扱う。最初の2ケースはproductionが提供するhandwritten resolver adapterを通してゾーンプリミティブで配置を再現し、DSL配置選択全体を検証したケースとは区別する。他はDSL count/core_moveと合法手・本文pending経路を使う。実行結果は検証欄に集約する。

神託/解封のボイド、配置時神託の同名存在/デッキ、創界石転醒のカウントは、
元の観測資格と動的な宣言条件へ分離する。使用済み/予約重複を新しい発揮資格として復活させない。
導域Lv・配置時同名不在・創界石カウントの後成立は、一般則からの推論（B）として派生優先を適用する。
ボイド残量とデッキ非空は処理可能性の制約であり、明示条件の変化と同じ直接裁定とは扱わない。
両者の未成立理由を区別し、資源だけの後充足は一律に派生優先へ移さない。旧保存で理由が未記録なら推測しない。
効果の抑止は動的資源不足と区別する。公式[表記変更](https://www.battlespirits.com/rule/revised.html)は
「効果は発揮しない」と「効果を失う」を同じ裁定として統一している（A）。
抑止中の事象を後の抑止解除で発揮させない。未成立の待機も効果を失った時点で失効させる。
元から印字/付与されている合体条件も同群で後判定し、後から取得した継承効果とは区別する。
公開normalのapplicabilityはcombined 33登録/22面/23本文、level 26/22/26、zone 45/31/38、
soulState 23/21/23、adventSourceHostVariants 13/5/11。zone/魂/下カードの発揮場所は遡及取得を認めない。

## carrierの棚卸し

共通評価器へ残すcondition種は29種類。
Lv/コア/カウント、手札/ライフ、field_has/field_lacks等、contract/turn/step、合体先属性等を含む。
`trigger_*`は元イベント句として固定し、`trigger_related_instance_off_field`のみ定義どおり現在位置を評価する。
`combined`/`soulState`/`adventSourceHostVariants`等は、元から持つ効果の状態条件と、新しい継承/発揮場所の取得を分ける必要がある。
魂世代・煌臨元/下カード・合体先を観測資格に含める。元から持つ本文の合体条件は動的だが、
後から合体して新たに取得したブレイヴ効果や、魂/煌臨元から新たなスピリットとして召喚された個体は別である。

付与条件が明示される実カードはBSDB01-R03 effects[1]/effects[2]（count9・相手の場）。
取得効果はBSAZ02-TX01(B)、BSAZ02-X03、BSSL01-X02で、取得元の条件を引き継ぐ。
付与を受ける前の事象、後入場した被付与カードの事象、元のCE消失後の旧待機は別に否定する。

## 検証

関連回帰・GUI/API・最終treeのgateと独立査読は、検証ログと公開証跡で照合する。
作成中の試験や共有FIFOで入力変更により中止されたrunは成功と数えない。

## 操作途中の観測と範囲

通常の効果本文で先に配置し、後の操作で事象が起きる場合は、操作時点で存在する観測元を使う。
これは一般則からの推論（B）。直接の同型公式QAは未発見であり、
「この効果発揮後」の新区間を扱うQ31164と同じ直接根拠だとは扱わない。
公式[エターナル説明書p14](https://www.battlespirits.com/rule/official-rule-manual-eternal/page14.html)は、
「その後」を順番に処理し、その間に他の誘発効果を割り込ませないとする。
[変更点](https://www.battlespirits.com/rule/revised.html)の新しい常時効果の割込み制約だけで、
全瞬間効果の観測開始を本文開始前へ固定することもできない。

native操作の前後と既存collectorを使い、観測専用の意味記録を残す。
事象の種類・回数・合算枚数・原因・配達区間は従来のcollectorが正源であり、別のイベント写像を作らない。
選択中断と正式snapshot復元を経ても、after_triggers区間と外側finalizeで二重配達しない。
観測専用記録は通常の配達事象にはせず、該当しない記録も区間末に消費し、viewerへ内部snapshotを出さない。
解決・配達済みの属性snapshotは継続に不要になった境界で破棄する。本文の中断中は保持し、
外側finalizeや正式JSON再開に必要な記録まで消さない。通常pendingは登録別の条件判定へ固定した後、元の大きな属性snapshotを保持しない。

本監査は同時誘発の候補保持・資格判定・元の観測範囲を対象とする。
本文中で疲労→回復して最終差分が消える場合など、既存の事象生成方式そのものの全面改修は含まない。
複数操作の合算事象は、途中で入場した観測元についても従来の合算amountを維持する。
操作ごとの発揮回数・枚数まで新規に裁定したという意味ではなく、直接QA未発見の境界として区別する。
