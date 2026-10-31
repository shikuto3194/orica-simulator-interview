# Lane prompt 索引

現在の範囲・起動間隔・停止条件・統合担当の正源は [Full-run Supervisor](full-run-supervisor.md)。
このファイルは索引であり、実行プロンプト・周期・手順を複製しない。

| 対象 | 読む入口 |
|---|---|
| scheduled worker共通 | [Worker Brief](full-run-worker-brief.md) |
| engine | [Engine prompt](lane-prompt-codex-engine.md) |
| cards | [Cards prompt](lane-prompt-codex-cards.md) |
| 明示的に割り当てられた機械ガード監査 | [Guard-audit prompt](lane-prompt-codex-guard-audit.md) |
| 最終検証 | [Final verification prompt](lane-prompt-final-verification.md) |

通常workerは割り当てられたscopeだけを進める。入口が存在するだけで独立lane・探索・定期監査を起動しない。
Codex-only運用では `orica-engine-claude-iteration` を再開しない。
registryの `lane:"claude"` / `owner:"claude"` は履歴互換値で、現在のCodex takeover契約に従う。

## 統合境界

supervisor / supervisor-sync-recoveryの親ticketを渡されたworkerは、検証・独立査読・verified commit後に `node scripts/supervisor-integration.mjs request` を実行し、treeを変更せず終了する。
親runnerがheartbeatを維持してauto-mergeを実行する。要求受理は公開成功ではなく、remote包含とpublication receiptまで確認する。
親ticketを持たないcard-impl / guard-auditと、対話作業で明示的に公開を依頼された場合は [remote統合](../00_meta/remote-main-integration.md) のforeground auto-merge経路を使う。ticketなしのrequest呼出しは失敗する。
workerはsupervisorのlock・task・通知経路を手編集しない。停止・再開・方針転換はユーザー専権。

## 過去の構成

常時Verify LaneとClaude Engine Laneは廃止済み。過去の定義はGit履歴で参照し、現在の実行指示として再利用しない。
