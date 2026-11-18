/**
 * 実量の集計と宣言事実 (P3-170 I13 / I14 / I15) を共通の使用会計へ載せる薄い層。
 *
 * GameState に専用の累積辞書を持たず、識別 (AbilityRef) と制約 (UsageConstraint) だけをここで組み立て、
 * 台帳 (effect-usage/) への反映は `effect/effect-usage-accounting.ts` の状態アダプタ経由で行う。
 * 上限の判断 (cap の計算・適用順) は呼出側の既存ロジックのまま。ここは「現在までの量」の保存と照会だけ。
 *
 * 種類の区別 (混同しない):
 * - measure="amount"      : ドメインで確定した実量 (ライフ減少量・付与したシンボル数)。使用回数ではない。
 *                           取消の対象にならない (receipt を残さない)。
 * - measure="fact"        : プレイヤーが行った宣言 (declare_gimmick)。取消の対象にならない。
 * - measure="observation" : 発揮可否と無関係に数える観測 (effect-occurrence-gate.ts)。
 *
 * 量の帰属:
 * - 全体 / 効果原因 / BP閾値 の3枠はプレイヤー単位 (能力を区別しない共有枠)。
 * - フィルタ対象 / シンボル制限の2枠は「保護プレイヤー × 効果元の能力」単位。能力IDは CE の effectId
 *   (連番カウンタ由来で保存復元と同期しない) ではなく、効果元の定義 + 個体 + 構造path から作る。
 *
 * 同じライフ減少の確定点は `recordLifeReductionQuantities` 一つに渡し、各枠は呼出側が指定した量を
 * 一度だけ加算する (別々の producer が同じ量を重ねて加算しない)。
 */

import {
  buildUsageConstraint,
  makeAbilityRef,
  UNBOUNDED_USAGE_MAXIMUM,
} from "../effect-usage";
import type { AbilityRef, UsageConstraint } from "../effect-usage";
import {
  consumeUsageOnState,
  queryUsageOnState,
} from "../effect/effect-usage-accounting";
import type { UsageSite } from "../effect/effect-usage-accounting";
import type {
  ContinuousEffect,
  GameState,
  PendingLifeDamageTurnCapSource,
} from "../model";

/** 上限を持たない (集計だけの) 枠。使用済み量を切り詰めず、上限判断は呼出側が行う。 */
const resolveUnbounded = (): number => UNBOUNDED_USAGE_MAXIMUM.base;

// ---------------------------------------------------------------
// プレイヤー単位の共有枠
// ---------------------------------------------------------------

/** プレイヤー単位の集計枠の識別。 */
const PLAYER_QUANTITY = {
  /** 無印 turn_cap の累積 (全原因合算)。`life_reduced_this_turn` の判定にも使われる。 */
  cappedTotal: "life_reduction:capped_total",
  /** 相手の効果によるライフ減少の累積 (`turnThreshold` 判定)。 */
  effectCause: "life_reduction:effect_cause",
  /** BP閾値付き累積キャップ (BSTH08.5-C21) の累積。 */
  bpThreshold: "life_reduction:bp_threshold_capped",
  /** 宣言ギミック (declare_gimmick) の宣言事実。 */
  declaration: "declaration:gimmick",
} as const;

type PlayerQuantityGroup =
  (typeof PLAYER_QUANTITY)[keyof typeof PLAYER_QUANTITY];

function playerQuantityConstraint(
  groupId: PlayerQuantityGroup,
  measure: "amount" | "fact"
): UsageConstraint {
  return buildUsageConstraint({
    abilityRef: makeAbilityRef("rule", groupId, "quantity"),
    share: "group",
    groupId,
    period: "turn",
    measure,
    maximum: UNBOUNDED_USAGE_MAXIMUM,
    commitPoint: "application",
  });
}

function playerQuantitySite(
  state: GameState,
  playerId: string,
  groupId: PlayerQuantityGroup,
  measure: "amount" | "fact"
): UsageSite {
  return {
    state,
    ability: makeAbilityRef("rule", groupId, "quantity"),
    // 共有 group 枠は個体を持たない。照会文脈に必要な識別だけを与える。
    sourceInstanceId: playerId,
    sourceDefinitionId: groupId,
    playerId,
    constraints: [playerQuantityConstraint(groupId, measure)],
  };
}

function usedOf(site: UsageSite): number {
  return queryUsageOnState(site, resolveUnbounded).entries.reduce(
    (sum, entry) => sum + entry.used,
    0
  );
}

/** 取消の対象にならない記録として加算する (receipt を残さない)。 */
function addTo(site: UsageSite, amount: number): GameState {
  if (amount <= 0) return site.state;
  const result = consumeUsageOnState(site, resolveUnbounded, {
    amount,
    receipt: false,
  });
  return result.state;
}

// ---------------------------------------------------------------
// 効果元の能力単位の枠 (フィルタ付き turn_cap / restrict_symbol_addition)
// ---------------------------------------------------------------

type CeQuantityKind = "life_turn_cap" | "symbol_restriction";

/**
 * CE の効果元から、保存復元・CE再構築で変わらない能力IDを作る。
 * 登録時の構造path (effectIndex / stepIndex) と保護プレイヤー、効果元の定義・個体を使い、
 * CE の `effectId` (連番) は使わない。provenance を持たない手組みCEだけ、path を種別と
 * 保護プレイヤーに退避する。
 */
export function ceQuantitySourceOf(
  ce: Pick<
    ContinuousEffect,
    "sourceInstanceId" | "sourceDefinitionId" | "provenance"
  >,
  kind: CeQuantityKind,
  protectedPlayerId: string
): PendingLifeDamageTurnCapSource {
  const path = ce.provenance
    ? `effects[${ce.provenance.effectIndex}].steps[${ce.provenance.stepIndex}].${kind}@${protectedPlayerId}`
    : `${kind}@${protectedPlayerId}`;
  return {
    ability: makeAbilityRef("effect", ce.sourceDefinitionId, path),
    sourceInstanceId: ce.sourceInstanceId,
    sourceDefinitionId: ce.sourceDefinitionId,
  };
}

/**
 * 同一の数量枠を指す効果元かを判定する transient な重複排除キー (保存しない)。
 * 同じ能力IDの CE が複数あっても、同じ減少を同じ枠へ二重に加算しないために使う。
 */
export function quantitySourceKey(
  source: PendingLifeDamageTurnCapSource
): string {
  return JSON.stringify([
    source.sourceInstanceId,
    source.ability.kind,
    source.ability.definitionKey,
    source.ability.path,
  ]);
}

function sourceQuantityConstraint(ability: AbilityRef): UsageConstraint {
  return buildUsageConstraint({
    abilityRef: ability,
    share: "instance",
    period: "turn",
    measure: "amount",
    maximum: UNBOUNDED_USAGE_MAXIMUM,
    // 効果元が場を離れて戻った別個体は新しい枠 (03e)。Lv の上下・魂状態では世代は変わらない。
    incarnation: { field: true, soul: false },
    commitPoint: "application",
  });
}

function sourceQuantitySite(
  state: GameState,
  playerId: string,
  source: PendingLifeDamageTurnCapSource
): UsageSite {
  return {
    state,
    ability: source.ability,
    sourceInstanceId: source.sourceInstanceId,
    sourceDefinitionId: source.sourceDefinitionId,
    playerId,
    constraints: [sourceQuantityConstraint(source.ability)],
  };
}

// ---------------------------------------------------------------
// I14 / I13: ライフ減少の実量
// ---------------------------------------------------------------

/** 無印 turn_cap の累積 (全原因合算)。 */
export function getCappedLifeReduction(
  state: GameState,
  playerId: string
): number {
  return usedOf(
    playerQuantitySite(state, playerId, PLAYER_QUANTITY.cappedTotal, "amount")
  );
}

/** 相手の効果によるライフ減少の累積。 */
export function getEffectCauseLifeReduction(
  state: GameState,
  playerId: string
): number {
  return usedOf(
    playerQuantitySite(state, playerId, PLAYER_QUANTITY.effectCause, "amount")
  );
}

/** BP閾値付き累積キャップの累積。 */
export function getBpThresholdCappedLifeReduction(
  state: GameState,
  playerId: string
): number {
  return usedOf(
    playerQuantitySite(state, playerId, PLAYER_QUANTITY.bpThreshold, "amount")
  );
}

/** フィルタ付き turn_cap の累積 (効果元の能力単位)。 */
export function getFilteredCappedLifeReduction(
  state: GameState,
  playerId: string,
  source: PendingLifeDamageTurnCapSource
): number {
  return usedOf(sourceQuantitySite(state, playerId, source));
}

/** 一つの確定点で、各枠へ加算する実量。指定した枠だけが加算される。 */
export interface LifeReductionQuantities {
  /** 保護されるプレイヤー (ライフが減る側)。 */
  playerId: string;
  /** 全体 (無印 turn_cap) の枠へ加算する量。 */
  cappedTotal?: number;
  /** 効果原因の枠へ加算する量。 */
  effectCause?: number;
  /** BP閾値の枠へ加算する量。 */
  bpThreshold?: number;
  /** フィルタ対象の枠へ、効果元の能力ごとに加算する量。 */
  filtered?: readonly {
    source: PendingLifeDamageTurnCapSource;
    amount: number;
  }[];
}

/**
 * ライフ減少の実量を各枠へ一度だけ加算する唯一の入口。
 * 枠ごとの量は呼出側が確定した値 (既存の cap 計算の結果) をそのまま渡す。
 * 同じ減少に対する複数枠 (全体・効果原因・フィルタ) は独立した枠で、同じ量を各枠が一回ずつ記録する。
 * 上限外の原因・対象外のフィルタは、その枠の量を渡さない (= 枠を消費しない)。
 */
export function recordLifeReductionQuantities(
  state: GameState,
  quantities: LifeReductionQuantities
): GameState {
  const { playerId } = quantities;
  let current = state;
  if (quantities.cappedTotal !== undefined) {
    current = addTo(
      playerQuantitySite(
        current,
        playerId,
        PLAYER_QUANTITY.cappedTotal,
        "amount"
      ),
      quantities.cappedTotal
    );
  }
  if (quantities.effectCause !== undefined) {
    current = addTo(
      playerQuantitySite(
        current,
        playerId,
        PLAYER_QUANTITY.effectCause,
        "amount"
      ),
      quantities.effectCause
    );
  }
  if (quantities.bpThreshold !== undefined) {
    current = addTo(
      playerQuantitySite(
        current,
        playerId,
        PLAYER_QUANTITY.bpThreshold,
        "amount"
      ),
      quantities.bpThreshold
    );
  }
  for (const entry of quantities.filtered ?? []) {
    current = addTo(
      sourceQuantitySite(current, playerId, entry.source),
      entry.amount
    );
  }
  return current;
}

// ---------------------------------------------------------------
// I13: シンボル追加制限 (restrict_symbol_addition) の付与済みシンボル数
// ---------------------------------------------------------------

/** このターン、この制限のもとで追加されたシンボルの累積数。 */
export function getSymbolAdditionRestrictedCount(
  state: GameState,
  restrictedPlayerId: string,
  source: PendingLifeDamageTurnCapSource
): number {
  return usedOf(sourceQuantitySite(state, restrictedPlayerId, source));
}

/**
 * シンボルを追加した数を記録する。上限超過で追加しなかった試行は呼ばない
 * (現行の挙動: 通過した追加の数量 = 実際に付与するシンボル数)。
 */
export function recordSymbolAdditionRestrictedCount(
  state: GameState,
  restrictedPlayerId: string,
  source: PendingLifeDamageTurnCapSource,
  amount: number
): GameState {
  return addTo(sourceQuantitySite(state, restrictedPlayerId, source), amount);
}

// ---------------------------------------------------------------
// I15: 宣言ギミックの宣言事実
// ---------------------------------------------------------------

/** 宣言事実の照会に必要な最小の状態 (CardFilter の判定のように GameState 全体を持たない呼出し向け)。 */
export type GimmickDeclarationQueryState = Pick<
  GameState,
  "effectAccounting" | "turnNumber" | "stepOrdinalThisTurn" | "cardInstances"
> &
  Partial<Pick<GameState, "activeAttack">>;

/** このターン、プレイヤーが宣言ギミックを宣言した回数。 */
export function getGimmickDeclarationCount(
  state: GimmickDeclarationQueryState,
  playerId: string
): number {
  return usedOf(
    playerQuantitySite(
      state as GameState,
      playerId,
      PLAYER_QUANTITY.declaration,
      "fact"
    )
  );
}

/**
 * 宣言ギミックの宣言を1回記録する (declare_gimmick アクション / 宣言コストゲートの支払いが共有)。
 * 宣言は取消の対象にならない事実で、宣言カード自体の取消とは別 (receipt を残さない)。
 */
export function recordGimmickDeclaration(
  state: GameState,
  playerId: string
): GameState {
  const recorded = addTo(
    playerQuantitySite(state, playerId, PLAYER_QUANTITY.declaration, "fact"),
    1
  );
  const nextCount = getGimmickDeclarationCount(recorded, playerId);
  return {
    ...recorded,
    log: [...recorded.log, `effect:declare_gimmick:${playerId}:${nextCount}`],
  };
}

/** 全プレイヤーの今ターンの宣言数の合計 (declare_gimmick が成立したかの判定に使う)。 */
export function getTotalGimmickDeclarations(state: GameState): number {
  return state.players.reduce(
    (sum, player) => sum + getGimmickDeclarationCount(state, player.id),
    0
  );
}
