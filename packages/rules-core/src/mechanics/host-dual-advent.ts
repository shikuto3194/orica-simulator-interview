import { isInHandForOwnEffect } from "../effect/card-access-rules";
/**
 * host 側 (被煌臨側) が2枚の occupant を並行/分岐で保持するシステム (BSDB01-CX01
 * 【真バディ】)。裁定確定 (2026-07-13、issues/P3-117): 1宣言=1体。孫悟空名カード・
 * ベジータ名カードはそれぞれ**別々の宣言**で host へ契約煌臨し、host は2枚の occupant を
 * host→A、host→B の分岐 (host→A→B の直列チェーンではない) で保持する。
 *
 * 通常の煌臨 (advent-system.ts) は「煌臨する側」が AdventData を持ち、host 側は
 * adventCondition を満たすだけの受動的存在。本モジュールはその逆で、host 側
 * CardDefinition.hostDualAdventGrant が「手札カード1枚を自身へ重ねられる」許可を
 * 手札の煌臨宣言に付与する。実行は advent-system.ts の executeAdvent を **1回だけ** host を
 * target として呼ぶ SSOT 再利用 (2回連続実行するチェーン構築は行わない)。
 *
 * 各スロットの充足状況は専用フィールドを持たず、既存の `underCards` (煌臨元表現) を
 * 都度走査して導出する (getHostDualAdventOpenSlotIndices)。host は zone:'field' の
 * まま複数の occupant から独立に advent_source として参照されうるため、host を
 * 2度 (スロットごとに1回) target に選んでも互いに干渉しない。
 */
import type {
  ActiveStack,
  CardDefinition,
  CardInstance,
  GameState,
  HostDualAdventGrant,
  PendingAsIfSoulCoreChoiceOption,
} from "../model";
import { adventSourceIdsOf, collectUnderCardScopeIds } from "../model";
import { collectAndQueueTriggerReactions } from "../effect/trigger-system";
import { buildChargeCoresPendingCoreDistribution } from "./core-charge-distribution";
import type { DeferredStackResolverOptions } from "../legal/stack-resolution-types";
import { getCardById } from "../card/card-lookup";
import { matchesCardName } from "../card/card-filter";
import {
  isCardUseRestricted,
  isAdventRestricted,
  isFlashRestricted,
} from "../legal/legal-actions-shared";
import { evaluateCondition } from "../effect/structured-condition-eval";
import { hasCannotAdventRestriction } from "./act-as-spirit";
import {
  adventTimingWindowAllowed,
  canAdventTargetSurvivePayment,
  executeAdvent,
  getAdventDeclareUsageKey,
  matchesAdventCondition,
  hasSoulCoreAvailable,
} from "./advent-system";

/**
 * host が hostDualAdventGrant を発動できる状態か (通常フィールド現在面 / 魂状態 /
 * 他カードの煌臨元) を判定する。「魂状態/煌臨元を含むこのカード」= 08a 名前参照の
 * 包含スコープ裁定 (通常フィールド ∪ 魂状態 ∪ 煌臨元) と同じ3状態。
 */
export function isHostDualAdventGrantUsable(
  state: GameState,
  hostInstanceId: string,
  actingPlayerId: string,
  useAlternateCost = false
): boolean {
  // 「（分身スピリットは、煌臨できず…）」制約 (BSAZ02-C07) は「煌臨先として使われる」
  // 側 (host) に対する restriction。advent-system.ts の matchesAdventCondition (targetCard
  // 側) / getContractAdventTargets (魂状態 host 候補) と同じ意味論で host 側に検査する
  // (verifier round1 lens3 指摘: 手札カード側への誤適用を修正)。
  if (hasCannotAdventRestriction(state, hostInstanceId)) return false;
  const player = state.players.find((p) => p.id === actingPlayerId);
  if (!player) return false;
  if (player.soulStateInstanceIds.includes(hostInstanceId)) {
    return true;
  }
  const host = getCardById(state, hostInstanceId);
  if (!host) return false;
  if (host.zone !== "field") return false;
  if (host.controllerPlayerId !== actingPlayerId) return false;
  // 「置いたものとして」ならコアは残る。共通煌臨処理と同じ支払い方法で判定する。
  if (!canAdventTargetSurvivePayment(state, host, useAlternateCost)) {
    return false;
  }
  // 通常フィールド現在面、または他カードの underCards role='advent_source' として
  // 煌臨元になっている (zone は 'field' のまま、underCards 参照の有無に関わらず有効)。
  return true;
}

/**
 * 手札カード定義がスロット条件 (cardNames) を満たすか判定する。
 */
function matchesSlot(
  handDef: CardDefinition,
  slot: HostDualAdventGrant["slots"][number]
): boolean {
  return matchesCardName(handDef.name, [...slot.cardNames], undefined);
}

/**
 * host を advent_source として直接参照している (host が occupant の煌臨元スタックの
 * 一員である) 現存フィールドカードの instanceId 一覧を返す。`underCards` は各カードが
 * 自分の下に何が埋まっているかを表す SSOT (adventSourceIdsOf) であり、この一覧を
 * 逆引きするための専用フィールドは持たない。さらに occupant の上へ (CX01 と無関係な)
 * 通常の煌臨が重ねられた場合も、後続 top の `adventSourceIdsOf` は自分の祖先を
 * フラット化して保持するため、host を祖先に持つ occupant を depth に関わらず検出できる。
 */
function getHostDualAdventOccupantCardIds(
  state: GameState,
  hostInstanceId: string
): string[] {
  const occupantIds = new Set<string>();
  for (const card of state.cardInstances) {
    if (card.instanceId === hostInstanceId) continue;
    const tower = adventSourceIdsOf(card);
    if (!tower.includes(hostInstanceId)) continue;
    // card 自身が host を祖先に持つ top (または途中の踏み台) なので occupant に含める。
    occupantIds.add(card.instanceId);
    for (const id of tower) {
      if (id !== hostInstanceId) occupantIds.add(id);
    }
  }
  return [...occupantIds];
}

/**
 * grant.slots のうち、現在 host に occupant が埋まっているスロットの index 集合を返す。
 * 埋まっている occupant のカード名が一致するスロット index のみ埋まっている扱いにする
 * (同じ名前のカードが2枚目以降で同じスロットを再度満たすことを防ぐ)。
 */
function getFilledSlotIndices(
  state: GameState,
  hostInstanceId: string,
  grant: HostDualAdventGrant,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): Set<number> {
  const filled = new Set<number>();
  for (const occupantId of getHostDualAdventOccupantCardIds(
    state,
    hostInstanceId
  )) {
    const occupantCard = getCardById(state, occupantId);
    if (!occupantCard) continue;
    const occupantDef = getCardDefinitionById(occupantCard.definitionId);
    if (!occupantDef) continue;
    grant.slots.forEach((slot, index) => {
      if (matchesSlot(occupantDef, slot)) filled.add(index);
    });
  }
  return filled;
}

/**
 * grant.slots のうち、まだ occupant が埋まっていないスロットの index 集合を返す。
 */
export function getHostDualAdventOpenSlotIndices(
  state: GameState,
  hostInstanceId: string,
  grant: HostDualAdventGrant,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): Set<number> {
  const filled = getFilledSlotIndices(
    state,
    hostInstanceId,
    grant,
    getCardDefinitionById
  );
  const open = new Set<number>();
  grant.slots.forEach((_, index) => {
    if (!filled.has(index)) open.add(index);
  });
  return open;
}

/** 効果内の「隣に煌臨」: 共有煌臨元の反対側。占有中ならその側の現在面へ重ねる (08a6)。 */
export function getAdjacentAdventDestination(
  state: GameState,
  sourceInstanceId: string,
  incomingDefinition: CardDefinition,
  actingPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
):
  | { target: CardInstance; sharedHost: CardInstance; chargeCores: boolean }
  | undefined {
  const source = getCardById(state, sourceInstanceId);
  const sourceDef = source && getCardDefinitionById(source.definitionId);
  const buried = collectUnderCardScopeIds(state).adventSource;
  if (
    !source ||
    !sourceDef ||
    source.zone !== "field" ||
    source.controllerPlayerId !== actingPlayerId ||
    source.faceDown ||
    source.pendingLeaveKind !== null ||
    buried.has(sourceInstanceId)
  )
    return undefined;
  for (const hostId of adventSourceIdsOf(source)) {
    const sharedHost = getCardById(state, hostId);
    const hostDef =
      sharedHost && getCardDefinitionById(sharedHost.definitionId);
    const grant = hostDef?.hostDualAdventGrant;
    if (
      !sharedHost ||
      sharedHost.zone !== "field" ||
      sharedHost.controllerPlayerId !== actingPlayerId ||
      !grant?.includeSoulStateOrAdventSource
    )
      continue;
    const sourceSlots = grant.slots.filter((slot) =>
      matchesSlot(sourceDef, slot)
    );
    const targetSlot = grant.slots.find(
      (slot) =>
        matchesSlot(incomingDefinition, slot) && !sourceSlots.includes(slot)
    );
    if (sourceSlots.length === 0 || !targetSlot) continue;
    const occupants = getHostDualAdventOccupantCardIds(state, hostId);
    const target =
      occupants
        .map((id) => getCardById(state, id))
        .find((candidate) => {
          if (
            !candidate ||
            candidate.zone !== "field" ||
            buried.has(candidate.instanceId)
          )
            return false;
          const def = getCardDefinitionById(candidate.definitionId);
          return def !== undefined && matchesSlot(def, targetSlot);
        }) ?? sharedHost;
    if (
      target.controllerPlayerId !== actingPlayerId ||
      target.faceDown ||
      target.pendingLeaveKind !== null
    )
      return undefined;
    return {
      target,
      sharedHost,
      chargeCores:
        target === sharedHost && grant.hostCoreDistributionOnAdvent === true,
    };
  }
  return undefined;
}

/**
 * まだ埋まっていないスロットのいずれかを満たす自分の手札カードを列挙する
 * (単一選択の候補一覧。1宣言=1体、2枚を同時に選ぶ requiredTargetCount:2 UX は廃止)。
 */
export function getHostDualAdventCandidateHandCards(
  state: GameState,
  actingPlayerId: string,
  grant: HostDualAdventGrant,
  openSlotIndices: Set<number>,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): CardInstance[] {
  if (openSlotIndices.size === 0) return [];
  return state.cardInstances.filter((card) => {
    if (
      !isInHandForOwnEffect(state, card, actingPlayerId, getCardDefinitionById)
    )
      return false;
    if (card.controllerPlayerId !== actingPlayerId) return false;
    const def = getCardDefinitionById(card.definitionId);
    if (!def) return false;
    return grant.slots.some(
      (slot, index) => openSlotIndices.has(index) && matchesSlot(def, slot)
    );
  });
}

/** 常時の許可は独立して発揮せず、手札の煌臨宣言の支払い選択として使う。 */
export function getHostGrantedAdventChoiceOptions(
  state: GameState,
  sourceInstanceId: string,
  actingPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): PendingAsIfSoulCoreChoiceOption[] {
  const source = getCardById(state, sourceInstanceId);
  const definition = source && getCardDefinitionById(source.definitionId);
  if (
    !source ||
    !definition?.adventData ||
    !isInHandForOwnEffect(
      state,
      source,
      actingPlayerId,
      getCardDefinitionById
    ) ||
    source.controllerPlayerId !== actingPlayerId
  )
    return [];
  if (
    isAdventRestricted(state, actingPlayerId) ||
    isCardUseRestricted(
      state,
      actingPlayerId,
      source,
      definition,
      getCardDefinitionById,
      "advent"
    )
  )
    return [];
  const inBattleFlashWindow = state.activeAttack?.flashWindowState != null;
  if (inBattleFlashWindow && isFlashRestricted(state, actingPlayerId, "hand"))
    return [];
  const isActivePlayer = state.activePlayerId === actingPlayerId;
  const context = {
    sourceInMainTiming:
      state.step === "main" && isActivePlayer && !inBattleFlashWindow,
    sourceInFlashTiming: inBattleFlashWindow,
    inBattleFlashWindow,
    isActivePlayer,
  };
  if (
    definition.adventData?.declareCondition &&
    !evaluateCondition(
      state,
      definition.adventData.declareCondition,
      sourceInstanceId,
      actingPlayerId,
      getCardDefinitionById
    )
  )
    return [];
  // 常時許可は煌臨カード自身のタイミング指定を上書きしない。
  if (
    definition.adventData &&
    !adventTimingWindowAllowed(definition.adventData.adventTiming, context)
  )
    return [];
  const options: PendingAsIfSoulCoreChoiceOption[] = [];
  if ((definition.adventData.adventSourceZone ?? "hand") !== source.zone)
    return [];
  if (
    definition.adventData.declareUsageLimit?.kind === "per_card_name" &&
    definition.adventData.declareUsageLimit.duration === "turn" &&
    state.usedAdventDeclareKeysThisTurn.includes(
      getAdventDeclareUsageKey(definition)
    )
  )
    return [];
  for (const host of state.cardInstances) {
    if (
      host.zone !== "field" ||
      host.controllerPlayerId !== actingPlayerId ||
      host.faceDown ||
      host.pendingLeaveKind !== null
    )
      continue;
    const hostDefinition = getCardDefinitionById(host.definitionId);
    const grant = hostDefinition?.hostDualAdventGrant;
    if (!grant || !hostDefinition) continue;
    // 支払いの置換は、煌臨元の名前・コスト・系統などの印字条件を変更しない。
    if (
      !matchesAdventCondition(
        host,
        hostDefinition,
        definition.adventData.adventCondition,
        getCardDefinitionById,
        state
      )
    )
      continue;
    if (
      !grant.includeSoulStateOrAdventSource &&
      (state.players.some((p) =>
        p.soulStateInstanceIds.includes(host.instanceId)
      ) ||
        collectUnderCardScopeIds(state).adventSource.has(host.instanceId))
    )
      continue;
    const openSlots = getHostDualAdventOpenSlotIndices(
      state,
      host.instanceId,
      grant,
      getCardDefinitionById
    );
    if (
      !grant.slots.some(
        (slot, index) => openSlots.has(index) && matchesSlot(definition, slot)
      )
    )
      continue;
    for (const useAlternateCost of [false, true]) {
      if (
        !isHostDualAdventGrantUsable(
          state,
          host.instanceId,
          actingPlayerId,
          useAlternateCost
        )
      )
        continue;
      if (useAlternateCost) {
        if (
          !grant.alternateCost ||
          !adventTimingWindowAllowed(grant.alternateCost.timing, context)
        )
          continue;
        if (
          grant.alternateCost.turnLimitDisabled !== true &&
          state.usedAlternateCostAdventKeysThisTurn.includes(
            getAdventDeclareUsageKey(hostDefinition)
          )
        )
          continue;
      } else if (
        grant.normalPathDisabled ||
        !adventTimingWindowAllowed(grant.timing, context) ||
        !hasSoulCoreAvailable(state, actingPlayerId)
      )
        continue;
      options.push({
        choiceId: `host:${host.instanceId}:${useAlternateCost ? "alternate" : "normal"}`,
        label: useAlternateCost
          ? "置いたものとして煌臨"
          : "ソウルコアを置いて煌臨",
        useAlternateCost,
        proxySourceInstanceId: host.instanceId,
        proxySourceDefinitionId: host.definitionId,
        proxySourceCardNo: hostDefinition.cardNo,
      });
    }
  }
  return options;
}

/** 窓後も同じ許可・支払い経路が残ることを確認する。 */
export function getHostGrantedAdventTargets(
  state: GameState,
  stack: ActiveStack,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): CardInstance[] {
  const hostId = stack.adventGrantSourceInstanceId;
  const option = getHostGrantedAdventChoiceOptions(
    state,
    stack.cardInstanceId,
    stack.actingPlayerId,
    getCardDefinitionById
  ).find(
    (choice) =>
      choice.proxySourceInstanceId === hostId &&
      choice.useAlternateCost === (stack.adventUseAlternateCost === true)
  );
  const host = option && hostId ? getCardById(state, hostId) : undefined;
  return host ? [host] : [];
}

/** 共通の手札煌臨スタックから、既存の分岐配置処理へ渡す。 */
export function resolveDeferredHostGrantedAdventStack(
  state: GameState,
  stack: ActiveStack,
  options: DeferredStackResolverOptions
): GameState {
  const host = getHostGrantedAdventTargets(
    state,
    stack,
    options.getCardDefinitionById
  )[0];
  if (!host || stack.targetInstanceIds[0] !== host.instanceId) return state;
  return resolveDeferredHostDualAdventStack(
    state,
    {
      ...stack,
      cardInstanceId: host.instanceId,
      cardDefinitionId: host.definitionId,
      targetInstanceIds: [stack.cardInstanceId],
    },
    options
  );
}

export function getHostDualAdventAsIfSoulCoreChoiceOptions(
  state: GameState,
  stack: ActiveStack,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): PendingAsIfSoulCoreChoiceOption[] {
  if (stack.actionKind !== "declare_host_dual_advent") return [];
  const hostDef = getCardById(state, stack.cardInstanceId)
    ? getCardDefinitionById(stack.cardDefinitionId)
    : undefined;
  const grant = hostDef?.hostDualAdventGrant;
  if (!grant) return [];
  if (
    !isHostDualAdventGrantUsable(
      state,
      stack.cardInstanceId,
      stack.actingPlayerId,
      true
    )
  ) {
    return [];
  }

  const options: PendingAsIfSoulCoreChoiceOption[] = [];
  const isActivePlayer = state.activePlayerId === stack.actingPlayerId;
  const inBattleFlashWindow = state.activeAttack?.flashWindowState != null;
  const timingContext = {
    sourceInMainTiming:
      state.step === "main" && isActivePlayer && !inBattleFlashWindow,
    sourceInFlashTiming: inBattleFlashWindow,
    inBattleFlashWindow,
    isActivePlayer,
  };
  if (
    !grant.normalPathDisabled &&
    isHostDualAdventGrantUsable(
      state,
      stack.cardInstanceId,
      stack.actingPlayerId
    ) &&
    adventTimingWindowAllowed(grant.timing, timingContext) &&
    hasSoulCoreAvailable(state, stack.actingPlayerId)
  ) {
    options.push({
      choiceId: "normal",
      label: "ソウルコアを置いて契約煌臨",
      useAlternateCost: false,
    });
  }
  if (
    grant.alternateCost !== undefined &&
    adventTimingWindowAllowed(grant.alternateCost.timing, timingContext)
  ) {
    options.push({
      choiceId: "alternate",
      label: "置いたものとして契約煌臨",
      useAlternateCost: true,
    });
  }
  return options;
}

export interface HostGrantAdventParams {
  hostInstanceId: string;
  adventCardInstanceId: string;
  grant: HostDualAdventGrant;
  /** 代替コスト経路 (grant.alternateCost、ソウルコア消費なし)。 */
  useAlternateCost?: boolean;
}

/**
 * host 側同時2体煌臨の単体宣言 (スロット1つ分) を実行する。executeAdvent を
 * **1回だけ** host を target として呼ぶ (host→A→B のようなチェーンは構築しない)。
 * host は zone:'field' のまま残り、選ばれた手札カードが host を advent_source として
 * 独立に参照する新しい top になる。既存の他 occupant (反対側スロット) の underCards は
 * このカードの実行では一切変更しない (分岐構造、SSOT: getHostDualAdventOccupantCardIds)。
 *
 * @returns 更新後の GameState。前提を満たさない場合は元の state を返す (不発)。
 */
export function executeHostGrantAdvent(
  state: GameState,
  actingPlayerId: string,
  params: HostGrantAdventParams,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  const { hostInstanceId, adventCardInstanceId, grant, useAlternateCost } =
    params;

  if (
    !isHostDualAdventGrantUsable(
      state,
      hostInstanceId,
      actingPlayerId,
      useAlternateCost
    )
  ) {
    state.log.push(`host_dual_advent:${hostInstanceId}:host-not-usable`);
    return state;
  }

  const adventCard = getCardById(state, adventCardInstanceId);
  if (!adventCard) {
    state.log.push(`host_dual_advent:${hostInstanceId}:card-not-found`);
    return state;
  }
  const adventDef = getCardDefinitionById(adventCard.definitionId);
  if (!adventDef) {
    state.log.push(`host_dual_advent:${hostInstanceId}:definition-not-found`);
    return state;
  }

  const openSlotIndices = getHostDualAdventOpenSlotIndices(
    state,
    hostInstanceId,
    grant,
    getCardDefinitionById
  );
  const matchesOpenSlot = grant.slots.some(
    (slot, index) => openSlotIndices.has(index) && matchesSlot(adventDef, slot)
  );
  if (!matchesOpenSlot) {
    state.log.push(`host_dual_advent:${hostInstanceId}:slot-mismatch-or-full`);
    return state;
  }

  const isSoulStateTarget =
    state.players
      .find((p) => p.id === actingPlayerId)
      ?.soulStateInstanceIds.includes(hostInstanceId) ?? false;

  if (
    !getHostGrantedAdventChoiceOptions(
      state,
      adventCardInstanceId,
      actingPlayerId,
      getCardDefinitionById
    ).some(
      (option) =>
        option.proxySourceInstanceId === hostInstanceId &&
        option.useAlternateCost === (useAlternateCost === true)
    )
  )
    return state;
  const afterAdvent = executeAdvent(
    state,
    actingPlayerId,
    {
      adventCardInstanceId,
      targetInstanceId: hostInstanceId,
      adventData: adventDef.adventData!,
      isContractAdvent: isSoulStateTarget,
      useAlternateCost: useAlternateCost === true,
      allowAdventSourceTarget: true,
    },
    getCardDefinitionById
  );
  if (afterAdvent === state) return state;

  afterAdvent.log.push(
    `host_dual_advent:${hostInstanceId}:occupant:${adventCardInstanceId}` +
      (useAlternateCost ? ":alternate_cost" : "")
  );

  return afterAdvent;
}

/**
 * declare_host_dual_advent の deferred 解決 (発揮宣言→スタック窓クローズ後)。
 * resolvedStack.cardInstanceId = host、targetInstanceIds = [選ばれた手札カード] (単一)。
 */
export function resolveDeferredHostDualAdventStack(
  state: GameState,
  resolvedStack: ActiveStack,
  options: DeferredStackResolverOptions
): GameState {
  if (resolvedStack.isNullified) return state;

  const hostInstanceId = resolvedStack.cardInstanceId;
  const [adventCardInstanceId] = resolvedStack.targetInstanceIds;
  const actingPlayerId = resolvedStack.actingPlayerId;

  const hostDef = options.getCardDefinitionById(resolvedStack.cardDefinitionId);
  if (!hostDef?.hostDualAdventGrant || adventCardInstanceId === undefined) {
    return {
      ...state,
      log: [
        ...state.log,
        `[HostDualAdvent] 同時2体煌臨データ不整合のため不発: ${hostInstanceId}`,
      ],
    };
  }
  const grant = hostDef.hostDualAdventGrant;
  const useAlternateCost = resolvedStack.adventUseAlternateCost === true;

  // 「このカードが魂状態/煌臨元なら」= host が実行前に魂状態、または他カードの
  // 煌臨元 (underCards role='advent_source') だった場合のみコア配置が発生する
  // (通常フィールド現在面のまま単体で advent した場合は対象外。反対側スロットが
  // 既に埋まっている場合は host が既にその occupant の煌臨元になっているため対象)。
  const hostWasSoulStateOrBuried =
    (state.players
      .find((p) => p.id === actingPlayerId)
      ?.soulStateInstanceIds.includes(hostInstanceId) ??
      false) ||
    state.cardInstances.some((c) =>
      c.underCards.some((u) => u.cardInstanceId === hostInstanceId)
    );

  const beforeState = state;
  const adventCard = getCardById(state, adventCardInstanceId);
  const adventDef = adventCard
    ? options.getCardDefinitionById(adventCard.definitionId)
    : undefined;

  const afterAdvent = executeHostGrantAdvent(
    beforeState,
    actingPlayerId,
    {
      hostInstanceId,
      adventCardInstanceId,
      grant,
      useAlternateCost,
    },
    options.getCardDefinitionById
  );

  if (afterAdvent === beforeState) return afterAdvent;

  // 〔ターンに1回:同名〕は常時の許可元カードの printed name で共有する
  // (adventData.alternateCostAdvent と同じキー規約)。grant.alternateCost.turnLimitDisabled
  // が true (BSSG01-M01/M02) のときはターン制限自体が無いため記録しない。
  const recordedState =
    useAlternateCost &&
    adventDef &&
    grant.alternateCost?.turnLimitDisabled !== true
      ? {
          ...afterAdvent,
          usedAlternateCostAdventKeysThisTurn: [
            ...afterAdvent.usedAlternateCostAdventKeysThisTurn,
            getAdventDeclareUsageKey(hostDef),
          ],
        }
      : afterAdvent;

  const stateWithTriggers = collectAndQueueTriggerReactions({
    beforeState,
    afterState: recordedState,
    source: "action_resolution",
    chainId: resolvedStack.chainId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    causedByPlayerId: actingPlayerId,
    causedBySourceInstanceId: adventCardInstanceId,
  });

  // host 側が (実行前に) 魂状態/煌臨元だった場合のみ、重ねた対象 (今回の occupant) へ
  // フィールド/リザーブのコアを好きなだけ配置できる。
  if (
    grant.hostCoreDistributionOnAdvent === true &&
    hostWasSoulStateOrBuried &&
    stateWithTriggers.pendingCoreDistribution === null
  ) {
    const chargePending = buildChargeCoresPendingCoreDistribution(
      stateWithTriggers,
      actingPlayerId,
      adventCardInstanceId,
      hostDef.cardNo,
      options.getCardDefinitionById,
      "host-dual-advent-charge"
    );
    if (chargePending) {
      return { ...stateWithTriggers, pendingCoreDistribution: chargePending };
    }
  }

  return stateWithTriggers;
}
