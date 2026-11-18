import { describe, expect, it } from "vitest";
import {
  combinations,
  variableZoneDiscountMagicPaymentGroup,
} from "../src/action-input-choices";
import { createEmptyGameState } from "../src/factories";
import type { UseMagicLegalAction } from "../src/legal/legal-actions-types";

function createFixture(
  options: {
    candidateIds?: string[];
    maxCount?: number;
    reducedCost?: number;
    reserve?: number;
    additionalTax?: number;
    onBoardSources?: UseMagicLegalAction["availableOnBoardCoreSources"];
  } = {}
) {
  const candidateIds = options.candidateIds ?? ["a", "b"];
  const maxCount = options.maxCount ?? 2;
  const reducedCost = options.reducedCost ?? 2;
  const reserve = options.reserve ?? 1;
  const additionalCost =
    (options.additionalTax ?? 0) - Math.min(maxCount, candidateIds.length);
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: [
      { reserveNormalCoreCount: reserve, reserveSoulCoreCount: 0 },
      { reserveNormalCoreCount: 0, reserveSoulCoreCount: 0 },
    ],
  });
  const action: UseMagicLegalAction = {
    kind: "use_magic",
    actionId: "variable-zone",
    can: true,
    reason: "test_variable_zone",
    actingPlayerId: "alice",
    timing: "flash",
    sourceInstanceId: "magic",
    sourceDefinitionId: "TEST-VARIABLE-ZONE",
    sourceCardNo: "TEST-VARIABLE-ZONE",
    targetMode: "none",
    requiredTargetCount: 0,
    targetEffectFilterTags: [],
    candidateTargetInstanceIds: [],
    availableChosenLifeCoreKinds: [],
    requiresChosenLifeCoreKind: false,
    reducedCost,
    additionalCost,
    finalCost: Math.max(0, reducedCost + additionalCost),
    totalReduction: 0,
    availableReserveCoreAmount: reserve,
    availableOnBoardCoreSources: options.onBoardSources ?? [],
    availableSoulCoreOnlySources: [],
    costMode: "zone_discount_variable",
    zoneCostDiscountPerCard: -1,
    zoneCostPaymentCandidateIds: candidateIds,
    zoneCostPaymentMaxCount: maxCount,
  };
  return { state, action };
}

describe("combinations shared enumeration", () => {
  const expected = [
    [],
    ["c"],
    ["b"],
    ["b", "c"],
    ["a"],
    ["a", "c"],
    ["a", "b"],
  ];

  it.each([
    { limit: 0, truncated: true },
    { limit: 1, truncated: true },
    { limit: 6, truncated: true },
    { limit: 7, truncated: false },
    { limit: 128, truncated: false },
  ])(
    "preserves exclude-first order at limit $limit",
    ({ limit, truncated }) => {
      expect(combinations(["a", "b", "c"], 0, 2, limit)).toEqual({
        values: expected.slice(0, limit),
        truncated,
        limit,
      });
    }
  );

  it.each([2, 5])("preserves the clamped minimum %i", (minimum) => {
    expect(combinations(["a", "b", "c"], minimum, 2, 3)).toEqual({
      values: [
        ["b", "c"],
        ["a", "c"],
        ["a", "b"],
      ],
      truncated: false,
      limit: 3,
    });
  });

  it.each([
    { items: [], minimum: 0, maximum: 5 },
    { items: ["a", "b"], minimum: -2, maximum: -1 },
    { items: [], minimum: 5, maximum: 5 },
  ])(
    "preserves empty/clamped bounds: $minimum..$maximum",
    ({ items, minimum, maximum }) => {
      expect(combinations(items, minimum, maximum, 1)).toEqual({
        values: [[]],
        truncated: false,
        limit: 1,
      });
    }
  );
});

describe("variable zone-discount complete input limits", () => {
  it.each([1, 128])(
    "finds the sole payable four-card selection at limit %i",
    (limit) => {
      const { state, action } = createFixture({
        candidateIds: ["card-4", "card-6", "card-7", "card-8"],
        maxCount: 5,
        reducedCost: 5,
        reserve: 1,
      });
      expect(
        variableZoneDiscountMagicPaymentGroup(state, action, limit)
      ).toEqual({
        values: [
          {
            selectedZoneCardIds: ["card-4", "card-6", "card-7", "card-8"],
            paymentSources: [{ kind: "reserve", amount: 1 }],
          },
        ],
        truncated: false,
        limit,
      });
    }
  );

  it.each([0, 1, 128])(
    "reports no truncation when no complete input is payable at limit %i",
    (limit) => {
      const { state, action } = createFixture({
        maxCount: 1,
        reducedCost: 5,
        reserve: 0,
      });
      expect(
        variableZoneDiscountMagicPaymentGroup(state, action, limit)
      ).toEqual({
        values: [],
        truncated: false,
        limit,
      });
    }
  );

  const payable = [
    {
      selectedZoneCardIds: ["b"],
      paymentSources: [{ kind: "reserve", amount: 1 }],
    },
    {
      selectedZoneCardIds: ["a"],
      paymentSources: [{ kind: "reserve", amount: 1 }],
    },
    { selectedZoneCardIds: ["a", "b"], paymentSources: [] },
  ];
  it.each([
    { limit: 0, truncated: true },
    { limit: 1, truncated: true },
    { limit: 2, truncated: true },
    { limit: 3, truncated: false },
    { limit: 128, truncated: false },
  ])(
    "counts complete inputs after an unpayable selection at limit $limit",
    ({ limit, truncated }) => {
      const { state, action } = createFixture();
      expect(
        variableZoneDiscountMagicPaymentGroup(state, action, limit)
      ).toEqual({
        values: payable.slice(0, limit),
        truncated,
        limit,
      });
    }
  );

  it("preserves fixed additional costs while searching later selections", () => {
    const { state, action } = createFixture({ additionalTax: 1 });
    expect(variableZoneDiscountMagicPaymentGroup(state, action, 1)).toEqual({
      values: [
        {
          selectedZoneCardIds: ["a", "b"],
          paymentSources: [{ kind: "reserve", amount: 1 }],
        },
      ],
      truncated: false,
      limit: 1,
    });
  });

  it.each([
    { reducedCost: 0, reserve: 0, paymentSources: [] },
    {
      reducedCost: 1,
      reserve: 1,
      paymentSources: [{ kind: "reserve", amount: 1 }],
    },
  ])(
    "handles empty candidates with reduced cost $reducedCost",
    ({ reducedCost, reserve, paymentSources }) => {
      const { state, action } = createFixture({
        candidateIds: [],
        maxCount: 5,
        reducedCost,
        reserve,
      });
      expect(variableZoneDiscountMagicPaymentGroup(state, action, 1)).toEqual({
        values: [{ selectedZoneCardIds: [], paymentSources }],
        truncated: false,
        limit: 1,
      });
    }
  );

  it("does not select beyond the action's maximum count", () => {
    const { state, action } = createFixture({
      candidateIds: ["a", "b", "c"],
      maxCount: 1,
    });
    expect(variableZoneDiscountMagicPaymentGroup(state, action, 3)).toEqual({
      values: [
        {
          selectedZoneCardIds: ["c"],
          paymentSources: [{ kind: "reserve", amount: 1 }],
        },
        {
          selectedZoneCardIds: ["b"],
          paymentSources: [{ kind: "reserve", amount: 1 }],
        },
        {
          selectedZoneCardIds: ["a"],
          paymentSources: [{ kind: "reserve", amount: 1 }],
        },
      ],
      truncated: false,
      limit: 3,
    });
  });

  it("retains the unsupported zero maximum boundary", () => {
    const { state, action } = createFixture({ maxCount: 0 });
    expect(variableZoneDiscountMagicPaymentGroup(state, action, 1)).toBeNull();
  });

  it("does not mark exact-limit inputs truncated when later selections cannot pay", () => {
    const { state, action } = createFixture({
      candidateIds: ["board"],
      maxCount: 1,
      reserve: 0,
      onBoardSources: [{ instanceId: "board", availableCoreAmount: 2 }],
    });
    expect(variableZoneDiscountMagicPaymentGroup(state, action, 1)).toEqual({
      values: [
        {
          selectedZoneCardIds: [],
          paymentSources: [{ kind: "card", instanceId: "board", amount: 2 }],
        },
      ],
      truncated: false,
      limit: 1,
    });
  });

  const allocations = [
    {
      selectedZoneCardIds: [],
      paymentSources: [{ kind: "card", instanceId: "board", amount: 2 }],
    },
    {
      selectedZoneCardIds: [],
      paymentSources: [
        { kind: "reserve", amount: 1 },
        { kind: "card", instanceId: "board", amount: 1 },
      ],
    },
    {
      selectedZoneCardIds: [],
      paymentSources: [{ kind: "reserve", amount: 2 }],
    },
  ];
  it.each([
    { limit: 1, truncated: true },
    { limit: 3, truncated: false },
  ])(
    "counts payment allocations within a selection at limit $limit",
    ({ limit, truncated }) => {
      const { state, action } = createFixture({
        candidateIds: [],
        maxCount: 5,
        reserve: 2,
        onBoardSources: [{ instanceId: "board", availableCoreAmount: 2 }],
      });
      expect(
        variableZoneDiscountMagicPaymentGroup(state, action, limit)
      ).toEqual({
        values: allocations.slice(0, limit),
        truncated,
        limit,
      });
    }
  );

  it("stops lazy selection reads after finding an extra complete input", () => {
    let indexedReads = 0;
    const candidateIds = new Proxy(
      Array.from({ length: 34 }, (_, index) => `candidate-${index}`),
      {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/.test(property)) {
            indexedReads += 1;
            if (indexedReads > 100) {
              throw new Error(
                "Enumerated raw selections after the complete input limit"
              );
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    const { state, action } = createFixture({
      candidateIds,
      maxCount: 5,
      reducedCost: 0,
      reserve: 0,
    });
    expect(variableZoneDiscountMagicPaymentGroup(state, action, 1)).toEqual({
      values: [{ selectedZoneCardIds: [], paymentSources: [] }],
      truncated: true,
      limit: 1,
    });
    expect(indexedReads).toBeLessThanOrEqual(100);
  });
});
