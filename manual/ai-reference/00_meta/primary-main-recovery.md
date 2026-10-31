# オートマージのprimary復旧

`auto-merge.ps1` は登録済みのcleanなmain統合tree、laneの検証証跡と全gate、ff-only成立を要求する。
フルランがcommitを作れても、この前提が欠けると統合は進まない。
専用main tree固定時は[固定先規定](../30_plan/full-run-supervisor.md)を優先し、primaryの対話branchを保全する。本書のprimary復帰はmainが他treeに占有されていない場合だけの手動操作。

## 診断と安全な復帰

`node scripts/primary-main.mjs --repo C:/dev/orica-simulator` は読取専用で理由を返す。
`--restore` はmerge lock取得後に再確認し、cleanなdetached HEADが次のどちらかの場合だけmainへ戻す。

- HEADがローカルmainと同一。
- HEADが取得済みorigin/mainと同一で、ローカルmainがその祖先。mainを比較交換でfast-forwardし、同じcommitへ接続する。

他branch、dirty、merge/rebase等の進行中、他worktreeで使用中のmain、独自detached commit、分岐は変更しない。
Git照会失敗も成功扱いにしない。ネットワーク取得・stash・reset・分岐の自動mergeは行わない。
wrapperとauto-mergeは`full-run-checkouts.mjs`で固定先を照合し、primaryを自動復帰しない。
手動復帰後もverifier・全gate・merge lock内の再確認は必須。

## 分岐を伴う場合

1. primaryとlaneのstatus、HEAD/main/origin/main、reflog、各側だけのcommitを確認する。
2. 実行中workerのtreeを変更せず、統合対象をcommit SHAで固定する。originを取得し、ローカル未送信commitも失わない形でprimaryにmergeする。
3. 統合差分に応じたfinish-check、必要なGUI+REST、敵対的verifierを通し、verified commitを作る。
4. 元mainが統合commitの祖先であることを確認し、mainをfast-forwardしてcheckoutする。通常のpre-pushを通してpushする。
5. cleanなmain、remote反映、lane統合範囲を再確認する。後続workerは通常のmain同期で新しい正源を取り込む。

2026-09-28の障害では、PR作業後にprimaryがdetached HEADとなり、ローカルmainだけの2commitと
GitHub側の10commitが分岐した。laneは古いローカルmainを同期し続け、auto-mergeのprimary検査で毎回停止した。
単にmainをorigin/mainへresetすると未送信修正を失うため、双方の履歴を保全する統合が必要だった。
再発防止は[CLAUDE.md](../../../CLAUDE.md)の完了時main復帰、preflight診断、共有復旧処理、実Git回帰で行う。
