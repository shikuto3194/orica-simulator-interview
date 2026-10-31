/**
 * 合体ユニットの attack 宣言時に attached brave の battle_immediate registration が
 * dispatch されることを検証する。
 *
 * 退行防止: 以前は queueRegisteredBattleImmediateEffects が host (= options.sourceCard)
 * の cardNo だけを registration lookup していたため、brave 側の【合体中】
 * 『このブレイヴ/スピリットのアタック時』効果が production の attack 経路では
 * queue されず no-op だった (audit-bsge01-followup-verifier
 * ENGINE-brave-attached-member-attack-dispatch, 2026-06-21)。
 *
 * 修正後は attached brave のカード定義に登録された attack timing battle_immediate
 * が host attack 時に prompt として battleImmediateEffects へ積まれる。
 */
import { describe, expect, it } from "vitest";
import { queueRegisteredBattleImmediateEffects } from "../src/battle/battle-immediate-effect-system";
import { buildFieldCardEffectLookup } from "../src/effect/structured-effect-registrations";
import { getAvailableFieldCardEffectLegalActions } from "../src/legal/legal-actions-availability";
import {
  buildBattleImmediateEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState } from "../src/model";

function makeHost(): CardDefinition {
  return {
    cardNo: "BRV-DISP-HOST",
    name: "host",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  } as CardDefinition;
}

function makeBraveWithAttackEffect(): CardDefinition {
  return {
    cardNo: "BRV-DISP-BRAVE",
    name: "brave with attack-time count_increase",
    printedCategory: "brave",
    colors: ["white"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["white"],
    textLines: [
      "【合体中】『このスピリットのアタック時』自分のカウント+1する。",
    ],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "card_event", event: "attack" },
        condition: [{ kind: "combined" }],
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 1,
            },
          },
        ],
        textRef: [0],
      },
    ],
  } as CardDefinition;
}

function makeHostWithLevelTwo(): CardDefinition {
  return {
    ...makeHost(),
    cardNo: "BRV-DISP-HOST-LV2",
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 3000 },
      { level: 2, requiredCores: 2, bp: 5000 },
    ],
  } as CardDefinition;
}

function makeCombinedBraveWithHostLevelCondition(): CardDefinition {
  return {
    ...makeBraveWithAttackEffect(),
    cardNo: "BRV-DISP-BRAVE-HOST-LV",
    effects: [
      {
        timing: { kind: "card_event", event: "attack" },
        applicability: { combined: true },
        condition: [{ kind: "combined" }, { kind: "min_level", value: 2 }],
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 1,
            },
          },
        ],
        textRef: [0],
      },
    ],
  } as CardDefinition;
}

function makeNativeBraveWithAttackEffect(): CardDefinition {
  return {
    ...makeBraveWithAttackEffect(),
    cardNo: "BRV-DISP-NATIVE-BRAVE",
    name: "native brave with attack-time count_increase",
    textLines: ["『このブレイヴのアタック時』自分のカウント+1する。"],
  } as CardDefinition;
}

function makeImaginDualBraveWithRightHostNameCondition(): CardDefinition {
  return {
    ...makeBraveWithAttackEffect(),
    cardNo: "BRV-DISP-IMAGIN-RIGHT-HOST-CONDITION",
    textLines: [
      "【左右合体中】『このスピリットのアタック時』右ホストなら自分のカウント+1する。",
    ],
    effects: [
      {
        timing: { kind: "card_event", event: "attack" },
        applicability: { imaginDualCombined: true },
        condition: [
          {
            kind: "combined_host_card_name",
            cardNames: [{ exact: "Right Host" }],
          },
        ],
        steps: [
          {
            action: {
              kind: "count_increase",
              player: "self",
              amount: 1,
            },
          },
        ],
        textRef: [0],
      },
    ],
  } as CardDefinition;
}

function makeImaginDualBraveWithActivatedEffect(): CardDefinition {
  return {
    ...makeBraveWithAttackEffect(),
    cardNo: "BRV-DISP-IMAGIN-FIELD",
    textLines: ["【左右合体中】フラッシュ：自分はデッキから1枚ドローする。"],
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        applicability: { imaginDualCombined: true },
        steps: [
          {
            action: { kind: "draw", player: "self", count: 1 },
          },
        ],
        textRef: [0],
      },
    ],
  } as CardDefinition;
}

describe("brave-attached attack dispatch", () => {
  it("attached brave の card_event:attack registration が host のアタック時に queue される", () => {
    const hostDef = makeHost();
    const braveDef = makeBraveWithAttackEffect();
    const lookup = (id: string): CardDefinition | undefined =>
      id === hostDef.cardNo
        ? hostDef
        : id === braveDef.cardNo
          ? braveDef
          : undefined;

    const host = {
      ...createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      attachedChildrenIds: ["brave-1"],
    };
    const brave = {
      ...createCardInstance(braveDef, {
        instanceId: "brave-1",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      attachedToInstanceId: "host-1",
    };

    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave],
      }),
      activePlayerId: "alice",
      step: "attack",
      turnNumber: 2,
    };

    const registrationLookup = buildBattleImmediateEffectLookup([
      hostDef,
      braveDef,
    ]);

    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-1",
      participantEntityId: "battle-entity:host-1",
      actingPlayerId: "alice",
      sourceCard: host,
      sourceDefinition: hostDef,
      timing: "attack",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: registrationLookup,
    });

    const bravePrompts = queued.battleImmediateEffects.filter(
      (p) => p.sourceEffectInstanceId === "brave-1"
    );
    expect(bravePrompts).toHaveLength(1);
    expect(bravePrompts[0]).toMatchObject({
      timing: "attack",
      sourceCardNo: braveDef.cardNo,
      sourceInstanceId: "host-1",
      sourceDefinitionId: hostDef.cardNo,
      sourceEffectInstanceId: "brave-1",
      sourceEffectDefinitionId: braveDef.cardNo,
      participantEntityId: "battle-entity:host-1",
      actingPlayerId: "alice",
    });
  });

  it("host 側に attack registration が無くても brave 側だけで prompt が積まれる", () => {
    const hostDef = makeHost(); // no effects
    const braveDef = makeBraveWithAttackEffect();
    const lookup = (id: string): CardDefinition | undefined =>
      id === hostDef.cardNo
        ? hostDef
        : id === braveDef.cardNo
          ? braveDef
          : undefined;

    const host = {
      ...createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      attachedChildrenIds: ["brave-1"],
    };
    const brave = {
      ...createCardInstance(braveDef, {
        instanceId: "brave-1",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      attachedToInstanceId: "host-1",
    };

    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave],
      }),
      activePlayerId: "alice",
      step: "attack",
      turnNumber: 2,
    };

    const registrationLookup = buildBattleImmediateEffectLookup([
      hostDef,
      braveDef,
    ]);

    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-2",
      participantEntityId: "battle-entity:host-1",
      actingPlayerId: "alice",
      sourceCard: host,
      sourceDefinition: hostDef,
      timing: "attack",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: registrationLookup,
    });

    expect(queued.battleImmediateEffects).toHaveLength(1);
    expect(queued.battleImmediateEffects[0]).toMatchObject({
      sourceInstanceId: "host-1",
      sourceDefinitionId: hostDef.cardNo,
      sourceEffectInstanceId: "brave-1",
      sourceEffectDefinitionId: braveDef.cardNo,
    });
  });

  it("【合体中】表記のない attached brave の attack registration は host attack で queue されない", () => {
    const hostDef = makeHost();
    const braveDef = makeNativeBraveWithAttackEffect();
    const lookup = (id: string): CardDefinition | undefined =>
      id === hostDef.cardNo
        ? hostDef
        : id === braveDef.cardNo
          ? braveDef
          : undefined;
    const host = {
      ...createCardInstance(hostDef, {
        instanceId: "host-native",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      attachedChildrenIds: ["brave-native"],
    };
    const brave = {
      ...createCardInstance(braveDef, {
        instanceId: "brave-native",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      attachedToInstanceId: host.instanceId,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave],
      }),
      activePlayerId: "alice",
      step: "attack",
      turnNumber: 2,
    };

    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-native-brave",
      participantEntityId: "battle-entity:host-native",
      actingPlayerId: "alice",
      sourceCard: host,
      sourceDefinition: hostDef,
      timing: "attack",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup([hostDef, braveDef]),
    });

    expect(queued.battleImmediateEffects).toHaveLength(0);
  });

  it("faceDown の brave は battle_immediate を発火しない (P3-69 印字能力なし)", () => {
    const hostDef = makeHost();
    const braveDef = makeBraveWithAttackEffect();
    const lookup = (id: string): CardDefinition | undefined =>
      id === hostDef.cardNo
        ? hostDef
        : id === braveDef.cardNo
          ? braveDef
          : undefined;

    const host = {
      ...createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      attachedChildrenIds: ["brave-1"],
    };
    const brave = {
      ...createCardInstance(braveDef, {
        instanceId: "brave-1",
        ownerPlayerId: "alice",
        zone: "field",
        faceDown: true,
      }),
      attachedToInstanceId: "host-1",
    };

    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave],
      }),
      activePlayerId: "alice",
      step: "attack",
      turnNumber: 2,
    };

    const registrationLookup = buildBattleImmediateEffectLookup([
      hostDef,
      braveDef,
    ]);

    const queued = queueRegisteredBattleImmediateEffects({
      state,
      attackId: "attack-3",
      participantEntityId: "battle-entity:host-1",
      actingPlayerId: "alice",
      sourceCard: host,
      sourceDefinition: hostDef,
      timing: "attack",
      getCardDefinitionById: lookup,
      getRegisteredBattleImmediateEffectActions: registrationLookup,
    });

    expect(queued.battleImmediateEffects).toHaveLength(0);
  });

  it("host prompt の combined brave min_level condition は host level で legal action に残る", () => {
    const hostDef = makeHostWithLevelTwo();
    const braveDef = makeCombinedBraveWithHostLevelCondition();
    const lookup = (id: string): CardDefinition | undefined =>
      id === hostDef.cardNo
        ? hostDef
        : id === braveDef.cardNo
          ? braveDef
          : undefined;

    const host = {
      ...createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 2,
      }),
      attachedChildrenIds: ["brave-1"],
    };
    const brave = {
      ...createCardInstance(braveDef, {
        instanceId: "brave-1",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      attachedToInstanceId: "host-1",
    };
    const registrationLookup = buildBattleImmediateEffectLookup([
      hostDef,
      braveDef,
    ]);
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave],
      }),
      activePlayerId: "alice",
      step: "attack",
      turnNumber: 2,
      battleImmediateEffects: [
        {
          promptId: "battle-immediate:host-level",
          attackId: "attack-4",
          timing: "attack",
          sourceKind: "spirit",
          sourceInstanceId: "host-1",
          sourceDefinitionId: hostDef.cardNo,
          sourceEffectDefinitionId: braveDef.cardNo,
          sourceEffectInstanceId: "brave-1",
          sourceCardNo: braveDef.cardNo,
          actingPlayerId: "alice",
          participantEntityId: "battle-entity:host-1",
          registrationIndex: 0,
        },
      ],
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBattleImmediateEffectActions: registrationLookup,
    });

    expect(
      actions.some(
        (action) =>
          action.kind === "resolve_battle_immediate_effect" &&
          action.promptId === "battle-immediate:host-level" &&
          action.sourceInstanceId === "host-1" &&
          action.sourceEffectInstanceId === "brave-1" &&
          action.skipOnly !== true
      )
    ).toBe(true);
  });

  it("right-slot imagin brave uses the selected right host for its combined-host condition", () => {
    const leftHostDef = {
      ...makeHost(),
      cardNo: "BRV-DISP-IMAGIN-LEFT",
      name: "Left Host",
    } as CardDefinition;
    const rightHostDef = {
      ...makeHost(),
      cardNo: "BRV-DISP-IMAGIN-RIGHT",
      name: "Right Host",
    } as CardDefinition;
    const braveDef = makeImaginDualBraveWithRightHostNameCondition();
    const lookup = (id: string): CardDefinition | undefined =>
      id === leftHostDef.cardNo
        ? leftHostDef
        : id === rightHostDef.cardNo
          ? rightHostDef
          : id === braveDef.cardNo
            ? braveDef
            : undefined;
    const leftHost = {
      ...createCardInstance(leftHostDef, {
        instanceId: "imagin-left",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      attachedChildrenIds: ["imagin-brave"],
    };
    const rightHost = createCardInstance(rightHostDef, {
      instanceId: "imagin-right",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const brave = {
      ...createCardInstance(braveDef, {
        instanceId: "imagin-brave",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      attachedToInstanceId: leftHost.instanceId,
      imaginRightCombinedWith: rightHost.instanceId,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [leftHost, rightHost, brave],
      }),
      activePlayerId: "alice",
      step: "attack",
      turnNumber: 2,
      battleImmediateEffects: [
        {
          promptId: "battle-immediate:imagin-right-host",
          attackId: "attack-imagin-right-host",
          timing: "attack",
          sourceKind: "spirit",
          sourceInstanceId: rightHost.instanceId,
          sourceDefinitionId: rightHostDef.cardNo,
          sourceEffectInstanceId: brave.instanceId,
          sourceEffectDefinitionId: braveDef.cardNo,
          sourceCardNo: braveDef.cardNo,
          actingPlayerId: "alice",
          participantEntityId: "battle-entity:imagin-right",
          registrationIndex: 0,
        },
      ],
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup([leftHostDef, rightHostDef, braveDef]),
    });

    expect(
      actions.some(
        (action) =>
          action.kind === "resolve_battle_immediate_effect" &&
          action.promptId === "battle-immediate:imagin-right-host" &&
          action.skipOnly !== true
      )
    ).toBe(true);
  });

  it("right-slot imagin brave offers its flash effect from the right host", () => {
    const leftHostDef = {
      ...makeHost(),
      cardNo: "BRV-DISP-IMAGIN-FIELD-LEFT",
    } as CardDefinition;
    const rightHostDef = {
      ...makeHost(),
      cardNo: "BRV-DISP-IMAGIN-FIELD-RIGHT",
    } as CardDefinition;
    const braveDef = makeImaginDualBraveWithActivatedEffect();
    const lookup = (id: string): CardDefinition | undefined =>
      id === leftHostDef.cardNo
        ? leftHostDef
        : id === rightHostDef.cardNo
          ? rightHostDef
          : id === braveDef.cardNo
            ? braveDef
            : undefined;
    const leftHost = {
      ...createCardInstance(leftHostDef, {
        instanceId: "imagin-field-left",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      attachedChildrenIds: ["imagin-field-brave"],
    };
    const rightHost = createCardInstance(rightHostDef, {
      instanceId: "imagin-field-right",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const brave = {
      ...createCardInstance(braveDef, {
        instanceId: "imagin-field-brave",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      attachedToInstanceId: leftHost.instanceId,
      imaginRightCombinedWith: rightHost.instanceId,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [leftHost, rightHost, brave],
      }),
      activePlayerId: "alice",
      step: "attack",
      turnNumber: 2,
    };

    const action = getAvailableFieldCardEffectLegalActions(
      {
        state,
        actingPlayerId: "alice",
        getCardDefinitionById: lookup,
        getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup([
          leftHostDef,
          rightHostDef,
          braveDef,
        ]),
      },
      "flash"
    ).find(
      (candidate) =>
        candidate.kind === "use_field_card_effect" &&
        candidate.sourceInstanceId === rightHost.instanceId &&
        candidate.sourceEffectInstanceId === brave.instanceId
    );

    expect(action).toMatchObject({
      sourceInstanceId: rightHost.instanceId,
      sourceDefinitionId: rightHostDef.cardNo,
      sourceEffectInstanceId: brave.instanceId,
      sourceEffectDefinitionId: braveDef.cardNo,
      sourceCardNo: braveDef.cardNo,
    });
  });
});
