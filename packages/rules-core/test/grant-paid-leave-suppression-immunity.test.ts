/**
 * engine-generic-effect-activation-causal-trigger cluster Step4:
 * `grant_paid_leave_suppression_immunity` CE 登録プリミティブ (BSGE01-R02
 * 【毒牙：モルター】バレットエディット下の「効果発揮時、対価を支払うことで、
 * それによってフィールドを離れるカードの効果は発揮されない」権利付与の土台)。
 *
 * このステップでは CE 登録 + query (`getPaidLeaveSuppressionImmunityCost`) のみを
 * 検証する。実際の宣言時対価支払い選択 (legal-actions 層) /
 * finalizeEffectResolution 側の離脱誘発抑制適用 / card-data 側の BSGE01-R02 配線は
 * 後続ステップで行う (grant_paid_prevention_immunity Step1 と同じ段階分け)。
 */
import { describe, it, expect } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { getPaidLeaveSuppressionImmunityCost } from "../src/effect/effect-resistance-check";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type { Effect } from "../src/dsl-types";
import type { CardDefinition } from "../src/model";

const ALICE = "player-1";

const HOST_DEF: CardDefinition = {
  cardNo: "HOST-01",
  name: "権利保持ホスト",
  printedCategory: "spirit",
  printedColors: ["red"],
  symbolColors: ["red"],
  printedCost: 4,
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
  textLines: [],
  images: {},
  tribe: "封魔",
  colors: ["red"],
} as unknown as CardDefinition;

const DEFS: Record<string, CardDefinition> = { "HOST-01": HOST_DEF };
const getDef = (id: string): CardDefinition | undefined => DEFS[id];

const GRANT_EFFECT: Effect = {
  timing: { kind: "continuous" },
  steps: [
    {
      action: {
        kind: "grant_paid_leave_suppression_immunity",
        target: { kind: "self" },
        cost: { resource: "count", amount: 1 },
        duration: { scope: "while_on_field" },
      },
    },
  ],
} as unknown as Effect;

describe("grant_paid_leave_suppression_immunity CE registration", () => {
  it("registers a CE on the host and getPaidLeaveSuppressionImmunityCost returns its cost", () => {
    let state = createEmptyGameState([ALICE, "player-2"]);
    const host = createCardInstance(HOST_DEF, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    state = { ...state, cardInstances: [...state.cardInstances, host] };

    state = executeEffect({
      chainId: "test:grant-paid-leave-suppression-immunity:65",
      state,
      effect: GRANT_EFFECT,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const cost = getPaidLeaveSuppressionImmunityCost(state, "host-1");
    expect(cost).toEqual({ resource: "count", amount: 1 });
  });

  it("returns null for a card with no such CE", () => {
    let state = createEmptyGameState([ALICE, "player-2"]);
    const host = createCardInstance(HOST_DEF, {
      instanceId: "host-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    state = { ...state, cardInstances: [...state.cardInstances, host] };

    expect(getPaidLeaveSuppressionImmunityCost(state, "host-2")).toBeNull();
  });

  it("does not cross-match a paid_prevention_immunity_offer CE (distinct modifierTag)", () => {
    let state = createEmptyGameState([ALICE, "player-2"]);
    const host = createCardInstance(HOST_DEF, {
      instanceId: "host-3",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    state = { ...state, cardInstances: [...state.cardInstances, host] };

    state = executeEffect({
      chainId: "test:grant-paid-leave-suppression-immunity:100",
      state,
      effect: {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "grant_paid_prevention_immunity",
              target: { kind: "self" },
              cost: { resource: "count", amount: 2 },
              duration: { scope: "while_on_field" },
            },
          },
        ],
      } as unknown as Effect,
      sourceInstanceId: "host-3",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    expect(getPaidLeaveSuppressionImmunityCost(state, "host-3")).toBeNull();
  });
});
