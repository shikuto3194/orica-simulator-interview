# GUI/API e2e の検証範囲（scenarioとroom）

フルラン（無人完全実装ラン）では、従来 AI が Playwright MCP を対話操作していた
「GUI + REST API 双方向レビュー」を **スクリプト化された Playwright spec** に置き換える。
人間の GUI レビューは完了後に一括で行う（`30_plan/full-run-supervisor.md`）。

## 正準実装と技術

Playwrightはブラウザー操作とDOM検査の自動化ライブラリ、Chromiumはそこで動かす実ブラウザー。
通常はheadlessで1画面を操作し、相手をREST APIで進める。画像の目視判断とは別に、
確定状態・version・画面のコア数や選択肢をassertする。配置変更は必要な画面だけ画像でも確認する。

- `e2e/local-game-fixture.ts` と `scenario-blazing-star-oracle.spec.ts` がローカル双方向の入口。
  Viteの明示的な `ORICA_LOCAL_GAME_TESTS=1` モードで固定scenarioからsessionを一度だけ作り、
  `?localGame=local-...` を開く。サーバーが状態の正源となり、GUIと相手APIは同じ操作経路へ送る。
- `server/local-game-session.ts` はメモリ保持。実roomと共通の操作・合法手検査・autoDrain・
  閲覧者別秘匿化を使う。GUIは既存のRoomBattleLoader・BattleScreen・useRoomSyncで
  SSE受信、ポーリングへの切替、再送を行う。毎手の再読込・全盤面再注入はしない。
- DB、JWT認証サービス、ルーム管理、MCTS探索は起動しない。ローカルの席別tokenで操作主体を分離し、
  version競合・操作IDによる重複排除・取消確定を保持する。loopback限定、通常サーバーと公開buildにはAPIを登録しない。
- 失敗時はscenario名・入力・初期盤面・操作列・乱数記録・確定状態hashを `local-game-replay` に添付。
  固定scenarioを再実行するための記録であり、エンジンのプロセス内連番までの完全一致再生は保証しない。
  Playwrightの失敗画像とtraceも保存する。成功時の全手撮影や探索の再実行は行わない。

## 各検証の適用範囲

| 検証 | 実行する変更・確認内容 | 証明しない範囲 |
|---|---|---|
| 指定unit | カード効果、ルール、合法手。最小盤面と具体的な状態差 | 描画・通信 |
| 既存scenarioの指定spec | 表示、選択UI、GUI→API、固定局面 | roomId無しの相手API→GUI |
| ローカル1 GUI＋相手API | 状態/API連携。相手操作後の画面変化、再読込なしの同期 | 実JWT、DB永続化、公開通信 |
| ローカル2独立context | 同期・席別表示・切断復旧の共通部変更。代表局面だけ | 全カード×全通信障害の組合せ |
| ローカル通信障害 | SSE不通時のpoll、確定後ACK消失時の同一操作再送 | 実回線の遅延・負荷上限 |
| 実room統合 | 認証、RLS/CAS、DB、入退出・再戦、公開経路を変更した場合 | 全カード効果 |
| 公開build/PWA | bundling、公開資産、service worker、公開URL。build後に専用spec | ローカルsessionの代替 |
| MCTS/selfplay/fuzz | 探索ロジック・多手の不変条件・新しい失敗局面の発見 | GUIの描画保証 |

MCTSの失敗は初期局面と操作列に固定してから回帰テストにする。日常のGUI受入で探索を毎回回さない。
カード固有ケースはunitに蓄積し、共通の通信障害は少数の代表局面で確認する。

## 検証の選び方と停止条件

- `pnpm verify:scenario e2e/scenario-four-of-a-kind.spec.ts` は登録済みの指定specだけ。
  引数なしは既存scenario集合。いずれもbuildを伴わない。
- `pnpm verify:local-game` はローカル双方向の代表5ケース。サーバーを自動起動・終了する。
  worktreeは割当portを `PW_BASE_URL=http://127.0.0.1:<port>` に指定する。
- `pnpm verify:public-build` はbuild＋公開build専用spec。
- 実装中は必要なunit/GUIに限定し、最終差分を固定して `pnpm codex:finish-check`。
  登録済みGUI specだけの変更は該当GUIを選び、API共通部・依存・ビルド設定はfullへ昇格する。
  fullになっても変更した登録済みGUIを取り落とさない。
- `verify:dialogue` の仮確認、独立査読、finish/push/mergeの同一入力の再利用、CIの独立確認、
  merge時の適用範囲に応じたfuzzは維持する。仮確認を完了証跡へ読み替えない。
- 必要な検査の成功後は、差分・失敗・未解決の疑いが増えなければ同じ重い検査を繰り返さない。
  検証中は編集せず、失敗時だけ修正対象に応じて再確認する。

## 従来scenarioの非対称性

`?scenario=`（roomId無し）はGUIからlegacy `/api/game` へpushする経路。
相手APIが更新した盤面のGUIへのlive反映はない。`scenario-dsl.spec.ts` はこの境界を明示する。
`roomHarness=1` を持つ既存specは中継方式なので、素のscenarioとは区別する。
双方向の新規受入は上記ローカルsessionを使う。2画面は同期そのものの代表検証に限る。

## 弾別レビュー spec の設計（SET パラメータ化、2026-08-06 実装済み・P3-152）

弾ごとに spec ファイルを生成するのではなく、**1 つのパラメータ化 spec** で実装した:

- `e2e/set-review.spec.ts`。PowerShellで `$env:SET = "BSDB01"; pnpm exec playwright test set-review` のように
  環境変数で対象弾を指定（未指定時は card-data の全弾を巡回、2026-08-06 時点 38 弾 / 約2.4分）。
- **実装は当初案から変更**: `POST /api/game/start` は roomId 無し (legacy game API) の GUI が
  サーバー変更を live poll しない設計（上記「scenario モードの非対称性」参照）のため、API 単独で
  ゲームを開始しても GUI には一切反映されない。代わりに `apps/playground-web/src/scenarios.ts` の
  `"set-review"` シナリオ (`buildSetReview`) を新設し、`?scenario=set-review&set=<SET>` で
  GUI がローカルに `initializeGame()`（対象弾 cardNo 前方一致を全部使い、40 枚未満なら
  他弾で埋めた 40 枚以上のデッキ 2 組。デッキ枚数の下限は公式ルール上「40枚以上」
  [`10_rules/02_turn-flow-and-timing.md:32`「各プレイヤーのデッキ（40枚以上）を
  シャッフルする」] であり上限は無いため、対象弾のカード種が40超なら超過枚数のまま
  truncate しない）を構築 → 既存の `pushState`（GUI→server 一方向 push）で
  サーバー側に同期する。
  `e2e/scenario-dsl.spec.ts` と同型の経路。
- 手順:
  1. `?scenario=set-review&set=<SET>&manualOpponent=1` で開く（`manualOpponent=1` は
     相手ターン自動進行 useEffect を無効化、bob の API 操作との競合を防ぐ）
  2. GUI の初回 `pushState` 完了を `GET /api/game/state` のリトライ待ちで確認
     （40枚以上のデッキ2組はペイロードが大きく、固定小盤面シナリオの待ち時間では不足しうる）
  3. alice: GUI で数手進める（`summonSpiritFromHand`、失敗時は `advanceStep` にフォールバック）
  4. bob: `GET /api/game/actions/bob` → `POST /api/game/action` で合法手を数手実行
  5. assert: state version 前進・pending 非滞留（`GET /api/game/actions/alice` が壊れず返る）・
     **ブラウザ console エラー 0**（`e2e/helpers.ts` の `attachErrorCollector`、
     `scenario-core-mechanics-crosscut.spec.ts` と共通の SSOT ヘルパー）
- カード効果の網羅検証はユニットテスト（カード毎最小1ケース）と fuzz（`pnpm fuzz`、
  ALL_CARDS プール）が担う。e2e は「GUI/API 配線が壊れていないこと」の検証に限定する。
- ルート `package.json` の `devDependencies` に `@orica/card-data` (`workspace:*`) が必要
  （e2e から `ALL_CARDS` を値として import するため。既存 spec は type-only import のみで
  この依存無しに動いていた）。

## 実行環境

- dev サーバー: `npx vite --config apps/playground-web/vite.config.ts --port 4173`
  （バックグラウンド起動）。再利用前に対象tree・config・portが一致することを確認する。別treeのserverは流用せず、割当portで起動する。
- Chromium headless はローカル無人実行可（display server 不要）。
  「headless 不可」は cloud scheduled agent の話で、ローカル scheduled task では GUI テストを回せる。
- スクリーンショットは `debug-screenshots/` 配下（CLAUDE.md）。

## 完了条件への寄与

弾の回帰確認は弾ユニットテストとset-reviewの通過範囲を報告する。set-reviewはserver→GUI反映や全効果の網羅証明ではない。
全弾 clean 後の最終検証はフル e2e suiteとfuzz。PowerShellの件数指定は `$env:FUZZ_GAMES = "1000"`。環境変数は検証後に元の値へ戻す。
（`30_plan/full-run-supervisor.md` の停止条件参照）。
