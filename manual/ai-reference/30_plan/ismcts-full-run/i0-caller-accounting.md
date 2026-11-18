# I0 Node callerの部分計測

`caller-meter.mjs`は現在のNode processだけからCPU/RSSを取得する。
外部PID・計測callback・時計・資源閾値の上書き入力は持たない。
共有予算/観測/fixed-smokeの公開入口で、Git共有root解決・容量検査・予約・native生成より前に
同じmeterを作る。信頼された予約contextからcontrollerへ渡し、各sample・開始直前guardで
job/guardian/meterの検査済みRSSへcaller RSSを加えて既存resourceMachineへ渡す。
nativeの所有handle/identityと三者合計は維持し、callerを別項目として記録する。
同じPIDの二重合算・不正数値・CPU逆転は拒否する。owned RSSのoperandはown data descriptorから取得し、型強制・accessor・負値を拒否する。

終了時はjob.finishと所有helperのcloseを待ち、その後のcaller CPUを取得する。
終端ログの`callerCpuMs`はその区間だけの差分、`finalMeasuredCpuMs`は
三者の`finalOwnedCpuMs`にその差分を加えた値である。
callerは生存中なので、この点をprocessの最終CPUやcaller終了確認と呼ばない。
共有入口の基点は受付とnative生成を含む。controllerを直接呼ぶ私有fixtureでは、meter省略時の
従来のcontroller生成基点を使う。生成済みmeterだけをWeakSetで識別し、偽meterのaccessorや関数は呼ばない。

観測factoryが管理ログを射影・書込み・fsyncしてsettleした後、共有入口が同じmeterを再計測し、
戻り値の`callerCutoff`へ基点/現在CPU・RSS/区間CPUを返す。factory失敗でもcatch時のcutoffを
保持したErrorへ付ける。terminal前と保存後のcutoffを足し合わせず、同じ基点からの累積値として比較する。
新しい管理artifactや成功台帳は作らず、CLI/既存harnessの実stdoutへ出したcutoffだけを診断証拠にする。
戻り値を外へ保存する前のcaller終了では、そのcutoffの永続化を保証しない。
module初期化等の入口前、cutoff後のtimer cleanup/返却/結果読戻し・caller終了tail、別serviceは未会計。
不完全会計の`accountingComplete:false`と全共有予約保持/`unreconciled`を維持する。
callerのpriority/affinity強制・独立deadline・全出力先guardも今回の計測で成立しない。

保存対象は`pid/userMicros/systemMicros/rssBytes`のown data descriptorを一度取得した
新objectだけとし、必須accessorは呼ばず拒否する。追加fieldとown/inherited `toJSON`を
保存せず、変異を保存済みbyteへ反映しない。基点の置換・終端差分不一致も拒否する。
欠落した正常終端をfailure partialや完全会計へ自動変換しない。

回帰は短時間の現在process CPU計測、模擬owned RSSと実caller RSSを合算したhard判定、
私有idle Windows下位runtimeの終了/telemetry保存、入力変異を検査する。
同じ私有OS経路の2回の受付scanと保存時scanへ有限CPU作業を入れ、受付前の同一基点が
terminalへ到達することと、保存後cutoffが保存処理の実CPUを含むことを検査する。
物理3GiB負荷・20分production runtime・実ゲーム校正を実証するものではない。
R1-runtime/calibration gateは未登録で、I0全体の受入には残る全体会計と実機校正が必要。
過去のcontroller基点ログへ受付CPUを補記せず、PID不在だけで未知のCPU/出力量を0にして
古い予約を解放しない。次の受入単位は終了までを所有する外側runtimeと安全回収、全writer会計から
同じ固定8デッキ/seedの再開・校正まで。今回のcutoffだけではその親受入を成立させない。

## 外側Jobによる受付callerの実OS反証

`test-contained-admission.mjs`は既存の生成時Job所属を受付Nodeの起動前へ適用し、
私有ledgerの通常受付→内側native runtimeの停止→管理telemetry保存→caller tail→終了を実行する。
容量受付・attempt・telemetry保存時のscanは各々別Node子で4096byteを3回上書き後削除し、callerもcutoff後に
CPU作業と8192byteの書込み/削除を行う。保持したcaller handleの最終CPUがcutoffとtailを含み、
外側Jobの累積CPUがcallerと内側所有processの合計以上、書込みが削除済みpayload以上であることを照合する。
各scan子を外側Jobのmemberとして観測し、同じ生成identityの保持handleで終了CPU/I/Oを個別照合する。
総書込みの下限だけで所属を推測せず、観測できないwriterが1件でもあれば私有回帰を失敗させる。
内側の集計は外側Jobへ既に含まれるため、実運用接続時に両方を加算してはならない。
もう一方の実行はcaller終了後も残る私有子を生成し、外側finishの強制終了・member drainを確認する。
既存`ismcts-runtime` gateから両方を実行し、新しい受入gate/成功台帳は設けない。

この私有回帰のscanは有限のwriterであり、本番の実ゲーム完走とは別の実証である。
実際の全storage probe/serviceの完全性・OS metadata転送量・全writer強制を証明しない。
外側guardian/helperの既存終端計測も維持するが、最外制御callerと予算保存の会計は未完。
私有予約はactiveのままで、共有旧予約の欠測を復元・解放せず、R1-runtime/calibrationも未達。
[固定smoke](i0-fixed-smoke.md)は共有予約後に外側Jobのrootとして内側受付を生成する接続を持つ。
同じ予約のowner/期限/枠を照合し、容量検査・attempt・内側runtime・保存後tailと終了を所属内に置く。
私有回帰もその受付continuationを使い、子の追加予約0、枠の返却0、短い期限/不一致の生成前拒否を検査する。
最外制御Nodeの予約前後scan・最終保存と終了、全writer/service/metadataの会計と強制、旧予約の安全回収は残る。
所有Jobには予約出力枠を使う累積OS書込み転送量の停止判定を接続した。生成時に固定し、
native timerが100ms周期を目標に照合する。超過時は同じJobを終了し、停止理由を保持する。
上書き・削除済みfileと終了済み子も対象だが、個々のwrite前に拒否するbyte上限ではなく、
timer遅延と単一writeの超過分が残る。最外caller/helper/service・OS metadataと保存量の完全guardは未達。
OS転送量をpayload claimや日次保存量へ換算せず、内側と外側の量も加算しない。
独立した停止判定の成功だけで`accountingComplete`・予約回収・R1-runtime/calibrationを認定しない。
native停止理由の優先順は共通関数でdispatch・loop終端・保存検査へ渡す。終端で初めて判明した超過も
取消/exit0より優先し、保存時に超過flagとcompleted/job_exitや別理由が矛盾すれば拒否する。
共有旧予約による拒否を実ゲーム完走に数えず、同じ固定入力のsmoke→停止/再開→日次持越し→校正へ進む。

根拠A: [Node process.cpuUsage](https://nodejs.org/api/process.html#processcpuusagepreviousvalue)は
user/system CPUをmicrosecondで返し、[memoryUsage.rss](https://nodejs.org/api/process.html#processmemoryusagerss)は
現在process全体のresident byteを返す。子processの使用量はこれらに含めず既存所有計測と別に合算する。
CPUは複数threadの合計となり、wall時間を超える値を異常扱いしない。
根拠A: [Windows JobのI/O accounting](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_and_io_accounting_information)
は過去に所属したprocessも含む。実OS回帰は終了した子の削除済み12KiBと親の8KiBで16KiB枠を越え、
JSを停止しても保持root handleが終了code127を返すことを、Job再sampleより前に検査する。
