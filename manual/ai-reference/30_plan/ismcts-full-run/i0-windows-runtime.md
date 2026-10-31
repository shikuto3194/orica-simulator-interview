# I0 Windows所有processの下位制御

## guardianのhost計測と資源判定接続

`windows-job.cs`は所有guardian内で`GetSystemTimes`と`GlobalMemoryStatusEx`を直接呼ぶ。
累積CPUはUInt64文字列、時刻は単調clock、空き/総RAMはbyteで返し、追加host probeを生成しない。
`windows-resource-controller.mjs`はkernelに含まれるidleを一度引いて区間CPUを求め、
同じguardian生成identity・RAM総量・連続3秒以内の計測を検査する。初回点はCPU未確定。
既存`resourceMachine`へhost値とjob/guardian/helperの合算RSSを接続する。
開始には低CPU/空き6GiBの連続30秒と、`ResumeThread`直前の新規計測を要求する。
nativeが計測開始時の単調clockと最新sample tokenを保持し、開始要求をそのtokenへ結合する。
helper応答待ち・制御channel遅延も含むageが3秒超、または別sampleへ置換済なら開始を拒否する。
私有guard内で3.5秒待った実OS回帰はroot未開始と終了、別token拒否は最新tokenでの開始/終端を確認する。
この待機は遅延モデルであり、本番helper異常の発生証跡ではない。
稼働中のCPU/RAM停止・サービス優先yieldは所有jobの終了へ接続し、遅延/不正計測はcloseする。
既知RSS hardは開始前・service待ちでも終了する。外部PIDや資源上限を変更しない。

これは所有jobを渡す下位adapter。共有budget・storage・service受付・本番探索/学習CLIへ未接続。
下記の2秒schedulerと独立watchdogを接続し、終了後の再開は新しいchunkで行う。
計測helperの終了tailはNode内の保持handleへ接続した。[caller部分計測](i0-caller-accounting.md)は
下位controller区間のCPU/RSSを合算するが、受付・保存・caller tail・service全体は未会計のため
`accountingComplete:false`を維持する。
実OS回帰はhost取得・開始veto・30秒未観測の開始拒否を確認する。
12項目の模擬入力は閾値・直前負荷変化・欠落・競合・yield・watchdog終了・最終service再検査の配線を検査するもので、
本番負荷・物理3GiB負荷・30秒安全後の実開始・実ゲーム校正の証明ではない。
根拠A: [GetSystemTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getsystemtimes)、
[GlobalMemoryStatusEx](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-globalmemorystatusex)。

## 独立watchdogと2秒scheduler

`createWindowsJob({resourceWatchdog:true,...})`はnative guardian内の資源heartbeat期限を有効化する。
開始時の新規host計測から3秒の期限を設定し、100ms周期のtimerが計測/control mutexを待たずに
同じSafeHandleのjobを終了する。開始前は未armで、生成時からのwall期限は別に維持する。
完全なjob/guardian/helper応答を検査したsampleだけが新規host tokenを返して期限を更新する。
更新後の期限は計測開始時刻+3秒とし、受信時刻から延長しない。最新でない/再利用/遅延token、
期限切れ後の再armを拒否する。期限切れは`resourceWatchdogExpired:true`へ結合し、生存するjob memberを
終了コード126で終了する。rootが先にexit0でも、その実終了コードを保持して残る子を終了する。
controllerはrootのexit0より期限切れflagを優先し、`resource_watchdog_expired`として停止を返す。
明示terminate後のsampleはheartbeatを更新せず、所属解消と累積CPUを確認してfinishへ進む。
期限切れとchannel拒否が競合する場合は結果を拒否してcloseし、成功扱いしない。

`windows-resource-loop.mjs`はwatchdog有効のcontrollerを必須にして2秒ごとのstart/pollを行う。
重複loopを拒否し、service状態は同期booleanで受け取る。開始前は既存30秒安全windowを満たすまで
rootを停止したまま待つ。中断は所有jobをfinish/closeし、正常/停止終端でも所属解消を確認する。
開始時には同じservice readerを最終native sample応答後のguardへ渡し、待機中の受付を再検査する。
最終readerの不正/例外はcloseし、busyなら安全windowをリセットして開始を拒否する。
予約入口/tickと同じ専用service状態を読み、任意callbackは呼出前に拒否する。
booleanまたは凍結readerのWeakMap内のlocal状態と共有lifetimeを読み、service入力からPromiseを生成しない。
独立Node processのconstructor/@@species対例は模擬cleanup・caller継続までの証明であり、実OS障害の証明ではない。
新受付とnative開始を原子的に直列化する仕組みではなく、次tickと独立watchdogも引き続き必要である。
callback/計測が遅延すれば稼働中jobはnative側で終了する。共有service受付との実接続は未達。
loopの`completed`は所有jobのexit0だけを意味し、完全会計・受入receipt・実ゲーム成功ではない。

追加の私有idle実OS回帰はJS呼出元3.5秒停止、native mutex保持3.6秒中の子孫終了、token再利用拒否、
5秒間の新規計測による生存、明示terminate後のsample/finish、root先行exit0後の子の期限切れと
停止分類を確認する。実scheduler回帰はservice待ちの停止rootを
2秒間隔で2回計測し、中断後のroot/guardian終了と`accountingComplete:false`を確認する。
5項目のscheduler模擬回帰はguard必須・重複拒否・中断・不正service入力・最終reader伝播を検査する。
これらは短時間の下位制御であり、30秒安全後の実開始、本番障害、20分運転、校正の証明ではない。
今回のhost基線16点はCPU最大15%、空きRAM最小5.457GiBで6GiB条件未達。計測子の最大所要時間も
3.788秒で3秒鮮度を満たさず、開始許可へ流用しない。実ゲーム試行は0。

## 所有jobと終端会計

`windows-job.mjs` / `windows-job.ps1` / `windows-job.cs`は下位のOS制御部。
`PROC_THREAD_ATTRIBUTE_JOB_LIST`で生成と所属を一体化し、所属後も初期threadを停止したまま返す。
`start`だけが初期threadを開始し、job handleは継承・公開しない。breakawayも許可しない。
guardianのstdin EOF・crash時は`KILL_ON_JOB_CLOSE`で子/孫を終了する。外部PIDへの操作はない。
BelowNormal、指定1/2論理CPUへのjob affinity、3GiBのjob commit上限を設定する。
affinityは同時CPU実行枠の制限であり、OS thread総数が2以下という証明ではない。
全job member（Windowsの追加console-hostも含む）のRSSを合算し、累積CPU時間をjobから取得する。
生成時刻/affinityは64bit値の文字列で保持し、PID再利用・JSON数値の精度損失を避ける。
メンバー欠落/競合・Win32失敗は部分計測を返さずjobを終了する。初期所属前の実行を認めない。
wall deadlineは生成時から固定し、requestやstartで延長しない。期限処理は計測mutexを待たず、
SafeHandleで同一jobへの操作と並行closeの競合を防ぐ。制御channelはUTF-8 JSONL。
応答は改行前も1frame 64KiBへ制限し、正常応答の累積量で期限前終了させない。
stderrは別の累積64KiB上限とし、応答待ちtimeout・不正frameはjobを終了する。
guardian自体はjob外だが、生成したguardianだけをコンパイル・子生成前にBelowNormalへ設定し、
指定1/2論理CPUをjobと共有する。OS thread総数の制限とは区別する。
affinityの符号付きIntPtrはbit patternを保持して変換し、bit 63を含む全64bitから枠を選ぶ。
sampleはjobの`cpuMs`/`rssBytes`に加えてguardianの生成identity・CPU/RSS・実affinity/priorityと、
両者の`totalCpuMs`/`totalRssBytes`を返す。guardianのコンパイルまでのCPUも累積値に含む。
欠落・合算不一致・生成identity/affinity変更・累積CPUの巻戻しは拒否し、所有guardianを終了する。
PIDは非零uint、生成identityは正のInt64、affinityは非零UInt64の範囲に制限する。
初期sampleとresource adapterの両方で範囲外を拒否し、bit 63の正しいmaskは維持する。
合算RSSが3GiB以上ならnative側で同じjobを終了し、adapterもguardianを終了する。
`start`直前にも再計測する。`windowsResourceSample`は既存resourceMachineへ合算RSSを渡し、
2GiB soft判定も合算する。累積CPUは`ownedCpuMs`として後続会計用に保持する。
`finish()`はjob/rootの同一handleを保持し、必要なら子孫を終了させ、最大5秒でrootのsignaledと
jobのactive=0を照合して最終累積CPUを採取する。rootだけの終了やterminate応答を終端へ読み替えず、
実終了コード259もsignaledで区別する。guardianの正常終了確認後だけjob終端結果を返す。
欠落・CPU巻戻し・生存member・guardian crash/異常終了は終端結果を拒否する。
guardian終了後のCPUは下記の保持handleから取得する。結果は常に`accountingComplete:false`。
既存`finishBudget`は返却を拒否して予約を保持する。caller/host計測子・serviceを含むprogram全体、
共有budgetとの本番接続は未達。計測helperの最後の応答と終了処理は下記の保持handleで計測する。
job/guardianの終端計測をAI全体の資源上限・完全な終了会計と扱わない。

回帰は小さいidle processの所属/子/終了/guardian crash/独立process保全/deadline/引数転送を実行する。
600回の実sampleと過大frame拒否も検査する。600回は短時間で実行し、20分連続運転の証明とはしない。
guardian合算と共通resourceMachineの閾値は実OS sampleとメモリ内変異で検査する。nativeの
3GiB閾値による実job終了は私有fixtureの閾値注入で確認し、3GiBの実負荷を生成した証明とはしない。
affinityは本番helperを取り出して10形のmaskを検査し、物理CPU 63上での実行とは区別する。
終端回帰は自然終了0/259、root先行終了後のdetached子、未開始、deadline、guardian crashを検査する。
detachedはlibuvの親終了時killを避けるfixture設定で、所有jobからのbreakawayを許可するものではない。
通常の`ismcts-program` gateへ接続したが、`R1-runtime`/`calibration`の受入gateは未登録を維持する。
共有予算・host/resourceMachineの実monitor・実書込みstorage guard・service yield・checkpoint再開との接続、
Linux制御と固定8デッキ/実ゲーム校正は残る受入条件。productionの探索/学習CLIにはまだ接続しない。
このprimitiveを経由したidle回帰を、実ゲームsmoke・資源開始条件・校正の成功へ読み替えない。
実装根拠A: [Microsoftのatomic job creation](https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812/)と
[job limits](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information)。
終端会計の根拠A: [全active/終了processの累積CPU](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_accounting_information)、
[同一root handleのsignaled確認](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitforsingleobject)、
[libuvの非detached子job](https://github.com/libuv/libuv/blob/v1.51.0/src/win/process.c)。

## guardian終了後の保持handle計測

`windows-process-meter.ps1` / `windows-process-meter.cs`は私有の読取専用helper。
対象PIDはcallerが生成したguardianのChildProcessだけから渡し、公開APIに外部PIDを受け取らない。
guardianがcreate要求を待つ間にquery/synchronize handleを開き、そのhandleを終了後まで保持する。
権限はPROCESS_QUERY_LIMITED_INFORMATIONとSYNCHRONIZEだけで、対象への書込み/終了権限を持たない。
生成identity・signaled・累積CPUは同じhandleで照合し、終了後にPIDを再openしない。
helperのコンパイルはjob生成/deadlineより前。guardian/helperの優先度とaffinityは共通helperで設定する。
spawn引数でCPU枠を先に固定し、小さいlease型のコンパイル後からstdin待機・native型の
コンパイル/constructorへ非更新15秒bootstrapを適用する。詳細は[i0-control-channel](i0-control-channel.md)。
この型自体のコンパイル前とcaller全体の独立制御は未達である。

live sampleはjob CPU、保持handleから得た直近guardian CPU、計測helper CPUを合算する。
RSSはnativeが計測したjob/guardianとhelperの合算。三者の同じ1/2 CPU枠とBelowNormalを照合する。
adapterはhelper計測の欠落・所属の重複・終了済みguardian・合算の非有限値を拒否し、旧形式へ戻して計測を省略しない。
helperを含むRSSも3GiB hard/2GiB softへ渡す。nativeの非同期hard終了はjob/guardianの合算であり、
helper込みのhard判定はcallerのsample/start前計測時。program全体の連続強制は未達である。
sampleの各値は順次採取であり、同時刻の全process snapshotとは扱わない。

`finish()`はnative job終端とguardianの正常exitを確認し、保持handleでsignaledと最終CPUを確認する。
`guardianCpuComplete:true`、`guardianFinal`、job+guardianの`finalJobGuardianCpuMs`を返す。
計測helperの`meterLastSample`は終了前の値であり、Node内の読取専用保持handleで終了後に再計測する。
`meterFinal`/`meterCpuComplete:true`と三者の`finalOwnedCpuMs`を返す。caller/serviceを含む全体会計は未達なので、
`accountingComplete:false`と共有予約の全量保持を維持する。
不足・identity変更・CPU巻戻し・異常exit・不正frame/timeoutは結果を拒否して所有processを終了する。
終了コード259だけを生存判定に使わない。正常guardianの最終結果にはsignaledとexit0の両方を要求する。
close/EOFは所有helperだけを閉じ、無関係なprocessへ操作しない。

回帰はguardian自然終了後の最終CPUと合算、helper crash時の所有子孫終了、identity/CPU/合算の入力変異拒否を検査する。
native meterは短い私有processの実exit259後もhandleを保持し、繰返し取得が同じ生成identity/最終CPUになることを検査する。
CPU負荷はこの有限fixtureに限り、校正・20分運転・本番全体会計の実証へ読み替えない。
根拠A: [GetProcessTimesのkernel/user CPU](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes)、
[終了後もhandleが残るprocess object](https://learn.microsoft.com/en-us/windows/win32/procthread/terminating-a-process)。

Node内のbinding、明示buildとartifact照合は[計測helper終端handle](i0-process-handle.md)へ分割した。
