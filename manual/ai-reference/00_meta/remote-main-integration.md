# Remote main の自動統合

正源は [CLAUDE.md](../../../CLAUDE.md)。固定checkout・lockは
[Full-run Supervisor](../30_plan/full-run-supervisor.md)、gateと証跡は
[検証運用](harness-validation.md)に従う。

## 公開経路

1. wrapperはworker起動前にremote mainをfetchする。失敗時・dirty laneは変更せず次runへ回す。startup同期の全nonzeroは状態を保全し、介入待ちを報告してworkerを起動しない。
2. auto-mergeは要求されたlaneのHEAD・branch・clean状態と既存verifierを確認し、remote mainを再取得する。
   新しい査読のpending contextや、失敗・未完了のlocal artifactがあれば停止する。公開時はlocalの完全な査読証跡を必須とし、稼働helperが全差分・全変更ファイル（削除・種別変更を含む）の記録・6つのlens・未確認範囲なしを確認する。旧commit証跡だけでは公開せず、独立再査読の成功証跡を要求する。
   fetchごとの専用refでSHAを固定する。共有FETCH_HEADや古いorigin/mainを成功判定に使わない。
3. remoteを含まない場合は、新しい`remote-main-<attempt>-<round>` worktreeだけで候補をrebaseする。
   共有Git設定に依らず候補外のbranch refを更新しない（`--no-update-refs`）。
   開始時のlocal mainが元候補または取得remoteの祖先であることを確認する。既に公開されたlocal mainの先行は取り込めるが、どちらにも含まれないlocal履歴は停止する。`NoPush`は元laneがlocal mainを含む場合だけ許可する。
   元lane・local main・公開済みrefをrebaseしない。元履歴を通常mergeで結び直し、その操作でrebase後のtreeが変われば停止する。
   これによりlocal mainへの反映は引き続きff-onlyであり、元のcommitも失わない。
4. 候補にlockfileどおりの独立依存を用意し、既存merge gateと必要なfuzzを実行する。
   同じGit共通directoryの検証leaseを使用し、稼働validatorを停止しない。
5. 新しい候補は完全diffを新しいread-only Codex verifierへ渡す。内容が同じ履歴統合も明示的な空差分promptで査読し、gate・tree・履歴を確認する。
   稼働wrapperと同じく新しいインストール済みCLIを優先する。読取helperの起動失敗時は通常のコマンド単位承認を使い、承認拒否・読取不能は停止する。設定・認証・sandbox方針は変更しない。
   reportの欠落・JSON不正・未確認・反証は停止。成功後は既存verified-commitで最終treeの証跡を埋め込む。
6. merge lock取得後にlocal main・元lane・verifier・最新remoteを再確認し、ff-onlyと通常pre-pushを通してpushする。
   元laneと候補の両方の査読証跡をgate後・lock内の最新fetch後・ff-only後のpush直前に再確認する。元laneで新しい査読が開始・失敗したら停止し、既に進んだlocal mainは保持する。
   公開対象の元laneと候補が同じwriter protocolに対応していることを起動時と最終guardで確認する。旧writerのcheckoutは変更せず停止し、通常同期後の新しい独立査読を要求する。旧commitの通常読取りは維持する。
   `spawn-verifier` と `verifier-evidence record` も証跡の変更前に同じmerge lockを独自tokenで取得する。公開中のwriterは証跡を触らず失敗し、終了後に再試行する。writer専用の親processがheartbeatと解放を担当し、同期I/Oや子の失敗終了でも所有権を維持する。公開側は成功記録・receipt保存までlockを保持する。
   公開ごとの独立hook wrapperは元のpre-pushを同じ引数・stdin・cwdで実行し、成功後に元lane・候補・統合先のHEADと査読を再確認する。共有hook設定は変更しない。
   公開後・成功記録の最終fetch後・親ticketのremote確認後にも同じattempt bindingを検査する。公開後の失効は履歴を保持して失敗報告し、成功receiptを出さない。
   検証中またはpush中にremoteが前進した場合だけ新候補を作り、gateと独立査読からやり直す。最大3回。拒否後の観測SHAも次回の比較基準に保存し、その後の巻き戻り・分岐は停止する。
7. 公開SHAが取得したremoteの祖先であること、local main・最終tree・元要求SHA・attemptの一致を確認する。
   公開直後の追加commitは成功を否定しないが、remote読取失敗や履歴の不一致は成功扱いにしない。
   新たな完了記録にはpublication guardを必須とし、親runnerはschema v2のreceiptと同じguardのattemptだけを受理する。旧形式やguard欠落から新しい成功を生成しない。
   新形式の親ticketは`validatedTree`の存在と公開treeとの一致を必須とし、欠落記録で以前の統合失敗を隠さない。

## 失敗・回復

- supervisorは新しい実装・同期の前に前回の公開要求を照合する。owner/child終了、保存されたworker成功、要求HEAD・branch・clean状態が再開の条件。旧形式でowner不明の場合はプロセス・run記録を調査するまで停止する。
- lease待ちはattemptを失敗履歴に残したまま親ticketを`waiting`にする。通常pre-push内の75も、同じguardのattempt・source・candidateに結び付けて伝達する。テスト失敗・接続失敗を待機扱いにはしない。
  healthはworker成功と同じ要求の試行履歴・時刻が一致する待機を失敗から分離する。merge/pushのblocked gateも既知のlease理由とその試行内の時刻を必要とし、不明な記録は異常に残す。`--exit-on-finish`は`worker_completed`・`publication_pending`でも終了するが、公開完了とは表示を分ける。
- 再開は同じ候補worktree・HEAD・tree・index・祖先保存merge・Git common directoryを照合する。独立査読前の`MERGE_HEAD`も保持する。remoteが変わらなければ候補と有効な査読を再利用し、remote前進時は新候補を正規検証する。公開前に進んだlocal mainも履歴を保持する。
- 再起動間のremote後退・分岐も停止する。査読commit直後の中断は、保存HEAD/MERGE_HEADに厳密一致する親・同一tree・操作終了・現HEADとarchiveの査読証跡一致を満たす1commitだけ回収する。子PID未保存でも同じattempt・source・laneの子側記録を照合する。起動有無が不明なら待機し、終了を確認してから保存checkpointへ戻る。
- `DeferReview`は利用上限中の新規査読だけをgate前から待機させる。既存の有効査読と通常公開guardは省略しない。再検証では既存gate cacheを使うが、同一入力の成功を証明する契約がないfuzzを結果だけで省略しない。
- remoteに元要求SHAが含まれる場合、`resolution.kind=included_in_remote`として旧status/errorと観測SHA・日時を保存する。旧attemptのgate成功や公開receiptを作り直さない。healthはGit祖先関係・source/branch/lane一致・観測以前の記録時刻を確認して旧失敗を解消し、同じHEADでも後発の失敗や実行中attemptを隠さない。
- healthの`lastReconciliation`は包含を確認した時刻、`lastSuccess`は通常公開の完了時刻。過去成果の照合を新しい公開として数えない。
- fetch失敗、競合、local mainの並行更新、dirty、gate/verifier失敗、所有lock喪失は停止して理由を残す。
- 競合candidateはそのまま保存する。ours/theirs、自動競合解消、force push、他作業のreset/clean/stashは行わない。
- push再試行には当該attemptに紐づく広告SHA、porcelainの明示的な競合拒否またはguard拒否記録、remote前進の確認が必要。Gitが広告SHAをstdinに渡さない拒否は復旧fetch・再試行前に停止する。通常hook・認証・接続の失敗も停止する。
- `logs/auto-merge-runs/<id>.json`と親ticketに元SHA・公開SHA・treeを記録する。
  ISMCTSのreceiptは元SHAの査読に加え、公開SHAの査読・tree・元SHAとの祖先関係・scope内の全path集合と入力blobの一致を検査する。
  候補・fetch ref・失敗ログは診断用に保持し、稼働用途を確認した別の整理作業まで削除しない。
- 稼働scriptは固定main統合treeから次回の通常実行時に読み込まれる。workerの強制再起動やスケジュール変更は不要。

実Git回帰は`test-remote-main-integration.mjs`、親runnerとの結合回帰は
`test-supervisor-integration.mjs`、再開・重複防止は`test-supervisor-publication-recovery.mjs`。handoff gateから実行する。

最終fetchのSHAとpre-pushのremote旧SHAを照合する。未知の旧SHAはguard固有の記録を残してpushを停止し、再取得後に「最終fetch→広告SHA→再取得SHA」の祖先関係を確認して再検証へ戻る。巻き戻り・削除・分岐は公開しない。通常hookの引数とstdinはそのまま再生する。
