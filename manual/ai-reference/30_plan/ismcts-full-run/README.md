# ISMCTS 実装・検証・継続運用

2026-10-05本人指示: 詳細設計を固定しフルランworkerが実装と検証を担う。
VMを確認し、確保不可ならPC CPU/GPUを予算内で使用する。実装・稼働確認後は
同じsupervisorを120分間隔へ移し、監視・修正・必要な対応を継続する。
2026-10-06本人承認: 資源が許す限り24時間、対戦生成・学習・評価・モデル更新を自律反復する。
120分は当初のLLM成果確認周期。LLMが停止・利用制限中でも学習runnerは独立して動く。
一人バトルは現行モデル→旧正常モデル→学習モデル不要の簡易AIへ復帰できることを必須にする。
旧2026-09-23の「AI対象外・監査0でdisable」は本programに対して失効する。

## 読む順序

1. 本書と [tasks.md](tasks.md) の最初の未完了タスク。
2. 対象の [design.md](design.md)、[resources.md](resources.md)、[evidence.md](evidence.md)。
3. 稼働・移行を触るときだけ [operations.md](operations.md)。
4. 配置の判断根拠は [開始前の実機・VM確認](readiness-2026-10-05.md)。
5. I0分割実装のCLI・現在の境界と残条件は [controller入口](i0-controller.md)。receipt照合は [検査契約](i0-receipts.md)。
6. I1のplayer部分合成は [資源・公開提示](i1-player-resources.md)、時計/step/turn予約は [公開の進行component](i1-turn-schedule.md)。
7. I6/I7は [継続学習](continuous-learning.md)、I4以降は [一人バトルの復帰](solo-fallback.md)。

workerは `gpt-6.1-sol / xhigh`、新規文脈、既存engine-drain単一ライター。
公開APIを独自に作り直さずPlayerDecision/AiObservation/engine primitiveを使う。
1 runで検証可能な節目を進める。会話履歴・完了の自己申告で進捗を復元しない。
gate→独立verifier→verified commit→親runnerへの統合要求の順を維持する。
統合要求後は編集を終え、親runnerが終了コードとremote mainを確認する。

## 完了の区別

- 実装済み: 全受入条件と必要gateを証明したcommitがmainへ統合された。
- 稼働確認済み: 採用VM/PCの配備版でGUIから終局・負荷制御・障害回復を確認した。
- 自律運用確認済み: LLMなしで生成・実学習・評価・再開が進み、自動昇格/復帰を反証した。実昇格の有無は別記する。
- 監視移行済み: 固定評価gateも満たし、120分設定の読戻し・次回起動を確認した。実OS再起動の未観測は別途明記する。
- 強さ: 固定ガントレットの数値を報告。「プロ並み」は別途対人評価を要する。

第1稼働版は学習不要のISMCTS＋観測限定heuristic。第2段階でNN探索接続、
body/optimizer学習、自律runner、checkpoint自動昇格・配備・復帰を実装する。構築PSROは今回の完了条件外。
既存ルール不具合は必要な範囲で修正し、誤検知の黙認・baseline緩和はしない。

## 起動条件

今回の依頼は数値予算・VM経路確認・設計引継ぎ後の開始を承認する。
I0の資源制御を検証するまでは大量自己対戦・学習を起動しない。
既存監査は計測失敗と残件を処理し、監査0で本programを停止しない。
program controller未配置時はwrapperがI0を明示。controller破損・不正出力・異常終了は
修復対象とし、初期状態・完了に読み替えない。

## 既存正源

- [AI設計](../../20_design/14_dl-ai-architecture.md)、[観測contract](../../20_design/16_ai-observation-contract.md)
- [学習構成](../../20_design/15_ai-training-configuration.md)、[VMとPC代替](../../00_meta/oracle-ai-deployment.md)
- [検証ハーネス](../../00_meta/harness-validation.md)、[容量管理](../artifact-storage.md)

本書は採用済み実装計画。設計文書の存在だけでは実装済みと判定しない。
