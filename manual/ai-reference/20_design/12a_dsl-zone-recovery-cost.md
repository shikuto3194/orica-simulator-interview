# DSL補足: 戻し先・回復・召喚対価

[DSL仕様](12_dsl-specification.md)の詳細。型定義は `packages/rules-core/src/dsl-types.ts` を正源とする。

- `bounce.destination:"hand_or_set_aside_choice"` は、対象決定後に各カードの戻し先を選ぶ。
  `PendingZoneSelection` / `zoneSelectionDestinationByCardId` で指定し、確定後はまとめて通常の離場処理へ渡す。
  対象ごとの耐性・手元への移動制限を判定し、移動できた対象だけを後続参照へ記録する。
- `cost_modify.useCostPayment` の除外支払いは `effectSummonEffectIndex` を指定すると、
  そのカード自身の指定 `effects[]` による効果召喚だけに適用する。通常召喚や別の効果による召喚へ流用しない。
- `restrict_recovery.filter` は回復前の状態に照合し、カード耐性を含めて効果回復・リフレッシュで共通評価する。
  重疲労限定のときはフィルターへ明記する。
- `exhaust.downgradeAtTurnEnd` の予約は `fieldInstanceGeneration` でフィールド個体に束縛する。
  途中で回復しても終了時に疲労へ変えるが、離場・再登場した個体には適用しない。

実例・検証: [BSTH11 全13枚監査](../30_plan/03_completed-milestones-phase-6-bsth11-fidelity-audit.md)。

## トークンデッキの支払い前効果

`applicability.zone:"token_pool"` と `timing:{kind:"game_event",event:"summon",player:"self",beforeCost:true}`
は、トークン自身の効果を召喚コスト支払い前に実行する。通常の召喚完了イベントには登録しない。
`triggerFilter` は召喚対象を絞り、効果本文は通常の `steps` と条件評価で処理する。

`put.target:{kind:"from_token_pool",source:"self",count:1}` は、その効果元のトークンを場へ出す。
`trashCoreMax` / `trashCoreKind` は追加の配置供給元の上限で、使用義務ではない。
`requireDirectCombineWithTrigger:true` は、その召喚対象を出したトークンへ直接合体させる。
コア選択中は元の召喚を中断し、配置完了後に支払い供給元を作り直して再開する。
`relatedTokenCardNos` は利用するトークン定義の関連付けだけを担い、効果本文は格納しない。

実例: BSES01-T01。修正経緯は [P3-138](../../../issues/archive/P3-138/history-2026-10.md)。
