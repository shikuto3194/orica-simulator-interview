# 通常神託のイベント列挙

入口: [08d 創界神・導界者](08d_grandwalker-nexus.md#実装状況)。

`checkAndQueueOracleChoices()`は、召喚/煌臨/配置/使用時に本文列挙イベントだけを判定する。
`oracleTriggerKinds`は空でない必須列挙。未指定・空のランタイム入力では通常神託をキューしない（fail-closed）。
対象条件マッチとボイドのコアがあれば、mechanic付き`pendingTriggeredEffects`をキューする。
`resolve_pending_triggered_effect`で受諾/辞退し、`resolveOracleMechanic()`がボイドから創界神へコアを動かす。
発揮宣言はカード効果の誘発と同様スタック窓を開き、窓クローズ後に解決する。辞退は窓なし（[02](02_turn-flow-and-timing.md#スタック窓-stack-timing)）。
通常oracleは省略時optional。終止形は`oracleExecutionMode:"mandatory"`でskip不可。

アクセル使用は召喚/煌臨ではない（[08b](08b_accel-change-zero-counter.md)）。
BSTH03-X02の「召喚/煌臨したとき」は`summon/advent`のみ。
BSTH08.5-X03のように本文にアクセル使用を列挙するカードだけが`use_accel`に反応する。
配置時神託は別の本文・処理であり、通常イベントへ自動追加しない。
全カードのcoverage/fidelity監査で欠落・空・本文とのイベント集合不一致を違反として検出する。

全定義の原文照合と回帰: [2026-10-13 神託イベント列挙](../30_plan/03_completed-milestones-phase-6-oracle-trigger-kinds.md)。
