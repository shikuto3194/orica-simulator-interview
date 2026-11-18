# e2e の spec の絞り込み実測（P2-16）

`e2e/` の Playwright spec の公開ゲート絞り込みの根拠。分類の仕組みと他群は [gate-classification-queue.md](./gate-classification-queue.md)、playground の src/test は [gate-classification-playground.md](./gate-classification-playground.md)、残作業は P2-16。

- 対象（確度B、2026-11-03）: `classifyPath` が `reviewed-full` と報告した `e2e/` の228ファイルのうち、spec の221本（`security/room-access-control.spec.ts` を含む）。完全一致の一覧は `static-inputs.mjs` の `E2E_SPEC_FILES`。P2-17 で `scenario-edh-0041-waiting-cores.spec.ts` を撤去して220本になり、その後 `scenario-declaration-cues` `scenario-optional-choice-decline` `scenario-post-draw-selection` `scenario-post-stack-step-choice` の4本が個別の scenario-file ゲートを持ったため一覧から外れ、現在は216本（`static-inputs.mjs` の `E2E_SPEC_FILES` が正。実験は221本で行った）。
- 除いたもの（`reviewed-full` のまま）:
  - `deck-builder-layout.spec.ts`: `saved-deck-ui` ゲートが名指しで実行する（scope の patterns には入っていないが gate args にある）。
  - ヘルパー・フィクスチャ6本: `helpers.ts`（233ファイルが import）、`title-fixtures.ts`、`legal-main-deck.ts`、`room-installed-assets.ts`、`security/auth-helpers.ts`、`fixtures/field-magic-pre-cost-resume.json`。うち `helpers.ts`・`title-fixtures.ts`・`legal-main-deck.ts` は実行される spec が import するので GUI ゲートが観測する。残る3本（`room-installed-assets.ts`・`security/auth-helpers.ts`・`fixtures/field-magic-pre-cost-resume.json`）は実験時点では一覧の spec からしか import されず、測っていないので保守的に全件のまま残した。
  - 後から足した spec（新規の検証ファイルは `new-verification` の finding が出る）。
  - 注記: 上のヘルパー3本のうち `security/auth-helpers.ts` は、その後 vitest の `apps/playground-web/test/e2e-auth-helpers.test.ts` も直接 import するようになった（2026-11-15 の `94510a976`）。この3本は再測定していない。
- 実験: 221本をまとめて内容破壊（`CORRUPTED`）し、続けて削除し、基準（無変異）と終了コードと出力末尾（数字を除く）を比べた。

## 結果

- 31ゲートが不変（27本は破壊と削除の両方、GUI の4本は破壊のみ）:
  - script ゲート24本（`docs` `ssot` `wiring` `ledger` `dev-contract` `auxiliary-model-policy` `dot-connection` `audit-operations` `funnel-watchdog` `harness` `verifier` `supervisor-lock` `supervisor-runner-lock` `storage` `telegram` `effect-debug` `text-accountability` `put-semantics` `fidelity` `ismcts-program` `ismcts-runtime` `handoff` `auto-merge-integration` `card-tests`）は破壊・削除の両方で基準と同一。
  - 全件系は `types`・`secrets`、`vitest`（3回とも 1247 ファイル・22449 テスト通過）。
  - GUI の4本は `build`、Playwright の `local-game-ui`・`public-build`（5本・4本通過）、`scenario`（破壊で 145 本通過）。
- `auto-merge-integration` の差は実行ごとの乱数 ID だけ（従来と同じ）。
- 説明のつかない結果が2つあり、再現しなかった: (1) 削除の周の照合で一度 `ismcts-runtime` が exit=1 と表示されたが、保存した JSON・ログ・実行記録はすべて exit=0 で、削除2回と無変異1回の再実行も通過した。照合の取り違えと見るが、原因は特定していない。(2) `scenario` の無変異の基準が `reveal-retrieval-audit` のクリック30秒タイムアウトで1本落ちた（144本通過）。破壊の周は全145本通過で、変異が原因ではない既存のフレーク。
- GUI の4ゲート（`build` `scenario` `local-game-ui` `public-build`）は破壊と無変異だけを測り、削除は測っていない。削除については、どの Playwright ゲートも自分のファイルか config の `testMatch` だけを実行する静的読解（確度B、ガード(4)）による。
- merge fuzz: 破壊・削除・無変異の3実行で要約が同一（`games=100 ... regression=34 discovery=66 ... stuck=0 error=0`、直接100局）。以前の基準が 33/67 だったのは、その後に `fuzz-seed-ledger.mjs` が更新されたため（現ツリーの無変異で 34/66）。fuzz の入口の import 閉包に一覧の spec は1つも無い。

## 規則

- 規則: `semantic-scope.mjs` の `pathOverride`（`E2E_SPEC_GATES` = `secrets`、`docs`、`harness`、P2-17 で足した `e2e-changed`。実験時点は前3本）。`requiresMergeFuzz` も一覧のspecを除外する。
- 実験で動いたゲートは0本。残す3本は動いたからではなく、次の理由による。基準の取り方: 24 script ゲートは、先行する src/test 実験で取った無変異の実行（今回より前の別ツリー）。`types` `vitest` `secrets`・GUI 4本・fuzz は今回の現ツリーでの無変異実行。比べたのは終了コードと数字を除いた出力末尾。`secrets` は gitleaks の自己テストを走らせるだけで、変更したファイルは見ない（実際の走査は pre-push と `secrets.yml` が選択と無関係に必ず行う）。兄弟群と揃えた安価な既定として残した。`docs` は文書から spec へのリンクを読む。`harness` は一覧自体の整合性（`test-path-classification.mjs`）を持ち、一覧の spec を消して一覧を直さないと落ちる。
- 外したもの: `types`（どの tsconfig も `e2e/` を含めない。`tsc --listFilesOnly` で0件）、`vitest`（22449 テストが不変。`revealed-target-ui-raw-audit.json` の `guiTestRef` が spec を名指しするが、削除でも不変だったので存在を検査するテストは実質無い）、GUI の4ゲート（どの Playwright ゲートも自分のファイルか config の `testMatch` だけを実行する）、重い script ゲート全般。
- 履歴中央値で merge から外れる（2026-11-03 時点の丸め値、確度B）: `vitest` 約620 / `handoff` 約750 / `ismcts-program` 約300 / `ismcts-runtime` 約250 / `fidelity` 約140 / `auto-merge-integration` 約75 秒ほか。
- （実験時点）`fidelity-review-resolutions.json` は `scenario-optional-choice-decline.spec.ts`（当時は一覧に含む。現在は一覧外で、個別の scenario-file ゲートが実行する）の sha256 を `evidenceRef` に固定している。spec を編集すると `resolveReview` は `evidenceRefs_changed` を返すが、それを消費する検査はどの gate にも無い（`fidelity` ゲートは不変だった）。従来と同じ検出力で、副作用として記録する。
- 実験時点では、編集した spec自体はどのゲートでも実行されなかった。従来の全件でも実行されなかったので検出力は下がっていないが、spec の壊れは公開ゲートでは見つからなかった。P2-17 で、変更した spec だけを走らせるゲート `e2e-changed` を足した（下記と [e2e-run.md](./e2e-run.md)）。

## 反証テスト

- `test-path-classification.mjs` の e2e ブロック:
  - 一覧の全ファイルが git の管理下かつディスク上にあり、`manifest.scopes` / `requiredScopes` に請求されず、どのゲートの args にも無く、`classifyPath` が override でゲートが厳密一致すること。
  - 近傍（新規 spec、ヘルパー、フィクスチャ、`deck-builder-layout`、拡張子違い）が全件のままで、同じ変更に混ざると全件に戻ること。
  - `selectGates` の finish / push / merge / ci が `changed-style` と4ゲートだけで、重いゲートを含まないこと。fuzz の免除は、既存の playground ブロックの閉包検査と免除ループに一覧を足して同じ検査にした。
- 母集団のガード: 個数と SHA-256 を固定した（実験時は221本・`b02b1e0d…`、P2-17 の EDH-0041 撤去後は220本・`5407baaf50ca6ce500ff39afaeb88e7e5f8c868c32750470ee404063cb2f1b5c`、上記4本の移動後の現在は216本・`67ace27c81026997aa46cb3852bab93594c646c53f95348c1e85a9286edeff37`）。追加が実験に結び付く機械的保証ではなく、差分に3か所（一覧・個数・SHA）が出る摩擦。
- 読み手のガード（7種、静的な名指しと import の検査で、実行時に組み立てるパスは検出できない。確度B）。(1)〜(3) と (6) は、一覧の spec 自身と `manual/`・`issues/`・`images/`・`node_modules/` の外の（一覧に無い `e2e/` のファイルは走査する。(3) だけは `@playwright/test` を import する `e2e/` のファイルを除く。`SELF_LISTS`（`static-inputs.mjs` と `test-path-classification.mjs` 自身）も走査しない）、拡張子が `mjs` `cjs` `js` `ts` `tsx` `json` `jsonl` `yml` `yaml` `ps1` `sh` `toml` `html` `css` `md` `txt` のファイルだけを読み、固定済みのファイル内で名指しが増えても検出しない:
  - (1) 一覧の spec のパスを名指しするファイルの固定（現在7本: コメントのテスト2本、`cluster-registry.json`、`needs-ruling.jsonl`、`revealed-target-ui-raw-audit.json`、P2-17 で足した既知失敗の台帳 `e2e-known-failures.json` とランナーのテスト `test-e2e-run.mjs`）。
  - (2) 裸の単語 `e2e`（`e2e-attachments` のような長い名前の一部を除く）を含むファイルの固定（一覧の spec 以外の `e2e/` のファイルも走査するので、ここに `e2e/` のファイルが入る。固定リストは `test-path-classification.mjs` が正で、件数は複製しない）。正規表現リテラル・glob・シェル引数・`join` など綴りを問わず、ディレクトリを歩いて読む読み手を拾う。散文やテスト名の `e2e` も拾うので、意図して広い。
  - (3) `e2e/` の外で `playwright` に触れるファイルの固定（spec を実行する唯一の経路は Playwright の実行なので、新しい実行元を拾う）。
  - (4) マニフェストの Playwright ゲート全件が、自分のファイルか、`testMatch` を持つ許可済み config（local / public）だけを実行し、一覧の spec を含まないこと。
    - 許可 config の `testMatch` はプロパティの文面そのもので固定する（現在は local が4名 [`local-game-sync` `scenario-partial-target-resolution` `scenario-blazing-star-oracle` `scenario-effect-usage-accounting`]、public が1名）。glob・正規表現・テンプレートリテラル・`.concat()` を足すと文面が変わって落ちる。
    - config を使うゲートの args は `test --config <許可 config>` だけを許す（`-c` の二重指定、位置引数、フラグの追加は落ちる）。
    - 位置引数は Playwright が正規表現として読むので、`test` の後ろの引数はすべて `e2e/<名前>.spec.ts` の厳密なパスであることを要求する（`scenario-` のような裸のトークンや `e2e/scenario-` のような部分名を弾く）。さらに `new RegExp(arg)` が一覧のどの spec にも一致しないことも確認する。
    - `playwright` を含む gate が上の形以外（script 形式、`pnpm exec`、別の bin）で入ること、`package.json` に Playwright の script が入ること、CI の workflow で Playwright を含む行が、`run: pnpm exec playwright install --with-deps chromium` の1行と結果フォルダのパスの1行以外になること（インストール行へのコマンドの追記を含む）も落とす。
  - (5) 一覧の spec を import するファイルが無いこと。
  - (6) 裸の単語 `spec`（`.spec`、`(test|spec)`、`{test,spec}` など綴りを問わない）を含むファイルの固定（`e2e/` のファイルを含む）。`e2e` の語を使わず、拡張子で木を走査する読み手（`check-card-test-coverage.mjs` や text-accountability audit の `(test|spec)` も含む。今は packages / apps / tests / scripts を根にする）を拾う。散文の `spec` も拾うので、意図して広い。固定したファイルの中で走査の根が `e2e/` を含むよう変わっても検出しない（確度B。変異で確認済みの限界）。
  - (7) 一覧に無い `e2e/` のコード（`.ts` `.tsx` `.js` `.mjs` `.cjs` ほか）は、ゲートで実行される（scope 済みの spec、ヘルパー）。これらが import する裸のモジュール（Playwright を除く）を、ファイルごとの組で固定する（組の一覧は `test-path-classification.mjs` が正）。TypeScript パーサの報告する形（静的、リテラルの動的 import、require）を問わず、`fs` / `child_process` / `fs-extra` / glob などの新しい import が落ちる。ローダー呼び出し（`import(` `require(`）の引数が、置換のない引用符つき文字列リテラルでないものは0件で固定する（`${}` を含むテンプレートも弾く）。組み立てたパスで一覧の spec を読む実装が名指し検査(1)(2)(6)を迂回するのを防ぐ。固定済みのファイルの中で `node:fs` の使い方が変わっても検出しない（確度B）。
- 規則とガードを壊す変異の結果は、検証記録（スクラッチ）に残した。件数は参考。

## 狭めなかった範囲

- ヘルパー・フィクスチャ6本、`deck-builder-layout.spec.ts`、scope 済みの spec（2026-11-03 時点で37本、以後増加）は変えていない。`room-installed-assets.ts` と `fixtures/field-magic-pre-cost-resume.json` は一覧の spec だけが参照する。`security/auth-helpers.ts` はアプリの単体テストからも参照される。
- 一覧の spec を実行するゲートは、P2-17 で足した `e2e-changed` だけ（`E2E_SPEC_GATES` の4本目）。実行するのは差分に含まれる spec に限り、触っていない spec は走らない。共有ヘルパーや `scenario-*.ts` の変更も spec を走らせない。それらの壊れは定期の全件実走（`pnpm e2e:full`）で拾う。読み手のガードは、`scripts/e2e-run.mjs` `scripts/harness/e2e-run-core.mjs` `scripts/test-e2e-run.mjs` を新しい読み手として固定リストに加えた（変異実験の再実施ではなく、読み手が spec を実行することが目的の追加）。
