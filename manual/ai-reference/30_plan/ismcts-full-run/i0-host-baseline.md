# I0 平常負荷の計測

`host-probe.mjs`の`observeHost()`は平常負荷30秒を観測する。
これは校正の開始候補判定であり、所有process制御・実ゲーム校正の受入ではない。
R1-runtime/calibrationのgate未登録とI0未完了は維持する。

## Windows native counter

従来の各点はPowerShell/CIMを同期起動していた。2026-10-16の実測では1点に約3.1秒かかり、
2秒周期・最大3秒の計測条件を超えた。受付閾値を上げず、既存Node-API bindingへ
`GetSystemTimes`と`GlobalMemoryStatusEx`の集計取得を追加する。
追加process・CIM・アプリ名・command line・環境・秘密情報は取得しない。

`windows-process-handle.cc`の`host()`は引数を受けず、集計CPUのUInt64文字列、
空き/総RAM byte、論理CPU数、processor group数だけを返す。
GetSystemTimesの計測範囲に合わせgroupが1以外なら拒否する。
型・範囲・必須own data fieldをJSでも照合し、追加fieldやserialization hookを写さない。
累積CPUをNumberへ丸めず、BigIntの区間差分から利用率を求める。
kernelに含まれるidleは1回だけ引く。逆転・ゼロ区間・host構成変更は拒否する。

native artifactのbuildは従来の明示的な検証/配備工程で行う。

```powershell
node scripts/ismcts/build-process-handle.mjs
```

読取は既存source/binary hashを検査してからloadする。未build・古いbinary・改変は失敗とし、
受付時のcompiler起動やCIMへの暗黙復帰は行わない。
このbindingはWindows x64用。Linuxは既存`/proc/stat`経路を維持し、
Windows Arm対応やLinux実機確認をこの変更の成果に数えない。

## 連続観測と証明範囲

両OSとも最初のcounter点から2秒待って初めてCPU百分率を得る。
それをanchorに、2秒間隔15点を追加する。初回をCPU0%として30秒を短縮しない。
16点のCPU40%未満・空き6GiB以上、30秒の持続、probe時間と欠落/遅延を
既存`hostEligibility`と`resourceMachine`で検査する。失敗は開始許可へ変換しない。
実ログは`artifacts/ismcts/`に保存し、その時点のhostとsource/native artifactへ結合する。
生成前の既存storage受付と保護規則も適用する。

単独回帰の模擬counterはUInt64精度・欠落・逆転・不正group・遅延拒否を検査する。
実hostの2点読取はAPI接続だけを確認する。別途保存する16点の連続観測と区別し、
それが成功しても固定8デッキ実戦、20局面×3seed、2thread比較、全体会計、
本番GUI・配備・120分移行・強さ実証を達成したとはしない。

根拠A: [GetSystemTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getsystemtimes)、
[GlobalMemoryStatusEx](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-globalmemorystatusex)。
