# コア配分HUDの制約と経路表示

[コアHUD統一仕様](11_core-selection-hud.md) の配分操作に関する補足。

系統などの共有枠を持つ配置は、カード種類を横断する1回の配分HUDで行う。
黄色枠はエンジンの `canAddCoreDistributionCore()` で仮配置ごとに更新し、配置先上限・共有枠・合計上限を超える追加を提示しない。
0個を含む途中完了とリセットを許可する（[BSTH11-R03裁定](../10_rules/06a_core-placement-groups.md)）。
複合系統の割り当ては確定せず、配置全体に合法な割り当てが存在するかで判定する。

配分HUDの経路は `coreDistributionRouteLabel()` で移動元・実際の配置先・表示側から生成する。
ボイド/トラッシュ/リザーブ/ライフ/ゲーム外/複数ソースを区別し、名称は `coreLocationDisplayLabel()` を共有する。
配分可能数と残数は通常・ソウルの合計に本文の上限を適用する。内部モード名から経路を決め打ちしない。

共通適用例はBSTH11-R03の系統共有枠、BSLH01-X04の1体1個までの配置。
検証は `core-distribution-groups` シナリオでAlice GUI、Bob REST、`kind=cb` を使う。

## 配置総数と移動元の選択

- 同じプレイヤーが配置先と移動元を選ぶ multi-source 配分は、GUI で総数指定の別HUDを挟まず、掴む→置くで両方を一括送信する。エンジンの学習用2段階選択は維持する。
- 配置先の選択者とコア所有者が異なる場合は総数指定を先に行う。保存済みの `fixedTargetTotals` がある場合は必要数を表示し、各カードの配置後総数が一致するまで完了できない。
- 分岐判定の正源は `utils/core-distribution-selection.ts`。
