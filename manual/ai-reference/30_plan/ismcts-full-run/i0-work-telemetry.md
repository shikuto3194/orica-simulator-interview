# I0 処理別の計測 contract

受付 `followup-f95407b05e54aad988ae` の処理別計測を既存I0へ接続する。
正源は `packages/rules-core/src/ai-work-telemetry.ts` の `AI_WORK_UNITS`。
これは診断用の実行コードであり、R1-runtime/calibrationの受入や本番ISMCTSではない。

## 単位と境界

collectorを同期workloadごとに作り、`telemetry` optionで明示的に渡す。グローバルcollectorは使わない。
未指定ならclockを読まず既存計算を実行する。測るのは単調wall時間で、CPU時間・予算ledgerの代用ではない。
結果・state・choice・カード/instance ID・例外本文をcollectorへ保存しない。

| operation | 数える単位と現在の接続 |
|---|---|
| state_copy | MCTSのJSON state複製、game初期stateとtraceのstate snapshotの1コピー |
| hidden_zone_sampling | I1部分samplerのowner別hand+deck母集団割当1回。例外もattemptedへ保持 |
| legal_generation | `getNextTrainingDecision` の1呼出。入力候補を含む場合はinclusiveに含む |
| input_generation | `createActionInputDecisionNode` の1呼出。入力不要のnull返却も含む |
| engine_transition | training decision適用、gameのpregame/system/action/強制advanceの1呼出 |
| heuristic_inference | MCTSの既定heuristic rollout方策またはleaf評価の1呼出 |
| nn_inference | Tiny networkのforward 1回。学習・評価中のforwardも含む |
| nn_training | Tiny networkのtrainBatch 1回。更新ゼロもbatch返却として残る |
| training_update | gradientが非ゼロであるepochのパラメータ更新1回。batch数とは別 |
| decision | MCTS searchまたはgameの方策呼出1回。従属入力・強制候補の方策呼出も含む |
| simulation | 完全情報MCTSのselection/expansion/rollout/backprop 1反復 |
| game | game inner loop 1回。自然終局・capped/stuck/errorは既存結果へ別記 |

`attempted / returned / threw`は呼出の状態である。返却されたgameやbatchを自然終局・実学習成功へ
読み替えない。`training_update.returned`とtrainingStep増分・appliedUpdatesを別途照合する。
同operationの同期再入は外側1回にまとめ、game内MCTS decisionなどを二重計上しない。
異なるoperationの子時間はinclusiveへ含み、exclusiveから差し引く。inclusive同士を合計しない。
未観測は`observed:false / maxMs:null / returnedPerSecond:null`。観測済み0msと区別する。
rateの分母はcollector開始からsnapshotまでのwall秒で、各operationのreturnedだけを使う。
これを自然終局game/s、方策制御decisionSteps/s、CPU利用率へ読み替えない。
失敗呼出もattemptedと時間に残り、分母から除外しない。

snapshotは固定operationの数値のみの新object。開いたscope、逆転/非有限/取得不能clock、
Promise返却は拒否し、壊れたcollectorを後から正常へ戻さない。同期専用であり、
I6の非同期GPU転送・待機を計測する場合は対応するasync境界を実装・反証してから使う。
GPU有効化やCPU時間の推定は行わない。

## 既存の保存経路

固定smoke workerは同じcollectorをgameへ渡し、既存共有予約の管理writerから
`artifact-fixed-smoke-work-telemetry.bin`を保存する。失敗時もfinallyで保存を試みる。
保存失敗は正常結果に変換しない。従来のattempt/result/runtime artifactとsource inventoryを保持する。
新しい成功台帳やreceipt種別は設けず、外側の`unreconciled / accountingComplete:false`を維持する。
これは計測接続であり、今回の実機固定smoke完走を主張するものではない。

## 検証と残条件

`ai-work-telemetry.test.ts`は入れ子時間・単位・例外・未観測・clock破損・同期制約と、
1decision上限の実engine fixtureで結果不変とcapped分類を確認する。
MCTS回帰は同seedのchoice/root統計/state一致と4simulationの計測を確認する。
合法passの直接適用内1回、MCTSの事前/適用内2回の入力生成と、親exclusiveからの控除も確認する。
network回帰は予測・checkpoint一致、batch数と実更新数、更新0を確認する。
Vitest出力の`AI_TELEMETRY_BOUNDED_FIXTURE`は小さい回帰局面の実測であり、
固定8デッキ実戦・20局面×3seed・本番負荷・学習改善の証拠には使わない。

I1/I2の観測限定探索、I3の全入力CLI、I6のbody学習・非同期推論/学習・自律runnerは
同contractを明示的に受け渡す必要がある。現段階で未接続のcallerは未計測のまま扱う。
固定入力と実機resource gateが成立した後、同じworkload/seedで各単位の速度と展開量を測る。
