# カード・コアの除外先監査（2026-10-28）

受付: followup-196fb3a2d24a7dfb7552（旧デッキ限定: followup-173b89312f208109a34f）。親目標はカードをボイドに置く不整合の修復と再発防止。受入は直接除外3効果、カード専用移動型、全件走査、5ゾーン/耐性/自己置換/離脱回帰、GUIとREST、全gate・独立査読・公開main採用まで。公開前はpendingを保持する。

正源: [06 コア](../10_rules/06_core-system.md)「ゲームから除外する」は「ボイドに置く」と別処理。[03c2](../10_rules/03c2_deck-discard-and-zone-move.md)により、デッキ破棄→除外は真の破棄のみ。本文・既存carrierを照合し、新しい裁定は作っていない。

最大阻害はカード移動先に汎用Zoneを指定できたこと。CardZoneはvoidを除外し、move_card / move_self / search / 借用前後移動 / card_event移動を制限。共通moveCardZoneは未型付け入力も状態変更前に拒否する。保存状態からの移動復元はrequireCardZoneを通す。コア移動の型・カード定義は変更しない。

## 全文監査表

[全42行・41カードの本文/分類/carrier対応](card-exclusion-text-audit-2026-10-28.md)。未実装・曖昧なcarrierを完了扱いにしない。

## 正規のコア→void

[全46 action / 41カードの一覧](card-exclusion-core-void-audit-2026-10-28.md)を参照。ソウルコア除外とは別に監査し、正規のボイド移動を保持する。

## 回帰・残条件

公開対象UI監査は、fixture内の`regenerationSource`を実行してraw全648面・152本文行・借用14 actionと実M01の公開/秘匿runtimeEvidenceを再確認した。全non-hash生成値とraw/補助原本hashは一致し、M04の移動先1行に対応するBSTH05.5.tsだけがhash差分だった。`revealed-target-ui-raw-audit.json`の`sourceCorrections`へ根拠と回帰参照を追記して再結合し、監査分類・期待件数・原文は維持する。ミラー版承認の更新とは別の実装ソース照合である。

- card-deck-exclusion.test.ts: 全カード/裏面/神技/選択肢のmove_card目的地にvoidなし。実コンパイラでCardZone/DSL/低層moveのvoidを拒否し、core_moveのvoidを受理。未型付け低層入力も変更前に拒否。
- card-exclusion-zones.test.ts: 場/手札/手元/トラッシュ/使用中の到達・コア/手札整合と除外耐性を各々確認。
- bsth08-5-m11-set-aside-exit-replacement.test.ts / bsth08-5-x04-set-aside-exit-replacement-cost.test.ts: 自己除外の手札帰還/支払い/辞退/相手起因境界。
- card-exclusion-replacement-continuation.test.ts: C03によるM11複数枚の待機・受諾/辞退混在、X04の支払い後の再判定、保存再読込と旧選択の再適用防止。実C03本文は全選択後の9枚/10枚を数えて破壊閾値を判定する。実X01の即時/選択searchはM11/X04の受諾/辞退後まで残留を保留し、通常の離脱flushまで完走する。選択者への表示は現在の対象と選択肢だけで、他の選択者・観戦者にpendingを見せず、元盤面を含む継続はサーバー内に残す。
- remove-from-game-brave-orphan-step4.test.ts / remove-from-game-pierce-cannot-leave-field.test.ts / advent-source-field-exit-replacement.test.ts: 場の合体残留/追従・煌臨元・離脱耐性。bssg01-cards.test.tsとbsth02-7-c05-activation-zone-removal.test.ts: 使用中の自己除外と使用後cleanup。
- bsth05_5-cards.test.ts: C01召喚時/アタック時の2枚とM04条件成立4枚/不成立0枚。redirect-deck-discard-to-exclude.test.ts: X02の真の破棄と単なる配置/自デッキ/窓外を区別。
- GUI/REST: scenario-deck-exclusion.spec.ts。Alice GUI→Bob RESTと逆向き、X02書換え7枚/M04直接4枚の実行後状態・除外一覧・trash/void0を確認する。M02/M04自身のアタック時はバトル即時効果の合法手で宣言し、要石の他カードへの反応誘発の宣言経路を流用しない。ローカル開発room harnessの受入であり、本番room公開検証は親runnerの公開確認と分ける。
- scenario-deck-exclusion.test.ts: REST初期盤面にもAppと同じ共通リビルダを適用する。未初期化のREST seedではX02の継続効果がなく、実M02の7枚がtrashへ入った。共通再構築自体は登録・書換えとも正常で、ゲーム本体の登録不具合という仮説は棄却した。両ownerの初期化一致・再構築重複なし・継続効果の手動注入なしの実M02解決・Lv1負例を固定する。

独立査読round 1（固定tree cd859db7、全29ファイル/6 lens）は、C03でM11を2枚除外すると1枚目以外の置換が落ちることと、X01のsearch_zone即時/pendingが自己置換を迂回することを実再現した。carrier実在表だけではこの意味的接続を証明できなかった。原所見・9棄却理由・未確認の本文継続を`.codex-temp/exclusion-verifier-round1-report.json`へ保持する。未選択札を保持して毎回再判定し、searchの除外をexecuteRemoveFromGameへ接続し、共通の本文continuationで最終選択後に実除外数を返す修正を行った。追加13件と既存単枚9件の22件が成功したが、変更後の全gate・GUI・独立査読・公開確認は別途必要である。

置換用GUI/RESTケース（mode=replacement）は実C03本文を最初のM11選択まで実行したseedから開始し、両ownerで1枚目を手札へ、2枚目を除外する。未選択札保持・旧選択消失・3枚実除外・全選択後の本文再開を検査する。発動宣言の全経路や本番認証roomの検証と同一視しない。

置換continuationの表示境界追加に伴い、整形後に公開UI監査の埋込再生成も再実行した。648面・152本文行・14借用、実M01の公開/秘匿runtimeEvidenceを含む全生成値は同一で、差分はstate-sanitize.tsの補助ソースhashだけだった。`sourceCorrections`と`.codex-temp/exclusion-public-audit-round1-rebind.json`へ実差分と照合を記録し、本文・分類・件数・raw原本を維持する。

独立査読round 2（固定tree c862e419、全36ファイル/6 lens）は前2件とC03本文継続を実行確認したが、X04の置換支払いが通常のコスト経路を迂回する1件を反証した。リザーブ0で場コアを使えず、実R03のリザーブ禁止を無視し、通常/ソウルの選択も省略していた。原所見と11棄却理由は`.codex-temp/exclusion-verifier-round2-report.json`へ保持する。03a_cost-paymentの通常原資に従い、合法手はgetAvailablePayCostCoreSources、原資選択は共通pendingCoreSourceAllocation、実支払いはapplyCardCostPaymentsへ接続する。元の置換queueと本文continuationは支払い中もサーバー内で保持し、配分の現在候補・総額・所有者を再検証してから同じ本文再開出口へ戻す。

`card-exclusion-replacement-payment.test.ts`はfield-onlyの実X01、実R03の禁止carrier、通常/ソウル選択、支払い元のコスト消滅、原資選択中の再押下/不正配分拒否、C03のX04二枚と実除外9/10枚を扱う。実R03の禁止carrier単独の接続検証をR03全本文の発動再現へ拡張しない。GUI/RESTのmode=replacement-paymentは両ownerでリザーブ0から場コアHUDで支払って二枚目を辞退し、実除外3枚と最後の本文再開を確認する。変更後の全gateとround 3、通常統合・公開確認は別途必要である。

必須GUI gateのR21では、traceにより唯一のdecline_blockをGUIがパス直後に自動実行し、テストが消えたボタンを待つ競合を確認した。単独辞退だけは同じ合法入力の自動実行を待ち、通信上の辞退1回・版進行・最終ライフ/盤面の検査を保持する。待ち時間/検査/通常retryは緩和しない。根拠は`.codex-temp/exclusion-r21-auto-decline-proof.json`と保存trace。この特定反例の原因を過去のM06や別GUI不進行すべての根因へ拡張しない。

M06のBobバースト・永遠亭下では、通常trace付き5回は成功したが、診断fixtureでREST更新後のGUI応答だけを750ms遅らせると同じ停止を再現した。最初のパス応答が未完了の26ms後に次の同一署名パスをクリックし、二度目の送信が抑止された。宣言の画面表示待ちだけでも反例は残り、実HTTP応答完了と既存の送信中banner消失を待つ方法で制御反例が成功した。通常テストのpass helperにこの同期だけを追加し、応答5秒・全体30秒・最終盤面の検査は保持する。自然発生時の直接traceはないため、すべての過去停止が同一原因と断定しない。診断は`.codex-temp/exclusion-m06-injected-red.log`、`exclusion-m06-injected-green.log`（表示待ちのみ失敗）、`exclusion-m06-injected-complete.log`と各保存traceを参照する。

独立査読round 3（固定tree efaa2435、全40ファイル/6 lens）は、全26 gate・fresh build・GUI107件の同一入力成功を独立確認した上で、4件を反証した。未型付けsearchのvoidがhandへ正規化されること、revealed dispositionが直接カードをvoidへ書くこと、借用本文後に不正なcleanupを保存すること、通常コア消失後の古い配分がソウルへ代用されることだった。4成立・9棄却・未確認0の原報告は`.codex-temp/exclusion-verifier-round3-report.json`に保持する。待機中の既存CE継続、同一効果の離脱成立数、表示秘匿の懸念は正源と実行probeにより棄却し、正しい挙動を変更しない。

初回査読後の修正サイクルは、複数置換/本文継続、共通支払い、今回の入口/物理コア種の3回にまとめた。searchは正当な個別行き先選択sentinelを保ち、正規化前にCardZoneを検証する。借用はbeforeMove/thenMoveを公開・usage・本文より前に検証する。明示/推論のcard_event dispositionとmandatory一括移動を共通検証へ接続し、カード配列の共通更新境界も枚数同期前にvoidを拒否する。原資配分は提示snapshotを上限に現在の合法候補の通常数/ソウル可用性と交差させ、通常指定をソウルへ代替しない。

新回帰は修正前8失敗/12成功を確認した。共通カード配列ガードにより、既存I1の公開ゾーン組立がvoidカードを正規入力と扱う前提も検出した。06_core-systemのカード/コア区別に従い、物理componentはtrash/removed_from_gameだけとし、voidを公開定義参照前に拒否する。各席4枚の物理コピー、秘密情報/IDの差替え、再投影、回収後召喚の対照は保持する。I1の完全world再構築や親受入を完了した主張ではない。この段階の関連8ファイル77件は成功した。さらにHUDだけでなく直接の明示配分にも同じ物理種検証を適用するため、現在候補の検証は置換resolverへまとめ、修正後4ファイル37件の成功も確認した。最終全件gateと変更後treeの独立査読は別に必要である。

借用入口のガード追加後も公開UI監査の埋込generator全体を再実行した。648面・152本文行・14借用と実M01の公開/秘匿結果を含む13生成フィールドは完全一致し、差分はeffect-borrowing.tsの補助ソースhash1件だけだった。根拠付きsourceCorrectionsと`.codex-temp/exclusion-public-audit-third-repair-rebind.json`へ保持する。raw原本、本文、分類、件数、runtime期待値を変更しない。

caller照合で既存I1のGUI fixtureにも同じvoidカード前提を確認した。各席4コピー・2枚目の回収・未選択札・GUI/RESTの操作方向を維持して合法な除外ゾーンへ直し、既存2ケースを通常scenario gateへ登録する。最終対象は従来107件とこの2件の109件になる。この修正を先に揃えるため、668519の途中gateは所有PID・子の親子関係/生成時刻を照合して自分の検証子processだけを意図的に中断した。ismcts-runtime exit1はこの中断であり、新しいruntime不具合とは扱わない。記録は`.codex-temp/exclusion-cycle3-cancel-ownership.json`と既存harnessログへ保持し、途中runを成功証拠にしない。

再開後の全件Vitestは、観戦者sanitizeの旧fixtureがカードの公開領域にvoidを使っていた1件で失敗した（run1793241287177、他21983成功・7skip）。同じtree0e4580e7のbuild/GUI109件は成功したが、全件gateの成功とは扱わない。01_glossaryのボイドは「コアを置いておく場所」、06_core-systemは除外と別処理とするため、観戦者の5枚/公開ID/秘匿対照を保ったまま除外領域へ直し、helperはCardZoneへ統一する。全ソース再走査で見つけたdomain-eventの「trashにない」対照も除外領域へ直す。01bの公開情報表はコア用ボイドをカード領域から分けて明記し、カードをvoidへ移動できる根拠にしない。正規のコアvoidと故意の不正入力テストは変更しない。この修正後のgate・新独立査読が別に必要である。

検証の成否・run ID・査読・公開SHAは既存harnessログ、verifier証跡、supervisor-report/acceptanceへ記録する。監査表だけで未実施gate・独立査読・公開を完了にしない。今回の残条件は最終gate→新独立査読→verified commit→通常統合・親公開確認。新たな無関係カード監査/ISMCTSへ移らず、失敗時は同じ受入単位を修復する。

