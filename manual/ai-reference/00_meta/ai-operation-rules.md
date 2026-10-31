# AI 運用ルール (作話再発防止)

このドキュメントは Claude / Codex 等の AI アシスタントがこのプロジェクトで仕事をするときの **推論プロトコル** を規定する。実装ルールではない。

機械的な強制は `.claude/hooks/user-prompt-rule-doc-guard.js` (UserPromptSubmit hook) が担う。
ルール論キーワード (flash / stack / triggered / タイミング / 裁定 / 未解決 / ルール / step / ゾーン 等) を含む prompt 受信時、本 4 原則が system-reminder として自動注入される。
さらに**反証シグナル** (`？？` 連打 / `が？` / `間違` / `浅い` / `逆` / `矛盾` / `そのまえに` 等) を検出すると、cross-turn の連続反証回数を数え、「逐語引用規律 + 既定棄却 (お前の前回主張は逐語で再証明されるまで誤り)」を escalate 注入する。

## 4 原則

### 1. ルール正源優先 (Rule source first)

タイミング (flash / stack / triggered) / ゾーン / ターン進行 / コア移動など、**BS ルール側で答えが決まる問い** はコード trace よりも先にルール正源を読む。

参照順:

1. `manual/ai-reference/10_rules/` の該当節 (特に `02_turn-flow-and-timing.md`)
2. **公式 Q&A ミラー** (source precedence 最上位 = 信頼度 A)。`external-qa/qaData.js`(独自カード) と `external-qa-official/`(公式 28k 件)。**gitignore かつ untracked なので worktree には物理コピーされず Glob/通常検索ではゼロ件**。必ず repo root の絶対パスで引く: `rg --no-ignore <語> C:\dev\orica-simulator\external-qa C:\dev\orica-simulator\external-qa-official`。
3. `manual/ai-reference/00_meta/source-findings-*.md` (一次資料引用)
4. repo内の裁定記録。memoryはアクセス可能なときの補助で、必須根拠をmemoryだけに置かない
5. その後にコード trace

回答する際は引用元のパスと行番号 (Q&A は qa-id / Q番号) を明記する。

**「Q&A 無し」と判断する前の必須手順**: ミラーは製品別 Q&A 主体で「汎用ルール Q&A」カテゴリ (例「BP-/BP+ の効果について」) は未収録のことがある。grep で出なければ `node scripts/harvest-official-faq.mjs --freeword "<語>"`（freeword 1 回で全件取得 → `external-qa-official/_freeword-<語>.md`）を回してから再 grep する。これを尽くす前に「Q&A 無し・信頼度 C・ユーザー確認待ち」へ落とさない。実例: 2026-06-16 BP0「BP0になった」裁定で本手順を怠り誤った仮ルールを記録、後で `--freeword "BP-"` が 147 件即取得し Q192 で確定できた (詳細は [`10_rules/03c §「BP0になった」`](../10_rules/03c_effect-text-interpretation.md))。

### 2. 既存コメント / 「未解決」記述は仮説扱い

ルール実装・修正では、コードを選ぶ前に本文を「対象・選択者・発揮時点・有効期間・失効・再有効・例外」へ分解する。各論点について公式一般則、同型の複数事例、似ているが処理が異なる事例を能動的に検索する。自分の初期解釈が誤りなら見つかるはずの反例（通常枠、上限喪失、待機、名前/系統変更など）を具体的な盤面にし、逆の結論を支持する検索語でも照合する。件数を満たしたことを調査完了の条件にしない。

実装後は、その盤面の期待値自体を一次資料から独立査読する。検索の実行・反例の解消が必要で、テンプレート欄やリンクの記入だけでは代替できない。直接の裁定と一般則からの推論を区別し、調査後にも残る不確実性だけを未解決とする。例: [2026-10-20 合体枠再調査](source-findings-brave-capacity-2026-10-20.md)。

コード中のコメント、issue の「未解決」セクション、過去セッションの assistant 発言は **仮説 (hypothesis)** であって正源ではない。ルール正源と突き合わせるまで、根拠として引用してはいけない。

特に「未解決」「需要発生時に〜」「保守的に〜」などの言葉は、**書いた時点での認識が誤っている可能性** を含む。再評価候補として扱う。

### 3. 反証時は前提を棄却 (No ad hoc rescue)

ユーザーが反証を提示したら、**仮説の境界を縮小して逃げる** のではなく、**前提自体を棄却候補にする**。

NG パターン:

- 「opponent flash gap がある」と主張 → ユーザー「flash 窓では撃てる」→ 「じゃあ baseline には gap がある」と境界縮小 → ユーザー「baseline にフラッシュタイミングないが？」 → 「じゃあ baseline 経路自体が違反だ」と更に境界縮小

この pattern は ad hoc rescue (場当たり的救済) と呼ばれ、最初の前提 (= "gap が存在する") を維持したまま反例に当たらないよう仮説を縮め続ける思考の罠。

正しい対応:

- 反証されたら、まず **元の前提が完全に間違っていなかったか** を最優先で確認する
- 「実は問題そのものが存在しなかった」が最も多い結論

### 4. 逐語引用規律 (Verbatim-citation discipline)

ルールを **浅く引用しない**。doc を読んでいても、逐語の意味を取り違える / 前提が成立しない規則を当てはめる / 言い換えを正源として権威化する、で容易に作話する (2026-06-21 X05 騒動)。

必須手順:

- 引用は **逐語 + `file:line`**。まず「その行が字義どおり何を言っているか」だけを述べる。
- 字義を超える一歩はすべて **推論** と明示する。言い換えを「ルールではこうなっている」と断定しない。
- 規則を当てはめる前に **前提 (precondition) の成立を確認**する。例: コストの無い効果に `02:202`「コスト支払い完了後に窓が開く」を引いてはいけない。「解決中の内包召喚に窓が開かない」(`02:203`) は「召喚=解決中=窓の後」の根拠であって「窓の前」ではない。
- ルールから確定できないなら **「確定できない」と言う**。正当化を捏造しない。
- 反証されて **同じ結論を別の規則で守った**ら、それは rescue。結論を棄却する (原則 3)。

## 失敗事例

### 2026-05-15 P3-60 騒動

セッション中、`legal-actions-availability.ts` のコメント「opponent flash は stack window 経由のみ。需要発生時に branch を追加」を正源として受け取り、コード trace から「opponent baseline flash gap」を補強する作話を 3 ラウンド連続で生産した。

- ラウンド 1: 「opponent baseline branch 追加が必要」と主張
- ラウンド 2: ユーザー反証「Flandre は opponent にもいる」→ 「実装上どのタイミングでも撃てない」と境界拡張
- ラウンド 3: ユーザー反証「flash_before_block では撃てる」→ 「アタック宣言前の baseline で gap」と境界縮小
- ラウンド 4: ユーザー反証「アタック宣言前にフラッシュタイミングなんてないが？」→ ようやくルール正源を確認し、baseline 経路自体がルール違反と認識

ラウンド 1 の時点で `10_rules/02_turn-flow-and-timing.md:128-130` を読んでいれば「フラッシュタイミングは flash_before_block / flash_after_block の 2 つのみ」と即座に確認でき、3 ラウンドの作話を回避できた。

詳細: [issues/archive/P3-60/index.md](../../../issues/archive/P3-60/index.md)

### 2026-06-21 BSTH01-X05 咲夜「維持コア順序」騒動

「咲夜の誘発召喚で、維持コア選択がなぜ相手のスタック窓より先に要求されるのか」という問いに対し、**doc は読んでいた**のに浅い/誤った逐語引用で 3 ラウンド rescue した。

- ラウンド 1-2: `02:202`「コスト支払い完了後に窓が開く」を持ち出す → ユーザー「『コストを支払わず』でコストは無いが？」(前提不成立)
- ラウンド 2: 「ことで構文だから召喚は commit=窓の前」→ ことで構文 (`03c`) は実行可否の論理でタイミング規則ではない (規則の誤用)
- ラウンド 3: `02:203`「解決中の内包召喚に窓が開かない」を「維持コアが先」の根拠に →
  実際は逆。「召喚=解決中=窓クローズ後」を意味し、維持コアは**窓の後**である根拠だった (逐語の取り違え)

正しい順序は `02:200`(常時以外の効果発揮に対し窓が開く)+`02:203`(解決中の内包召喚は窓なし)+`02:205`(解決後 legality 再チェック・不正なら不発) から「発揮宣言 → スタック窓 → 窓クローズ後に解決(召喚・維持コア・無効化)」。各規則を逐語で読み、前提成立を確認していれば 1 ラウンドで到達できた。原則 4 (逐語引用規律) はこの再発防止。

詳細: 当該会話 + [`10_rules/02_turn-flow-and-timing.md`](../10_rules/02_turn-flow-and-timing.md) §スタック窓 / §発揮前に無効化する誘発

### 2026-07-30 BSGE01-TR01(A) 「rebirth 流用」誤実装

「合体しているこのブレイヴは、フラッシュタイミングで裏返せる」というカード文言に対し、既存の `{kind:"rebirth"}` action kind を、実装（`executeRebirth`）を読まずに「裏返す＝転醒キーワードと同じ処理でよいはず」という表層的な語感だけで流用した。

- `executeRebirth`（`packages/rules-core/src/effect/structured-card-replacement.ts`）は「カード裏返し＋カウント+1」を、`RebirthAction` のどのフィールドにも紐づかない**無条件のハードコード処理**として持つ。
- 「この面に裏返ったとき…カウント+1する」という定型文は、カード固有の effect テキストではなく、**転醒というルール処理そのもの**として実装されている（＝カードごとの effects に個別記述するのではなく、primitive の内部に畳み込まれている）。
- BSGE01-TR01(A)/(B) の B面 textLines にはこの定型文が存在しないため、`rebirth` を素朴に使うと本来発生しないはずの自動+1が誤って乗る。誤りは `rebirth` の action kind 名とカード文言「裏返せる」が字面で一致したことに引きずられ、ハンドラの実装（ハードコードされた副作用の範囲）を確認しなかったことに起因する。
- 詳細: [`10_rules/08a_advent-rebirth-contract.md`](../10_rules/08a_advent-rebirth-contract.md) §主要裁定、[issues/archive/P3-132](../../../issues/archive/P3-132/index.md)

**教訓（既存 action kind 流用時の一般原則）**: action kind 名やカード文言の字面一致だけで既存 primitive を流用しない。流用前に対応する execute\*/native-action-registry ハンドラの実装を実際に読み、そこにカード非依存でハードコードされた副作用（無条件のカウント増減・自動移動・自動フィールド残留等）が無いか確認する。あれば、今回のカードがその副作用を本当に伴う（＝原文にその副作用の根拠となる記述がある）か個別に照合してから使う。

## 裁定の伝播先（Ruling propagation）

ユーザーから受け取った裁定を memory に保存しただけでは、autorun ループの worker は読めない（worker は worktree 内のコードベース + `manual/` のみ参照）。**裁定は必ず worker 可視範囲にも反映する**。

判定:

- **特定カード裁定**（cardNo に紐付く）→ `needs-ruling.jsonl` (リポジトリ root) を更新。該当行に `ruling` フィールド + `status: "resolved"` を書き込む。詳細は `full-run-supervisor.md`「裁定（needs-ruling）の扱い」参照。
- **一般原則裁定**（複数カードに共通）→ `manual/ai-reference/10_rules/` 内の該当章へ追記。配置先の例:
  - 転醒・煌臨・契約 → `08a_advent-rebirth-contract.md`
  - 待機状態・場唯一性・状態ベース → `04_state-based-rules.md`
  - バースト → `04b_burst-rules.md`
  - 裏向き素性 → `04c_face-down-identity.md`
  - スタック・カスタム独自ギミック → `07_custom-orica-mechanics.md` / `07b_card-observed-mechanics.md` / `07c_card-observed-mechanics-extra.md`
  - タイミング全般 → `02_turn-flow-and-timing.md`
- memory保存は実行環境の規則とユーザーの許可に従う。保存可能な場合もrepo内の裁定章へのポインタを併記し、worker必須の根拠はrepo側に残す。

ガード:

- 裁定を memory に保存するときは「10_rules への反映が済んだか」必ずセルフチェックする。済んでいなければ同ターンで反映する。
- 反映後に `pnpm docs:lint` を回し、サイズ上限や entry warn が出ないことを確認する。

実装ギャップ調査と loop へのタスク化:

裁定を受け取ったら **doc 反映だけで終わらせず、必ず該当する既存実装を調査**する。実装と裁定の間にギャップがあれば、その差分を autorun loop の worker が拾える形にする。

1. **調査**: 裁定が触れている既存プリミティブ / フィルタ / トリガー / cause attribution / DSL ノード等を、関連ファイル名・行番号付きでコードレベルに突き合わせる（Explore subagent が便利）。
2. **判定**:
   - ギャップなし（既に裁定通り） → doc 反映のみで完了。
   - 軽微なギャップ（1 ファイル / 1 関数程度） → 同セッションで実装まで進める。
   - 中規模以上でもまず依頼scope内で完遂を試みる。セッション内で完遂不能かつ独立単位に分ける方が適切な場合だけ、後述のloop可視タスクに切り出す（CLAUDEの課題管理に従う）。
3. **loop 可視タスク化**:
   - **カード単位の実装ギャップ** → `needs-ruling.jsonl` の該当 cardNo 行に `ruling` を書き込めば、worker は次 run でその裁定 + 実装を拾う。
   - **エンジン横断のギャップ**（プリミティブ追加・型拡張・cause attribution・トリガー判定の修正など、cardNo に紐付かない一般実装） → `manual/ai-reference/30_plan/02_detailed-todo.md` の Active Board または `issues/` に新規エントリを足す。本文に「裁定: `10_rules/<path> §<section>`」と裁定本文の場所を明示し、worker が `10_rules` 正源から要件を再構成できるようにする。
4. **同セッション完了時** も、`10_rules` への反映 + テスト（必要なら追加）+ 完了報告に裁定 ID を引用する。

判断基準:
- 「裁定 doc は反映済 / 実装は未確認」のまま閉じてはいけない。実装調査までは最低限完遂する。
- 実装まで進めない場合は、後続セッションが同じ調査を繰り返さなくて済むよう、見つけた箇所（ファイル + 行番号）と必要な変更ポイントをタスクに記載する。

## 関連

- `.claude/hooks/user-prompt-rule-doc-guard.js` — 機械的な reminder 注入
- memory `feedback_rule_source_first.md` / `feedback_existing_artifact_skeptic.md` / `feedback_no_ad_hoc_rescue.md` / `feedback_ruling_propagation.md`
- CLAUDE.md Cross-cutting Rule からの入口
