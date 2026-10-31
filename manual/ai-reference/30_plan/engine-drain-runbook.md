# Engine-drain Runbook（エンジン/DSL ギャップ解消ループ）

needs-dsl キューと忠実度違反（stub）を解消する**単一ライターループ**の正源。
カード変換ループ（`autorun-runbook.md`）と対をなす。上位の運用は CLAUDE.md Cross-cutting Rule、
フェーズ遷移は `full-run-supervisor.md`。
sub-agent 起動時の具体プロンプトは `lane-prompts.md` の Engine Lane を正源にする。

## 原則

- **rules-core（model.ts / interpreter / registrations / generated-index）を書くのはこのループだけ。**
  card 変換 worker は絶対に触らない（A方式の単一ライター原則を無人化したもの）。
- 隔離: 専用 worktree `C:\dev\orica-wt\engine-drain`（branch `feat/engine-drain`、
  `scripts/new-worktree.ps1 -Task engine-drain -From main` で作成）。main の working tree は触らない。
- run 冒頭で `git merge --ff-only main` して main に追従する（worktree 新規時は
  `pnpm install` + `npx tsc -b` も実行。[[project_worktree_test_setup]]）。

## キューの正源（優先順）

1. **bootstrap**: `pnpm fuzz` の stuck/error 解消
   （[P3-91](../../../issues/archive/P3-91/index.md) — **解消済み 2026-06-11**）。
   fuzz が赤に戻ったら常に最優先。
2. **ユーザー指示・報告 issue**（着手順: 小バグ → リファクタ。2026-06-11 全 issue 棚卸しで
   2d-2g を挿入 — いずれも fidelity 違反 0 のブロッカーと確認済み）:
   - 2a ✅ 完了（2026-06-12, [archive/P3-93](../../../issues/archive/P3-93/index.md)）。GUI 挙動と
     テキストの整合（観測バグ 2 件＋横断監査）。bug1: forbidden（独立コア管理）は場入り pending
     非生成で無意味な維持コア選択 HUD を抑止 / bug2: deck_reveal trash 即確定。
   - 2b ✅ 完了（2026-06-12, [archive/P3-94](../../../issues/archive/P3-94/index.md)）。観測バグ修正
     （導/神 特殊シンボルの軽減成立）+ 印字 symbol/reduction の external-qa ミラー機械照合を
     cards:fidelity ゲートに追加（`symbol_mismatch`）。
   - 2c ✅ 完了（2026-06-12, [archive/P3-92](../../../issues/archive/P3-92/index.md)）。誘発任意効果
     （神託/解封/創界石転醒）を `PendingTriggeredEffect.mechanic` として誘発キューへ統一
     （専用 pending/action 3 種廃止 + skipOnly drain 移植）。煌臨/転醒クラスタの needs-dsl 解禁。
   - 2d ✅ [P3-90](../../../issues/archive/P3-90/index.md) 手動コア移動の
     独立コア管理（創界神/導界者/創界石）ガード。P3-93 と同軸の小バグ、GUI+REST 双方向。
   - 2e ✅ [P3-75](../../../issues/archive/P3-75/index.md) 汎用 negate 実効化。
     「無効/発揮されない」系 stub 約 21 枚＋needs-dsl 現役（BSDB01-M02 等）のブロッカーを解消。
     P3-77 残カードも解消済み。2026-08-06 依存カード6件（BSGE01-C17/BSKB01-C05/BSAZ02-C14/
     BSAZ03-C01/BSLH01-T14 等）全数確認・fidelity clean と合わせ archive 化。
   - 2f ✅ [P3-76](../../../issues/archive/P3-76/index.md) targeted 系誘発の汎用
     「対象開示→応答」窓。「相手の効果の対象になるとき」stub 約 13 枚のブロッカー（2c の統一基盤上に作る）。
     P3-105 の TargetRef / AffectDecision は対象集合決定後の gate であり、acquisition 後・affect
     前の disclosure pending を実装済み。残る target-rank 候補は別ギャップとして扱う。
   - 2g ✅ [P2-05](../../../issues/archive/P2-05/index.md) 複数ブロッカー — Phase 1-4+GUI
     完了 (2026-06-13)、XX01「ただちにアタック」完了 (2026-07-08)、Phase 5
     （BSFT01-TR06(B) 型 1 participant 複数 blocker）完了 (2026-07-12)。全 Phase 完遂。
   - 2h ✅ [P3-134](../../../issues/archive/P3-134/index.md)
     `grandwalkerKind:"grandwalker"` narrowing が導界者ネクサスを誤って対象/範囲外にしている
     silent bug、全数監査で8件確定のうち7件修正完了（BSTH02-C21/X01, BSRK01-R02,
     BSLH01-M01/R02/R06/T04）。残る BSTH001-C01/C02 は `targetsGrandwalker:true`(boolean) +
     `tribes:["創界神"]` という別原因（grandwalkerKind は死んだフィールド）と判明したため
     [P3-137](../../../issues/archive/P3-137/index.md)
     （同型パターン18箇所の個別監査、2026-08-04 完了）へ切り出し。
3. **needs-dsl**: `autorun-queue/needs-dsl.*.jsonl` の `status:"open"` 行。
   **型拡張クラスタ**（AdventCondition.cardNames / 動的 maxBp / ターン条件 ConditionClause /
   待機状態同名制限 / 多重煌臨ほか）は
   [P3-89](../../../issues/P3-89_autorun-overstub-coverage-fidelity.md) の「真の未実装」表を
   正源とし、遭遇時に実装してチェックを消し込む。
4. **忠実度違反**: `pnpm cards:fidelity --json` の violations（stub / uncovered_line / no_textref）。
   needs-dsl に無い stub も全て解消対象（停止条件が違反 0 のため）。P3-88「コアN個まで」の
   stub 移行（~16 枚）もここに内包。

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
5. **ゲート**: `pnpm check` → vitest 全件 → `pnpm check:ssot` → `pnpm check:wiring`
   （Action kind を model.ts に追加したが consumer が未配線の silent gap 検出。
   `registered-but-not-called` を機械検出する。allowlist は `scripts/check-wiring-allowlist.json`）
   → `pnpm cards:test-coverage --gate`（変更カードに cardNo を引用する test 参照が無ければ
   fail。意味差分テスト忘れ防止の存在ゲート）。緑でなければ直すか revert。
   auto-merge.ps1 / pre-push でも同 5 ゲートが走る。
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
   `git commit` 直打ちは禁止。wrapper が `.verifier-result.json` を commit 前 worktree tree と
   commit 後 branch tree の両方に照合する。snapshot が low-water 超過を警告したら監査死角の発見＝
   意図通りか確認。残量行末尾の注記変更は `--note "<注記>"`。
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

## 完了条件（このループの出口）

- needs-dsl open 0 ∧ `pnpm cards:fidelity --gate` 緑 ∧ `pnpm fuzz` 緑（FUZZ_GAMES=300 以上）

到達したら supervisor がカード変換 worker / 弾別検証フェーズに進む。

## Cluster Owner 表 (Codex-only)

engine-drain は Codex worker だけで実行する（`lane-prompts.md` の Lane 構成参照）。
**rules-core 単一ライター原則を「ファイル単位」から「cluster 単位」に緩める**。
各 worker は claim した cluster のみ rules-core を触る。共通ファイル touch は新規プリミティブ専用ファイルへの分離を優先。

| Cluster | Owner | 関連 issue / queue |
| ------- | ----- | ------------------ |
| P3-100 star-garment undercard subsystem | Codex (大型・要連続セッション) | issues/P3-100 |
| advent-wiring 残 | Codex (worktree 既存) | engine-drain 上で進行 |
| **audit findings 22件** (BSGE01-M03 致命他) | **Codex (legacy Claude takeover)** | autorun-queue/needs-dsl.audit.jsonl |
| **divine-skill / 神技拡張** (audit 完了後) | **Codex (legacy Claude takeover)** | memory project_divine_skill_model_target_maxuses |

### 機械ロック (choice X: claim 優先 + フォールバック, 2026-06-20)

cluster owner 表は人手用の見取り図。**機械的強制は `autorun-queue/cluster-registry.json` +
`scripts/cluster-claim.mjs`** で行う:

- registry の各 cluster は `lane`(legacy claude/codex/any) と `status`(open/done) と `scope` を持つ。
- lane wrapper は run 冒頭で `cluster-claim.mjs claim --lane <lane> --token <uuid>` を呼ぶ。
  lane 一致 + status:open + `cluster-<id>` lock 空 の先頭 cluster を atomic に acquire し、
  `{clusterId, scope}` を返す。wrapper はそれを prompt に注入し、LLM はその scope を優先する。
- **claim 失敗 (lane:lane open cluster 全てが他 hold or 0件) → 探索モードへフォールバック**:
  - LLM は engine-drain-runbook §キューの正源 の優先順から1つ拾う
  - `needs-dsl.*.jsonl` の `owner:codex` と legacy `owner:claude` を Codex が処理し、
    owner 未指定は scope 確認の上で着手可
  - 両 lane が同時に探索モードに入る可能性があるため、**off-limits 注入が唯一の防御**
- **off-limits 注入** (`cluster-claim.mjs list-locked --exclude-lane <自 lane>`):
  - 他 lane が *active hold* している cluster の `{id, scope, ownerLane}` を JSON 列挙
  - prompt の off-limits ブロックに展開し、LLM はそれらの scope を触らない
  - **STALE/未 hold の cluster は off-limits に入らない** (=「相手が今走っていないなら触れる」)
  - catch-all (`claude-explore`/`codex-explore`) も list-locked ベースなので「実際に hold 中だけ」off-limits 化
- lock は supervisor-lock の汎用 lane lock を `cluster-<id>` で再利用。
  **id に colon 不可**(Windows ADS 破損、`orica-supervisor.cluster` 0byte 化)。colon-free 必須。
- TTL は run 上限(240min)より長い 300min（cluster lock は heartbeat refresh しない）。
- run 終了で wrapper が finally で release。crash 時は 300min 後に stale 回収。

これにより複数 Codex worker が同じ cluster を触ることを wrapper 側で防ぐ。
`run-supervisor-iteration.ps1` が codex/legacy claude lane の claim + off-limits +
フォールバックを一括して担う。

`needs-dsl.*.jsonl` の owner 規約:
- `owner:claude` 行は legacy 値として Codex lane が drain
- `owner:codex` 行は Codex lane が drain
- `owner` 未指定行は探索モードのときのみ、scope 確認の上で着手
- 行を着手するときは status を "in_progress" に更新し、commit と同一サブバッチ内で "resolved" 化

ルール:
- registry の lane 割当 + active hold off-limits の二重で overlap を防ぐ。
- Cluster owner 変更が必要なら、相手 lane の hub outbox / supervisor-report 経由で宣言してから着手。
- 完了 cluster は registry の `status:"done"` に更新し owner 表からも外す (本表は live スナップショット、月次で剪定)。手動更新は `node scripts/cluster-claim.mjs done --id <id> --commit <sha> --note <msg>`、`needs-dsl.audit.jsonl` 起点 cluster は wrapper が claim 直前に呼ぶ `cluster-claim.mjs audit --apply` が queueRefs を辿って機械的に done 化する (2026-06-20 追加。これが無いと完成済 cluster が永久 open のまま claim が成功し続け、`claim 失敗 → 探索モード fallback` が永遠に発火せず lane が無限 no-op に陥る)。

## 既知の大型クラスタ（2026-06-11 時点の見取り図）

煌臨・契約拡張（AdventCondition.cardNames / 多重煌臨 / 煌臨元付与）、転醒拡張＋星霊衣
（[[project_under_card_generic_model]] = 汎用アンダーカード基盤）、grant_effect、
動的コスト/召喚条件、negate 実効化（P3-75 → キュー 2e）、複数ブロッカー（P2-05 → キュー 2g）、
クォーツ set-effect、極値セレクタ等。Ver.17 新表記（ドロー/Lv/除外の省略）は読み替えのみで
基盤不要（同義表: `10_rules/03c`、P2-06 archive 済）。対応 issue: P3-14 / P3-16 / P3-75 / P3-76 / P3-89 / P2-05。
