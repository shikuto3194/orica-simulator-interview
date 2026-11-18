/**
 * P3-100 星霊衣 star_garment — S4 入替 (swap_star_garment) のテスト。
 *
 * スコープ: host 下の星霊衣カード1枚を A面の正規合体ブレイヴとして表に出し、
 * host の合体ブレイヴ1つを B面の星霊衣アンダーカードへ入れ替える。
 */
import { describe, it, expect } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { collectGameStateInvariantIssues } from "../src/invariants/game-state-invariants";
import {
  getCandidateTargetInstanceIds,
  mergeRegistrationChoiceVariant,
} from "../src/legal/legal-actions-shared";
import { generateFieldCardEffectRegistrations } from "../src/effect/structured-effect-registrations";
import type { Effect } from "../src/dsl-types";
import type { CardDefinition, GameState } from "../src/model";

const ALICE = "player-1";
const BOB = "player-2";

const HOST_DEF = {
  cardNo: "SG-SWAP-HOST",
  name: "ルーシィ",
  printedCategory: "spirit",
  printedColors: ["blue"],
  symbolColors: ["guide"],
  printedCost: 2,
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  textLines: [],
  images: {},
  tribe: "星霊魔導士",
  colors: ["blue"],
} as CardDefinition;

const AQUARIUS_FRONT = {
  cardNo: "SG-SWAP-A",
  name: "宝瓶宮の鍵",
  printedCategory: "brave",
  printedColors: ["blue"],
  symbolColors: [],
  printedCost: 5,
  cost: 5,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  textLines: [],
  images: {},
  tribe: "鍵・光導",
  colors: ["blue"],
  isDoubleSided: true,
  backFace: {
    cardNo: "SG-SWAP-A-B",
    name: "アクエリアス",
    printedCategory: "spirit",
    symbolColors: ["guide"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 7000 }],
    textLines: [],
    tribe: "光導・星霊",
    colors: ["blue"],
  },
} as unknown as CardDefinition;

const LEO_FRONT = {
  cardNo: "SG-SWAP-B",
  name: "獅子宮の鍵",
  printedCategory: "brave",
  printedColors: ["blue"],
  symbolColors: [],
  printedCost: 5,
  cost: 5,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  textLines: [],
  images: {},
  tribe: "鍵・光導",
  colors: ["blue"],
  isDoubleSided: true,
  backFace: {
    cardNo: "SG-SWAP-B-B",
    name: "レオ",
    printedCategory: "spirit",
    symbolColors: ["guide"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 7000 }],
    textLines: [],
    tribe: "光導・星霊",
    colors: ["blue"],
  },
} as unknown as CardDefinition;

const PLAIN_BRAVE_DEF = {
  ...LEO_FRONT,
  cardNo: "SG-SWAP-PLAIN",
  isDoubleSided: false,
  backFace: undefined,
} as unknown as CardDefinition;

const CANNOT_BE_UNDER_BRAVE_DEF = {
  ...LEO_FRONT,
  cardNo: "SG-SWAP-CANNOT",
  backFace: {
    ...LEO_FRONT.backFace,
    cardNo: "SG-SWAP-CANNOT-B",
    keywordTags: ["star_garment", "star_garment_cannot_be_under"],
  },
} as unknown as CardDefinition;

const OTHER_BRAVE_DEF = {
  ...LEO_FRONT,
  cardNo: "SG-SWAP-OTHER",
  name: "別の星霊衣候補",
  backFace: {
    ...LEO_FRONT.backFace,
    cardNo: "SG-SWAP-OTHER-B",
    keywordTags: ["star_garment"],
  },
} as unknown as CardDefinition;

function makeState(incomingDef: CardDefinition = LEO_FRONT): {
  state: GameState;
  getDef: (id: string) => CardDefinition | undefined;
} {
  const host = createCardInstance(HOST_DEF, {
    instanceId: "host-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  const under = createCardInstance(AQUARIUS_FRONT, {
    instanceId: "under-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });
  under.definitionId = "SG-SWAP-A-B";
  under.attachedToInstanceId = "host-1";
  under.zoneRoleName = "star-garment";

  const incoming = createCardInstance(incomingDef, {
    instanceId: "incoming-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });
  incoming.attachedToInstanceId = "host-1";
  host.attachedChildrenIds = ["incoming-1"];
  host.underCards = [
    { cardInstanceId: "under-1", role: "text_role", roleTag: "星霊衣" },
  ];

  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const defs: Record<string, CardDefinition> = {
    "SG-SWAP-HOST": HOST_DEF,
    "SG-SWAP-A": AQUARIUS_FRONT,
    "SG-SWAP-A-B": AQUARIUS_FRONT.backFace as CardDefinition,
    "SG-SWAP-B": incomingDef,
    "SG-SWAP-B-B": (incomingDef.backFace as CardDefinition) ?? incomingDef,
    "SG-SWAP-PLAIN": PLAIN_BRAVE_DEF,
    "SG-SWAP-CANNOT": CANNOT_BE_UNDER_BRAVE_DEF,
    "SG-SWAP-CANNOT-B":
      (CANNOT_BE_UNDER_BRAVE_DEF.backFace as CardDefinition) ??
      CANNOT_BE_UNDER_BRAVE_DEF,
    "SG-SWAP-OTHER": OTHER_BRAVE_DEF,
    "SG-SWAP-OTHER-B":
      (OTHER_BRAVE_DEF.backFace as CardDefinition) ?? OTHER_BRAVE_DEF,
  };

  return {
    state: {
      ...base,
      activePlayerId: ALICE,
      cardInstances: [host, under, incoming],
      activeContinuousEffects: [],
    },
    getDef: (id) => defs[id],
  };
}

const swapEffect: Effect = {
  timing: { kind: "activated", mode: "flash" },
  steps: [
    {
      action: {
        kind: "swap_star_garment",
        target: {
          kind: "filter",
          player: "self",
          count: 1,
          filter: { category: ["brave"] },
        },
      },
    },
  ],
} as unknown as Effect;

describe("P3-100 star_garment: S4 入替", () => {
  it("下の星霊衣を A面合体ブレイヴに戻し、合体中ブレイヴを B面 under-card にする", () => {
    const { state, getDef } = makeState();
    const next = executeEffect({
      chainId: "test:star-garment-swap:200",
      state,
      effect: swapEffect,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      targetInstanceIds: ["incoming-1"],
      targetSelectionResolved: true,
    });

    const host = next.cardInstances.find((c) => c.instanceId === "host-1")!;
    const outgoing = next.cardInstances.find(
      (c) => c.instanceId === "under-1"
    )!;
    const incoming = next.cardInstances.find(
      (c) => c.instanceId === "incoming-1"
    )!;

    expect(host.attachedChildrenIds).toEqual(["under-1"]);
    expect(host.underCards).toEqual([
      { cardInstanceId: "incoming-1", role: "text_role", roleTag: "星霊衣" },
    ]);

    expect(outgoing.definitionId).toBe("SG-SWAP-A");
    expect(outgoing.attachedToInstanceId).toBe("host-1");
    expect(outgoing.zoneRoleName).toBe("brave");

    expect(incoming.definitionId).toBe("SG-SWAP-B-B");
    expect(incoming.attachedToInstanceId).toBe("host-1");
    expect(incoming.zoneRoleName).toBe("star-garment");
    expect(collectGameStateInvariantIssues(next)).toEqual([]);
  });

  it("B面を持たない合体ブレイヴとは入れ替えない", () => {
    const { state, getDef } = makeState(PLAIN_BRAVE_DEF);
    const next = executeEffect({
      chainId: "test:star-garment-swap:235",
      state,
      effect: swapEffect,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const host = next.cardInstances.find((c) => c.instanceId === "host-1")!;
    const outgoing = next.cardInstances.find(
      (c) => c.instanceId === "under-1"
    )!;
    const incoming = next.cardInstances.find(
      (c) => c.instanceId === "incoming-1"
    )!;

    expect(host.attachedChildrenIds).toEqual(["incoming-1"]);
    expect(host.underCards).toEqual([
      { cardInstanceId: "under-1", role: "text_role", roleTag: "星霊衣" },
    ]);
    expect(outgoing.definitionId).toBe("SG-SWAP-A-B");
    expect(incoming.definitionId).toBe("SG-SWAP-PLAIN");
  });

  it("置けないタグを持つ合体ブレイヴとは入れ替えない", () => {
    const { state, getDef } = makeState(CANNOT_BE_UNDER_BRAVE_DEF);
    const next = executeEffect({
      chainId: "test:star-garment-swap:261",
      state,
      effect: swapEffect,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const host = next.cardInstances.find((c) => c.instanceId === "host-1")!;
    const outgoing = next.cardInstances.find(
      (c) => c.instanceId === "under-1"
    )!;
    const incoming = next.cardInstances.find(
      (c) => c.instanceId === "incoming-1"
    )!;

    expect(host.attachedChildrenIds).toEqual(["incoming-1"]);
    expect(host.underCards).toEqual([
      { cardInstanceId: "under-1", role: "text_role", roleTag: "星霊衣" },
    ]);
    expect(outgoing.definitionId).toBe("SG-SWAP-A-B");
    expect(incoming.definitionId).toBe("SG-SWAP-CANNOT");
  });

  it("target が host の合体ブレイヴでなければ先頭合体ブレイヴへ fallback しない", () => {
    const { state, getDef } = makeState();
    const other = createCardInstance(OTHER_BRAVE_DEF, {
      instanceId: "other-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const next = executeEffect({
      chainId: "test:star-garment-swap:293",
      state: {
        ...state,
        cardInstances: [...state.cardInstances, other],
      },
      effect: {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "swap_star_garment",
              target: {
                kind: "filter",
                player: "self",
                count: 1,
                filter: { cardName: { exact: "別の星霊衣候補" } },
              },
            },
          },
        ],
      } as unknown as Effect,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const host = next.cardInstances.find((c) => c.instanceId === "host-1")!;
    const outgoing = next.cardInstances.find(
      (c) => c.instanceId === "under-1"
    )!;
    const incoming = next.cardInstances.find(
      (c) => c.instanceId === "incoming-1"
    )!;
    const otherAfter = next.cardInstances.find(
      (c) => c.instanceId === "other-1"
    )!;

    expect(host.attachedChildrenIds).toEqual(["incoming-1"]);
    expect(host.underCards).toEqual([
      { cardInstanceId: "under-1", role: "text_role", roleTag: "星霊衣" },
    ]);
    expect(outgoing.definitionId).toBe("SG-SWAP-A-B");
    expect(incoming.definitionId).toBe("SG-SWAP-B");
    expect(otherAfter.definitionId).toBe("SG-SWAP-OTHER");
  });

  it("target 解決候補が 0 件なら先頭合体ブレイヴへ fallback しない", () => {
    const { state, getDef } = makeState();
    const next = executeEffect({
      chainId: "test:star-garment-swap:341",
      state,
      effect: {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "swap_star_garment",
              target: {
                kind: "filter",
                player: "self",
                count: 1,
                filter: { cardName: { exact: "存在しないブレイヴ" } },
              },
            },
          },
        ],
      } as unknown as Effect,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const host = next.cardInstances.find((c) => c.instanceId === "host-1")!;
    const outgoing = next.cardInstances.find(
      (c) => c.instanceId === "under-1"
    )!;
    const incoming = next.cardInstances.find(
      (c) => c.instanceId === "incoming-1"
    )!;

    expect(host.attachedChildrenIds).toEqual(["incoming-1"]);
    expect(host.underCards).toEqual([
      { cardInstanceId: "under-1", role: "text_role", roleTag: "星霊衣" },
    ]);
    expect(outgoing.definitionId).toBe("SG-SWAP-A-B");
    expect(incoming.definitionId).toBe("SG-SWAP-B");
  });

  it("離脱待機中の合体ブレイヴとは入れ替えない", () => {
    const { state, getDef } = makeState();
    const pendingState: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "incoming-1"
          ? {
              ...card,
              pendingLeaveKind: "destroy" as const,
              pendingLeaveCause: "effect_resolution" as const,
              pendingLeaveChainId: "chain-incoming-1",
            }
          : card
      ),
      pendingLeaveEntities: [
        {
          instanceId: "incoming-1",
          kind: "destroy",
          cause: "effect_resolution",
          chainId: "chain-incoming-1",
          controllerPlayerId: ALICE,
          ownerPlayerId: ALICE,
        },
      ],
    };

    const next = executeEffect({
      chainId: "test:star-garment-swap:406",
      state: pendingState,
      effect: swapEffect,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const host = next.cardInstances.find((c) => c.instanceId === "host-1")!;
    const outgoing = next.cardInstances.find(
      (c) => c.instanceId === "under-1"
    )!;
    const incoming = next.cardInstances.find(
      (c) => c.instanceId === "incoming-1"
    )!;

    expect(host.attachedChildrenIds).toEqual(["incoming-1"]);
    expect(host.underCards).toEqual([
      { cardInstanceId: "under-1", role: "text_role", roleTag: "星霊衣" },
    ]);
    expect(outgoing.definitionId).toBe("SG-SWAP-A-B");
    expect(incoming.definitionId).toBe("SG-SWAP-B");
    expect(incoming.pendingLeaveKind).toBe("destroy");
  });

  it("stale underCards entry は invariant 違反になり、入替実行でも信用しない", () => {
    const { state, getDef } = makeState();
    const staleState: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "under-1"
          ? { ...card, attachedToInstanceId: null }
          : card
      ),
    };

    expect(collectGameStateInvariantIssues(staleState)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "under_card_parent_mismatch" }),
      ])
    );

    const next = executeEffect({
      chainId: "test:star-garment-swap:448",
      state: staleState,
      effect: swapEffect,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const host = next.cardInstances.find((c) => c.instanceId === "host-1")!;
    const outgoing = next.cardInstances.find(
      (c) => c.instanceId === "under-1"
    )!;
    const incoming = next.cardInstances.find(
      (c) => c.instanceId === "incoming-1"
    )!;

    expect(next.log).toContain(
      "effect:swap_star_garment:under-1:under-missing"
    );
    expect(host.attachedChildrenIds).toEqual(["incoming-1"]);
    expect(host.underCards).toEqual([
      { cardInstanceId: "under-1", role: "text_role", roleTag: "星霊衣" },
    ]);
    expect(outgoing.definitionId).toBe("SG-SWAP-A-B");
    expect(incoming.definitionId).toBe("SG-SWAP-B");
  });

  it("advent_source underCards は既存モデル通り attachedToInstanceId=null を許す", () => {
    const host = createCardInstance(HOST_DEF, {
      instanceId: "advent-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const source = createCardInstance(LEO_FRONT, {
      instanceId: "advent-source",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    host.underCards = [
      { cardInstanceId: source.instanceId, role: "advent_source" },
    ];
    source.attachedToInstanceId = null;
    const state = createEmptyGameState({ cardInstances: [host, source] });

    expect(collectGameStateInvariantIssues(state)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "under_card_parent_mismatch" }),
      ])
    );
  });

  it("choice 内の swap_star_garment でも候補は host に合体中のブレイヴだけに絞る", () => {
    const { state, getDef } = makeState();
    const other = createCardInstance(OTHER_BRAVE_DEF, {
      instanceId: "other-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const choiceWrappedDef = {
      ...HOST_DEF,
      cardNo: "SG-SWAP-HOST-CHOICE",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "swap_star_garment",
                target: {
                  kind: "filter",
                  player: "self",
                  count: 1,
                  filter: { category: ["brave"] },
                },
              },
              choice: [{ action: { kind: "draw", count: 1 } }],
            },
          ],
        },
      ],
    } as unknown as CardDefinition;
    const registration =
      generateFieldCardEffectRegistrations(choiceWrappedDef)[0]!;
    const mergedDefault = mergeRegistrationChoiceVariant(
      registration,
      registration.choices![0]!
    );

    const candidates = getCandidateTargetInstanceIds(
      { ...state, cardInstances: [...state.cardInstances, other] },
      ALICE,
      mergedDefault,
      { sourceInstanceId: "host-1", getCardDefinitionById: getDef }
    );

    expect(registration.choices![0]).toMatchObject({
      sourceAttachedChildrenOnly: true,
      starGarmentTargetEligibleOnly: true,
      sourceRequiredUnderCard: { role: "text_role", roleTag: "星霊衣" },
    });
    expect(mergedDefault.sourceAttachedChildrenOnly).toBe(true);
    expect(candidates).toEqual(["incoming-1"]);
  });
});
