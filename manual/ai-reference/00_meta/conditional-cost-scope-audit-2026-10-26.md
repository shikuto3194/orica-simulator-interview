# 「ことで」の任意範囲と対価の全面再監査

## 対象と根拠

- 依頼: `followup-897eec4d6ca0d8447f1e`、受付原本 `629905113.json`（添付なし）。
- 調査基点: `4c8c083c5cc831f14b0637e57ef4031923af2c00`。この基点からの修正treeを新たに走査する。2026-09-26台帳の合格判定は再利用しない。
- 解釈の正源: [03c「ことで」構文](../10_rules/03c_effect-text-interpretation.md)。構文全体が任意で、結果不能時は対価だけを実行できない。
- 信頼度: 本文A（現行共有ミラー `external-qa/cardData.js` と `audit-mirror-provenance.json` の承認済み版を照合）、実装・試験の対応C。本文・出典hashは変更していない。

## 新しい静的台帳

`node scripts/audit-conditional-cost.mjs` は実行時に現行カード定義をbundleし、
`scripts/conditional-cost-scope-review.json` の本文hash・本文行・全effect path・句数を照合する。
各句にはcarrier、任意性の実フィールドと期待値、条件接続、例外理由を記録した。
`conditional_cost` の存在だけでは合格しない。未分類、新規/変更本文、任意scope欠落、帰属変更、古い行の残存は失敗する。
effect全体の分類では対応effectの `executionMode:"optional"` を必須とし、stepだけの任意性では代用できない。
説明・引用の免除は実行effectへ帰属した行には許可しない。
同一面の対応effectだけがscopeを証明でき、部分構文では対応step配下のproofを必須とする。全帰属effectの被覆を検査し、独立した常時/前段/空markerの8件だけは理由と効果構造全体を固定した例外を出力する。例外の変更・重複・対価本文の免除は失敗する。
部分構文では任意性を表すDSL上の役割と対価との接続を検査する。対価stepの任意性、合体へ対象を渡す任意選択、任意反復、基礎分と追加分を選べる可変カウント、支払いを選ばない別分岐を区別する。単なるaction.kind・数値・固定量・対価につながらない同一effect内の任意stepはproofへ代用できない。
効果全体は最初の対価とその依存結果の接続を必須とする。後段にある別句のconditional_costや空contractでは代用できない。部分構文も任意carrierの直後の接続を固定する。
C06/TX02(B)の独立した「その後」は対価辞退後も進めるため部分構文へ分類し、root任意性だけで合格させない。

| 項目 | 今回の件数 |
| --- | ---: |
| カード / 面 | 594 / 648 |
| 「ことで」の本文行 / 出現箇所 | 221 / 224 |
| 効果全体 | 119行 / 119句 |
| 独立した前段を持つ部分構文 | 21行 / 24句 |
| 専用carrier | 81行 / 81句 |
| 効果本文ではない説明・引用 | 0行 / 0句 |
| 未分類 / scope欠落 | 0 / 0 |
| 条件接続 / 修正カード | 158 / 67 |

3行には2句があるため行分類は先頭句で集計し、句別集計も別に出力する。
専用carrierには煌臨・契約合体・顕現・通常行動の宣言/支払い・公開中選択・支払い済み修飾等を含む。
引用された獲得効果も実行本文なら任意scopeを検査する。
JSON成果物 `artifacts/conditional-cost-audit.json` は実行時の `targetHead`、基点HEAD、カード定義・台帳のdigest、全分類・全修正カードを保持する。
コミット前の `targetHead` は基点HEADであり、修正内容の同一性は `sourceDigest` とharnessのsource treeで照合する。

## 修正内容

67面の正確な一覧とeffect pathは上記台帳・成果物を正源とする。
当初59カードの全体scopeと、BSTH02-X02・BSTH08.5-X01/X02の必須前段後の任意stepを修復した。独立査読後、既存対象を含む追加の対価接続・選択・本体解決も修復した。
魔界 `BSTH002-転醒R01(A).effects[2]` は全体が任意であり、実行宣言後の手札選択は必須。

- 誘発の発揮可能性を既存の双方向条件判定へ接続し、手札0枚・デッキ0枚では辞退のみ提示する。表示中の任意効果は自動drainせず明示的な辞退を残す。
- 入力待ちの継続に対価直前snapshotを保存し、結果失敗時は対価を復元する。snapshotは所有者・相手・観戦者の配送から除去する。
- 連続した条件結果は最初の対価snapshotを共有する。独立した前段は、後段の辞退/失敗で巻き戻さない。
- BSTH01-C12は赤/紫シンボル2個を一つの条件結果にまとめ、BSGE01-TX04(B)は中間修飾だけで対価を確定しない。
- BSTH08.5-X01/X02は合体後の回復も条件結果とし、回復不能時に合体だけ実行しない。

## 独立査読の反証と修復

初回候補の全gateが緑でも独立査読は6件を反証した。全件を採用し、初回候補の緑は修正後の受入に流用しない。

| 対象 | 反証 | 修復・実行回帰 |
| --- | --- | --- |
| BSAZ01-C03 | 除外1枚でどの段階結果も成立しないのに除外が残る | 最初の段階結果へ条件接続し、代替結果全体で成功を判定。1枚・バトル外2枚は返却、バトル中2枚は終了時結果を登録 |
| BSLH01-M01 | 有料1/2分岐が相手0体でもコアだけ払う | 全有料結果を同じ対価に結び、1/2の空結果を返金、3の自分回収成立は維持 |
| BSSA01-C03 | デッキ0枚でも手札を破棄する | 破棄を任意step、追加ドローを条件結果とする。0枚は対価辞退後の任意基本ドロー。独立カウントだけの選択も保持 |
| BSES01-C03 | 2コア必要な対価を1コアだけで実行する | 免疫登録を条件結果へ接続し、実印字のレーナ/ジャガーノート資格を満たす盤面で1個不足・2個成功・辞退を検査 |
| BSTH01-X05 | 維持コア0でも宣言だけで無効化する | 宣言時の先取りを除去。応答窓後の維持コアと召喚成功後に無効化し、窓中に最後のコアを失う場合は召喚も無効化もしない |
| BSSA01-転醒X03(A) | 青薔薇の剣0枚・別名の剣だけでも反転する | 合体中の指定名ブレイヴ1枚を正確に煌臨元へ置く対価と転醒を接続。コア返却・合体解除・battle entity再計算も共通経路を通す |

同じ確認でBSDB01-M02の技術的な自己残留だけが対価失敗後に残る不具合を再現し、自己残留→自己回収→ライフ増加を一つの条件列として復元した。辞退・成功・結果不能時の元の離脱待機保持を検査する。
咲夜2枚の自然な同時宣言では、1枚目の解決済み無効化が2枚目の判定まで遅延して重複召喚した。本文完了後に無効化を適用してから次の可否を再評価し、召喚1枚・維持コア1個・無効化1回・2枚目手札・全pending終端を検査する。宣言時の先取りへ戻さない。

## 復旧候補の新しい独立査読

ca21bbfa候補は全26gateとGUI/REST87件に成功したが、新しい独立査読が3件を反証した。全件を採用し、修正後は新しいtreeで同じ必須gateと独立査読へ戻す。

| 対象 | 反証 | 修復と回帰 |
| --- | --- | --- |
| BSAZ01-C03 / 表示継続 | バトル終了時deferralのrestoredStepContextに完全な対価snapshotが残り、所有者・相手・観戦者へ秘密カードを配送した | 既存の共通context sanitizerへdeferralを接続。借用対象・コア源・redirectの継続も同じ境界へ接続。実C03のdefer登録と、構造fixtureの3carrierをcore sanitizerと本番prepareRoomViewerStateで実行し、権威stateを変更せず全viewerで秘密を除去する |
| BSTH002-R02 | 固定2枚のデッキ対価を1枚だけで払えて残留した | 既存move_cardのrequireFullCountを使用し、本文の2枚と共に静的contractへ固定。実定義・leave_field登録・合法応答を通してデッキ0/1枚は元の破壊を継続、2枚は2枚支払い残留する |
| BSTH02-R01/R02/R03 | 先頭stepのconnectorもconditional_costのため対価前snapshotを保存できず、JSON継続後に破棄だけが残った | 先頭に前段がない場合も汎用snapshot取得を開始。3カードそれぞれの保存後失敗/成功と、召喚誘発への相手の合法マジック応答を実行。応答で捨てられた最後のデッキと応答マジックは維持し、後から払った手札だけを復元する |

追加の実行回帰は `conditional-cost-resume-boundaries.test.ts` 12件と `apps/playground-web/test/conditional-cost-deferral-privacy.test.ts` 5件。修正前は秘密配送4件と3カードの保存/応答後失敗6件を再現した。R02は独立査読の実行再現を採用し、回帰の最終盤面で0/1/2枚を検査する。legal actionのskipOnlyが存在すること自体は受入条件にしない。
表示carrierの3fixtureは各入力を自然発生させた試験ではなく、実際のC03が作ったsnapshotを各型の継続へ格納する配送境界試験である。本番room投影の関数実行は、実JWT・実ネットワークroomの受入とは区別する。

復旧tree `691d1b1e` の全件gateは `game-api.test.ts` 29件で失敗した。新しいdeferral投影が当該項目のない既存stateを受け取ると例外になり、SSEも配信できなかった。既存の任意配列と同じ空配列の既定を適用し、項目欠落状態のJSON保存復元後も全viewer・両投影関数で秘密情報を除去し、権威stateを変更しない回帰を追加した。この失敗runを成功へ読み替えず、修正treeで全必須gateを再実行する。

検討した `BSSA01-転醒X03(A)` の `cardName.contains` は維持した。本文は「合体している『青薔薇の剣』1つ」で明示的な「カード名：」ではなく、`10_rules/05_brave-and-attack-special-cases.md` の名前参照規則に従う。指定名・合体中・正確に1枚の対価を既存回帰で検査するため、根拠のない完全一致への変更は行わない。

## 検証範囲と再実行

### 固定評価入力の再確認

必須runtime回帰は、変更カードを含む固定デッキの旧定義hashを正しく拒否した。
基点HEADのcard-data全体をGitから読み直すesbuild loaderで旧定義を再構成し、固定8件の旧hashをすべて再現した。
現在の通常validatorを通し、lookup上の14カード（内包B面を含む）の差分を列挙し、全67面の定義差分台帳と照合した。
動魔・CB・紅魔郷・ユウ・86・花映塚の6件の定義hashとmanifest結合だけを更新し、残り2件を維持した。
カード列・順序・seed・保存元・選定理由・profileは同一性を検査した。
旧manifest結合 `838552a2` → 新結合 `d795be5d`。比較の全文は `artifacts/conditional-fixed-input-rebind.json`。
これは入力の再結合であり、既存の実戦・校正・配備receiptの再承認ではない。

### 受入の分担

静的監査、効果payload実行、自然な配置経路、GUI/REST受入、公開採用は別の証拠である。

- `scripts/test-conditional-cost-scope-audit.mjs`: 4分類と欠落/無関係scope/別階層/本文変更/新規行/帰属変更を反証。`test:fidelity-audit` はこの回帰と現行データの監査CLIを実行する。
- `conditional-cost-scope-cards.test.ts`: 59カードそれぞれ辞退・実行・結果不成立。印字payloadを共通の配置時hostに接続して範囲を試験するため、元カードの発揮資格・タイミングの受入とは区別する。
- 結果に対象不足がない9カードは宣言済み効果の無効化で不成立を試験する。対象不足の代用とは扱わない。
- `bsth02-x02-attack-divine-release.test.ts` と `bsth08-5-x01-x02-brave-combine-from-set-aside.test.ts`: 残る3カードの実定義で辞退・実行・結果不能と必須前段の保持。
- `makai-conditional-cost-optionality.test.ts`: 実際の `place_nexus` →スタック→配置→誘発。両所有者で通常辞退/実行・手札0・デッキ0、カード・使用回数・pendingを検査。
- `conditional-cost-adversarial-bindings.test.ts`: 上表6件とBSDB01-M02の25回帰。既存の咲夜P3-110/P3-86回帰は応答窓後の維持コアと2枚目不発を完走する。
- `transmute-fold-advent-source.test.ts`: X03の印字効果を実行し、対価の煌臨元化、ブレイヴのコア保存とbattle entity再計算を確認する。
- `conditional-cost-snapshot-continuation.test.ts`: JSON保存後の手札選択・対価復元、独立前段、全viewerのsnapshot秘匿。
- GUI/REST: `?scenario=makai-conditional-cost`、`mode=execute/decline/empty-hand/empty-deck`、`owner=alice/bob`。Aliceの実GUIとBobのRESTで実配置後に選択し、通常時の両ボタン・不能時の辞退のみ・手札選択を確認する。

必須gateは `pnpm codex:finish-check`（rules-coreの `tsc --noEmit`、全件回帰、fidelity回帰、本文帰属台帳を含む）、`pnpm cards:fidelity --gate`、`pnpm cards:test-coverage --gate` と `pnpm verify:scenario`。
成功ログ・assertionは `logs/harness/runs/` から受付IDの `record-acceptance` に登録する。
workerはverified commit後に親runnerへ統合を要求し、公開main包含を確認するまで依頼はpendingを保持する。
この受入単位の完了を、ISMCTS配備・72時間運転・強さの実証へ読み替えない。

### 公開経路台帳と既存回帰の再照合

公開経路raw台帳は埋込generatorを現行コードで全文再実行した。旧24カードmodule hashとsanitizerの旧bindingを基点HEADからすべて再現し、648面/152本文行/14借用action/12例外と実行時公開証拠を再生成した。BSSA01-C03のref_countと転醒X03(A)のmove_card/filter追加だけを構造上の変更として列挙し、他の非hash値と公開runtime証拠の深い一致を確認した。再結合の証拠は `artifacts/conditional-public-audit-rebind.json`。原本本文は変更していない。
公開回収台帳の7件は効果全体を任意にしたscopeを記録する。発揮後のpickは必須のままである。
C03の本文は手札へ正確に1枚戻す対価構文であり、別の回収税を拒否して結果が禁止された場合は03c/03d2に従い本文の対価も復元する。M03の「2枚まで」と区別する。「まで」が0枚を許す点は[公式FAQ Q7274](https://www.battlespirits.com/faq/list.php?format=eternal&prodname=BS44)を確認したが、回収税の個別裁定そのものをこのFAQから主張しない。

### 中断復旧後の全件反証

復旧後のfinishは全件Vitestで4ファイル20件の失敗を検出した。旧成功には戻さず、同じ受入単位で修復した。
借用フラッシュの咲夜は維持コア選択を完了してから無効化を確認する。作戦の連鎖は青薔薇を煌臨元に置く対価選択を先に解決し、元の後続順と最終盤面を維持する。キリトの巻き戻し16条件は追加対価を辞退し、独立した基本ドローを明示的に選ぶ。いずれも元の盤面期待値は変更しない。
学習の応答root回帰は、traceで3回目のnoopが元のアタック終了後の別ターンにあると確認した。元のアタック内の2回と、先行M01が再び合法になる順を検査する。別ターンの合法行動を同じrootの循環に含めない。4ファイル50件の単体確認後、通常の最終gateと新しい独立査読へ戻す。

カード対応率の全件診断では594件中54件を欠落と誤検出した。参照側の正規表現が`(A)/(B)`を落とし、差分側も面付き宣言を取りこぼしていた。宣言の列挙を既存verifierの正源へ集約し、両側で面を保持する。名前・本文のない宣言も列挙し、B面・裸番号をA面の直接参照に代用しない正例/反例をverifier回帰に追加した。修正後の全件CLIは594/594・欠落0。これは参照の存在検査であり、上記の意味・実行・GUI受入を代替しない。

## 2026-10-27の独立再査読

候補`23601e0d`は全26gate・GUI/REST87件に成功したが、独立査読（全81ファイル・67面・221行224句）が2件を反証した。

- R21の既存相手限定を、所有者無指定の本文と公式Q24495に従い`either`へ修復。台帳contractも固定する（基点からの不具合）。
- `bsth01-r21-conditional-cost-targets.test.ts`は両所有者の自軍スピリット/アルティメットのみ・相手のみ・双方選択を実field-effect/応答で確認する。パスによる辞退と、結果不能の強制payloadでの疲労返却も検査。修正前10件失敗→修正後14件成功。共通payload試験でもR21のhostは印字ネクサスを保つ。
- `r21-conditional-cost`は実カードで自軍だけが適格な盤面を作る。Alice GUI/Bob RESTの実行・辞退を既存local bridgeで確認し、実JWTルーム受入とは区別する。対象確定は応答後に検査する。
- raw台帳はnullish既定追加前のhashだった。全generator・Git旧hashを再現して再結合し、既述の2構造差分以外の非hash値とruntimeは一致。秘密漏洩の再現とは区別する。

R21後も旧固定8件をGitから再現し通常validatorを通した。定義結合6件だけを更新し、カード列・seed・保存元・profileを保持。`574551ca`→`d795be5d`は実戦・校正・配備の受入ではない。

[R21継続回帰の追補](conditional-cost-r21-continuation.md)。
