# I0 controller と共有予算の入口

I0は分割実装中。controller/証跡検査/予算ライブラリのcommitを統合しても、
OS制御・固定8デッキ・実ゲーム校正を完了したことにはならない。
`R1-runtime`と`calibration`のgateは未登録であり、receiptを作れない。
I0の全acceptanceが有効になるまでplanはI0を維持する。
[固定入力の1戦smoke](i0-fixed-smoke.md)は既存Windows予算・管理出力へ接続した診断入口。
全体会計・安全回収・固定8デッキ実走・探索校正の完了とは区別する。

Windows共有budget入口の容量受付は[保存容量の受付](i0-storage-admission.md)を参照。
生成前の新規計測と小容量管理writerの出力claimを接続した分割。
任意moduleの全出力guard・完全会計・本番校正は未達。

## CLIと保管先

```powershell
node scripts/ismcts-program.mjs plan
node scripts/ismcts-program.mjs status
node scripts/ismcts-program.mjs verify
node scripts/ismcts-program.mjs migrate-budget
node scripts/ismcts-program.mjs record --task I0 --acceptance E1 --run logs/harness/runs/<run>.json
node scripts/ismcts-program.mjs record --task I0 --acceptance R1-budget --run logs/harness/runs/<run>.json
# 次run/親の統合成功確認後だけ実行。要求中・失敗ticketは拒否する。
node scripts/ismcts-program.mjs record --receipt receipts/<receipt>.json --commit <verified-SHA> --integration-id <completed-ticket-ID>
# 最新cacheが別の監査に置換された場合は、該当commitの保存archiveを明示する。
node scripts/ismcts-program.mjs record --receipt receipts/<receipt>.json --commit <verified-SHA> --integration-id <completed-ticket-ID> --evidence logs/verifier-history/<archive>/evidence.json
```

`--repo`/`--worktree`/`--integration`は既存wrapperの固定先引数。
共有保存先はGit共通ディレクトリから求めたprimaryの`logs/ismcts-program/`。
保存先・既存祖先のjunction/symlinkは、読取・列挙・lock・作成・atomic保存前に共通検査で拒否する。
`plan`/`status`は読取専用。`verify`は全receiptを再評価したadvisory indexを保存する。
indexの手編集で進捗は変わらず、未確認/失効receiptの履歴を保持する。
現必須集合はI4に`solo-fallback`、I6に`training-loop`/`model-lifecycle`、I7に`autonomy-soak`を含む。
これらの実行gateは未登録で、receipt作成を拒否する。旧集合だけの成功は完了へ移行しない。
planは受入条件ごとに現集合を再構成し、欠落は未確認、不正・重複IDはcontrollerエラーにする。
監視判定でも当初のLLM成果確認を維持する。正常tickの省略にはI7のlive停滞検出実装が別途必要。

receiptの実行・scope・runtime・verifier・親統合の検査契約は
[receiptの検査契約](i0-receipts.md)を参照する。以下は失効時の再採取手順。

### scope失効からの再採取

受入回帰のfixture設定もscope入力である。`test-ismcts-program.mjs`の
`core.autocrlf=false`追加で旧Windows job receiptのscopeが失効した場合、
runtimeが一致していても旧receiptのhashや入力一覧を変更して通さない。
controllerが`invalid`を返すことはこの変更に対する正しい拒否であり、
失効理由を消すcontroller修正は不要である。

Windows所属計測の有限再試行・理由コード・回帰件数の変更や、harnessのfingerprint診断追加も
同じscope失効として扱う。旧receiptの入力一覧と現ファイルを比較し、追加・変更pathを保存する。
runtime一致はscope一致の代用にしない。Windows下位制御は現在29チェックを含むが、
短時間のidle process回帰であり、production接続・連続運転・実ゲーム校正の受入とは分ける。

root終了待機の回帰がexitCodeだけでなくjobのmember集合を待つ形へ変わった場合も、
旧receiptの実行入力とは異なる。現checkoutの生byteとGit blobを旧manifestへ照合し、
失効原因を保存して新しい実runから再採取する。過去の追加単独回帰やruntime一致だけでは
元receiptの必須runを置き換えない。失敗した親ticketを後続の別commitの成功へ付け替えない。

checkoutのCRLFとGit blobのLFは、実行byte SHA256と属性適用後のblob IDを別々に照合する。
旧manifestへblob IDを補記して復活させず、現treeの実gateから新receiptを作る。
属性変更もscope失効、生byte・ログ改変も拒否する。新receiptは親統合確認まで未最終化とする。

旧receipt全件のbytes/hashと失効理由を保持し、現在treeの`full` profileを新規実行する。
通常の文書gateだけでは`ismcts-program`受入回帰を実行できないため、証跡の再採取には
当該gateを含む正規profileを用いる。完走後に同じtree/runtime/logへE1/R1-budgetを記録し、
独立verifier・verified commit・親統合を経て次runで最終化する。
新receiptは親成功まで`finalization=null`であり、旧候補や親の別commitへ結合しない。
実行・査読・親照合の正確なpathと再開argvは生成物の引継ぎに保存する。
この再採取はR1-runtime、固定8デッキ、実ゲーム校正を受理する手順ではない。

### 後続の検証受付失敗からの再採取

入力manifestとruntimeが一致していても、後続の共有validation lease待機が失敗し、
実行scopeを固定できなかったrunは保守的なacceptance失敗として旧receiptを失効させる。
後続の確認記録専用gateが成功しても、I0回帰を実行したことにはならず旧receiptは復活しない。
workerは生存ownerを待ち、共有leaseの回収・削除や待機上限変更を行わない。
旧receipt全件と元の受付失敗runの生byte/hash・失効理由を保持して、現treeの新規full完走から
E1/R1-budgetだけを再採取する。controllerの拒否や失敗履歴を緩めて通さない。
新receiptは今回のverified commitと親統合へ結合し、親成功確認まで未最終化とする。

### 親merge gate失敗からの再採取

親が必須merge gateと通常fuzzを完走しても、remote mainの先行でpushが拒否されたticketは
failedのまま保持する。そのticketに結合したreceiptを別ticketへ付け替えて最終化しない。
workerのbranchへremote差分を取り込み、現在入力の監査・full gate・独立査読を実行して
新しいverified commitと親統合要求を作る。新receiptだけをそのcommit/成功ticketへ結合し、
元ticket/log・旧receiptのbytes/hashを保持する。primaryの別branchや差分は操作しない。

親のmerge gateがacceptance到達前に失敗した場合も、先行receiptは失効する。
失敗ticketと元run/log、全receiptのbytes/hash、controllerの失効理由を保存し、
失敗したgateを現treeで再実行する。単独成功だけで競合原因の解消や親統合を認定しない。
controllerの拒否を緩めず、固定した現treeの新規full完走からE1/R1-budgetを再採取する。
新receiptは新しいverified commitと今回の親ticketへ結合し、親の完了・exit・ログ・
actual remote mainを確認するまで未最終化のまま保持する。失敗ticketのreceiptを
別ticketへ付け替えない。親の再失敗時は失敗履歴を追加して次runへ引き継ぐ。

## 予算ライブラリの境界

`scripts/ismcts/resource-profile.json`がPC数値正源。`resources.md`のJSON写しはgateで全値を照合する。
`budget.mjs`の`reserveBudget`/`finishBudget`/`budgetStatus`は同じ共有directoryで使う。
production callerは`programPaths(worktree).shared`を用い、worktreeや子ごとのdirectoryを渡さない。
現在は探索/学習CLIやserviceへ未接続であり、このAPI単独でCPUスレッド/RSSを強制できるとは報告しない。

Windows下位schedulerには`windows-budget-admission.mjs`を追加した。
`runWindowsBudgetedJob(worktree, request, callbacks)`は`programPaths(worktree).shared`だけを使い、
共有予約を取得してからguardian/job/helperを生成する。日次上限・既存active予約・service優先・
取消済み入力なら生成しない。予約開始時刻からの残時間をnative期限と取消signalへ渡し、
既知の予算拒否は共通のread-only previewで容量helperとtransaction marker作成前に返す。
previewのavailableは実行許可ではなく、容量検査後の排他内で同じ判定を再実行する。
lock残留・ledger破損/途中保存はpreviewでも拒否し、旧予約・全予約課金を保持する。
helperはattach完了前から所有取消へ接続し、取消時はguardian/helperの終了を待つ。
私有実OS回帰はattach応答前の取消・root未開始・全予約保持を確認する。
JS停止中のprogram全体期限は未実証であり、
既存native job期限/heartbeatの範囲を越えた独立強制を主張しない。
正常root終了・取消・初期化失敗のいずれも完全会計へ変換せず、全予約と所有tokenを残す。
`execution.status=completed`でも外側は`unreconciled`で、次jobを拒否する。
`runReservedWindowsJob`は信頼されたfactoryを受ける下位境界で、私有ledger回帰にも使う。
本番入口へdirectory/owner/clock/factoryの上書きは渡せない。
公開`callbacks`は専用service状態とAbortSignalだけとし、任意`onSample`を予約前に拒否する。
観測は入口が設置する内部telemetryに保存する。下位factoryの私有注入を公開callbackへ読み替えない。
所有計測の保存は[共有予約内の管理ログ](i0-runtime-telemetry.md)へ分割接続した。
管理外出力guardは未接続。caller/serviceの全体会計・安全な予約回収・
探索/学習CLIへの接続を満たすまではproduction運転へ使わず、R1-runtime/calibrationを受理しない。

- 予約はチャンクの最大wall・threads×wall CPU・出力・monitor予算を先に消費する。
- JST日次境界を跨ぐ通常予約を拒否し、`reserveNextChunk`は残時間へ短縮する。過去日と所有tokenを再起動後も保持する。
- 日次帰属は開始時刻のJST日へ結合する。完了履歴と合算を同じ過去日に移しても拒否する。
- 所有tree終了と完全計測をruntime側が証明できた正常完了だけ未使用量を戻す。
- 異常終了は全予約を計上。未回収/計測欠落/孤児treeは予約を残し、次jobを拒否する。
- `transaction.lock`は短い予算/index更新の排他で、supervisor lockとは別物。
  stale transaction/欠落ledgerを自動初期化・削除しない。明示的な安全回収は次のruntime実装で扱う。
- `resourceMachine`は連続2秒計測のCPU/RAM停止・再開判定。欠落/遅延点は持続時間をリセットする。
  既知のRSS hard到達は他の計測欠落やGPU拒否より先に終了判定し、回復時間もリセットする。
  GPU診断は疑似入力の閾値確認に限り、GPU実行は常に拒否する。
  AI VRAM上限到達中はGPU再開診断を許可せず、全回復条件の連続30秒を必要とする。

## 残るI0受入条件

2026-10-06承認の[24時間会計上限](resources.md#24時間目標への時間予算移行)をschema 2へ反映する。
旧ledgerは明示的`migrate-budget`で全履歴と元bytesを保存する。active予約・不正profile・
計測未回収・保存元不一致なら拒否する。完了journalのtargetHashも保存元と移行時刻から初期targetを
再構成して照合し、後続jobで更新された現在ledgerのhashとは比較しない。
最新ledgerは順序付きSHA保存のcheckpoint元bytesを保持し、`budget-initialized.json`の
参照・canonical hashを最新保存先へ結合する。台帳だけ、または台帳と参照を初期schema 2へ
戻して後続予約を消す入力も拒否する。各書込みは元bytes保存→checkpoint pending→ledger→
completedの順。pendingは通常操作を拒否し、明示`migrate-budget`は正規なpersisted targetと
完全一致する場合だけ完了する。ledger前で中断した不一致は自動rollbackせず修復待ちを保持する。
保存checkpoint間も既存予約を保持する追加、同じactive予約の単調増加出力claim、完了だけを許す。
古いsnapshotを新sequenceで付加する入力や完了済み履歴の改変も拒否する。移行済み履歴は毎回照合する。
保存列への予約追加も通常APIの制約と共有し、監視tick上限超過を拒否する。
予算の会計移行とruntimeでの強制・自律学習の連続運転を区別する。

1. 所有PID/子のidentity照合・BelowNormal・合計threads制御・停止/再開・孤児処理を
   Windows/Linux runnerへ接続し、service受付時yieldも反証する。
2. artifact-storageとprogram20GiB/日次2GiBを実書込み経路へ接続する。
3. [固定8デッキと席交換/学習別seed](i0-fixed-inputs.md)を通常validatorで検証する。
   分割入力基盤は実装済み。production runnerの読取と実試行の証跡は未接続。
4. 空き6GiB開始条件を満たしたときだけ、1thread/1game/120decision/60秒smokeを行い、
   RSS/CPU/中断を実測する。fixture速度と2thread比較は資源成立時に続ける。
5. R1-runtime/calibration gateを同じharnessへ登録し、receiptと統合証跡を確認する。

`host-probe.mjs`は内容を含まないhost集計を、開始時点と2秒間隔15点（計16点）で観測する。
CPU40%未満・空き6GiB以上が連続30秒の共通回復判定を通り、欠落/遅延点がない場合だけ
smoke開始候補となる。[平常負荷計測](i0-host-baseline.md)は両OSで初期CPU区間を別に取得する。平常負荷とruntime制御は別証明。
実機ログは`artifacts/ismcts/`へ保存し、計測欠落やRAM不足を成功へ変換しない。
I1以降・本番GUI接続・配備・120分監視移行・強さ実証はまだ未達。

## Windows所有processの分割primitive

[共有service優先入口](i0-service-priority.md)は受付lifetimeを保存し、共有予算予約と
Windows下位schedulerへ拒否/yieldを伝播する。実HTTP受付・認証との接続は未達。
[制御channel放棄時cleanup](i0-control-channel.md)は小さいbootstrap型コンパイル後から
初期stdin待機・native型コンパイル/constructorへ非更新15秒期限を適用する。
既存制御leaseを設置してからbootstrapを完了し、生成後のguardianとguardian終了後のmeterを
終了する。bootstrap型自体のコンパイル前・caller全体の制御と完全会計は未達。

生成時所属・固定期限・job/guardian計測・終端handleの契約は
[Windows下位制御](i0-windows-runtime.md)を参照。jobとguardianの最終CPUを取得するが、
計測helperの終了tailはNode内の保持handleへ接続した。caller/probe/serviceを含むprogram全体会計は未達。
`accountingComplete:false`を維持し、共有予算の返却を認めない。
production runtime/Linux/固定8デッキの実行/実ゲーム校正の受入とは分ける。
