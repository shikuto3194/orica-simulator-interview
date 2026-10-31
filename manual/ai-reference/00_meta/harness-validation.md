# ハーネスと検証運用

正源は [CLAUDE.md](../../../CLAUDE.md)。

## 検証の入口

検査・査読の正源は `scripts/harness/gate-manifest.json` と `.mjs`。

| コマンド | 実行範囲 |
|---|---|
| `pnpm test:unit <file.test.ts...>` | 指定Vitest。共有lease・最大2fork、完了証跡外 |
| `pnpm verify:dialogue <file.test.ts...>` | Vitest/style。仮確認、受入外 |
| `pnpm test` | harness/verifier/運用回帰 + Vitest全件 |
| `pnpm verify` / `pnpm codex:finish-check:full` | format・lint・dev契約・rules-coreと下流consumerを含む全体型・docs・SSOT・wiring・本文台帳・全件テスト |
| `pnpm codex:finish-check` | 作業差分の影響範囲から必要な検査を選ぶ（下表）。未知の範囲はfull |
| `pnpm verify:push` | push差分から必要な検査を選び、成功履歴と一致する項目を再利用 |
| `pnpm verify:merge` | scope（未知はfull）+ card-tests。fuzz/査読はauto-mergeで判定 |
| `pnpm verify:ci` | full＋scenario＋ローカル双方向＋build・公開build GUI |
| `pnpm verify:scenario [登録済みspec...]` | 指定GUI、引数なしはscenario集合。buildなし |
| `pnpm verify:local-game` | 外部DBなしの双方向GUIと通信復旧、代表5ケース |
| `pnpm verify:public-build` | build＋公開build専用GUI |

`pnpm codex:finish-check --plan` / `pnpm verify:push --plan` で、実行・書き込みなしに対象ファイルと検査一覧を確認できる。削除・rename元も変更に含め、Git読取失敗を「変更なし」として扱わない。

### 差分に応じた検査

ファイル数で一律にfullへ切り替えない。`scopes` の該当検査を合成し、重複は1回にする。

| 変更範囲 | finish / pushの検査 |
|---|---|
| Markdown | 変更ファイルのformat + docs |
| 監査確認記録・残量 | 変更ファイルのformat + fidelity回帰 + 更新recordのfresh有効性・紐づく回帰を一括検証 |
| ホームの表示コンポーネント・CSS・専用e2e | 変更ファイルのformat/lint + `e2e/home-lobby.spec.ts` |
| 保存デッキの共通ブラウザー・絞り込み・並び替え・選択モーダルと専用CSS/e2e | 変更ファイルのformat/lint + web型 + 保存デッキunit + 保存デッキ・ルーム選択・構築配置・詳細のGUI。DeckBuilder本体・API・エンジン混在はfull |
| タイトルの表示コンポーネント・CSS・専用e2e / BGMコントロール | 変更ファイルのformat/lint + 初期取得・更新・直リンクのe2e。BGMコントロールはホームのe2eも実行。保存処理やBGM再生基盤への変更はfull |
| 共通の塗り専用CSS・外観／招待／通知の専用e2e | 変更ファイルのformat/lint + `app-theme`・`room-invitations`・`room-push` のe2e（配置・透過・操作状態も確認） |
| 招待の実JWTテスト・後片付けとその回帰 | 変更ファイルのformat/lint + 後片付け回帰 + 上記mock GUI。実JWT検証はservice-role環境で別途実行 |
| バトルの戻るメニューの文言・遷移先だけ | 変更ファイルのformat/lint + じゃんけん中・シナリオ・棋譜の遷移e2e |
| harness・専用回帰テスト（`test-verifier-gate.mjs`を含む）・pre-push | 変更ファイルのformat/lint + harness・verifier回帰・dev契約 |
| Funnel監視モジュール・登録script・専用回帰・公開API監視workflow | 変更ファイルのformat/lint + Funnel監視回帰。API監督・HTTP本体・CI本体の変更はfull |
| supervisor wrapper・監査work-plan・auto-mergeとprimary復旧・その専用回帰 | 変更ファイルのformat/lint + handoff（監査残件・停止判定・primary復旧を含む）・supervisor lock・runner lock回帰 |
| 登録済みscenario / ローカルGUI | 変更style＋対応GUI。公開build specはbuildも実行 |
| 既存ゲーム共有部 | style/types/全Vitest/put/fidelity/ISMCTS-runtime。card-dataはledger/card-tests追加 |
| 上記の混在 | 必要な検査の和集合 |
| 未知・新規・動的経路、runtime・API・依存・設定 | full |

新しいscopeは、影響を覆う回帰と選択・full昇格のテストを伴う。BattleScreenは `changedLines` で差分行も限定し、ゲーム処理混在はfull（pushは送信全体で判定）。局所表示修正に無関係なGUI・全件テスト・buildを追加しない。状態モデル・公開API/型・ルール骨格など自動判定できない影響は作業者が `:full` / `verify` へ拡大する。CI・mergeの必要検証は維持。API・同期共通部のfullにはローカル双方向GUIを追加する。各GUIの範囲は[GUI/API検証](../25_gui/12_bidirectional-e2e-pattern.md)。

通常のfinishはHEADからの作業差分、手動のpush検査はupstreamからの差分を使う。pre-pushはGitがstdinで渡す送信元・送信先SHAを `--hook` で受け取り、未送信の全コミットを含める。送信commitとHEADの不一致やdirty treeは停止する（並行作業時は下記の検証用コピーを使う）。新規ref・送信先のobject未取得・upstream未設定はfull。削除refのみは検査なし。finishの差分なしは検査なしなので、コミット済みの確認にはpush検査か `:full` を使う。

単体確認と従来入口の引数・制限は [単体確認の入口](unit-test-entry.md)。最終finish・独立査読・ledger・fuzz・別rootの統合検証は維持する。

## 正確性を保った再利用と負荷制御

対応済みの受付依頼は [受入証跡](followup-acceptance.md) で依頼ID・全条件・修正commit・実検証・公開SHAを結び、同じ内容の成功証拠を先に照合する。定期runnerは証明できたIDを一括解消し、新条件・変更・不足は通常検証へ戻す。

全検証の検査集合は維持し、Telegram等の短い運用回帰をISMCTS・handoffより先に実行する。
専用回帰のscope登録漏れと実測、lease範囲・fuzz再利用・worker判断への委譲の比較は
[2026-10-13 調査](merge-push-cost-review-2026-10-13.md)を参照。

- finish/push/mergeは同じcheckout・入力・必要比較範囲の成功履歴を再利用する。`--fresh`・full・CIは新規実行。
- `logs/harness/runs/` から項目別に判定。後発失敗・同一入力の中断は旧成功を無効化する。中断範囲はcurrentGate→selectedGates→不明なら全項目。再利用・中断/失敗run・絞り込みVitestを全件成功へ昇格しない。
- ファイル名・内容・削除・Node版/OS/CPU・検証に関わる環境変数・環境ファイル・lockfile・主要ローカル依存情報をSHA-256に含める。値は非公開。検証中の変更は失敗。コミットだけで内容が変わらなければ再検証しない。
- 配送ID等の既知起動メタデータは計算入力から除外する。未知環境設定は含める。運用fixtureの限定的な入力照合とカード確認の依存分離は [監査効率運用](full-run-efficiency.md) を正源とする。
- 変更ファイルだけのformat/lintは対象パス一覧も一致する場合だけ再利用。専用テストと全件テストは別gateとして保存し、限定検査の成功を全件成功に読み替えない。
- `logs/harness/latest.json` と `logs/harness/runs/` に検査別の所要時間・終了コード・再利用有無を保存する。失敗・中断したrunを成功扱いにしない。
- lease待機時間は `leaseWaitMs`、取得失敗も `*-blocked.json` に保存する。フルランの集計・確認専用merge範囲は [監査効率運用](full-run-efficiency.md)。コード混在merge・CIの全検証は維持する。
- 実検証を行う共通runnerと`pnpm fuzz`は同じGit共通ディレクトリのmain/worktreeで1本ずつ実行する。全項目を再利用できるfinish/push/mergeは待ち合わせ不要。fuzzは固定回帰seedを含む200ゲームと新規探索を維持し、lease取得後に範囲を予約する。生存プロセスの一括killやworker数の引上げは行わない。個別に直接起動したVitestはこの待ち合わせの対象外。
- 受付順のFIFOで待機し、30分timeout後も同じ要求・入力の再試行は60分の猶予内なら順番を保持する。重複・取消・クラッシュ・入力変更・旧版との段階移行は [共有検証枠の順番待ち](gate-queue.md)。通常runnerはowner PIDが終了したlockを自動削除せずエラーにする。supervisor wrapperの `recover-gate-lease.mjs --root <worktree>` は対象1件だけを回収する。Windowsのowner・子・他検証の不在、60秒経過、読取前後の所有者・内容一致が必須。生存owner・情報不足・権限拒否・競合は保持する。
- 復旧処理はworker外で行う。workerにユーザーのTEMP内のlock削除を繰り返させない。`.recovery` 排他ファイルが残った場合や自動確認できない場合は、該当プロセス・子プロセス不在と対象ファイルを確認して手動復旧する。生存プロセスの停止・検証省略・成功証跡の生成は行わない。
- Viteの常駐開発サーバーは、CLIと引数を識別でき、開始時刻がlease作成より前で、owner・子プロセスでない場合だけ検証実行と区別する。`vite.config.ts`のパスだけで検証中と判断しない。build・実テスト・不明な引数・開始時刻不明/同時/以後は引き続き回収を止め、サーバー自体は停止しない。

## 中断したfull-runの成果引継ぎ

runnerはrun ID・固定worktree・PID・supervisor/card-implの所有情報を子へ渡す。
`run-gates`のgate開始時と`spawn-verifier`の候補固定時にも、tree・index・全変更ファイルのSHA-256と退避manifestを保存する。
各checkpointは別名で原子的に確定し、旧記録は保持する。途中記録の終了コードは`null`、検証状態は`unverified`であり、成功証跡ではない。
再開は最新の確定checkpointと全内容が一致し、旧owner/子/対象lane workerと検証leaseが不在の場合だけ許可する。
記録後の未帰属変更、他run・他worktree・hash不一致、情報不足は従来どおり停止する。

旧版で途中checkpointが無い場合は、ユーザー承認済みの限定修復として`supervisor-work-recovery.mjs`の`adoptInterruptedGate`を使用できる。
通常起動から自動採用しない。supervisor/card-implの両lockを保持し、対象runのstate/logと中断gate、HEAD・対象パス・tree・バイトhash、実PID/子/検証不在を前後照合する。
原本gate/stateを成功へ書き換えず、出典hash付き`interrupted-handoff`として保全する。旧検証は未完了のまま残し、必要gate・独立査読・通常統合を新runで完了させる。
ハーネス反映のためにlaneの基点を進める場合も両lock内で行い、退避済み全成果のバイト一致と非重複差分を確認し、変更後のcheckpointを別途確定する。

## 並行作業がある場合の一時コピー検証

他タスクの未コミット変更や検証中の編集により、main で対象変更を安定して検証できない場合に使う。ユーザーへの都度確認は不要。実装と commit は main で行い、一時コピーは検証専用とする。push はユーザーから与えられた権限の範囲で行う。

1. main の HEAD と index・作業ツリーの差分を確認し、対象タスクのファイル／hunk だけを stage する。既存の他タスクの staged 変更があれば混在させない。他作業の reset・削除・一括 stage や、検証失敗だけを理由にした無関係な修正はしない。
2. `git write-tree` の tree ID と基点 HEAD を記録する。対象 tree を `.codex-temp/<task>-validation/` などの専用一時ディレクトリに展開し、独立した Git index を用意する。元の作業ツリー全体をコピーしない。Git object alternates を使う場合、絶対パスを LF で保存し、各 Git コマンドの成功を確認する。
3. lockfile に合う依存を用意する。同一依存の `node_modules` は junction で参照できるが、共有先を書き換える install・依存更新はしない。パッケージ参照が元のソースを読まないことを確認する。検証サーバーもコピー内から起動し、既存の別サーバーを流用しない。
4. コピー内で差分に応じた検査を実行する。コピーのHEADが対象commitなら `pnpm verify:push`、基点HEADからの差分なら `pnpm codex:finish-check` を使い、上表に従ってfullやGUI＋RESTを追加する。成功ログ・対象 tree ID・コマンドを保存する。生存中の他検証を止めたり、待機回避だけを目的にコピーや worker を増やしたりしない。失敗時の修正はmainに反映し、更新したtreeを再展開して検証する。
5. commit 直前に main の HEAD と対象 index を再確認し、検証 tree と一致する変更だけを commit する。pre-commit を通常どおり実行し、生成された commit の tree ID も照合する。hook の整形や並行 commit により内容が変わったら、該当 tree を再検証する。
6. main の pre-push 検証も他作業に干渉される場合は、コピーの HEAD を検証済みの実際の commit に合わせ、同じ remote へその commit を push できる。コピーでもリポジトリの標準 pre-push（`pnpm verify:push`）を有効にして実行する。hook 無効化・証跡の捏造・force push は使わない。remote が進んでいれば通常の統合と再検証を行う。

最終報告には一時コピーで検証した旨と push した commit を記載する。他タスクを含む main 全体の検証成功とは扱わない。不要になったコピーはパスと稼働プロセスを確認して整理し、junction の参照先を再帰削除しない。

## 編集hookと完了証跡

Codexの `apply_patch` の `tool_input.command`、追加・削除・rename、MultiEditを共通で解析する。PreToolUseは変更後内容をメモリ上で再構成して既存ガードへ渡し、解析できない編集は停止する。型チェックは複数ファイルをまとめて、従来のrules-coreと編集対象packageを各1回実行する。

Stopは成功が確認できたcheck/test/lint等を検査済みとして扱う。コマンド名のecho、失敗・実行中の検査、docs検査だけではコード編集の確認を解除しない。状態は作業ルート・セッションごとに分離する。Todo残件・明示停止・停止hookのループ防止は維持する。

Stopは補助ガードであり、未知のtranscript形式やhook不発を完全に証明できない。最終判定は共通runnerとverifierのtree証跡で行う。legacy Claudeのローカル設定はCodex側の変更だけでは更新されない。

verifierには要約と完全diffを渡す。新規reportは全変更ファイル・6つのlensの根拠または対象外理由・未確認範囲を記録し、未確認があればcommitを止める。過去commitの証跡は引き続き読める。手順は [adversarial-verifier-prompt.md](../30_plan/adversarial-verifier-prompt.md)。
完全diffは全変更・binaryを保持した周辺3行の適用可能patch。無変更行の全展開を必須にせず、関連実装・caller・原文は提示したGit rootと固定treeから追加確認する。全変更ファイル・全hunk・6 lens・未確認時停止は維持する。

## 文書・環境の扱い

検査の子プロセスにはGitが列挙するrepository固有環境変数（`rev-parse --local-env-vars`）を渡さない。
worktreeのpre-pushが渡す`GIT_DIR`等で、一時fixtureの`git init/config`が実リポジトリを変更する事故を防ぐ。
親runnerの差分判定は元環境を保つ。[Git hook仕様（公式A）](https://git-scm.com/docs/githooks)に従う。

本文台帳の既存原文を訂正するときもbaselineは固定する。
`card-text-accountability-overrides.json` の該当 `structured_carrier` に
`sourceCorrection: {previousTextHash, correctedTextHash, reason}` を記録する。
baseline/current本文の両hash一致と、実行テストで裏付けた有効なcarrierが必要。
無記録の変更・削除・未帰属本文は引き続き失敗し、記録後の本文再変更も再確認を要求する。

全READMEと運用runbookにも分類別サイズ上限を適用する。検査の詳細は `artifacts/docs-lint.json` に保存し、summary表示でも失敗内容は省略しない。保存不能ならコンソールに全件表示する。分割元の見出しを残し、移動先へ案内する。

カード本文監査のテスト生成物はOSの一時ディレクトリへ隔離する。実際の `packages/**/test` に一時テストを出し入れしない。Vitestのtest名収集は参照ファイルをまとめて1回で行い、実行結果との照合は維持する。

`pnpm supervisor:status` は状態の読取だけを行う。状態修復を含む運用は既存のwatch/reconcile手順を使う。環境調査で見つけた常駐プロセス・worktree・ログは、稼働用途と保持方針を確認してから整理する。検証履歴の再利用は本書の条件に限定し、常駐プロセスの自動停止は導入しない。
フルランのmain占有先は`full-run-checkouts.json`の専用統合tree。preflight・監視・統合はこのtreeのrefを確認し、primaryの別branchを戻す・破棄する操作を行わない。
