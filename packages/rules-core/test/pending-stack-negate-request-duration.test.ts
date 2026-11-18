/**
 * ENGINE-single-target-burst-nullify: `PendingStackNegateRequest.duration` の期限切れ判定
 * primitive gap 修正の直接検証。
 *
 * 旧実装 (applyPendingStackNegateRequests) は request の対象一致有無に関わらず、
 * 呼び出し1回目で無条件に pendingStackNegateRequests から除去していた
 * (stack-negate.ts/stack-resolution-core.ts が duration を一切参照しない silent bug)。
 * 2026-07-26 round3 adversarial verifier で発見 (BSTH02-M02 stub 参照)。
 *
 * 修正: model.ts の isPendingStackNegateRequestExpired で duration.scope (turn/step) を
 * createdAtStep/createdAtTurn と比較し、applyPendingStackNegateRequests は
 * (1) 期限切れ request のみ無条件除去、(2) 未期限切れの request は実際に対象へ一致し
 * 消費されたときだけ除去する（不一致なら次回呼び出しへ持ち越す）。
 */
import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { applyPendingStackNegateRequests } from "../src/legal/stack-resolution-core";
import {
  isPendingStackNegateRequestExpired,
  hasActivePendingStackNegateRequests,
} from "../src/model";
import type {
  ActiveStack,
  CardDefinition,
  GameState,
  PendingStackNegateRequest,
} from "../src/model";

const DUMMY_CARD: CardDefinition = {
  cardNo: "PENDING-STACK-NEGATE-DUMMY",
  name: "pending stack negate dummy",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

function buildState(overrides: Partial<GameState> = {}): GameState {
  const selfCard = createCardInstance(DUMMY_CARD, {
    instanceId: "self-card",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
  });
  const oppCard = createCardInstance(DUMMY_CARD, {
    instanceId: "opp-card",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
  });
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [selfCard, oppCard],
  });
  return {
    ...base,
    activePlayerId: "alice",
    step: "attack",
    turnNumber: 3,
    ...overrides,
  };
}

function makeStack(stackId: string, actingPlayerId: string): ActiveStack {
  return {
    stackId,
    actionKind: "triggered_effect",
    chainId: `chain:${stackId}`,
    actingPlayerId,
    cardInstanceId: actingPlayerId === "alice" ? "self-card" : "opp-card",
    cardDefinitionId: DUMMY_CARD.cardNo,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
}

function makeRequest(state: GameState): PendingStackNegateRequest {
  return {
    requestId: "req-1",
    actingPlayerId: "alice",
    sourceInstanceId: "self-card",
    negateTarget: "effect",
    targetController: "opponent",
    duration: { scope: "step" },
    createdAtStep: state.step,
    createdAtTurn: state.turnNumber,
  };
}

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  id === DUMMY_CARD.cardNo ? DUMMY_CARD : undefined;

describe("applyPendingStackNegateRequests: duration-aware pending negate", () => {
  it("mismatched head stack does NOT consume the request; it survives for a later matching stack", () => {
    const state = buildState();
    const request = makeRequest(state);
    const stateWithRequest = {
      ...state,
      pendingStackNegateRequests: [request],
    };
    const selfStack = makeStack("self-stack", "alice"); // same actor as request -> never matches
    const oppStack = makeStack("opp-stack", "bob");

    const first = applyPendingStackNegateRequests({
      state: stateWithRequest,
      remainingStacks: [selfStack, oppStack],
      getCardDefinitionById,
    });
    // head (selfStack) does not match (targetController:"opponent") -> not nullified
    expect(first.remainingStacks[0]!.isNullified).toBeUndefined();
    // regression guard: the old bug removed the request here regardless of match.
    expect(first.state.pendingStackNegateRequests).toHaveLength(1);

    const second = applyPendingStackNegateRequests({
      state: first.state,
      remainingStacks: [oppStack],
      getCardDefinitionById,
    });
    expect(second.remainingStacks[0]!.isNullified).toBe(true);
    expect(second.state.pendingStackNegateRequests).toHaveLength(0);
  });

  it("expires once the step changes: does not linger to nullify an unrelated later-step stack", () => {
    const createdState = buildState({ step: "attack" });
    const request = makeRequest(createdState);
    const laterState = {
      ...createdState,
      step: "main" as const,
      pendingStackNegateRequests: [request],
    };
    const oppStack = makeStack("opp-stack-later", "bob");

    const result = applyPendingStackNegateRequests({
      state: laterState,
      remainingStacks: [oppStack],
      getCardDefinitionById,
    });
    expect(result.remainingStacks[0]!.isNullified).toBeUndefined();
    expect(result.state.pendingStackNegateRequests).toHaveLength(0);
  });

  it("scope:turn expires once turnNumber advances", () => {
    const createdState = buildState({ turnNumber: 3 });
    const request: PendingStackNegateRequest = {
      ...makeRequest(createdState),
      duration: { scope: "turn" },
    };
    expect(isPendingStackNegateRequestExpired(request, createdState)).toBe(
      false
    );
    expect(
      isPendingStackNegateRequestExpired(request, {
        ...createdState,
        turnNumber: 4,
      })
    ).toBe(true);
  });

  it("hasActivePendingStackNegateRequests ignores expired entries only", () => {
    const createdState = buildState({ step: "attack" });
    const request = makeRequest(createdState);
    expect(
      hasActivePendingStackNegateRequests({
        ...createdState,
        pendingStackNegateRequests: [request],
      })
    ).toBe(true);
    expect(
      hasActivePendingStackNegateRequests({
        ...createdState,
        step: "main",
        pendingStackNegateRequests: [request],
      })
    ).toBe(false);
  });
});
