# I0 計測helperの終端handle

Windows下位制御の入口は[i0-windows-runtime.md](i0-windows-runtime.md)。
計測helperの終端CPUを追加する分割単位であり、I0全体・R1-runtime/calibrationの受入ではない。

`windows-process-handle.cc`のNode-API bindingは、callerが生成したmeterのPIDだけを私有接続から受け取り、
query/synchronize権限の非継承handleを終了まで保持する。公開runtimeに外部PID入力を追加しない。
helperの最終応答、Dispose、process終了のCPUを同じhandleで採取し、PID/生成identity/CPU単調性・signaled/exit0を照合する。
閉じたhandleの再利用と不正receiverを拒否し、異常終了・欠落では正常終端の結果を返さない。
Node内の実行費用はcallerの費用であり、全体会計へ計上済みとは扱わない。

`finish()`は`meterFinal`/`meterCpuComplete:true`と三者の`finalOwnedCpuMs`を返す。
telemetryは欠落・identity/CPU逆転・異常exit・合算不一致を拒否する。
caller/probe/service会計が残るため`accountingComplete:false`と共有予約の全量保持を維持する。

## 明示buildと読込

`node scripts/ismcts/build-process-handle.mjs`はwin32/x64・ローカルMSVCと実Node版のheader/libで明示buildする。
全出力を`artifacts/ismcts/native-process-handle/`へ保存し、三つのsource hash・Node版/archとbinary SHAをmanifestに結合する。
runtimeは生成前にmanifest/実binaryを照合し、欠落・不一致ならhelperを作らない。受付内ではコンパイラを起動しない。
この開発buildは配備成果物の証明ではない。配備先でのartifact hash・toolchain/provenance検証はI5へ残る。
生成binaryはGitへ含めず、必須回帰のbuild出力とlog SHAから実行した版を確認する。

私有実OS回帰はexit259と反復読取、不正PID/receiver/閉鎖handleの拒否、応答後160msの有限CPU tailを確認する。
全体会計、20分runtime、実ゲーム校正、Linux/Armの受入に読み替えない。

根拠A: [GetProcessTimesのkernel/user CPU](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes)、
[終了後もhandleが残るprocess object](https://learn.microsoft.com/en-us/windows/win32/procthread/terminating-a-process)、
[Node-APIのABI契約とobject lifetime](https://nodejs.org/docs/latest-v22.x/api/n-api.html)。
