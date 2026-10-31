# フルランの監査入力・確認の再利用・実績計測

運用正源は [CLAUDE.md](../../../CLAUDE.md)、停止条件は
[full-run-supervisor](../30_plan/full-run-supervisor.md)。監査残件を隠して0にする仕組みではない。

## 共通の監査入力

`scripts/audit-inputs.mjs` は Git common directory からprimaryを求め、全worktreeの
fidelity監査がprimaryの `external-qa/cardData.js` を読む。古いlane内コピーへfallbackしない。
reportの `auditInputs.mirror` に存在状態と内容hashを残す。破損は監査エラー、欠落は
supervisorの計測修復対象となる。完了判定はlane/mainの両方が0で、同じ入力hashであることも確認する。
通常のミラー未配置環境の監査CLIは欠落を明示して動作するが、フルラン完了の根拠にはできない。

存在するミラーにはcheckoutの `scripts/audit-mirror-provenance.json` の版承認を必須とする。
配布元revision・取得path・確認日・根拠文書と正規化内容hashを記録し、版不一致は監査を失敗させる。
入力hashはミラーと版承認の両方を含む。更新時は配布元の差分・訂正履歴・必要な画像/裁定を確認し、
共有ミラーとprovenanceを同時に更新する。実装から正源を生成したり、hashだけを自動承認したりしない。
2026-09-29の再照合は [source-review-2026-09-29](source-review-2026-09-29.md)。

確認用hashはUTF-8テキストのCRLFをLFへ正規化する。バイナリ・不正UTF-8はbytesを保持する。
Gitの改行変換だけでは失効せず、内容変更は検出する。

## 確認記録の失効範囲

registryのschemaは1を維持し、新規recordはschemaVersion 3とする。

- 全face・原文・findingの内容を固定する。検知器のコード変更だけでは失効させず、検出結果が変われば再確認する。
- 共通contextは `rules-core/src/runtime.ts` の推移的な相対import/export（型も含む）、ルール文書、裁定、依存・module設定、確認処理と共通gate runnerを固定する。使用primitive変更は全確認を失効させる。動的loader・未知alias・未解決importはcore全体へ戻す。AIだけの非依存module変更では失効しない。
- `testExecution` は指定回帰ごとに、通常の `test` 入口から到達するpackage scriptと選択gateの契約を固定する。Vitest設定・起動wrapperも全回帰に拘束する（scriptから子プロセス起動する現行経路があり、拡張子だけで非依存と推定しない）。前後処理hook付き経路、補助commandやpnpm参照を混ぜた `&&` 列は間接依存を証明できないため受理しない。pnpm参照は単独のliteral aliasだけを追跡し、循環を拒否する。gate削除・引数による絞り込み・解釈できないcommandは未確認に戻す。
- `gate-manifest.json` 全体や `package.json` の無関係なscriptを共通contextへ入れない。finish/pushの対象拡張子・無関係なISMCTS gate/運用commandの変更は確認を失効させない。通常gateへの到達性と選択契約はその都度読み直すため、検証設定の単純除外ではない。
- 各recordの根拠文書・指定回帰・importされる共通helperとtestディレクトリのデータfixtureを固定する。動的loaderや未知の外部moduleを使う回帰は共通helper全体も固定する。
  literalな相対importを辿り、別のテストをimportする場合も含める。テストがruntime外のcoreを参照する場合も推移的依存を固定する。公開index/alias経由はAIを含む広い拘束を維持する。独立した意味回帰はruntimeを直接参照できるが、必要な依存を消してはならない。無関係な独立テストの追加・変更は失効理由にしない。
- 古いschemaVersion 1/2 recordは `legacy_context` として未確認に戻す。旧contextは全体hashだけで回帰別の実行契約を保持しておらず、新契約との互換性を証明できない。旧根拠・理由・回帰・進行中workerの記録は保持し、明示的な再確認後に1件ずつ新形式を生成する。hashの自動更新・一括承認は行わない。
- runtime依存契約の切替でも旧recordのhashは自動更新しない。既存の未確認候補は明示的な再確認を待つ。
- violationは確認記録で消えない。記録破損・根拠欠落・依存解決失敗は未確認のままとする。

原文確認・記録生成の手順は [fidelity-detection](fidelity-detection.md)。

## バッチと検証

受入単位は「親目標の最大阻害を解消して、指定の対戦/実行経路を通し、必要証跡を公開mainへ統合する」まで。
同じ阻害を解く候補内だけで、直前の層→共有基盤→小さい完了単位の順に選ぶ。
冒頭に親目標・全受入条件・最大阻害・今回の反証実験を記録し、終わりに通過経路・残条件・次の実験を更新する。
commit数、確認件数、基盤の部品数を成果にしない。難題から小仕事へ移る場合は、試行結果・反証・外部待ちと移動先の有用性を既存task/follow-upへ残す。
反証なしに小分けの計測追加とreceipt再採取を反復しない。共通化は現在の阻害を解く最小範囲とし、workerが既存機構で処理できる判断に新gateを足さない。
未解決の外部裁定待ちは未完のまま理由・再開条件を記録し、独立の有益な作業を続ける。

I0はE1/R1-budgetの部品完成と、R1-runtime・固定8デッキ・実機校正を含む親受入を区別する。
controller/budget回帰とWindows runtime回帰は別gateで実行し、full/merge/CIでは両方を1回ずつ通す。
telemetryだけの小変更は専用の実機回帰へ絞る。fullのruntime gateにも同じ回帰を含み、限定成功を全runtime成功には使わない。
既知の独立telemetry実装・専用回帰・仕様だけの変更はE1/R1-budgetを失効させない。共有資源・budget・controller・gate契約、未知の新規入力は保守的に失効する。
旧receiptを書き換えて新scopeへ移さず、一度新contractで確認した後は同じ親受入単位の実装を先に終えてから最終証跡を採る。

Telegram依頼は初回を優先し、長期目標は既存programの今回完了させる受入単位・残条件・次実験を既存taskに記録する。
未完のまま正常終了した依頼の次枠は、fresh監査に残件があれば最大1バッチを割り当て、その後依頼を継続する。
既存follow-up activityへ `auditServedForRunId` を記録するのは監査workerのthread開始時だけ。起動失敗では枠を消費せず、依頼自体を閉じない。
新規依頼の初回、基盤修復、失敗した依頼の修復、dirty成果の復旧は従来の優先順位を保つ。監査枠の消費は確認完了件数ではない。

wrapperは未着手reviewを再確認より先に並べ、同種を隣接させた最大20件を渡す。
各候補は個別に原文・実装・盤面を照合し、確定した分をまとめて検証・verifier・commit・統合する。
途中で必要になった実装修正を優先し、未確認の残りを確認済み扱いにしない。

`fidelity-review-resolutions.json`、`fidelity-baseline.json`、`02_detailed-todo.md`
だけのmergeはformat/docs・fidelity回帰・`verify-review-batch.mjs`で検証する。
review-batch gateは基点から変わったrecordがfresh監査で有効なことを確認し、紐づく回帰ファイルを
重複排除して実行する。無効・旧形式recordは失敗する。既存の未確認候補を勝手に承認しない。
この範囲はfuzzを追加しない。verifierの完全diff・tree照合は維持する。
確認記録と他のファイルが混ざるfinish/push、上記3ファイル以外を含むmergeは従来の全検証へ戻す。
これにより確認schema移行時は旧記録を未確認へ戻したまま、全回帰で移行を検証できる。
差分取得前に比較元をSHAへ固定し、gateにも同じSHAを渡す。再利用は比較元commitも一致する場合だけ許可する。CIも従来どおり全検証する。

workerは `pnpm codex:finish-check --plan` → `pnpm codex:finish-check` を1回実行する。
その前に同じ全件test/checkを重複して実行しない。修正中の絞り込み回帰は必要に応じて行う。

反証対応は同じroundの全指摘を列挙し、関連回帰で再現・修正をまとめてから最終finishへ進む。
format・Snapshot・台帳更新などtreeを変える処理は先に終える。基点SHAと最終gate runを記録し、
成功後の`spawn-verifier`が出すheadTree・完全diffを固定して独立査読へ渡す。査読中は編集しない。
追加反証が出た場合も全指摘を関連回帰で解消してから必要範囲のfinishを実行し、新しいtreeを再査読する。
検証後の変更・失敗・未確認範囲は既存契約どおり成功証跡を失効させる。最終gate、独立査読、
refute 0、commit tree照合、通常pre-push・merge・CIの必須検査は省略しない。

merge/pushは同一checkoutのsource・依存・環境・必要な比較範囲が一致する成功gateを再利用する。
後発の失敗、途中終了、絞り込みVitestは全件成功の代用にしない。 gate実行前の正規wait記録は受入を失効させず、実行済み・不正なwait記録は除外しない。通常finishも同じ成功履歴を再利用し、`--fresh`・full・CIはfresh。配送IDと既知LLM起動設定は通常検証・受付で共通に除外し、未知設定・データroot・計算設定は保持する。
auto-mergeはmainへff-onlyした後、両HEADとclean状態を照合して検証済みlaneから通常のpre-pushを通す。
handoffとISMCTS controller/budgetの専用fixtureは、ゲーム本体を実行しないため別の入力照合を持つ。
`packages/{rules-core,card-data}/{src,test}/**.ts` と監査確認記録・baseline・02 Snapshotは非入力として除く。新しいゲーム回帰の追加も許容し、それ以外のパス・mode・内容・全script・設定・外部入力・環境は固定する。
他のgate、特に実ゲームを使うISMCTS runtimeとVitestには適用しない。scopeを変更するときはfixtureの実入力と回帰も確認する。
新しい受入receiptには従来どおりfreshな実行が必要。再開finishは元のfresh receiptを保持し、再利用だけから受入を作らない。
別worktreeへreceiptを移植したり、fingerprintからrootを除いたりしない。fuzzの一時環境変数も復元する。
共有ミラーとregistryが引用するGit管理外の根拠も検証fingerprintへ含め、入力変更で失効させる。
カードテスト対応率gateは比較元をSHAへ固定し、main基点の変化で再検証する。mainに依存するledgerは常に再実行する。

`logs/harness/runs/` は実行中gate・各gateのstdout/stderr log・実終了コードを逐次保存する。
supervisor統合は `logs/supervisor-integrations/<runId>.json` とattemptごとのlogに要求HEAD、worker終了、公開状態、出力、remote HEADを保持する。
worker CLIが終了しても親runnerは統合を待つ。公開要求なしは`worker_completed`、資源待ちは`publication_pending`、公開確認後だけ`completed`とする。
workerが未完了treeを残して終了した場合は、両lane lock保持中にbundle・binary diff・未追跡ファイル・index/tree・査読/gate控えを保存する。
次runは旧owner終了・同一tree/index・退避hash・検証leaseを照合し、完全一致だけ同期を保留して元の受入単位を復旧workerへ渡す。
成果の同一性は指示の鮮度を保証しない。dispatch直前に既存受付原文・未解決queue・main/origin/mainを再照合し、照合中の追加は読み直す。
関連する新バグ・方針訂正は親目標と受入条件を更新し、既に公開済みの修正は重複実装しない。無関係な依頼はFIFOへ残し、緊急/依存による順番変更は根拠を記録する。
受付は実行中も続くため、編集前・受入登録前にも全文と更新を確認する。旧IDの解消済み判定とexpectedDigest付き受入照合を維持し、条件変更を旧証跡で閉じない。
不明なdirty、変更された退避、Git操作中、生存ownerは引き継がず保全する。モデル容量不足を成功扱いせず、lock・設定・gateを緩めない。
再起動時は既存supervisor/card-impl lock内で旧owner・childの終了を確認し、remote包含を先に調べる。
公開済みなら旧失敗理由を残して解消し、pushを重複させない。未公開でworker成功・同じclean HEADを確認できる場合だけ既存公開処理を再開する。
検証leaseの生存owner待ち・終了ownerはexit 75として区別し、待機中は新workerと追加の長時間waiterを起動しない。不明owner・破損・読取不能・テスト失敗は同じ扱いにしない。
候補や根拠が変われば成功を引き継がず、再確認へ戻す。LLM利用上限は新workerと新しい独立査読を抑制し、既存公開の照合や有効査読付き候補の公開を妨げない。
反復障害は既存follow-up queueの同じincidentに集約し、初回・30分・1時間・2時間以降の倍増間隔で通知する。解消後は閉じ、再発は新しい経過時間で扱う。
9/29の障害証跡と、worker終了後もpre-pushの結果を待つ回帰は
[原因と再発防止](full-run-incident-2026-09-29.md) に記録する。

検証の資源予算は既存の共有lease・Vitest最大2forkを維持する。AI常駐計算の1探索/2CPU thread上限と合わせて共有PCを保護する。
並列数の緩和を速度改善の根拠にしない。比較は同じ候補・同じ予算で、fresh実行時間と再利用時間を分ける。

## 実績と時間

`worker-codex-stream.mjs` はsupervisorのrunごとに `logs/supervisor-runs/<id>.json` を保存する。
開始・終了時の監査、thread、親workerのusage、経過時間、変更ファイル、検証時間とlease待機時間を保持する。
worker終了コードと公開状態は分離する。正常な未統合HEADは計測失敗ではなく、変更ファイルを保持した未統合実績として数える。
待機失敗もharness履歴に記録する。通知の「完了」を修正成功件数と読み替えない。

```sh
node scripts/supervisor-run-metrics.mjs --since 2026-09-29
```

- `firstReviews` / `revalidations`: local mainに統合済み・clean・正常終了したrunの新規確認／再確認。同じ候補の根拠・回帰・contextを更新した場合も再確認に数える。
- `candidatesRemoved`: detector改善等で候補自体が消えた件数。バグ修正件数ではない。
- `productChangeRuns` / `detectorChangeRuns`: 該当ファイルの変更を含むrun数。並行main追随を含み得るので不具合件数とは区別する。
- `reopened`: 確認済みから未確認に戻った件数。`unlandedRuns`は未統合／dirty、`incompleteMeasurements`は計測不能。
- `publicationWaitRuns`: worker成功・公開waiting・runがpublication_pending・exit 75の全条件が揃った終了run数。`failed`から分けるが、現在の未公開要求数ではない。条件不一致・旧記録の非0終了は失敗件数に残す。
- healthは現在のrunnerに結び付いた完了ticketから公開結果を判定する。再開後に次workerが利用上限で待機していても、worker履歴の`publication_pending`と現在の公開完了を区別し、包含照合時刻を新規公開時刻にしない。
- 経過・検証・待機時間はwall time。usageは親workerの報告値で、sub-agent込みの請求額ではない。

監査reportは実行前後で一致するcheckout・registry・共有ミラーの内容hashを保存する。
進捗出力の02 Snapshotとfidelity-baselineはhash対象外。worker固有の環境変数も除き、実ファイル・依存情報を照合する。
終了treeに一致する監査が無い場合は未知として記録し、0件成功を補完しない。旧runのusageや待機時間を推定して埋めず、旧schemaの成果計測も成功数へ加算しない。

根本修正では、要求された成果と観測可能な基準を先に整理し、既存run ID・対象版を軸に
変更前の失敗、同類を調べた範囲と検索条件、共通層の修正、実行した回帰を既存の証跡で対応づける。
公開後は実際に読み込まれた稼働版と成果を観測し、remote包含や型の正しさだけで要求達成としない。
未観測の範囲は未完了として報告する。方針の共通DBや全タスク用hookへの新しい依存は追加せず、
本リポジトリのタスク文書・既存harness・公開記録の範囲で扱う。

scope: Existing effect/battle/stack/play: style+types+all Vitest+put+fidelity+ISMCTS-runtime; card-data: +ledger+card-tests. Registered E2E: specific spec; public-build: build+public-build. New/unknown/dynamic modules, runtime/API/exports/config/dependencies, unregistered E2E: full. Game merges retain fuzz200 and existing receipt/review requirements.

auto-merge fuzz200はゲーム実装・未知変更で必須。既知運用変更はゲーム入力不変なら省略。plan欠落時は実行。査読・CI/full・receipt identityは維持。
