# 公開ゲートの分類と未分類キュー

公開前の分類器は、実際の影響先を確認できた検査を合成する。未知の経路や比較基点は `--plan` の `unresolved` に表示し、限定検査を成功扱いにしない。全検証を選ぶ条件は [変更範囲の選択](validation-scope.md) を参照。

## インベントリの状態

- `scoped` は manifest の登録パターンに一致する。実行時は差分行の条件も確認する。
- `override` は pathOverride に登録された経路。意味判定で必要検査を補う場合がある。
- `reviewed-full` は従来の比較実験・保留理由を保持する。公開前の検査範囲は実際の依存関係で判定する。
- `unclassified` はインベントリの未確認経路。消費者を確認して検査を登録する。

## 検出と強制

- `node scripts/list-unclassified.mjs [--json] [--check]`: 件数、ディレクトリ別、直近90日のcommit数、全件の予想秒数、`reviewed-full` を優先順位つきで列挙（narrowing backlog）。`--check` は未分類があれば失敗。
- `scripts/test-path-classification.mjs`（`test:harness` の選択検査に含む）: 追跡ファイルの未分類ゼロ、未参照ゲートゼロ、見直しを外すと検査が発火すること（反証）、キューの重複排除。
- `--plan` は読取で、未解決の経路は JSON の `unresolved` に出る。実行時は分類通知を記録し、`unresolved` が残れば検査を始めず終了する。インベントリ上で通知する理由は次の2つ。
  - `unclassified`: どの規則にも一致しない。
  - `new-verification`: 新規の test/spec/script/e2e が `reviewed-full` にだけ当たる。**新しい検証は自分の scope を持つ**（`reviewed-full` はレビュー時点で存在したファイルだけを覆う）。
- `node scripts/preflight-publish.mjs` の `classification` 検査は上記が残る場合に公開を止める。全検証の明示指定と影響不明の扱いは [変更範囲の選択](validation-scope.md) に従う。
- ゲートを `gates` に登録したら、`scopes` / `requiredScopes` / `sourceGates` / `testGates` / `semanticGates` のどれかに載せる。載せないと `unreferencedGates()` が失敗する（選ばれない検査を作らない）。

## キュー

`<primary>/logs/harness/unclassified-queue.jsonl`（git管理外。追跡ファイルだと公開ツリーを汚す）。1行1事象で、`{file, reason, status:"open", detectedAt, branch, commit}`、閉じるときは `{file, reason, status:"resolved", resolvedAt, commit}`。同じ `reason+file` が開いている間は追記しない。

## 分類エージェントの1サイクル

1. 読み取り調査: キューの open を読み、`node scripts/gate-evidence.mjs --paths '<正規表現>'` でゲート別の到達を取る（`reaches` / `unreached` / `inherent`。import・require・動的import・`new URL`・文字列で名指しされたファイル/ディレクトリまでの閉包。確度B）。静的閉包で断定できないものは `reviewed-full` にして理由を書く。
2. 規則案と反証テスト: 必要最小のゲート集合を `scopes` に足し、`test-path-classification.mjs` または `test-harness.mjs` の選択検査に、その規則が選ぶゲートの厳密一致を足す。さらに**実際に壊す**: 対象を意図的に壊した差分で、従来の全件が検出した失敗が狭い集合でも検出されることを示す。示せない規則は採らない。
3. 自分のworktreeで実装（`pnpm install --frozen-lockfile --prefer-offline` が先）。`gate-manifest.json` と `test-harness.mjs` の変更はharnessが走る（約4〜5分）。分類の大規模変更は複数回に分け、各回を20分以内にする。
4. 独立検証: `node scripts/spawn-verifier.mjs --base main` と読み取り専用の検証サブエージェント。指摘は証拠で評価し、直したら再検証。
5. 検証済みcommit → 公開準備（`publish-preflight.md`）。公開と稼働の有効化はユーザーの判断。

`deploy/` の新規スクリプトは検証ではなくデプロイ単位なので `new-verification` の対象にしない（`scripts/` 配下は従来どおり `semanticScope` が止める）。

## 登録先の判断

`autorun-queue/cluster-registry.json` はエンジン用の機械ロック対象で、wrapperが自動claimする。分類は公開経路の設計判断を含み、フルランの稼働はユーザー専権のため、**自動でclaimされる登録はしない**。登録先は issue（`cluster: none — <理由>`）とこのキュー、手順書とした。フルランへ載せるかはユーザーが決め、載せる場合は issue の `cluster:` を実cluster idへ変更して `issue-cluster-sync.mjs` に登録させる。

## 実測（2026-11-02、確度B）

- `sounds/music/*/*.m4a` と `images/title/*/*.webp`: 作品のBGMディレクトリ/画像ディレクトリを丸ごと外すと、`pnpm run build` は基準で成功、変異（`sounds/music/地霊殿`、`images/title/chireiden`）で `Missing public BGM assets` により失敗した。vitestの `public-build.test.ts` / `asset-preparation.test.ts` は注入fixtureで検査するため変異を検出しない。よって狭い集合は `vitest, build, public-build, title-preparation`（`build` が検出器）。
- `autorun-queue/`（確度B、2026-11-02）: 台帳を壊してゲートを実行した。
  - `cluster-registry.json`（90日271 commits）は `effect-debug` だけが失敗する。読む vitest は `cluster-registry-format.test.ts` のみで、他の script テストは自前 fixture。
  - `needs-{dsl,ruling}.<x>.jsonl` と `autorun-assignments.json` を含む6ファイル同時破壊でも handoff / harness / fidelity / ismcts-program / ismcts-runtime は基準と同じ結果。
  - 狭めた先は `pathOverride`（`semantic-scope.mjs`）。registry は `docs, effect-debug, focused-vitest`（対象は上記テスト、`PATH_OVERRIDE_TESTS`）、jsonl は `docs`。
  - 狭い集合の検出: 構文破壊（effect-debug と整形テスト）、minify（整形テスト）、issue 宣言 cluster の status 変更（docs）。
  - 全件のまま: `autorun-assignments.json`（prettier 対象）、root `needs-ruling.jsonl`、新規ファイル。新規 `needs-{dsl,ruling}.<x>.jsonl` は規則に一致し `docs` のみ（読み手はゲート外の lane script だけなので許容）。
- 新規テストと manifest 編集を同時にしたときの選択（実測、`run-gates --profile merge --plan`）:
  - 新規の葉テストは `focused-vitest`、selector だけの manifest 変更は `harness-selection, verifier, audit-operations` に絞られる（`semantic-scope.mjs`）。
  - `selectGates()` を直接呼ぶ（意味的絞り込みを通さない）と全件に見える。選択の確認は `--plan` で行う。
  - 全件に倒れる条件: `bases.length !== 1`、他テストから import される共有テスト。`sourceGates` / `testGates` / `requiredScopes` / 既存 gate 定義の変更は全件ではなく path scope（harness 系）になる。
- `apps/playground-web/server/` の15モジュール（確度B、2026-11-02）: 完全一致で絞った。破壊・削除で22本の script ゲートと merge fuzz は基準と同一、`ssot` が `game-api.ts` で、`docs` が削除時のリンク切れで変わった。実測・規則・反証テストは [gate-classification-server.md](./gate-classification-server.md)。
- `apps/playground-web/src` の261ファイルと `test` の `*.test.ts` 145ファイル（確度B、2026-11-03）: 完全一致で絞った。破壊・削除で重い script ゲートと merge fuzz は基準と同一、`ssot`（src）・`docs`（削除）・`harness`（src 削除と SQL 名指しの8本）が変わった。実測・規則・反証テストは [gate-classification-playground.md](./gate-classification-playground.md)。
- `e2e/` の spec 221本（実験時。現行の本数は `static-inputs.mjs` の `E2E_SPEC_FILES`。確度B、2026-11-03）: 完全一致で絞った。どのゲートも実行せずどのファイルからも import されない spec で、破壊・削除で24 script ゲート・`types`・`vitest`・`secrets` と merge fuzz は基準と同一（GUI 4ゲートは破壊のみ）。実験時の規則は `secrets, docs, harness`。現行は `e2e-changed` も選択する。実測・規則・反証テストは [gate-classification-e2e.md](./gate-classification-e2e.md)。
- 静的入力4群（確度B、2026-11-02）: `supabase/**/*.sql`（migrations と tests/fixtures）、`images/*.webp`（直下のみ）、`deploy/oracle/*`、manual-assets（`manual/_legacy/dsl-v2-design/*.ts`、`qa/rest-rebirth-post-choice.ts`、home-lobby モックの html/assets、2026-09-10 の wording audit JSON）の計684ファイルを使い、全件選択の28ゲート（実験は card-tests を加えた29）を3回実行した（無変異の基準、全件を壊す、全件を削除）。
  - 基準: `vitest` のみ失敗（`pc-api-build-storage.test.ts` 2件、10秒の build-ready 待ち。環境要因、確度C）。他28は成功。
  - 内容破壊: 基準から変わったのは `format` / `lint` / `vitest`（SQL を PGlite が実行する `room-replay-restore-contract` 等）だけ。`types` は変わらない（`manual/_legacy` と `qa/` は tsconfig の外）。handoff / harness / fidelity / ismcts-* など26ゲートは基準と同じ。
  - 削除（vitest を除く28ゲート）: 変わったのは `docs`（リンク切れ）だけ。
  - 画像の追加実験: `images/*.webp` 650件の削除で `build`（exit=1）と `public-build`（exit=1）が失敗し、基準は両方成功（`assertPublicCardImages`、`public-build.ts`）。全件28にこの2つは無く、旧全件でも画像の欠落は検出されなかった。画像の規則だけがこの2つを足す。
  - 実効ゲートの注意: `manual/**` は eslint の ignores と `.prettierignore` で除外され、`.sql`/`.webp`/`Caddyfile`/`.sh` は prettier の対象外。manual-assets と deploy/oracle を実際に守るのは docs（リンク）と secrets で、意味変異・新規追加・サイズ変化は旧全件でも検出されない。`secrets` は安価な内容走査として残した。deploy/oracle は拡張子の許可リスト（Caddyfile / .sh / .service / .example）で、ゲートが import しうる .mjs などは含めない。当時の和集合は続報で群別に絞り直した（下記）。
  - 全件約2710秒 → この集合は format 40 + lint 30 + docs 2 + vitest 640 + secrets 9 ≒ 720秒（当時の見積。履歴の記録とは合わないと独立検証で判明し、下記の中央値で置き換えた）。この時点では `requiresMergeFuzz` が override に `vitest` を含むファイルを全件扱いにするため、merge の fuzz は要求されていた。
- 静的入力4群の群別 vitest と merge fuzz（確度B、2026-11-02、続報）: `vitest` 全件（22436 テスト）を、基準・内容破壊・削除の3条件で群別に比べた（テスト名単位、基準の失敗は `pc-api-build-storage.test.ts` 2件のみで環境要因、確度C、検出力の根拠には使わない）。
  - images / deploy/oracle / manual-assets の665ファイル: 破壊も削除も結果は基準と完全一致（差0、新規のファイル失敗0）。→ vitest を外した。
  - SQL 19ファイル: 破壊で63ケース（失敗3、`beforeAll` 失敗によるスキップ60）、削除で68ケース（スキップ57、2ファイルのロード失敗で未読み込み11）が基準から変わり（ケース数は全件22436と同じ単位。
    ファイル内の出現順で対応づけた多重集合比較）、すべて `account-link-postgres` / `input-validation-postgres` / `operation-notices-postgres` / `room-invitations-postgres` / `room-network-postgres` / `room-network-strict-postgres` / `room-replay-restore-contract` / `room-replay-restore-postgres` の8本。→ `focused-vitest` にこの8本だけを登録（`SQL_INPUT_TESTS`、`pathOverrideTests()`）。
    `e2e/account-link.spec.ts` もSQLを読むが、どの登録ゲートにも入っておらず、旧全件でも走らなかった。
  - 狭めた先: SQL は format / lint / docs / secrets / focused-vitest（8本）、画像は format / lint / docs / secrets / build / public-build、他は format / lint / docs / secrets。履歴中央値（2026-11-02、`logs/harness/timing` 80件、確度B）で format 47 + lint 33 + docs 2.4 + secrets 8.7 ≒ 91秒、vitest 594秒。和集合 約685秒（vitest 込み）→ 非SQLは約91秒（画像は＋build）、SQL は約91秒＋PGlite 8本分（未計測）。
  - merge fuzz: `selfplay-fuzz.test.ts` → `selfplay-driver.ts` → `@orica/rules-core` / `@orica/card-data` の src と `fuzz-seed-ledger.mjs` の台帳しか読まない（静的調査）。`selfplay-fuzz.test.ts` を vitest で直接（`RUN_FUZZ=1 FUZZ_GAMES=100`、既定 seed、本番の `pnpm fuzz` の200局・shard・台帳 range とは別）、基準・4群684ファイル破壊・同削除で走らせ、`games=100 natural=100 capped=0 stuck=0 error=0` で3回とも同一（stuck seed はいずれにも無く、bisect 不要）。
    陽性対照: fuzz が読む `packages/card-data/src/cards/BSAZ01.ts` を壊すと exit=1（`ReferenceError`）で検出された。ただし比較したのは要約1行（局ごとの結果ではない）で粗い出力のため、「読まない」ことの強い証明は静的調査との併用（確度B）。
  - 規則: `scripts/harness/static-inputs.mjs` がパターンの唯一の正本。`requiresMergeFuzz` はこの4群だけを除外してから従来の判定をする（ほかの近傍パス、`packages/rules-core/src`・`card-data/src`、fuzz 機構の名指しファイルは `requiresMergeFuzz` 単体では true のまま）。
- fuzz の選択は `requiresMergeFuzz()`（`scripts/harness/gate-manifest.mjs`）を正源とする。ゲーム実装・未知の変更を対象とし、型だけや軽減値だけの既知分類は例外。詳細は [監査効率運用](full-run-efficiency.md)。
  - 本番経路は `mergeFuzzRequired`（`gate-manifest.mjs`）。ゲーム本体の実行時変更は `focused-vitest` に絞っていてもfuzzの候補に残す。
  反証テスト: `test-path-classification.mjs`（群別厳密一致、全被覆ファイルが false、近傍・混在・fuzz 機構は true、本番経路、テスト一覧の完了性ガード＝apps/ と packages/ の任意の `test/` 配下の ts/tsx/mjs（vitest の include より広く、補助ファイルも含む）のうち `supabase/{migrations,tests}` を名指しするものは `SQL_INPUT_TESTS` と一致し、一時フォルダ fixture の `operation-notice-digest.test.ts` だけが例外。
  deploy/oracle・qa・manual/_legacy・mockup・wording audit を名指しするファイルは0、card image を名指しして実ファイルを読むのも同じ fixture 1本だけ。名指し検索なので、パスを別の場所で組み立てる読み手は検出できない＝確度B）。
    規則を壊す変異（除外の削除、`vitest` の再追加、SQL テスト1本の欠落・入れ替え・9本目の追加、oracle の拡張子拡大、画像の近傍パス拡大、SQL の `focused-vitest` 欠落、画像の build 欠落、二重防御の両方除去）を検出した。新しい静的パターンの追加・拡大は `STATIC_INPUT_PATTERNS` のソース一覧の固定で検出する（件数ではなくソースで固定。追加には新しい変異実験が要る）。
  - 狭めなかった範囲: `images/` の直下以外（ForGUI / avater / reference / zokuseichi 等）、`deploy/local-pc`（funnel 系は別 scope、`run-api.mjs` は全件アサート）、`supabase/` の SQL 以外。
