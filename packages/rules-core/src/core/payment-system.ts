import { getCardById } from "../card/card-lookup";
import { canMoveCoresFrom } from "./core-movability";
import {
  getPlayerReserveCoreCount,
  getTotalCoresOnCardById,
  isNormalCoreMovePrevented,
  isSoulCoreOn,
  moveNormalCores,
  moveSoulCore,
} from "./core-system";
import {
  assertReductionIsMaximal,
  calculateReduction,
  type ReductionResult,
} from "./cost-system";
import { matchesCardFilter } from "../card/card-filter";
import type { CardFilter, DSL } from "../dsl-types";
import { getEffectiveSoulStateIds } from "../mechanics/magic-compatible-soul-state";
import {
  hasIndependentCoreManagement,
  type CardDefinition,
  type CardInstance,
  type GameState,
  type PlayerState,
  type PendingCoreSourceAllocation,
} from "../model";
import { queuePendingLeave } from "../state-based-actions";
import {
  isFieldCostPaymentRestricted,
  isReserveCostPaymentRestricted,
} from "../legal/legal-actions-shared";

export type CardCostPaymentSource =
  | {
      kind: "reserve";
      amount: number;
      /** true の場合、通常コアではなくソウルコアを1個含めて支払う */
      includeSoulCore?: boolean;
    }
  | {
      kind: "card";
      instanceId: string;
      amount: number;
      /**
       * true の場合、このカードに乗っているソウルコアを1個含めて支払う
       * （残りは通常コア）。reserve 側と対称な指定を可能にする。
       */
      includeSoulCore?: boolean;
      /**
       * 通常のカード上コア支払いはトラッシュ行き。創界神/導界者対象効果で
       * 明示される場合のみ void を指定できる。
       */
      destination?: "trash" | "void";
    };

export interface AvailableReservePaymentSource {
  kind: "reserve";
  availableCoreAmount: number;
}

export interface AvailableOnBoardCorePaymentSource {
  kind: "card";
  instanceId: string;
  definitionId: string;
  zoneRoleName: string;
  availableCoreAmount: number;
  soulCoreAvailable: boolean;
  destination?: "trash" | "void";
}

export interface AvailableSoulCorePaymentSource {
  kind: "card";
  instanceId: string;
  definitionId: string;
  zoneRoleName: string;
  availableSoulCoreAmount: 1;
}

export interface ExplicitIndependentCorePaymentSource {
  instanceId: string;
  destination?: "trash" | "void";
}

export interface AvailableCardCostPaymentSourcesResult {
  reduction: ReductionResult;
  reserveSource: AvailableReservePaymentSource;
  onBoardCoreSources: AvailableOnBoardCorePaymentSource[];
  soulCoreOnlySources: AvailableSoulCorePaymentSource[];
  totalAvailableCoreAmount: number;
  canFullyPay: boolean;
}

/** 選択を省略できるのは、支払い元が単一で通常コアしか使えない場合だけ。 */
export function getAutomaticNormalCorePaymentSources(
  amount: number,
  sources: readonly {
    sourceId: string;
    available: number;
    hasSoulCore: boolean;
    destination?: "trash" | "void";
  }[]
): CardCostPaymentSource[] | null {
  if (amount === 0) return [];
  const available = sources.filter((source) => source.available > 0);
  if (
    available.length === 0 ||
    new Set(available.map((source) => source.sourceId)).size !== 1 ||
    available.some((source) => source.hasSoulCore)
  )
    return null;
  const source = available.find((candidate) => candidate.available >= amount);
  if (!source) return null;
  return [
    source.sourceId === "reserve"
      ? { kind: "reserve", amount, includeSoulCore: false }
      : {
          kind: "card",
          instanceId: source.sourceId,
          amount,
          includeSoulCore: false,
          ...(source.destination ? { destination: source.destination } : {}),
        },
  ];
}

function getPlayerIndexOrThrow(state: GameState, playerId: string): number {
  const playerIndex = state.players.findIndex(
    (player) => player.id === playerId
  );

  if (playerIndex === -1) {
    throw new Error(`Unknown player: ${playerId}`);
  }

  return playerIndex;
}

function getPlayerOrThrow(state: GameState, playerId: string): PlayerState {
  const playerIndex = getPlayerIndexOrThrow(state, playerId);
  const player = state.players[playerIndex];

  if (!player) {
    throw new Error(`Unknown player: ${playerId}`);
  }

  return player;
}

function getCardInstanceOrThrow(
  state: GameState,
  instanceId: string,
  detail: string
): CardInstance {
  const cardInstance = getCardById(state, instanceId);

  if (!cardInstance) {
    throw new Error(`${detail}: ${instanceId}`);
  }

  return cardInstance;
}

function assertPositivePaymentAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`Payment amount must be positive: ${amount}`);
  }
}

function applyReservePaymentSource(
  state: GameState,
  actingPlayerId: string,
  amount: number,
  includeSoulCore?: boolean
): GameState {
  const playerIndex = getPlayerIndexOrThrow(state, actingPlayerId);
  const player = state.players[playerIndex];

  if (!player || getPlayerReserveCoreCount(player) < amount) {
    throw new Error(
      `Not enough reserve cores: player=${actingPlayerId} amount=${amount}`
    );
  }

  let currentState = state;

  // includeSoulCore: ソウルコアを1個含めて支払う（残りは通常コア）
  if (includeSoulCore) {
    const normalCorePayment = amount - 1; // ソウルコア1個分を引く
    if (normalCorePayment > 0) {
      currentState = moveNormalCores(
        currentState,
        { kind: "reserve", playerId: actingPlayerId },
        { kind: "trash", playerId: actingPlayerId },
        normalCorePayment
      );
    }
    currentState = moveSoulCore(
      currentState,
      actingPlayerId,
      { kind: "reserve", playerId: actingPlayerId },
      { kind: "trash", playerId: actingPlayerId }
    );
    return currentState;
  }

  // デフォルト: 通常コア優先
  const normalCorePayment = Math.min(player.reserveNormalCoreCount, amount);

  if (normalCorePayment > 0) {
    currentState = moveNormalCores(
      currentState,
      { kind: "reserve", playerId: actingPlayerId },
      { kind: "trash", playerId: actingPlayerId },
      normalCorePayment
    );
  }

  if (amount > normalCorePayment) {
    currentState = moveSoulCore(
      currentState,
      actingPlayerId,
      {
        kind: "reserve",
        playerId: actingPlayerId,
      },
      {
        kind: "trash",
        playerId: actingPlayerId,
      }
    );
  }

  return currentState;
}

function applyCardPaymentSource(
  state: GameState,
  actingPlayerId: string,
  instanceId: string,
  amount: number,
  includeSoulCore?: boolean,
  destination: "trash" | "void" = "trash",
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined,
  onBoardCoreSourceFilter?: CardFilter,
  explicitIndependentCorePaymentSources?: readonly ExplicitIndependentCorePaymentSource[]
): GameState {
  const cardInstance = getCardInstanceOrThrow(
    state,
    instanceId,
    "Unknown payment card"
  );

  if (cardInstance.controllerPlayerId !== actingPlayerId) {
    throw new Error(`Payment card is not controlled by ${actingPlayerId}`);
  }

  if (cardInstance.zone !== "field") {
    throw new Error(`Payment card must be on the field: ${instanceId}`);
  }

  const definition = getCardDefinitionById?.(cardInstance.definitionId);
  const explicitlyAllowedIndependentSource =
    explicitIndependentCorePaymentSources?.some(
      (source) =>
        source.instanceId === instanceId &&
        (source.destination ?? "trash") === destination
    ) === true;
  if (
    definition !== undefined &&
    !explicitlyAllowedIndependentSource &&
    !allowsIndependentCorePaymentSource(definition, onBoardCoreSourceFilter) &&
    hasIndependentCoreManagement(definition)
  ) {
    throw new Error(
      `Independent-core cards cannot provide generic cost payment cores: instance=${instanceId}`
    );
  }

  if (getTotalCoresOnCardById(state, instanceId) < amount) {
    throw new Error(
      `Not enough cores on payment card: instance=${instanceId} amount=${amount}`
    );
  }

  const movableNormalCoreAmount = isNormalCoreMovePrevented(state, instanceId)
    ? 0
    : cardInstance.normalCoreCount;
  if (movableNormalCoreAmount + cardInstance.soulCoreCount < amount) {
    throw new Error(
      `Not enough movable cores on payment card: instance=${instanceId} amount=${amount}`
    );
  }

  let currentState = state;

  // includeSoulCore: このカード上のソウルコアを1個含めて支払う（残りは通常コア）
  if (includeSoulCore) {
    if (!isSoulCoreOn(state, instanceId)) {
      throw new Error(
        `Soul core is not on payment card: instance=${instanceId}`
      );
    }
    const normalCorePayment = amount - 1;
    if (normalCorePayment > movableNormalCoreAmount) {
      throw new Error(
        `Not enough normal cores on payment card: instance=${instanceId} amount=${amount}`
      );
    }
    if (normalCorePayment > 0) {
      currentState = moveNormalCores(
        currentState,
        { kind: "card", instanceId },
        { kind: destination, playerId: actingPlayerId },
        normalCorePayment,
        getCardDefinitionById
      );
    }
    currentState = moveSoulCore(
      currentState,
      actingPlayerId,
      { kind: "card", instanceId },
      { kind: destination, playerId: actingPlayerId }
    );
    return currentState;
  }

  const normalCorePayment = Math.min(movableNormalCoreAmount, amount);

  if (normalCorePayment > 0) {
    currentState = moveNormalCores(
      currentState,
      {
        kind: "card",
        instanceId,
      },
      {
        kind: destination,
        playerId: actingPlayerId,
      },
      normalCorePayment,
      getCardDefinitionById
    );
  }

  if (amount > normalCorePayment) {
    currentState = moveSoulCore(
      currentState,
      actingPlayerId,
      {
        kind: "card",
        instanceId,
      },
      {
        kind: destination,
        playerId: actingPlayerId,
      }
    );
  }

  return currentState;
}

function markCostPaymentVanishes(
  state: GameState,
  chainId: string,
  touchedCardInstanceIds: Set<string>,
  causedByEffectSourceInstanceId?: string | null
): GameState {
  let current = state;
  for (const instanceId of touchedCardInstanceIds) {
    const cardInstance = getCardById(current, instanceId);
    if (!cardInstance || cardInstance.zone !== "field") continue;
    // 03f: 既存待機からコアを使っても再消滅・待機理由の変更はしない。
    if (cardInstance.pendingLeaveKind !== null) continue;
    if (
      getTotalCoresOnCardById(current, instanceId) >=
      cardInstance.minimumRequiredCores
    ) {
      continue;
    }

    // SSOT: queuePendingLeave 経由で待機化する。インライン構築では欠けていた
    // 「合体ブレイヴ単体消滅時の即時 detach」「待機状態間遷移での旧誘発除去」を、
    // コスト支払い消滅でも一貫して適用する。log 形式 (`pending-leave:vanish:...`) は同一。
    // cost_payment は自分のコスト支払い起因なので causePlayerId=null・耐性非適用。
    current = queuePendingLeave({
      state: current,
      instanceId,
      kind: "vanish",
      cause: "cost_payment",
      causePlayerId: null,
      chainId,
      deferZoneMoveUntilChainEnd: true,
      ...(causedByEffectSourceInstanceId
        ? { causedByEffectSourceInstanceId }
        : {}),
    });
  }
  return current;
}

export function getTotalPaymentAmount(
  paymentSources: readonly CardCostPaymentSource[]
): number {
  return paymentSources.reduce(
    (sum, paymentSource) => sum + paymentSource.amount,
    0
  );
}

export function assertMatchingPaymentAmount(
  reduction: ReductionResult,
  paymentSources: readonly CardCostPaymentSource[]
): void {
  assertReductionIsMaximal(reduction);

  const totalPaymentAmount = getTotalPaymentAmount(paymentSources);

  if (totalPaymentAmount !== reduction.finalCost) {
    throw new Error(
      `Payment does not match final cost: payment=${totalPaymentAmount} finalCost=${reduction.finalCost} (reducedCost=${reduction.reducedCost} + additionalCost=${reduction.additionalCost})`
    );
  }
}

export function assertPaymentSourcesAreAvailable(options: {
  paymentSources: readonly CardCostPaymentSource[];
  availableReserveCoreAmount: number;
  availableOnBoardCoreSources: readonly AvailableOnBoardCorePaymentSource[];
}): void {
  const reserveAmount = options.paymentSources
    .filter((source) => source.kind === "reserve")
    .reduce((sum, source) => sum + source.amount, 0);
  if (reserveAmount > options.availableReserveCoreAmount) {
    throw new Error(
      `Reserve payment exceeds available cores: payment=${reserveAmount} available=${options.availableReserveCoreAmount}`
    );
  }

  const requestedByCard = new Map<
    string,
    {
      instanceId: string;
      destination: "trash" | "void";
      amount: number;
      includeSoulCore: boolean;
    }
  >();
  for (const source of options.paymentSources) {
    if (source.kind !== "card") continue;
    const destination = source.destination ?? "trash";
    // Card instance IDs can contain `:` (for example, a reverse-rebirth
    // replacement). Keep the parsed fields in the aggregate rather than
    // reconstructing them with a delimiter-dependent split below.
    const key = JSON.stringify([source.instanceId, destination]);
    const current = requestedByCard.get(key) ?? {
      instanceId: source.instanceId,
      destination,
      amount: 0,
      includeSoulCore: false,
    };
    requestedByCard.set(key, {
      instanceId: current.instanceId,
      destination: current.destination,
      amount: current.amount + source.amount,
      includeSoulCore:
        current.includeSoulCore || source.includeSoulCore === true,
    });
  }

  for (const requested of requestedByCard.values()) {
    const available = options.availableOnBoardCoreSources.find(
      (source) =>
        source.instanceId === requested.instanceId &&
        (source.destination ?? "trash") === requested.destination
    );
    if (!available) {
      throw new Error(
        `Card payment source is not legal: instance=${requested.instanceId} destination=${requested.destination}`
      );
    }
    if (requested.amount > available.availableCoreAmount) {
      throw new Error(
        `Card payment exceeds available cores: instance=${requested.instanceId} payment=${requested.amount} available=${available.availableCoreAmount}`
      );
    }
    if (requested.includeSoulCore && !available.soulCoreAvailable) {
      throw new Error(
        `Soul core is not available for payment source: instance=${requested.instanceId}`
      );
    }
  }
}

export function assertReserveOrOnBoardExclusivePaymentSources(
  paymentSources: readonly CardCostPaymentSource[]
): void {
  const reserveAmount = paymentSources
    .filter((source) => source.kind === "reserve")
    .reduce((sum, source) => sum + source.amount, 0);
  const onBoardAmount = paymentSources
    .filter((source) => source.kind === "card")
    .reduce((sum, source) => sum + source.amount, 0);

  if (reserveAmount > 0 && onBoardAmount > 0) {
    throw new Error(
      `Payment sources must not mix reserve and filtered on-board cores: reserve=${reserveAmount} onBoard=${onBoardAmount}`
    );
  }
}

export function getAvailableOnBoardCorePaymentSources(
  state: GameState,
  actingPlayerId: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): AvailableOnBoardCorePaymentSource[] {
  const soulStateIds = getEffectiveSoulStateIds(state, getCardDefinitionById);
  // 待機状態 (破壊・消滅・バウンス) のスピリットも、その上のコアをコア支払い源に含める。
  // 根拠 (既存ルールの合成): コスト支払いは「リザーブ / フィールドのカード上」のコアで
  //   行える (03a_cost-payment.md)。かつ Ver.17.0 で待機状態のスピリットはフィールドに
  //   残存する (04_state-based-rules.md)。両者の合成で、待機状態スピリットのコア
  //   (= フィールドのカード上のコア) も支払い源になる。
  // 03f: cost_payment 由来の待機も残存コアを使用できる。移動済み分は残数に含まれない。
  // 創界神 / 導界者 / 創界石ネクサス上のコアは「対象効果でしか移動できない」独立コア管理
  //   (08c)。汎用コスト支払いの原資にはならないため canMoveCoresFrom で除外する (SSOT)。
  return (
    state.cardInstances
      .filter((cardInstance) => cardInstance.zone === "field")
      .filter(
        (cardInstance) => cardInstance.controllerPlayerId === actingPlayerId
      )
      // 魂状態のカードは field に置かれていても、通常のスピリット/ブレイヴ等ではなく
      // 上にコアを置く・そのシンボルで軽減する・通常コスト支払い源にすることができない。
      .filter((cardInstance) => !soulStateIds.has(cardInstance.instanceId))
      .filter((cardInstance) =>
        canMoveCoresFrom(
          state,
          cardInstance,
          getCardDefinitionById(cardInstance.definitionId)
        )
      )
      .map((cardInstance) => {
        const soulCoreAvailable = isSoulCoreOn(state, cardInstance.instanceId);
        const movableNormalCoreAmount = isNormalCoreMovePrevented(
          state,
          cardInstance.instanceId
        )
          ? 0
          : cardInstance.normalCoreCount;
        return {
          kind: "card" as const,
          instanceId: cardInstance.instanceId,
          definitionId: cardInstance.definitionId,
          zoneRoleName: cardInstance.zoneRoleName,
          availableCoreAmount:
            movableNormalCoreAmount + Number(soulCoreAvailable),
          soulCoreAvailable,
        };
      })
  );
}

/** 効果文の pay_cost は通常の支払い元と支払い制限を共通で使う。 */
export function getAvailablePayCostCoreSources(
  state: GameState,
  actingPlayerId: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  effectMode?: "main" | "flash" | "stack"
): Array<
  PendingCoreSourceAllocation["candidates"][number] & {
    normalAvailable: number;
    hasSoulCore: boolean;
  }
> {
  const player = state.players.find((p) => p.id === actingPlayerId);
  if (!player) return [];
  const reserveAvailable = isReserveCostPaymentRestricted(state, actingPlayerId)
    ? 0
    : getPlayerReserveCoreCount(player);
  const fieldSources = isFieldCostPaymentRestricted(
    state,
    actingPlayerId,
    effectMode
  )
    ? []
    : getAvailableOnBoardCorePaymentSources(
        state,
        actingPlayerId,
        getCardDefinitionById
      );
  return [
    ...(reserveAvailable > 0
      ? [
          {
            instanceId: "reserve",
            available: reserveAvailable,
            normalAvailable: player.reserveNormalCoreCount,
            hasSoulCore: reserveAvailable > player.reserveNormalCoreCount,
          },
        ]
      : []),
    ...fieldSources
      .filter((source) => source.availableCoreAmount > 0)
      .map((source) => ({
        instanceId: source.instanceId,
        available: source.availableCoreAmount,
        normalAvailable:
          source.availableCoreAmount - Number(source.soulCoreAvailable),
        hasSoulCore: source.soulCoreAvailable,
      })),
  ];
}

function getAvailableFilteredOnBoardCorePaymentSources(options: {
  state: GameState;
  actingPlayerId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  filter: CardFilter;
  sourceDefinition: CardDefinition;
}): AvailableOnBoardCorePaymentSource[] {
  const soulStateIds = getEffectiveSoulStateIds(
    options.state,
    options.getCardDefinitionById
  );
  return options.state.cardInstances
    .filter((cardInstance) => cardInstance.zone === "field")
    .filter(
      (cardInstance) =>
        cardInstance.controllerPlayerId === options.actingPlayerId
    )
    .filter((cardInstance) => !soulStateIds.has(cardInstance.instanceId))
    .filter((cardInstance) => {
      const def = options.getCardDefinitionById(cardInstance.definitionId);
      if (!def) return false;
      if (
        !matchesCardFilter(cardInstance, def, options.filter, {
          sourceDefinition: options.sourceDefinition,
        })
      ) {
        return false;
      }

      // 通常の場コア支払いでは創界神/導界者/創界石を除外するが、
      // 「創界神ネクサスから2コスト支払って」のように source filter が
      // 明示された場合だけ、フィルタに一致する独立管理カードを支払い元へ含める。
      return (
        canMoveCoresFrom(options.state, cardInstance, def) ||
        (hasIndependentCoreManagement(def) &&
          cardInstance.normalCoreCount > 0 &&
          !isNormalCoreMovePrevented(options.state, cardInstance.instanceId))
      );
    })
    .map((cardInstance) => {
      const soulCoreAvailable = isSoulCoreOn(
        options.state,
        cardInstance.instanceId
      );
      const movableNormalCoreAmount = isNormalCoreMovePrevented(
        options.state,
        cardInstance.instanceId
      )
        ? 0
        : cardInstance.normalCoreCount;
      return {
        kind: "card" as const,
        instanceId: cardInstance.instanceId,
        definitionId: cardInstance.definitionId,
        zoneRoleName: cardInstance.zoneRoleName,
        availableCoreAmount:
          movableNormalCoreAmount + Number(soulCoreAvailable),
        soulCoreAvailable,
      };
    });
}

export function allowsIndependentCorePaymentSource(
  definition: Pick<CardDefinition, "grandwalkerData" | "grandstoneData">,
  filter: CardFilter | undefined
): boolean {
  if (!filter) return false;
  if (
    definition.grandwalkerData != null &&
    filter.targetsGrandwalker !== undefined
  ) {
    return true;
  }
  if (definition.grandstoneData != null && filter.targetsGrandstone === true) {
    return true;
  }
  return (
    filter.filterOr?.some((branch) =>
      allowsIndependentCorePaymentSource(definition, branch)
    ) ?? false
  );
}

export function getAvailableSoulCorePaymentSources(
  onBoardCoreSources: readonly AvailableOnBoardCorePaymentSource[]
): AvailableSoulCorePaymentSource[] {
  return onBoardCoreSources
    .filter((source) => source.soulCoreAvailable)
    .map((source) => ({
      kind: "card" as const,
      instanceId: source.instanceId,
      definitionId: source.definitionId,
      zoneRoleName: source.zoneRoleName,
      availableSoulCoreAmount: 1 as const,
    }));
}

export function getAvailableCardCostPaymentSources(options: {
  state: GameState;
  actingPlayerId: string;
  card: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  /** 召喚カードの instanceId。要求側 treat_as 適用に使用。 */
  sourceInstanceId?: string;
  /** 逆転醒など、既存の自分自身を軽減シンボルへ数えない場合。 */
  excludeFieldInstanceIds?: readonly string[];
  /** マジック/効果使用コストの mode。召喚/配置では未指定。 */
  effectMode?: "main" | "flash" | "stack";
  /** 「このカードをコストNにする」型の一時的な総コスト上書き。 */
  baseCostOverride?: number;
  /** 使用時コスト等による軽減後加算値（負数の割引も含む）。 */
  additionalCostModifiers?: readonly import("./cost-system").AdditionalCostModifier[];
  /** 効果召喚/バースト効果召喚など、召喚原因で条件づく additional-cost CE 用。 */
  summonCause?: "effect" | "burst";
  /** `calculateReduction` の `useKind` をそのまま伝播する（prevent_cost_reduction 判定用）。 */
  useKind?: DSL.CardUseKind;
  /**
   * リザーブ以外の支払い元を、条件に合うフィールド上カードへ限定する。
   * リザーブ支払いは制限しない。
   */
  onBoardCoreSourceFilter?: CardFilter;
}): AvailableCardCostPaymentSourcesResult {
  const reduction = calculateReduction({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    card: options.card,
    getCardDefinitionById: options.getCardDefinitionById,
    ...(options.excludeFieldInstanceIds
      ? { excludeFieldInstanceIds: options.excludeFieldInstanceIds }
      : {}),
    ...(options.sourceInstanceId !== undefined
      ? { sourceInstanceId: options.sourceInstanceId }
      : {}),
    ...(options.effectMode !== undefined
      ? { effectMode: options.effectMode }
      : {}),
    ...(options.baseCostOverride !== undefined
      ? { baseCostOverride: options.baseCostOverride }
      : {}),
    ...(options.additionalCostModifiers !== undefined
      ? { additionalCostModifiers: options.additionalCostModifiers }
      : {}),
    ...(options.summonCause !== undefined
      ? { summonCause: options.summonCause }
      : {}),
    ...(options.useKind !== undefined ? { useKind: options.useKind } : {}),
  });
  const player = getPlayerOrThrow(options.state, options.actingPlayerId);

  // 「相手はリザーブからコストが支払えない」(restrict_reserve_cost_payment CE、
  // ENGINE-restrict-reserve-cost-payment、BSSL01-R03) が有効な間はリザーブを支払い
  // ソースから除外する。フィールドのカード上のコアは引き続き使える (onBoardCoreSources)。
  const reserveSource: AvailableReservePaymentSource = {
    kind: "reserve",
    availableCoreAmount: isReserveCostPaymentRestricted(
      options.state,
      options.actingPlayerId
    )
      ? 0
      : getPlayerReserveCoreCount(player),
  };
  // 「相手のマジックのスタック効果コストは、フィールドから支払えない」
  // (restrict_field_cost_payment CE、ENGINE-restrict-field-cost-payment、BSTH08-C06) が
  // 有効な間はフィールドのカード上のコア(ソウルコア含む)を支払いソースから除外する
  // (リザーブは引き続き使える。reserveSource と対称)。
  const onBoardCoreSources = isFieldCostPaymentRestricted(
    options.state,
    options.actingPlayerId,
    options.effectMode
  )
    ? []
    : options.onBoardCoreSourceFilter
      ? getAvailableFilteredOnBoardCorePaymentSources({
          state: options.state,
          actingPlayerId: options.actingPlayerId,
          getCardDefinitionById: options.getCardDefinitionById,
          filter: options.onBoardCoreSourceFilter,
          sourceDefinition: options.card,
        })
      : getAvailableOnBoardCorePaymentSources(
          options.state,
          options.actingPlayerId,
          options.getCardDefinitionById
        );
  const soulCoreOnlySources =
    getAvailableSoulCorePaymentSources(onBoardCoreSources);
  const totalAvailableCoreAmount =
    reserveSource.availableCoreAmount +
    onBoardCoreSources.reduce(
      (sum, source) => sum + source.availableCoreAmount,
      0
    );
  const onBoardAvailableCoreAmount = onBoardCoreSources.reduce(
    (sum, source) => sum + source.availableCoreAmount,
    0
  );
  const canFullyPay = options.onBoardCoreSourceFilter
    ? reserveSource.availableCoreAmount >= reduction.finalCost ||
      onBoardAvailableCoreAmount >= reduction.finalCost
    : totalAvailableCoreAmount >= reduction.finalCost;

  return {
    reduction,
    reserveSource,
    onBoardCoreSources,
    soulCoreOnlySources,
    totalAvailableCoreAmount,
    canFullyPay,
  };
}

export function applyCardCostPayments(options: {
  state: GameState;
  actingPlayerId: string;
  chainId: string;
  paymentSources: readonly CardCostPaymentSource[];
  /**
   * この支払いを要求した効果の発揮元カード instanceId
   * (ENGINE-generic-effect-activation-causal-trigger Step3: causal-tracking 層の
   * pay_cost 経路)。支払いにより他カードがコア不足消滅した場合、その
   * `PendingLeaveEntity.causedByEffectSourceInstanceId` に伝播する。
   * 未指定時は undefined のまま (fail-closed、誤帰属しない)。
   * カード使用/召喚そのもののコスト支払い (プレイの一部) は対象外 —
   * 効果 step 内で明示的に要求される pay_cost のみが対象。
   */
  causedByEffectSourceInstanceId?: string | null;
  /**
   * BSKB01-T01 等 `hasForcedCoreVoidRedirect` トークンからのコア支払い時、
   * moveNormalCores choke point でボイド強制上書きを効かせるために渡す
   * (省略時は従来どおり redirect 無効の後方互換 no-op)。
   */
  getCardDefinitionById?:
    | ((definitionId: string) => CardDefinition | undefined)
    | undefined;
  /**
   * フィールド上カードからの支払い元制約。創界神/導界者/創界石は通常コスト支払い
   * では原資にできないが、filter が targetsGrandwalker/targetsGrandstone を明示した
   * 効果コストだけは例外として許可する。
   */
  onBoardCoreSourceFilter?: CardFilter;
  /**
   * マジック導域など、available source として個別に検証済みの独立コア支払い元。
   * destination も含めて一致したものだけを例外扱いする。
   */
  explicitIndependentCorePaymentSources?: readonly ExplicitIndependentCorePaymentSource[];
}): GameState {
  let currentState = options.state;
  const touchedCardInstanceIds = new Set<string>();

  for (const paymentSource of options.paymentSources) {
    assertPositivePaymentAmount(paymentSource.amount);

    if (paymentSource.kind === "reserve") {
      currentState = applyReservePaymentSource(
        currentState,
        options.actingPlayerId,
        paymentSource.amount,
        paymentSource.includeSoulCore
      );
      continue;
    }

    touchedCardInstanceIds.add(paymentSource.instanceId);
    currentState = applyCardPaymentSource(
      currentState,
      options.actingPlayerId,
      paymentSource.instanceId,
      paymentSource.amount,
      paymentSource.includeSoulCore,
      paymentSource.destination ?? "trash",
      options.getCardDefinitionById,
      options.onBoardCoreSourceFilter,
      options.explicitIndependentCorePaymentSources
    );
  }

  return markCostPaymentVanishes(
    currentState,
    options.chainId,
    touchedCardInstanceIds,
    options.causedByEffectSourceInstanceId
  );
}
