// Modifiers クラスタ (P2-12): structured-effect-interpreter.ts から抽出。
// BP/カウント/ドロー/効果パラメータ/コア移動量の各種修飾子実行。

import { isSameCombinedEffectSource } from "./effect-source-identity";
import { getCardById } from "../card/card-lookup";
import type {
  CardDefinition,
  ContinuousEffect,
  DrawModifyAction,
  Duration,
  EffectPlayerRef,
  EffectTarget,
  GameState,
  TimingScope,
} from "../model";
import {
  immuneProtectedCount,
  shrinkProtectedCounts,
  withCount,
} from "../model";
export { shrinkProtectedCounts, withCount } from "../model";
import {
  durationStr,
  resolvePlayerRef,
  resolveTargetCards,
} from "./structured-effect-interpreter";
import { nextCeId } from "./structured-effect-sequences";
import type { TargetLockBypassProfile } from "./target-affect-gate";

export function executeBpModify(
  state: GameState,
  actingPlayerId: string,
  action: {
    target: EffectTarget;
    amount: number;
    duration: Duration;
    /**
     * 動的修飾量。設定時、生成する継続効果は `modifierAmount`（固定）でなく
     * `modifierAmountDynamic`（DynamicCount）を保持し、消費時に live 評価する。
     * 「自分のカウント1につき BP+1000」等の比例 *継続* 修飾用。`amount` は
     * ログ用の登録時スナップショット値として渡る。
     */
    dynamicAmount?: import("../dsl-types").DynamicCount;
  },
  sourceInstanceId?: string,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  preSelectedIds?: string[],
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number },
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile,
  forceSnapshotTargets = false,
  allowDynamicAllTargets = true,
  sourcePreventionBypass?: TargetLockBypassProfile,
  effectSourceInstanceId?: string,
  effectSourceDefinitionId?: string
): GameState {
  const sourceCard = sourceInstanceId
    ? getCardById(state, sourceInstanceId)
    : undefined;

  // count=-1 + 継続期間: 動的フィルタ CE（「すべて」系効果用）。
  // 「このターンの間、相手すべてをBP-N」も後から場に出た対象へ BP- だけ継続適用される。
  //
  // `allowDynamicAllTargets` は DSL レベルで `isDynamicBpModifyTargetSpecEligible`
  // (native-target-resolution.ts) が消費側で安全に live 評価できる filter キーに制限する。
  // 許可された filter は CE の targetFilter に保持し、matchesGlobalCETargetFilter
  // (legal-actions-shared.ts) の CardFilter SSOT で実カードに照合する。
  // 旧コードは "while_on_field" を allowDynamicAllTargets 経由せず常に dynamic 化していたため
  // 同型 silent bug が出ていた (ENGINE-bp-modify-dynamic-all-filter-fallback (audit,
  // engine-claude lane 2026-06-27 verifier round 1 lens 3) — 例 BSTH05-X01 effects[2]
  // 神域 filterOr+tribes は再帰的に適格性を評価する)。両 duration とも eligibility を要求し、ineligible
  // は snapshot 経路 (per-target CE) にフォールバックする。
  if (
    !forceSnapshotTargets &&
    action.target.count === -1 &&
    allowDynamicAllTargets &&
    (action.duration.scope === "while_on_field" ||
      action.duration.scope === "turn")
  ) {
    const singleEffect: ContinuousEffect = {
      effectId: nextCeId("bp_modifier"),
      sourceInstanceId: sourceInstanceId ?? "dsl-unknown",
      sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
      actingPlayerId,
      duration: action.duration,
      createdAtTurn: state.turnNumber,
      createdAtAttackId: state.activeAttack?.attackId ?? null,
      modifierTag: "bp_modifier",
      ...(action.dynamicAmount !== undefined
        ? { modifierAmountDynamic: action.dynamicAmount }
        : { modifierAmount: action.amount }),
      targetFilter: {
        player: action.target.player,
        ...(action.target.filter ?? {}),
        ...(action.target.category ? { category: action.target.category } : {}),
        ...(action.target.colors ? { colors: action.target.colors } : {}),
        ...(action.target.tribes ? { tribes: action.target.tribes } : {}),
        ...(action.target.tribesRequired
          ? { tribesRequired: action.target.tribesRequired }
          : {}),
        ...(action.target.tribesLogic
          ? { tribesLogic: action.target.tribesLogic }
          : {}),
        ...(action.target.noTribes !== undefined
          ? { noTribes: action.target.noTribes }
          : {}),
        ...(action.target.minCost !== undefined
          ? { minCost: action.target.minCost }
          : {}),
        ...(action.target.maxCost !== undefined
          ? { maxCost: action.target.maxCost }
          : {}),
        ...(action.target.cardName ? { cardName: action.target.cardName } : {}),
      },
      metadata: {
        bpModifySourcePreventionLevel: sourcePreventionLevel ?? "none",
        bpModifySourceTargetLockBypass: sourceTargetLockBypass ?? {
          kind: "none",
        },
        bpModifySourcePreventionBypass: sourcePreventionBypass ?? {
          kind: "none",
        },
      },
      ...(timingScope ? { timingScope } : {}),
      ...(provenance ? { provenance } : {}),
    };
    state.log.push(
      `effect:bp_modify:registered:all:${action.dynamicAmount !== undefined ? "dynamic" : action.amount}:${durationStr(action.duration)}`
    );
    return {
      ...state,
      activeContinuousEffects: [...state.activeContinuousEffects, singleEffect],
    };
  }

  const targetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.target.player,
    state
  );
  if (!getCardDefinitionById) {
    state.log.push(
      `effect:bp_modify:${action.target.player}:${action.amount}:${durationStr(action.duration)}:no-targets`
    );
    return state;
  }

  const toModify = resolveTargetCards(
    state,
    targetPlayerId,
    action.target,
    getCardDefinitionById,
    sourceInstanceId ?? "dsl-unknown",
    preSelectedIds,
    actingPlayerId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    true,
    undefined,
    sourcePreventionBypass,
    effectSourceInstanceId,
    effectSourceDefinitionId,
    { effectAspect: "bp" }
  );
  if (toModify.length === 0) {
    state.log.push(
      `effect:bp_modify:${action.target.player}:${action.amount}:${durationStr(action.duration)}:no-targets`
    );
    return state;
  }

  const newEffects: ContinuousEffect[] = toModify.map((card) => ({
    effectId: nextCeId("bp_modifier"),
    sourceInstanceId: sourceInstanceId ?? "dsl-unknown",
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration as Duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "bp_modifier",
    ...(action.dynamicAmount !== undefined
      ? { modifierAmountDynamic: action.dynamicAmount }
      : { modifierAmount: action.amount }),
    targetInstanceId: card.instanceId,
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  }));

  state.log.push(
    ...toModify.map(
      (c) =>
        `effect:bp_modify:registered:${c.instanceId}:${action.amount}:${durationStr(action.duration)}`
    )
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, ...newEffects],
  };
}

export function executeCountIncrease(
  state: GameState,
  actingPlayerId: string,
  playerRef: EffectPlayerRef,
  amount: number,
  protectedFromNonTribe?: string
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, playerRef, state);

  // count-gain メタ修飾 (BSTS01-C03): 受益プレイヤーの count_increase のうち
  // そのターン最初に解決する 1 件のみ +N する。〔ターンに1回:同名〕は
  // (受益プレイヤー, 修飾元 definitionId) 単位で first-opportunity 消費する
  // (10_rules/08a §カウント＋ メタ修飾)。bonus 分は protectedCounts へは積まない
  // (修飾元カードに保護クローズが無いため。原 amount のみ保護対象)。
  let bonus = 0;
  const newlyConsumed: string[] = [];
  for (const ce of state.activeContinuousEffects) {
    if (ce.modifierTag !== "count_gain_modifier") continue;
    const beneficiary =
      (ce.metadata?.countGainBeneficiary as string | undefined) ??
      ce.actingPlayerId;
    if (beneficiary !== targetPlayerId) continue;
    const key = `${targetPlayerId}:${ce.sourceDefinitionId}`;
    if (
      state.countGainModifierConsumedThisTurn.includes(key) ||
      newlyConsumed.includes(key)
    ) {
      continue;
    }
    bonus += ce.modifierAmount ?? 0;
    newlyConsumed.push(key);
  }
  const effectiveAmount = amount + bonus;

  const targetPlayer = state.players.find((p) => p.id === targetPlayerId);
  const actualIncrease =
    targetPlayer && effectiveAmount > 0
      ? Math.min(targetPlayer.voidNormalCoreCount, effectiveAmount)
      : 0;

  if (protectedFromNonTribe) {
    state.log.push(
      `effect:count_increase:${targetPlayerId}:${actualIncrease}:protected:${protectedFromNonTribe}`
    );
  } else {
    state.log.push(`effect:count_increase:${targetPlayerId}:${actualIncrease}`);
  }
  if (bonus > 0) {
    state.log.push(
      `effect:count_gain_modifier:applied:${targetPlayerId}:+${bonus}`
    );
  }
  return {
    ...state,
    countGainModifierConsumedThisTurn:
      newlyConsumed.length > 0
        ? [...state.countGainModifierConsumedThisTurn, ...newlyConsumed]
        : state.countGainModifierConsumedThisTurn,
    players: state.players.map((p) => {
      if (p.id !== targetPlayerId) return p;
      const next = {
        ...p,
        countValue: p.countValue + actualIncrease,
        voidNormalCoreCount: p.voidNormalCoreCount - actualIncrease,
      };
      if (protectedFromNonTribe && actualIncrease > 0) {
        next.protectedCounts = {
          ...(p.protectedCounts ?? {}),
          [protectedFromNonTribe]:
            (p.protectedCounts?.[protectedFromNonTribe] ?? 0) +
            Math.min(amount, actualIncrease),
        };
      }
      return next;
    }),
  };
}

/**
 * 「〇〇と宣言することで」型の宣言ギミック primitive (BSLH01「エンジョ〜イ、みっしぃ！」正源)。
 * `GameState.declarationCountThisTurn` (プレイヤーID→累積回数、ターン遷移時にリセット) を
 * +1 する。宣言自体の任意性は `executionMode:"optional"` 側で表現済みのため無条件実行。
 */
export function executeDeclareGimmick(
  state: GameState,
  actingPlayerId: string,
  playerRef: EffectPlayerRef
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, playerRef, state);
  const nextCount = (state.declarationCountThisTurn[targetPlayerId] ?? 0) + 1;
  state.log.push(`effect:declare_gimmick:${targetPlayerId}:${nextCount}`);
  return {
    ...state,
    declarationCountThisTurn: {
      ...state.declarationCountThisTurn,
      [targetPlayerId]: nextCount,
    },
  };
}

/**
 * カウント＋ メタ修飾 (count_gain_modifier) の継続効果を登録する。
 * BSTS01-C03 ［行政担当］リグルド〔ターンに1回:同名〕
 * 「自分の『カウント＋』効果で増やすカウントを＋N する」。
 * 登録された CE は executeCountIncrease がクエリし、そのターン最初に解決する
 * 受益プレイヤーの count_increase 1 件のみへ +amount を自動加算する。
 */
export function executeCountGainModifier(
  state: GameState,
  actingPlayerId: string,
  action: import("../dsl-types").DSL.CountGainModifierAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const beneficiaryId = resolvePlayerRef(actingPlayerId, action.player, state);
  const sourceCard = getCardById(state, sourceInstanceId);
  const newEffect: ContinuousEffect = {
    effectId: nextCeId("count_gain_modifier"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "count_gain_modifier",
    modifierAmount: action.amount,
    metadata: { countGainBeneficiary: beneficiaryId },
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };
  state.log.push(
    `effect:count_gain_modifier:registered:${beneficiaryId}:+${action.amount}:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

/**
 * コア除去効果で移動するコア数 +N メタ修飾 (core_move_amount_modifier) の継続効果を登録する。
 * 例: BSTH001-転醒R02(A) effect[1] Lv2-Lv3「自分のスピリットの『コア除去効果』で
 *     移動するコアの数を+1する」。
 * 登録された CE は executeCoreMove がクエリし、対象コアシュート (相手カード源かつ
 * source が自分のスピリット) の amount に +bonus を加算する (10_rules/06: ライフ↔
 * リザーブは「コア除去効果」と別扱いのためスコープ外)。終止形=強制、期間中ずっと +N。
 */
export function executeCoreMoveAmountModifier(
  state: GameState,
  actingPlayerId: string,
  action: import("../dsl-types").DSL.CoreMoveAmountModifierAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  const newEffect: ContinuousEffect = {
    effectId: nextCeId("core_move_amount_modifier"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "core_move_amount_modifier",
    modifierAmount: action.amount,
    metadata: { coreMoveAmountScope: action.scope },
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };
  state.log.push(
    `effect:core_move_amount_modifier:registered:${actingPlayerId}:+${action.amount}:${action.scope}:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

/**
 * 「コア除去効果で移動するコアの数を+N」メタ修飾の bonus を計算する。
 * executeCoreMove (相手カードを源とするコアシュート) の amount に上乗せされる。
 * - 受益プレイヤー = sourceInstance の owner と一致 (= actingPlayerId)
 * - scope "self_player": 自分の効果すべて。発揮元・修飾源のカテゴリやゾーンを問わず、
 *   期間指定の修飾は発揮後に修飾源がトラッシュへ移動していても適用する。
 * - scope "self_player_spirits": modifier CE の源 (sourceInstanceId) が
 *   sourceInstance の owner と同じプレイヤー所有のスピリットでフィールド上にあること。
 *   さらに sourceInstance 自身もスピリットであること (「自分のスピリットの」表現、
 *   BSTH001-転醒R02(A))。合体ブレイヴ自身のコアシュートはホストが実行者になるため対象。
 * - scope "self_card": 修飾源と効果の発揮元が同じ合体スピリットに属すること。
 *   ホストと合体ブレイヴの両方を含み、下のカードや別のスピリットは含まない。
 */
export function computeCoreMoveAmountBonus(
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  effectSourceInstanceId?: string
): number {
  const sourceCard = getCardById(state, sourceInstanceId);
  if (!sourceCard) return 0;
  if (!getCardDefinitionById) return 0;
  const effectSourceCard =
    effectSourceInstanceId !== undefined
      ? getCardById(state, effectSourceInstanceId)
      : sourceCard;
  if (!effectSourceCard) return 0;
  if (sourceCard.ownerPlayerId !== actingPlayerId) return 0;
  if (effectSourceCard.ownerPlayerId !== actingPlayerId) return 0;
  let bonus = 0;
  for (const ce of state.activeContinuousEffects) {
    if (ce.modifierTag !== "core_move_amount_modifier") continue;
    const scope = ce.metadata?.coreMoveAmountScope as string | undefined;
    if (
      scope !== "self_player" &&
      scope !== "self_player_spirits" &&
      scope !== "self_card"
    )
      continue;
    // 受益プレイヤー = CE actingPlayerId、コアシュートの actingPlayer と一致
    if (ce.actingPlayerId !== actingPlayerId) continue;
    if (scope === "self_player") {
      bonus += ce.modifierAmount ?? 0;
      continue;
    }
    if (sourceCard.zone !== "field") continue;
    // 修飾源 (modifier CE 発揮元) は自分側でフィールド上
    const modSrc = getCardById(state, ce.sourceInstanceId);
    if (!modSrc) continue;
    if (modSrc.ownerPlayerId !== actingPlayerId) continue;
    if (modSrc.zone !== "field") continue;
    if (scope === "self_card") {
      // ホスト・合体ブレイヴで「このスピリット」の効果範囲を共有する。
      if (
        !isSameCombinedEffectSource(
          state,
          modSrc.instanceId,
          effectSourceCard.instanceId
        )
      )
        continue;
    } else {
      // self_player_spirits: 修飾源・コアシュート源のいずれもスピリットであること
      const modSrcDef = getCardDefinitionById(modSrc.definitionId);
      if (!modSrcDef || modSrcDef.printedCategory !== "spirit") continue;
      const sourceDef = getCardDefinitionById(sourceCard.definitionId);
      if (!sourceDef || sourceDef.printedCategory !== "spirit") continue;
    }
    bonus += ce.modifierAmount ?? 0;
  }
  return bonus;
}

/**
 * 「このスピリットによって減る相手のライフの数を+N」メタ修飾の bonus を計算する
 * (scope: "self_card_opponent_life_reduction", BSSA01-転醒X01(B))。
 * 効果によるライフ移動・life_damage・アタックのライフ減少に上乗せされる。
 * 10_rules/06 line120 によりライフ↔リザーブは「コア除去効果」と別扱いのため、
 * computeCoreMoveAmountBonus (card_instance/field 経路) とは独立に照合する。
 * - 修飾源と効果の発揮元が同じ合体スピリットに属すること。
 */
export function computeLifeReductionAmountBonus(
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effectSourceInstanceId?: string
): number {
  const sourceCard = getCardById(state, sourceInstanceId);
  if (!sourceCard) return 0;
  if (sourceCard.ownerPlayerId !== actingPlayerId) return 0;
  const effectSourceCard =
    effectSourceInstanceId !== undefined
      ? getCardById(state, effectSourceInstanceId)
      : sourceCard;
  if (!effectSourceCard) return 0;
  if (effectSourceCard.ownerPlayerId !== actingPlayerId) return 0;
  let bonus = 0;
  for (const ce of state.activeContinuousEffects) {
    if (ce.modifierTag !== "core_move_amount_modifier") continue;
    const scope = ce.metadata?.coreMoveAmountScope as string | undefined;
    if (scope !== "self_card_opponent_life_reduction") continue;
    if (ce.actingPlayerId !== actingPlayerId) continue;
    const modifierSource = getCardById(state, ce.sourceInstanceId);
    if (modifierSource?.zone !== "field") continue;
    if (
      !isSameCombinedEffectSource(
        state,
        ce.sourceInstanceId,
        effectSourceCard.instanceId
      )
    )
      continue;
    bonus += ce.modifierAmount ?? 0;
  }
  return bonus;
}

export function executeCountDecrease(
  state: GameState,
  actingPlayerId: string,
  playerRef: EffectPlayerRef,
  amount: number,
  /** 減少を起こす効果ソースの系統リスト（保護カウントの床値判定に使う）。 */
  sourceTribes: readonly string[] = []
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, playerRef, state);
  const player = state.players.find((p) => p.id === targetPlayerId)!;
  // ソース系統が持たない保護カウントは減らせない（床値）。
  const immune = immuneProtectedCount(player.protectedCounts, sourceTribes);
  const reducible = Math.max(0, player.countValue - immune);
  const actual = Math.min(amount, reducible);
  if (actual === 0) {
    state.log.push(`effect:count_decrease:${targetPlayerId}:0:already-zero`);
    return state;
  }
  const newCount = Math.max(0, player.countValue - actual);
  const newProtected = shrinkProtectedCounts(
    player.protectedCounts,
    newCount,
    sourceTribes
  );
  state.log.push(`effect:count_decrease:${targetPlayerId}:${actual}`);
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === targetPlayerId ? withCount(p, newCount, newProtected) : p
    ),
  };
}

export function executeCountSet(
  state: GameState,
  actingPlayerId: string,
  playerRef: EffectPlayerRef,
  value: number
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, playerRef, state);
  const newCount = Math.max(0, value);
  state.log.push(`effect:count_set:${targetPlayerId}:${value}`);
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === targetPlayerId
        ? // set はソース系統を問わず総量をそろえるため、保護も総量に丸める。
          withCount(
            p,
            newCount,
            shrinkProtectedCounts(p.protectedCounts, newCount)
          )
        : p
    ),
  };
}

export function executeDrawModify(
  state: GameState,
  actingPlayerId: string,
  action: DrawModifyAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  const newEffect: ContinuousEffect = {
    effectId: nextCeId("draw_modify"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "draw_modify",
    modifierAmount: action.amount,
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };

  state.log.push(
    `effect:draw_modify:registered:${action.amount}:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

/**
 * `effect_param_modify` DSL アクションを CE として登録する。
 *
 * 他効果のターゲットフィルタ条件 (`target.filter.maxBp` / `maxCost` / `category`)
 * を継続的に書き換える "メタ効果" を CE 化する。CE 適用は
 * `applyEffectParamOverridesToFilter` (effect-param-override.ts) が
 * ターゲット解決経路で行う。
 *
 * 1 つの DSL アクションが (addLimitAmount, addTargetCategories) を同時指定する
 * 場合でも、CE 1 件として登録する (両 delta が同じスコープに紐付くため)。
 */
export function executeEffectParamModify(
  state: GameState,
  actingPlayerId: string,
  action: import("../dsl-types").DSL.EffectParamModifyAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  // どちらの delta も指定されていない場合は no-op (state 不変→ succeeded=false)
  if (
    action.addLimitAmount === undefined &&
    (action.addTargetCategories === undefined ||
      action.addTargetCategories.length === 0)
  ) {
    return state;
  }
  const sourceCard = getCardById(state, sourceInstanceId);
  const metadata: Record<string, unknown> = {
    effectClass: action.effectClass,
    scope: action.scope,
  };
  if (action.addLimitAmount !== undefined) {
    metadata.addLimitAmount = action.addLimitAmount;
  }
  if (
    action.addTargetCategories !== undefined &&
    action.addTargetCategories.length > 0
  ) {
    metadata.addTargetCategories = [...action.addTargetCategories];
  }
  // scope: "player_cards" のときのみ、既存汎用フィールド ContinuousEffect.targetFilter
  // (player + CardFilter, cost_modify の player+cardFilter と同型) へ委譲する。
  // "self"/"combined_unit" は sourceInstanceId 一致 or 合体判定のみで閉じるため不要。
  const targetFilter =
    action.scope === "player_cards"
      ? { player: action.player ?? "self", ...(action.cardFilter ?? {}) }
      : undefined;
  const newEffect: ContinuousEffect = {
    effectId: nextCeId("effect_param_override"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "effect_param_override",
    metadata,
    ...(targetFilter ? { targetFilter } : {}),
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };
  state.log.push(
    `effect:effect_param_modify:registered:${action.effectClass}:scope=${action.scope}:limit=${action.addLimitAmount ?? 0}:cats=${(action.addTargetCategories ?? []).join("|")}:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

/**
 * `duration_override` DSL アクションを CE として登録する。
 *
 * 対象 CE の実効 duration は `getEffectiveDuration` (duration-override.ts) が
 * `removeExpiredContinuousEffects` の失効判定の都度、この CE を参照して算出する
 * (対象 CE の生成順序に非依存)。
 */
export function executeDurationOverride(
  state: GameState,
  actingPlayerId: string,
  action: import("../dsl-types").DSL.DurationOverrideAction,
  sourceInstanceId: string,
  timingScope?: TimingScope,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  const metadata: Record<string, unknown> = {
    fromScope: action.fromScope,
    toDuration: action.toDuration,
  };
  const targetFilter = { player: action.player, ...(action.cardFilter ?? {}) };
  const newEffect: ContinuousEffect = {
    effectId: nextCeId("duration_override"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "duration_override",
    metadata,
    targetFilter,
    ...(timingScope ? { timingScope } : {}),
    ...(provenance ? { provenance } : {}),
  };
  state.log.push(
    `effect:duration_override:registered:from=${action.fromScope}:to=${durationStr(action.toDuration)}:${durationStr(action.duration)}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}
