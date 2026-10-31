# Guard-audit Runbook（機械ガード増設ループ）

**「1 イテレーション = 機械ガードを 1 本増やす」**ループの正源。
`engine-drain-runbook.md`（stub/needs-dsl ドレイン = 縦方向）と対をなす**横方向**のループ。

## このループが埋める穴

fidelity gate が緑になっても保証されるのは「effects が存在する」ことだけで、
**意味が正しいことは何も保証しない**。実際 2026-08-02 の対話セッションで、
fidelity 緑の状態から silent bug が 5 系統見つかっている（系統 AND が既定 OR に落ちる /
コア移動元候補判定の 5 経路分裂 / 耐性判定の別経路 / textRef 索引ずれ 33 件 /
`《ソウルコア》以外` の effectKind 欠落）。

これらに共通するのは**外部オラクルが要らない**こと。「同じ概念の判別が 2 箇所にある」
「型は広いのに射影が狭い」という**実装だけを見て決定論的に候補が出せるクラス**で、
LLM に「正しい挙動」を推論させる必要がない。ここを自律化する。

## check:ssot との役割分担（補集合）

| | 対象 | 性質 |
|---|---|---|
| `pnpm check:ssot` | RULES に**登録済み**の概念 | gate（違反で exit 1、偽陽性ゼロ優先） |
| `pnpm scan:ssot-candidates` | **未登録**概念の候補 | 探索器（常に exit 0、分類前提） |

穴は常に「まだ登録していない概念」側にできる。探索器で候補を出し、全件分類し切ったら
`check-ssot.mjs` の RULES へ**卒業**させて gate 化する。卒業したら probe は
`scripts/ssot-candidate-scan.mjs` の `PROBES` から削除する（二重管理は
graduation warning が機械検出する）。

## 1 イテレーションの手順

1. **probe を 1 本足す**（または既存 probe の未分類候補を消し込む）
   - `scripts/ssot-candidate-scan.mjs` の `PROBES` に追加
   - `pattern` は **判定**を狙い、**抽出**は狙わない（後述）
2. **候補列挙**: `pnpm scan:ssot-candidates`
3. **全件分類**: 各候補を次のいずれかに落とす。**中間状態を残さない**
   - **(a) 正源へ寄せる** — 同じ概念。正源関数を呼ぶよう書き換える
   - **(b) 別概念として分類** — `classified` に `{file, match, reason}` を追記。
     `reason` は「**なぜ正源では表現できないか**」を書く（「別物だから」は不可）

   境界は probe の `classificationPolicy` に書く。既定は
   **`subset-type-unification`**（2026-08-03 確定）= 「別型だが意味論は同じ」も (a) に含め、
   正源型のサブセット再定義は**型統合まで踏み込む**。呼び出しだけ寄せてサブセット型を
   残すと、次に軸が増えたとき同じ取りこぼしが再発するため
   （2026-08-02 の系統 AND バグはこの射影の欠落で発生）。
   規模が 1 イテレーションを超えるなら cluster を分割してよいが、
   **「呼び出しだけ寄せた」状態を完了扱いにしない**。残りは後続 cluster として propose し、
   probe の卒業はその完了後とする。
4. **意味差分テスト**: (a) で挙動が変わった経路には最小 1 テスト。
   型が通ることではなく、**取りこぼしていた軸**（AND/OR、必須系統、除外）を assert する
5. **卒業**: 未分類 0 になったら `check-ssot.mjs` の RULES へ移し、probe を削除
6. **ゲート**: `pnpm check` → `pnpm test` → `pnpm check:ssot` → `pnpm check:wiring`
   → `pnpm cards:test-coverage --gate` → 敵対的検証
7. **`pnpm verified-commit -- -m "<message>"`** → `auto-merge.ps1` で main へ ff-only（**foreground 必須**、
   [[project_scheduled_wakeup_headless_orphan_merge]]）

## 完了の定義（機械判定可能）

1 イテレーションは次の**いずれか**を満たしたら完了。満たさないなら未完了。

- `check-ssot.mjs` の `RULES` が 1 本増えている（＝ probe が卒業した）、**または**
- 既存 probe の未分類候補が減り、減った分がすべて (a) 修正 or (b) 理由付き分類になっている

**「候補を見たが判断保留」で終わるのは不可。** 分類も成果と数える設計なので、
no-op に逃げる正当な理由が構造上存在しない。

## probe の作り方 — 「判定」を狙い「抽出」を狙わない

偽陽性でループが死ぬ最大の原因は、概念の**構成部品**を検出してしまうこと。

- ✗ `def.tribe.split("・")` → 系統トークンの**抽出**。40+ 箇所あり全部正当
- ○ `tribes.some(t => parts.includes(t))` → 系統の**マッチ判定**。正源が持つ
  4 軸（tribesLogic / tribesRequired / excludeTribeSubstring / noTribes）を
  インライン実装は必ず取りこぼす

判別基準: **正源関数が「複数の軸を一括で見る」なら、その一括適用こそが守るべき概念**。
部品単体の使用は分散していてよい。probe を書く前に正源関数の本体を読み、
「この関数が一括で見ている軸は何か」を列挙してから pattern を決める。

### probe は「既知の実バグコード」で陽性を確認してから登録する（必須）

現在の main だけで pattern を書くと、**修正済みのバグ形状を狙えていないのに 0 件で
緑に見える**空虚な gate ができる。必ず修正コミットの**親**を取り出して当てる:

```bash
git show <fix-sha>~1:packages/rules-core/src/<file>.ts > /tmp/prefix/.../<file>.ts
node scripts/ssot-candidate-scan.mjs   # PROBES に入れる前に prototype で当てる
```

2026-08-03 の probe #2 作成時、この確認を先にやったことで **2 回の外し**が判明した:

1. 「フィールド列挙コピー = `{ a: src.a, b: src.b }`」と仮定 → 276 件の偽陽性
   （`options` からの引数構築を拾った。スコープが広すぎ）
2. 「素のスプレッドが無いもの」で絞る → **0 件**。実バグは per-field の
   **条件付きスプレッド** `...(src.k ? { k: src.k } : {})` なので `...` を含み、
   除外条件が真逆だった

正解は「同一ソースへの per-field 条件付きスプレッドが 2 個以上」＋「ソースが filter 系」。
修正前コードに当てなければ 2 の誤りに気付けず、0 件緑のまま登録していた。

## 偽陽性の扱い

既に `symbol-audit-exceptions.json` / `optional-wording-exceptions.json` /
`continuity-wording-exceptions.json` の運用がある。本ループの `classified` も同系。
**偽陽性を理由付きで分類することが成果**であり、「疑わしきは修正」で
意味の違うものを統合するより安全側に倒す。

判断がつかない候補（原文読解や裁定が要る）は `needs-ruling.jsonl` へ park し、
その 1 件だけ未分類のまま残してよい。ただし park 理由を `classified` ではなく
queue 側に書き、次イテレーションで拾えるようにする。

## レーン構成

- **worktree**: `C:\dev\orica-wt\guard-audit`（branch `feat/guard-audit`）
- **cadence**: 週次。engine-drain（1h）とは別 lane lock なので並走可
- **cluster**: `cluster-registry.json` に `lane: "claude"` で propose する。
  scope は **probe 1 本**に相当する粒度まで割る
- **着手の解禁は機械ゲート**: cluster に `precondition: "fidelity-total-zero"` を付けると、
  `fidelity-baseline.json` の `current.total` が 0 になるまで `claim` が当該 cluster を
  skip する（stub ドレインを本ループが横取りしない）。status は `open` のままなので
  既存の「claim 失敗 → 探索モード fallback」がそのまま働き、skip 理由は stderr に残る。
  **手動で status を戻す運用は採らない**（忘却で永久 park 化するため）
- engine-drain とは触るファイルが重なるため、**同一 cluster の同時 hold は
  off-limits 注入で防ぐ**（既存機構をそのまま使う。新規配線不要）

### cluster に持たせるフィールド

計画と実行を分離するので、cluster 側に「成果・ガードレール・完了の定義」を持たせる。

- `scope` — 既存。probe 1 本の範囲
- `doneDefinition` — 上記「完了の定義」を機械判定可能な形で 1 行
- `guardrails` — 触らない範囲、使ってはいけない手（専用フィールド追加禁止 等）
- `evidence` — **planner が実行した `scan:ssot-candidates --json` の出力**。
  実行者が「blocked」と誤判定して no-op するのを、禁止則ではなく証拠で潰す

`evidence` が入っている cluster は、実行者に「探せ」と言わずに済む。これが
lane prompt から探索手順（優先順・blocked 判定の必須検証・promote 義務）を
外せる条件になる。

### フルラン停止条件との関係（重要）

`precondition: fidelity-total-zero` の解禁条件は、フルラン**停止条件 2**
（`cards:fidelity --gate` 緑）と同一。そのため本ループを停止条件に入れないと、
**解禁と同時にフルランが止まり cluster が永久に claim されない**。

対策として `full-run-supervisor.md` に**停止条件 8**
（`pnpm scan:ssot-candidates --gate` 緑）を追加済み（2026-08-03）。
フェーズ順序は engine（1〜4 達成）→ **guard-audit（8 達成）** → D. 最終検証。

## 停止条件 / 枯渇

- probe は有限。候補が尽きたら**このループは正常終了**してよい（engine-drain と違い
  「残量 0」が定義できる）
- 枯渇したら次の探索クラスへ移る。優先順:
  1. **内部一貫性**（本ループ。オラクル不要）
  2. **原文語彙 → 必須 DSL フィールド**の対応欠落
     （既存 `optional_wording` / `continuity_wording` / `immunity_zone_scope` と同型）
  3. **external-qa の Q&A をテスト化**（外部オラクル。カバー率は低いが確度は最高）
- 停止/再開/方針転換はユーザー専権

## クラス 2（原文語彙 → 必須 DSL フィールド）の置き場所

**このループの scanner には入れない。** `scan:ssot-candidates` は「未登録の正源の並行実装」
＝コード側の内部一貫性が対象で、card-data の語彙ギャップは別クラス。
既存の `optional_wording` / `continuity_wording` / `immunity_zone_scope` と同じく
**`cards-fidelity-audit.mjs` の warning kind** として実装する:

1. `scripts/<name>-detector.mjs` に pure 関数として分離（テスト容易性）
2. `scripts/<name>-exceptions.json`（キー=cardNo、値=**除外理由**。理由必須）
3. `cards-fidelity-audit.mjs` で `warnings.push`（`violations` ではない）
4. `scripts/test-<name>-detector.mjs` に単体テスト

**`violations` に入れてはいけない**理由: `cards:fidelity --gate`（停止条件 2）は赤になるのに、
ledger の `total`（= stub + uncovered + noTextRef + symbolMismatch）は変わらないため、
guard-audit の `precondition: fidelity-total-zero` と gate が食い違う。
確定した実バグは cluster として登録して消化する。

実装例: `soul-core-exclusion-detector.mjs`（2026-08-03、`《ソウルコア》以外` →
`effectKind:"normal_only"` 必須。6 件検出）。

## 既知の未着手

- textRef 索引整合は **既にガード済み**（`packages/rules-core/test/card-textref-integrity.test.ts`
  が `ALL_CARDS` を全走査し、範囲外 / 空行 / 本文行欠落を検出）。probe は不要
