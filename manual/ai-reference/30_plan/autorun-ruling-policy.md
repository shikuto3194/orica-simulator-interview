# Autorun 確定可能性と裁定パーク

[autorun-runbook.md](autorun-runbook.md) の詳細。運用判断の入口は元runbook。

## 確定可能性の判定（park の前に必ず行う）

**「stub だから裁定待ち」ではない。未実装の大半はルール正源で挙動が確定する実装作業。**
park する前に必ず `10_rules/` を読み、挙動がルールから確定するかを判定する。確定するなら
**DSL/エンジンを拡張して実装する**（実装が重いことは park の理由にならない）。

**ルールで決まらない裁定系は、ユーザーに park する前に必ず公式 Q&A ミラーを引く**（Q&A は
source precedence 最上位＝信頼度 A）。`rg --no-ignore <語> C:\dev\orica-simulator\external-qa C:\dev\orica-simulator\external-qa-official`
（gitignore・worktree 不在なので repo root 絶対パス＋`--no-ignore` 必須）。grep で出なければ
ミラーが汎用ルール Q&A 未収録なだけのことがある → `node scripts/harvest-official-faq.mjs --freeword "<語>"`
（freeword 1 回で全件取得）を回して再 grep。Q&A で閉じるなら park せず qa-id 引用で実装する。
**これを尽くす前に「Q&A 無し・信頼度 C」へ落とさない**（2026-06-16 BP0「BP0になった」で本手順を
怠り誤判定→ `--freeword "BP-"` が 147 件即取得し Q192 で確定できた前例。`00_meta/ai-operation-rules.md` 原則#1）。

機構別ルール正源（挙動・主要裁定・実装状況が記載済み）:

- 煌臨 / 転醒 / 契約 → `10_rules/08a_advent-rebirth-contract.md`
- アクセル / チェンジ / ゼロカウンター → `10_rules/08b_accel-change-zero-counter.md`
- 異魔神 / ミラージュ → `10_rules/08c_imagin-mirage-grandwalker.md`
- 創界神ネクサス / 創界石 → `10_rules/08d_grandwalker-nexus.md`
- タイミング(フラッシュ/スタック/誘発) → `10_rules/02_turn-flow-and-timing.md` / `03b_resolution-and-interrupts.md`
- 効果テキスト文言の解釈（強制/任意=「できる」+可能形語尾全般、ことで構文 等） → `10_rules/03c_effect-text-interpretation.md`。常時/継続 vs 誘発/即時判定、ターンに1回/重複不可 等 → `10_rules/03e_effect-duration-and-repeat-scope.md`
- コスト / コア / 状態起因処理 → `03a_cost-payment.md` / `06_core-system.md` / `04_state-based-rules.md`
- 独自拡張ギミック → `07_custom-orica-mechanics.md`

これらの機構は P2-07 で基盤実装済み（`02` 参照）。per-card の `effects` 変換は基盤に配線する
実装作業であり、原則 park しない。タイミング/ゾーン/ターン進行の判断はコード trace より先に
上記ルール doc を読み、該当行を実装の根拠として引用する（`00_meta/ai-operation-rules.md`）。

## stub 前の基盤確認（verify-before-stub・必須）

**`stub:` を書く前に、その機構が本当に未実装かを次の3点で必ず確認する。** 確認せずに
「基盤なし/未対応」と断定してはいけない（過剰stubの再発防止、issues/P3-89）。

1. `20_design/11_structured-effect-model.md` の機構表（「ギミック実装状況」）＋「2026-06-10
   engine-drain 追補」＋拡張リスト（Condition/CardFilter/DynamicCount の箇条書き）。
   実装済みなら**配線して実装する**（行番号でなく節名で参照する — 行はズレる）。
2. 該当 `10_rules/08a-08c`（煌臨/転醒/契約/アクセル/チェンジ/ゼロカウンター/異魔神/
   ミラージュ/創界神）の実装設計節。
3. 既に同機構を使っている弾の precedent（`packages/card-data/src/cards/` を grep）。

確認の結果**実装済み**なら、対応する正源で表現する（stub にしない）:

- 煌臨/契約煌臨は `CardDefinition.adventData`（effects の stub ではない）。条件・タイミングは
  `AdventData`（`adventCondition` / `adventTiming` / `soulCoreDest`）で宣言する。
- 転醒は `RebirthAction` + `RebirthData`、契約魂状態は `ContractData`、
  BP/コスト閾値は CardFilter `minBp/maxBp/minCost/maxCost`、カウント/ライフ条件は
  `count_value` / `life_value`、魂状態/煌臨元含む在場判定は `field_has`（cardNames で名前一致）。

**真に未実装と確認できたものだけ** stub にし、stub 文に「何が無いか」と doc 行を引用する
（例:「`AdventCondition` に cardNames が無い」「動的 maxBp=自身BP の注入機構が無い」）。
A方式では型拡張が要るものは `autorun-queue/needs-dsl.<worker>.jsonl` に append して main に委ねる。

> ⚠ **coverage% は忠実度ではない。** `pnpm cards:coverage` は stub 付き effects も done 計上する。
> 「todo===0」と「原文忠実に実装済み」は別物。done 弾でも `effects` vs `textLines` の 1:1 監査で
> 過剰stub・近似が残りうる（issues/P3-89）。

## ルールであって効果ではない（effects 化禁止）

カードに印字されていても**ルール由来の処理は effects に書かない**。効果化すると (1) ルール適用と
二重実行になり、(2) 効果無効の影響を受けてしまう（ルールは受けない）。配線前に該当 `10_rules/` で
「効果ではない」明記の有無を確認する。確認済み一覧（同類を確認したらここに追記）:

- 転醒 flip 時の「この面に裏返ったとき、フィールドに残り、カウント+1する」（08a §2 手順3）
  → `executeRebirth` が適用済み。effects 化は `rebirth-boilerplate-guard.test.ts` が機械検知する。

## 裁定パーク基準（needs-ruling 行き — 真に確定不能なものだけ）

上の確定可能性判定で**ルール正源からも確定できなかった**場合に限り park する。該当は次のいずれか:

- 独自カードサイトだけがソースで、`10_rules/` にも一般則がなく、効果の挙動・タイミング・対象が
  定義として閉じない（独自カードサイト固有の未定義ギミック）。
- 公式裁定 / Q&A / errata と独自拡張で挙動が衝突し、precedence で一意に決まらない
  （source precedence: `Q&A / 裁定 > カード本文 > errata > ユーザー確認`）。

DSL 拡張方針に複数案がある、実装が大きい、テストが面倒、はいずれも park 理由にならない。
迷ったら「ルール doc の該当行を引用して実装の根拠を書けるか」で判定する。書けるなら実装、書けないなら park。

### needs-ruling.jsonl の 1 行スキーマ

```json
{"cardNo":"BSDB01-X01","name":"<カード名>","set":"BSDB01","reason":"<なぜ閉じないか>","question":"<ユーザーへの具体的質問>","options":["案A:…","案B:…"],"status":"open","added":"YYYY-MM-DD"}
```

- 追記は Bash 経由（`>> needs-ruling.jsonl`）。1 カード 1 行、`status:"open"`。
- ユーザーが裁定したら、その回答で同カードを実装し、行の `status` を `"resolved"` に書き換える。
- `question` は training data でなく `packages/card-data/src/cards/` の `name`/`textLines` を引用して書く。
