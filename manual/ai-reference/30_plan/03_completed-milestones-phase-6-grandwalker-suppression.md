# 浄玻璃の鏡によるカーディナルの効果抑止（2026-09-19）

提供された `orica-snapshot-2026-09-19T14-43-03-244Z.json` では、鏡(card-77)の相手側抑止CEにカーディナル(card-4)が記録されていた。神技と神託の専用経路が共通の抑止判定を通らず、発揮できた。

- [ルールと出典](../10_rules/08d1_grandwalker-effect-suppression.md): 公式エターナルQ23201/Q23202と独自カード本文。神技・通常神託・配置時神託を抑止し、創界神共通ルールと無条件シンボル効果は保持する。
- 神技の候補生成・宣言・解決で同じ記述子と `executeReevaluationCheck` を使用。解決前の抑止では効果文内コアも支払わない。
- 神託は発火見込み・キュー生成・宣言・解決で抑止を確認。キュー済みの抑止効果はスキップのみで排出し、操作待ちを残さない。
- 回帰: `packages/rules-core/test/grandwalker-effect-suppression.test.ts`。同型の既存神技・神託テストも検証する。
- GUI/REST: `?scenario=grandwalker-suppression` と `e2e/grandwalker-effect-suppression.spec.ts`。Alice GUIの神技操作・Bob RESTのパス、抑止中の拒否と解除後の盤面変化を確認する。
- 提供snapshotは既に神技使用済みでコア1個だったため、発揮可否の再現ではカーディナルを4コア・未使用に戻した。その他の盤面を保持し、鏡あり0候補・鏡除去後1候補を確認した。
- 現役ToDo・issueの追加はなし。
