# フルラン全体監査（2026-10-08）

## 範囲と保全

ユーザー承認による効率・構成・環境の横断監査。基準は既存専用mainの `31b7ed27eb454b5bc8adaa1db65a9c5e0b75f46c`、改善branchは `fix/fullrun-audit-20261008`。
workerは`engine-drain`、統合は`fullrun-sync-33f-20261001`のmain、Sol/xhigh、起動確認15分・稼働中skipを維持する。原文監査の対象依存化`4c1c2f54`と既存修復を保持し、検証・独立査読・原文照合を省略しない。

対象はwrapper→worker→verifier→gate→commit→親統合→通常push→次runの経路、watchdog、scheduler、検証証跡、ログとTEMP。ゲームルール自体の再定義、課金・認証・VPN・公開範囲変更、他担当成果の削除は含めない。

## 起点の観測

- 2026-10-07 23:27 UTC: run `d1152198-1ecc-4369-94ab-88ceadde2677`は統合中。worker treeはclean、未統合4commit、26gate通過。
- 23:29:02 UTC: ticket `50e81061-7195-47fe-a44d-e7aff017e6cd`はexit 0、remote mainは基準commitに一致。`git ls-remote`でも直接確認した。23:33には次runが自然開始した。
- 10月8日00:43:20 UTC: 既存workerの原文確認20件`54a32c80`も保全・取込み済み。検証owner終了で失敗した統合を、runner終了とcleanを確認して通常再試行し、remote main一致まで完了（auto-merge `c8c61c3b6f3e491e9549fae6d0a4b0eb`）。改善自体の統合とは区別する。
- 既存プロセス・lease・成果を停止／破棄せず、改善worktreeを分離。`.agents/skills`は対象checkoutに存在せず、AGENTS→CLAUDEと検証runbookに従った。
- Node 22.16.0・repo内pnpm 10.15.1はCIと一致。C空き約1,071 GiB、空きRAM約4.96/31.85 GiB。ディスク逼迫は観測されず、並行validatorの負荷が課題。

## 発見・対応台帳

状態「修正」は専用回帰通過または全体gateで再確認する実装があることを示す。運用採用は下の反映手順と実行証跡で別判定する。

| ID | 問題・根拠・影響 | 原因対応 | 再発防止・状態 |
| --- | --- | --- | --- |
| E01 | 同じsourceTreeでfinish→mergeのfingerprintが変化。22:52 mergeは26gateを約28分再実行 | `verification-state.cjs`で検証に無関係な既知REPLキーとrunLog出力先を明示除外。未知NODE設定等は保持 | `test-harness`。環境差を再現して不要失効を修正。過去差異の全原因は断定しない |
| E02 | `ORIKA_TEST_URL`はGUIテスト先・列挙を変えるのにhash対象外 | 同キーを検証入力へ追加 | URL変更時の失効回帰。修正 |
| E03 | 削除・rename元はcommit前だけ`<deleted>`になり、同じ最終内容でも再失効 | 実在するソース内容と必須入力の欠落を区別 | 実Gitで削除・renameの前後を照合。修正 |
| E04 | `run-fuzz`は共通gate lease外で、他worktreeの全検証と競合 | `fuzz-runner.mjs`が同一repoのleaseを取得。取得後にseed予約し、結果・待機を`logs/fuzz-runs`に保存 | `test-fuzz-runner`の競合・失敗・解放。固定回帰含む200ゲームを維持 |
| E05 | `auto-merge`の`test*`専用retryは現行gate名に到達せず、全stdoutをメモリ保持 | 死んだ自動kill/retryを除去しログを逐次出力。native exit判定は保持 | 実PowerShell統合fixtureのstdout・失敗・push回帰。修正 |
| E06 | handoff/work-plan回帰が自作TEMP repoを残し続ける。独立査読で兄弟laneの削除漏れも反証 | 自分が作ったrepoと兄弟laneの全pathを事前確認し、成功時だけ削除。失敗fixtureは保全 | handoff/work-plan回帰と両directoryの不存在assert。過去TEMPを一括削除しない |
| E07 | 最終CIのhandoffでstatic importの兄弟moduleがtop-level await中に同期fixtureを実行し、正常子processのcallbackを止めてheartbeat回帰がtimeout | suiteを順にawait importし、各suiteの完了後に次へ進む。期限・検査内容は維持 | 2026-10-08 00:10 UTCの失敗logを保全。単独回帰と最終CIで再確認 |
| E08 | `codex:finish-check --reuse`は引数を受け付けるが、再利用対象はpush/mergeだけ。今回の40file差分ではCI27gate後もfinish25gateを独立実行し、追加で約25〜30分が必要 | 現行規約どおり両方実行し、省略やscope縮小で回避しない。公開手順へ保持owner・heartbeat・残時間の確認を追加 | 規約上の重複コストとして残す。今後は同一tree・依存・環境・比較範囲を満たすCI証跡から終了検査を認定する設計を、規約・失敗失効・独立査読と合わせて検討する。今回は未導入 |
| C01 | syncのmerge失敗・未解決競合なし経路がcommit失敗後もexit 0 | Git失敗を伝播し、成功時はmain包含・clean・Git操作未残存を検査 | `test-sync-worktree-failures`で旧コードの誤成功を再現、5ケース通過 |
| C02 | lockのowner確認とunlink/utimesの間でownerが交代し、新ownerを変更／削除 | acquire/refresh/release/reapのmutationを短命guardで直列化。自分が作らなかったlockをcleanupしない | `test-supervisor-lock`の境界競合・残留guard回帰。旧コードで反証済み |
| C03 | merge lock TTL20分、push/pre-push中にrefreshがなく生存pushの排他喪失。worker終了境界で終了済みPIDへ停止命令も可能 | merge/push/ls-remoteに30秒heartbeat、開始前後のowner照合。喪失時は未終了の自分の子だけ終了 | `test-lock-heartbeat-command`とrunner回帰で子孫停止・終了済み/無関係process保全。修正 |
| C04 | workerは古い例外用`--skip-fuzz`を無条件要求可能。prompt/runbookにも例外案内が残存 | request・親ticket・auto-mergeで明示拒否。案内も省略禁止へ統一。確認記録のみのscopeは既存manifestで選択 | integrationの省略要求・改変ticket拒否とhandoffの案内整合。修正 |
| C05 | merge lock解放の非0を無視してcompletedを保存可能 | 解放成功後に完了記録。解放失敗は公開commitを保持したままcleanup失敗を保存 | 実PowerShell統合fixtureでrelease失敗とremote成果保全を検査 |
| N01 | watchdog/reaperは累積CPU600秒／経過1800秒だけで正常Vitestを停止可能 | 同一孤児の二重census・親死亡・coordinator不在を要求し共通化。不明は保持 | `test-vitest-process-policy`、実Windows dry-run。旧誤停止条件を反証済み |
| N02 | watchdog登録はprimary固定かつ既存task先行削除。main改善が採用されず、登録失敗でtask消失 | 専用mainを解決し既存taskは有効状態を保持して更新。削除・停止なし | `test-supervisor-environment`でresolver/update失敗と既存状態保持。実適用は下記 |
| N03 | `supervisor-run.log`約903 MiBへ無期限追記 | 新runは一意な別ログへ。旧・稼働中ログは保全、state.runLogと終了案内で追跡 | 実PowerShellログ保全・runner state回帰。総量retentionは別記 |
| N04 | 親の同期ls-remoteが通信待ち中にheartbeat event loopを止める | 非同期・60秒timeout。ローカルGitも30秒上限 | remote待ち中のtimer進行、実子timeout、失敗ticket保存。修正 |
| N05 | 統合ログのwriteSync例外・stdoutの非同期EPIPEで親が落ち、子が残る。部分書込みも未処理 | 完全書込み、stream errorとcallbackを確認。I/O失敗時は未終了の自分の子を終了し、closeとwrite callbackを待って失敗保存 | ENOSPC・部分書込み・非同期EPIPE・終了後callback回帰。POSIXは内側helperへ終了伝播の猶予を設ける |
| N06 | 最終CIの受付fixtureが新しいworker依存helperをコピーせず起動失敗。診断はtimeoutだけで、失敗fixtureも削除 | 依存helperをfixtureへ追加。待機期限と検査は保持し、timeoutに子のexit/outputを付け、失敗fixtureを保全 | 2026-10-08 01:47 UTCのCI失敗logを保全。受付の実子回帰と最終CIで確認 |
| N07 | 最終CIは26gate通過後、GUI/RESTの2回目navigationでJS/CSS未起動のままtimeout。cold traceでは初回SW後にWorkbox4依存が追加され、Vite cache再作成を観測 | 既存rebirth回帰と同様、このrouting用specだけdev SWをblock。全GUI/REST assertと別originのPWA4回帰は維持 | cold/warmのscenario gateで検証。元の失敗にはnetwork traceがなく、個別通信エラーは未確定。失敗画面・logとcold traceを保全 |
| N08 | CI8はWindows Jobの600回計測中にnative code 0の整合性例外。作成/startは成功、deadline未到達。PID集合・activeの自然変化を即座に恒久失敗へ変換し、protocolは個別理由を捨てていた | 集合不整合だけtyped例外にし、全handle解放・部分計測破棄後に最大3回再取得。固定reasonのみ記録。上限・重複・identity・OS異常と観測済み3GiB以上は再試行で隠さず失敗、wall deadlineも維持 | 実Measureのhelperに一過性・継続不整合・既知hard RSS・重複・一般/OS異常を注入。既存600回・子孫保全・deadlineを含む11回帰と親呼出件数を検査。査読で再列挙の重複分類と親の旧件数assertを反証し修正。元失敗の個別分岐は未確定、旧コードの追加600回×8は再現せず。失敗fixtureは保全 |

## 追加確認: run-logの文字コード（N09）

`341185d34`を基点に、旧集約ログと分割後のrun-logの両方で日本語の文字化けを確認した。
ファイル自体はUTF-8だが、NodeのUTF-8出力をPowerShellのnative出力境界がCP932で復号していた
（例: `空`のUTF-8 `E7 A9 BA`が`遨ｺ`になる）。ログ分割とは別の既存問題である。
wrapperと`auto-merge.ps1`の最初のnative呼出より前に`Console.OutputEncoding`と`$OutputEncoding`をUTF-8 noBOMへ固定する。
前者は標準出力・標準エラーの結合とJSON capture、後者はNodeへ渡す文字列pipeを保護する。
Nodeがhidden/pipeで起動する統合用PowerShellは外側の設定を継承せず、`Invoke-Gate`の結合出力も
CP932で復号していた。実二段起動で外側だけ修正した場合の欠落を再現し、両入口で初期化する。

`test-supervisor-environment.mjs`はCP932/ASCIIから開始する実PowerShellで、通常・復旧両workerの
実ソース境界を実行する。日本語・絵文字・JSON・stdin・既存prefixと追記・複数runをbyte比較し、
終了コード0/7を保存する。実`Invoke-Gate`を通した専用ログの生bytesと外側run-logも比較し、
native失敗7→統合失敗1の伝播を確認する。別pipeのstdout/stderr順序だけは不問とし、欠落・重複は許容しない。
PowerShell 7.6.6で修正前失敗／修正後成功を確認。fixtureは所有するTEMP内へ隔離し、NodeとPowerShell
以外のCLI・依存install・実supervisorは起動しない。過去ログは変換せず保全する。
反映は通常push/main統合後の自然な次runで確認し、稼働中workerの再起動やscheduler変更は行わない。

## 追加確認: 支払可能な完全入力の探索（N10）

N09の統合前200ゲームは199自然終局・1 stuckで停止した（seed `958147760`）。
`BSAZ03-M01「雨の断章」`の可変枚数破棄で、生の選択候補をlimit件に切ってから支払可能性を
調べていた。reserve 1・破棄候補4枚ではlimit 1が先頭の空選択だけを調べて空入力を返し、
`BSAZ01-C12「戦力投入」`の支払前割込みを辞退して元の使用を再開すると支払入力不足になった。
同一状態・同一actionで既存limit 128の完全入力を渡すと割込みと再開が成功し、原因を分離した。

共有入力生成は既存順序のlazy列挙から支払可能な完全入力をlimit件まで収集する。
打切りは次の完全入力の存在で判定し、生候補の残存だけでは立てない。上限増加、selfplay専用迂回、
pending例外の握り潰し、カード本文変更は行わない。limit 1/128、先頭不払候補、件数境界・空候補、
遅延列挙、実カードの割込み前後の支払・ゾーン移動と同期/非同期seed完走を回帰化し、固定fuzz seedにも追加する。
原文はカード定義と`10_rules/03a_cost-payment.md`のC12支払前割込裁定へ照合する。
不払候補が続く場合の全組合せ探索は残る。大きな候補集合の最悪時間は今回実測しておらず、
結果件数の上限を生候補の上限へ戻して正しい入力を落とす回避はしない。
12:06 UTCのfresh監査では未実装・違反は0だが、共有rules-coreのcontext更新により既存の原文確認は
coverage 49件・fidelity 21件が再確認対象になった。対象依存別失効を維持し、無根拠なhash更新・一括承認はしない。
全体gate・独立査読・新規200ゲーム・通常main統合・自然採用は各最終実行証跡で判定する。

## 追加確認: 未修復の原文差と終了待機（N11/N12）

[追加台帳](full-run-audit-2026-10-08-followup.md)に原文とのコスト差（N11、未修復）と
main結合後のWindows終了待機不備（N12）の根拠・修正・検証限界を分離した。

## 確認した品質・構成

- 原文監査の対象依存化を保持。観測用diagnosticsのためだけに`run-gates.mjs`を変更して全確認を失効させることは避けた。診断は読み取りCLI `scripts/harness/fingerprint-diagnostics.mjs`へ分離し、秘密値を出さない。
- 全体gate・独立verifierのtree照合・refute拒否・通常pre-push・remote main一致を保持。scope不明はfull、CIは独立実行という設計を維持。
- workerの20件原文確認と6 lensの独立査読を維持。21:56の査読は完走盤面assert不足を反証し、修正・再gate・再査読した。待機時間だけで査読省略や自動承認にしない。
- supervisor/card-implの5分heartbeat、稼働中skip、誤ったcheckoutの保全、未統合成果と救出stashの停止判定を確認。監査0をISMCTS program全体完了と読み替えない。
- Actionsの支払い・利用上限によるjob未起動は既知。課金変更・再実行による回避はしない。ローカルCI相当の通過をLinux job実行済みとは扱わない。

## 既知fuzz障害

15:14 UTCのseed1558704452は、BSES01-M02→BSES01-T01配置に許可されたトラッシュ通常コアがinput候補から欠落したもの（`5ccba429`で修復）。19:03のseed1558711590は、BSTS01-M02破壊へのBSGE01-C13耐性応答後に対象groupが狭まり再開示した別原因（`31b7ed27`で修復）。

根拠はprimaryの`logs/supervisor-integrations/3c290a66-f177-47f1-a898-4d740cd349b0.log:4839`、`7cfc45a2-0682-4a7d-bd67-ca8696a5dcb5.log:4850`。固定回帰seedへ追加済み。新規seedの探索は続けるため、先行run成功は未探索範囲の無欠陥を保証しない。

## 検証と反映の証跡

専用回帰は`test-supervisor-handoff`と既存harness/lock/runner gateへ登録。最終treeの`pnpm verify:ci`、200ゲームfuzz、独立verifier、verified commit、通常push、`auto-merge.ps1`によるmain統合とremote一致を必須にする。

反映後は専用mainの`register-watchdog-task.ps1`で既存taskを更新し、Actions・有効状態・周期・稼働stateを照合する。既存workerを停止せず、自然な次runのHEAD、runLog、統合ticket/remoteを確認する。検証logは改善treeの`logs/harness/`、`logs/fuzz-runs/`、`.verifier-report.json`、運用ticketはprimaryの`logs/supervisor-integrations/`を参照する。

最終検証中の正常Vitestを旧watchdogがCPU時間だけで停止し得るため、既存taskのactionだけ一時的に`--dry-run`へ変更した（有効・30分周期を保持、元XML/JSONは`logs/audit-watchdog-before-temporary-dry-run.*`）。改善採用後の登録で通常監視へ戻し、dry-run解除まで確認する。supervisorの15分周期・稼働中skipは変更していない。

この文書の固定時点では最終全体gate・独立査読・公開・運用採用は未完了。完了報告では各実行結果と正確なcommitを別途示す。既存修復の統合成功を本改善の採用成功とは扱わない。

## 残存リスク・未実証

1. guard作成直後の強制終了やI/O不能で`.mutation`が残る場合は自動奪取しない。所有者・全lock commandの不在を確認しguardを保全して個別復旧する。lane lockを削除しない。
2. 新旧lock実装の混在を避けるためwatchdog実行先の更新が必須。Windows再起動とschedulerの6時間強制終了は実機障害注入していない。
3. 総ログretentionとharness履歴索引化は未導入。既存履歴1,274件/約3.57 MiBの全読取は漸増I/O要因。保持要件を決めずログ・旧TEMPを一括削除しない。
4. Windowsで子停止権限が拒否された場合は成功扱いせず終了待ちになる。Linuxの自動孤児掃除はidentityを証明できないため保留。Linux CI・再起動・実ネットワーク断/ディスク満杯は未実証で、fixtureとWindows確認を区別する。
5. 有限の現行コード・ログ・失敗注入を監査した結果であり、全将来のルール不具合、未知seed、外部障害の解消を保証しない。
