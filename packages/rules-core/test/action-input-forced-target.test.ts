import { describe, expect, it } from "vitest";
import {
  actionRecord,
  targetSelectionsForAction,
} from "../src/action-input-choices";
import { allocateGroupedTargetsByStep } from "../src/effect/native-target-resolution";
import { assignLegalActionTargetGroups } from "../src/legal/legal-actions-shared";
import type { ResolvePendingEffectTargetLegalAction } from "../src/legal/legal-actions-types";

function targetAction(
  overrides: Partial<ResolvePendingEffectTargetLegalAction> = {}
): ResolvePendingEffectTargetLegalAction {
  return {
    kind: "resolve_pending_effect_target",
    actionId: "effect-target:test",
    can: true,
    reason: "pending_effect_target_selection",
    actingPlayerId: "alice",
    pendingId: "effect-target:test",
    sourceInstanceId: "source",
    sourceDefinitionId: "TEST-TARGET-SOURCE",
    targetMode: "manual",
    requiredTargetCount: 1,
    targetEffectFilterTags: [],
    candidateTargetInstanceIds: ["a", "b", "c"],
    ...overrides,
  };
}

function expectChoices(
  action: ResolvePendingEffectTargetLegalAction,
  limit: number,
  values: string[][],
  truncated: boolean
) {
  expect(targetSelectionsForAction(actionRecord(action), limit)).toEqual({
    values,
    truncated,
    limit,
  });
}

describe("forced target inputs without target groups", () => {
  it("preserves exclude-first selection order without mandatory targets", () => {
    expectChoices(targetAction(), 128, [["c"], ["b"], ["a"]], false);
  });

  it.each([
    { limit: 0, values: [], truncated: true },
    { limit: 1, values: [["c"]], truncated: false },
    { limit: 128, values: [["c"]], truncated: false },
  ])(
    "finds a late mandatory target at limit $limit",
    ({ limit, values, truncated }) => {
      expectChoices(
        targetAction({ mandatoryTargetInstanceIds: ["c"] }),
        limit,
        values,
        truncated
      );
    }
  );

  it("preserves mandatory-prefix and remaining combination order", () => {
    expectChoices(
      targetAction({
        requiredTargetCount: 2,
        mandatoryTargetInstanceIds: ["c"],
      }),
      128,
      [
        ["c", "b"],
        ["c", "a"],
      ],
      false
    );
  });

  it("includes a mandatory target when the required count is zero", () => {
    expectChoices(
      targetAction({
        candidateTargetInstanceIds: ["a", "b"],
        requiredTargetCount: 0,
        maxTargetCount: 2,
        mandatoryTargetInstanceIds: ["b"],
      }),
      128,
      [["b"], ["b", "a"]],
      false
    );
  });

  it("does not emit an undersized selection when candidates are exhausted", () => {
    expectChoices(targetAction({ requiredTargetCount: 4 }), 128, [], false);
  });

  it("does not silently omit an unknown mandatory target", () => {
    expectChoices(
      targetAction({ mandatoryTargetInstanceIds: ["unknown"] }),
      128,
      [],
      false
    );
  });

  it("does not emit mandatory targets beyond the global maximum", () => {
    expectChoices(
      targetAction({ mandatoryTargetInstanceIds: ["a", "b"] }),
      128,
      [],
      false
    );
  });

  it("accepts an empty selection at an empty zero-count boundary", () => {
    expectChoices(
      targetAction({ candidateTargetInstanceIds: [], requiredTargetCount: 0 }),
      1,
      [[]],
      false
    );
  });

  it("preserves ordered duplicate selections at a fixed count", () => {
    expectChoices(
      targetAction({
        candidateTargetInstanceIds: ["a", "b"],
        requiredTargetCount: 2,
        allowDuplicateTargets: true,
        mandatoryTargetInstanceIds: ["b"],
      }),
      128,
      [
        ["a", "b"],
        ["b", "a"],
        ["b", "b"],
      ],
      false
    );
  });

  it.each([
    { limit: 1, values: [["a", "b"]], truncated: true },
    {
      limit: 2,
      values: [
        ["a", "b"],
        ["b", "a"],
      ],
      truncated: false,
    },
    {
      limit: 128,
      values: [
        ["a", "b"],
        ["b", "a"],
      ],
      truncated: false,
    },
  ])(
    "extends duplicate counts to satisfy all mandatory targets at limit $limit",
    ({ limit, values, truncated }) => {
      expectChoices(
        targetAction({
          candidateTargetInstanceIds: ["a", "b"],
          maxTargetCount: 2,
          allowDuplicateTargets: true,
          mandatoryTargetInstanceIds: ["a", "b"],
        }),
        limit,
        values,
        truncated
      );
    }
  );

  it("enumerates optional duplicate counts from the smallest valid count", () => {
    expectChoices(
      targetAction({
        candidateTargetInstanceIds: ["a"],
        requiredTargetCount: 0,
        maxTargetCount: 2,
        allowDuplicateTargets: true,
        mandatoryTargetInstanceIds: ["a"],
      }),
      128,
      [["a"], ["a", "a"]],
      false
    );
  });
});

describe("forced target inputs with target groups", () => {
  const oneGroup = [
    {
      candidateTargetInstanceIds: ["a", "b", "c"],
      requiredTargetCount: 1,
    },
  ];

  it.each([
    { limit: 0, values: [], truncated: true },
    { limit: 1, values: [["c"]], truncated: false },
    { limit: 128, values: [["c"]], truncated: false },
  ])(
    "filters mandatory targets before applying the group limit $limit",
    ({ limit, values, truncated }) => {
      expectChoices(
        targetAction({
          targetGroups: oneGroup,
          mandatoryTargetInstanceIds: ["c"],
        }),
        limit,
        values,
        truncated
      );
    }
  );

  it.each([
    { limit: 1, values: [["a"]], truncated: true },
    { limit: 3, values: [["a"], ["b"], ["c"]], truncated: false },
    { limit: 128, values: [["a"], ["b"], ["c"]], truncated: false },
  ])(
    "preserves a valid automatic first assignment without repeating it at limit $limit",
    ({ limit, values, truncated }) => {
      expectChoices(
        targetAction({ targetGroups: oneGroup }),
        limit,
        values,
        truncated
      );
    }
  );

  it.each([
    { limit: 1, values: [["a", "b"]], truncated: true },
    {
      limit: 128,
      values: [
        ["a", "b"],
        ["b", "a"],
      ],
      truncated: false,
    },
  ])(
    "keeps a valid overlapping-group first assignment and reversed input at limit $limit",
    ({ limit, values, truncated }) => {
      expectChoices(
        targetAction({
          candidateTargetInstanceIds: ["a", "b"],
          requiredTargetCount: 2,
          mandatoryTargetInstanceIds: ["b"],
          targetGroups: [
            { candidateTargetInstanceIds: ["a", "b"], requiredTargetCount: 1 },
            { candidateTargetInstanceIds: ["a"], requiredTargetCount: 1 },
          ],
        }),
        limit,
        values,
        truncated
      );
    }
  );

  it.each([
    { limit: 1, values: [["b", "c"]], truncated: true },
    {
      limit: 128,
      values: [
        ["b", "c"],
        ["c", "b"],
      ],
      truncated: false,
    },
  ])(
    "rejects a nonmandatory automatic assignment and retains later legal ordered selections at limit $limit",
    ({ limit, values, truncated }) => {
      expectChoices(
        targetAction({
          requiredTargetCount: 2,
          mandatoryTargetInstanceIds: ["b"],
          targetGroups: [
            { candidateTargetInstanceIds: ["a", "b"], requiredTargetCount: 1 },
            { candidateTargetInstanceIds: ["c"], requiredTargetCount: 1 },
          ],
        }),
        limit,
        values,
        truncated
      );
    }
  );

  it.each([false, true])(
    "respects overlapping group duplicate permission: %s",
    (allowDuplicateTargets) => {
      expectChoices(
        targetAction({
          candidateTargetInstanceIds: ["a"],
          requiredTargetCount: 2,
          allowDuplicateTargets,
          targetGroups: [
            { candidateTargetInstanceIds: ["a"], requiredTargetCount: 1 },
            { candidateTargetInstanceIds: ["a"], requiredTargetCount: 1 },
          ],
        }),
        128,
        allowDuplicateTargets ? [["a", "a"]] : [],
        false
      );
    }
  );

  it("satisfies a repeated count inside a single group", () => {
    expectChoices(
      targetAction({
        candidateTargetInstanceIds: ["a"],
        requiredTargetCount: 2,
        allowDuplicateTargets: true,
        targetGroups: [
          { candidateTargetInstanceIds: ["a"], requiredTargetCount: 2 },
        ],
      }),
      1,
      [["a", "a"]],
      false
    );
  });

  it.each([
    { limit: 1, values: [["a", "b"]], truncated: true },
    {
      limit: 2,
      values: [
        ["a", "b"],
        ["b", "a"],
      ],
      truncated: false,
    },
    {
      limit: 128,
      values: [
        ["a", "b"],
        ["b", "a"],
      ],
      truncated: false,
    },
  ])(
    "satisfies grouped mandatory targets at a variable duplicate count and limit $limit",
    ({ limit, values, truncated }) => {
      expectChoices(
        targetAction({
          candidateTargetInstanceIds: ["a", "b"],
          maxTargetCount: 2,
          allowDuplicateTargets: true,
          mandatoryTargetInstanceIds: ["a", "b"],
          targetGroups: [
            {
              candidateTargetInstanceIds: ["a", "b"],
              requiredTargetCount: 1,
              maxTargetCount: 2,
            },
          ],
        }),
        limit,
        values,
        truncated
      );
    }
  );

  it("includes mandatory targets in a zero-required optional group", () => {
    expectChoices(
      targetAction({
        candidateTargetInstanceIds: ["a"],
        requiredTargetCount: 0,
        maxTargetCount: 1,
        mandatoryTargetInstanceIds: ["a"],
        targetGroups: [
          {
            candidateTargetInstanceIds: ["a"],
            requiredTargetCount: 0,
            maxTargetCount: 1,
          },
        ],
      }),
      1,
      [["a"]],
      false
    );
  });

  it("does not invent a global candidate merely because a group contains it", () => {
    expectChoices(
      targetAction({
        candidateTargetInstanceIds: ["a"],
        targetGroups: [
          {
            candidateTargetInstanceIds: ["a", "unknown"],
            requiredTargetCount: 1,
          },
        ],
      }),
      128,
      [["a"]],
      false
    );
  });

  it("does not exceed global counts to satisfy conflicting group counts", () => {
    expectChoices(
      targetAction({
        candidateTargetInstanceIds: ["a", "b"],
        targetGroups: [
          { candidateTargetInstanceIds: ["a", "b"], requiredTargetCount: 2 },
        ],
      }),
      128,
      [],
      false
    );
  });

  it("stops lazy enumeration after finding an additional legal group selection", () => {
    let indexedReads = 0;
    const candidates = new Proxy(
      Array.from({ length: 34 }, (_, index) => `target-${index}`),
      {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/.test(property)) {
            indexedReads += 1;
            if (indexedReads > 256) {
              throw new Error(
                "Enumerated raw groups after the legal selection limit"
              );
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expectChoices(
      targetAction({
        candidateTargetInstanceIds: candidates,
        requiredTargetCount: 0,
        maxTargetCount: 5,
        targetGroups: [
          {
            candidateTargetInstanceIds: candidates,
            requiredTargetCount: 0,
            maxTargetCount: 5,
          },
        ],
      }),
      1,
      [[]],
      true
    );
    expect(indexedReads).toBeLessThanOrEqual(256);
  });
});

describe("ordered target groups preserve per-step target allocation", () => {
  const targetGroups = ["first-step", "second-step"].map((targetStepId) => ({
    candidateTargetInstanceIds: ["a", "b"],
    requiredTargetCount: 1,
    maxTargetCount: 1,
    targetStepId,
  }));
  const action = targetAction({
    candidateTargetInstanceIds: ["a", "b"],
    requiredTargetCount: 2,
    maxTargetCount: 2,
    allowDuplicateTargets: false,
    targetGroups,
  });

  it.each([
    { limit: 0, values: [], truncated: true },
    { limit: 1, values: [["a", "b"]], truncated: true },
    {
      limit: 2,
      values: [
        ["a", "b"],
        ["b", "a"],
      ],
      truncated: false,
    },
    {
      limit: 128,
      values: [
        ["a", "b"],
        ["b", "a"],
      ],
      truncated: false,
    },
  ])(
    "counts distinct legal ordered group selections at limit $limit",
    ({ limit, values, truncated }) => {
      expectChoices(action, limit, values, truncated);
    }
  );

  it.each([
    { targetInstanceIds: ["a", "b"], first: "a", second: "b" },
    { targetInstanceIds: ["b", "a"], first: "b", second: "a" },
  ])(
    "accepts the ordered selection with $first in first-step and $second in second-step",
    ({ targetInstanceIds, first, second }) => {
      expect(
        assignLegalActionTargetGroups({
          targetInstanceIds,
          targetGroups,
          allowDuplicateTargets: false,
        })
      ).not.toBeNull();
      const allocation = allocateGroupedTargetsByStep({
        targetInstanceIds,
        targetGroups,
        allowDuplicateTargets: false,
      });
      expect(allocation.idsByStepId.get("first-step")).toEqual([first]);
      expect(allocation.idsByStepId.get("second-step")).toEqual([second]);
    }
  );
});

describe("ordered target group search bounds", () => {
  it("finds an extra legal permutation without scanning impossible six-slot prefixes", () => {
    const candidates = Array.from(
      { length: 16 },
      (_, index) => `target-${index}`
    );
    const requiredCandidates = candidates.slice(-6);
    let membershipChecks = 0;
    const observeMembership = (ids: string[]) =>
      new Proxy(ids, {
        get(target, property, receiver) {
          if (property === "includes") {
            return (id: string, fromIndex?: number) => {
              membershipChecks += 1;
              if (membershipChecks > 4096) {
                throw new Error(
                  "Scanned impossible group prefixes beyond 4096 membership checks"
                );
              }
              return target.includes(id, fromIndex);
            };
          }
          return Reflect.get(target, property, receiver);
        },
      });
    const action = targetAction({
      candidateTargetInstanceIds: candidates,
      requiredTargetCount: 6,
      maxTargetCount: 7,
      allowDuplicateTargets: false,
      targetGroups: [
        {
          candidateTargetInstanceIds: observeMembership([...candidates]),
          requiredTargetCount: 0,
          maxTargetCount: 1,
          targetStepId: "optional",
        },
        {
          candidateTargetInstanceIds: observeMembership([
            ...requiredCandidates,
          ]),
          requiredTargetCount: 6,
          maxTargetCount: 6,
          targetStepId: "required-six",
        },
      ],
    });
    expectChoices(action, 1, [requiredCandidates], true);
    expect(membershipChecks).toBeGreaterThan(0);
    expect(membershipChecks).toBeLessThanOrEqual(4096);
  });
});

function exhaustiveLegalTargetSelections(
  action: ResolvePendingEffectTargetLegalAction
): string[][] {
  const candidates = action.candidateTargetInstanceIds;
  const maximum = action.maxTargetCount ?? action.requiredTargetCount;
  const legal: string[][] = [];
  // Exhaust the small Cartesian powers by integer encoding. No prefix checks,
  // generator helpers, or early limit can hide a legal ordered tuple here.
  for (let count = 0; count <= maximum; count++) {
    for (let ordinal = 0; ordinal < candidates.length ** count; ordinal++) {
      const selected = Array<string>(count);
      let encoded = ordinal;
      for (let index = count - 1; index >= 0; index--) {
        selected[index] = candidates[encoded % candidates.length]!;
        encoded = Math.floor(encoded / candidates.length);
      }
      if (
        selected.length < action.requiredTargetCount ||
        selected.length > maximum ||
        (action.allowDuplicateTargets !== true &&
          new Set(selected).size !== selected.length) ||
        (action.mandatoryTargetInstanceIds ?? []).some(
          (id) => !selected.includes(id)
        ) ||
        assignLegalActionTargetGroups({
          targetInstanceIds: selected,
          targetGroups: action.targetGroups ?? [],
          allowDuplicateTargets: action.allowDuplicateTargets === true,
        }) === null
      ) {
        continue;
      }
      legal.push(selected);
    }
  }
  return legal;
}

describe("ordered target group pruning preserves an exhaustive small oracle", () => {
  const layouts: {
    label: string;
    required: number;
    maximum: number;
    groups: NonNullable<ResolvePendingEffectTargetLegalAction["targetGroups"]>;
  }[] = [
    {
      label: "identical pools",
      required: 2,
      maximum: 2,
      groups: [
        { candidateTargetInstanceIds: ["a", "b", "c"], requiredTargetCount: 1 },
        { candidateTargetInstanceIds: ["a", "b", "c"], requiredTargetCount: 1 },
      ],
    },
    {
      label: "overlapping pools",
      required: 2,
      maximum: 2,
      groups: [
        { candidateTargetInstanceIds: ["a", "b"], requiredTargetCount: 1 },
        { candidateTargetInstanceIds: ["b", "c"], requiredTargetCount: 1 },
      ],
    },
    {
      label: "restricted required slot and variable second group",
      required: 2,
      maximum: 3,
      groups: [
        { candidateTargetInstanceIds: ["a"], requiredTargetCount: 1 },
        {
          candidateTargetInstanceIds: ["a", "b", "c"],
          requiredTargetCount: 1,
          maxTargetCount: 2,
        },
      ],
    },
    {
      label: "optional slot overlaps a variable required group",
      required: 1,
      maximum: 3,
      groups: [
        {
          candidateTargetInstanceIds: ["a", "b", "c"],
          requiredTargetCount: 0,
          maxTargetCount: 1,
        },
        {
          candidateTargetInstanceIds: ["b", "c"],
          requiredTargetCount: 1,
          maxTargetCount: 2,
        },
      ],
    },
    {
      label: "all optional groups include the empty tuple",
      required: 0,
      maximum: 2,
      groups: [
        {
          candidateTargetInstanceIds: ["a", "b"],
          requiredTargetCount: 0,
          maxTargetCount: 1,
        },
        {
          candidateTargetInstanceIds: ["b", "c"],
          requiredTargetCount: 0,
          maxTargetCount: 1,
        },
      ],
    },
    {
      label: "duplicate permission determines satisfiability",
      required: 2,
      maximum: 2,
      groups: [
        { candidateTargetInstanceIds: ["a"], requiredTargetCount: 1 },
        { candidateTargetInstanceIds: ["a"], requiredTargetCount: 1 },
      ],
    },
    {
      label: "overlapping lower bounds can overcount a selected occurrence",
      required: 3,
      maximum: 3,
      groups: [
        { candidateTargetInstanceIds: ["a", "b"], requiredTargetCount: 2 },
        { candidateTargetInstanceIds: ["b", "c"], requiredTargetCount: 1 },
      ],
    },
    {
      label: "empty optional pool and candidates outside every group",
      required: 1,
      maximum: 2,
      groups: [
        {
          candidateTargetInstanceIds: [],
          requiredTargetCount: 0,
          maxTargetCount: 1,
        },
        { candidateTargetInstanceIds: ["a", "b"], requiredTargetCount: 1 },
      ],
    },
  ];

  it.each(layouts)(
    "matches the complete ordered oracle for $label",
    (layout) => {
      for (const allowDuplicateTargets of [false, true]) {
        for (const mandatoryTargetInstanceIds of [[], ["c"], ["a", "c"]]) {
          const action = targetAction({
            requiredTargetCount: layout.required,
            maxTargetCount: layout.maximum,
            targetGroups: layout.groups,
            allowDuplicateTargets,
            mandatoryTargetInstanceIds,
          });
          const oracle = exhaustiveLegalTargetSelections(action);
          const oracleKeys = oracle.map((ids) => JSON.stringify(ids)).sort();
          const label = `${layout.label}; duplicate=${allowDuplicateTargets}; mandatory=${mandatoryTargetInstanceIds.join(",")}`;
          for (const limit of [0, 1, 2, 128]) {
            const actual = targetSelectionsForAction(
              actionRecord(action),
              limit
            );
            const actualKeys = actual.values.map((ids) => JSON.stringify(ids));
            expect(actual.limit, label).toBe(limit);
            expect(actual.values.length, label).toBe(
              Math.min(limit, oracle.length)
            );
            expect(actual.truncated, label).toBe(oracle.length > limit);
            expect(new Set(actualKeys).size, label).toBe(actualKeys.length);
            for (const key of actualKeys)
              expect(oracleKeys, label).toContain(key);
            if (limit === 128)
              expect([...actualKeys].sort(), label).toEqual(oracleKeys);
          }
        }
      }
    }
  );
});
