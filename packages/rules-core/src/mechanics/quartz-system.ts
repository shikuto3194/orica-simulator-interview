import { requireCardZone } from "../model";
import { replaceCardInstances } from "../zone/card-instance-state";
import { advanceSoulStateGeneration } from "../effect/effect-usage-lifecycle";
/**
 * クォーツ（魂状態セット専用モデル）の実行プリミティブ（P2-07 H-2 / F2）。
 *
 * 正源ルール: `manual/ai-reference/10_rules/07_custom-orica-mechanics.md` §4（qa-029〜035, A）。
 * - メインステップにコスト（C2=カウント消費 + 独自軽減）を払い、魂状態 host へセット。
 * - スロット上限は host が `quartzHostData` で定義（ENIGMA=左右3+中央1=7）。同名2枚以上不可。
 * - セット中カードは魂状態として扱う（owner の soulStateInstanceIds に入る）。
 * - host 移動でクォーツも同じ場所へ追従＝セット解除（`releaseQuartzOnHostLeave`）。
 * - 属性値（地/火/水/風/時/空/幻）はセット中合計で host の【アーツ】解放条件を満たすための数値軸。
 *
 * この層はコスト支払い・legal action・GUI を含まない状態遷移プリミティブ（F2.1）。
 * セットアクション/コスト/位置選択は F2.2、host 得て発揮/アーツゲートは F2.3 で配線する。
 */
import type {
  ActiveStack,
  CardDefinition,
  CardInstance,
  EffectResolutionActionKind,
  GameState,
  QuartzAttribute,
  QuartzSetState,
  Zone,
} from "../model";
import {
  getQuartzSetStatesByHost,
  shrinkProtectedCounts,
  withCount,
} from "../model";
import type { SetQuartzActionResult } from "../legal/legal-actions-types";
import { getCardById } from "../card/card-lookup";
import { moveCardZone, updateCard } from "../core/core-system";
import { applyFaceDownPolicyOnZoneChange } from "../zone/face-down-policy";
import { recordHandExchange } from "../zone/hand-increase";
import { createCardInstance, getDefaultZoneRoleName } from "../factories";
import { collectAndQueueTriggerReactions } from "../effect/trigger-system";
import { getBurstPostResolutionDestination } from "./burst-system";

export type QuartzSlot = QuartzSetState["slot"];
const ALL_SLOTS: QuartzSlot[] = ["left", "center", "right"];
type GetCardDef = (id: string) => CardDefinition | undefined;

export interface QuartzSetSourceContext {
  sourceInstanceId: string;
  effectActionKind?: EffectResolutionActionKind | undefined;
  burstPostResolutionDestination?: "burst" | "trash" | undefined;
}

/** 手札セットのB類推と、バーストからの交換についてのユーザー裁定を分離する。 */
function getQuartzReplacementDestination(
  state: GameState,
  quartzInstanceId: string,
  getDef: GetCardDef,
  context?: QuartzSetSourceContext
): Zone {
  const card = getCardById(state, quartzInstanceId)!;
  // A burst can already have been cleaned up when its input continuation
  // resumes. Preserve that origin through the existing effectActionKind.
  const isBurstSource =
    card.zone === "burst" ||
    (context?.effectActionKind === "burst_activation" &&
      context.sourceInstanceId === quartzInstanceId);
  if (!isBurstSource) return "hand";
  if (
    context?.sourceInstanceId === quartzInstanceId &&
    context.burstPostResolutionDestination !== undefined
  ) {
    return context.burstPostResolutionDestination;
  }
  return getBurstPostResolutionDestination(getDef(card.definitionId)!);
}

/** クォーツ属性値の全軸（qa-033）。「属性値のいずれか1種」型の判定で各軸を個別集計する用途（BSLH01-X10）。 */
export const QUARTZ_ATTRIBUTES: QuartzAttribute[] = [
  "地",
  "火",
  "水",
  "風",
  "時",
  "空",
  "幻",
];

/**
 * クォーツ効果ヘッダー行のマーカー（例:「【クォーツ：金牛珠｜コストC2｜属性値：<空>5
 * （手札から対象にセットできる）】」）。【セット中】表記の無いクォーツ効果は、
 * `inheritsSetQuartzEffects` を持つ host 経由でのみ発揮する（qa-030、
 * 07_custom-orica-mechanics.md §4）。requiredSourceRole:"quartz_inherited" 推論の SSOT
 * (structured-effect-registrations.ts の inferRequiredQuartzInheritedSourceRole と
 * trigger-system.ts の getQuartzInheritedTriggeredSourceEntries が共有する、
 * star-garment-utils.ts の isTextRoleUnderHeaderLine と同型パターン)。
 */
export function isQuartzSetHeaderLine(line: string): boolean {
  return line.startsWith("【クォーツ：");
}

/**
 * クォーツ host 継承発揮 (requiredSourceRole:"quartz_inherited") のソースが、解決時点でも
 * host に有効にセットされ続けているか（star-garment-utils.ts の
 * isActiveTextRoleUnderEffectSource と同型の SSOT、stack/battle-immediate/card-effect の
 * 3 解決経路が共有する。effect-source-not-star-garment-under fizzle チェックの quartz 版）。
 */
export function isActiveQuartzInheritedEffectSource(options: {
  state: GameState;
  hostCard: CardInstance;
  hostDefinition: CardDefinition;
  effectSourceInstanceId: string;
  effectSourceDefinitionId?: string;
}): boolean {
  if (
    options.hostDefinition.quartzHostData?.inheritsSetQuartzEffects !== true
  ) {
    return false;
  }
  if (options.hostCard.zone !== "field" || options.hostCard.faceDown) {
    return false;
  }

  const quartzCard = getCardById(options.state, options.effectSourceInstanceId);
  if (!quartzCard) return false;
  if (quartzCard.zone !== "field" || quartzCard.faceDown) return false;
  if (
    options.effectSourceDefinitionId !== undefined &&
    quartzCard.definitionId !== options.effectSourceDefinitionId
  ) {
    return false;
  }

  return getQuartzSetStatesByHost(
    options.state,
    options.hostCard.instanceId
  ).some((q) => q.quartzInstanceId === options.effectSourceInstanceId);
}

/**
 * クォーツ card instance が、現在有効な host (`inheritsSetQuartzEffects:true`) にセットされ
 * 発揮元が host へ継承されているか。true のとき、この quartz 自身の「【クォーツ：...】」
 * ヘッダー効果 (`isQuartzSetHeaderLine`) はカード自身のネイティブ継続効果としては登録しない
 * (host 側の外部 source entry, continuous-effect-rebuild.ts の
 * quartzInheritedContinuousEffectEntries から発揮する。二重登録防止、qa-030)。
 * host 判定は `isActiveQuartzInheritedEffectSource` に委譲する SSOT。
 */
export function isQuartzInstanceInheritedByActiveHost(
  state: GameState,
  quartzInstanceId: string,
  getDef: GetCardDef
): boolean {
  const setState = state.quartzSetStates.find(
    (q) => q.quartzInstanceId === quartzInstanceId
  );
  if (!setState) return false;
  const hostCard = getCardById(state, setState.hostInstanceId);
  if (!hostCard) return false;
  const hostDefinition = getDef(hostCard.definitionId);
  if (!hostDefinition) return false;
  return isActiveQuartzInheritedEffectSource({
    state,
    hostCard,
    hostDefinition,
    effectSourceInstanceId: quartzInstanceId,
  });
}

/** カードが魂状態か（いずれかのプレイヤーの soulStateInstanceIds に在るか）。 */
function isInSoulState(state: GameState, instanceId: string): boolean {
  return state.players.some((p) => p.soulStateInstanceIds.includes(instanceId));
}

/** クォーツ名（双魚珠 等）。quartzData を持たなければ null。 */
export function getQuartzName(
  state: GameState,
  quartzInstanceId: string,
  getDef: GetCardDef
): string | null {
  const card = getCardById(state, quartzInstanceId);
  if (!card) return null;
  return getDef(card.definitionId)?.quartzData?.quartzName ?? null;
}

/** host にセット中のクォーツをスロット別に数える。 */
export function getQuartzSlotCounts(
  state: GameState,
  hostInstanceId: string
): Record<QuartzSlot, number> {
  const counts: Record<QuartzSlot, number> = { left: 0, center: 0, right: 0 };
  for (const q of getQuartzSetStatesByHost(state, hostInstanceId)) {
    counts[q.slot]++;
  }
  return counts;
}

export interface QuartzSetValidation {
  ok: boolean;
  /** ok=false のときの理由コード。 */
  reason?:
    | "host_not_found"
    | "host_not_soul_state"
    | "host_not_quartz_host"
    | "quartz_not_found"
    | "not_a_quartz"
    | "already_set"
    | "replacement_unavailable"
    | "replacement_prohibited"
    | "slot_full"
    | "duplicate_name";
}

/**
 * クォーツを host の指定スロットにセットできるか検証する（qa-029 異名 / スロット上限 / 魂状態）。
 * コスト支払い可否（カウント）は呼び出し側（F2.2）の責務。
 */
export function canSetQuartz(
  state: GameState,
  quartzInstanceId: string,
  hostInstanceId: string,
  slot: QuartzSlot,
  getDef: GetCardDef,
  replacedQuartzInstanceId?: string
): QuartzSetValidation {
  const host = getCardById(state, hostInstanceId);
  if (!host) return { ok: false, reason: "host_not_found" };
  const hostDef = getDef(host.definitionId);
  if (!hostDef?.quartzHostData)
    return { ok: false, reason: "host_not_quartz_host" };
  // ENIGMA へのセットは魂状態を対象とする必要がある（qa, §4）。
  if (
    host.zone !== "field" ||
    host.faceDown ||
    !isInSoulState(state, hostInstanceId)
  )
    return { ok: false, reason: "host_not_soul_state" };

  const quartz = getCardById(state, quartzInstanceId);
  if (!quartz) return { ok: false, reason: "quartz_not_found" };
  const quartzName = getQuartzName(state, quartzInstanceId, getDef);
  if (!quartzName) return { ok: false, reason: "not_a_quartz" };

  // A card instance can occupy only one quartz slot. This also makes stale or
  // replayed action payloads fail before they append a duplicate binding.
  if (
    state.quartzSetStates.some(
      (setState) => setState.quartzInstanceId === quartzInstanceId
    )
  ) {
    return { ok: false, reason: "already_set" };
  }

  const replaced =
    replacedQuartzInstanceId === undefined
      ? undefined
      : state.quartzSetStates.find(
          (q) => q.quartzInstanceId === replacedQuartzInstanceId
        );
  if (
    replacedQuartzInstanceId !== undefined &&
    (!replaced ||
      replaced.hostInstanceId !== hostInstanceId ||
      replaced.slot !== slot ||
      getCardById(state, replacedQuartzInstanceId)?.zone !== "field")
  ) {
    return { ok: false, reason: "replacement_unavailable" };
  }

  if (replaced) {
    const oldCard = getCardById(state, replaced.quartzInstanceId)!;
    if (
      getDef(
        oldCard.definitionId
      )?.quartzData?.replacementProhibitedFromZones?.includes(quartz.zone)
    ) {
      return { ok: false, reason: "replacement_prohibited" };
    }
  }

  // qa-029: 既セット位置へのセットは、その1枚と入れ替えられる。
  const counts = getQuartzSlotCounts(state, hostInstanceId);
  if (counts[slot] - (replaced ? 1 : 0) >= hostDef.quartzHostData.slots[slot])
    return { ok: false, reason: "slot_full" };

  // 異名: 同名クォーツが既にセット中なら不可（qa-029）。
  for (const q of getQuartzSetStatesByHost(state, hostInstanceId)) {
    if (q.quartzInstanceId === replacedQuartzInstanceId) continue;
    if (getQuartzName(state, q.quartzInstanceId, getDef) === quartzName)
      return { ok: false, reason: "duplicate_name" };
  }
  return { ok: true };
}

export interface QuartzPlacement {
  hostInstanceId: string;
  slot: QuartzSlot;
  replacedQuartzInstanceId?: string;
}

/** 通常セットと効果セットで共有する、空き位置・入れ替え先の候補。 */
export function getQuartzPlacements(
  state: GameState,
  actingPlayerId: string,
  quartzInstanceId: string,
  getDef: GetCardDef
): QuartzPlacement[] {
  const placements: QuartzPlacement[] = [];
  for (const host of getEligibleQuartzHosts(state, actingPlayerId, getDef)) {
    for (const slot of ALL_SLOTS) {
      const replacements: (string | undefined)[] = [
        undefined,
        ...getQuartzSetStatesByHost(state, host.instanceId)
          .filter((q) => q.slot === slot)
          .map((q) => q.quartzInstanceId),
      ];
      for (const replacedQuartzInstanceId of replacements) {
        if (
          canSetQuartz(
            state,
            quartzInstanceId,
            host.instanceId,
            slot,
            getDef,
            replacedQuartzInstanceId
          ).ok
        ) {
          placements.push({
            hostInstanceId: host.instanceId,
            slot,
            ...(replacedQuartzInstanceId !== undefined
              ? { replacedQuartzInstanceId }
              : {}),
          });
        }
      }
    }
  }
  return placements;
}

/**
 * クォーツを host にセットする状態遷移（コスト支払いは含まない）。
 * カードを手札等から field("quartz" role)へ移し、QuartzSetState を追加、
 * owner の soulStateInstanceIds に加える（セット中=魂状態）。検証 NG なら null。
 */
export function setQuartz(
  state: GameState,
  params: {
    quartzInstanceId: string;
    hostInstanceId: string;
    ownerPlayerId: string;
    slot: QuartzSlot;
    replacedQuartzInstanceId?: string;
    sourceContext?: QuartzSetSourceContext;
  },
  getDef: GetCardDef
): GameState | null {
  const { quartzInstanceId, hostInstanceId, ownerPlayerId, slot } = params;
  const validation = canSetQuartz(
    state,
    quartzInstanceId,
    hostInstanceId,
    slot,
    getDef,
    params.replacedQuartzInstanceId
  );
  if (!validation.ok) return null;

  // クォーツカードを field の "quartz" role へ。コアは持たない（魂状態）。
  const replacedId = params.replacedQuartzInstanceId;
  let next = state;
  if (replacedId !== undefined) {
    const destination = getQuartzReplacementDestination(
      state,
      quartzInstanceId,
      getDef,
      params.sourceContext
    );
    next = moveCardZone(
      next,
      replacedId,
      requireCardZone(destination),
      getDefaultZoneRoleName(
        getDef(getCardById(next, replacedId)!.definitionId)!,
        destination
      )
    );
    if (destination === "hand")
      next = recordHandExchange(state, next, new Set([replacedId]));
    next = {
      ...next,
      quartzSetStates: next.quartzSetStates.filter(
        (q) => q.quartzInstanceId !== replacedId
      ),
      players: next.players.map((p) => ({
        ...p,
        soulStateInstanceIds: p.soulStateInstanceIds.filter(
          (id) => id !== replacedId
        ),
      })),
    };
  }
  next = moveCardZone(next, quartzInstanceId, "field", "quartz");
  next = updateCard(next, quartzInstanceId, (c) => ({
    ...c,
    normalCoreCount: 0,
  }));

  const setState: QuartzSetState = {
    quartzInstanceId,
    hostInstanceId,
    ownerPlayerId,
    slot,
  };
  next.log.push(
    `effect:quartz_set:${quartzInstanceId}->${hostInstanceId}:${slot}`
  );

  return advanceSoulStateGeneration(
    state,
    {
      ...next,
      quartzSetStates:
        replacedId === undefined
          ? [...next.quartzSetStates, setState]
          : state.quartzSetStates.map((q) =>
              q.quartzInstanceId === replacedId ? setState : q
            ),
      players: next.players.map((p) => {
        if (p.id !== ownerPlayerId) return p;
        if (p.soulStateInstanceIds.includes(quartzInstanceId)) return p;
        return {
          ...p,
          soulStateInstanceIds: [...p.soulStateInstanceIds, quartzInstanceId],
        };
      }),
    },
    getDef
  );
}

/**
 * host がフィールドを離れるとき、セット中クォーツを destZone へ追従移動しセット解除する。
 * QuartzSetState と owner の soulStateInstanceIds から除去し、face-down policy を適用する。
 * host 自身の移動は呼び出し側が行う。
 */
export function releaseQuartzOnHostLeave(
  state: GameState,
  hostInstanceId: string,
  destZone: Zone
): GameState {
  const setStates = getQuartzSetStatesByHost(state, hostInstanceId);
  if (setStates.length === 0) return state;

  const quartzIds = new Set(setStates.map((q) => q.quartzInstanceId));
  state.log.push(
    `effect:quartz_release:${[...quartzIds].join(",")}:host=${hostInstanceId}`
  );

  return replaceCardInstances(
    {
      ...state,
      quartzSetStates: state.quartzSetStates.filter(
        (q) => q.hostInstanceId !== hostInstanceId
      ),
      players: state.players.map((p) => ({
        ...p,
        soulStateInstanceIds: p.soulStateInstanceIds.filter(
          (id) => !quartzIds.has(id)
        ),
      })),
    },
    state.cardInstances.map((c) => {
      if (!quartzIds.has(c.instanceId)) return c;
      const definitionId =
        c.definitionId !== c.originalDefinitionId
          ? c.originalDefinitionId
          : c.definitionId;
      return applyFaceDownPolicyOnZoneChange(
        {
          ...c,
          definitionId,
          zone: destZone,
          normalCoreCount: 0,
          attachedToInstanceId: null,
          attachedChildrenIds: [],
        },
        destZone
      );
    })
  );
}

/** actingPlayer がクォーツをセットできる host（field・魂状態・quartzHostData 持ち）一覧。 */
export function getEligibleQuartzHosts(
  state: GameState,
  actingPlayerId: string,
  getDef: GetCardDef
): CardInstance[] {
  return state.cardInstances.filter((c) => {
    if (c.zone !== "field") return false;
    if (c.controllerPlayerId !== actingPlayerId) return false;
    if (!getDef(c.definitionId)?.quartzHostData) return false;
    return isInSoulState(state, c.instanceId);
  });
}

/** actingPlayer がカウントコストを支払えるか。 */
export function canPayQuartzCountCost(
  state: GameState,
  actingPlayerId: string,
  countCost: number
): boolean {
  const player = state.players.find((p) => p.id === actingPlayerId);
  return !!player && player.countValue >= countCost;
}

function getQuartzCountCost(
  state: GameState,
  quartzInstanceId: string,
  getDef: GetCardDef
): number {
  const quartz = getCardById(state, quartzInstanceId);
  return quartz ? (getDef(quartz.definitionId)?.quartzData?.countCost ?? 0) : 0;
}

/**
 * プレイヤー主導の set_quartz action は、そのプレイヤーが control する手札の
 * クォーツだけを宣言できる。効果駆動 quartz_set はカード本文ごとの対象 zone を
 * 許すため、この action 境界にだけ置く。
 */
function assertPlayerQuartzSetActionSource(options: {
  state: GameState;
  actingPlayerId: string;
  quartzInstanceId: string;
}): CardInstance {
  const quartz = getCardById(options.state, options.quartzInstanceId);
  if (
    !quartz ||
    quartz.zone !== "hand" ||
    quartz.controllerPlayerId !== options.actingPlayerId ||
    quartz.pendingLeaveKind !== null
  ) {
    throw new Error(
      `Cannot set quartz: source_unavailable: quartz=${options.quartzInstanceId}`
    );
  }
  return quartz;
}

export function paySetQuartzCountCostAsAction(options: {
  state: GameState;
  actingPlayerId: string;
  quartzInstanceId: string;
  hostInstanceId: string;
  slot: QuartzSlot;
  replacedQuartzInstanceId?: string;
  getCardDefinitionById: GetCardDef;
}): { state: GameState; countCost: number } {
  const { state, actingPlayerId, quartzInstanceId, hostInstanceId, slot } =
    options;
  const getDef = options.getCardDefinitionById;
  const validation = canSetQuartz(
    state,
    quartzInstanceId,
    hostInstanceId,
    slot,
    getDef,
    options.replacedQuartzInstanceId
  );
  if (!validation.ok) {
    throw new Error(
      `Cannot set quartz: ${validation.reason}: quartz=${quartzInstanceId} host=${hostInstanceId} slot=${slot}`
    );
  }

  const countCost = getQuartzCountCost(state, quartzInstanceId, getDef);
  if (!canPayQuartzCountCost(state, actingPlayerId, countCost)) {
    throw new Error(
      `Cannot set quartz: count_unaffordable (need ${countCost}): ${quartzInstanceId}`
    );
  }

  return {
    countCost,
    state: {
      ...state,
      log: [
        ...state.log,
        `quartz:cost-paid:${actingPlayerId}:${countCost}:${quartzInstanceId}`,
      ],
      players: state.players.map((p) =>
        p.id === actingPlayerId
          ? withCount(
              p,
              p.countValue - countCost,
              shrinkProtectedCounts(p.protectedCounts, p.countValue - countCost)
            )
          : p
      ),
    },
  };
}

export function resolveSetQuartzPlacementAsAction(options: {
  state: GameState;
  actingPlayerId: string;
  quartzInstanceId: string;
  hostInstanceId: string;
  slot: QuartzSlot;
  replacedQuartzInstanceId?: string;
  sourceContext?: QuartzSetSourceContext;
  getCardDefinitionById: GetCardDef;
}): SetQuartzActionResult {
  const { state, actingPlayerId, quartzInstanceId, hostInstanceId, slot } =
    options;
  const getDef = options.getCardDefinitionById;
  const validation = canSetQuartz(
    state,
    quartzInstanceId,
    hostInstanceId,
    slot,
    getDef,
    options.replacedQuartzInstanceId
  );
  if (!validation.ok) {
    throw new Error(
      `Cannot set quartz: ${validation.reason}: quartz=${quartzInstanceId} host=${hostInstanceId} slot=${slot}`
    );
  }
  const result = setQuartz(
    state,
    {
      quartzInstanceId,
      hostInstanceId,
      ownerPlayerId: actingPlayerId,
      slot,
      ...(options.replacedQuartzInstanceId !== undefined
        ? { replacedQuartzInstanceId: options.replacedQuartzInstanceId }
        : {}),
      ...(options.sourceContext
        ? { sourceContext: options.sourceContext }
        : {}),
    },
    getDef
  );
  if (result === null) {
    throw new Error(
      `setQuartz returned null unexpectedly: ${quartzInstanceId}`
    );
  }
  return { state: result, quartzInstanceId, hostInstanceId, slot };
}

export function useSetQuartzInStackContextAsAction(options: {
  state: GameState;
  actingPlayerId: string;
  quartzInstanceId: string;
  hostInstanceId: string;
  slot: QuartzSlot;
  replacedQuartzInstanceId?: string;
  getCardDefinitionById: GetCardDef;
}): { state: GameState; activeStack: ActiveStack } {
  const quartz = assertPlayerQuartzSetActionSource(options);
  const { state } = paySetQuartzCountCostAsAction(options);
  const chainId = `quartz_set:${options.quartzInstanceId}`;
  return {
    state,
    activeStack: {
      stackId: `stack:${chainId}`,
      actionKind: "set_quartz",
      chainId,
      actingPlayerId: options.actingPlayerId,
      cardInstanceId: options.quartzInstanceId,
      cardDefinitionId: quartz.definitionId,
      targetInstanceIds: [options.hostInstanceId],
      targetEffectFilterTags: ["general"],
      sourceActivationZone: "hand",
      quartzHostInstanceId: options.hostInstanceId,
      quartzSlot: options.slot,
      ...(options.replacedQuartzInstanceId !== undefined
        ? { replacedQuartzInstanceId: options.replacedQuartzInstanceId }
        : {}),
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    },
  };
}

export function resolveDeferredSetQuartzStack(options: {
  state: GameState;
  activeStack: ActiveStack;
  getCardDefinitionById: GetCardDef;
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
}): GameState {
  const { state, activeStack } = options;
  if (activeStack.isNullified) {
    return {
      ...state,
      log: [
        ...state.log,
        `quartz:nullified:${activeStack.chainId}:${activeStack.cardInstanceId}`,
      ],
    };
  }
  const quartz = getCardById(state, activeStack.cardInstanceId);
  if (
    !quartz ||
    quartz.zone !== activeStack.sourceActivationZone ||
    quartz.controllerPlayerId !== activeStack.actingPlayerId ||
    quartz.pendingLeaveKind !== null ||
    !activeStack.quartzHostInstanceId ||
    !activeStack.quartzSlot
  ) {
    return {
      ...state,
      log: [
        ...state.log,
        `quartz:effect-fizzled:${activeStack.chainId}:source-unavailable`,
      ],
    };
  }

  const validation = canSetQuartz(
    state,
    activeStack.cardInstanceId,
    activeStack.quartzHostInstanceId,
    activeStack.quartzSlot,
    options.getCardDefinitionById,
    activeStack.replacedQuartzInstanceId
  );
  if (!validation.ok) {
    return {
      ...state,
      log: [
        ...state.log,
        `quartz:effect-fizzled:${activeStack.chainId}:${validation.reason}`,
      ],
    };
  }

  const beforeQuartzState = state;
  const quartzResult = resolveSetQuartzPlacementAsAction({
    state: beforeQuartzState,
    actingPlayerId: activeStack.actingPlayerId,
    quartzInstanceId: activeStack.cardInstanceId,
    hostInstanceId: activeStack.quartzHostInstanceId,
    slot: activeStack.quartzSlot,
    ...(activeStack.replacedQuartzInstanceId !== undefined
      ? { replacedQuartzInstanceId: activeStack.replacedQuartzInstanceId }
      : {}),
    getCardDefinitionById: options.getCardDefinitionById,
  });
  return collectAndQueueTriggerReactions({
    beforeState: beforeQuartzState,
    afterState: quartzResult.state,
    source: "action_resolution",
    chainId: activeStack.chainId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    causedByPlayerId: activeStack.actingPlayerId,
    causedBySourceInstanceId: activeStack.cardInstanceId,
  });
}

/**
 * クォーツセットをアクションとして実行する（F2.2）。
 * 検証 → カウントコスト支払い → setQuartz。NG なら例外。
 * 注: コア cost（quartzData.cost>0）は現状未配線（実カードは countCost のみ）。
 */
export function useSetQuartzAsAction(options: {
  state: GameState;
  actingPlayerId: string;
  quartzInstanceId: string;
  hostInstanceId: string;
  slot: QuartzSlot;
  replacedQuartzInstanceId?: string;
  getCardDefinitionById: GetCardDef;
}): SetQuartzActionResult {
  assertPlayerQuartzSetActionSource(options);
  const { state } = paySetQuartzCountCostAsAction(options);
  return resolveSetQuartzPlacementAsAction({ ...options, state });
}

export { ALL_SLOTS as QUARTZ_SLOTS };

/** 効果セットも通常セットと同じ候補・検証・支払い・入れ替えを使う（qa-029/035）。 */
export function useQuartzSetAsEffect(options: {
  state: GameState;
  actingPlayerId: string;
  quartzInstanceId: string;
  getCardDefinitionById: GetCardDef;
  free?: boolean;
  placement?: QuartzPlacement;
  sourceContext?: QuartzSetSourceContext;
}): { state: GameState; hostInstanceId?: string } {
  const { state, actingPlayerId, quartzInstanceId, free } = options;
  const getDef = options.getCardDefinitionById;
  const placement =
    options.placement ??
    getQuartzPlacements(state, actingPlayerId, quartzInstanceId, getDef)[0];
  if (
    !placement ||
    !getEligibleQuartzHosts(state, actingPlayerId, getDef).some(
      (h) => h.instanceId === placement.hostInstanceId
    ) ||
    !canSetQuartz(
      state,
      quartzInstanceId,
      placement.hostInstanceId,
      placement.slot,
      getDef,
      placement.replacedQuartzInstanceId
    ).ok ||
    (!free &&
      !canPayQuartzCountCost(
        state,
        actingPlayerId,
        getQuartzCountCost(state, quartzInstanceId, getDef)
      ))
  ) {
    return {
      state: {
        ...state,
        log: [
          ...state.log,
          `effect:quartz_set:unavailable:${quartzInstanceId}`,
        ],
      },
    };
  }
  const params = {
    state,
    actingPlayerId,
    quartzInstanceId,
    ...placement,
    ...(options.sourceContext ? { sourceContext: options.sourceContext } : {}),
    getCardDefinitionById: getDef,
  };
  const paidState = free ? state : paySetQuartzCountCostAsAction(params).state;
  const result = resolveSetQuartzPlacementAsAction({
    ...params,
    state: paidState,
  });
  return { state: result.state, hostInstanceId: placement.hostInstanceId };
}

/**
 * actingPlayerId が既にフィールドに持つ、指定 cardNo のトークン枚数
 * （【アーツ】自己配置の maxTokenDeckCount 上限判定用、F2.4b⑤）。
 */
export function getArtsTokenInPlayCount(
  state: GameState,
  actingPlayerId: string,
  tokenCardNo: string
): number {
  return state.cardInstances.filter(
    (c) =>
      c.definitionId === tokenCardNo &&
      c.ownerPlayerId === actingPlayerId &&
      c.zone === "field"
  ).length;
}

/**
 * 【アーツ】自己配置トークンの状態遷移（F2.4b⑤、qa-033 派生）。継続ゲート条件
 * （`continuousSummonCondition` + `summonCondition`）の判定は状態ベース処理
 * （state-based-actions.ts）の責務。ここは無条件にフィールドへ配置する。
 * コアは持たない（ENIGMA host 同様 BP/Lv 不在の magic トークン）。
 */
export function placeArtsToken(
  state: GameState,
  actingPlayerId: string,
  tokenDef: CardDefinition
): GameState {
  const newInstance = createCardInstance(tokenDef, {
    ownerPlayerId: actingPlayerId,
    controllerPlayerId: actingPlayerId,
    zone: "field",
    zoneRoleName: "arts",
    normalCoreCount: 0,
  });
  return replaceCardInstances(
    {
      ...state,
      log: [
        ...state.log,
        `effect:arts_place:${actingPlayerId}:${tokenDef.cardNo}:${newInstance.instanceId}`,
      ],
    },
    [...state.cardInstances, newInstance]
  );
}

/**
 * host にセット中クォーツの指定属性値の合計（【アーツ】解放条件評価用、qa-033）。
 */
export function getQuartzAttributeSum(
  state: GameState,
  hostInstanceId: string,
  attr: QuartzAttribute,
  getDef: GetCardDef
): number {
  let sum = 0;
  for (const q of getQuartzSetStatesByHost(state, hostInstanceId)) {
    const card = getCardById(state, q.quartzInstanceId);
    if (!card) continue;
    const values = getDef(card.definitionId)?.quartzData?.attributeValues;
    sum += values?.[attr] ?? 0;
  }
  return sum;
}
