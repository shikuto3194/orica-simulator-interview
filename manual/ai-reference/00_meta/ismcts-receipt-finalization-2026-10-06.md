# I0分割証跡の最終化と再開点

2026-10-06のworker dispatchは、履歴を保持したISMCTS証跡/controller修復。
前runの修復commit `db5414188` を再実装せず、親統合後の未最終化receiptを
現runtimeで検査し、既存`ismcts-program.mjs record --receipt`で最終化した。

## 照合した根拠

- 親ticket `ac32f8a9-7a3b-4f08-9f2b-0be977aef6ed` はcompleted、exitCode 0。
  auto-mergeログのremote main verified、`git ls-remote`、local mainを照合した。
- laneと専用mainでcoverage/fidelityを新規計測し、todo・違反・active reviewは全て0。
  両treeのreview contextは一致する。audit stateはcheckoutの絶対パスを含むため
  tree間では異なるが、各tree内のcoverage/fidelityは一致する。
- 最新2receiptの40入力manifest、scope/runtime、実harness run、ログSHA、凍結tree/base、
  後続関連履歴を現コードで再評価した。最終化は保存verifier archive、commit埋込みreport、
  検証tree、親ticket、main/origin-main祖先も既存検証経路で照合した。
- 旧16receiptは失効理由付きで全件保持し、ファイル集合と旧16件の内容hashが不変と確認した。
  最新2件だけにfinalizationを付与し、計18件を保持した。

## 現在の受入状態

| I0 acceptance | state | 根拠または残条件 |
|---|---|---|
| E1 | valid | receipt `3944d9f3-ff46-4af7-bf0d-f1bbae3f8e85`、verified_and_integrated |
| R1-budget | valid | receipt `b603b612-1e97-4ec2-842d-aa630e06b67b`、verified_and_integrated |
| R1-runtime | unverified | no_receipt、所有process制御などが未実装 |
| calibration | unverified | no_receipt、固定8デッキ・実ゲーム校正が未達 |

controllerの実planはI0/unverified、skipWorker=false。
workerFocusはR1-runtime/calibrationの実装・検証。旧失効receiptの削除や
未達acceptanceの除外をせず、今回有効化した分割単位と親I0の完了を区別する。

## 資源と再開

開始点と2秒間隔15点のhost実測は、CPU最大21%、空きRAM最小6.556GiBで
hostEligibilityを通過した。これは当該30秒の開始候補条件だけを証明する。
所有processの停止・再開・RSS制御は未実装であり、今回ゲームsmokeを実行していない。
次runは開始直前に再計測し、[I0残条件](../30_plan/ismcts-full-run/i0-controller.md)の
所有process制御、24時間目標への履歴保持migration、固定デッキ、校正を依存順で進める。

詳細の実測・照合JSONと旧receiptの変更前hashは
`artifacts/ismcts/receipt-finalization-20261006/`に保持した。
親統合ログ/ticket、各finalized receipt、`status-after.json`、`plan-after.json`、
`history-preservation.json`、lane/main fresh監査、`host-baseline.json`を参照する。
この最終化は既存実runの受入検査であり、全Vitestの再実行や実ゲーム性能の証明ではない。

配備・自律学習・120分監視移行・強さ実証は未達。監査0で停止せずI0→I7を継続する。
workerはtask周期/disable、supervisor lock、primaryの別task、課金VMを変更していない。
