# 魂状態と分離済みブレイヴのバトル参加

[シナリオ索引](10_scenario-test-reference.md) の補足。
バトルの存続・無ダメージは [02c](../10_rules/02c_battle-lifetime-and-resolution.md)、
分離後の強制継続は [05](../10_rules/05_brave-and-attack-special-cases.md#合体先離脱後のアタックブロック継続) を参照する。

| シナリオ | 初期状態と操作 | パラメータ |
| --- | --- | --- |
| `soul-state-brave-battle` | BSGE01-CX01 + TX01(A)の攻撃中に実R13アクセルで破壊済み。残留選択→魂状態選択→フラッシュを終える。ライフ不変・同attackIdの公開ログにlife_deltaなし・battle-end完了を確認する | `owner=bob` でREST側へ反転 |
| `brave-attack-continuation` | 合体先離脱待ち。ブレイヴを残す選択と必要コア配置後、参加可能なら選択なしで攻撃／ブロックを継続。分離した攻撃側は防御側ライフを減らし、ブロック側はBP比較を行う | `role=block` はブロック側、`restricted=1` はスピリット状態の攻防不可、`owner=bob` はREST反転 |

例: `/?scenario=soul-state-brave-battle&manualOpponent=1`。
シナリオは現行の合法手順に従い、ブレイヴ残留／同行を魂状態より先に選ぶ。
添付のattached状態の再投入・共通置換resolverの境界反証は別のunitで扱い、
このGUIシナリオを過去の全行動リプレイとは扱わない。

`e2e/scenario-soul-state-brave-battle.spec.ts` はAlice GUI／Bob RESTの3経路ずつを検査する。
ローカルroom橋渡しでは実GUI、reducer、viewer projectionを使う。
分離専用endpointをローカルactionへ接続し、候補なしのブロック辞退はRESTで自動末尾を進める。
本番の認証・公開サービスへの配備を検証するものではない。
