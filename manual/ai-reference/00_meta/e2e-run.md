# e2e の実走と既知失敗の台帳（P2-17）

`e2e/` の Playwright spec はほとんどが公開ゲートに載らない（[P2-16](./gate-classification-e2e.md)）。載せると全件で約 45 分（2 レーン並列）かかり、20 分基準を超えるためで、そのままだと spec の壊れが見過ごされる。2026-11-03 の全件実走で、失敗 117 件のうち大半は、他の変更に spec が追従していないだけだった（API 契約・UI 文言・自動化の導入）。次の 2 つで、触った spec と触っていない spec の両方の壊れを拾う。

| 入口 | 何を走らせるか | 位置づけ |
| --- | --- | --- |
| `pnpm e2e:changed`（ゲート `e2e-changed`） | 実行時の base（通常は `main`）との差分で、追加・変更された `e2e/**/*.spec.ts` だけ | 公開ゲート。`E2E_SPEC_GATES` の対象や全件選択に含まれる。manifest で専用 gate が定義された spec はその分類に従う。選択は `--select-only` で確認できる |
| `pnpm e2e:full` | `playwright.config.ts` が実行する全 spec | 定期実行。ゲートではない。スケジュールは利用者が決める |
| `node scripts/e2e-run.mjs --specs e2e/a.spec.ts,e2e/b.spec.ts` | 指定した spec | 手動の確認用 |

判定は 4 つ。出口コードは 0（合格）/ 1（NEW・STALE・UNEXPECTED SKIP）/ 2（実走自体の失敗。合格にしない）。

- **NEW FAILURE**: 台帳に無い失敗。出口 1。
- **STALE LEDGER**: 台帳にあるのに通る（または存在しない）テスト。出口 1。直したら台帳の項目を同じ変更で消す。
- **UNEXPECTED SKIP**: 台帳の `skips` に無い skip。出口 1。skip は「未検証」で、ログインが使えない・ビルドが無いなどの環境不足を合格にしないため。許可するのは環境オプトイン・serial の後続など理由が書けるものだけ。
- **NOT VERIFIED (skipped, listed)**: `skips` に載せた skip。合格に数えず、毎回列挙する。

台帳は [`scripts/harness/e2e-known-failures.json`](../../../scripts/harness/e2e-known-failures.json)。失敗を許容する唯一の入口で、項目ごとに `file` `project` `title` `reason` `issue` を持つ。断続的に失敗する既知項目は `flaky: true`（通っても STALE にしない）。`errorIncludes`（文字列または文字列の配列）を持つ項目は、失敗の本文がそのどれかを含むときだけ既知として通す。含まない失敗は、同じテストでも NEW FAILURE（同じ題名の裏で別の退行が起きても隠さない）。`skips` は skip を許可する項目（`reason` 必須）。`issue` は原因を追う issue で、無い失敗を台帳に入れない。全件実走では、`playwright --retries=1` の再実走で通ったものを flaky として別に表示する（失敗にしない）。

## 範囲と限界（確度B）

- `e2e-changed` が見るのは spec ファイルそのものの変更だけ。`e2e/helpers.ts` などの共有ヘルパーや `apps/playground-web/src/scenario-*.ts` を変えても、それを使う spec は走らない（ほぼ全 spec が `helpers.ts` を import するため全件になる。2026-11-18 時点で `rg -l helpers e2e --glob '*.spec.ts'` は 239 本）。その壊れは定期の全件実走で拾う。
- base が親を持たないルートコミット（CI で新規ブランチを初めて push したときのイベント base）のときは、全ファイルが変更扱いになるので `main`（無ければ `origin/main`）に切り替える。ゼロ SHA や存在しない base は出口 2。
- 作業を `main` に直接コミットした後（`HEAD` が `main` に含まれ、`main` との差分が空になる）は、`main` と比べても spec が 1 本も選ばれず通ってしまう。そのため `HEAD` が base に含まれ、公開済みの `origin/<base>` には含まれないときは `origin/<base>`（未公開の変更）と比べる。`origin/<base>` にも含まれるなら、未公開の変更は無く、選択が空なのは正しい。この判定は `pickBase`（`e2e-run-core.mjs`）の純関数で、`test-e2e-run.mjs` が縛る。実 git での選択（ブランチの commit・作業木の編集・未追跡・`main` 直上の commit・`ORICA_VERIFY_BASE`・ルート base）は `test-e2e-run-wiring.mjs` が縛る。
- ゲート `e2e-changed` は `diffBase: true` を宣言し、各profileの固定済み比較SHAを `--base` で受け取る。成功再利用は入力treeだけでなく比較baseにも結び付ける。base変更で選択specが変わる場合に古い成功を流用しない。手動実行は `main`、ゲート外のCI実行は `ORICA_VERIFY_BASE` が既定。live specの回数削減はセッション再利用で行い、異なる比較範囲の検査を省略しない。CIのブラウザー導入はmanifestの `browser: true` で決まる。
- 判定が空の実走は合格にしない（出口 2）: ディスクに無い spec のパス（`--specs` の打ち間違い）、Playwright の top-level errors（webServer 失敗・読込エラー）、選んだ spec の結果が無い、`test.only` の残り（`--forbid-only`）。
- 失敗の本文は「エラーを持つ最後の試行」で判定する。`serial` の describe は後続が失敗するとグループ全体が再試行され、1 回目に失敗したテストが再試行では先頭の失敗のために skip（本文なし）になることがある。最後の試行の空本文で台帳の `errorIncludes` を判定すると、既知の失敗が NEW になるため。
- `public-build.spec.ts` を選ぶと `pnpm build` を先に走らせる（`dist` が前提のため）。ビルド失敗は出口 2。
- `playwright.config.ts` の `testIgnore` の spec（現行は `local-game-sync` `scenario-partial-target-resolution` `scenario-blazing-star-oracle` `scenario-effect-usage-accounting`）は実行されない。`--list` で実行対象かを先に確かめ、対象外は表示して外す。
- room の live spec は、固定の alice / bob、service-role が準備する一時ユーザー、公開受入の匿名サインインに分かれる。必要な設定は spec ごとに異なる。実走失敗・想定外 skip・台帳で許可された未検証の区分は上の判定に従う。

**Supabase は無料枠で運用する（課金しない）**。サインインの上限（匿名サインインは 1 時間あたり数十回程度、プロジェクト設定で決まる）を使い切らないために:

- `security/auth-helpers.ts` は固定の alice / bob（`.env.e2e.local` または環境変数 `E2E_ALICE_EMAIL` `E2E_ALICE_PASSWORD` `E2E_BOB_*`）でパスワードサインインし、同一プロセス内でセッションを 30 分使い回す（失敗は覚えない）。認証情報が無いと例外になる。匿名サインインへのフォールバックは現行コードに無い（2026-11-15 の `94510a976` で撤去）。同一プロセスで両資格を使う場合は原則2回。別ワーカーや再起動後はそれぞれ認証する。各 spec は自分で部屋を作って後始末するので、同じユーザーでも干渉しない（4 本を 1 レーンで通して確認済み）。
- 使い回しの対象外: `room-invitations-live` `room-network-live` は service-role の `admin.createUser` で一時ユーザーを作り `room-invitations-cleanup.ts` で削除する。自前で `signInAnonymously` するのは `room-public-latency`（`ROOM_PUBLIC_ACCEPTANCE=1` のときだけ実行）のみで、1 回ごとに数回消費する。
- live の spec を繰り返し実走しない。直す途中の確認は `--specs` で必要な 1 本に絞り、失敗の再現が要るときだけ繰り返す。`e2e-changed` の成功は tree・比較基点・実行入力が一致する条件で finish・push・merge の間で再利用できる。
- 上限に当たったら待つ（回復は約 1 時間）。固定ユーザーは通常経路で、作成・設定は利用者の判断。
- レーンは dev server をポートごとに起動する。多重起動は負荷でフレークを生むため、全件実走は 2 レーンまでにする。

## 定期実行の例（利用者が設定する）

Windows のタスクスケジューラなどで、夜間に `pnpm e2e:full` を 1 回走らせ、出口が 0 でなければ結果（実行ログに表示された `.codex-temp/e2e-run/run-*/report.json`）を見る。このリポジトリは CI workflow に Playwright の定期実行を足さない（P2-16 のガードが、workflow の Playwright 行を 1 行に固定している）。

各起動は固有のrun directoryへ一覧・各lane JSON・trace・集計を保存し、別起動の証拠を削除/再利用しない。全件実走は削除されたspecの台帳項目もSTALEとして検出する。
