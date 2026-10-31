# engine-drain 最新 main 取込み後の監査再確認（2026-10-03）

信頼度 **C**（確定裁定の現行実装への適用）。カード原文は承認版 provenance を維持し、既存の原文・Q&A・画像根拠を変更しない。

並行更新された `main d0b15dcec` と、その後の `main 9232a0cc3` を lane 内で取り込む。primary の対話 branch・差分は変更しない。
共通 engine/ruling/gate の内容変更で失効した coverage 48件・fidelity 21件を未確認のまま0扱いせず、以下の各主張を再照合した。

## remote main 9ab4e9e29 取込み後の再確認

前回の親統合は通常gateの後、必須fuzzのcore-source allocation入力で失敗しており、main統合済みとは扱わない。今回はremote mainの確定済み3 commitをlane内に競合なく取り込む。primaryの対話branch・専用main tree・既存差分は変更しない。

69件は全face・原文・findingのfingerprint、共通runtime/ruling context、指定回帰の内容が取り込み前と一致した。一方、各回帰が共有する `test/fixtures/reveal-retrieval-audit.json` のBSLH01-C09の `sourceLines` だけが「残ったカードは破棄する」から「残ったカードはデッキの下に戻す」へ変わったため、全件を `testSupport_changed` として再確認する。対象の69 findingにC09はなく、fixture内の他のカード・選択条件・回収数は同一である。

この差分は以下の本文対応表の神託・共有scope・量化反復・合体・転神・導技の主張を変更しない。神託の上3枚を直接トラッシュへ置く処理と、C09のオープン後の残札をデッキ下へ戻す処理は別の本文・consumerである。各記録の具体的な原文/DSLの結論と盤面回帰を維持し、重複排除した32回帰ファイルおよび静的carrierの正例/破損例を再実行する。量化反復のN=0/1/2完走・二巡目以降の更新状態、共有使用制限、スタック終了後のコア/移動先・pending消滅も含む。C09の新しい残札順序とトークン詳細/除外閲覧は、取り込んだ専用GUI/REST回帰と全件必須gateで確認する。

再登録は当該69件だけとし、旧記録のfingerprint/指定回帰一致と、共有supportの変更が上記1ファイルだけであることを照合した比較を `artifacts/full-run-current/main9ab-review-comparison.json` に保存する。承認版ミラー・provenance・baseline除外は変更しない。必須gate・fresh verifier・verified merge commit後、通常の親統合要求へ渡す。前回のfuzz失敗は隠さず、P3-91解消済みのためskipを使わない。

## main 337c2dd41 追加取込み後の再確認

最終査読中に専用mainのownerが対価入力修正 `337c2dd41` を確定したため、ff-only統合の前提としてlaneへ取り込む。ownerの作業、primary、専用mainをworkerが変更するものではない。最初の検証済みmerge commit `44c245364` は保持し、この追加取込みもgate・fresh verifier・verified merge commitを経て親runnerへ渡す。

rules-coreの変更は `player-decision-contract.ts` の `SELFPLAY_AUTO_INPUT_FIELDS` に既存の `coreSourceSoulCoreInstanceId` を列挙する1行だけである。同項目は取込み前から `APPLY_OPTION_FIELD_ROLES` と `ApplyLegalActionOptions` に存在し、`hand-gain-cost.ts` は通常コア配分とソウルコア指定を分けて合計額を検証している。カード本文、DSL、対象選択、共通effect interpreter、CE登録/消費、神託、usage、量化反復、支払いconsumerは変更されていない。取り込むdriverの変更は、その既存入力契約へ `normalAvailable` 以下の通常コアとソウル1個を供給するもので、原文のコストや効果を変えない。新しい3つのfixture回帰は通常のみ・ソウルのみ・併用で実支払いと手札取得の再開後の盤面を確認する。

この取込みで共通contextが変わり、coverage48件・fidelity21件は全件pendingへ戻った。未確認を0扱いせず、69件のface/finding・既存根拠・指定testRefsとsupportが従前と一致すること、上記入力項目の列挙が各本文対応表の結論を変更しないことを再照合する。32参照回帰を新しいtreeで再実行し、各従前の具体的理由を保持したまま現行contextとこの根拠へ再結合する。比較は `artifacts/full-run-current/main337c-review-comparison.json` に保存する。

独立した自動対戦・学習・effect-debug運転は開始しない。必須gate内の通常fixture回帰だけを実行し、P3-91解消済みの通常統合要求を使用する。fuzzの再現seed追加とその修正の既存履歴は取込み元のまま保持し、親runnerが必須merge gateの結果を確認する。

## 変更した実行契約との関係

- [03c](../10_rules/03c_effect-text-interpretation.md) の「効果または任意stepの実行確定後、対象選択で再度辞退できない」に従う固定枚数選択の変更。発揮前の任意性、候補不在、明示的な「まで」の0枚選択は別に維持する。
- `native-action-registry` の discard と search、交換の legal 列挙/適用、`zone-search-candidates` の発揮元指定、対応する card-data の `mandatory:true` を読み直した。旧確認の同名/個体/event制限、コスト基準、量化反復、神託の任意発揮は固定枚数選択の再辞退に依存しない。
- 39対象 face を取込み前の保存値と比較した。BSTS01-C01 のトラッシュからの青ネクサス1枚選択に `mandatory:true` が加わる以外は同一。C01は発揮宣言が任意であり、受諾・窓終了後に配置対象を選ぶ。本文の同名ターン1回と個体ゲーム1回のANDを変更しない。
- それ以外の67 findingは全faceとfinding本文/DSL出力を含む従前fingerprintと一致した。C01の2 findingだけは上記のface変更を含め原文・裁定・最終盤面を再確認した。hashだけを無根拠に更新しない。
- [08d](../10_rules/08d_grandwalker-nexus.md) の「その本文列挙イベントだけに限定し」を各神託/導託の条件・種別・任意性・同名不在・上3枚移動先と照合。受諾/辞退、非印字イベント、相手側、実効系統、窓後のコア/デッキ/トラッシュを参照回帰で確認する。
- [03c](../10_rules/03c_effect-text-interpretation.md) の「基本 1 回に加えて N 回」の反復、[03e](../10_rules/03e_effect-duration-and-repeat-scope.md) の共有scope、[03d](../10_rules/03d_effect-target-and-prerequisite-gates.md) のカード対象耐性を現行consumerと照合。反復N=0/1/2、必須破棄完走、同名別個体/相手独立、期限終了を参照回帰で確認する。
- 真バディ、多重合体、転神、導技、公開時バーストは各構造上の carrier と共通consumerの存続を確認。空effectの存在だけを実行根拠にしない。
- 最新mainの [03a](../10_rules/03a_cost-payment.md) と `getCardUseSourceZone` は使用元ゾーンを召喚イベント・カード自身のコスト適用へ伝搬する。実ゾーンや手札枚数は変更しない。確認対象の原文・face・findingは同一で、印字イベント・系統条件・回数制限・元コストの意味は保持する。手札/手元/トラッシュ起点と通常スタック完走の追加回帰を読む。
- [04b6](../10_rules/04b6_prevention-and-negation.md) の公式Q1479/Q1481/Q1485に従い、解決時の「防げない」と効果自体の無効化耐性を分離する。明示的な無効化耐性だけが無効化を阻止する。BSKB01-C05の同名/個体制限と任意宣言の確認はこの分離と両立し、受諾・応答窓・無効化後の盤面回帰を再実行する。
- [01b](../10_rules/01b_information-visibility.md) と [07e](../10_rules/07e_kanjuden-mechanics.md) の公開デッキ情報は、私的閲覧中のカードを相手へ公開せず、通常ドロー直後に既知位置を同期する。神託/導託・量化反復の移動枚数、各巡のpendingと残札処理を変更しない。公開/私的閲覧・選択・並べ替え・通常ドローの回帰も読み直す。
- 固定 worktree/統合先の運用変更は全件回帰やreview gateを迂回しない。33参照ファイルと最新mainの追加回帰をこの統合treeで実行し、全件必須gateとfresh verifierを取得してからverified merge commitと親統合要求へ進む。

## 再確認対象

各行の具体的な本文・意味・DSL担当・最終盤面と通常gateのtestRefsは、`scripts/fidelity-review-resolutions.json` の同一 cardNo/kind/path の記録に保持する。
本文・face・findingと根拠・回帰・supportの現行内容を束縛した schemaVersion 2 記録だけを新contextへ再登録する。baseline除外、カード番号による免除、古いミラーへの巻戻しは行わない。

|監査|カード|kind|path|
|---|---|---|---|
|coverage|BSDB01-CX01|unaccounted_text_line|textLines[0]|
|coverage|BSDB01-CX01|unaccounted_text_line|textLines[1]|
|coverage|BSKB01-C05|noop_only_effect|effects[2]|
|coverage|BSTH01-XX01|unaccounted_text_line|textLines[3]|
|coverage|BSTH01-XX01|unaccounted_text_line|textLines[4]|
|coverage|BSTH02-X01|unaccounted_text_line|textLines[3]|
|coverage|BSTH02-X01|unaccounted_text_line|textLines[4]|
|coverage|BSTH02.7-CX01|unaccounted_text_line|textLines[0]|
|coverage|BSTH02.7-CX01|unaccounted_text_line|textLines[1]|
|coverage|BSTH02.7-CX01|unaccounted_text_line|textLines[2]|
|coverage|BSTH03-M05|empty_effect_steps|effects[1]|
|coverage|BSTH04-X01|unaccounted_text_line|textLines[3]|
|coverage|BSTH04-X01|unaccounted_text_line|textLines[4]|
|coverage|BSTH04-XX01|unaccounted_text_line|textLines[3]|
|coverage|BSTH04-XX01|unaccounted_text_line|textLines[4]|
|coverage|BSTH05-X01|empty_effect_steps|effects[1]|
|coverage|BSTH05-X01|unaccounted_text_line|textLines[3]|
|coverage|BSTH05-X01|unaccounted_text_line|textLines[4]|
|coverage|BSTH05.5-XX01|unaccounted_text_line|textLines[3]|
|coverage|BSTH07-X01|unaccounted_text_line|textLines[3]|
|coverage|BSTH07-X01|unaccounted_text_line|textLines[4]|
|coverage|BSTH07.8-XX01|unaccounted_text_line|textLines[4]|
|coverage|BSTH08-C05|empty_effect_steps|effects[1]|
|coverage|BSTH08-X01|unaccounted_text_line|textLines[3]|
|coverage|BSTH08-X01|unaccounted_text_line|textLines[4]|
|coverage|BSTH08-XX01|empty_effect_steps|effects[1]|
|coverage|BSTH08-XX01|unaccounted_text_line|textLines[3]|
|coverage|BSTH08-XX01|unaccounted_text_line|textLines[4]|
|coverage|BSTH08.5-X03|unaccounted_text_line|textLines[3]|
|coverage|BSTH08.5-X03|unaccounted_text_line|textLines[4]|
|coverage|BSTH09-M01|empty_effect_steps|effects[0]|
|coverage|BSTH09-M02|empty_effect_steps|effects[1]|
|coverage|BSTH09.2-X01|unaccounted_text_line|textLines[3]|
|coverage|BSTH09.2-X01|unaccounted_text_line|textLines[4]|
|coverage|BSTH09.2-XX01|unaccounted_text_line|textLines[3]|
|coverage|BSTH09.2-XX01|unaccounted_text_line|textLines[4]|
|coverage|BSTH10-X01|unaccounted_text_line|textLines[1]|
|coverage|BSTH10-X01|unaccounted_text_line|textLines[2]|
|coverage|BSTH10-X03|unaccounted_text_line|textLines[1]|
|coverage|BSTH10-X03|unaccounted_text_line|textLines[2]|
|coverage|BSTH10-X04|unaccounted_text_line|textLines[1]|
|coverage|BSTH10-X04|unaccounted_text_line|textLines[2]|
|coverage|BSTH10.5-X01|unaccounted_text_line|textLines[3]|
|coverage|BSTH10.5-X01|unaccounted_text_line|textLines[4]|
|coverage|BSTH10.5-X01|unaccounted_text_line|textLines[8]|
|coverage|BSTH10.5-X01|unaccounted_text_line|textLines[9]|
|coverage|BSTH10.5-X01|unaccounted_text_line|textLines[11]|
|coverage|BSTH10.5-X01|unaccounted_text_line|textLines[12]|
|fidelity|BSAZ01-X02|quantified_effect_repeat_missing|effects[1].steps|
|fidelity|BSRK01-X01|usage_scope_review|effects[0].usageLimit|
|fidelity|BSSL01-C02|usage_scope_review|effects[0].usageLimit|
|fidelity|BSTH001-C03|usage_scope_review|effects[1].usageLimit|
|fidelity|BSTH002-R03|usage_scope_review|effects[2].usageLimit|
|fidelity|BSTH01-C12|usage_scope_review|effects[0].usageLimit|
|fidelity|BSTH01-X02|payment_scope_review|effects[0]|
|fidelity|BSTH01-X02|quantified_effect_repeat_missing|effects[2].steps|
|fidelity|BSTH02.7-CX01|usage_extra_constraint_review|grandwalkerData.divineSkills[0].effects[0].usageLimit|
|fidelity|BSTH02.7-CX01|usage_extra_constraint_review|grandwalkerData.divineSkills[1].effects[0].usageLimit|
|fidelity|BSTH02.7-X03|quantified_effect_repeat_missing|effects[0].steps|
|fidelity|BSTH04-X02|quantified_effect_repeat_missing|effects[0].steps|
|fidelity|BSTH04-XX01|target_cost_scope_review|effects[1]|
|fidelity|BSTH05-X02|usage_scope_review|effects[1].usageLimit|
|fidelity|BSTH06-C03|usage_scope_review|effects[0].usageLimit|
|fidelity|BSTH06-C03|target_cost_scope_review|effects[0]|
|fidelity|BSTH11-C01|usage_scope_review|effects[2].usageLimit|
|fidelity|BSTH11-C02|usage_scope_review|effects[2].usageLimit|
|fidelity|BSTH11-R01|usage_constraint_mismatch|effects[3].usageLimit|
|fidelity|BSTS01-C01|usage_unrecognized_period|effects[1]|
|fidelity|BSTS01-C01|usage_extra_constraint_review|effects[1].usageLimit|

取込み前faceと監査、失効候補、対応回帰の実行結果は `artifacts/full-run-current/` に保存する。
この記録は coverage/fidelity 監査範囲の統合候補確認であり、全機能完了やmain統合済みを意味しない。親runnerが終了コード・ログ・remote main・両treeのfresh監査を確認する。
対象外のAIデバッグ・EDH・checkpointと関連follow-upは未完了のまま保持する。
