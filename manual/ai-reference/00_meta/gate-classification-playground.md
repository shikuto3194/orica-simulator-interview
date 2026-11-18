# playground-web の src と test の絞り込み実測（P2-16）

`apps/playground-web/src/` と `apps/playground-web/test/` の公開ゲート絞り込みの根拠。分類の仕組みと他群は [gate-classification-queue.md](./gate-classification-queue.md)、server は [gate-classification-server.md](./gate-classification-server.md)、残作業は P2-16。

- 対象（確度B、2026-11-03）: `classifyPath` が `reviewed-full` と報告した src の261ファイル（CSS・フォント・画像を含む）と、`test/` 直下の `*.test.ts` 145ファイル。完全一致の一覧は `static-inputs.mjs` の `PLAYGROUND_SRC_FILES` / `PLAYGROUND_TEST_FILES`。後から足したファイル（入れ子を含む）と test のヘルパー・フィクスチャは一覧に入らない（既存の src には入れ子の103件が入り、test は直下のみ。新規のリーフテスト以外は今回の実験対象外）。
- 除いたもの: SQL を名指しする PGlite 8本（`SQL_INPUT_TESTS`）。全414本をまとめて壊すと `harness` が、この8本が `test-path-classification.mjs` の SQL 名指しの固定に載っているために落ちた。ほかに `selfplay-driver.ts`・`mcts.ts` などのヘルパー、`fixtures/`、`selfplay-fuzz.test.ts`（既存の `types` のみの規則）。
- 実験: 内容破壊（`CORRUPTED`）と削除を、src の261本と test の145本に分けて行い、基準（全て成功）と比べた。全414本の一括では24ゲート（全件28から format / lint / types / vitest / secrets を除いた23本と `card-tests`）を測り、src と test を分けた2回目では `docs` / `ssot` / `harness` だけを測った（一括で変わった3本の帰属を決めるため）。

## 結果

- 一括の24ゲート: 変わったのは `ssot`・`harness`・`docs` だけ。`handoff` / `ismcts-program` / `ismcts-runtime` / `fidelity` / `auto-merge-integration` / `effect-debug` / `telegram` / `storage` / `verifier` / `ledger` / `wiring` ほか10本（不変は計21本）は終了コードも出力末尾も同じ（`auto-merge-integration` の差は実行ごとの乱数 ID のみ）。
- 帰属（`docs` / `ssot` / `harness` の分割実験）:
  - src 破壊: `ssot` が落ちる（`check-ssot.mjs` が src 全体を走査する）。`docs` と `harness` は変わらない。
  - src 削除（261本の一括）: 3本とも落ちる。`harness` は server の規則の GUI 入口ガード（入口ファイルの個数）で落ちる。単一ファイルの削除は、テストのディスク上の存在確認が捕まえる。`docs` は文書からのリンク切れ。
  - test 破壊: 3本とも変わらない。
  - test 削除: `docs` だけが落ちる（リンク切れ）。
- merge fuzz: 基準と src・test の破壊・削除の5実行で要約が同一（`games=100 ... stuck=0 error=0`、直接100局、本番の `pnpm fuzz` とは別）。fuzz の入口（`selfplay-fuzz.test.ts`、`fuzz-runner.mjs`、`run-fuzz.mjs`、`vitest.config.ts`）の import 閉包（328ファイル）に、一覧の src と test のファイルは1つも無い（閉包内の `apps/` は `test/` のヘルパー `selfplay-driver.ts` と入口の `selfplay-fuzz.test.ts` だけで、どちらも一覧の外）。

## 規則

- 規則: `semantic-scope.mjs` の `pathOverride`（`PLAYGROUND_SRC_GATES` / `PLAYGROUND_TEST_GATES`）。`requiresMergeFuzz` も一覧のファイルを除外する。
- src: `types, vitest, secrets, docs, ssot, harness` に、`scenario, local-game-ui, build, public-build`（CI が全件で足す GUI 4本。src は GUI そのもので、import の読解で選び、変異はしていない）。
- test: `types, vitest, secrets, docs, harness, card-tests`。`card-tests`（約1秒）は、24ゲートの実験が変更カード0件で走って何も証明しないため、`check-card-test-coverage.mjs` が全テストのカード番号を読むことから test の規則に残した（一覧の145本のうち49本がカード番号を含み、うち2本（`game-api.test.ts`、`operation-notice-card-context.test.ts`）は6件のカード番号の唯一の参照元）。src は読まれないので足していない（静的読解、確度B）。`harness` は、`test-path-classification.mjs` の SQL 名指しの固定（テスト全体を走査する）を残すために入れた。既存テストの破壊・削除ではその反応が出ないため、実験だけでは外せなかった。
- リーフのテスト編集は従来どおり `semanticScope` が `focused-vitest` に絞る（内容に基づく規則が path 規則を置き換える）。そのため、新規のリーフテストは `new-verification` の finding を出さず（override があると出ない）、リーフ編集では上の `harness` も走らない。この path 規則が効くのは、他のテストから import されて非リーフになった一覧テストの編集だけ（145本は現状すべてリーフ。リーフ判定は作業ツリー全体の import 関係で決まるので、同じ変更で一覧テストを import する別テストを足すと非リーフになり、path 規則（`harness` 込み）に戻る。広いゲートに戻る側）。一覧のファイルを削除するには一覧・個数・SHA も更新するので、削除パスそのものに検査範囲を登録する（更新を忘れると `harness` が落ちて知らせる）。リーフ編集で SQL 名指しのドリフトが検出されない点は従来の挙動で、残留懸念として issue に記録した。
- 履歴中央値（`gateSecondsFromTimings`、2026-11-03 時点の値を丸めたもの。`logs/harness/timing` は追跡外で増え続けるので、再計算すると数%動く。確度B）で merge から外れる: handoff 約750 / ismcts-program 約300 / ismcts-runtime 約250 / fidelity 約140 / auto-merge-integration 約75 秒ほか。一方 `harness`（約240秒）は src と test の双方で戻り、src は GUI 4本も足すので、GUI 4本の未計測分（`scenario` / `build` / `public-build`）が加算される。

## 反証テスト

- `test-path-classification.mjs`: 一覧の全ファイルが git の管理下（追跡済み、または未追跡で ignore されていない）かつディスク上にあり、`manifest.scopes` のどれにも請求されない（override が scope を隠さない）・対象の種類であること、ゲートの群別厳密一致、近傍（新規・入れ子・ヘルパー・SQL 8本）が全件のままであること（fuzz 本体は一覧外で既存の `types` のみの規則のまま、fuzz の免除の対象にならないこと）、`selectGates` の finish / push / merge / ci が `changed-style` ＋ 群のゲートだけであること、CI の全件が足す GUI ゲートと src の規則が一致すること、実験時の近傍パス判定、fuzz の除外が一覧のファイルだけであること。
- 母集団のガード: 261本・145本の個数と SHA-256 を固定した。一覧を変えると、固定値を同じ差分で更新しない限り落ちる。これは、追加が実験の証拠に結び付くことの機械的な保証ではなく、差分に3か所（一覧・個数・SHA）が出て目立たせるだけの摩擦（追加の実験は人が再実施する）。削除も同じ3か所の更新が要る。作業ツリーから消しただけ（ステージなし）の削除は、追跡検査に加えたディスク上の存在確認で落ちる。
- 読み手のガード（5種）。(1)〜(3) は読み手のファイル集合を固定し、新しい読み手のファイルが出たら実験を再実施する（固定済みのファイル内で名指しが増えても検出しない）。(4)(5) は閉包を毎回再計算するので、既存ファイルに足した import も検出する。(1)〜(3) が読むのは `manual/`・`issues/`・`images/`・`node_modules/` の外にある、拡張子が `mjs` `cjs` `js` `ts` `tsx` `json` `jsonl` `yml` `yaml` `ps1` `sh` `toml` `html` `css` `md` `txt` のファイルだけで、ほかの拡張子の新しい読み手は検出しない。どれも名指しや静的 import の検査で、実行時に組み立てるパスは検出できない（確度B）。
  - (1) `scripts/`・`deploy/`・`.github/`、ルート直下のファイル、`package.json` のうち `playground-web` に触れる46ファイル。`join("apps", "playground-web", ...)` のような分割やエスケープ済み正規表現も拾う。
  - (2) リテラル `"apps"` を含む `scripts/`・`deploy/`・`.github/` のファイル6本の固定。うち4本（`check-card-test-coverage.mjs`、text-accountability の audit、`check-ssot.mjs`、`ssot-candidate-scan.mjs`）は `apps/` を丸ごと走査し、`playground-web` を名指ししない走査を拾う（`check-ssot.mjs` は (1) とも重なる）。残る2本（`gate-evidence.mjs`、`test-effect-debug-loop-state.mjs`）は文字列として触れるだけ。
  - (3) 一覧の src のパスを拡張子あり・なしで名指しする、vitest が収集するテスト以外のファイル14本（`e2e/` 配下（spec と補助ファイル）は除く: 従来の全件 fallback も大半を走らせず、GUI 4ゲートが走らせる分は src 規則に残した。アプリ自身の `src/` も規則の対象なので除く）と、一覧の test のパスを名指しする3本（audit の参照データ・`gate-manifest.json` の gate args など）。vitest が収集するテスト（`vitest.config.ts` の include と同じ範囲）は、vitest が両規則に入るので除く。
  - (4) merge fuzz の入口（`selfplay-fuzz.test.ts`、`fuzz-runner.mjs`、`run-fuzz.mjs`、`vitest.config.ts`）の import 閉包を再帰で計算し、一覧のファイルが空であること。静的と文字列リテラルの動的 import、`vi.mock` のパス、`@orica/*` の alias、型 import（過大側）を辿る。alias 表は `vitest.config.ts` のキーとの一致を検査し、閉包内の `import.meta.glob` も禁止する。
  - (5) 閉包の健全性: 未解決 import が0、入口と `selfplay-driver.ts` が閉包に入る、規模が200超。
- 規則とガードを壊す変異（各ゲートの欠落、ディレクトリ接頭辞での規則化、fuzz 除外の削除と過剰な拡張、SQL テスト・ヘルパー・scope 済みファイル・存在しないファイル・重複・未実測の新規ファイルの一覧への混入、fuzz の入口からの一覧ファイルへの import、パスを分割した読み手）をすべて検出した。変異スクリプトはスクラッチ（リポジトリ外）で、件数は参考。

## 狭めなかった範囲

- `vitest` 全件の群別絞り込み（`focused-vitest` への置換）は未実施。src は全テストが間接的に読みうるため、別の実験が要る。
- GUI 4ゲートは src の変異実験をしていない。残りの `playground-test`（SQL 8本、ヘルパー・フィクスチャ、実験後に増えた新規テスト）と `playground-src` の実験後に増えたファイルと `playground-root` は `reviewed-full` のまま（2026-11-03 時点は test 17・src 1。以後も増えるので、現在の分類台帳は `node scripts/list-unclassified.mjs --json`、実行計画は [変更範囲の選択](validation-scope.md) で確認する）。
