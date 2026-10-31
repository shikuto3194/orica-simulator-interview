/**
 * ENGINE-bsge01-r04-paid-prevention-immunity Step 1:
 * `grant_paid_prevention_immunity` CE 登録プリミティブ (BSGE01-R02/R04
 * 【呪縛：モルター】等バレットエディット下の「効果発揮時、対価を支払うことで
 * その効果は相手の効果で防げなくなる」権利付与の土台)。
 *
 * このステップでは CE 登録 + query (`getPaidPreventionImmunityCost`) のみを検証する。
 * 実際の宣言時対価支払い選択 (legal-actions 層) / sourcePreventionLevel 上書き /
 * card-data 側の BSGE01-R02/R04 配線は後続ステップで行う。
 */
import { describe, it, expect } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { getPaidPreventionImmunityCost } from "../src/effect/effect-resistance-check";
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
        kind: "grant_paid_prevention_immunity",
        target: { kind: "self" },
        cost: { resource: "count", amount: 1 },
        duration: { scope: "while_on_field" },
      },
    },
  ],
} as unknown as Effect;

describe("grant_paid_prevention_immunity CE registration", () => {
  it("registers a CE on the host and getPaidPreventionImmunityCost returns its cost", () => {
    let state = createEmptyGameState([ALICE, "player-2"]);
    const host = createCardInstance(HOST_DEF, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    state = { ...state, cardInstances: [...state.cardInstances, host] };

    state = executeEffect({
      chainId: "test:grant-paid-prevention-immunity:64",
      state,
      effect: GRANT_EFFECT,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const cost = getPaidPreventionImmunityCost(state, "host-1");
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

    expect(getPaidPreventionImmunityCost(state, "host-2")).toBeNull();
  });

  // ENGINE-paid-prevention-immunity-card-cost-variant Step1: cost.resource:"card"
  // (BSKB01-X01 系鋼騎士除外型を想定) の型・パススルーのみを検証する。affordability
  // 判定/支払い実行 (legal-actions 層) は未配線のため、ここでは query の一致だけを見る。
  const GRANT_EFFECT_CARD_COST: Effect = {
    timing: { kind: "continuous" },
    steps: [
      {
        action: {
          kind: "grant_paid_prevention_immunity",
          target: { kind: "self" },
          cost: {
            resource: "card",
            amount: 3,
            zone: "trash",
            filter: { tribes: ["鋼騎士"] },
          },
          duration: { scope: "while_on_field" },
        },
      },
    ],
  } as unknown as Effect;

  it("registers a card-resource cost CE and getPaidPreventionImmunityCost passes it through", () => {
    let state = createEmptyGameState([ALICE, "player-2"]);
    const host = createCardInstance(HOST_DEF, {
      instanceId: "host-3",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    state = { ...state, cardInstances: [...state.cardInstances, host] };

    state = executeEffect({
      chainId: "test:grant-paid-prevention-immunity:121",
      state,
      effect: GRANT_EFFECT_CARD_COST,
      sourceInstanceId: "host-3",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const cost = getPaidPreventionImmunityCost(state, "host-3");
    expect(cost).toEqual({
      resource: "card",
      amount: 3,
      zone: "trash",
      filter: { tribes: ["鋼騎士"] },
    });
  });
});
