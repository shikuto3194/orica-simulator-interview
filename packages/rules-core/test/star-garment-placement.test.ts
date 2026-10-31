/**
 * P3-100 星霊衣 star_garment — S1 配置 (place_star_garment) のテスト。
 *
 * スコープ: host の合体ブレイヴ1つを分離し、その B面を表向きで host の下
 * (text_role アンダーカード) へ置く。離脱破棄 / host 効果集約 / 入替は別スライス。
 */
import { describe, it, expect } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { executeEffect } from "../src/effect/effect-interpreter";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { collectGameStateInvariantIssues } from "../src/invariants/game-state-invariants";
import { applyLegalAction, getLegalActions } from "../src/legal/legal-actions";
import {
  canUseEffectByUsageLimit,
  getCandidateTargetInstanceIds,
  getUsageLimitMaxCount,
  mergeRegistrationChoiceVariant,
} from "../src/legal/legal-actions-shared";
import { generateFieldCardEffectRegistrations } from "../src/effect/structured-effect-registrations";
import type { Effect } from "../src/dsl-types";
import type { CardDefinition, EffectUsageLimit, GameState } from "../src/model";

const ALICE = "player-1";
const BOB = "player-2";
const PROD_CARD_MAP = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));

function prodCard(cardNo: string): CardDefinition {
  const card = PROD_CARD_MAP.get(cardNo);
  if (!card) {
    throw new Error(`Missing production card: ${cardNo}`);
  }
  return card;
}

/** host スピリット (星霊衣を発揮する本体)。 */
const HOST_DEF = {
  cardNo: "SG-HOST",
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

/** 鍵ブレイヴ (B面=星霊衣 を持つ転醒ブレイヴ)。 */
const BRAVE_DEF = {
  cardNo: "SG-BRAVE-A",
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
    cardNo: "SG-BRAVE-B",
    name: "アクエリアス",
    printedCategory: "spirit",
    symbolColors: ["guide"],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 7000 }],
    textLines: [],
    tribe: "光導・星霊",
    colors: ["blue"],
  },
} as unknown as CardDefinition;

/** B面を持たない通常ブレイヴ (星霊衣で置けないことの確認用)。 */
const PLAIN_BRAVE_DEF = {
  ...BRAVE_DEF,
  cardNo: "SG-PLAIN-BRAVE",
  isDoubleSided: false,
  backFace: undefined,
} as unknown as CardDefinition;

const CANNOT_BE_UNDER_BRAVE_DEF = {
  ...BRAVE_DEF,
  cardNo: "SG-CANNOT-BE-UNDER",
  backFace: {
    ...BRAVE_DEF.backFace,
    cardNo: "SG-CANNOT-BE-UNDER-B",
    keywordTags: ["star_garment", "star_garment_cannot_be_under"],
  },
} as unknown as CardDefinition;

const OTHER_BRAVE_DEF = {
  ...BRAVE_DEF,
  cardNo: "SG-OTHER-BRAVE",
  name: "別のブレイヴ",
  backFace: {
    ...BRAVE_DEF.backFace,
    cardNo: "SG-OTHER-BRAVE-B",
  },
} as unknown as CardDefinition;

function makeState(braveDef: CardDefinition = BRAVE_DEF): {
  state: GameState;
  getDef: (id: string) => CardDefinition | undefined;
} {
  const brave = createCardInstance(braveDef, {
    instanceId: "brave-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });
  const host = createCardInstance(HOST_DEF, {
    instanceId: "host-1",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1,
  });
  // 合体: host の子に brave、brave の親に host。
  host.attachedChildrenIds = ["brave-1"];
  brave.attachedToInstanceId = "host-1";

  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const defs: Record<string, CardDefinition> = {
    "SG-HOST": HOST_DEF,
    "SG-BRAVE-A": braveDef,
    "SG-BRAVE-B": (braveDef.backFace as CardDefinition) ?? braveDef,
    "SG-PLAIN-BRAVE": PLAIN_BRAVE_DEF,
    "SG-CANNOT-BE-UNDER": CANNOT_BE_UNDER_BRAVE_DEF,
    "SG-CANNOT-BE-UNDER-B":
      (CANNOT_BE_UNDER_BRAVE_DEF.backFace as CardDefinition) ??
      CANNOT_BE_UNDER_BRAVE_DEF,
    "SG-OTHER-BRAVE": OTHER_BRAVE_DEF,
    "SG-OTHER-BRAVE-B":
      (OTHER_BRAVE_DEF.backFace as CardDefinition) ?? OTHER_BRAVE_DEF,
  };
  return {
    state: {
      ...base,
      activePlayerId: ALICE,
      cardInstances: [host, brave],
      activeContinuousEffects: [],
    },
    getDef: (id) => defs[id],
  };
}

const placeEffect: Effect = {
  timing: { kind: "activated", mode: "flash" },
  steps: [
    {
      action: {
        kind: "place_star_garment",
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

describe("P3-100 star_garment: S1 配置", () => {
  it("host の合体ブレイヴを分離し B面を host 下の text_role アンダーカードへ置く", () => {
    const { state, getDef } = makeState();
    const next = executeEffect({
      chainId: "test:star-garment-placement:172",
      state,
      effect: placeEffect,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      targetInstanceIds: ["brave-1"],
      targetSelectionResolved: true,
    });

    const host = next.cardInstances.find((c) => c.instanceId === "host-1")!;
    const brave = next.cardInstances.find((c) => c.instanceId === "brave-1")!;

    // host の合体ブレイヴから外れ、underCards に text_role/星霊衣 で登録
    expect(host.attachedChildrenIds).not.toContain("brave-1");
    expect(host.underCards).toEqual([
      { cardInstanceId: "brave-1", role: "text_role", roleTag: "星霊衣" },
    ]);

    // ブレイヴは B面 (backFace.cardNo) を表示し host の下に紐付く
    expect(brave.definitionId).toBe("SG-BRAVE-B");
    expect(brave.attachedToInstanceId).toBe("host-1");
    expect(brave.zoneRoleName).toBe("star-garment");
    expect(brave.faceDown).toBe(false);
    expect(brave.zone).toBe("field");
    expect(collectGameStateInvariantIssues(next)).toEqual([]);
  });

  it("裏向きの合体ブレイヴを置いても B面は表向き公開になる", () => {
    const { state, getDef } = makeState();
    const faceDownState: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "brave-1" ? { ...card, faceDown: true } : card
      ),
    };

    const next = executeEffect({
      chainId: "test:star-garment-placement:209",
      state: faceDownState,
      effect: placeEffect,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const brave = next.cardInstances.find((c) => c.instanceId === "brave-1")!;
    expect(brave.definitionId).toBe("SG-BRAVE-B");
    expect(brave.zoneRoleName).toBe("star-garment");
    expect(brave.faceDown).toBe(false);
  });

  it("裏向き候補のB面資格を保持しても印字名をfieldフィルタへ戻さない", () => {
    const { state, getDef } = makeState();
    const concealed: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "brave-1" ? { ...card, faceDown: true } : card
      ),
    };
    const registration = generateFieldCardEffectRegistrations({
      ...HOST_DEF,
      effects: [placeEffect],
    })[0]!;
    const options = {
      sourceInstanceId: "host-1",
      getCardDefinitionById: getDef,
    };
    expect(registration).toMatchObject({
      sourceAttachedChildrenOnly: true,
      starGarmentTargetEligibleOnly: true,
    });
    expect(
      getCandidateTargetInstanceIds(concealed, ALICE, registration, options)
    ).toEqual(["brave-1"]);
    expect(
      getCandidateTargetInstanceIds(
        concealed,
        ALICE,
        {
          ...registration,
          starGarmentTargetEligibleOnly: false,
        },
        options
      )
    ).toEqual([]);
    expect(
      getCandidateTargetInstanceIds(
        concealed,
        ALICE,
        {
          ...registration,
          targetCardFilter: {
            category: ["brave"],
            cardName: { exact: BRAVE_DEF.name },
          },
        },
        options
      )
    ).toEqual([]);
  });

  it.each([false, true])(
    "on_stepの星霊衣も発揮元の合体カードだけを選んで完走する (faceDown=%s)",
    (faceDown) => {
      const { state, getDef } = makeState();
      const otherHost = createCardInstance(HOST_DEF, {
        instanceId: "other-host",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      const otherBrave = createCardInstance(OTHER_BRAVE_DEF, {
        instanceId: "other-brave",
        ownerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
        attachedToInstanceId: otherHost.instanceId,
      });
      otherHost.attachedChildrenIds = [otherBrave.instanceId];
      const input: GameState = {
        ...state,
        cardInstances: [
          ...state.cardInstances.map((card) =>
            card.instanceId === "brave-1" ? { ...card, faceDown } : card
          ),
          otherHost,
          otherBrave,
        ],
      };
      const effect: Effect = {
        ...placeEffect,
        steps: [
          {
            targetSelectionTiming: "on_step",
            action: {
              kind: "place_star_garment",
              target: {
                kind: "filter",
                player: "self",
                count: { min: 0, max: 1 },
                filter: { category: ["brave"] },
              },
            },
          },
        ],
      };
      const pending = executeEffect({
        chainId: `star-on-step:${faceDown}`,
        state: input,
        effect,
        sourceInstanceId: "host-1",
        actingPlayerId: ALICE,
        getCardDefinitionById: getDef,
      });
      expect(
        pending.pendingStepOptionalTargetSelection?.candidateInstanceIds
      ).toEqual(["brave-1"]);
      const lookups = {
        getCardDefinitionById: getDef,
        getRegisteredFieldCardEffectActions: () => [],
        getRegisteredTriggeredEffectActions: () => [],
      };
      const action = getLegalActions({
        state: pending,
        actingPlayerId: ALICE,
        ...lookups,
      }).find(
        (entry) =>
          entry.kind === "resolve_pending_step_optional_target_selection"
      )!;
      const after = applyLegalAction({
        state: pending,
        action,
        targetInstanceIds: ["brave-1"],
        ...lookups,
      }).state;
      expect(after.pendingStepOptionalTargetSelection).toBeNull();
      expect(
        after.cardInstances.find((card) => card.instanceId === "brave-1")
      ).toMatchObject({
        definitionId: "SG-BRAVE-B",
        faceDown: false,
        zoneRoleName: "star-garment",
      });
      expect(
        after.cardInstances.find((card) => card.instanceId === "other-brave")
          ?.definitionId
      ).toBe(OTHER_BRAVE_DEF.cardNo);
      expect(
        after.cardInstances.find((card) => card.instanceId === "other-host")
          ?.attachedChildrenIds
      ).toEqual(["other-brave"]);
    }
  );

  it("B面 (backFace) を持たないブレイヴは星霊衣で置けない (no-op)", () => {
    const { state, getDef } = makeState(PLAIN_BRAVE_DEF);
    const next = executeEffect({
      chainId: "test:star-garment-placement:225",
      state,
      effect: placeEffect,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const host = next.cardInstances.find((c) => c.instanceId === "host-1")!;
    expect(host.attachedChildrenIds).toContain("brave-1");
    expect(host.underCards).toEqual([]);
  });

  it("置けないタグを持つ B面カードは星霊衣で置けない (no-op)", () => {
    const { state, getDef } = makeState(CANNOT_BE_UNDER_BRAVE_DEF);
    const next = executeEffect({
      chainId: "test:star-garment-placement:240",
      state,
      effect: placeEffect,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const host = next.cardInstances.find((c) => c.instanceId === "host-1")!;
    const brave = next.cardInstances.find((c) => c.instanceId === "brave-1")!;
    expect(host.attachedChildrenIds).toContain("brave-1");
    expect(host.underCards).toEqual([]);
    expect(brave.definitionId).toBe("SG-CANNOT-BE-UNDER");
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
      chainId: "test:star-garment-placement:263",
      state: { ...state, cardInstances: [...state.cardInstances, other] },
      effect: {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "place_star_garment",
              target: {
                kind: "filter",
                player: "self",
                count: 1,
                filter: { cardName: { exact: "別のブレイヴ" } },
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
    const brave = next.cardInstances.find((c) => c.instanceId === "brave-1")!;
    const otherAfter = next.cardInstances.find(
      (c) => c.instanceId === "other-1"
    )!;

    expect(host.attachedChildrenIds).toEqual(["brave-1"]);
    expect(host.underCards).toEqual([]);
    expect(brave.definitionId).toBe("SG-BRAVE-A");
    expect(otherAfter.definitionId).toBe("SG-OTHER-BRAVE");
  });

  it("target 解決候補が 0 件なら先頭合体ブレイヴへ fallback しない", () => {
    const { state, getDef } = makeState();
    const next = executeEffect({
      chainId: "test:star-garment-placement:300",
      state,
      effect: {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "place_star_garment",
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
    const brave = next.cardInstances.find((c) => c.instanceId === "brave-1")!;
    expect(host.attachedChildrenIds).toEqual(["brave-1"]);
    expect(host.underCards).toEqual([]);
    expect(brave.definitionId).toBe("SG-BRAVE-A");
  });

  it("星霊衣スロットが埋まっている host には追加配置しない", () => {
    const { state, getDef } = makeState();
    const occupiedState: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "host-1"
          ? {
              ...card,
              underCards: [
                {
                  cardInstanceId: "existing-under",
                  role: "text_role" as const,
                  roleTag: "星霊衣",
                },
              ],
            }
          : card
      ),
    };
    const next = executeEffect({
      chainId: "test:star-garment-placement:349",
      state: occupiedState,
      effect: placeEffect,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const host = next.cardInstances.find((c) => c.instanceId === "host-1")!;
    const brave = next.cardInstances.find((c) => c.instanceId === "brave-1")!;
    expect(host.attachedChildrenIds).toEqual(["brave-1"]);
    expect(host.underCards).toEqual([
      {
        cardInstanceId: "existing-under",
        role: "text_role",
        roleTag: "星霊衣",
      },
    ]);
    expect(brave.definitionId).toBe("SG-BRAVE-A");
    expect(next.log).toContain(
      "effect:place_star_garment:host-1:slot-full:星霊衣"
    );
  });

  it("離脱待機中の合体ブレイヴは星霊衣で置けない", () => {
    const { state, getDef } = makeState();
    const pendingState: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "brave-1"
          ? {
              ...card,
              pendingLeaveKind: "destroy" as const,
              pendingLeaveCause: "effect_resolution" as const,
              pendingLeaveChainId: "chain-brave-1",
            }
          : card
      ),
      pendingLeaveEntities: [
        {
          instanceId: "brave-1",
          kind: "destroy",
          cause: "effect_resolution",
          chainId: "chain-brave-1",
          controllerPlayerId: ALICE,
          ownerPlayerId: ALICE,
        },
      ],
    };

    const next = executeEffect({
      chainId: "test:star-garment-placement:399",
      state: pendingState,
      effect: placeEffect,
      sourceInstanceId: "host-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const host = next.cardInstances.find((c) => c.instanceId === "host-1")!;
    const brave = next.cardInstances.find((c) => c.instanceId === "brave-1")!;
    expect(host.attachedChildrenIds).toEqual(["brave-1"]);
    expect(host.underCards).toEqual([]);
    expect(brave.definitionId).toBe("SG-BRAVE-A");
    expect(brave.pendingLeaveKind).toBe("destroy");
  });

  it("legal action 候補は host に合体中のブレイヴだけに絞る", () => {
    const { state, getDef } = makeState();
    const other = createCardInstance(OTHER_BRAVE_DEF, {
      instanceId: "other-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const candidates = getCandidateTargetInstanceIds(
      { ...state, cardInstances: [...state.cardInstances, other] },
      ALICE,
      {
        requiredTargetCount: 1,
        candidateTargetZones: ["field"],
        candidateTargetPlayerScope: "acting_player",
        targetCardFilter: { category: ["brave"] },
        sourceAttachedChildrenOnly: true,
        starGarmentTargetEligibleOnly: true,
      },
      { sourceInstanceId: "host-1", getCardDefinitionById: getDef }
    );

    expect(candidates).toEqual(["brave-1"]);
  });

  it("legal action 候補は離脱待機中の合体ブレイヴを除外する", () => {
    const { state, getDef } = makeState();
    const pendingState: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "brave-1"
          ? {
              ...card,
              pendingLeaveKind: "destroy" as const,
              pendingLeaveCause: "effect_resolution" as const,
              pendingLeaveChainId: "chain-brave-1",
            }
          : card
      ),
    };
    const candidates = getCandidateTargetInstanceIds(
      pendingState,
      ALICE,
      {
        requiredTargetCount: 1,
        candidateTargetZones: ["field"],
        candidateTargetPlayerScope: "acting_player",
        targetCardFilter: { category: ["brave"] },
        sourceAttachedChildrenOnly: true,
        starGarmentTargetEligibleOnly: true,
      },
      { sourceInstanceId: "host-1", getCardDefinitionById: getDef }
    );

    expect(candidates).toEqual([]);
  });

  it("legal action 候補は星霊衣スロットが埋まっている host では空になる", () => {
    const { state, getDef } = makeState();
    const occupiedState: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "host-1"
          ? {
              ...card,
              underCards: [
                {
                  cardInstanceId: "existing-under",
                  role: "text_role" as const,
                  roleTag: "星霊衣",
                },
              ],
            }
          : card
      ),
    };
    const candidates = getCandidateTargetInstanceIds(
      occupiedState,
      ALICE,
      {
        requiredTargetCount: 1,
        candidateTargetZones: ["field"],
        candidateTargetPlayerScope: "acting_player",
        targetCardFilter: { category: ["brave"] },
        sourceAttachedChildrenOnly: true,
        starGarmentTargetEligibleOnly: true,
        sourceRequiredOpenUnderCardSlot: {
          role: "text_role",
          roleTag: "星霊衣",
          maxCount: 1,
        },
      },
      { sourceInstanceId: "host-1", getCardDefinitionById: getDef }
    );

    expect(candidates).toEqual([]);
  });

  it("legal action 候補は B面なし/置けないタグ持ちブレイヴを除外する", () => {
    for (const braveDef of [PLAIN_BRAVE_DEF, CANNOT_BE_UNDER_BRAVE_DEF]) {
      const { state, getDef } = makeState(braveDef);
      const candidates = getCandidateTargetInstanceIds(
        state,
        ALICE,
        {
          requiredTargetCount: 1,
          candidateTargetZones: ["field"],
          candidateTargetPlayerScope: "acting_player",
          targetCardFilter: { category: ["brave"] },
          sourceAttachedChildrenOnly: true,
          starGarmentTargetEligibleOnly: true,
        },
        { sourceInstanceId: "host-1", getCardDefinitionById: getDef }
      );

      expect(candidates).toEqual([]);
    }
  });

  it("choice 内の place_star_garment でも候補は host に合体中のブレイヴだけに絞る", () => {
    const { state, getDef } = makeState();
    const other = createCardInstance(OTHER_BRAVE_DEF, {
      instanceId: "other-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const choiceWrappedDef = {
      ...HOST_DEF,
      cardNo: "SG-HOST-CHOICE-PLACE",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "place_star_garment",
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
    });
    expect(mergedDefault.sourceAttachedChildrenOnly).toBe(true);
    expect(candidates).toEqual(["brave-1"]);
  });

  it("BSFT01-CX01 はカウント5以上で星霊衣配置のゲーム中上限が2回になる", () => {
    const cx01 = prodCard("BSFT01-CX01");
    const source = createCardInstance(cx01, {
      instanceId: "cx01-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const baseState = createEmptyGameState({
      cardInstances: [source],
      playerOverrides: [{ countValue: 3 }, {}],
    });
    const placeRegs = generateFieldCardEffectRegistrations(cx01).filter(
      (reg) => reg.limitGroupId === "BSFT01-CX01-star-garment-place"
    );
    const get = (id: string) => PROD_CARD_MAP.get(id);

    expect(placeRegs).toHaveLength(2);
    for (const reg of placeRegs) {
      expect(reg.activationLabel).toBe("none");
      expect(reg.usageLimit).toMatchObject({
        kind: "per_instance",
        duration: "game",
        maxCount: 1,
        maxCountOverrides: [
          {
            when: [{ kind: "count_value", player: "self", min: 5 }],
            maxCount: 2,
          },
        ],
      });
    }

    const limit = placeRegs[0]!.usageLimit as EffectUsageLimit;
    const usedState = (countValue: number, usedCount: number): GameState => ({
      ...baseState,
      players: baseState.players.map((player) =>
        player.id === ALICE ? { ...player, countValue } : player
      ),
      effectUsageRecords:
        usedCount > 0
          ? [
              {
                sourceInstanceId: "cx01-1",
                sourceDefinitionId: "BSFT01-CX01",
                playerId: ALICE,
                effectLabel: `effect:${placeRegs[0]!.effectIndex}`,
                turnNumber: baseState.turnNumber,
                step: baseState.step,
                duration: "game",
                count: usedCount,
                groupId: "BSFT01-CX01-star-garment-place",
              },
            ]
          : [],
    });
    const canUse = (countValue: number, usedCount: number) =>
      canUseEffectByUsageLimit({
        state: usedState(countValue, usedCount),
        sourceInstanceId: "cx01-1",
        sourceDefinitionId: "BSFT01-CX01",
        getCardDefinitionById: get,
        playerId: ALICE,
        effectLabel: `effect:${placeRegs[1]!.effectIndex}`,
        usageLimit: limit,
        groupId: "BSFT01-CX01-star-garment-place",
      });

    expect(
      getUsageLimitMaxCount(limit, {
        state: usedState(4, 0),
        sourceInstanceId: "cx01-1",
        sourceDefinitionId: "BSFT01-CX01",
        getCardDefinitionById: get,
      })
    ).toBe(1);
    expect(
      getUsageLimitMaxCount(limit, {
        state: usedState(5, 0),
        sourceInstanceId: "cx01-1",
        sourceDefinitionId: "BSFT01-CX01",
        getCardDefinitionById: get,
      })
    ).toBe(2);
    expect(canUse(4, 1)).toBe(false);
    expect(canUse(5, 1)).toBe(true);
    expect(canUse(5, 2)).toBe(false);

    const keyMagicLimit = cx01.effects![1]!.usageLimit as EffectUsageLimit;
    const protectedCountState = {
      ...usedState(8, 0),
      players: usedState(8, 0).players.map((player) =>
        player.id === ALICE
          ? { ...player, protectedCounts: { 神喰: 4 } }
          : player
      ),
    };
    expect(
      getUsageLimitMaxCount(keyMagicLimit, {
        state: protectedCountState,
        sourceInstanceId: "cx01-1",
        sourceDefinitionId: "BSFT01-CX01",
        getCardDefinitionById: get,
      })
    ).toBe(2);
  });

  it("[board] BSFT01-CX01[2] は印字どおり合体ブレイヴを星霊衣として下に置く", () => {
    const cx01 = prodCard("BSFT01-CX01");
    const get = (id: string) => PROD_CARD_MAP.get(id);
    const brave = createCardInstance(prodCard("BSFT01-TR01(A)"), {
      instanceId: "cx01-aquarius-key",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const host = createCardInstance(cx01, {
      instanceId: "cx01-star-garment-host",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: [brave.instanceId],
    });
    brave.attachedToInstanceId = host.instanceId;
    const before = createEmptyGameState({
      cardInstances: [host, brave],
      playerOverrides: [{ countValue: 5 }, {}],
    });

    const after = executeEffect({
      chainId: "test:star-garment-placement:716",
      state: before,
      effect: cx01.effects![2]!,
      sourceInstanceId: host.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: get,
      targetInstanceIds: [brave.instanceId],
      targetSelectionResolved: true,
    });

    const hostAfter = after.cardInstances.find(
      (instance) => instance.instanceId === host.instanceId
    )!;
    const braveAfter = after.cardInstances.find(
      (instance) => instance.instanceId === brave.instanceId
    )!;
    expect(hostAfter.attachedChildrenIds).toEqual([]);
    expect(hostAfter.underCards).toEqual([
      {
        cardInstanceId: brave.instanceId,
        role: "text_role",
        roleTag: "星霊衣",
      },
    ]);
    expect(braveAfter.definitionId).toBe("BSFT01-TR01(B)");
    expect(braveAfter.zoneRoleName).toBe("star-garment");
    expect(collectGameStateInvariantIssues(after)).toEqual([]);
  });
});
