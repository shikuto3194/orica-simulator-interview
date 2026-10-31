# Stack Window And Priority Loop

## 目的

スタック窓（stack timing）とフラッシュタイミングの優先権ループの設計を一箇所にまとめる。
ルール記述は `10_rules/02_turn-flow-and-timing.md` のスタック窓/フラッシュ節、
バトル中の即時効果・解決モデルは `07_battle-and-effect-model.md` を参照。

## 用語

| 用語 | 意味 |
|------|------|
| スタック窓 | 行動宣言に対して相手が割り込み (stack) できる応答期間 |
| 優先権 (priority) | その窓の中で「次に行動できる権利」を持つプレイヤー |
| パス (pass) | 優先権を持つプレイヤーが行動せずに権利を放棄すること |
| 連続パス数 | 続けてパスが起きた回数。2連続パスで窓が閉じる |
| サブスタック | スタック窓内の応答行動に対して更に開く入れ子窓 |

## 共通モデル: StackInteractionWindowState

すべてのスタック/フラッシュ窓は同一のコア構造を共有する。

```
StackInteractionWindowState
├── priorityPlayerId        現在の優先権保持者
├── consecutivePassCount    連続パス数 (stack 窓では常に 0; flash 本体のみ 0-1)
├── stackResponseSourcePlayerId   宣言者 (flash timing) / 相手 (stack timing) の判別
└── pendingStackAction      保留中のスタック効果 (LIFO チェーン)
```

### パスの状態遷移 (1-pass cascade モデル, 2026-03-31 ユーザー確認)

スタック窓は「片方がパスした時点で即クローズ」。保留スタックは LIFO 順に1件ずつ解決する。
宣言者には priority が戻らない（= 自分の action に対する「1つだけ」のスタック機会は
相手（非宣言者）のみ保有）。

```
[行動宣言 A] → 窓 open (opponent priority)
  ├── opponent passes → 窓即クローズ → A を解決
  └── opponent declares stack B → sub-window open (priority=declarer of A, A の相手 = bob の相手 = alice)
        ├── alice passes → B, A を LIFO 順で解決 → 全 pending 解消で窓クローズ
        └── alice declares stack C → sub-sub-window open (priority=bob)
              ├── bob passes → C, B, A を LIFO 順で解決 → 全 pending 解消で窓クローズ
              └── ...
```

カスケード解決: 任意の階層で `pass_*_stack` が呼ばれると、peelResolvedStack を
`pendingStackAction === null` になるまで繰り返し、得られた resolved stack 群を
`resolveDeferredStackAction` に LIFO 順で通す。外側 action の「1つだけ」枠は
（既に相手側が使い切っているため）追加の stack chance を与えない。

### サブスタックの LIFO チェーン

応答行動が起きると `createNestedStackState()` で入れ子スタックが生成される。

```
ActiveStack (外側) ← previousPendingStackAction ← ActiveStack (内側, pendingStackAction)
```

解決は `peelResolvedStack()` で LIFO 順に剥がす。パス時は `pendingStackAction === null`
まで繰り返し peel してから、各効果の派生処理を挟んで resolve する。

各スタック効果は独立した効果であり、応答元の誘発効果ではない。元の宣言はスタック機会を与えるだけで、`chainId` を応答へ継承しない。`previousPendingStackAction` は解決順を表し、`waitForResolutionChainIds` は直前の応答とその派生処理を待つ順序上の依存を表す。応答の本文・誘発・転醒や離脱選択・効果発揮後・バーストとその誘発まで終えてから、次の保留スタックへ進む（2026-09-26 ユーザー確認）。

## 1. 効果発揮宣言の汎用スタック窓 (StackWindow)

### 通常行動

召喚/配置/使用、誘発効果発揮、バースト発動、battle_immediate 効果発揮（アタック時/ブロック時/バトル終了時/途中参加等）の宣言があると、コスト支払い完了後にスタック窓が開く。**ステップ非依存** — start / draw / core / refresh / main / end のいずれでも開く（2026-05-02 ユーザー裁定: 「スタックタイミングが行えないステップは無い。ルール上の行動に発生しないだけ」）。

- 実装: `openStackWindow()` → `StackWindow`（旧 `MainStepStackWindow`）。誘発効果と battle_immediate 効果は窓種別選択ヘルパ `openEffectDeclarationStackWindow()` を共有する（flash 窓中はそのサブスタック、flash 窓前/外は新規 `StackWindow`）。
- Window: `"stack"`（旧 `"main_step_stack"`）
- 最初の優先権: 相手プレイヤー
- 相手がパス → 窓 **即クローズ** → pending スタックを LIFO 順で解決
- 相手が stack 効果を宣言 → サブ窓（priority=declarer = 元宣言者の相手 = 内側 action の相手）
  - 以降、任意の階層で pass が出ると LIFO カスケード解決
- 宣言者には priority は渡らない（自身の action に対する stack 機会は相手 1 人のみ）

> 歴史的経緯: P3-29 時点では main step 想定で `MainStepStackWindow` と命名。P3-34 で全ステップに一般化し `StackWindow` へリネーム。`subStackEverOpened` / `burstWindowKind` フィールドはバースト発動経路でのみ使用。

### 窓が開かない場合

裁定根拠: `source-findings-custom.md` §2 + 2026-05-02 ユーザー裁定

各ステップの **routine action** 自体は窓を開かない:

- コスト支払い
- 通常のライフ減少
- ドローステップのドロー / コアステップのコア配置 / リフレッシュステップのコア移動など、効果を伴わない基本ステップ処理
- 効果によらないコア移動
- 任意効果の不使用
- 解決中の即時効果が内包する召喚/配置/使用 (`qa-010`)
  - ただし常時効果が timing window に通常行動を許可するケースは別。その宣言に通常の stack が発生する。

ただし、これらの routine action は「そのステップでスタックタイミングが発生しない」ことを意味しない。**そのステップ内で発生する効果発揮宣言（誘発効果・プレイヤー能動の起動効果）にはスタック窓が開く**。例: BSTH01-M01 パチュリーの「『自分のスタートステップ』に1コスト支払って召喚できる」は **B 型（常時効果が通常召喚を許可する召喚許可）**で、誘発ではなくプレイヤーが能動的に召喚を選ぶ（`summon` legal action）。コスト支払い確定後に通常どおり stack window が開く（A 型「効果による召喚」のように発揮宣言にスタックするのではない）。`timing.kind: "activated"` + `timingScope` で許可タイミングを表現し、解決経路は通常召喚と同じ cost → stack → enter-field placement を使う。

### 常時効果の判定

- 明示タイミングを持たない (`〜したとき` 型だが見出しにタイミング名なし) でも、常時効果でなければ stack 対象
- `qa-009`: `「このバトルの間」「このターンの間」など` が書かれていないアタック中継続効果は常時効果
- `qa-016`: 離れるとき指定を持たない `離れない` 効果は常時効果

## 2. バースト発動の2段階窓

バースト発動は **発動宣言窓** と **効果発揮宣言窓** の2段階でスタック窓が開く。
各窓はスタック窓の 1-pass クローズルールに従う。

```
[バースト発動宣言] → 発動宣言窓 (burstWindowKind="activation")
  ├── サブスタックが使われた → (1-pass cascade で sub-stack 解決) → 活性化も解決 → 効果発揮宣言窓は開かない
  └── 相手が pass (サブスタック未使用) → 活性化窓クローズ → 効果発揮宣言窓 (burstWindowKind="effect_declaration")
       ├── サブスタックが使われた → cascade で解決 → 効果発揮
       └── 相手が pass → 効果発揮
```

- 実装: `openBurstActivationStackWindow()` → `openBurstEffectDeclarationStackWindow()`（本doc旧記載の別名は誤記。実装は現行名のまま）
- `subStackEverOpened` フラグで「どちらか片方のみスタック可能」を制御
- 設計根拠: 「バーストを破棄する」「バースト効果を無効にする」が専用対抗手段として存在するため、両方の窓が必要
- 2 段階遷移は `pass_main_step_stack` 内で `resolvedStacks.length === 1 && burstWindowKind === "activation" && !subStackEverOpened` を満たしたときのみ行う（サブスタックが使われていたら発揮宣言窓はスキップ）

### 条件拡張効果

「手札にあるときも発動できる」的な条件拡張効果は条件変更型の常時効果として扱う。
発動宣言自体はプレイヤーの行動として2段階窓を開く。

## 3. 宣言前スタック窓 (PreDeclarationStackWindow)

アタック/ブロック宣言 (途中合流アタック含む) に対する割り込み窓。1-pass クローズルールに従う。

- 実装: `PreDeclarationStackWindow` (`kind: "attack"|"block"|"forced_block"|"join_active_attack"`)
- Window: `"pre_declaration_stack"`
- 宣言はスタック解決まで未成立で保持される
- 相手 pass → 窓即クローズ + pending サブスタックを LIFO カスケード解決 → 宣言確定 (legality 再チェック)
- 相手が stack 効果宣言 → サブ窓 (priority=宣言者) → 以降 1-pass cascade
- 宣言確定後の legality 再チェック:
  - アタック/途中合流: 疲労済み/フィールド離脱なら不成立
  - ブロック: 同上
- 指定アタックは「アタック時」効果とバースト/待機誘発を先に片付け、still-valid なら強制ブロック宣言へ

## 4. バトルフラッシュの優先権ループ

### 窓の種類

| Window | タイミング |
|--------|-----------|
| `flash_before_block` | アタック宣言後、ブロック宣言前 |
| `flash_after_block` | ブロック宣言後、バトル解決前 |

ブロック宣言がなかった場合、`flash_after_block` は開かない。

### 優先権モデル

フラッシュ本体は 2-pass ループ（別ルール）。ただし内側の stack サブ窓は
スタック窓なので 1-pass cascade に従う。

```
[flash open] → nonActive priority, passCount=0
  ├── nonActive uses flash → stack sub-window (stack_before/after_block)
  │     ├── opponent (active) が pass → sub-stack を cascade 解決 → flash 本体に戻る (passCount=0)
  │     └── opponent が stack → さらに深いサブ窓 → cascade 解決 → flash 本体に戻る
  ├── nonActive passes → passCount=1, active priority
  │     ├── active uses flash → stack sub-window (1-pass cascade) → flash 本体に戻る
  │     └── active passes → 2連続パス → flash close
  └── ...
```

- 実装: `BattleFlashWindowState` (`kind: BattleFlashWindowKind`)
- `useOpenBattleFlashAsAction()` で窓を開く。最初の優先権は非アクティブプレイヤー (ブロック側)
- `usePassBattleFlashAsAction()` でパス処理:
  - `pendingStackAction !== null` (stack サブ窓内) → 1-pass cascade でサブスタック群を全解決 → flash 本体に復帰
  - `pendingStackAction === null` (flash 本体) → 2-pass loop を維持（passCount 0→1 で transfer、1→2 で close）
    - **transfer 時 (`transferResponseWindowPriority`) は `stackResponseSourcePlayerId` も新優先権者へ追従させる。** flash 本体では優先権を得たプレイヤーが次の flash 宣言者になるため（両プレイヤーが交互にフラッシュ効果を使用する優先権ループ）。サブスタック全解決後の復帰時も同様に新優先権者へ揃える。
- フラッシュ中にアクション使用 → `openStackSubWindow()` でスタックサブ窓を開く
- **サブスタック全解決後の復帰時、優先権は「最外スタックが能動フラッシュ使用か誘発か」で分岐する** (`usePassBattleFlashAsAction` の cascade-close)。
  - 最外スタックが能動使用 (magic / hand_card_effect 等) → `getFlashWindowPriorityOpponentId(使用者)` で**相手へ移譲**（交互）。
  - 最外スタックが `triggered_effect` (誘発。例 BSTH01-X05 咲夜の発揮前無効化) → 移譲せず peel で復元された優先権 (= 誘発のコントローラ = 直前の能動使用者の相手) を維持。誘発は能動フラッシュ使用ではないので交互を進めない (`10_rules/02` フラッシュ優先権ループ節)。これにより「自分フラッシュ使用 → 相手誘発で無効 → 相手のフラッシュタイミング」が成立する。回帰: `flash-priority-after-induced-negate.test.ts`。

### flash timing と stack timing の判別

`getResponseWindowActionTimings()` で判別:

- `pendingStackAction !== null` → `"stack"` timing のみ (保留効果への応答)
- `stackResponseSourcePlayerId === actingPlayerId` → `"flash"` timing (自分が宣言者)
- それ以外 → `"stack"` timing (相手が宣言者、割り込み応答)

> **`"stack"` timing で使えるのは `mode:"stack"` のスタック効果のみ**（公式Q&A Q5: フラッシュ効果 ≠ スタック効果。ルール正源 `10_rules/02` 同節）。`mode:"flash"` から `timing:"stack"` の reg を**暗黙に**派生してはならない。相手のフラッシュへの「割り込み」を行えるのは『スタック』キーワードカードだけで、フラッシュ効果同士は本体ループで交互に使う（割り込みではない）。印字の明示併記は対象外で `mode:"flash"`/`"stack"` を別 effect で両方宣言する（precedent: `BSTH11-C05`）。神技 `DivineSkillTiming` は `"flash_or_stack"` variant でスタック対応する（`BSTH11-X01` resolved）。

> flash 本体 (`pendingStackAction === null`) では `stackResponseSourcePlayerId` が常に現優先権者へ追従するため、優先権を得たプレイヤー（非アクティブ・アクティブ問わず）は `"flash"` timing を得て自分のフラッシュ効果を能動起動できる。これが §4 冒頭の「active uses flash」を成立させている。`stackResponseSourcePlayerId` を追従させ忘れると、アクティブプレイヤーが自分の『お互いのアタックステップ』flash 効果を起動できなくなる（過去のバグ）。

## 5. 効果無効化

スタック窓内で保留中の効果を無効化するケース (例: バタフライジャマー)。

- 実装: 該当 `ActiveStack.isNullified = true` を立て、解決時に効果をスキップ
  - 実配線は `markPendingStackActionNullifiedByCardInstance()`（P3-73 咲夜。declare 時に 3 種応答窓 + LIFO ネスト鎖を走査）
  - 汎用ヘルパー `nullifyPendingStackAction()` は定義のみ・現状 src 呼び出しなし（将来の汎用 negate 実効化で配線予定）
- 無効化されたスタックは解決時に効果をスキップ
- magic の場合はコスト支払い済みのためトラッシュ移動のみ実行

### 発揮前無効化誘発の解決順序 (案X, 2026-06-08)

「使用したとき・発揮前に無効」誘発（咲夜 BSTH01-X05）は **スタック効果ではなく誘発**。スタックタイミングで gate されない。順序は **stack-first**:

1. 相手フラッシュ使用 → 自分のスタック窓（能動応答）を先に処理。
2. 自分がパス → 窓クローズ。対象フラッシュの **発揮直前に「発揮前チェックポイント」** を設け、対象を狙う発揮前無効誘発を declare/skip 解決する。
3. declare で対象 `ActiveStack` に `isNullified` 印 → 続く解決で効果スキップ。

実装位置: `resolveStackCascade`（各スタック解決の直前、`resolveDeferredMagicStack` の `isNullified` 判定より前）。P3-73 の「declare 前出し＋declare 時印」は本順序へ正規化する旧ワークアラウンド。複数コピーは 1 枚目の無効化後、残りをことで双方向で不発（刈り取り）。ルール正源は `10_rules/02_turn-flow-and-timing.md` の同節。

## 6. 新規キーワード能力実装時の選択ガイド (P3-113)

エントリポイントと実装ファイル一覧は[実装入口](08a_stack-window-implementation.md)を参照。

## 裁定根拠

- `source-findings-custom.md` §2 (qa-005〜qa-016)
- 2026-03-31 ユーザー確認: 片方パスで即閉じる 1-pass cascade（2026-04-12 実装完了。flash 本体のみ 2-pass 維持、別ルール）。
- 2026-05-02 ユーザー確認: 「スタックタイミングが行えないステップは無い」（2026-05-02 実装完了、P3-34 A: `StackWindow` へ一般化）。
