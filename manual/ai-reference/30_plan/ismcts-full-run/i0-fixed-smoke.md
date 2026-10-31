# I0 固定入力の制御下smoke

`node scripts/ismcts/fixed-smoke.mjs [0..15]`は、固定smoke表の指定した1戦だけを
既存Windows共有予算・所有scheduler・管理出力へ接続する診断入口。
全体会計・R1-runtime・探索校正の受入を成立させる入口ではない。

## 固定入力と実行

引数は凍結した16戦表のindexのみ。deck・seed・席・agent・出力先・上限を指定できない。
8デッキすべてを通常validatorで照合し、指定ペアを専用コピーから取り出す。
カードの削除・代用、manifest/hashの書換え、既存試行の上書きは行わない。

1計算スレッド・1ゲーム・120 policy decision・60秒のengine内時間予算・
連続強制遷移256を指定し、pregameから既存training decision APIで実行する。
agentは候補からseed付き一様選択する計測baseline。raw state/engine引数を選択に使わないが、
候補生成の秘密情報境界・ISMCTS探索・簡易AIの完成を証明するものではない。
同期engineの1遷移を途中で止める60秒のOS期限ではなく、超過は実時間にも残る。

全予約は受付・native helperの準備・30秒連続負荷回復・ゲーム・保存を含む最大10分。
JST日境界へ短縮し、固定された元のwall/単調期限を継承する。
CPU/RAM計測欠落、負荷、service priority、取消しは既存guardへ渡す。
BelowNormal/affinity/native watchdog/所有process終了は既存Windows経路を使用する。
GPUは使わず、Linuxや本番serviceの受入を追加しない。

## 保存と分類

共有`managed-output/<reservation-id>/`へ既存claim・容量再計測・排他作成・fsyncで保存する。
容量検査や同期I/Oの所要時間を一定とは仮定せず、期限不足・保存失敗では予約を保持する。

共有受付で1件予約してから、`fixed-smoke-admission-worker.mjs`を外側Jobの停止rootとして生成する。
所属後に開始し、同じ予約を照合した内側受付がattempt・容量helper・既存ゲームruntime・
内側telemetry保存を実行する。子は新しい予約を取らず、元期限から親保存30秒・内側保存30秒を確保する。
期限不足・owner/枠の不一致は容量検査・ゲーム生成前に拒否する。外側も既存の負荷/service/watchdog制御を使う。

- `artifact-fixed-smoke-attempt.bin`: nativeゲームprocess生成前の固定入力とattempt。
- `artifact-fixed-smoke-sources.bin`: 実行時のengine/card-data/loader/ISMCTS sourceのbyte hash。
- `artifact-fixed-smoke-result.bin`: outcome/終局者/decision・transition数/実時間/truncation件数。
- `artifact-fixed-smoke-failure.bin`: workload失敗時の機密本文を含まない失敗記録。
- `artifact-fixed-smoke-work-telemetry.bin`: [処理別telemetry](i0-work-telemetry.md)の数値集計。
- `artifact-runtime-telemetry.bin`: 検査済みhost/owned/callerのCPU/RSSと終端計測。
- `artifact-fixed-smoke-inner-runtime.bin`: 内側runtimeの診断。上の外側Job集計へ重複加算しない。

raw state・手札・deck順・choice payload・例外本文を結果へ保存しない。
自然終局かつtruncation=0・実時間60秒以内だけをゲーム完走と数える。capped/stuck/errorとdeferredを
勝敗や完走に数えない。root停止・結果欠落も生成前attemptから消さない。
結果は正常終了・所有treeのdrain確認後だけ読戻し、allowlist射影と完全一致を検査する。
これは診断生成物であり、新しいreceipt台帳ではない。

外側の`unreconciled`と`accountingComplete:false`は維持する。CLIは診断が返ってもexit2、
失敗はexit1で、受入成功のexit0を返さない。同じ共有ledgerでは次jobが拒否される。
会計の未計測分を0扱いせず、予約の削除・手動解放・返金を行わない。
source inventoryは開始時のbyteであり、後続のcode変更後へこの実測を流用しない。

外側Jobの集計は内側callerのmodule初期化・実容量helper・保存後tail・終了と内側Jobを含む。
最外Nodeの共有root解決・予約前後scan・最終telemetry保存/読戻し/終了、service・metadata強制は
依然として完全会計外。新経路の存在で旧smokeの欠測を復元せず、旧予約の解放も行わない。
私有OS回帰は本番と共通の受付continuationを有限writer/idle rootで検査する。
共有旧予約での生成前拒否と、実ゲームを通した本番経路の完走は別証明である。

## 残る受入

callerの受付/保存/終了tail・service・metadataを含む全体会計と安全回収、
全writerの強制、Linux、固定8デッキの実走、20局面×3seedの探索速度/fallback率と
資源余裕時の2thread比較が残る。1戦の自然終局でもI0を完了にしない。
`test-fixed-smoke.mjs`は固定席/seed・実行上限の伝播・秘密stateへの非アクセス・
失敗/打切り/不完全候補の分類を既存`ismcts-program` gateから検査する。
この模擬catalog回帰と、別途保存する実機の1戦ログを区別する。
