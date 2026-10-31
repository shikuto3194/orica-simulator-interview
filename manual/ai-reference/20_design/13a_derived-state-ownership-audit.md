# 派生状態の更新責任と監査（2026-10-01）

## 契約

現在値を保存するときは、元データの共通更新処理が同期まで完了する。呼出元の別途更新や、後続効果の偶然の再計算へ依存しない。読み取り時キャッシュは依存状態が同一の場合だけ再利用する。確定時点のsnapshot・観測履歴は現在値と区別し、遡って更新しない。

## 範囲と方法

`packages/rules-core/src` 全体でmodelの保存フィールド、Map/WeakMap、再構築・再計算関数、派生値の代入、読取側、不変条件検査を横断検索した。ルール分類は [03e](../10_rules/03e_attack-duration-precedents.md) を参照。同期責任の構造監査であり、全カード・全状態遷移の網羅証明ではない。

## 発見と修正

1. **バトル現在値の同期欠落**: `continuous-effect-rebuild.ts` の再構築後に `BattleEntity.resolvedBp/resolvedSymbols/resolvedSymbolCount` を更新しない経路があった。ロイドの2026-09-30棋譜（delta frame 261–263）は、シンボル追加CEがあって保存値は黒1。最初の回復解決が再計算を補っていたため2回目に顕在化した。
2. **実効identityのキャッシュキー不足**: CE配列と自カードの一部属性だけでキャッシュを共有し、CE配列を共有したままstepが変わると実効getterと不一致になった。同一の不変GameState・card・definition・lookupだけで共有する形へ変更。live copyの付与元変更も同じ境界で扱う。
3. **手札・デッキ枚数の個別同期**: `replaceCardInstances` が配列更新と枚数確定を一体で行う。エンジンの配列差し替えをこの境界へ移し、`syncDeckCount` / `handCountAlreadyAdjusted` と各executorの加減算を廃止した。初期配布・マリガン・公開・召喚・離脱確定も同じ契約で扱う。

`finalizeContinuousEffectRebuild` が抑止整理後のバトル現在値を同期する。field/full/sources/battleの出口はここへ収束し、sourcesが空でも除去後の同期を省略しない。確定済み `BattleResolutionEntitySnapshot` は保持する。離脱途中の主カードが場を離れているときは、共通離脱処理による構成員の除去・残留ブレイヴへの引継ぎを先行させる。

実対戦の枚数はカード実体が正源で、デッキ0枚でもinvariantが照合する。`createEmptyGameState`だけが`zoneCountMode: "abstract"`を付け、従来の省略カードfixtureは実体差分と省略分の移動を共通処理で扱う。`initializeGame`と旧保存データ（指定なし）は実体モード。JSONと秘匿表示はこの区別を保持する。

## 全体の照合表

| 保存値・キャッシュ | 正源・更新境界 | 結果 |
| --- | --- | --- |
| バトルのBP・シンボル | `battle-shared.ts:recomputeBattleEntityBp`、CE再構築4入口 | 同期漏れを修正。現在値と実効getterの不変条件を追加 |
| 実効identity | `resolveEffectiveIdentity` | 不完全キーを修正。step・付与元変更を回帰化 |
| card ID索引 | `card/card-lookup.ts`、GameState単位のWeakMap | 新stateで失効。手動更新APIなし |
| zone索引 | `zone/zone-partition.ts`、cardInstances単位のWeakMap | 不変更新が前提。配列破壊更新をSSOT検査へ追加 |
| 対象別CE索引 | `card/ce-lookup.ts`、CE配列単位のWeakMap | scopeは読取時に毎回適用。配列破壊更新を禁止 |
| 使用回数索引 | `legal/legal-actions-shared.ts:buildUsageRecordIndex` | records配列単位。期間・個体世代は消費時判定 |
| CE自身を除外した配列 | `continuous-effect-rebuild.ts:stateWithoutContinuousEffect` | 除外結果だけ共有。他stateは現在の引数から構築 |
| 手札・デッキ枚数 | `zone/card-instance-state.ts:replaceCardInstances` | 個別補正を除去。配列・枚数の直接更新をSSOT検査で禁止。[P3-163](../../../issues/archive/P3-163/index.md) |
| ソウルコア位置・個数 | `core/core-system.ts`の移動・配置primitive、core invariant | 共通同期あり。複数個対応の残件は既存P3-101 |
| 親子・下カード関係 | 合体・下カード共通関数、core invariant、既存SSOT | 親参照を正源に参照。子配列を独立正源にするUIは禁止済み |
| 効果キューのsummary | `effect/effect-queue.ts:setEffectQueueEntries` | 更新とsummary生成が同一処理。queue invariantで照合 |
| legal action候補 | `legal/legal-actions.ts:getLegalActions` | 現stateから都度生成。state間の候補キャッシュなし |
| AI選択探索内memo | `training-decision-surface.ts` | 探索内で生成。ゲーム状態間で共有しない |
| 解決snapshot・宣言時対象・公開履歴 | `BattleResolutionGroup`、pending、PublicDisclosure | 過去の確定事実。一括同期対象から除外 |

一時索引とstateをまたぐキャッシュを区別した。cardInstances/CE/usage配列やcardのzone等への直接代入・破壊更新をsrc横断検索で調べ、不変更新の前提を照合した。aliasの別関数渡しまで証明したものではない。

## 検査

- `derived-state-consistency.test.ts`: 再構築4入口、BP・シンボル、条件解除、空sources、snapshot保持、不整合検出。
- `effective-identity.test.ts`: 同一stateの再利用、step・コア・付与元変更後の再計算。
- `zone-card-count-ownership.test.ts`: 最後のデッキカード、0枚への戻し、両プレイヤー、初期配布・マリガン、離脱待ち、JSON/秘匿表示、抽象fixture互換。
- `bslh01-x03-battle-symbol.test.ts`: 連続アタック/ブロック、使用回数、保存値、2回の2ダメージ。
- `e2e/scenario-bslh01-x03-symbol.spec.ts`: Alice GUI / Bob REST、アタック・ブロック各2回。
- `check:ssot` の `derived-state-ownership`: ASTで再構築の全returnがfinalizerへ到達すること、抑止整理後の再計算、identityのstateキー・引数照合、invariant配線、索引元配列の直接破壊更新を検査。削除・早期return・部分キーへの退行を回帰テストで検出する。
- 同じSSOT検査で、共通境界外のcardInstances差し替え・枚数のobject spread更新/直接代入/加減算・実対戦へのabstract指定を拒否する。初期fixtureと読取専用AI projectionは関数と構文を限定する。

静的検査は既知の構造契約の再発防止であり、任意の新しい派生値の依存関係を自動推論するものではない。
