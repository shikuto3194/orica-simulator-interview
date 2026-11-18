# 2026-09-29 フルラン障害の原因と再発防止

運用は [監査効率運用](full-run-efficiency.md)、画像の再照合は
[原文確認記録](source-review-2026-09-29.md) を参照。時刻は日本時間。
信頼度A: 保存された実行記録・Git差分・現在画像を一次証跡とする。

## 原因と対策

| 問題 | 原因 | 防止策・回帰 |
| --- | --- | --- |
| 訂正済みカードの巻き戻し | 9/23の共有ミラーの存在・hash一致だけで正しさを判断し、配布元の版と訂正履歴を確認しなかった | 配布元revision・内容hash・根拠をprovenanceで固定。未承認/版不一致は比較前に失敗。`test-audit-operations.mjs` とカードの盤面回帰で検証 |
| push未完了を「認証待ち」と報告 | 長時間コマンドの継続IDを回収せず、GitのPID生存だけで状態を推定。統合処理がworker CLI配下に残ったままworkerが終了 | 親runnerがcommit済みHEADの統合要求を受け、CLIの正常終了後にauto-mergeを所有。子のclose・実終了コード・local/remote HEAD一致まで完了にしない |
| 失敗詳細を追えない | gate receiptに終了コードしか残さず、出力は終了するworker側へ流していた | gate/統合のstdout・stderr・実行中状態を逐次保存。途中終了を成功証跡として再利用しない |
| merge後にpushで全件再検証 | 検証したlaneからprimaryへ実行場所を変え、checkout固有の証跡が再利用不可になった | 検証済みlaneから通常pre-push経由でpush。root・入力・依存・環境・比較元は厳密照合。ledgerは毎回実行 |

6枚の画像を再照合し、BSTH11の3枚を復元した。他3枚は現在画像と一致するため維持した。
値を変更した回帰テストが緑でも、参照元自体の正しさは証明できない。
原文・画像・訂正履歴の照合を先に行い、hashだけの自動承認は行わない。

## 追加回収した終了記録

対象threadは `01a0ec2e-1fb7-7530-a7ed-c983c2941119`。
rollout中の `CommandExecution`、ID `exec-8f017c50-2bf6-411d-9010-1406a4fb9cd0` から
auto-mergeの出力を回収した。ローカル保存先は
`artifacts/full-run-20260929-recovered-auto-merge.log`。

| 時刻 | 一次証跡 |
| --- | --- |
| 18:59:57 | primaryでpush profile開始。認証の前にpre-push検証が動作 |
| 19:09:26.609 | workerが最終応答を返す |
| 19:09:27.346 | workerの `task_complete` |
| 19:09:27.641 | 実行中auto-mergeが `status=failed`, `exit_code=-1` で終了。実行時間1439.6秒 |
| 19:09:28.173 | harnessがVitest exit 1を記録。前22gateは成功 |

receiptは `logs/harness/runs/1790675997657-9284.json`。
回収出力はテスト実行途中で終わり、最終集計や失敗assertionの説明を含まない。
**未完了の検証を残したworker終了と、その直後のコマンド異常終了は確定**している。
CLI終了に伴う子コマンドの打ち切りが直接の原因と考えられるが、個別のVitest内部エラーは断定しない。
認証待ちを裏付ける証拠はなく、その引き継ぎは訂正・解消した。

## 同じ終了タイミングの再発検査

`test-supervisor-integration.mjs` は一時Gitリポジトリとbare remote、実際の
`auto-merge.ps1`・pre-push hook・`worker-codex-stream.mjs` を使用する。
外部通知・検証gate・ロック/primary事前検査はfixtureに置き換える。
プロセス待機・Gitフック・push・終了後のHEAD照合は実処理を使い、実環境のrunやremoteには触れない。

1. fixture CLIが統合要求を保存して正常終了する。
2. pre-pushをbarrierで保留し、親runnerが生存、状態がintegrating、統合要求がrunning、
   完了時刻・最終通知が未確定、remoteが未更新であることを検査する。
3. hookを失敗終了させ、末尾stderrまでログ保存、run/要求がfailed、error通知、remote未更新を確認する。
4. 新しい要求で再試行し、正常終了後だけcompletedとremote HEAD一致を確認する。

worker単独の編集でもhandoff gateを選ぶ。統合処理・専用回帰も同じ検査範囲に登録し、
`test-harness.mjs` がfinish/push両方の選択を検査する。エンジン変更が混在すれば全検証へ昇格する。

## 確認範囲

先行修正 `77da740bd` は全23gate・Vitest 18,121件・GUI/REST 2シナリオ・独立verifierを通過し、
remote main一致とprimary cleanを確認済み。push検証は22gate再利用、ledger再実行で22.7秒。
GitHub CI run `36575370040` はアカウントの支払い/利用上限によりjob開始前に停止しており、
コード検証の失敗とは区別する。カード監査reviewの解消は引き続きフルランの別作業である。
