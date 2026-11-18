# I0 所有runtimeの計測保存

`runWindowsObservedJob(worktree, request, callbacks)`は共有budget受付と
Windows所有schedulerを使い、計測を同じ予約の管理artifactへ保存する分割入口。
本番探索・学習CLIと探索校正は未接続で、R1-runtime/calibrationの受入ではない。
[固定入力の1戦smoke](i0-fixed-smoke.md)は同じ予約を使う診断workloadとして接続する。

既存の`runWindowsBudgetedJob`は維持する。新入口では出力予約が4096byte超・64MiB以下で
なければ生成しない。残り時間から30秒を保存用に確保し、残りが足りなければ生成しない。
容量計測やfsyncが30秒以内に完了する保証ではなく、予約期限後の保存は拒否する。
受付開始からの単調経過とwall期限の小さい方を保存前・claim後・容量検査後・fsync後へ継承する。
時計が巻き戻っても保存開始から新しい時間枠を作らない。

公開入口の`callbacks`は`serviceBusy`と任意の`signal`だけを受け付ける。
`onSample`は値がundefinedでも未知fieldとして容量検査・予約・生成前に拒否し、accessorも呼ばない。
同期関数でもrejected Promiseを返せるため、callerの観測関数を呼んでから戻り値を検査する方式は使わない。
controllerの検査済みsampleは入口が設置する内部telemetry observerで射影・JSONL化する。
CPU/RSS・host負荷・所有PID/生成identity・affinity・停止理由を保存し、
module/args/cwd、環境、service token、game state、例外本文を含めない。
schema 2は各sample/terminalの`owned.members`へjob所属processの`pid/created/rssBytes`を保存する。
所属件数・identity・RSS合計は既存native validatorで照合し、欠落を空配列へ補完しない。
member/配列要素のaccessorは呼出前に拒否し、追加field・prototype・`toJSON`を保存しない。
保存byteと次sampleの比較用データは元のmemberから切り離す。
headerの`membershipCoverage: sampled_job_members_only`は観測時点だけの所属記録を意味する。
観測間に生成・終了したprocessの全identityや、全lifetimeの会計を証明しない。
旧schema 1のmember欠落も所属0として扱わず、既存ログを補記・上書きしない。
schema 3は各sample/terminalの`writeIo`へJob全寿命・guardian・helperのOS書込み転送byteを保存する。
Job class 8の累積値は既に終了した子も含む。guardianは同じ保持handle、helperはNode内の保持handleで
終了tailを取得し、同じguardianの中間sampleを二重加算しない。UInt64を10進文字列のまま検査し、
合算はBigIntで行う。欠落・accessor・範囲外・逆転は拒否し、旧schemaへ0を補わない。
これはファイル上書き/削除を含むOS転送計測であり、artifact保持量・payload claimと同じ単位ではない。
caller・容量計測の別process・service・保存後tailは含まず、全writer強制や日次出力枠の成立を証明しない。
旧予約の欠測を復元できず、`accountingComplete:false`と全予約保持を維持する。
仕様根拠はMicrosoftの[Job I/O accounting](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_and_io_accounting_information)と
[process I/O counters](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getprocessiocounters)（一次資料A）。
callerへsampleや制御stateの参照を渡さず、観測保存のための任意コードを実行しない。
下位schedulerの`onSample`は信頼された内部observerと私有factory回帰の注入用であり、
その下位APIへの任意callback一般の安全性は証明していない。
watchdog停止では検査済みsampleの期限切れflagと停止理由に限りhost CPUを明示的なnullで保存する。
通常観測の欠落CPUと不整合なwatchdog分類は拒否する。
最大601観測と出力byte枠で蓄積を制限し、失敗末尾用の4096byteを残す。
job/guardian終端とhelper終了tailは保持handle/既存validatorで検査し、`finalOwnedCpuMs`へ合算する。
helper終端の欠落・identity/CPU逆転・異常exitは正常ログにしない。
[caller部分計測](i0-caller-accounting.md)の区間CPU/RSSと終端cutoffを別項目で合算し、
公開共有入口からの基点は受付・native生成を含む。管理ログ内terminalは保存前のcutoffであり、
同じ基点の保存後`callerCutoff`を戻り値/失敗Errorへ返す。入口前・その後のcaller tail・serviceの未会計は維持する。
helper終端は所有data fieldの`pid/created/exited/cpuMs/signaled/exitCode`を一度取得した新objectで検証・保存する。
追加fieldとown/inherited `toJSON`は保存せず、必須fieldのaccessorは呼出前に拒否する。保存済みbyteへ後からの変異を反映しない。

所有native factoryの終了後に、同じactive予約のownerを内部で渡す。
既存`writeReservedArtifact`でclaimを保存してから容量を再計測し、
`managed-output/<reservation-id>/artifact-runtime-telemetry.bin`を排他作成・fsyncする。
容量拒否・保存失敗・枠超過は正常結果を返さず、全予約と失敗claimを保持する。
runtime例外は可能ならpartial logを保存してから元の失敗を再送出する。
例外の機密本文はログへ写さない。末尾を検査できない結果は正常ログへ変換しない。

正常root終了でも外側は`unreconciled`、`accountingComplete:false`、全予約保持。
同じledgerでの次jobは拒否される。管理外writer、全出力先、metadata byte会計、
全体会計と安全回収、Linux、本番service、固定8デッキ実戦・実ゲーム校正が残る。
strict Node子の回帰は公開2入口と共通受付で18入力を拒否し、観測関数/accessorの呼出0とcaller継続を確認する。
修復前のrejected Promise対例は模擬factoryでのcaller exit1であり、実OS cleanupの失敗を実証したとはしない。
私有実OS回帰は内部factoryの最初のsample後に未開始のidle rootを取消し、失敗partial保存と所有process終了を確認する。
別の私有native fixtureでは明示finishによる強制停止と終端CPUの保存を確認する。
通常負荷30秒・20分runtime・実ゲーム・本番運転の実証へ拡張しない。
