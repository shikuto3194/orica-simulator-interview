# 聖蓮船のドロー原因と転醒

2026-10-15、Telegram `629905095` / `followup-a7623340c825993a0692`。

## 原文と修正

BSTH07-転醒R01(A)は「このネクサス以外の自分の系統：「起幻」を持つ効果でドローしたとき」に転醒できる。配置時効果の星蓮タグは、カードの起幻・幻想系統を消さない。
受付原本・添付snapshot・main `d4ff2f514`を照合。`after_draw`収集が原因カードを捨て、条件用contextも`relatedInstanceId`がnullなら構築しないため、実ドローで候補が消えていた。

`trigger-system.ts`の共通差分収集で`causedBySourceInstanceId`を`effectSourceInstanceId`へ渡す。対象は引き続きプレイヤー、`relatedInstanceId`はnull。条件用contextは独立した発生源carrierがある場合も構築し、既存の実効系統・効果系統タグ・controller・instanceId評価へ接続する。通常ドローなど発生源不明の場合は系統条件を満たさない。

タイミングは[02d](../10_rules/02d_trigger-timing-and-causality.md)と公式Q22566（信頼度A / 実装採用）。同時2枚は1回の誘発、元の2ドロー＋手札破棄に割り込まない。カード本文・DSLの変更は不要。

## 回帰と確認範囲

- `packages/rules-core/test/bsth07-r01a-draw-trigger.test.ts`: 実draw→collectAndQueue、別起幻効果の候補化と転醒、自己・相手・非起幻・発生源不明の除外、効果系統タグ、通常ドローステップ。card-9→card-10の通常配置を両ownerで完走し、2枚ドローで1候補、破棄中の転醒不可、B面の強制転醒時効果まで終端を確認する。
- `packages/rules-core/test/bsth07-cards.test.ts`: 旧手組みlisting回帰も`relatedInstanceId:null`＋専用carrierへ更新。
- `apps/playground-web/src/scenario-seirensen-draw-trigger.ts` / `e2e/scenario-seirensen-draw-trigger.spec.ts`: `?scenario=seirensen-draw-trigger`。Alice GUI→Bob REST応答、Bob REST→Alice GUI応答・画面同期。dev専用room harnessから実RESTエンジンを使う。

完了証跡は当該treeの`logs/harness/runs/`、verifier context/result、verified commit、親runnerのintegration ticketを別々に参照する。統合要求だけではmain反映・配備・依頼resolveを意味しない。
