import { getCardById } from "../card/card-lookup";
import { isEffectFieldEntryRestricted } from "../card/put-card-on-field";
import { matchesCardFilter } from "../card/card-filter";
import {
  getDeckRevealCostPaymentSources,
  getDeckRevealHandGainCost,
} from "./deck-reveal-hand-gain-cost";
import type { CardFilter } from "../dsl-types";
import {
  isHandGainPreventedByOwnEffect,
  isZoneEntryBlockedByResistance,
} from "../effect/effect-resistance-check";
import type { CardDefinition, GameState, PendingDeckReveal } from "../model";

function pickDestinationBlocksHandAdd(
  destination: PendingDeckReveal["picks"][number]["destination"]
): boolean {
  const resolved = destination ?? "hand";
  // hand_swap / hand_or_set_aside_swap は一対一の交換で純増しないため、
  // hand_gain_prevention と hand_gain_cost_gate の対象外（公式 Q12302）。
  // hand_or_set_aside_choice は手元を選べば純増しないため、候補は維持する。手札を
  // 選んだ場合だけ pending-action-handlers.ts で同じ source-scoped gate を適用する。
  return resolved === "hand";
}

/**
 * `pick` の実効 costGate を返す。`pick.costGate`（自己申告の「1コスト支払うことで」型
 * ブランチ、BSTH08.5-C23）と、`hand_gain_cost_gate` CE (engine-opponent-hand-gain-paid-
 * tax-gate, BSRK01-C02[3,4]) が `pending.actingPlayerId` に課す外部課税額の大きい方を
 * 採用する (battle_cost_gate が複数ゲート重複時に最大値を採る規約と同じ)。
 * destination が手札系でなければ外部課税は無関係 (`pick.costGate` のみ)。
 *
 * `hand_gain_prevention` CE (engine-restrict-hand-gain-bsrk01-x01, BSRK01-X01
 * 合体結誓) が立っているときは `Number.POSITIVE_INFINITY` を返し、両呼び出し元
 * (`getDeckRevealPickCandidateIdsExcluding`/`getDeckRevealExclusiveGroupBranches`) の
 * リザーブ/フィールドの使用可能コアによる affordability 判定を常に不成立にする
 * ことで、costGate と同じ経路のまま完全ブロックを表現する。
 */
export function resolveDeckRevealCostGateToApply(
  state: GameState,
  pending: PendingDeckReveal,
  pick: PendingDeckReveal["picks"][number]
): number | undefined {
  if (!pickDestinationBlocksHandAdd(pick.destination)) return pick.costGate;
  if (pending.handGainCostDecision === "declined")
    return Number.POSITIVE_INFINITY;
  if (
    isHandGainPreventedByOwnEffect(
      state,
      pending.targetPlayerId ?? pending.actingPlayerId,
      pending.actingPlayerId
    )
  ) {
    return Number.POSITIVE_INFINITY;
  }
  const external = getDeckRevealHandGainCost(state, pending);
  if (external <= 0) return pick.costGate;
  return Math.max(pick.costGate ?? 0, external);
}

function getPickedDestination(
  pending: PendingDeckReveal,
  id: string
):
  | "hand"
  | "field"
  | "hand_swap"
  | "hand_or_set_aside_swap"
  | "mirage_set"
  | "set_aside"
  | "hand_or_set_aside_choice"
  | "trash" {
  const fallbackPickedDestination = pending.picks[0]?.destination ?? "hand";
  return pending.pickedDestinationByInstance?.[id] ?? fallbackPickedDestination;
}

export function getDeckRevealSplitSwapPickedIds(
  pending: PendingDeckReveal
): string[] {
  // Private looks retain the original top cards until both the exchange and
  // remainder order are fixed, regardless of the remainder destination.
  if (pending.remainder !== "top_bottom_split" && pending.revealTo !== "self")
    return [];
  return pending.pickedCardInstanceIds.filter((id) => {
    const destination = getPickedDestination(pending, id);
    return (
      destination === "hand_swap" || destination === "hand_or_set_aside_swap"
    );
  });
}

export function getUnresolvedDeckRevealSplitSwapPickedIds(
  pending: PendingDeckReveal
): string[] {
  const swapOutByPicked = pending.swapOutByPickedInstanceId ?? {};
  return getDeckRevealSplitSwapPickedIds(pending).filter(
    (id) => !Object.prototype.hasOwnProperty.call(swapOutByPicked, id)
  );
}

export function getDeckRevealRemainderOrderCandidateIds(
  pending: PendingDeckReveal,
  baseRemainderIds: readonly string[]
): string[] {
  const result = [...baseRemainderIds];
  const seen = new Set(result);

  const swapOutByPicked = pending.swapOutByPickedInstanceId ?? {};
  for (const pickedId of getDeckRevealSplitSwapPickedIds(pending)) {
    if (!Object.prototype.hasOwnProperty.call(swapOutByPicked, pickedId)) {
      continue;
    }
    const swapOutId = swapOutByPicked[pickedId];
    const remainderId = swapOutId ?? pickedId;
    if (!seen.has(remainderId)) {
      result.push(remainderId);
      seen.add(remainderId);
    }
  }
  return result;
}

export function getDeckRevealPickCandidateIds(
  state: GameState,
  pending: PendingDeckReveal,
  pick: PendingDeckReveal["picks"][number],
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): string[] {
  return getDeckRevealPickCandidateIdsExcluding(
    state,
    pending,
    pick,
    getCardDefinitionById,
    new Set(pending.pickedCardInstanceIds)
  );
}

function getDeckRevealPickCandidateIdsExcluding(
  state: GameState,
  pending: PendingDeckReveal,
  pick: PendingDeckReveal["picks"][number],
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  excludedIds: ReadonlySet<string>,
  options?: { respectBlockedDisposition?: boolean }
): string[] {
  const blocksHandAdd = pickDestinationBlocksHandAdd(pick.destination);
  if (blocksHandAdd) {
    const effectiveCostGate = resolveDeckRevealCostGateToApply(
      state,
      pending,
      pick
    );
    if (effectiveCostGate !== undefined) {
      const affordable =
        getDeckRevealCostPaymentSources(state, pending, getCardDefinitionById)
          .totalAvailableCoreAmount >= effectiveCostGate;
      if (!affordable) return [];
    }
  }
  const respectBlockedDisposition = options?.respectBlockedDisposition ?? true;
  // ENGINE-set-aside-entry-restriction: destination が固定 "set_aside"
  // (選択不要、常に手元へ置く) のとき、destination-zone-scoped resistance
  // (cannot_enter_zone) で阻止される候補を除外する
  // (BSTH08.5-X04「このカードの効果以外で手元に置けない」)。
  // "hand_or_set_aside_swap"/"hand_or_set_aside_choice" はプレイヤーが後段で
  // 手札/手元のどちらへ送るか選ぶため、この時点では候補を除外しない。
  const remainingRevealed = pending.revealedCardInstanceIds.filter((id) => {
    if (excludedIds.has(id)) return false;
    if (pick.destination === "field") {
      const card = getCardById(state, id);
      const def = card && getCardDefinitionById(card.definitionId);
      if (
        !card ||
        !def ||
        isEffectFieldEntryRestricted(state, card, def, getCardDefinitionById)
      )
        return false;
    }
    if (
      respectBlockedDisposition &&
      blocksHandAdd &&
      pending.revealedDispositionMap?.[id]?.kind === "blocked"
    ) {
      return false;
    }
    if (pick.destination === "set_aside") {
      const card = getCardById(state, id);
      if (
        card &&
        isZoneEntryBlockedByResistance(
          state,
          card,
          "set_aside",
          pending.actingPlayerId,
          getCardDefinitionById
        )
      ) {
        return false;
      }
    }
    return true;
  });
  const matchesFilter = (
    card: NonNullable<ReturnType<typeof getCardById>>,
    def: CardDefinition,
    filter: NonNullable<PendingDeckReveal["picks"][number]["filter"]>
  ) =>
    matchesCardFilter(card, def, filter as CardFilter, {
      state,
      currentCard: card,
      cardZone: pending.origin === "deck" ? "deck" : card.zone,
    });
  const hasFilter = pick.filter || pick.filterOr;
  return hasFilter
    ? remainingRevealed.filter((id) => {
        const card = getCardById(state, id);
        if (!card) return false;
        const def = getCardDefinitionById(card.definitionId);
        if (!def) return false;
        if (pick.filterOr) {
          return pick.filterOr.some((filter) =>
            matchesFilter(card, def, filter)
          );
        }
        return matchesFilter(card, def, pick.filter!);
      })
    : remainingRevealed;
}

export function getDeckRevealBlockedHandAddRemainderIds(
  state: GameState,
  pending: PendingDeckReveal,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  candidateRemainderIds?: readonly string[]
): string[] {
  const picked = new Set(pending.pickedCardInstanceIds);
  const candidateSet = new Set(
    candidateRemainderIds ??
      pending.revealedCardInstanceIds.filter((id) => !picked.has(id))
  );
  const blockedRemainderIds = new Set(
    [...candidateSet].filter(
      (id) =>
        !picked.has(id) &&
        pending.revealedDispositionMap?.[id]?.kind === "blocked"
    )
  );
  if (blockedRemainderIds.size === 0) return [];

  const failedIds = new Set<string>();
  for (const pick of pending.picks) {
    const destination = pick.destination ?? "hand";
    if (
      destination !== "hand" &&
      destination !== "hand_swap" &&
      destination !== "hand_or_set_aside_swap" &&
      destination !== "hand_or_set_aside_choice"
    ) {
      continue;
    }
    if (pick.count === 0) continue;
    const matchingIds = getDeckRevealPickCandidateIdsExcluding(
      state,
      pending,
      pick,
      getCardDefinitionById,
      picked,
      { respectBlockedDisposition: false }
    );
    for (const id of matchingIds) {
      if (blockedRemainderIds.has(id)) {
        failedIds.add(id);
      }
    }
  }
  return [...failedIds];
}

export function getDeckRevealOrderableRemainderIds(
  state: GameState,
  pending: PendingDeckReveal,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  candidateRemainderIds?: readonly string[]
): string[] {
  const picked = new Set(pending.pickedCardInstanceIds);
  const remainderIds =
    candidateRemainderIds ??
    pending.revealedCardInstanceIds.filter((id) => !picked.has(id));
  const failedIds = new Set(
    getDeckRevealBlockedHandAddRemainderIds(
      state,
      pending,
      getCardDefinitionById,
      remainderIds
    )
  );
  return remainderIds.filter((id) => !failedIds.has(id));
}

/**
 * `startIndex` の pick が属する排他グループ（`exclusiveGroup`）のメンバーを、
 * `picks` 配列上で `startIndex` から連続する区間として収集する。
 * `exclusiveGroup` が無い pick は自分自身のみの1要素配列を返す。
 */
export function getDeckRevealExclusiveGroupSiblingIndices(
  pending: PendingDeckReveal,
  startIndex: number
): number[] {
  const groupId = pending.picks[startIndex]?.exclusiveGroup;
  if (!groupId) return [startIndex];
  const indices: number[] = [];
  for (let i = startIndex; i < pending.picks.length; i++) {
    if (pending.picks[i]?.exclusiveGroup === groupId) {
      indices.push(i);
    } else if (indices.length > 0) {
      break;
    }
  }
  return indices;
}

export interface DeckRevealExclusiveGroupBranch {
  index: number;
  pick: PendingDeckReveal["picks"][number];
  candidateIds: string[];
  /** このブランチを満たすために選択すべき枚数（count:-1 = 候補全部）。 */
  requiredCount: number;
}

/**
 * `startIndex` の pick が属する排他グループの各ブランチについて、候補カードと
 * 必要枚数を算出する。ブランチ間は互いにカード母集団を予約しあわない
 * （XOR = 選ばれなかったブランチは丸ごと不成立になるだけで、候補を横取りする
 * 必要が無いため）。
 *
 * 既知の制約 (adversarial verifier 2026-07-29 round1 指摘): 候補計算は
 * `getDeckRevealPickCandidateIds`（フィルタ照合のみ）であり、
 * `getDeckRevealSelectablePickCandidateIds` が行う「グループ **外** の後続 mandatory
 * pick 用にカードを予約する」(`maxMandatoryPickAssignments`) ロジックは適用しない。
 * BSTH08.5-X03 は排他グループが picks[] の全部（末尾）を占めるため無害だが、
 * 排他グループの後に別の mandatory pick を続ける形の DSL 定義は、両者が候補プールを
 * 共有する場合に予約が効かず過大取得しうる。そのような構成を追加するときは
 * 本関数の候補計算にも予約ロジックを組み込むこと。
 */
export function getDeckRevealExclusiveGroupBranches(
  state: GameState,
  pending: PendingDeckReveal,
  startIndex: number,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): DeckRevealExclusiveGroupBranch[] {
  return getDeckRevealExclusiveGroupSiblingIndices(pending, startIndex).map(
    (index) => {
      const pick = pending.picks[index]!;
      // costGate (「1コスト支払うことで」型ブランチ、BSTH08.5-C23) + hand_gain_cost_gate
      // 外部課税 (engine-opponent-hand-gain-paid-tax-gate) の合成値。支払い不能なら
      // 候補0枚扱いにし、未実装 branch と同じ「選択不可」経路 (allEmpty/groupIsMandatory
      // 判定) に委ねる。実際の支払いは選択確定時に pending-action-handlers.ts が行う。
      const effectiveCostGate = resolveDeckRevealCostGateToApply(
        state,
        pending,
        pick
      );
      const affordable =
        effectiveCostGate === undefined ||
        getDeckRevealCostPaymentSources(state, pending, getCardDefinitionById)
          .totalAvailableCoreAmount >= effectiveCostGate;
      const candidateIds = affordable
        ? getDeckRevealPickCandidateIds(
            state,
            pending,
            pick,
            getCardDefinitionById
          )
        : [];
      // `DeckRevealPick.count` は候補が不足するときにも上限であり、mandatory は
      // 「候補があれば空選択を許さない」だけを表す (dsl-types.ts)。通常 pick と
      // 同じく候補数まで選べるようにしないと、exclusiveGroup の固定枚数 branch
      // だけが選択不可能になり pendingDeckReveal を解消できなくなる。候補0枚は
      // 従来どおり declared count を保持し、allEmpty の skip 可否で表現する。
      const requiredCount =
        pick.count < 0
          ? candidateIds.length
          : candidateIds.length === 0
            ? pick.count
            : Math.min(pick.count, candidateIds.length);
      return { index, pick, candidateIds, requiredCount };
    }
  );
}

export function getDeckRevealSelectablePickCandidateIds(
  state: GameState,
  pending: PendingDeckReveal,
  pick: PendingDeckReveal["picks"][number],
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): string[] {
  const candidates = getDeckRevealPickCandidateIds(
    state,
    pending,
    pick,
    getCardDefinitionById
  );
  const picked = new Set(pending.pickedCardInstanceIds);
  const currentPickIndex = pending.currentPickIndex;
  const baseline = maxMandatoryPickAssignments(
    state,
    pending,
    currentPickIndex,
    picked,
    getCardDefinitionById
  );

  if (baseline <= 0) return candidates;

  return candidates.filter((candidateId) => {
    const nextExcluded = new Set(picked);
    nextExcluded.add(candidateId);

    if (!pick.mandatory) {
      const futureBaseline = maxMandatoryPickAssignments(
        state,
        pending,
        currentPickIndex + 1,
        picked,
        getCardDefinitionById
      );
      const futureAfterPick = maxMandatoryPickAssignments(
        state,
        pending,
        currentPickIndex + 1,
        nextExcluded,
        getCardDefinitionById
      );
      return futureAfterPick >= futureBaseline;
    }

    const remainingCurrentCount =
      pick.count < 0
        ? Math.max(0, candidates.length - 1)
        : Math.max(0, pick.count - 1);
    const totalAfterPick =
      1 +
      maxMandatoryPickAssignments(
        state,
        pending,
        currentPickIndex,
        nextExcluded,
        getCardDefinitionById,
        remainingCurrentCount
      );
    return totalAfterPick >= baseline;
  });
}

function maxMandatoryPickAssignments(
  state: GameState,
  pending: PendingDeckReveal,
  pickIndex: number,
  excludedIds: ReadonlySet<string>,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  currentPickCountOverride?: number
): number {
  if (pickIndex >= pending.picks.length) return 0;
  const pick = pending.picks[pickIndex];
  if (!pick) return 0;
  if (!pick.mandatory) {
    return maxMandatoryPickAssignments(
      state,
      pending,
      pickIndex + 1,
      excludedIds,
      getCardDefinitionById
    );
  }

  const candidates = getDeckRevealPickCandidateIdsExcluding(
    state,
    pending,
    pick,
    getCardDefinitionById,
    excludedIds
  );
  const pickCount =
    currentPickCountOverride ??
    (pick.count < 0
      ? candidates.length
      : Math.min(pick.count, candidates.length));
  const requiredCount = Math.min(pickCount, candidates.length);
  if (requiredCount <= 0) {
    return maxMandatoryPickAssignments(
      state,
      pending,
      pickIndex + 1,
      excludedIds,
      getCardDefinitionById
    );
  }

  let best = 0;
  const choose = (
    start: number,
    selectedCount: number,
    nextExcluded: Set<string>
  ) => {
    if (selectedCount === requiredCount) {
      best = Math.max(
        best,
        selectedCount +
          maxMandatoryPickAssignments(
            state,
            pending,
            pickIndex + 1,
            nextExcluded,
            getCardDefinitionById
          )
      );
      return;
    }
    for (let i = start; i < candidates.length; i++) {
      const id = candidates[i];
      if (!id) continue;
      const withCandidate = new Set(nextExcluded);
      withCandidate.add(id);
      choose(i + 1, selectedCount + 1, withCandidate);
    }
  };

  choose(0, 0, new Set(excludedIds));
  return best;
}
