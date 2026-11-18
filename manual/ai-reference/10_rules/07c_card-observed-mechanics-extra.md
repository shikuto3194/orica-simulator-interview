# Custom Orica Mechanics — カード本文から観測できた独自/確定ギミック (続き)

[07b_card-observed-mechanics.md](07b_card-observed-mechanics.md) のサイズ上限超過に伴う分割。
カスタムソース優先順・実装ポリシー・ユーザー確認方針は [07_custom-orica-mechanics.md](07_custom-orica-mechanics.md) を参照。

## BSTH01-M03/BSTH02-C03 二択 deck_reveal のコスト支払いタイミング（裁定 2026-07-12）

BSTH01-M03（森近 霖之助）召喚時:

> 自分のデッキを上から5枚オープンできる。その中の導界者ネクサスカードすべてか、1コスト支払うことで、系統：「幻想」を持つスピリットカード2枚までを手札に加える。

BSTH02-C03（同型、4枚オープン+二択）も同一パターン。

ユーザー裁定（2026-07-12）: **(a) reveal-then-choose**。

1. **解決順序**: 先に**デッキ上から5枚（BSTH02-C03は4枚）をオープン**し、その中身が見える状態で、プレイヤーが「導界者ネクサスカードすべて」か「1コスト支払って系統『幻想』スピリット2枚まで」かを選ぶ。
2. **情報非対称**: reveal 後に選ぶため無し（何が見えているか分かった上でモードを選べる）。
3. **paid 側のコスト支払い**: モードを choose した時点で 1 コスト支払い。オープン内容次第で系統「幻想」スピリットが 0 枚しか無くても、paid モードを選んだ以上コストは支払う（0 枚でも空撃ちにはならないが得られる手札は 0 枚になりうる）。

BSTH05-C11/C12（choice-prepaid-cost 先例）は自分フィールド上のコストで情報非対称が生じないため直接の precedent にはならない。本裁定により、`deck_reveal` → `choice`（コスト前置）の解決順は **reveal が choice より先** の picks-branch パターンとして扱う。

実装含意: 既存 `choice`（コスト前置）流用ではなく、`deck_reveal` を先に解決してから choice を評価する経路（reveal 結果を choice の分岐条件/選択肢生成に使える picks-branch）が必要。BSTH01-M03 / BSTH02-C03 の実装時にこの順序で配線する。

2026-09-20実装: `beforePickSteps` 内の `choice` と汎用 `move_card` で公開後に選択する。
無料側の指定枚数は強制。霖之助の有料側は0〜2枚を選べ、0枚でも支払う。
全監査の記録は [公開・回収監査](../30_plan/03_completed-milestones-phase-6-reveal-retrieval-audit.md) を参照。
