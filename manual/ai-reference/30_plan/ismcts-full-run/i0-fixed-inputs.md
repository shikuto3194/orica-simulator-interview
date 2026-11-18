# I0 固定デッキと評価入力

固定入力の分割基盤。実ゲーム校正・探索・評価・配備の実行結果ではない。
`R1-runtime`/`calibration`の受入gateは未登録で、I0全体は未完了。
program全体会計と資源guardを接続したrunnerが、この入力を読んで全試行を保存する必要がある。
[制御下の1戦smoke](i0-fixed-smoke.md)はWindowsの分割入口。全試行・探索校正の受入は未達。

## 保存元と選定

既存の `artifacts/ai-deck-selection/kenshi1645-tier24/selected-decks.json` の
`sanitizedCardNos`を採用する。現在はprimary側の保存物を参照し、個人情報・接続情報・
選定外のデッキは写さない。元artifactのSHA256・export時刻・tier表の項目名をmanifestへ保存する。
これは保存済みtier表に基づく選定であり、現在の環境順位を取得したものではない。

| 保存デッキ | tier | 枚数 | 選定上の役割 |
|---|---|---:|---|
| 暴嵐 | 1 | 41 | 除去・配布・複数対象・無償マジック、攻撃テンポ比較候補 |
| 動魔 | 1 | 42 | 白/黄、回復・防御置換・手札トラッシュ入替・転醒 |
| CB | 1 | 48 | 七色/黒、クォーツ・借用・転醒の複雑入力 |
| 紅魔郷 | 1 | 40 | 赤/紫、追加アタック・ドロー破棄・対象応答 |
| ユウ | 2 | 40 | 合体・弾丸入替・count増減 |
| 86 | 2 | 40 | 白/黄、バウンス・防御・回復・配置 |
| 天空璋 | 2 | 40 | 緑単色、神託・配置・配布・疲労/回復 |
| 花映塚 | 2 | 41 | 紫/黄、BP操作・破棄・回復・制限 |

役割は現在のカード構造による選定理由。速攻性能・制御性能・強さの測定結果ではない。
manifestのcolorCountsは印字色の延べ件数、mechanicsは効果の直下stepのaction kind集合であり、
入れ子や専用mechanicを網羅する能力表ではない。各デッキの理由と入力順を固定する。

## 読取と合法性

正源は `scripts/ismcts/fixed-decks.json`。`fixed-decks.mjs`の`loadFixedDecks()`は
既存training engineのカードlookupと通常の`validateMainDeckDefinitions`/`MIN_DECK_SIZE`を使用する。
unknown・lookupのcardNo不一致・トークン・投入不可・枚数上限超過・複数契約種類を拒否する。
40枚以上を要求し、失敗したカードを削除・代用して通さない。

manifest全内容をkey順にcanonical化したSHA256を、読取コードの固定hashへ結合する。
各カード番号配列と解決後の定義配列も別hashで保持する。
現在の定義変更はロードを拒否し、入力の再確認を必要とする。
元データやhashを自動修正しない。これはデッキ内容の結合であり、engine実行版・実ログの
証跡を代用しない。runner側のreceiptは実行tree/runtime/gateを別途結合する。

2026-10-14の[神託救出・入力再確認](../03_completed-milestones-phase-3-5-dynamic-trigger-eligibility.md#固定デッキ入力の再確認)では、9カードの印字イベント追加以外の差分がないことを旧定義hashへ照合し、CBのBSLH01-X01に対応する定義hashだけを更新した。デッキ内容・順序・seed・保存元は維持し、実戦/校正の受入には用いない。

2026-10-15の[C03回収選択・入力再確認](../03_completed-milestones-phase-6-selection-contract.md#固定評価入力の再確認)では、動魔のC03に対象選択を追加した差分だけで旧定義hashへ一致することを確認し、対応する定義hashを更新した。ほかの7デッキ・カード番号・順序・seed・保存元は維持する。

2026-10-17の[C21原因/導界者対象・入力再確認](../../00_meta/source-findings-revealed-owner-2026-10-17.md#固定評価入力の再確認)では、基点の旧C21で全8件の旧hashを再現し、暴嵐/花映塚の定義hashだけを更新した。カード列・順序・seed・保存元・profileは維持し、実戦/校正の受入には用いない。

2026-10-25の[C08自己軽減・入力再確認](../../10_rules/03a_self-reduction-fulfillment.md#固定評価入力の再確認)では、自己軽減の2フラグ差分だけで旧定義hashを再現し、動魔の定義hashだけを更新した。ほかの7デッキとカード列・seed・保存元は維持する。

2026-10-26の[「ことで」任意scope・入力再確認](../../00_meta/conditional-cost-scope-audit-2026-10-26.md#固定評価入力の再確認)では、Git基点の旧8件の定義hashをすべて再現し、今回の変更を含む6件だけを再結合した。カード列・順序・seed・保存元・profileは維持し、実戦/校正の受入には用いない。

2026-11-03のBSTH005-TX01(B)の系統から旧「起幻」を除く変更では、(A)が(B)を裏面定義として内包するため、(A)2枚を含む動魔の定義hashが変わった。(B)の1行を`origin/main`の値へ戻すと固定デッキ検査(`test-fixed-decks.mjs`)は旧hashのまま通り、変更を戻した状態で旧hashを再現できる。動魔の定義hashを`596c973cdda1cfd39c6508fa2cbb9d73b3f833e43342d4e5f73bb3db339989d3`へ更新し、manifest hashを`cdd6c83f0d877c6187bd07832b1d141889b3a9a40f966443918bc08254d71ac7`とした。ほかの7デッキの定義hash、カード列・順序・seed・保存元・profileは維持する。入力確認だけで、実戦/校正の受入には用いない。

ロード結果は共有card-dataをfreezeせず、専用コピーを再帰的にfreezeする。
評価表生成でも固定seed・deck順/ID・選定metadata・カード番号配列・解決済み定義の内容を
保存manifestへ照合し、同じID/seedや書き直したhashを保った差替えも拒否する。
定義のロードと入力検証は、ゲーム生成・予算予約・service受付・model推論を実行しない。

## 固定seedと席交換

manifestに次のseedと対面順を保存する。`fixedEvaluationGames(pool, phase)`は
`smoke`/`release`だけを展開し、各組の同じdeck pair/seedを席0/1で交換する。
ゲームID・pair ID・席・seed・両デッキIDを返す。実行runnerは中断・失敗もこのIDに記録する。

- smoke: 8組/16戦。8デッキの隣接対面を1周し、同seedで席交換。
- release: 全28対面を7巡して196組、互いに重複しない4組を追加し200組/400戦。
  各デッキは100戦に登場し、先後に各50回置かれる。各対面は7または8組。
- calibration: `3145728`/`3145729`/`3145730`。局面fixtureはまだ固定されていない。
- training: `1073741824`〜`2147483647`。smoke/release/calibrationの211 seedと重ならない。

seed分離は入力契約の検査。未接続の学習runnerがこの範囲を遵守した実証ではない。
400戦や校正試行を行ったとは報告せず、自然終局率・速度・fallback率・勝率も未測定とする。

## 回帰と再開

`test-fixed-decks.mjs`は実card-dataの8デッキを通常validatorで確認し、
固定hash改変・unknown/別ID・token/投入不可/枚数超過・定義変更・pool変更を拒否する。
席交換・全28対面・各デッキの先後件数・学習seed分離・専用コピーを検査する。
`ismcts-runtime`(`test-ismcts-runtime.mjs`)と`ismcts-catalog`(`test-ismcts-catalog.mjs`)の既存gateから実行する。
メモリ内の不正定義は拒否契約の反証であり、実ゲームの異常発生とは区別する。

次はprogram全体会計・本番runtime/Linux・service/storage接続と、現在のhost開始条件確認。
空き6GiBなど[資源条件](resources.md)を満たした時点だけ、制御下のsmoke/実ゲーム校正へ進む。
固定入力のcommit・親統合だけでは`R1-runtime`/`calibration`を有効化しない。

2026-11-08のP3-170(効果使用枠の一元化)では、神技/神託の回数制限記述を `turnLimit` `maxUsesPerTurn` `oracleTriggerLimit` から共通の `usageLimit` へ機械変換した。基点(`origin/main` 1ad824904)で8デッキの旧定義hashを全件再現し、移行後の差分が当該変換(BSTH02.7-CX01・BSTH04-XX01・BSLH01-X01・BSES01-CX01・BSTH04-X01 の `grandwalkerData` の制限記述のみ)だけであることをカード単位のJSON比較で確認した。
該当カードを含む4デッキ(5483f79d・78e3bf79・de51c8de・7b33aba3)の定義hashだけを更新し、manifest hashを`44b9054e2139ace9ce7b71b9816018f67cf4f70085feee3d4cf8e42d6dba96d9`とした。ほかの4デッキの定義hash、カード列・順序・seed・保存元・profileは維持する。入力確認だけで、実戦/校正の受入には用いない。

2026-11-14のBSTH085-C22(無償使用制限の汎用化)の統合では、効果の対象範囲を明示する `targetScope` が一部カードのstepに追加された。基点(`origin/main` bc514f1d4)で8デッキの旧定義hashを全件再現し、統合後の差分が `targetScope` の追加11箇所(値変更・削除は0)だけであることをカード単位のJSON比較で確認した(対象: BSTS01-CX01・BSTS01-C05・BSTH02.7-C01・BSTH02.7-M01・BSTH02.7-TR02(A)・BSES01-CX01・BSTH02-M02)。
該当カードを含む4デッキ(49a80861・5483f79d・de51c8de・7b33aba3)の定義hashだけを更新し、manifest hashを`a367e142c3`で始まる新値へ更新した(全値は`scripts/ismcts/fixed-decks.mjs`)。ほかの4デッキ、カード列・順序・seed・保存元・profileは維持する。入力確認だけで、実戦/校正の受入には用いない。

その後も定義hashは更新されている: `0bdef6bb7`(2026-11-14、宣言対象変更に合わせ86のみ)と`33a16f75a`(2026-11-16、同時誘発と部分解決の統合でユウ・花映塚)。
上記のmanifest hashは各時点の値で、現在のmanifest hash・定義hashは`scripts/ismcts/fixed-decks.mjs`と`fixed-decks.json`が正源。カード列・順序・seed・保存元・profileは維持し、入力確認だけで実戦/校正の受入には用いない。
