# 原文監査の類似検出とフルランへの引継ぎ

[2026-09-13の原文対照監査](fidelity-audit-2026-09-13/README.md)で見つかった不一致を、カード番号に依存しない検出規則へ展開する。対象は現在の全登録カードの表裏・mechanic内効果。過去の手動監査の除外範囲は、機械監査の除外にはしない。

## 判定と限界

| 監査 | 検出する構造・本文との対応 | 判定 |
| --- | --- | --- |
| fidelity / constraint | 同名・個体・グループとターン・ゲーム等の回数制限、複数制限のAND | 一意に対応する矛盾は violation。別手順・条件付き・付与効果との対応は review |
| fidelity / constraint | 支払い済み・無料・固定割引・コスト指定・別途の余分支払い | 明示された方式の矛盾は violation。別効果による補完や対応不明は review |
| fidelity / constraint | 対象数・コスト等の上下限、本文のコスト境界と判定基準 | 静的な下限超過や一意な矛盾は violation。動的・複数対象は review |
| fidelity / flow | 「その後」の成功依存化、任意前段に独立後段を巻き込む条件、公開中処理の移動後実行 | 原文と手順の対応・エンジン挙動の確認が必要な review |
| fidelity / flow | 「N枚破棄／N枚まで破棄」の二択を上限付き単一処理へ縮約 | 一意な縮約は violation。別の分岐表現の可能性は review |
| fidelity / constraint | 「この効果を…につき…回発揮」「追加で発揮」の量化反復を condition / usageLimit だけへ縮約 | count 1につき1回の一意な反復 carrier 欠落は violation。係数・pending 継続の対応不明は review |
| fidelity / flow | 発揮済み期間指定効果の無効化を未解決スタック・将来耐性へ置換、期間を離場までに短縮 | lifecycle の対応は review。単一即時処理の明示期間との矛盾は violation |
| coverage | 不正な effects/steps、action.kind 欠落、明示stub、不正textRef | violation。従来の done 判定を満たしていても gate は失敗 |
| coverage | 全文の帰属漏れ、空steps、noopのみ、参照のない効果 | review。構造化carrierや共通ルールの根拠は既存accountability ledgerを利用 |

`violation` は検出規則が確認できた矛盾、`review` は正誤未確定の候補。いずれも原文・裁定と照合して対応する。回数制限は親と子の効果を別scopeとして扱い、無関係な兄弟の制限で充足させない。文と手順の対応が確定しない場合は、強い断定を避ける。

任意の日本語、別効果との相互作用、pending/retriggerの実行順、実効系統の評価、全候補の探索、元データの固有名誤字などをこの静的監査だけで証明することはできない。手動対照、ルール実行後の盤面回帰、verifier、GUI/REST、fuzzを継続する。帰属済みtextRefやcarrierも意味の正しさの証明ではない。

## 出力契約

- `cards:fidelity --json`: 矛盾は既存 `violations`、候補は `semanticReviews`。`semanticReviewCount` と `reviewRequired` を付与する。各候補にはcardNo、kind、effectPath/path、textRef、本文・期待値・実値等のevidenceを残す。
- `cards:coverage --json`: 従来の `totals.done/todo/vanilla` と `todoCards` は維持。別途 `auditIssues`、`auditViolationCount`、`auditReviewCount` を出す。
- review配列と件数は未確認・失効した候補。確認前総数は `rawSemanticReviewCount` / `rawAuditReviewCount`、有効な確認記録は `confirmedSemanticReviews` / `confirmedAuditReviews` と対応するCountに分離する。rawの根拠も確認済み配列に保持する。
- fidelityの `--gate` はviolations、coverageの `--gate` / `complete` はtodoとaudit violationで判定する。reviewだけではgateを失敗にしないが、フルランでは作業対象として残す。`--set` は指定弾の違反で終了コードを判定する。
- `snapshot` のfidelity残量は `violations.length`。旧4項目の和で新種の検出を落とさない。coverage構造違反と両監査のreview数は別計上する。

## フルランでの処理

既存の `run-supervisor-iteration.ps1` がmain追従後に `lib/supervisor-work-plan.ps1` を呼ぶ。保存JSONやbaselineを流用せず、現在のworktreeでcoverageとfidelityを順に再計測する。

1. todoまたはviolationあり: `implementation-required`。レビュー候補も併せて渡す。
2. reviewのみ: `audit-review-required`。正誤を原文・Q&A・裁定から確定する。
3. JSON破損・実行失敗・件数不整合: `audit-repair-required`。不明を残量0にしない。
4. 全件解消後は必須検証・main統合・両treeの再監査へ進む。AIデバッグは現行フルラン対象外。

監査対象のcardNo・パス・根拠をworker指示に注入する。大量時は種別ごとに先頭20件を示し、CLI全件参照も指示する。現在のengine-drainでカード/共通基盤の修正、回帰、verifier、commit、統合まで進める。無関係なassigned clusterを理由に監査を放置しない。

誤検出だった場合は、正しいDSL表現・carrierを検知器に認識させ、壊れた例と正しい例を両方テストする。静的な曖昧さが残る場合は下記の根拠付き確認記録を使う。カード番号だけの除外や根拠のないbaseline更新で消さない。裁定が未確定ならneeds-rulingへ根拠を残し、候補は未確認のままにする。既存の容量優先処理、supervisor lock、通知、起動停止は変更しない。

### 量化反復の本文対応表（必須）

カード本文に「この効果を…1につき1回発揮できる」「追加で発揮する」等の量化表現がある
修正は、実装・レビュー・verifier の全段で次の対応表を残す。本文の一部だけを実装して
「原文監査完了」と報告してはならない。

| 本文句 | 意味 | DSL / 継続解決の担当 | 反証テスト |
| --- | --- | --- | --- |
| 量化された反復 | count N のとき効果一連を何巡するか（「追加で」は基本1+N、「1につき1回」はN） | `EffectStep.repeat` と pending をまたぐ再開状態 | N=0/1/2 を最終盤面まで解決。N=2 は1巡目の選択・残札処理後、更新済み状態から2巡目が生成・解決されること |
| 回数制限 | 効果全体をいつ何回宣言できるか | effect / step の `usageLimit` | 同名の別個体・別ターンを分けて確認 |
| 対象選択 | 各巡に候補を再取得して選び直すか | action target / deck reveal pick | 同じ対象の重複可否と各巡の候補集合を確認 |
| 後続処理 | 各巡の残札・誘発抑止・配置等を独立に完了するか | action finalizer / continuation | 各巡の最終ゾーン・抑止された/許可された誘発を確認 |

〔ターンに1回：同名〕は効果全体の共有発揮制限であり、量化された内部反復を1巡に
縮約する根拠にはならない。量化表現を `condition` または `usageLimit` だけで充足扱いに
してはならない。pending を作る action は、`repeat` が継続再開できる実経路を確認する。
未対応なら静的に完了扱いにせず review / violation を残す。verifier 証跡にも同じ表と
N=0/1/2 の反証を構造化して入れ、欠落時はcommitをfail-closedにする。

## 確認済み候補の再調査を防ぐ

`scripts/fidelity-review-resolutions.json` は任意の確認記録 `{schemaVersion:1,records:[...]}`。未作成なら全候補が未確認。今回の導入では実候補の確認記録を作らず、フルランで1件ずつ原文と盤面回帰を確認する。

`confirmed_correct` にできるのはreviewだけ。単一faceの全定義・原文・findingをfingerprintへ固定し、repo内の根拠ファイルと通常gate対象の回帰・共通fixtureも内容hashで固定する。rules-core・裁定・共通実行基盤は全確認、選択gate・package scriptの実行条件は該当回帰の確認を失効させる。検知器変更だけでは失効せず、finding変更で再確認する。改行は正規化し、無関係な独立テストやISMCTSの対象拡張子設定では失効させない。record v3への移行とバッチ検証は [監査効率運用](full-run-efficiency.md) を参照。確認をcommitしただけでは失効しない。

手順は、現在の監査JSONと同じカードデータからface JSONを生成し、原文照合と回帰実行を終えてから次を実行する（`N` は確認する1件のindex、`HASH` はreportの `reviewContextFingerprint`）。新規recordはschemaVersion 3で、指定回帰の通常gateへの到達経路も保存する。旧recordは自動変換せず、[失効範囲と移行](full-run-efficiency.md#確認記録の失効範囲)に従い再確認する。

```sh
node scripts/fidelity-review-resolution.mjs --report fidelity-audit.json --collection semanticReviews --index N --face artifacts/review-face.json --context-fingerprint HASH --reason "原文・実装・盤面を比較した具体的な結論" --evidence manual/ai-reference/関連根拠.md --test-ref packages/rules-core/test/対応する回帰.test.ts --out artifacts/review-record.json
```

coverageならreportを `card-coverage.json`、collectionを `auditIssues` にする。`--evidence` / `--test-ref` は複数指定可。出力は単一recordで、既存のregistryを自動上書きしない。レビューしてregistryへ追加し、失効した同一findingの古いrecordは置換する。重複record・根拠欠落・内容不一致・外部参照は解消扱いにしない。

記録生成はテストを実行しない。指定した回帰を通常gateで実行し、verifierとcommitを経て確定させる。これはカード番号の免除ではなく、特定の本文・実装・根拠・回帰に対する確認結果であり、strict violationを消す手段にはならない。

## 回帰テスト

同じ本文条件を複数の性質付与へ分けたBSTH04-XX01と、異なるコスト上限を召喚分岐へ
分けたBSTH06-C03は、[対象コストの再確認](source-findings-target-cost-scope-2026-10-17.md)に
本文・consumer・境界盤面を対応づける。`target-cost-scope-audit.test.ts` は通常gateで実行する。

系統条件付き多重合体のcarrierは「Nつまで合体できる」「Nつまでと合体できる」の両表記を認識する。
数・系統・適用Lvが一致し、本文にない合体条件無視・効果書換・名前別上限がない場合だけ帰属する。
`test-fidelity-coverage.mjs` の正例/破損例と `bsth02-x04-multi-brave-combine.test.ts` の
実カード盤面回帰で、上限拡張とincomingブレイヴ自身の合体条件を区別する。

BSTH03-M05 の複合的な合体許可は、容量・条件無視・即時/誘発書換だけの緑では帰属済みにしない。
2026-10-19のユーザー本文訂正により必須継続書換となり、旧選択仕様の裁定待ちは解消。原文と回帰は
[継続書換の原文監査](source-findings-bsth03-m05-continuous-rewrite-2026-10-16.md)へ。
`test-fidelity-coverage.mjs` は、この複合宣言が引き続き review に残ることも検証する。

系統効果によるデッキオープンからの任意バーストセットは、原因系統のOR集合・デッキ起点・
自分の空き枠・同じ本文の `set_as_burst` disposition を一組で照合する。
BSTH09-M01 の本文は承認ミラー（id:239）と画像を照合（2026-10-16、本文A）。
`bsth09-cards.test.ts` の受理/辞退・原因系統・自分/相手の既存バーストの盤面回帰で、
残札処理後の最終ゾーン・セット数・手札非経由を確認する。
同時公開の空き枠競合は `bsth09-m01-revealed-burst-slot.test.ts` で不正な二重選択・
保存復元・AI入力・所有者への選択移譲と元効果への復帰を確認する。
`scenario-revealed-burst-slot.spec.ts` はAlice GUI/Bob RESTで同じ実行経路と不正選択拒否を通す。
混在するC21の原因プレイヤー限定・導界者へのコア配置は
[公開カードの原文照合](source-findings-revealed-owner-2026-10-17.md)と両所有者の8盤面回帰で確認する。
セット本文を `swap` へ壊した定義は、入替本文を持たないためswap carrierでも帰属させない。

`pnpm test:fidelity-audit` は通常の `pnpm test` に含まれる。制約・制御フロー・coverageの正例/反例に加え、実CLIをfixtureで実行して表裏・mechanic帰属、gateとreviewの分離、弾別判定、ASCII JSON、snapshot残量を検証する。`pnpm test:supervisor-handoff` 内の `test-supervisor-work-plan.mjs` は実PowerShell dispatcherで修正/確認/修復への経路と根拠の引継ぎを検証する。
