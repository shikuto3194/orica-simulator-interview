/**
 * 専用の使用記録だった枠(P3-170 I05/I06/I07/I10)を共通の使用会計へ載せる薄い層。
 * GameState に専用の使用済み配列・辞書を持たず、識別(AbilityRef)と制約(UsageConstraint)だけを
 * ここで組み立てて、共通の照会/消費(`legal-actions-shared` の facade)を呼ぶ。
 *
 * 各枠は「現行の挙動(共有範囲・消費地点)」を意味として保存する。根拠の無い裁定は足さない。
 *
 * - I05 count_gain_modifier : 受益プレイヤー × 修飾元(同名)で〔ターンに1回〕。最初の適用で消費。
 * - I06 allow_tapless_battle_declare : 受益個体ごとに、アタック/ブロックが同じ予算を消費。
 *       付与元が違っても同じ個体は1予算(現行どおり)。消費は宣言の確定時。
 * - I07 declareGimmickGate : 宣言ギミック(BSLH01-C12 等)の「ターンに1回ずつ」。識別は
 *       使用者 + 効果元の個体 + 登録時の構造path(CE の effectId を使わない)。
 *       CE 再構築(Lv2→Lv1→Lv2)で識別が変わらない。
 * - I10 useCostGate : 「この方法で使用した」事実(measure=fact)。使用回数ではない。
 *       後続条件(`life_damage_interception_use_cost_gate_paid_this_turn`)がこの事実を照会する。
 */

import type { UsageSite } from "../effect/effect-usage-accounting";
import {
  abilityFingerprint,
  buildUsageConstraint,
  makeAbilityRef,
  sharedNameAbilityRef,
} from "../effect-usage";
import type { AbilityRef } from "../effect-usage";
import {
  canUseEffectUsage,
  consumeEffectUsage,
  queryEffectUsage,
} from "../legal/legal-actions-shared";
import type { GameState } from "../model";

const ONCE: { base: number } = { base: 1 };

// ---------------------------------------------------------------
// I05 count_gain_modifier (BSTS01-C03)
// ---------------------------------------------------------------

/**
 * 〔ターンに1回:同名〕。受益プレイヤーごと・修飾元の定義ごとに共有する(複数コピーは1回に畳む)。
 * 名前の解決は現行どおり定義ID(= cardNo)で行う。同名別定義の扱いは同名共有の正源側(H2)に従う。
 */
export function countGainModifierUsageSite(
  state: GameState,
  modifier: { sourceInstanceId: string; sourceDefinitionId: string },
  beneficiaryPlayerId: string
): UsageSite {
  const ability = makeAbilityRef(
    "effect",
    modifier.sourceDefinitionId,
    "count_gain_modifier"
  );
  const nameAbility = sharedNameAbilityRef(
    modifier.sourceDefinitionId,
    abilityFingerprint({ countGainModifier: true })
  );
  return {
    state,
    ability,
    nameAbility,
    sourceInstanceId: modifier.sourceInstanceId,
    sourceDefinitionId: modifier.sourceDefinitionId,
    playerId: beneficiaryPlayerId,
    nameKey: modifier.sourceDefinitionId,
    constraints: [
      buildUsageConstraint({
        abilityRef: nameAbility,
        share: "card_name",
        period: "turn",
        measure: "use",
        maximum: ONCE,
        commitPoint: "application",
      }),
    ],
  };
}

/** この修飾はいま適用できるか(照会のみ。状態は変えない)。 */
export function canApplyCountGainModifier(
  state: GameState,
  modifier: { sourceInstanceId: string; sourceDefinitionId: string },
  beneficiaryPlayerId: string
): boolean {
  return canUseEffectUsage(
    countGainModifierUsageSite(state, modifier, beneficiaryPlayerId)
  );
}

/** 適用した時点で消費する(宣言では消費しない)。既に使用済みなら状態を変えない。 */
export function consumeCountGainModifier(
  state: GameState,
  modifier: { sourceInstanceId: string; sourceDefinitionId: string },
  beneficiaryPlayerId: string
): GameState {
  return consumeEffectUsage(
    countGainModifierUsageSite(state, modifier, beneficiaryPlayerId)
  ).state;
}

// ---------------------------------------------------------------
// I06 allow_tapless_battle_declare (BSTH09-C03)
// ---------------------------------------------------------------

function taplessBattleDeclareSite(
  state: GameState,
  instanceId: string
): UsageSite | undefined {
  const card = state.cardInstances.find((c) => c.instanceId === instanceId);
  if (!card) return undefined;
  const ability = makeAbilityRef(
    "grant",
    "allow_tapless_battle_declare",
    "attack_or_block"
  );
  return {
    state,
    ability,
    sourceInstanceId: instanceId,
    sourceDefinitionId: card.definitionId,
    playerId: card.controllerPlayerId ?? card.ownerPlayerId,
    constraints: [
      buildUsageConstraint({
        abilityRef: ability,
        share: "instance",
        period: "turn",
        measure: "use",
        maximum: ONCE,
        // 現行は instanceId のみで識別し、場の世代を見ない(裁定なし)。その挙動を保存する。
        incarnation: { field: false, soul: false },
        commitPoint: "grant_use",
      }),
    ],
  };
}

/** この個体の「疲労せずにアタック/ブロック」予算が今ターン未消費か。 */
export function isTaplessBattleDeclareBudgetAvailable(
  state: GameState,
  instanceId: string
): boolean {
  const site = taplessBattleDeclareSite(state, instanceId);
  return site !== undefined && canUseEffectUsage(site);
}

/** 宣言の確定時にアタック/ブロック共有の予算を消費する。 */
export function consumeTaplessBattleDeclareBudget(
  state: GameState,
  instanceId: string
): GameState {
  const site = taplessBattleDeclareSite(state, instanceId);
  return site === undefined ? state : consumeEffectUsage(site).state;
}

// ---------------------------------------------------------------
// I07 declareGimmickGate (BSLH01-C12)
// ---------------------------------------------------------------

/** 宣言ギミックゲートの能力識別に必要な CE の事実。 */
export interface DeclareGimmickGateSource {
  sourceInstanceId: string;
  sourceDefinitionId: string;
  /** 登録時の構造path(CE 再構築で変わらない)。未指定は provenance から導く。 */
  ability?: AbilityRef;
}

/**
 * 登録時の効果の位置(effectIndex / stepIndex)から能力識別を作る。CE の effectId は使わない。
 * provenance が無い手組み CE だけは、保護対象プレイヤーで区別した固定pathに退避する。
 */
export function declareGimmickGateAbilityRef(
  sourceDefinitionId: string,
  provenance: { effectIndex: number; stepIndex: number } | undefined,
  protectedPlayerId: string
): AbilityRef {
  return makeAbilityRef(
    "gimmick",
    sourceDefinitionId,
    provenance
      ? `effects[${provenance.effectIndex}].steps[${provenance.stepIndex}].declareGimmickGate`
      : `life_damage_interception.declareGimmickGate@${protectedPlayerId}`
  );
}

function declareGimmickGateSite(
  state: GameState,
  playerId: string,
  gate: DeclareGimmickGateSource
): UsageSite {
  const ability =
    gate.ability ??
    declareGimmickGateAbilityRef(gate.sourceDefinitionId, undefined, playerId);
  return {
    state,
    ability,
    sourceInstanceId: gate.sourceInstanceId,
    sourceDefinitionId: gate.sourceDefinitionId,
    playerId,
    constraints: [
      buildUsageConstraint({
        abilityRef: ability,
        share: "instance",
        period: "turn",
        measure: "use",
        maximum: ONCE,
        // 効果元が場を離れて戻った別個体は新しい枠(03e)。Lv の上下では世代は変わらない。
        incarnation: { field: true, soul: false },
        commitPoint: "application",
      }),
    ],
  };
}

/** このターン、この宣言ギミックを使用済みか。 */
export function isDeclareGimmickGateUsed(
  state: GameState,
  playerId: string,
  gate: DeclareGimmickGateSource
): boolean {
  return !canUseEffectUsage(declareGimmickGateSite(state, playerId, gate));
}

/**
 * 支払い確定(宣言を行った)時に消費する。`operationId` を渡すと同じ支払いの再送は何も加算しない
 * (pending 再開で同じ消費を指すときは同じIDを渡す)。
 */
export function consumeDeclareGimmickGate(
  state: GameState,
  playerId: string,
  gate: DeclareGimmickGateSource,
  operationId?: string
): GameState {
  return consumeEffectUsage(
    declareGimmickGateSite(state, playerId, gate),
    operationId !== undefined ? { operationId } : undefined
  ).state;
}

// ---------------------------------------------------------------
// I10 useCostGate (BSLH01-M05)
// ---------------------------------------------------------------

function useCostGatePaidSite(
  state: GameState,
  playerId: string,
  sourceInstanceId: string,
  sourceDefinitionId: string
): UsageSite {
  const ability = makeAbilityRef(
    "gimmick",
    sourceDefinitionId,
    "life_damage_interception.useCostGate.paid"
  );
  return {
    state,
    ability,
    sourceInstanceId,
    sourceDefinitionId,
    playerId,
    constraints: [
      buildUsageConstraint({
        abilityRef: ability,
        share: "instance",
        period: "turn",
        // 回数制限ではなく「この方法で使用した」事実。使用回数のリセットとは独立。
        measure: "fact",
        // 現行は使用した個体(instanceId)のみで識別する。
        incarnation: { field: false, soul: false },
        commitPoint: "declaration",
      }),
    ],
  };
}

/** 使用コストゲートを支払った(この方法で使用した)事実を記録する。重複記録はしない。 */
export function recordUseCostGatePaid(
  state: GameState,
  playerId: string,
  sourceInstanceId: string
): GameState {
  const card = state.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );
  if (!card) return state;
  const site = useCostGatePaidSite(
    state,
    playerId,
    sourceInstanceId,
    card.definitionId
  );
  if (queryEffectUsage(site).entries.some((entry) => entry.used > 0)) {
    return state;
  }
  return consumeEffectUsage(site).state;
}

/**
 * 今ターン、このカードを使用コストゲートの支払いで使用した事実があるか。
 * 事実の主体は支払ったプレイヤー(= カードの持ち主)で、別プレイヤーの照会には成立しない。
 */
export function wasUseCostGatePaid(
  state: GameState,
  playerId: string,
  sourceInstanceId: string
): boolean {
  const card = state.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );
  if (!card || card.ownerPlayerId !== playerId) return false;
  return queryEffectUsage(
    useCostGatePaidSite(state, playerId, sourceInstanceId, card.definitionId)
  ).entries.some((entry) => entry.used > 0);
}
