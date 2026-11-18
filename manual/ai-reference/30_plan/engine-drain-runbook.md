# Engine-drain Runbook（エンジン/DSL ギャップ解消ループ）

needs-dsl キューと忠実度違反（stub）を解消する**単一ライターループ**の正源。
カード変換ループ（`autorun-runbook.md`）と対をなす。上位の運用は CLAUDE.md Cross-cutting Rule、
フェーズ遷移は `full-run-supervisor.md`。
worker が読む実行プロンプトは [lane-prompt-codex-engine.md](lane-prompt-codex-engine.md) が正源
（`lane-prompts.md` は索引で、Claude Engine Lane は廃止済み）。

## 原則

- **rules-core（model.ts / interpreter / registrations / generated-index）を書くのはこのループだけ。**
  card 変換 worker は絶対に触らない（A方式の単一ライター原則を無人化したもの）。
- 隔離: 専用 worktree `C:\dev\orica-wt\engine-drain`（branch `feat/engine-drain`、
  `scripts/new-worktree.ps1 -Task engine-drain -From main` で作成）。固定先の正源は
  `scripts/full-run-checkouts.json`。main の working tree は触らない。
- main への追従は wrapper が `scripts/sync-worktree-to-main.mjs` で行う（worker は run 冒頭で
  手動 `git merge --ff-only main` しない）。worktree 新規時は `pnpm install` + `npx tsc -b`
  も実行（vitest 前に必要）。

## キューの正源（優先順）

1. **bootstrap**: `pnpm fuzz` の stuck/error 解消
   （P3-91 — **解消済み 2026-06-11**）。
   fuzz が赤に戻ったら常に最優先。
2. **ユーザー指示・報告 issue**（着手順: 小バグ → リファクタ。2026-06-11 全 issue 棚卸しで
   2d-2g を挿入 — いずれも fidelity 違反 0 のブロッカーと確認済み）:
   - 2a〜2h は全て完了・archive 済み（日付と詳細は各 issue）:
     P3-93（GUI 挙動とテキストの整合）/
     P3-94（導/神 特殊シンボル軽減＋印字 symbol の機械照合 `symbol_mismatch`）/
     P3-92（神託/解封/創界石転醒を `PendingTriggeredEffect.mechanic` の誘発キューへ統一）/
     P3-90（手動コア移動の独立コア管理ガード）/
     P3-75（汎用 negate 実効化）/
     P3-76（targeted 系誘発の対象開示→応答窓。P3-105 の共通判定とは別に、対象確定後・作用前の開示、応答と再開を実装済み。残る target-rank 候補は別ギャップ）/
     P2-05（複数ブロッカー全 Phase）/
     P3-134→P3-137（`grandwalkerKind` narrowing 誤判定の全数監査）。
3. **needs-dsl**: `autorun-queue/needs-dsl.*.jsonl` の `status:"open"` 行。
   **型拡張クラスタ**（AdventCondition.cardNames / 動的 maxBp / ターン条件 ConditionClause /
   待機状態同名制限 / 多重煌臨ほか）は
   P3-89 型拡張ギャップ詳細 の「真の未実装」リストを
   正源とし、遭遇時に実装してチェックを消し込む。
4. **忠実度違反**: `pnpm cards:fidelity --json` の violations（stub / uncovered_line / no_textref / symbol_mismatch ほか。種別と review の扱いは [検出契約](../00_meta/fidelity-detection.md)）。
   needs-dsl に無い stub も全て解消対象（停止条件が違反 0 のため）。

## 1 イテレーションの手順

1. **残量把握**: `pnpm cards:fidelity` の violations を確認。`pnpm cards:rank` で needs-dsl
   open を機構別クラスタに集計（解消枚数降順）し、`pnpm snapshot --check` で現残量と low-water
   からの増減を確認する。
2. **クラスタ選択**: `pnpm cards:rank` の上位（unblock 枚数が多い機構）を起点に、
   **1 プリミティブ＝1 イテレーション**で処理する。選択基準: bootstrap 残があればそれ →
   枚数/実装コスト比の高い機構（10_rules で確定できるもの）→ 小さい完了単位。
   P3-105 後の active issue を扱う場合は、各 issue の「P3-105後判定」節を読み、target/affect gate
   で解決済みの層と、trigger/disclosure/flush など gate 外の残作業を分けてから実装する。
   - **クラスタ一括消化（B1）**: 選んだプリミティブを実装したら、**同じイテレーション・
     同じ worktree で、そのプリミティブが unblock するクラスタ内カードを全部 stub 解消する**
     （`pnpm cards:rank --cluster <語>` で対象カードを列挙）。プリミティブ着地と解禁カード
     変換を別イテレーションに割らない＝1 イテレーションの stub 減少を最大化する。
     対象が多すぎて 1 run（再起動可能性・ロック TTL）に収まらない見込みなら、同クラスタを
     枚数で分割し各サブバッチを個別 commit する（途中停止しても再開地点が明確）。
3. **ルール正源確認**: 実装前に `10_rules/` の該当章を読み、挙動の根拠行を引用できることを確認
   （`00_meta/ai-operation-rules.md`。確定しないものだけ needs-ruling park → Codex hub 質問）。
4. **実装**: 型/DSL 拡張 → interpreter/エンジン配線 → **そのプリミティブが解禁するクラスタ内
   カードを全部** effects から stub 解消（B1 一括消化）→ **カード毎最小 1 テストで、効果固有の
   意味差分を踏む**（「召喚できる」「型が通る」ではなく、原文の効果が成立する/しない側を
   assert する）。例: 耐性なら相手効果対象→ブロック確認、コアシュート単源なら相手1体限定
   deferred 経路、転醒なら flip 後の状態、destroyed_when なら離脱時残存と pending 解消、等。
   各テストは pending を解決し切った**最終盤面**で assert する（途中状態 assert はルール適用と
   二重計上を見逃す）。テスト本体に cardNo 文字列を直接引用する（`pnpm cards:test-coverage`
   の参照解析で機械検出する）。専用フィールド・並行写像を作らない（SSOT）。
   queue 行を `resolved` 化し、`cards:fidelity` 再計測と
   `pnpm snapshot --measure --landing "<着地 (stub A→B)>"` もここで済ませる。snapshot や queue 更新は
   verifier 後に tree を変えるため、commit 直前ではなく verifier 前の検証対象 tree に含める。
5. **ゲート**: `pnpm codex:finish-check --plan` で選択を確認 → `pnpm codex:finish-check`
   （差分から型・全件テスト・`check:ssot`・`check:wiring` 等を選ぶ。入口の正源は
   [harness-validation.md](../00_meta/harness-validation.md)、必須 gate は
   [lane-prompt-codex-engine.md](lane-prompt-codex-engine.md)）。
   `check:wiring` は Action kind を model.ts に追加したが consumer が未配線の silent gap
   （`registered-but-not-called`）を機械検出する。許可は `scripts/check-wiring-allowlist.json`
   （任意。現状このファイルは無く許可 0 件）。
   カード追加・変更は `pnpm cards:test-coverage --gate`（変更カードに cardNo を引用する test 参照が
   無ければ fail。意味差分テスト忘れ防止の存在ゲート）。緑でなければ直すか revert。
   pre-push は `pnpm verify:push`、auto-merge.ps1 は `pnpm verify:merge` を別に実行する。
   - **GUI 整合**（P3-93 原則）: 実装した効果/ギミックが GUI に出す選択モード・ピッカー variant
     がカードテキスト上意味を持つことを pending 生成の unit test で assert する
     （例: 行き先がトラッシュなら順序選択 pending を生成しない、独立コア管理カードの配置で
     維持コア選択を出さない）。GUI スコープの修正もこのループの対象（apps/playground-web を
     含む。実ブラウザの人間レビューは不要 — displayState/pending の unit test + e2e で代替）。
5.5. **敵対的検証（必須）**: ゲート全緑直後、`adversarial-verifier-prompt.md` に従う。
   `node scripts/spawn-verifier.mjs --base main --out .verifier-prompt.txt --context-out
   .verifier-context.json` で commit 済み + staged + unstaged + untracked を一時treeへ正規化する
   （実indexは変更しない）。main worker は prompt 全文を Codex `spawn_agent` の `message` に渡し、
   verifierを read-only で起動する。最終回答は JSON のみとし、`.verifier-report.json` へ保存後、
   `node scripts/verifier-evidence.mjs record --context .verifier-context.json --report
   .verifier-report.json --out .verifier-result.json` でmain workerがparse・証跡生成する。
   `node scripts/verifier-evidence.mjs check-worktree --base main --evidence .verifier-result.json` で、
   commit 前の worktree tree と証跡 tree が一致することも確認する。
   - 全 vouch（`items` 空 or 全 `refuted:false`）→ 手順 6 へ。
   - 1 件でも `refuted:true` → `expected` に従い worktree 内で修正 → 手順 5 ゲート再実行 →
     再検証。最大 3 巡。3 巡で残った refute は該当 effect を stub に戻し、対応する
     needs-dsl/needs-ruling を append → primary root の `scripts/supervisor-report.mjs --kind ruling` に「verifier reject N 件で park」
     と 1 件報告 → 次クラスタへ。**refute 残のまま commit/push は禁止**（fidelity/test が緑でも
     silent regression を main に押し込まない正源ゲート）。spawn失敗・timeout・JSON parse失敗・
     証跡生成失敗も禁止。全vouch時だけ証跡ができ、検証後にtreeが変われば
     `verified-commit` / `auto-merge` が拒否する。
6. **commit**: `pnpm verified-commit -- -m "feat: <機構と解消カードが分かる粒度>"` を使う。
   `git commit` 直打ちは禁止（hook で拒否）。wrapper が `.verifier-result.json` を commit 前 worktree tree と
   commit 後 branch tree の両方に照合する。手順 4 の `pnpm snapshot` が low-water 超過を警告したら
   監査死角の発見＝意図通りか確認する。残量行末尾の注記変更は `pnpm snapshot --note "<注記>"`。
7. **統合**: `node scripts/supervisor-integration.mjs request` で親runnerへ渡す。
   fuzz省略は要求しない。確認記録のみの検証範囲はmanifestが自動判定する。要求後はtreeを変更せず終了する。受理はpush完了ではない。
   runner外のauto-mergeはforegroundで実行し、継続session IDと終了コードを回収する。
8. **報告**: `node C:\dev\orica-simulator\scripts\supervisor-report.mjs --kind progress "<イテレーション要約と残量数値>"`（1 件）。

## park（裁定が必要なとき）

`10_rules/` でも確定できない場合のみ `needs-ruling.jsonl` に 1 行 append し、
**同時に question 全文を primary root の `scripts/supervisor-report.mjs --kind ruling --stdin` で
hub outbox に積んで**から
次のクラスタへ進む。
ユーザー回答が来たら同ループ内で実装し、行を `resolved` に。判断保留でループは止めない。

## 運用移行条件

[Full-run Supervisor「現在の範囲と移行条件」](full-run-supervisor.md) を参照する。coverage / fidelity は review の残数を含めて判定する。

## Cluster 運用 (Codex-only)

engine-drain は Codex worker だけで実行する（`lane-prompts.md` の Lane 構成参照）。
**rules-core 単一ライター原則を「ファイル単位」から「cluster 単位」に緩める**。
claim した cluster のみ rules-core を触る。共通ファイル touch は新規プリミティブ専用ファイルへの分離を優先。
割当と状態の正源は `autorun-queue/cluster-registry.json`。owner 表は本書に複製しない
（個別 cluster は全て `status:"done"`、open は catch-all の `claude-explore` / `codex-explore` のみ。2026-11-18 確認）。

### 機械ロック（`scripts/cluster-claim.mjs`）

- registry の各 cluster は `lane`（card-impl / codex / any。claude は履歴互換値で Codex takeover） と
  `status`(open/done) と `scope` を持つ。`precondition`（例 `fidelity-total-zero`）未充足の cluster は claim 対象外。
- `claim --lane <lane> --token <uuid> [--ttl <min>]` は lane 一致または `any` かつ status:open かつ
  `cluster-<id>` lock 空の先頭 cluster を atomic に acquire し `{clusterId, scope, ...}` を返す。
  **現在 claim を呼ぶのは card-impl wrapper（`run-card-impl-iteration.ps1`、`--lane card-impl --ttl 60`）だけ。**
  supervisor wrapper（`run-supervisor-iteration.ps1`）は claim せず、fresh 監査の対象カードを直接指示する
  （[full-run-supervisor.md](full-run-supervisor.md)）。「claim 失敗 → 探索モード」の旧 fallback と
  一般 cluster の自動 claim は現行範囲では使わない。
- **off-limits 注入**: `list-locked --exclude-lane <自 lane>` が他 lane の *active hold* 中 cluster の
  `{clusterId, scope, ownerLane}` を JSON 列挙し、supervisor / card-impl 両 wrapper が prompt に展開する。
  worker はその scope を触らない。STALE/未 hold の cluster は含まない。supervisor wrapper は照会失敗を
  「ロックなし」と扱わず次 run で retry する。
- lock は supervisor-lock の汎用 lane lock を `cluster-<id>` で再利用。**id に colon 不可**
  (Windows ADS 破損、`orica-supervisor.cluster` 0byte 化)。colon-free 必須。
- claim の TTL 既定は 240min（run 上限相当）。cluster lock は heartbeat refresh しない。
  run 終了で wrapper が finally で release、crash 時は TTL 後に stale 回収。
- 完了 cluster は `node scripts/cluster-claim.mjs done --id <id> --commit <sha> --note <msg>` で
  `status:"done"`。`needs-dsl.audit.jsonl` 起点 cluster は card-impl wrapper が claim 直前に呼ぶ
  `cluster-claim.mjs audit --apply` が queueRefs から機械的に done 化する
  （stale open が残ると claim が成功し続け lane が空回りする 2026-06-20 障害の対策）。

`needs-dsl.*.jsonl` の owner 規約:
- `owner:claude` 行は legacy 値として Codex lane が drain
- `owner:codex` 行は Codex lane が drain
- `owner` 未指定行は scope 確認の上で着手
- 行を着手するときは status を "in_progress" に更新し、commit と同一サブバッチ内で "resolved" 化

Cluster owner 変更が必要なら、hub outbox / supervisor-report 経由で宣言してから着手。

## 既知の大型クラスタ

2026-06-11 時点の見取り図にあった煌臨・転醒・negate・複数ブロッカー等は、P3-14 / P3-75 / P3-76 / P2-05
を含め archive 済み。現在の未実装ギャップは P3-89 型拡張ギャップ詳細 と
issues/00_index.md を参照。Ver.17 新表記（ドロー/Lv/除外の省略）は読み替えのみで
基盤不要（同義表: `10_rules/03c`、P2-06 archive 済）。
