# 資源予算と校正

2026-10-06本人指示: 資源が許す限り24時間の対戦AI強化を目指す。
以下の瞬間的な負荷上限・他作業優先は維持する。時間予算は後述の承認済み移行を実装する。
それ以外の上限引上げ・有料VM移行は本人指示を要する。
同一ホスト上のAIサービス・対戦生成・学習の合計で管理し、子プロセスに別枠を与えない。

## 実機根拠（2026-10-05）

読み取り確認: i7-14700KF、20コア/28論理CPU、RAM31.85GiB、空き6.31GiB。
RTX4070: VRAM12282MiB、使用1435MiB、GPU10%、46℃。
瞬間値であり余力保証・探索速度の実測ではない。32GB全量をAI予算にしない。

## PC共用profile

| 項目 | 初期値・動作 |
|---|---|
| 重い計算 | 1ジョブ、計算スレッド合計2、BelowNormal。BLAS/OMP等も合計に含む |
| RAM | AIプロセスツリー合計2GiB soft/3GiB hard。開始時空き6GiB以上 |
| RAM停止/再開 | 空き4GiB未満で背景計算停止。6GiB以上が30秒で再開 |
| CPU監視 | 2秒間隔。全体60%以上が10秒で背景停止、40%未満が30秒で再開 |
| GPU | 初期無効。I6でadapterと資源制御を実測した場合のみ有効 |
| GPU有効時 | 1ジョブ、batch16以下、AI VRAM3GiB以下。空き6GiB以上・全体25%以下が30秒で開始 |
| GPU停止 | 空き4GiB未満、全体70%以上が10秒、または80℃以上。75℃未満かつ開始条件で再開 |
| GPU占有 | 1秒窓の計算時間目標25%以下、単一batch50ms以下。使用率hard capとは報告しない |
| オフライン | 1チャンク20分以内で連続再開。定常目標はwall24時間/日、2スレッド合計CPU48時間/日。GPUは下記移行条件 |
| 監視対戦 | 1 tick最大10分、合計60分/日。上記オフライン予算に含む |
| 保存 | 新規AI生成物2GiB/日、program20GiB soft。artifact-storageの上限と保護規則も適用 |

サービス応答を背景ジョブより優先し、受付時に背景計算へyieldさせる。
他作業のprocess停止・優先度変更、グローバルGPU電力制限変更は行わない。
当programの所有PID/子だけを管理する。GPU→CPU切替時も共有予算を再取得する。
計測欠落時は背景ジョブを開始しない。対戦要求は低予算CPU経路かbusy応答へ進む。

## 探索・サービス予算

| 項目 | 値 |
|---|---|
| 同時探索 | 全profileで1 |
| 思考時間 | soft1500ms/hard3000ms。行動と従属入力をまとめた1手に共有 |
| simulation | 最大512、時間優先。初期校正64 |
| rollout | 最大64 decision、強制遷移も含む別上限256 |
| 木 | 最大20000 node/128MiB。上限時は既存統計から最善手 |
| queue | 全体4件、session1件。待機2秒でbusy、要求全体timeout5秒 |
| 要求 | 非圧縮JSON2MiB、body読込5秒。超過413 |
| 中断 | 協調停止100ms目標。同期engineが越す場合は専用workerをdeadlineで終了 |

時間切れは訪問数最大の現行合法手。未評価なら観測限定heuristic、理由を記録。
合法手不存在・再構成不一致・版不一致を適当なpassへ変換しない。
競合時はrollout/iterationを減らし、守れなければbusyとGUI再試行表示を使う。

## 性能単位と見積もり

[処理別telemetry](i0-work-telemetry.md)でコピー・候補生成・遷移・推論・学習と上位work単位を分ける。
遷移/sからsimulation/sへ直接換算しない。実測simulation数、平均遷移数/回、decision数/局、
実wall予算と待機時間から見積もりを更新する。2thread上限を20コアへ外挿しない。
GPUはI6受入と資源gate後、同workload/seedのbatch転送・待機・総wall・数値差・VRAM・実応答で比較する。

## VM profile

無料A1: 2 OCPU/12GB第一候補、1 OCPU/6GB第二候補。探索スレッド各1本、
AI RSS hard3GiB/2GiB、空きRAM2GiB/1.5GiBを確保。GPU・本学習はVMへ置かない。
同じfixtureをArm実機で測定。無料枠・割当・通信経路未確認ならPCを使う。

## I0校正と証跡

1. システム情報と平常負荷30秒（開始時点に加えて2秒間隔15点）を保存。他アプリの内容・秘密情報は記録しない。
2. 1スレッド・1ゲーム、最大120 decision/60秒のsmokeでピークRSS/CPUを測定。
3. 余裕があるときだけ2スレッドと比較。探索fixture20件×3seedのp50/p95/max・fallback率を保存。
4. 疑似計測値を注入する回帰と、他作業と並行した実機観測を分ける。大量stress processを起動しない。
5. 閾値跨ぎ・計測不能・予算超過・中断再開・子孤児化を回帰検査。Windows/Linuxで所有process treeを制御する。
6. 未達は改善タスク。候補削除・結果除外・上限引上げで合格にしない。

使用量はprimary共有ledgerへatomic保存。再起動・worktree変更でリセットしない。
予算待ち `deferred_budget`、競合待ち `deferred_load` を勝敗・検証成功に数えない。
workerの検証CLIも並列2以下にし、必要な全件gateの内容を削らない。

## 24時間目標への時間予算移行

schemaVersion 2のJSONはwall86400000ms、CPU172800000msの会計上限を持つ。
旧3時間wall/6時間CPU/30分GPUのJSONは`resource-profile-bootstrap.json`へ保存する。
所有process制御・校正の受入は別で、時間上限の移行だけで大量実行を許可しない。
GPUは能力・負荷gate成立後のみ有効化し、active21600000ms/日（24時間×目標占有25%）を上限とする。
GPU上限到達時もCPU経路で継続できるようにし、GPUを24時間占有する許可とは扱わない。
この移行は本人の24時間指示に基づく。CPU2thread・RAM3GiB・GPU VRAM3GiB・温度/停止閾値は上げない。

旧ledgerは`migration_required`で拒否する。共有rootの`migrate-budget`を明示実行し、
active予約（終了済みownerの未回収も含む）があれば拒否する。旧ledgerは元bytesのSHA付きで保持し、
全予約・使用量・日付をschema 2へ持ち越す。中断は同じ保存元・targetの検査後だけ再試行する。
保存元・履歴prefix・移行journalの不一致は拒否し、失敗は`repair_required`へ保存する。
完了後も保存元から初回targetを同じserializationで再構成しjournalのhashへ結合する。
後続jobによる正規なledger更新は許可し、保存元差替えやtarget hash改変は拒否する。
各schema 2書込みは順序付きSHA名の`budget-checkpoint-*.json`へcanonical元bytesを保持し、
`budget-initialized.json`へ最新保存先・hashをpending保存して、ledger保存後にcompletedとする。
保持された最新checkpointと異なる古いschema 2 snapshotや、台帳と参照の同時巻戻し、
checkpoint欠落・破損は拒否する。
保存列間の遷移も既存履歴を保持する予約追加、同じactive予約の出力claim、完了へ限定し、
古い内容を新sequenceで付加した巻戻しや完了済み履歴の書換えを拒否する。
管理出力は共有transaction内でpayload byteを先にclaimし、checkpoint保存後に新規fileへ書く。
claimは予約枠内の単調増加だけを許し、書込み失敗・再起動でも返さない。
完全会計の完了でも出力量をclaimより小さく申告して返却できない。
管理APIは小容量のimmutable artifact用で、全moduleの書込みや完全会計の受入ではない。
予約追加は通常APIと同じ制約判定を通し、監視tick600000msの上限も保存列で照合する。
pendingでは通常操作を拒否し、明示`migrate-budget`が正規ledgerのhash一致時だけ完了する。
ledger保存前の中断は自動で古い台帳へ戻さず修復待ちとする。
ledger削除・使用量リセット・owner無視はしない。未初期化なら会計を新規作成せず、その状態を返す。
`reserveNextChunk`はJST日境界までの残時間へ予約を短縮する。翌日に同じ共有rootを再度呼ぶ契約で、
日次の手動resetやLLM tickを要しない。自律runnerへの接続・実機中断再開はまだ未達。
日次時間枠は会計上の上限で、24時間の連続稼働や性能の保証ではない。負荷・出力量・異常時は中断する。
生成・学習・評価の配分は[継続学習](continuous-learning.md)に従い、評価枠を先に確保する。

## JSON profile の機械照合

現在の数値正源は `scripts/ismcts/resource-profile.json`。以下は現行値の照合用の写しで、
`test-ismcts-program.mjs` が全値の一致を検査する。GPU は無効を維持する。
この写しはruntime制御・校正・実稼働の証跡ではない。

<!-- ismcts-profile:start -->
```json
{
  "schemaVersion": 2,
  "id": "pc-shared",
  "compute": {
    "jobs": 1,
    "threads": 2,
    "priority": "BelowNormal",
    "sampleMs": 2000
  },
  "ram": {
    "softGiB": 2,
    "hardGiB": 3,
    "startFreeGiB": 6,
    "stopFreeGiB": 4,
    "resumeMs": 30000
  },
  "cpu": {
    "stopPercent": 60,
    "stopMs": 10000,
    "resumeBelowPercent": 40,
    "resumeMs": 30000
  },
  "gpu": {
    "enabled": false,
    "jobs": 1,
    "batch": 16,
    "vramGiB": 3,
    "startFreeGiB": 6,
    "startPercent": 25,
    "resumeMs": 30000,
    "stopFreeGiB": 4,
    "stopPercent": 70,
    "stopMs": 10000,
    "stopCelsius": 80,
    "resumeBelowCelsius": 75,
    "windowMs": 1000,
    "targetActivePercent": 25,
    "batchMs": 50
  },
  "offline": {
    "chunkMs": 1200000,
    "wallMs": 86400000,
    "cpuMs": 172800000,
    "gpuMs": 21600000,
    "monitorTickMs": 600000,
    "monitorMs": 3600000,
    "outputBytes": 2147483648,
    "programSoftBytes": 21474836480,
    "timeZone": "Asia/Tokyo"
  },
  "search": {
    "concurrency": 1,
    "softMs": 1500,
    "hardMs": 3000,
    "simulations": 512,
    "calibrationSimulations": 64,
    "rolloutDecisions": 64,
    "forcedTransitions": 256,
    "nodes": 20000,
    "treeBytes": 134217728
  },
  "service": {
    "queue": 4,
    "sessionQueue": 1,
    "queueMs": 2000,
    "requestMs": 5000,
    "bodyBytes": 2097152,
    "bodyReadMs": 5000,
    "cancelTargetMs": 100
  }
}
```
<!-- ismcts-profile:end -->
