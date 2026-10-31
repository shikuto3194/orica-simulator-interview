# 「防げない」と効果自体の無効化

親文書: [効果防止の優先順位](04b2_effect-prevention-priority.md)。2026-10-02確認。

## 公式裁定

公式エターナルFAQ「防げない効果について」Q1479/Q1481/Q1485（信頼度A、実装採用）。[公式検索](https://www.battlespirits.com/faq/list.php?freeword=1481&format=eternal)、取得原文は `external-qa-official/_freeword-防げない.md`（`node scripts/harvest-official-faq.mjs --freeword "防げない"`、98件）。

> Q1481: 「防げない」効果を、「効果発揮前に無効にする」効果で無効にできるの？
>
> A: はい、無効にできます。

- Q1479: 「防げない」は効果の解決時に他の効果で防がれないだけであり、効果自体が発揮できない場合は発揮できない。
- Q1485: 「このターンの間」持続する「防げない」マジックの効果も、発揮中の効果自体を対象とする無効化で無効にできる。
- 本件への適用: BSTH04-C11「審判『ラストジャッジメント』」の使用者がカウント2以上でも、BSTH01-X05「十六夜 咲夜」の「その効果発揮前に…無効にする」を妨げない。「ことで」構文の双方向チェックを理由に、無効化可能な対象を不可としない。

## 実装

以下は `packages/rules-core/src/` 起点。

- `stack/stack-negate.ts` の `getStackNegatePreventionLevel()` は明示的な `negatePreventionLevel` だけを参照する。通常の `preventionLevel` へフォールバックしない。
- 対象候補を判定する `stackMatchesNegateAction()` と、実際に無効化する `stack/stack-window-shared.ts` の `nullifyActiveStackChainByCardInstance()` は同じ判定を使う。
- 旧実装では通常の「防げない」を無効化耐性と誤認し、2026-10-02 13:19:00Z保存の盤面で咲夜の条件成立後もskipだけになっていた。明示的な「無効にされない」耐性は従来どおり残す。

## 回帰検証

`p3-110-x05-summon-core-after-window.test.ts` は実カードX05対C11でカウント1/2の双方に発揮宣言を提示し、応答窓後の召喚・維持コア配置・C11無効化と攻撃禁止が残らないことを確認する。明示的無効化耐性は既存の共通無効化回帰で確認する。

GUI+RESTは `sakuya-unpreventable` シナリオと `e2e/scenario-sakuya-unpreventable.spec.ts`。
