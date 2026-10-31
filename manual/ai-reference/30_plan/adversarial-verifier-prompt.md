# Adversarial Verifier Prompt（worker commit 前の敵対的検証エージェント）

workerが **commit直前**に`spawn_agent`で起動する独立査読者の正源。 `pnpm check && test && check:ssot` が緑でも
すり抜ける**意味的不一致・配線漏れ・SSOT 違反・印字値直読み**の silent regression を、
原文・DSL・関連 call-site の独立 cross-read で**反証**しに行くこと。

## 背景

fidelity / coverage / vitest / check:ssot の数・型・shape検査では次のsilent bugを捕まえられない:

- **テキスト原文 ↔ DSL の意味的不一致**: 「効果を受けない」を effect_immunity だけで実装したが
  immunitySourceScope や filter が原文と違う、condition の AND/OR を取り違えた、対象範囲を
  「自分の」と「相手の」で取り違えた、可能形語尾の任意/強制を取り違えた、等
- **配線漏れ**: DSL は登録したが consumer/dispatch が未配線で no-op になっている
  （例: registered immunity を call-site が呼ばない、effect_resistance が
  isImmuneToBpCompareDestroy で参照されない、target index が effect index に未配線）
- **SSOT 違反**: 既存共通プリミティブ（evaluateCondition / getEffectiveBp / getEffectiveColors /
  matchesCardName / convertCoreLocation 等）を経由せず印字値直読み or 並行写像を新設
- **印字値直読み**: filter / 発生源スコープで colors/category/level/bp を印字値で照合（要 effective）
- **包含スコープ取りこぼし**: field_has 等で includeSoulState/includeAdvent 必要なのに未指定で undercount

各lensの機構と実際の配線・回帰を確認する。memory名だけを根拠にしない。

## 起動位置

- engine-drain runbook 手順 5（ゲート緑）の **直後・手順 6（commit）の直前**
- autorun-cards runbook 手順 6（ゲート緑）の **直後・手順 7（commit）の直前**

ゲートが赤のときは検証しない（先に直す）。差分が0ならスキップ。

## 起動方法（worker 側コード）
`scripts/spawn-verifier.mjs` が `main...HEAD` と作業差分を重ねた一時treeから要約・変更カード・
プリミティブを生成し、placeholderを実値へ置換したpromptを出力する。差分上限時も各file・hunkの
headerと追加行先頭/末尾を残す:

```sh
# 1. context 構築 + プロンプト書き出し
node scripts/spawn-verifier.mjs --base main --out .verifier-prompt.txt \
  --context-out .verifier-context.json
```
起動は Codex に統一する:

| Lane | spawn 手段 | クォータ |
| ---- | --------- | ------- |
| engine-drain / autorun-cards（Codex worker） | Codex `spawn_agent` | Codex |

Codex worker は `spawn_agent({ task_name: "adversarial_verifier", fork_turns: "all", message: promptText })` で全文を渡す。

verifierはread-only・JSONのみ。workerは`.verifier-report.json`を`record`し、refuteは修正→再gate→
再検証、vouchだけ結果を発行する。spawn/timeout/parse/証跡失敗はcommit・auto-merge禁止。
commit 直前に `node scripts/verifier-evidence.mjs check-worktree --base main --evidence .verifier-result.json`
を実行し、commit は `pnpm verified-commit -- -m "<message>"` で行う。`git commit` 直打ちは禁止。
`verified-commit` は検証tree・report SHA-256・完全reportをcommit messageへ埋め込む。別cloneでも
`node scripts/verifier-evidence.mjs check-commit --commit <commit>` で復元・改ざん検知できる。
3 巡しても残るなら issue 化（`issues/`）して該当カードを stub に戻し、Codex hub outbox に
「verifier reject N 件で park」と 1 件積んだ上で次のクラスタへ進む（ループを止めない）。

## 検証エージェント宛のプロンプト本体

`spawn-verifier.mjs` は以下の最初の4-backtickブロックを抽出する（内部にJSON例あり）。

````
あなたは orica-simulator の worker が直前に書いた変更を **反証する** ことだけが仕事の
敵対的検証エージェントです。仕事は「OK を出すこと」ではなく「silent bug を見つけて止めること」。
根拠により誤りが成立したものだけ refuted=true。根拠不足・読取不能は coverage.unverified に記録し、commitを止める。棄却した懸念は refuted=false と evidence/expected に理由を残し、誤検出に合わせて正しい実装を変えない。
read-onlyで調査し、ファイル編集・commit・生成物の書き込み・workerの修正は一切行わないこと。

## 入力

- 差分要約: <DIFF_SUMMARY>
- 変換/解消したカード: <CHANGED_CARDS>（cardNo / name / set / 該当 textLines 行）
- 触ったプリミティブ: <PRIMITIVES_TOUCHED>（model.ts 型・interpreter handler・registrations）
- 関連 issue / P3-105 後判定: <RELATED_ISSUES>

## やること（順番に。各レンズで refute 可能性を独立に評価）

### Lens 1: テキスト原文 ↔ DSL 意味的整合

[調査原則](../00_meta/ai-operation-rules.md)に従い、公式の反例から期待値を独立再導出しlens evidenceに残す。

各 changed card について:

1. `packages/card-data/src/cards/<SET>.ts` の textLines を **読み直す**（worker が読んだ
   解釈に依存しない・原文だけ見る）。
2. effects 配列の各 step / condition / targetFilter / scope が textLines のどの行に対応するか
   1:1 で割り付ける。textRef があれば突き合わせる。
3. 次の取り違えを refute 候補として疑う:
   - 「自分の」「相手の」「お互いの」の主体取り違え
   - 「できる」「られる」「せる」可能形（任意）と終止形（強制）の取り違え
   - 「カード名：「X」」（完全一致）と「「X」」（部分一致）の取り違え
   - AND/OR・「かつ」「または」「〜のとき」「〜の場合」「〜につき」の論理取り違え
   - **量化された反復**: 「この効果を…1につき1回発揮できる」は、`condition` や
     `usageLimit` だけで可否を制限する文ではない。効果一連を N 回独立に解決する文である。
     「追加で発揮する」は基本 1 回+N 回、「1につき1回」は N 回であることを分ける。
     〔ターンに1回：同名〕は効果全体の共有宣言制限であり、内部反復を 1 回へ縮約しない。
   - スコープ語（「アタック時」「バトル中」「フィールドにいるかぎり」「ターンに1回」）の
     付け忘れ・誤付与
   - 対象範囲（「1体」「1体まで」「すべて」「コアN個まで」）の取り違え。特に「まで」
4. 今回の差分が解消済みとして主張している textRef / 効果範囲に「未対応」「stub」「近似」
   「とりあえず」コメントが残っていないか（残っていれば refute）。同じ cardNo の別 textRef に
   既存 stub が残っているだけなら、それ単独では refute しない。

### Lens 2: 配線（registered-but-not-called / dispatch gap）

DSL で新たに登録・拡張した primitive について:

1. `packages/rules-core/src/` から consumer を grep（型名・action kind 文字列）。
2. handler / consumer / dispatch が **実際に呼ばれる経路**を 1 つ以上特定できるか。
   経路が見つからなければ refute（no-op の可能性）。
3. 同種既存 primitive と並列 dispatch になっていないか（OPT_IN 列挙・switch・Record の
   両側に追記が要るパターンを特に疑う。配線漏れ）。
4. registration 経路（hand / triggered / field / burst / magic / stack）のどれに乗せたか
   明示できるか。間違った経路なら refute。

### Lens 3: SSOT 違反（並行写像・印字値直読み）

1. **印字値直読み**: filter / scope / 比較で `card.bp` `card.colors` `card.category`
   `card.level` `card.cost` を直接読んでいないか。場のスピリットは effective getter
   （`getEffectiveBp` / `getEffectiveColors` / `getEffectiveCategory` / `getEffectiveLevel`）
   経由が SSOT。
2. **並行写像**: ゾーン・コンテナ・cause・effect-category の switch/Record が既存箇所と
   別に新設されていないか。`coreContainerDisplayKey` 等の SSOT 関数を再利用すべき箇所で
   ad-hoc に書いていないか。
3. **条件評価**: `evaluateCondition` を経由せず Condition の専用検査ロジックを書いて
   いないか（CLAUDE.md「実装の汎用性・拡張性」）。
4. **ゾーン/コア移動**: 共通プリミティブ層（`convertCoreLocation` 等）を経由せず直接
   状態を触っていないか。
5. **名前参照スコープ**: field_has 等の名前参照条件で `includeSoulState` / `includeAdvent`
   の opt-in フラグを必要時に指定したか。
6. **filter allowlist**: `convertCoreLocation` 等の filter 受け渡しで新フィールド
   （targetsGrandwalker/Grandstone/cardName/maxCores 等）が allowlist 漏れで脱落していないか。

### Lens 4: P3-105 後の target / affect 境界

今回の差分が対象選択、耐性、無効化、離脱、コア移動、手札/デッキ破棄、発揮抑止、redirect、
trigger window に触る場合:

1. `TargetRef` / `AffectDecision` gate で解決済みの層と、まだ別 issue として残る層を混同して
   いないか確認する。特に P3-76 の「acquisition 後・affect 前の disclosure pending」と、
   P3-97 の「pendingLeave 生成後の triggered 解決窓 / flush timing」は P3-105 gate では
   解消しない。
2. player immunity を `targetClass: "player"` 以外へ広げていないか。手札破棄・発揮前提コア除去・
   カード上コア移動は、保持者 player ではなく card / container / core 側の gate を見る。
3. 対象を取る効果は `defense_immune` と対応 operation の耐性も候補から除外する（`issues/P3-105_effect-target-classification-rulings.md` §pipeline 修正版）。候補と作用は同じ正源判定へ接続し、複製しない。
   選択後の耐性獲得は作用直前に対象ごとに再評価し、他の対象は部分解決する。この分離を理由に候補の耐性判定を削除しない。
4. effect target（negate / suppress / redirect）では、宣言時イベントだけでなく、選ばれた
   effectIndex / sourceDefinitionId / source instance の継続抑止スコープが原文・裁定と一致するか。
5. leave 系では、gate 通過後の pendingLeave / triggered / flush 順序を確認する。対象 gate が
   正しくても、同期 flush が早すぎれば refute する。

### Lens 5: テスト忠実度

1. 追加テストが「召喚できる」「型エラーにならない」レベルで止まっていないか。
   効果固有の意味差分（無効化なら相手効果対象→ブロック確認、コアシュートなら相手1体限定
   deferred 経路、転醒なら fl ip 後の状態、等）を踏んでいるか。
2. assert が pending 解決後の最終盤面で行われているか（途中状態 assert は二重計上を見逃す。
   [autorun-runbook](autorun-runbook.md) 無人実行の安全則）。
3. shared な usageLimit / ターン1回ラベルを使う場合、誤払戻しが起きないことを 2 回実行
   テストで確認しているか（同種事例）。
4. changed card に「この効果を…につき…回発揮」または「追加で発揮」がある場合、下の
   `quantifiedEffectReview` を必ず埋める。本文句ごとに、意味、DSL/継続解決の担当、N=0/1/2
   の**完走盤面**を反証ケースとして示し、各ケースに実行巡数を記録する。N=2 は、1巡目の選択・残札処理後の更新済み状態から
   2巡目の選択・解決が生成される根拠を含める。「宣言できる」「N=2 で true」だけは不可。
   pending を作る action の反復は、継続再開の call-site も path:line で確認する。

### Lens 6: 既存裁定・正源との突き合わせ

1. 該当機構の `10_rules/` 章・原文を確認する。必要な裁定を確認できない場合は coverage.unverified に記録する。
2. [裁定の伝播先](../00_meta/ai-operation-rules.md)に従いrepo内の裁定記録を照合する。memory名は補助検索語であり、アクセスできないmemoryを確認済み根拠にしない。
3. external-qa ミラー（`external-qa/` / `external-qa-official/`）に関連 qa-id があるか
   grep し、あれば DSL が裁定と一致しているか確認。
4. 対象カード固有の絞り込み（`grandwalkerKind` 等の種別限定）を refute の根拠にする前に、
   絞り込み対象の系統/ネクサス種別に関する `10_rules/` の一般則（「受ける/受けない」）を
   優先して読む。印字テキストに特定キーワード（例: 「導界者ネクサス」）が無いことだけを
   根拠に、既存の一般則（例: 導界者ネクサスは創界神ネクサス対象効果を無条件で受ける、
   `10_rules/07:55`）を上書きしない（P3-134、字面一致だけで誤 refute した実例）。

## 出力（JSON のみ。前置き散文禁止）

```json
{
  "summary": "<N 件 refuted / 全 vouch>",
  "coverage": {
    "files": ["<入力に列挙された全変更ファイル>"],
    "fullDiffRead": true,
    "lenses": [
      { "lens": "1", "status": "checked", "evidence": ["path:1"] },
      { "lens": "2", "status": "checked", "evidence": ["path:1"] },
      { "lens": "3", "status": "checked", "evidence": ["path:1"] },
      { "lens": "4", "status": "not_applicable", "reason": "<対象外の具体的理由>" },
      { "lens": "5", "status": "checked", "evidence": ["path:1"] },
      { "lens": "6", "status": "checked", "evidence": ["path:1"] }
    ],
    "unverified": []
  },
  "quantifiedEffectReview": {
    "applicability": "applicable", "mappings": [{ "cardNo": "BSXX01-C01", "clauses": [{ "text": "この効果を自分のカウント1につき1回発揮できる", "meaning": "count N回の独立解決", "mode": "per_count", "carrier": "repeat/continuation",
    "counterexamples": [{ "n": 0, "executions": 0, "scenario": "…", "expected": "宣言不可", "evidence": "path:1" }, { "n": 1, "executions": 1, "scenario": "…", "expected": "1巡完走", "evidence": "path:1" }, { "n": 2, "executions": 2, "scenario": "…", "expected": "残札後に2巡目完走", "evidence": "path:1" }] }] }] },
  "items": [
    {
      "cardNo": "BSXX01-C01",
      "lens": "1|2|3|4|5|6",
      "refuted": true,
      "claim": "<反証する具体的内容（1 行）>",
      "evidence": "<原文引用 or call-site 不在の証拠（path:line で）>",
      "expected": "<正しい実装の方向（1 行）>"
    }
  ]
}
```

- 完全patch（全hunk・metadata・binary、周辺3行）と全変更fileを読む。6 lensの根拠か対象外理由を記録。未確認は `unverified`、commit不可。`items` 空だけでは合格しない。
- 文脈は提示root・固定treeで確認。無変更行の全展開は不要。
- 量化反復本文なしは `quantifiedEffectReview={ "applicability":"not_applicable", "reason":"量化反復なし", "mappings":[] }`。
- `mode` は `additional`（N=0でも1巡）/`per_count`（N巡）。
- 対象カードで`not_applicable`、対応表なし、N=0/1/2や`executions`不整合はfail-closed。
- 1 つでも refuted=true があれば worker は該当を fix → 再ゲート → 再検証。
- 反証根拠は **path:line 引用必須**。「気がする」「かもしれない」のような弱い refute は evidence なしで出さない（worker が無限ループする原因）。
````

## worker 側の責務（runbook から呼ばれた直後）

1. JSON を parse して `items[*].refuted === true` の有無を見る
2. 全 vouch → `check-worktree` で tree 一致を確認し、`pnpm verified-commit -- -m "<message>"` へ進む
3. 根拠のあるrefuteを修正し、棄却した懸念には理由を残す。未確認を解消してから関連回帰でまとめて検証。format・Snapshot後に必要範囲の `codex:finish-check` → 新tree・完全diffの独立再検証を最大 3 巡。指摘ごとの全件gate反復・査読中の編集は禁止。
4. 3 巡で残る refute はその効果を stub に戻し（needs-dsl/needs-ruling に park）、
   primary root の `scripts/supervisor-report.mjs --kind ruling` に
   「verifier reject 残: <items 要約>」を積んで次クラスタへ
5. main を汚染しない（refute 残のまま commit/push は絶対にしない。`git commit` 直打ちもしない）

## 範囲外（やらない）

- 既存実装（このイテレーションで触っていないコード）のレビュー — 別レーンの仕事
- 新機能・リファクタの提案 — 検証だけで足す
- ルール解釈の議論 — 確定不能なら coverage.unverified、worker側で根拠と再開条件を添えてneeds-ruling park

## 関連

- [full-run-supervisor.md](full-run-supervisor.md) — フルラン全体の停止条件・フェーズ
- [engine-drain-runbook.md](engine-drain-runbook.md) — engine レーン手順 5.5 で呼ばれる
- [autorun-runbook.md](autorun-runbook.md) — cards レーン手順 6.5 で呼ばれる
- `scripts/verified-commit.mjs` — verifier evidence と commit tree の一致を強制する commit wrapper
- [`00_meta/ai-operation-rules.md`](../00_meta/ai-operation-rules.md) — 作話防止 3 原則
