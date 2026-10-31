# フルラン統合の監視

`node scripts/watch-supervisor-events.mjs --once --json` は監視用の軽量snapshotを返す。
`pnpm supervisor:status` にも統合状態を表示する。watchの1秒ループではプロセス照会を増やさない。
実行モデル・run ID・worker状態と、統合状態・実プロセス・所有者付きlock・実進捗を別に確認する。
JSONのattention/unknownは終了コード1、watchは注意を要する待機であり、それだけでは停止を意味しない。
既定はGit共通directoryからprimaryを求め、共有hubを読む。統合先異常もsnapshotに報告する。
`--repo C:/dev/orica-simulator`や`--state <path>`による明示指定も維持する。

## 読み取り対象と成功証跡

- 現行runはrunnerのrun ID・startedAtとmetricsを照合する。旧runnerはstartedAtで照合する。未計測のafter/pendingを0と扱わない。
- parentのintegration ticketとforegroundを含むauto-merge attemptを区別する。新runnerはticketのパスも記録する。
- `logs/auto-merge-runs/<id>.json` にpreconditions、検証、merge lock待ち、ff-only、push、終了を記録する。
- completedは実際のlocal/remote mainが対象SHAと一致した場合だけ記録する。NoPushはlocal_onlyであり公開成功に含めない。
- mainのworktree/ref/clean状態は`full-run-checkouts.json`が指定する登録済み統合treeから読む。primaryの対話branchは統合可否の条件にしない。設定とmainの占有先が違う・lock済み・dirty・Git操作中なら統合先の問題として報告する。
- 最終成功は該当laneのcompleted/remote一致証跡を選ぶ。main reflogの更新時刻とは区別する。
- 過去runにはforeground証跡がない場合がある。監視導入前の最後のparent成功とmain更新を同一視しない。

## 待機と異常

- awaiting_worker: 未コミット修正・敵対的確認・修復など、統合要求前。
- worker_validating: worker配下の検証プロセスが実在。長時間でも直ちに停止と判定しない。
- worker_validation_failed: 現runの最新completion gateが失敗。修復後の新gateで確認する。
- review_wait: 成功gate後に生成した固定treeのcontextがあり、独立査読の証跡待ち。
- awaiting_commit: 同treeの査読証跡を記録済み。commit・統合の完全tree照合は別途必須。
- validation_wait: 同じrepositoryの別の生存validatorがleaseを保持。
- handoff_wait: ticketがrequestedでworker終了待ち。10分超過は注意。
- integrating: parentまたはforegroundの統合プロセスが存在。
- integration_orphaned: runningの記録と実プロセスが不一致。PID再利用はコマンドidentityとプロセス開始時刻で区別する。照会不能はunknownとする。
- primary unavailable、最新の未回復failed、lease owner不在、heartbeat stale、未完の旧ticketは個別に報告する。
- 最終成功から120分以上でも、検証・lease待ち・査読・統合中は経過時間をinfoとして表示する。
  前回snapshotから20分以上進捗不変ならwarningへ戻す。未回復失敗・owner不在・未統合終了のerrorとunknownは維持する。
  単発取得でも現在gateの出力が20分不変、査読待ちが20分超なら工程別warningを返す。

## 監視タスクに追加する確認仕様

毎回JSON snapshotを取得し、run ID、最終成功SHA/UTC、integration.phase/reason、runner/Codex/integration PID、
lock owner/heartbeat、validation lease owner/経過時間、lane dirty/unpublished数、alertsを報告する。
前回snapshotを保存できる場合は`--previous <snapshot.json>`で比較する。progressTokenは変更ソースのstat・
検証出力bytes・gate状態/完了数・査読tree/証跡・統合checkpoint・lane/main/成功SHAで構成する。
閲覧を含むcommand eventやheartbeat、同じtreeのcontext再生成で停滞開始をリセットしない。20分以上不変は進捗注意とする。
検証30分超過は長時間検証として出力増加を確認し、PIDの存在だけで進捗ありとはしない。

巨大なsupervisor-run.logや実行中のharness/latest.jsonを開かず、append logと変更ソースのstat、小JSONを読む。変更ソースのstatは256件上限で、超過はunknownとする。
`validation.gateRun`は現run・同laneに結び付く直近48件のcompletion gateメタデータから、
実行項目・成功数・失敗項目・出力bytesを返す。`review`は通常の`.verifier-context.json`と
`.verifier-result.json`の時刻・treeを照合した工程観測で、証跡の合格判定や再利用には使わない。
削除・rename元の不在はmtimeで判定せず、未追跡を含む固定treeの削除候補pathを読み取り照合する。
検査0件の正常終了は失敗の回復証跡にせず、lease取得失敗もcompletion工程の失敗として観測する。
CIMは1回/取得、15秒上限。照会拒否・不正JSON・Git失敗はunknownであり、プロセス不在や残件0に読み替えない。
秘密を含みうるprocess command lineやlock tokenは出力しない。
監視は停止・再起動・lock削除・schedule/保護/認証変更を行わない。復旧は既存の所有者確認手順に従う。
