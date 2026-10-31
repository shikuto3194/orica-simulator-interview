import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildBattleImmediateEffectLookup,
  buildMagicLookup,
  createCardInstance,
  createEmptyGameState,
  generateBattleImmediateEffectRegistrations,
  getLegalActions,
  rebuildContinuousEffectsFromField,
} from "../src";
import { matchesEffectTargetFilter } from "../src/legal/legal-actions-shared";
import {
  buildHandActivatedEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { stackMatchesNegateAction } from "../src/stack/stack-negate";
import type {
  ActiveStack,
  CardDefinition,
  ContinuousEffect,
  GameState,
  LegalAction,
  StackWindow,
} from "../src";
import type { EffectTargetFilter } from "../src/dsl-types";

const BSTH001_R02 = ALL_CARDS.find((card) => card.cardNo === "BSTH001-R02")!;
const BSTH08_X02 = ALL_CARDS.find((card) => card.cardNo === "BSTH08-X02")!;
const BSTH10_5_R21 = ALL_CARDS.find((card) => card.cardNo === "BSTH10.5-R21")!;
const BSTH10_5_R22 = ALL_CARDS.find((card) => card.cardNo === "BSTH10.5-R22")!;
const BSSG01_C03 = ALL_CARDS.find((card) => card.cardNo === "BSSG01-C03")!;
const BSSG01_R02 = ALL_CARDS.find((card) => card.cardNo === "BSSG01-R02")!;
const BSSL01_M01 = ALL_CARDS.find((card) => card.cardNo === "BSSL01-M01")!;

const NEGATE_SOURCE: CardDefinition = {
  cardNo: "P3-75-NEGATE-SOURCE",
  name: "P3-75 negate source",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["red"],
  textLines: [
    "スタック",
    "相手の白のマジックカード1枚のフラッシュ効果の使用を無効にできる。",
  ],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "stack" },
      steps: [
        {
          action: {
            kind: "negate",
            negateTarget: "use",
            targetFilter: { category: ["magic"], colors: ["white"] },
            targetEffectTiming: "flash",
          },
        },
      ],
      textRef: [0, 1],
    },
  ],
};

const NEGATE_MAX_COST_ZERO_SOURCE: CardDefinition = {
  ...NEGATE_SOURCE,
  cardNo: "P3-75-NEGATE-MAX-COST-ZERO",
  name: "P3-75 negate max cost zero",
  effects: [
    {
      timing: { kind: "activated", mode: "stack" },
      steps: [
        {
          action: {
            kind: "negate",
            negateTarget: "use",
            targetFilter: { category: ["magic"], maxCost: 0 },
            targetEffectTiming: "flash",
          },
        },
      ],
      textRef: [0, 1],
    },
  ],
};

const STACK_NEGATE_MAGIC: CardDefinition = {
  cardNo: "P3-75-STACK-NEGATE-MAGIC",
  name: "P3-75 stack negate magic",
  printedCategory: "magic",
  colors: ["red"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: ["red"],
  textLines: [
    "スタック",
    "相手の白のマジックカード1枚のフラッシュ効果の使用を無効にできる。",
  ],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "stack" },
      steps: [
        {
          action: {
            kind: "negate",
            negateTarget: "use",
            targetFilter: { category: ["magic"], colors: ["white"] },
            targetEffectTiming: "flash",
          },
        },
      ],
      textRef: [0, 1],
    },
  ],
};

const CONTINUOUS_NEGATE_USE_SOURCE: CardDefinition = {
  cardNo: "P3-75-CONTINUOUS-NEGATE-USE",
  name: "P3-75 continuous negate use",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["red"],
  textLines: ["相手のマジックカードの使用を無効にする。"],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "negate",
            negateTarget: "use",
            targetFilter: { category: ["magic"] },
            duration: { scope: "while_on_field" },
          },
        },
      ],
      textRef: [0],
    },
  ],
};

const CONTINUOUS_NEGATE_SUMMON_SOURCE: CardDefinition = {
  ...CONTINUOUS_NEGATE_USE_SOURCE,
  cardNo: "P3-75-CONTINUOUS-NEGATE-SUMMON",
  name: "P3-75 continuous negate summon",
  textLines: ["相手のスピリットの召喚を無効にする。"],
  effects: [
    {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "negate",
            negateTarget: "summon",
            targetFilter: { category: ["spirit"] },
            duration: { scope: "while_on_field" },
          },
        },
      ],
      textRef: [0],
    },
  ],
};

const CONTINUOUS_NEGATE_PLACE_SOURCE: CardDefinition = {
  ...CONTINUOUS_NEGATE_USE_SOURCE,
  cardNo: "P3-75-CONTINUOUS-NEGATE-PLACE",
  name: "P3-75 continuous negate place",
  textLines: ["相手のネクサスの配置を無効にする。"],
  effects: [
    {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "negate",
            negateTarget: "place",
            targetFilter: { category: ["nexus"] },
            duration: { scope: "while_on_field" },
          },
        },
      ],
      textRef: [0],
    },
  ],
};

const WHITE_FLASH_MAGIC: CardDefinition = {
  cardNo: "P3-75-WHITE-FLASH",
  name: "P3-75 white flash",
  printedCategory: "magic",
  colors: ["white"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: ["white"],
  textLines: ["フラッシュ：自分はデッキから1枚ドローする。"],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      textRef: [0],
    },
  ],
};

const WHITE_MAIN_MAGIC: CardDefinition = {
  ...WHITE_FLASH_MAGIC,
  cardNo: "P3-75-WHITE-MAIN",
  name: "P3-75 white main",
  textLines: ["メイン：自分はデッキから1枚ドローする。"],
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      textRef: [0],
    },
  ],
};

const WHITE_FLASH_WINDOW_NON_FLASH_MAGIC: CardDefinition = {
  ...WHITE_FLASH_MAGIC,
  cardNo: "P3-75-WHITE-FLASH-WINDOW-NON-FLASH",
  name: "P3-75 white flash window non flash",
  textLines: ["フラッシュタイミングで、自分はデッキから1枚ドローする。"],
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      activationLabel: "none",
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      textRef: [0],
    },
  ],
};

const BLUE_FLASH_MAGIC: CardDefinition = {
  ...WHITE_FLASH_MAGIC,
  cardNo: "P3-75-BLUE-FLASH",
  name: "P3-75 blue flash",
  colors: ["blue"],
  symbolColors: ["blue"],
};

const P3_75_TARGET_SPIRIT_COST4: CardDefinition = {
  cardNo: "P3-75-TARGET-SPIRIT-COST4",
  name: "P3-75 target spirit cost4",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  textLines: ["テスト用スピリット。"],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const P3_75_TARGET_NEXUS_COST4: CardDefinition = {
  cardNo: "P3-75-TARGET-NEXUS-COST4",
  name: "P3-75 target nexus cost4",
  printedCategory: "nexus",
  colors: ["red"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: ["red"],
  textLines: ["テスト用ネクサス。"],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const WHITE_FLASH_MAGIC_2: CardDefinition = {
  ...WHITE_FLASH_MAGIC,
  cardNo: "P3-75-WHITE-FLASH-2",
  name: "P3-75 white flash 2",
};

const DECK_CARD: CardDefinition = {
  cardNo: "P3-75-DECK-CARD",
  name: "P3-75 deck card",
  printedCategory: "spirit",
  colors: ["green"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: ["green"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const STACK_FIELD_DRAW_SOURCE: CardDefinition = {
  cardNo: "P3-75-STACK-FIELD-DRAW",
  name: "P3-75 stack field draw",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["blue"],
  textLines: ["スタック", "自分はデッキから1枚ドローする。"],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "stack" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      textRef: [0, 1],
    },
  ],
};

const STACK_MAGIC_DRAW_SOURCE: CardDefinition = {
  cardNo: "P3-75-STACK-MAGIC-DRAW",
  name: "P3-75 stack magic draw",
  printedCategory: "magic",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: ["blue"],
  textLines: ["スタック", "自分はデッキから1枚ドローする。"],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "stack" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      textRef: [0, 1],
    },
  ],
};

const FIELD_MAIN_DRAW_SOURCE: CardDefinition = {
  cardNo: "P3-75-FIELD-MAIN-DRAW",
  name: "P3-75 field main draw",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["blue"],
  textLines: ["メイン", "自分はデッキから1枚ドローする。"],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      textRef: [0, 1],
    },
  ],
};

const BATTLE_ATTACK_DRAW_SOURCE: CardDefinition = {
  cardNo: "P3-75-BATTLE-ATTACK-DRAW",
  name: "P3-75 battle attack draw",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["blue"],
  textLines: [
    "Lv1『このスピリットのアタック時』",
    "自分はデッキから1枚ドローする。",
  ],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "card_event", event: "attack" },
      applicability: { zone: "field" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      textRef: [0, 1],
    },
  ],
};

const BATTLE_ATTACK_DRAW_UNPREVENTABLE_SOURCE: CardDefinition = {
  ...BATTLE_ATTACK_DRAW_SOURCE,
  cardNo: "P3-75-BATTLE-ATTACK-DRAW-UNPREVENTABLE",
  name: "P3-75 battle attack draw unpreventable",
  textLines: [
    "Lv1『このスピリットのアタック時』",
    "自分はデッキから1枚ドローする。この効果は相手の効果では防げない。",
  ],
  effects: [
    {
      ...BATTLE_ATTACK_DRAW_SOURCE.effects![0]!,
      preventionLevel: "unpreventable",
    },
  ],
};

const BATTLE_ATTACK_DRAW_CONDITIONAL_UNPREVENTABLE_SOURCE: CardDefinition = {
  ...BATTLE_ATTACK_DRAW_SOURCE,
  cardNo: "P3-75-BATTLE-ATTACK-DRAW-CONDITIONAL-UNPREVENTABLE",
  name: "P3-75 battle attack draw conditional unpreventable",
  textLines: [
    "Lv2『このスピリットのアタック時』",
    "自分はデッキから1枚ドローする。この効果は相手の効果では防げない。",
  ],
  effects: [
    {
      ...BATTLE_ATTACK_DRAW_SOURCE.effects![0]!,
      preventionLevel: "unpreventable",
      preventionLevelCondition: [{ kind: "min_level", value: 2 }],
    },
  ],
};

const BATTLE_ATTACK_BLOCK_DRAW_SOURCE: CardDefinition = {
  ...BATTLE_ATTACK_DRAW_SOURCE,
  cardNo: "P3-75-BATTLE-ATTACK-BLOCK-DRAW",
  name: "P3-75 battle attack block draw",
  textLines: [
    "Lv1『このスピリットのアタック/ブロック時』",
    "自分はデッキから1枚ドローする。",
  ],
  effects: [
    {
      timing: { kind: "card_event", event: ["attack", "block"] },
      applicability: { zone: "field" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      textRef: [0, 1],
    },
  ],
};

const BATTLE_SUMMON_ATTACK_DRAW_SOURCE: CardDefinition = {
  ...BATTLE_ATTACK_DRAW_SOURCE,
  cardNo: "P3-75-BATTLE-SUMMON-ATTACK-DRAW",
  name: "P3-75 battle summon attack draw",
  textLines: [
    "Lv1『このスピリットの召喚/アタック時』",
    "自分はデッキから1枚ドローする。",
  ],
  effects: [
    {
      timing: { kind: "card_event", event: ["summon", "attack"] },
      applicability: { zone: "field" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      textRef: [0, 1],
    },
  ],
};

const BATTLE_TWO_ATTACK_DRAWS_SOURCE: CardDefinition = {
  ...BATTLE_ATTACK_DRAW_SOURCE,
  cardNo: "P3-75-BATTLE-TWO-ATTACK-DRAWS",
  name: "P3-75 battle two attack draws",
  textLines: [
    "Lv1『このスピリットのアタック時』",
    "自分はデッキから1枚ドローする。",
    "Lv2『このスピリットのアタック時』",
    "自分はデッキから1枚ドローする。",
  ],
  effects: [
    {
      timing: { kind: "card_event", event: "attack" },
      applicability: { zone: "field" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      textRef: [0, 1],
    },
    {
      timing: { kind: "card_event", event: "attack" },
      applicability: { zone: "field" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      textRef: [2, 3],
    },
  ],
};

const BATTLE_BRAVE_ATTACK_DRAW_SOURCE: CardDefinition = {
  ...BATTLE_ATTACK_DRAW_SOURCE,
  cardNo: "P3-75-BATTLE-BRAVE-ATTACK-DRAW",
  name: "P3-75 battle brave attack draw",
  printedCategory: "brave",
  textLines: [
    "【合体中】Lv1『このスピリットのアタック時』",
    "自分はデッキから1枚ドローする。",
  ],
};

const BATTLE_SPLIT_ATTACK_DRAWS_SOURCE: CardDefinition = {
  ...BATTLE_ATTACK_DRAW_SOURCE,
  cardNo: "P3-75-BATTLE-SPLIT-ATTACK-DRAWS",
  name: "P3-75 battle split attack draws",
  textLines: [
    "Lv1『このスピリットのアタック時』",
    "自分はデッキから1枚ドローする。",
    "その後、ターンに1回、自分はデッキから1枚ドローできる。",
  ],
  effects: [
    {
      timing: { kind: "card_event", event: "attack" },
      applicability: { zone: "field" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      textRef: [0, 1],
    },
    {
      timing: { kind: "card_event", event: "attack" },
      applicability: { zone: "field" },
      executionMode: "optional",
      usageLimit: { kind: "per_card_name", duration: "turn" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      textRef: [2],
    },
  ],
};

const BATTLE_ATTACK_DRAW_ONCE_SOURCE: CardDefinition = {
  ...BATTLE_ATTACK_DRAW_SOURCE,
  cardNo: "P3-75-BATTLE-ATTACK-DRAW-ONCE",
  name: "P3-75 battle attack draw once",
  effects: BATTLE_ATTACK_DRAW_SOURCE.effects?.map((effect) => ({
    ...effect,
    usageLimit: { kind: "per_instance", duration: "turn" },
  })),
};

const MAGIC_MAIN_DRAW_SOURCE: CardDefinition = {
  cardNo: "P3-75-MAGIC-MAIN-DRAW",
  name: "P3-75 magic main draw",
  printedCategory: "magic",
  colors: ["blue"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: ["メイン", "自分はデッキから1枚ドローする。"],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      textRef: [0, 1],
    },
  ],
};

const HAND_MAIN_DRAW_SOURCE: CardDefinition = {
  cardNo: "P3-75-HAND-MAIN-DRAW",
  name: "P3-75 hand main draw",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["blue"],
  textLines: ["メイン", "自分はデッキから1枚ドローする。"],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      applicability: { zone: "hand" },
      preventionLevel: "unpreventable",
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      textRef: [0, 1],
    },
  ],
};

const HAND_FLASH_DRAW_SOURCE: CardDefinition = {
  cardNo: "P3-75-HAND-FLASH-DRAW",
  name: "P3-75 hand flash draw",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["blue"],
  textLines: ["フラッシュ", "自分はデッキから1枚ドローする。"],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "flash" },
      applicability: { zone: "hand" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      textRef: [0, 1],
    },
  ],
};

const TRIGGERED_SUMMON_DRAW_SOURCE: CardDefinition = {
  cardNo: "P3-75-TRIGGERED-SUMMON-DRAW",
  name: "P3-75 triggered summon draw",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["blue"],
  textLines: [
    "Lv1『このスピリットの召喚時』",
    "自分はデッキから1枚ドローする。",
  ],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "card_event", event: "summon" },
      applicability: { zone: "field" },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      textRef: [0, 1],
    },
  ],
};

const EFFECT_ACTIVATED_WATCHER_BURST: CardDefinition = {
  cardNo: "P3-75-EFFECT-ACTIVATED-WATCHER",
  name: "P3-75 effect activated watcher",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["blue"],
  textLines: ["【バースト：相手の『このスピリットの召喚時』発揮後】"],
  keywordTags: ["burst"],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: {
        kind: "burst",
        trigger: {
          kind: "effect_activated",
          player: "opponent",
          activatedTimings: ["summon"],
        },
      },
      steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
    },
  ],
};

function defenseImmuneCE(targetInstanceId: string): ContinuousEffect {
  return {
    effectId: `p3-75-defense-immune:${targetInstanceId}`,
    sourceInstanceId: targetInstanceId,
    sourceDefinitionId: BATTLE_ATTACK_DRAW_SOURCE.cardNo,
    actingPlayerId: "bob",
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "defense_immune",
    targetInstanceId,
  };
}

const UNTYPED_EFFECT_NEGATE_SOURCE: CardDefinition = {
  cardNo: "P3-75-UNTYPED-EFFECT-NEGATE",
  name: "P3-75 untyped effect negate",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["blue"],
  textLines: ["スタック", "相手の効果1つを無効にする。"],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "stack" },
      steps: [{ action: { kind: "negate", negateTarget: "effect" } }],
      textRef: [0, 1],
    },
  ],
};

function buildState(
  magicDefinition: CardDefinition,
  negateDefinition: CardDefinition = NEGATE_SOURCE,
  chosenTiming: "main" | "flash" | "stack" = "flash"
): GameState {
  const source = createCardInstance(negateDefinition, {
    instanceId: "negate-source-1",
    ownerPlayerId: "alice",
    zone: "field",
    cores: 4,
  });
  const magic = createCardInstance(magicDefinition, {
    instanceId: "bob-magic-1",
    ownerPlayerId: "bob",
    zone: "in_use",
  });
  const deckCard = createCardInstance(DECK_CARD, {
    instanceId: "bob-deck-1",
    ownerPlayerId: "bob",
    zone: "deck",
  });
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, magic, deckCard],
    }),
    activePlayerId: "alice",
    step: "attack",
    window: "stack",
    stackWindow: buildStackWindow(
      magicDefinition,
      negateDefinition.cardNo,
      chosenTiming
    ),
  };
}

function buildStackWindow(
  magicDefinition: CardDefinition,
  negateDefinitionId: string,
  chosenTiming: "main" | "flash" | "stack" = "flash",
  reducedCost: number = magicDefinition.cost
): StackWindow {
  const outerMagic: ActiveStack = {
    stackId: "stack:bob-magic",
    actionKind: "magic",
    chainId: "chain:bob-magic",
    actingPlayerId: "bob",
    cardInstanceId: "bob-magic-1",
    cardDefinitionId: magicDefinition.cardNo,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    reducedCost,
    totalReduction: 0,
    chosenTiming,
    ...(magicDefinition.effects?.[0]?.activationLabel
      ? { activationLabel: magicDefinition.effects[0].activationLabel }
      : {}),
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
  const innerNegate: ActiveStack = {
    stackId: "stack:alice-negate",
    actionKind: "field_card_effect",
    chainId: "chain:alice-negate",
    actingPlayerId: "alice",
    cardInstanceId: "negate-source-1",
    cardDefinitionId: negateDefinitionId,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    fieldEffectSourceKind: "field",
    fieldEffectRegistrationIndex: 0,
    previousResponseSourcePlayerId: "bob",
    previousPendingStackAction: outerMagic,
  };
  return {
    priorityPlayerId: "bob",
    consecutivePassCount: 0,
    actingPlayerId: "bob",
    previousWindow: "none",
    stackResponseSourcePlayerId: "alice",
    subStackEverOpened: true,
    burstWindowKind: null,
    pendingStackAction: innerNegate,
  };
}

function runPass(
  magicDefinition: CardDefinition,
  negateDefinition: CardDefinition = NEGATE_SOURCE,
  chosenTiming: "main" | "flash" | "stack" = "flash"
): GameState {
  const definitions = [
    negateDefinition,
    magicDefinition,
    WHITE_FLASH_MAGIC,
    WHITE_FLASH_WINDOW_NON_FLASH_MAGIC,
    WHITE_MAIN_MAGIC,
    BLUE_FLASH_MAGIC,
    P3_75_TARGET_SPIRIT_COST4,
    P3_75_TARGET_NEXUS_COST4,
    DECK_CARD,
  ];
  const byId = new Map(
    definitions.map((definition) => [definition.cardNo, definition])
  );
  return applyLegalAction({
    state: buildState(magicDefinition, negateDefinition, chosenTiming),
    action: {
      kind: "pass_stack",
      actionId: "pass-stack",
      can: true,
      reason: "test",
      actingPlayerId: "bob",
    },
    getCardDefinitionById: (id) => byId.get(id),
    getRegisteredFieldCardEffectActions:
      buildFieldCardEffectLookup(definitions),
    getRegisteredMagicActions: buildMagicLookup(definitions),
    getRegisteredTriggeredEffectActions: () => undefined,
    getRegisteredBurstActions: () => undefined,
  }).state;
}

function runPassWithState(
  state: GameState,
  definitions: readonly CardDefinition[],
  actingPlayerId: "alice" | "bob" = "bob"
): GameState {
  const byId = new Map(
    definitions.map((definition) => [definition.cardNo, definition])
  );
  return applyLegalAction({
    state,
    action: {
      kind: "pass_stack",
      actionId: "pass-stack",
      can: true,
      reason: "test",
      actingPlayerId,
    },
    getCardDefinitionById: (id) => byId.get(id),
    getRegisteredFieldCardEffectActions:
      buildFieldCardEffectLookup(definitions),
    getRegisteredMagicActions: buildMagicLookup(definitions),
    getRegisteredTriggeredEffectActions: () => undefined,
    getRegisteredBurstActions: () => undefined,
  }).state;
}

function buildContinuousNegateUseState(
  magicDefinition: CardDefinition
): GameState {
  const source = createCardInstance(CONTINUOUS_NEGATE_USE_SOURCE, {
    instanceId: "continuous-negate-source",
    ownerPlayerId: "alice",
    zone: "field",
    cores: 1,
  });
  const magic = createCardInstance(magicDefinition, {
    instanceId: "bob-magic-1",
    ownerPlayerId: "bob",
    zone: "in_use",
  });
  const deckCard = createCardInstance(DECK_CARD, {
    instanceId: "bob-deck-1",
    ownerPlayerId: "bob",
    zone: "deck",
  });
  const outerMagic: ActiveStack = {
    stackId: "stack:bob-magic",
    actionKind: "magic",
    chainId: "chain:bob-magic",
    actingPlayerId: "bob",
    cardInstanceId: "bob-magic-1",
    cardDefinitionId: magicDefinition.cardNo,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    reducedCost: 0,
    totalReduction: 0,
    chosenTiming: "flash",
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [source, magic, deckCard],
  });
  const rebuilt = rebuildContinuousEffectsFromField(state, (id) =>
    id === CONTINUOUS_NEGATE_USE_SOURCE.cardNo
      ? CONTINUOUS_NEGATE_USE_SOURCE
      : undefined
  );
  return {
    ...rebuilt,
    activePlayerId: "alice",
    step: "attack",
    window: "stack",
    stackWindow: {
      priorityPlayerId: "alice",
      consecutivePassCount: 0,
      actingPlayerId: "bob",
      previousWindow: "none",
      stackResponseSourcePlayerId: "bob",
      subStackEverOpened: false,
      burstWindowKind: null,
      pendingStackAction: outerMagic,
    },
  };
}

function declareContinuousNegatedCard(options: {
  sourceDefinition: CardDefinition;
  targetDefinition: CardDefinition;
  actionKind: "summon" | "place_nexus";
}): {
  state: GameState;
  definitions: readonly CardDefinition[];
  paidCost: number;
} {
  const source = createCardInstance(options.sourceDefinition, {
    instanceId: "continuous-negate-source",
    ownerPlayerId: "alice",
    zone: "field",
    cores: 1,
  });
  const target = createCardInstance(options.targetDefinition, {
    instanceId: "bob-target-card",
    ownerPlayerId: "bob",
    zone: "hand",
  });
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [source, target],
  });
  const definitions = [options.sourceDefinition, options.targetDefinition];
  const lookup = (id: string) =>
    definitions.find((definition) => definition.cardNo === id);
  const rebuilt = rebuildContinuousEffectsFromField(
    {
      ...state,
      activePlayerId: "bob",
      step: "main",
      window: "main_step",
      players: state.players.map((player) =>
        player.id === "bob" ? { ...player, reserveNormalCoreCount: 8 } : player
      ),
    },
    lookup
  );
  const legalAction = getLegalActions({
    state: rebuilt,
    actingPlayerId: "bob",
    getCardDefinitionById: lookup,
    getRegisteredFieldCardEffectActions: () => undefined,
    getRegisteredMagicActions: () => undefined,
    getRegisteredTriggeredEffectActions: () => undefined,
    getRegisteredBurstActions: () => undefined,
  }).find(
    (action) =>
      action.kind === options.actionKind &&
      action.sourceInstanceId === target.instanceId
  );
  if (
    !legalAction ||
    !(legalAction.kind === "summon" || legalAction.kind === "place_nexus")
  ) {
    throw new Error(`expected ${options.actionKind} legal action`);
  }

  return {
    state: applyLegalAction({
      state: rebuilt,
      action: legalAction,
      paymentSources: [{ kind: "reserve", amount: legalAction.finalCost }],
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredMagicActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).state,
    definitions,
    paidCost: legalAction.finalCost,
  };
}

function getPlayerReserve(state: GameState, playerId: string): number {
  return (
    state.players.find((player) => player.id === playerId)
      ?.reserveNormalCoreCount ?? 0
  );
}

function getCardZone(state: GameState, instanceId: string): string | undefined {
  return state.cardInstances.find((card) => card.instanceId === instanceId)
    ?.zone;
}

function getCardCoreCount(
  state: GameState,
  instanceId: string
): number | undefined {
  return state.cardInstances.find((card) => card.instanceId === instanceId)
    ?.normalCoreCount;
}

function expectContinuousNegateDeclarationOpened(
  state: GameState,
  actionKind: "summon" | "place_nexus",
  paidCost: number
) {
  expect(state.stackWindow?.pendingStackAction).toMatchObject({
    actionKind,
    actingPlayerId: "bob",
    cardInstanceId: "bob-target-card",
  });
  expect(getCardZone(state, "bob-target-card")).toBe("in_use");
  expect(getPlayerReserve(state, "bob")).toBe(8 - paidCost);
}

function expectContinuousNegateDeclarationResolved(
  state: GameState,
  actionKind: "summon" | "place",
  paidCost: number
) {
  expect(
    state.log.some((line) =>
      line.startsWith(`effect:negate:pending-stack:${actionKind}:`)
    )
  ).toBe(true);
  expect(
    state.log.some(
      (line) =>
        line.startsWith("effect:nullified:") &&
        line.endsWith(":bob-target-card")
    )
  ).toBe(true);
  expect(getCardZone(state, "bob-target-card")).toBe("trash");
  expect(getCardCoreCount(state, "bob-target-card")).toBe(0);
  expect(getPlayerReserve(state, "bob")).toBe(8 - paidCost);
  expect(state.pendingStackNegateRequests).toHaveLength(0);
}

function legalActionsFor(
  state: GameState,
  actingPlayerId: "alice" | "bob" = "alice"
) {
  const definitions = [
    ...ALL_CARDS,
    NEGATE_SOURCE,
    NEGATE_MAX_COST_ZERO_SOURCE,
    STACK_NEGATE_MAGIC,
    CONTINUOUS_NEGATE_USE_SOURCE,
    CONTINUOUS_NEGATE_SUMMON_SOURCE,
    CONTINUOUS_NEGATE_PLACE_SOURCE,
    WHITE_FLASH_MAGIC,
    WHITE_FLASH_WINDOW_NON_FLASH_MAGIC,
    WHITE_MAIN_MAGIC,
    BLUE_FLASH_MAGIC,
    P3_75_TARGET_SPIRIT_COST4,
    P3_75_TARGET_NEXUS_COST4,
    DECK_CARD,
  ];
  return getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById: (id) =>
      definitions.find((definition) => definition.cardNo === id),
    getRegisteredFieldCardEffectActions:
      buildFieldCardEffectLookup(definitions),
    getRegisteredMagicActions: buildMagicLookup(definitions),
    getRegisteredTriggeredEffectActions: () => undefined,
    getRegisteredBurstActions: () => undefined,
  });
}

function buildResponseState(opts: {
  activePlayerId: "alice" | "bob";
  step: GameState["step"];
  magicDefinition?: CardDefinition;
  negateDefinition?: CardDefinition;
}): GameState {
  const base = buildState(
    opts.magicDefinition ?? WHITE_FLASH_MAGIC,
    opts.negateDefinition ?? BSTH001_R02
  );
  return {
    ...base,
    activePlayerId: opts.activePlayerId,
    step: opts.step,
    stackWindow: {
      priorityPlayerId: "alice",
      consecutivePassCount: 0,
      actingPlayerId: "bob",
      previousWindow: "none",
      stackResponseSourcePlayerId: "alice",
      subStackEverOpened: false,
      burstWindowKind: null,
      pendingStackAction:
        base.stackWindow!.pendingStackAction!.previousPendingStackAction,
    },
  };
}

function buildMagicNegateResponseState(
  magicDefinition: CardDefinition
): GameState {
  const negateMagic = createCardInstance(STACK_NEGATE_MAGIC, {
    instanceId: "alice-stack-negate-magic",
    ownerPlayerId: "alice",
    zone: "hand",
  });
  const targetMagic = createCardInstance(magicDefinition, {
    instanceId: "bob-magic-1",
    ownerPlayerId: "bob",
    zone: "in_use",
  });
  const deckCard = createCardInstance(DECK_CARD, {
    instanceId: "bob-deck-1",
    ownerPlayerId: "bob",
    zone: "deck",
  });
  const pendingMagic: ActiveStack = {
    stackId: "stack:bob-magic",
    actionKind: "magic",
    chainId: "chain:bob-magic",
    actingPlayerId: "bob",
    cardInstanceId: "bob-magic-1",
    cardDefinitionId: magicDefinition.cardNo,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    reducedCost: 0,
    totalReduction: 0,
    chosenTiming: "flash",
    ...(magicDefinition.effects?.[0]?.activationLabel
      ? { activationLabel: magicDefinition.effects[0].activationLabel }
      : {}),
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };

  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [negateMagic, targetMagic, deckCard],
    }),
    activePlayerId: "alice",
    step: "attack",
    window: "stack",
    stackWindow: {
      priorityPlayerId: "alice",
      consecutivePassCount: 0,
      actingPlayerId: "bob",
      previousWindow: "none",
      stackResponseSourcePlayerId: "alice",
      subStackEverOpened: false,
      burstWindowKind: null,
      pendingStackAction: pendingMagic,
    },
  };
}

function buildBsth10_5StackResponseState(options: {
  negateDefinition: CardDefinition;
  targetDefinition: CardDefinition;
  targetActionKind: "summon" | "place_nexus";
  aliceLife?: number;
}): GameState {
  const negateMagic = createCardInstance(options.negateDefinition, {
    instanceId: "alice-bsth10_5-negate",
    ownerPlayerId: "alice",
    zone: "hand",
  });
  const target = createCardInstance(options.targetDefinition, {
    instanceId: "bob-target-card",
    ownerPlayerId: "bob",
    zone: "hand",
  });
  const targetStack: ActiveStack = {
    stackId: "stack:bob-target",
    actionKind: options.targetActionKind,
    chainId: "chain:bob-target",
    actingPlayerId: "bob",
    cardInstanceId: "bob-target-card",
    cardDefinitionId: options.targetDefinition.cardNo,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [negateMagic, target],
  });
  return {
    ...base,
    players: base.players.map((player) =>
      player.id === "alice"
        ? {
            ...player,
            reserveNormalCoreCount: 4,
            ...(options.aliceLife !== undefined
              ? { lifeNormalCoreCount: options.aliceLife }
              : {}),
          }
        : player
    ),
    activePlayerId: "bob",
    step: "main",
    window: "stack",
    stackWindow: {
      priorityPlayerId: "alice",
      consecutivePassCount: 0,
      actingPlayerId: "bob",
      previousWindow: "none",
      stackResponseSourcePlayerId: "bob",
      subStackEverOpened: false,
      burstWindowKind: null,
      pendingStackAction: targetStack,
    },
  };
}

function buildBssg01R02StackResponseState(options: {
  eventAction: "summon" | "attack";
  targetCategory?: "spirit" | "nexus";
  targetActingPlayerId?: "alice" | "bob";
  negateInUse?: boolean;
  forceAttackLabel?: boolean;
}): GameState {
  const negateMagic = createCardInstance(BSSG01_R02, {
    instanceId: "alice-bssg01-r02",
    ownerPlayerId: "alice",
    zone: options.negateInUse ? "in_use" : "hand",
  });
  const targetDefinition =
    options.targetCategory === "nexus"
      ? P3_75_TARGET_NEXUS_COST4
      : STACK_FIELD_DRAW_SOURCE;
  const target = createCardInstance(targetDefinition, {
    instanceId: "bob-attack-effect-source",
    ownerPlayerId: "bob",
    zone: "field",
    cores: 1,
  });
  const deckCard = createCardInstance(DECK_CARD, {
    instanceId: "bob-deck-1",
    ownerPlayerId: "bob",
    zone: "deck",
  });
  const targetStack: ActiveStack = {
    stackId: "stack:bob-attack-effect",
    actionKind: "field_card_effect",
    chainId: "chain:bob-attack-effect",
    actingPlayerId: options.targetActingPlayerId ?? "bob",
    cardInstanceId: "bob-attack-effect-source",
    cardDefinitionId: targetDefinition.cardNo,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    fieldEffectSourceKind:
      options.targetCategory === "nexus" ? "nexus" : "spirit",
    fieldEffectRegistrationIndex: 0,
    suppressionEffectDescriptor: {
      sourceDefinitionId: targetDefinition.cardNo,
      effectIndex: 0,
      ...(options.eventAction === "attack" &&
      (options.targetCategory !== "nexus" || options.forceAttackLabel)
        ? { effectLabels: ["spirit_attack_time"] }
        : {}),
      timingKind: "card_event",
      eventAction: options.eventAction,
    },
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
  const pendingStackAction: ActiveStack = options.negateInUse
    ? {
        stackId: "stack:alice-bssg01-r02",
        actionKind: "magic",
        chainId: "chain:alice-bssg01-r02",
        actingPlayerId: "alice",
        cardInstanceId: "alice-bssg01-r02",
        cardDefinitionId: BSSG01_R02.cardNo,
        targetInstanceIds: [],
        targetEffectFilterTags: ["general"],
        reducedCost: 0,
        totalReduction: 0,
        chosenTiming: "stack",
        magicEffectIndex: 3,
        previousResponseSourcePlayerId: "bob",
        previousPendingStackAction: targetStack,
      }
    : targetStack;
  const baseState = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [negateMagic, target, deckCard],
  });

  return {
    ...baseState,
    activePlayerId: "bob",
    step: "attack",
    window: "stack",
    players: baseState.players.map((player) =>
      player.id === "alice" ? { ...player, reserveNormalCoreCount: 8 } : player
    ),
    stackWindow: {
      priorityPlayerId: options.negateInUse ? "bob" : "alice",
      consecutivePassCount: 0,
      actingPlayerId: "bob",
      previousWindow: "none",
      stackResponseSourcePlayerId: options.negateInUse ? "alice" : "bob",
      subStackEverOpened: options.negateInUse === true,
      burstWindowKind: null,
      pendingStackAction,
    },
  };
}

function getBssg01R02LegalActions(options: {
  eventAction: "summon" | "attack";
  targetCategory?: "spirit" | "nexus";
  targetActingPlayerId?: "alice" | "bob";
  forceAttackLabel?: boolean;
}) {
  const definitions = [
    BSSG01_R02,
    STACK_FIELD_DRAW_SOURCE,
    P3_75_TARGET_NEXUS_COST4,
    DECK_CARD,
  ];
  return getLegalActions({
    state: buildBssg01R02StackResponseState(options),
    actingPlayerId: "alice",
    getCardDefinitionById: (id) =>
      definitions.find((definition) => definition.cardNo === id),
    getRegisteredFieldCardEffectActions:
      buildFieldCardEffectLookup(definitions),
    getRegisteredMagicActions: buildMagicLookup(definitions),
    getRegisteredTriggeredEffectActions: () => undefined,
    getRegisteredBurstActions: () => undefined,
  });
}

function buildBssg01R02BattleImmediateResponseState(
  sourceDefinition: CardDefinition = BATTLE_ATTACK_DRAW_SOURCE,
  options: {
    timing?: "attack" | "block";
    registrationIndex?: number;
  } = {}
): GameState {
  const timing = options.timing ?? "attack";
  const negateMagic = createCardInstance(BSSG01_R02, {
    instanceId: "alice-bssg01-r02",
    ownerPlayerId: "alice",
    zone: "hand",
  });
  const aliceAttacker = createCardInstance(P3_75_TARGET_SPIRIT_COST4, {
    instanceId: "alice-battle-attacker",
    ownerPlayerId: "alice",
    zone: "field",
    cores: 1,
  });
  const attacker = createCardInstance(sourceDefinition, {
    instanceId: "bob-battle-attack-draw",
    ownerPlayerId: "bob",
    zone: "field",
    cores: 1,
  });
  const deckCard = createCardInstance(DECK_CARD, {
    instanceId: "bob-deck-1",
    ownerPlayerId: "bob",
    zone: "deck",
  });
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances:
      timing === "block"
        ? [negateMagic, aliceAttacker, attacker, deckCard]
        : [negateMagic, attacker, deckCard],
    battleEntities:
      timing === "block"
        ? [
            {
              entityId: "battle-entity:alice-battle-attacker",
              memberInstanceIds: ["alice-battle-attacker"],
              resolvedBp: 3000,
              resolvedSymbols: ["red"],
              attackState: "attacking",
            },
            {
              entityId: "battle-entity:bob-battle-attack-draw",
              memberInstanceIds: ["bob-battle-attack-draw"],
              resolvedBp: 4000,
              resolvedSymbols: ["blue"],
              attackState: "blocking",
            },
          ]
        : [
            {
              entityId: "battle-entity:bob-battle-attack-draw",
              memberInstanceIds: ["bob-battle-attack-draw"],
              resolvedBp: 4000,
              resolvedSymbols: ["blue"],
              attackState: "attacking",
            },
          ],
    activeAttack: {
      attackId:
        timing === "block"
          ? "attack-group:1:alice:battle-entity:alice-battle-attacker"
          : "attack-group:1:bob:battle-entity:bob-battle-attack-draw",
      primaryEntityId:
        timing === "block"
          ? "battle-entity:alice-battle-attacker"
          : "battle-entity:bob-battle-attack-draw",
      participantEntityIds:
        timing === "block"
          ? [
              "battle-entity:alice-battle-attacker",
              "battle-entity:bob-battle-attack-draw",
            ]
          : ["battle-entity:bob-battle-attack-draw"],
      groupMode: "single",
      target:
        timing === "block"
          ? {
              kind: "battle_entity",
              entityId: "battle-entity:bob-battle-attack-draw",
            }
          : { kind: "player", playerId: "alice" },
      blockAssignments: [
        timing === "block"
          ? {
              participantEntityId: "battle-entity:alice-battle-attacker",
              blockedByEntityIds: ["battle-entity:bob-battle-attack-draw"],
            }
          : {
              participantEntityId: "battle-entity:bob-battle-attack-draw",
              blockedByEntityIds: [],
            },
      ],
      symbolResolutionOrder:
        timing === "block"
          ? ["battle-entity:alice-battle-attacker"]
          : ["battle-entity:bob-battle-attack-draw"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: timing === "attack" ? false : false,
      flashWindowState: {
        kind: timing === "block" ? "after_block" : "before_block",
        priorityPlayerId: "bob",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "bob",
        pendingStackAction: null,
      },
    },
    battleImmediateEffects: [
      {
        promptId: `p3-75-bssg01-r02-${timing}-draw`,
        attackId:
          timing === "block"
            ? "attack-group:1:alice:battle-entity:alice-battle-attacker"
            : "attack-group:1:bob:battle-entity:bob-battle-attack-draw",
        timing,
        sourceKind: "spirit",
        sourceInstanceId: "bob-battle-attack-draw",
        sourceDefinitionId: sourceDefinition.cardNo,
        sourceCardNo: sourceDefinition.cardNo,
        actingPlayerId: "bob",
        participantEntityId: "battle-entity:bob-battle-attack-draw",
        registrationIndex: options.registrationIndex ?? 0,
      },
    ],
  });
  return {
    ...base,
    activePlayerId: "bob",
    step: "attack",
    window: "flash_before_block",
    players: base.players.map((player) =>
      player.id === "alice" ? { ...player, reserveNormalCoreCount: 8 } : player
    ),
  };
}

function buildBssg01R02BattleImmediateLookups(
  sourceDefinition: CardDefinition = BATTLE_ATTACK_DRAW_SOURCE
) {
  const definitions = [
    BSSG01_R02,
    sourceDefinition,
    P3_75_TARGET_SPIRIT_COST4,
    DECK_CARD,
  ];
  const getDefinition = (id: string) =>
    definitions.find((definition) => definition.cardNo === id);
  return {
    getCardDefinitionById: getDefinition,
    getRegisteredBattleImmediateEffectActions:
      buildBattleImmediateEffectLookup(definitions),
    getRegisteredFieldCardEffectActions:
      buildFieldCardEffectLookup(definitions),
    getRegisteredMagicActions: buildMagicLookup(definitions),
    getRegisteredTriggeredEffectActions: () => undefined,
    getRegisteredBurstActions: () => undefined,
  };
}

function declareBssg01R02BattleImmediateAttackEffect(
  sourceDefinition: CardDefinition = BATTLE_ATTACK_DRAW_SOURCE,
  options: {
    registrationIndex?: number;
  } = {}
): {
  state: GameState;
  lookups: ReturnType<typeof buildBssg01R02BattleImmediateLookups>;
} {
  const lookups = buildBssg01R02BattleImmediateLookups(sourceDefinition);
  const baseState = buildBssg01R02BattleImmediateResponseState(
    sourceDefinition,
    {
      registrationIndex: options.registrationIndex,
    }
  );
  const declaration = getLegalActions({
    state: baseState,
    actingPlayerId: "bob",
    ...lookups,
  }).find((action) => action.kind === "resolve_battle_immediate_effect");
  if (!declaration || declaration.kind !== "resolve_battle_immediate_effect") {
    throw new Error("expected BSSG01-R02 target battle immediate declaration");
  }

  const declared = applyLegalAction({
    state: baseState,
    action: declaration,
    ...lookups,
  }).state;
  const pending = declared.activeAttack?.flashWindowState?.pendingStackAction;
  expect(pending?.actionKind).toBe("battle_immediate_effect");
  expect(pending?.suppressionEffectDescriptor?.eventAction).toBe("attack");
  expect(pending?.cardDefinitionId).toBe(sourceDefinition.cardNo);
  return { state: declared, lookups };
}

function stackBssg01R02AgainstBattleImmediate(
  sourceDefinition: CardDefinition = BATTLE_ATTACK_DRAW_SOURCE,
  options: {
    registrationIndex?: number;
  } = {}
): {
  state: GameState;
  lookups: ReturnType<typeof buildBssg01R02BattleImmediateLookups>;
} {
  const { state, lookups } = declareBssg01R02BattleImmediateAttackEffect(
    sourceDefinition,
    options
  );
  const stackMagicAction = getLegalActions({
    state,
    actingPlayerId: "alice",
    ...lookups,
  }).find(
    (action) =>
      action.kind === "use_magic" &&
      action.sourceInstanceId === "alice-bssg01-r02" &&
      action.timing === "stack" &&
      action.effectIndex === 3
  );
  if (!stackMagicAction || stackMagicAction.kind !== "use_magic") {
    throw new Error("expected BSSG01-R02 stack magic action");
  }

  const stacked = applyLegalAction({
    state,
    action: stackMagicAction,
    paymentSources: [{ kind: "reserve", amount: 8 }],
    ...lookups,
  }).state;
  expect(
    stacked.activeAttack?.flashWindowState?.pendingStackAction?.actionKind
  ).toBe("magic");
  expect(
    stacked.activeAttack?.flashWindowState?.pendingStackAction
      ?.previousPendingStackAction?.actionKind
  ).toBe("battle_immediate_effect");
  return { state: stacked, lookups };
}

function runBssg01R02BattleImmediateNegate(
  sourceDefinition: CardDefinition = BATTLE_ATTACK_DRAW_SOURCE
): GameState {
  const { state, lookups } =
    stackBssg01R02AgainstBattleImmediate(sourceDefinition);
  const passAction = getLegalActions({
    state,
    actingPlayerId: "bob",
    ...lookups,
  }).find((action) => action.kind === "pass_battle_flash");
  if (!passAction) {
    throw new Error("expected pass_battle_flash after BSSG01-R02 stack use");
  }
  return applyLegalAction({
    state,
    action: passAction,
    ...lookups,
  }).state;
}

function buildBsth10_5NegateCascadeState(options: {
  negateDefinition: CardDefinition;
  targetDefinition: CardDefinition;
  targetActionKind: "summon" | "place_nexus";
  targetReducedCost?: number;
  targetCostForFilter?: number;
  aliceLife?: number;
}): GameState {
  const negateMagic = createCardInstance(options.negateDefinition, {
    instanceId: "alice-bsth10_5-negate",
    ownerPlayerId: "alice",
    zone: "in_use",
  });
  const target = createCardInstance(options.targetDefinition, {
    instanceId: "bob-target-card",
    ownerPlayerId: "bob",
    zone: "hand",
  });
  const targetStack: ActiveStack = {
    stackId: "stack:bob-target",
    actionKind: options.targetActionKind,
    chainId: "chain:bob-target",
    actingPlayerId: "bob",
    cardInstanceId: "bob-target-card",
    cardDefinitionId: options.targetDefinition.cardNo,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    reducedCost: options.targetReducedCost ?? options.targetDefinition.cost,
    totalReduction: 0,
    costForFilter: options.targetCostForFilter ?? options.targetDefinition.cost,
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
  const negateStack: ActiveStack = {
    stackId: "stack:alice-bsth10_5-negate",
    actionKind: "magic",
    chainId: "chain:alice-bsth10_5-negate",
    actingPlayerId: "alice",
    cardInstanceId: "alice-bsth10_5-negate",
    cardDefinitionId: options.negateDefinition.cardNo,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    reducedCost: 0,
    totalReduction: 0,
    chosenTiming: "stack",
    previousResponseSourcePlayerId: "bob",
    previousPendingStackAction: targetStack,
  };
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [negateMagic, target],
  });
  return {
    ...base,
    players: base.players.map((player) =>
      player.id === "alice" && options.aliceLife !== undefined
        ? { ...player, lifeNormalCoreCount: options.aliceLife }
        : player
    ),
    activePlayerId: "bob",
    step: "main",
    window: "stack",
    stackWindow: {
      priorityPlayerId: "bob",
      consecutivePassCount: 0,
      actingPlayerId: "bob",
      previousWindow: "none",
      stackResponseSourcePlayerId: "alice",
      subStackEverOpened: true,
      burstWindowKind: null,
      pendingStackAction: negateStack,
    },
  };
}

type NueResponseOverrides = Partial<
  Pick<GameState, "activePlayerId" | "step">
> & {
  targetActingPlayerId?: "alice" | "bob";
};

function buildNueResponseState(
  targetKind: "field" | "magic",
  overrides?: NueResponseOverrides
): GameState {
  const nue = createCardInstance(BSTH08_X02, {
    instanceId: "alice-nue",
    ownerPlayerId: "alice",
    zone: "field",
    cores: 3,
  });
  const target =
    targetKind === "field"
      ? createCardInstance(STACK_FIELD_DRAW_SOURCE, {
          instanceId: "bob-stack-source",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        })
      : createCardInstance(STACK_MAGIC_DRAW_SOURCE, {
          instanceId: "bob-stack-source",
          ownerPlayerId: "bob",
          zone: "in_use",
        });
  const deckCard = createCardInstance(DECK_CARD, {
    instanceId: "bob-deck-1",
    ownerPlayerId: "bob",
    zone: "deck",
  });
  const pendingTarget: ActiveStack = {
    stackId: `stack:bob-${targetKind}`,
    actionKind: targetKind === "field" ? "field_card_effect" : "magic",
    chainId: `chain:bob-${targetKind}`,
    actingPlayerId: overrides?.targetActingPlayerId ?? "bob",
    cardInstanceId: "bob-stack-source",
    cardDefinitionId:
      targetKind === "field"
        ? STACK_FIELD_DRAW_SOURCE.cardNo
        : STACK_MAGIC_DRAW_SOURCE.cardNo,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    ...(targetKind === "field"
      ? {
          fieldEffectSourceKind: "field",
          fieldEffectRegistrationIndex: 0,
        }
      : { reducedCost: 0, totalReduction: 0 }),
    chosenTiming: "stack",
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };

  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [nue, target, deckCard],
    }),
    activePlayerId: overrides?.activePlayerId ?? "alice",
    step: overrides?.step ?? "attack",
    window: "stack",
    stackWindow: {
      priorityPlayerId: "alice",
      consecutivePassCount: 0,
      actingPlayerId: "bob",
      previousWindow: "none",
      stackResponseSourcePlayerId: "bob",
      subStackEverOpened: false,
      burstWindowKind: null,
      pendingStackAction: pendingTarget,
    },
  };
}

function getNueLegalActions(
  targetKind: "field" | "magic",
  overrides?: NueResponseOverrides
) {
  const definitions = [
    BSTH08_X02,
    STACK_FIELD_DRAW_SOURCE,
    STACK_MAGIC_DRAW_SOURCE,
    DECK_CARD,
  ];
  return getLegalActions({
    state: buildNueResponseState(targetKind, overrides),
    actingPlayerId: "alice",
    getCardDefinitionById: (id) =>
      definitions.find((definition) => definition.cardNo === id),
    getRegisteredFieldCardEffectActions:
      buildFieldCardEffectLookup(definitions),
    getRegisteredMagicActions: buildMagicLookup(definitions),
    getRegisteredTriggeredEffectActions: () => undefined,
    getRegisteredBurstActions: () => undefined,
  });
}

function runNueNegate(targetKind: "field" | "magic"): GameState {
  const definitions = [
    BSTH08_X02,
    STACK_FIELD_DRAW_SOURCE,
    STACK_MAGIC_DRAW_SOURCE,
    DECK_CARD,
  ];
  const lookups = {
    getCardDefinitionById: (id: string) =>
      definitions.find((definition) => definition.cardNo === id),
    getRegisteredFieldCardEffectActions:
      buildFieldCardEffectLookup(definitions),
    getRegisteredMagicActions: buildMagicLookup(definitions),
    getRegisteredTriggeredEffectActions: () => undefined,
    getRegisteredBurstActions: () => undefined,
  };
  const responseState = buildNueResponseState(targetKind);
  const nueAction = getLegalActions({
    state: responseState,
    actingPlayerId: "alice",
    ...lookups,
  }).find(
    (action) =>
      action.kind === "use_field_card_effect" &&
      action.sourceInstanceId === "alice-nue" &&
      action.timing === "stack"
  );
  if (!nueAction || nueAction.kind !== "use_field_card_effect") {
    throw new Error("BSTH08-X02 stack negate action not found");
  }
  const declared = applyLegalAction({
    state: responseState,
    action: nueAction,
    ...lookups,
  }).state;
  return applyLegalAction({
    state: declared,
    action: {
      kind: "pass_stack",
      actionId: "pass-stack",
      can: true,
      reason: "test",
      actingPlayerId: "bob",
    },
    ...lookups,
  }).state;
}

function getUntypedEffectNegateLegalActions() {
  const source = createCardInstance(UNTYPED_EFFECT_NEGATE_SOURCE, {
    instanceId: "alice-untyped-effect-negate",
    ownerPlayerId: "alice",
    zone: "field",
    cores: 1,
  });
  const target = createCardInstance(STACK_MAGIC_DRAW_SOURCE, {
    instanceId: "bob-stack-source",
    ownerPlayerId: "bob",
    zone: "in_use",
  });
  const definitions = [
    UNTYPED_EFFECT_NEGATE_SOURCE,
    STACK_MAGIC_DRAW_SOURCE,
    DECK_CARD,
  ];
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, target],
    }),
    activePlayerId: "alice",
    step: "attack",
    window: "stack",
    stackWindow: {
      priorityPlayerId: "alice",
      consecutivePassCount: 0,
      actingPlayerId: "bob",
      previousWindow: "none",
      stackResponseSourcePlayerId: "bob",
      subStackEverOpened: false,
      burstWindowKind: null,
      pendingStackAction: {
        stackId: "stack:bob-magic",
        actionKind: "magic",
        chainId: "chain:bob-magic",
        actingPlayerId: "bob",
        cardInstanceId: "bob-stack-source",
        cardDefinitionId: STACK_MAGIC_DRAW_SOURCE.cardNo,
        targetInstanceIds: [],
        targetEffectFilterTags: ["general"],
        reducedCost: 0,
        totalReduction: 0,
        chosenTiming: "stack",
        previousResponseSourcePlayerId: null,
        previousPendingStackAction: null,
      },
    },
  };

  return getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: (id) =>
      definitions.find((definition) => definition.cardNo === id),
    getRegisteredFieldCardEffectActions:
      buildFieldCardEffectLookup(definitions),
    getRegisteredMagicActions: buildMagicLookup(definitions),
    getRegisteredTriggeredEffectActions: () => undefined,
    getRegisteredBurstActions: () => undefined,
  });
}

function buildNestedMismatchState(): GameState {
  const source = createCardInstance(NEGATE_SOURCE, {
    instanceId: "negate-source-1",
    ownerPlayerId: "alice",
    zone: "field",
    cores: 4,
  });
  const blueMagic = createCardInstance(BLUE_FLASH_MAGIC, {
    instanceId: "bob-blue-magic",
    ownerPlayerId: "bob",
    zone: "in_use",
  });
  const whiteMagic = createCardInstance(WHITE_FLASH_MAGIC_2, {
    instanceId: "bob-white-magic",
    ownerPlayerId: "bob",
    zone: "in_use",
  });
  const deckCard1 = createCardInstance(DECK_CARD, {
    instanceId: "bob-deck-1",
    ownerPlayerId: "bob",
    zone: "deck",
  });
  const deckCard2 = createCardInstance(
    { ...DECK_CARD, cardNo: "P3-75-DECK-CARD-2", name: "P3-75 deck card 2" },
    {
      instanceId: "bob-deck-2",
      ownerPlayerId: "bob",
      zone: "deck",
    }
  );
  const olderWhite: ActiveStack = {
    stackId: "stack:bob-white-magic",
    actionKind: "magic",
    chainId: "chain:bob-white-magic",
    actingPlayerId: "bob",
    cardInstanceId: "bob-white-magic",
    cardDefinitionId: WHITE_FLASH_MAGIC_2.cardNo,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    reducedCost: 0,
    totalReduction: 0,
    chosenTiming: "flash",
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
  const directBlue: ActiveStack = {
    stackId: "stack:bob-blue-magic",
    actionKind: "magic",
    chainId: "chain:bob-blue-magic",
    actingPlayerId: "bob",
    cardInstanceId: "bob-blue-magic",
    cardDefinitionId: BLUE_FLASH_MAGIC.cardNo,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    reducedCost: 0,
    totalReduction: 0,
    chosenTiming: "flash",
    previousResponseSourcePlayerId: "alice",
    previousPendingStackAction: olderWhite,
  };
  const innerNegate: ActiveStack = {
    stackId: "stack:alice-negate",
    actionKind: "field_card_effect",
    chainId: "chain:alice-negate",
    actingPlayerId: "alice",
    cardInstanceId: "negate-source-1",
    cardDefinitionId: NEGATE_SOURCE.cardNo,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    fieldEffectSourceKind: "field",
    fieldEffectRegistrationIndex: 0,
    previousResponseSourcePlayerId: "bob",
    previousPendingStackAction: directBlue,
  };

  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, blueMagic, whiteMagic, deckCard1, deckCard2],
    }),
    activePlayerId: "alice",
    step: "attack",
    window: "stack",
    stackWindow: {
      priorityPlayerId: "bob",
      consecutivePassCount: 0,
      actingPlayerId: "bob",
      previousWindow: "none",
      stackResponseSourcePlayerId: "alice",
      subStackEverOpened: true,
      burstWindowKind: null,
      pendingStackAction: innerNegate,
    },
  };
}

describe("P3-75 generic negate: pending stack nullification", () => {
  it("BSSG01-R02 の発揮前 targetFilter は提示時に固定されたコスト4を見る", () => {
    const source = createCardInstance(NEGATE_SOURCE, {
      instanceId: "negate-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 4,
    });
    const magic = createCardInstance(BSSG01_R02, {
      instanceId: "bob-bssg01-r02",
      ownerPlayerId: "bob",
      zone: "in_use",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source, magic],
    });
    const stack: ActiveStack = {
      stackId: "stack:bob-bssg01-r02",
      actionKind: "magic",
      chainId: "chain:bob-bssg01-r02",
      actingPlayerId: "bob",
      cardInstanceId: "bob-bssg01-r02",
      cardDefinitionId: BSSG01_R02.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      reducedCost: 4,
      totalReduction: 0,
      costForFilter: 4,
      chosenTiming: "flash",
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };
    const definitions = [NEGATE_SOURCE, BSSG01_R02];
    const getCardDefinitionById = (id: string) =>
      definitions.find((definition) => definition.cardNo === id);
    const base = {
      state,
      stack,
      actingPlayerId: "alice",
      getCardDefinitionById,
      sourceCard: source,
      sourceDefinition: NEGATE_SOURCE,
    };

    expect(
      stackMatchesNegateAction({
        ...base,
        request: {
          negateTarget: "use",
          targetFilter: { category: ["magic"], maxCost: 4 },
          targetEffectTiming: "flash",
        },
      })
    ).toBe(true);
    expect(
      stackMatchesNegateAction({
        ...base,
        request: {
          negateTarget: "use",
          targetFilter: { category: ["magic"], minCost: 8 },
          targetEffectTiming: "flash",
        },
      })
    ).toBe(false);
    expect(
      stackMatchesNegateAction({
        ...base,
        request: {
          negateTarget: "use",
          targetFilter: {
            category: ["magic"],
            minCost: 8,
            costBasis: "printed",
          },
          targetEffectTiming: "flash",
        },
      })
    ).toBe(true);
  });

  it("BSTH001-R02 のスタック効果で相手の白フラッシュマジック使用を無効化する", () => {
    const result = runPass(WHITE_FLASH_MAGIC, BSTH001_R02);

    const magic = result.cardInstances.find(
      (c) => c.instanceId === "bob-magic-1"
    );
    const deckCard = result.cardInstances.find(
      (c) => c.instanceId === "bob-deck-1"
    );

    expect(magic?.zone).toBe("trash");
    expect(deckCard?.zone).toBe("deck");
    expect(result.log).toContain(
      "effect:negate:pending-stack:use_magic:stack:bob-magic"
    );
  });

  it("BSTH001-R02 のスタック効果は相手の白メインマジック使用を無効化しない", () => {
    const result = runPass(WHITE_MAIN_MAGIC, BSTH001_R02, "main");

    expect(result.log).not.toContain(
      "effect:negate:pending-stack:use_magic:stack:bob-magic"
    );
    expect(result.log.some((line) => line.startsWith("magic:nullified:"))).toBe(
      false
    );
    expect(
      result.cardInstances.find((card) => card.instanceId === "bob-deck-1")
        ?.zone
    ).toBe("hand");
  });

  it("BSTH001-R02 のスタック効果は本文フラッシュタイミングの非フラッシュ効果を無効化しない", () => {
    const result = runPass(WHITE_FLASH_WINDOW_NON_FLASH_MAGIC, BSTH001_R02);

    expect(result.log).not.toContain(
      "effect:negate:pending-stack:use_magic:stack:bob-magic"
    );
    expect(result.log.some((line) => line.startsWith("magic:nullified:"))).toBe(
      false
    );
    expect(
      result.cardInstances.find((card) => card.instanceId === "bob-deck-1")
        ?.zone
    ).toBe("hand");
  });

  it("相手の白フラッシュマジック使用を無効化し、使用後処理だけ行って効果は発揮しない", () => {
    const result = runPass(WHITE_FLASH_MAGIC);

    const magic = result.cardInstances.find(
      (c) => c.instanceId === "bob-magic-1"
    );
    const deckCard = result.cardInstances.find(
      (c) => c.instanceId === "bob-deck-1"
    );

    expect(magic?.zone).toBe("trash");
    expect(magic?.zoneRoleName).toBe("magic-card");
    expect(deckCard?.zone).toBe("deck");
    expect(result.log).toContain(
      "effect:negate:pending-stack:use_magic:stack:bob-magic"
    );
    expect(result.log.some((line) => line.startsWith("magic:nullified:"))).toBe(
      true
    );
  });

  it("targetFilter に合わない青マジックは無効化せず、ドロー効果を解決する", () => {
    const result = runPass(BLUE_FLASH_MAGIC);

    const magic = result.cardInstances.find(
      (c) => c.instanceId === "bob-magic-1"
    );
    const deckCard = result.cardInstances.find(
      (c) => c.instanceId === "bob-deck-1"
    );

    expect(magic?.zone).toBe("trash");
    expect(deckCard?.zone).toBe("hand");
    expect(result.log.some((line) => line.startsWith("magic:nullified:"))).toBe(
      false
    );
    expect(result.pendingStackNegateRequests).toHaveLength(0);
  });

  it("BSTH001-R02 のスタック効果は自分のアタックステップ外で列挙されない", () => {
    const ownAttack = legalActionsFor(
      buildResponseState({ activePlayerId: "alice", step: "attack" })
    );
    const main = legalActionsFor(
      buildResponseState({ activePlayerId: "alice", step: "main" })
    );
    const opponentAttack = legalActionsFor(
      buildResponseState({ activePlayerId: "bob", step: "attack" })
    );

    const isKikuriStack = (action: (typeof ownAttack)[number]) =>
      action.kind === "use_field_card_effect" &&
      action.sourceInstanceId === "negate-source-1" &&
      action.timing === "stack";

    expect(ownAttack.some(isKikuriStack)).toBe(true);
    expect(main.some(isKikuriStack)).toBe(false);
    expect(opponentAttack.some(isKikuriStack)).toBe(false);
  });

  it("BSTH001-R02 のスタック効果は対象外の青マジック使用への応答では空撃ちとして使用できる", () => {
    const blueResponse = legalActionsFor(
      buildResponseState({
        activePlayerId: "alice",
        step: "attack",
        magicDefinition: BLUE_FLASH_MAGIC,
      })
    );

    expect(
      blueResponse.some(
        (action) =>
          action.kind === "use_field_card_effect" &&
          action.sourceInstanceId === "negate-source-1" &&
          action.timing === "stack"
      )
    ).toBe(true);
  });

  it("P3-75-NEGATE-MAX-COST-ZERO の stack negate は CardFilter SSOT で対象外なら空撃ちとして使用できる", () => {
    const legalActions = legalActionsFor(
      buildResponseState({
        activePlayerId: "alice",
        step: "attack",
        magicDefinition: WHITE_FLASH_MAGIC,
        negateDefinition: NEGATE_MAX_COST_ZERO_SOURCE,
      })
    );

    expect(
      legalActions.some(
        (action) =>
          action.kind === "use_field_card_effect" &&
          action.sourceInstanceId === "negate-source-1" &&
          action.timing === "stack"
      )
    ).toBe(true);
  });

  it("P3-75-STACK-NEGATE-MAGIC は応答対象の色が不一致なら stack 使用に空撃ちとして使用できる", () => {
    const definitions = [
      STACK_NEGATE_MAGIC,
      WHITE_FLASH_MAGIC,
      WHITE_FLASH_WINDOW_NON_FLASH_MAGIC,
      BLUE_FLASH_MAGIC,
      DECK_CARD,
    ];
    const getActions = (state: GameState) =>
      getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById: (id) =>
          definitions.find((definition) => definition.cardNo === id),
        getRegisteredFieldCardEffectActions:
          buildFieldCardEffectLookup(definitions),
        getRegisteredMagicActions: buildMagicLookup(definitions),
        getRegisteredTriggeredEffectActions: () => undefined,
        getRegisteredBurstActions: () => undefined,
      });
    const isStackNegateMagic = (
      action: ReturnType<typeof getActions>[number]
    ) =>
      action.kind === "use_magic" &&
      action.sourceInstanceId === "alice-stack-negate-magic" &&
      action.timing === "stack";

    const whiteResponse = getActions(
      buildMagicNegateResponseState(WHITE_FLASH_MAGIC)
    );
    const blueResponse = getActions(
      buildMagicNegateResponseState(BLUE_FLASH_MAGIC)
    );
    const flashWindowNonFlashResponse = getActions(
      buildMagicNegateResponseState(WHITE_FLASH_WINDOW_NON_FLASH_MAGIC)
    );

    expect(whiteResponse.some(isStackNegateMagic)).toBe(true);
    expect(blueResponse.some(isStackNegateMagic)).toBe(true);
    expect(flashWindowNonFlashResponse.some(isStackNegateMagic)).toBe(true);
  });

  it("P3-75-STACK-NEGATE-MAGIC の mode:stack 効果は宣言後の解決で直下の白マジックを無効化する", () => {
    const definitions = [
      STACK_NEGATE_MAGIC,
      WHITE_FLASH_MAGIC,
      WHITE_FLASH_WINDOW_NON_FLASH_MAGIC,
      BLUE_FLASH_MAGIC,
      DECK_CARD,
    ];
    const getDefinition = (id: string) =>
      definitions.find((definition) => definition.cardNo === id);
    const lookups = {
      getCardDefinitionById: getDefinition,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
      getRegisteredMagicActions: buildMagicLookup(definitions),
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    };
    const responseState = buildMagicNegateResponseState(WHITE_FLASH_MAGIC);
    const stackMagicAction = getLegalActions({
      state: responseState,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === "alice-stack-negate-magic" &&
        action.timing === "stack"
    );
    if (!stackMagicAction || stackMagicAction.kind !== "use_magic") {
      throw new Error("P3-75-STACK-NEGATE-MAGIC stack action not found");
    }

    const declared = applyLegalAction({
      state: responseState,
      action: stackMagicAction,
      paymentSources: [],
      ...lookups,
    }).state;
    const resolved = applyLegalAction({
      state: declared,
      action: {
        kind: "pass_stack",
        actionId: "pass-stack",
        can: true,
        reason: "test",
        actingPlayerId: "bob",
      },
      ...lookups,
    }).state;

    expect(stackMagicAction.effectIndex).toBe(0);
    expect(
      resolved.log.some(
        (line) =>
          line === "effect:negate:pending-stack:use_magic:stack:bob-magic"
      )
    ).toBe(true);
    expect(
      resolved.log.some((line) => line.startsWith("magic:nullified:"))
    ).toBe(true);
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "bob-magic-1")
        ?.zone
    ).toBe("trash");
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "bob-deck-1")
        ?.zone
    ).toBe("deck");
  });

  it("P3-75-CONTINUOUS-NEGATE-USE の rebuild fallback は negate_use_magic tag を重複登録しない", () => {
    const source = createCardInstance(CONTINUOUS_NEGATE_USE_SOURCE, {
      instanceId: "continuous-negate-source",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const legacyEffect: ContinuousEffect = {
      effectId: "legacy-negate-use-magic",
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: CONTINUOUS_NEGATE_USE_SOURCE.cardNo,
      actingPlayerId: "alice",
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "negate_use_magic",
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source],
      }),
      activeContinuousEffects: [legacyEffect],
    };

    const rebuilt = rebuildContinuousEffectsFromField(state, (id) =>
      id === CONTINUOUS_NEGATE_USE_SOURCE.cardNo
        ? CONTINUOUS_NEGATE_USE_SOURCE
        : undefined
    );

    expect(
      rebuilt.activeContinuousEffects.filter(
        (effect) =>
          effect.sourceInstanceId === source.instanceId &&
          effect.modifierTag === "negate_use_magic"
      )
    ).toHaveLength(1);
  });

  it("P3-75-CONTINUOUS-NEGATE-USE の継続 CE は後続の相手マジック使用を無効化する", () => {
    const result = runPassWithState(
      buildContinuousNegateUseState(WHITE_FLASH_MAGIC),
      [CONTINUOUS_NEGATE_USE_SOURCE, WHITE_FLASH_MAGIC, DECK_CARD],
      "alice"
    );

    expect(result.log).toContain(
      "effect:negate:pending-stack:use_magic:stack:bob-magic"
    );
    expect(result.log.some((line) => line.startsWith("magic:nullified:"))).toBe(
      true
    );
    expect(
      result.cardInstances.find((card) => card.instanceId === "bob-magic-1")
        ?.zone
    ).toBe("trash");
    expect(
      result.cardInstances.find((card) => card.instanceId === "bob-deck-1")
        ?.zone
    ).toBe("deck");
    expect(result.pendingStackNegateRequests).toHaveLength(0);
  });

  it("P3-75-CONTINUOUS-NEGATE-SUMMON の継続 CE は後続の相手召喚宣言を無効化する", () => {
    const declared = declareContinuousNegatedCard({
      sourceDefinition: CONTINUOUS_NEGATE_SUMMON_SOURCE,
      targetDefinition: P3_75_TARGET_SPIRIT_COST4,
      actionKind: "summon",
    });
    expectContinuousNegateDeclarationOpened(
      declared.state,
      "summon",
      declared.paidCost
    );

    const result = runPassWithState(
      declared.state,
      declared.definitions,
      "alice"
    );

    expectContinuousNegateDeclarationResolved(
      result,
      "summon",
      declared.paidCost
    );
  });

  it("P3-75-CONTINUOUS-NEGATE-PLACE の継続 CE は後続の相手配置宣言を無効化する", () => {
    const declared = declareContinuousNegatedCard({
      sourceDefinition: CONTINUOUS_NEGATE_PLACE_SOURCE,
      targetDefinition: P3_75_TARGET_NEXUS_COST4,
      actionKind: "place_nexus",
    });
    expectContinuousNegateDeclarationOpened(
      declared.state,
      "place_nexus",
      declared.paidCost
    );

    const result = runPassWithState(
      declared.state,
      declared.definitions,
      "alice"
    );

    expectContinuousNegateDeclarationResolved(
      result,
      "place",
      declared.paidCost
    );
  });

  it("BSTH001-R02 のスタック効果は直下の応答対象が不一致なら奥の白マジックを探索して無効化しない", () => {
    const result = runPassWithState(buildNestedMismatchState(), [
      NEGATE_SOURCE,
      BLUE_FLASH_MAGIC,
      WHITE_FLASH_MAGIC_2,
      DECK_CARD,
      { ...DECK_CARD, cardNo: "P3-75-DECK-CARD-2", name: "P3-75 deck card 2" },
    ]);

    expect(result.log).not.toContain(
      "effect:negate:pending-stack:use_magic:stack:bob-white-magic"
    );
    expect(
      result.log.some((line) => line === "magic:nullified:bob-white-magic")
    ).toBe(false);
    expect(
      result.cardInstances.filter(
        (card) => card.ownerPlayerId === "bob" && card.zone === "hand"
      )
    ).toHaveLength(2);
  });

  it("BSTH08-X02 は相手のフィールド発スタック効果1つを無効化する", () => {
    const result = runNueNegate("field");

    expect(result.log).toContain(
      "effect:negate:pending-stack:effect:stack:bob-field"
    );
    expect(result.log).toContain(
      "effect:nullified:chain:bob-field:bob-stack-source"
    );
    expect(
      result.cardInstances.find((card) => card.instanceId === "bob-deck-1")
        ?.zone
    ).toBe("deck");
  });

  it("BSTH08-X02 は相手マジックのスタック効果1つを無効化する", () => {
    const result = runNueNegate("magic");

    expect(result.log).toContain(
      "effect:negate:pending-stack:effect:stack:bob-magic"
    );
    expect(result.log.some((line) => line.startsWith("magic:nullified:"))).toBe(
      true
    );
    expect(
      result.cardInstances.find((card) => card.instanceId === "bob-deck-1")
        ?.zone
    ).toBe("deck");
    expect(
      result.cardInstances.find(
        (card) => card.instanceId === "bob-stack-source"
      )?.zone
    ).toBe("trash");
  });

  it("BSTH08-X02 は自分のアタックステップ外では列挙されない", () => {
    const ownAttack = getNueLegalActions("field");
    const main = getNueLegalActions("field", { step: "main" });
    const opponentAttack = getNueLegalActions("field", {
      activePlayerId: "bob",
      step: "attack",
    });

    const isNueStack = (action: (typeof ownAttack)[number]) =>
      action.kind === "use_field_card_effect" &&
      action.sourceInstanceId === "alice-nue" &&
      action.timing === "stack";

    expect(ownAttack.some(isNueStack)).toBe(true);
    expect(main.some(isNueStack)).toBe(false);
    expect(opponentAttack.some(isNueStack)).toBe(false);
  });

  it("BSTH08-X02 のスタック無効化は「できる」文言に従い任意効果として表現する", () => {
    expect(BSTH08_X02.effects?.[1]?.executionMode).toBe("optional");
  });

  it("BSTH08-X02 は自分のスタック効果には空撃ちとして使用できる", () => {
    const ownStack = getNueLegalActions("field", {
      targetActingPlayerId: "alice",
    });

    expect(
      ownStack.some(
        (action) =>
          action.kind === "use_field_card_effect" &&
          action.sourceInstanceId === "alice-nue" &&
          action.timing === "stack"
      )
    ).toBe(true);
  });

  it("targetEffectTiming のない effect negate はマジックのスタック効果にも空撃ちとして使用できる", () => {
    const actions = getUntypedEffectNegateLegalActions();

    expect(
      actions.some(
        (action) =>
          action.kind === "use_field_card_effect" &&
          action.sourceInstanceId === "alice-untyped-effect-negate" &&
          action.timing === "stack"
      )
    ).toBe(true);
  });

  it("targetEffectTiming のない effect negate は誘発効果を nullified として消化し resolver を走らせない", () => {
    const negateSource = createCardInstance(UNTYPED_EFFECT_NEGATE_SOURCE, {
      instanceId: "alice-untyped-effect-negate",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const triggerSource = createCardInstance(TRIGGERED_SUMMON_DRAW_SOURCE, {
      instanceId: "bob-triggered-draw",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const deckCard = createCardInstance(DECK_CARD, {
      instanceId: "bob-deck-trigger-1",
      ownerPlayerId: "bob",
      zone: "deck",
    });
    const definitions = [
      UNTYPED_EFFECT_NEGATE_SOURCE,
      TRIGGERED_SUMMON_DRAW_SOURCE,
      DECK_CARD,
    ];
    const lookups = {
      getCardDefinitionById: (id: string) =>
        definitions.find((definition) => definition.cardNo === id),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
      getRegisteredMagicActions: buildMagicLookup(definitions),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: () => undefined,
    };
    const baseState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [negateSource, triggerSource, deckCard],
      }),
      activePlayerId: "alice",
      step: "main",
      pendingTriggeredEffects: [
        {
          pendingId: "p3-75-trigger-draw",
          eventKind: "summon",
          actingPlayerId: "bob",
          source: "action_resolution",
          chainId: "test:p3-75-generic-negate-pending-stack:2605",
          attackId: null,
          relatedPlayerId: null,
          relatedInstanceId: "bob-triggered-draw",
          amount: null,
          step: "main",
          window: "default",
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    const declaration = getLegalActions({
      state: baseState,
      actingPlayerId: "bob",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "bob-triggered-draw"
    );
    if (
      !declaration ||
      declaration.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("expected triggered effect declaration");
    }

    const declared = applyLegalAction({
      state: baseState,
      action: declaration,
      ...lookups,
    }).state;
    expect(declared.stackWindow?.pendingStackAction?.actionKind).toBe(
      "triggered_effect"
    );
    expect(declared.stackWindow?.priorityPlayerId).toBe("alice");

    const negateAction = getLegalActions({
      state: declared,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "use_field_card_effect" &&
        action.sourceInstanceId === "alice-untyped-effect-negate" &&
        action.timing === "stack"
    );
    if (!negateAction || negateAction.kind !== "use_field_card_effect") {
      throw new Error("expected untyped effect negate action");
    }

    const stacked = applyLegalAction({
      state: declared,
      action: negateAction,
      ...lookups,
    }).state;
    const passAction = getLegalActions({
      state: stacked,
      actingPlayerId: "bob",
      ...lookups,
    }).find((action) => action.kind === "pass_stack");
    if (!passAction) {
      throw new Error("expected bob pass_stack");
    }

    const result = applyLegalAction({
      state: stacked,
      action: passAction,
      ...lookups,
    }).state;

    expect(result.log).toContain(
      "effect:negate:pending-stack:effect:stack:trigger:p3-75-trigger-draw"
    );
    expect(result.log).toContain(
      "effect:nullified:trigger:p3-75-trigger-draw:bob-triggered-draw"
    );
    expect(result.log).not.toContain("effect:draw:bob:1");
    expect(
      result.cardInstances.find(
        (card) => card.instanceId === "bob-deck-trigger-1"
      )?.zone
    ).toBe("deck");
    expect(
      result.pendingTriggeredEffects.some(
        (pending) => pending.pendingId === "p3-75-trigger-draw"
      )
    ).toBe(false);
  });

  it("無効化された triggered_effect は effect_activated バーストチェックを積まない", () => {
    const negateSource = createCardInstance(UNTYPED_EFFECT_NEGATE_SOURCE, {
      instanceId: "alice-untyped-effect-negate",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const watcherBurst = createCardInstance(EFFECT_ACTIVATED_WATCHER_BURST, {
      instanceId: "alice-effect-activated-watcher",
      ownerPlayerId: "alice",
      zone: "burst",
    });
    const triggerSource = createCardInstance(TRIGGERED_SUMMON_DRAW_SOURCE, {
      instanceId: "bob-triggered-draw",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const deckCard = createCardInstance(DECK_CARD, {
      instanceId: "bob-deck-trigger-1",
      ownerPlayerId: "bob",
      zone: "deck",
    });
    const definitions = [
      UNTYPED_EFFECT_NEGATE_SOURCE,
      EFFECT_ACTIVATED_WATCHER_BURST,
      TRIGGERED_SUMMON_DRAW_SOURCE,
      DECK_CARD,
    ];
    const lookups = {
      getCardDefinitionById: (id: string) =>
        definitions.find((definition) => definition.cardNo === id),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
      getRegisteredMagicActions: buildMagicLookup(definitions),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
      getRegisteredBurstActions: buildBurstEffectLookup(definitions),
    };
    const baseState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [negateSource, watcherBurst, triggerSource, deckCard],
      }),
      activePlayerId: "alice",
      step: "main",
      setBurstStates: [
        {
          playerId: "alice",
          cardInstanceId: "alice-effect-activated-watcher",
        },
      ],
      pendingTriggeredEffects: [
        {
          pendingId: "p3-75-trigger-draw",
          eventKind: "summon",
          actingPlayerId: "bob",
          source: "action_resolution",
          chainId: "test:p3-75-generic-negate-pending-stack:2754",
          attackId: null,
          relatedPlayerId: null,
          relatedInstanceId: "bob-triggered-draw",
          amount: null,
          step: "main",
          window: "default",
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    const declaration = getLegalActions({
      state: baseState,
      actingPlayerId: "bob",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "bob-triggered-draw"
    );
    if (
      !declaration ||
      declaration.kind !== "resolve_pending_triggered_effect"
    ) {
      throw new Error("expected triggered effect declaration");
    }

    const declared = applyLegalAction({
      state: baseState,
      action: declaration,
      ...lookups,
    }).state;
    const negateAction = getLegalActions({
      state: declared,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "use_field_card_effect" &&
        action.sourceInstanceId === "alice-untyped-effect-negate" &&
        action.timing === "stack"
    );
    if (!negateAction || negateAction.kind !== "use_field_card_effect") {
      throw new Error("expected untyped effect negate action");
    }

    const stacked = applyLegalAction({
      state: declared,
      action: negateAction,
      ...lookups,
    }).state;
    const passAction = getLegalActions({
      state: stacked,
      actingPlayerId: "bob",
      ...lookups,
    }).find((action) => action.kind === "pass_stack");
    if (!passAction) {
      throw new Error("expected bob pass_stack");
    }

    const result = applyLegalAction({
      state: stacked,
      action: passAction,
      ...lookups,
    }).state;

    expect(result.log).toContain(
      "effect:nullified:trigger:p3-75-trigger-draw:bob-triggered-draw"
    );
    expect(result.log).not.toContain("effect:draw:bob:1");
    expect(
      result.pendingBurstChecks.filter(
        (check) => check.eventKind === "effect_activated"
      )
    ).toHaveLength(0);
  });

  it("P3-75-FIELD-MAIN-DRAW は実 field declaration の pending stack に suppression descriptor を保持する", () => {
    const source = createCardInstance(FIELD_MAIN_DRAW_SOURCE, {
      instanceId: "alice-field-main-draw",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const definitions = [FIELD_MAIN_DRAW_SOURCE, DECK_CARD];
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source],
      }),
      activePlayerId: "alice",
      step: "main",
    };
    const lookups = {
      getCardDefinitionById: (id: string) =>
        definitions.find((definition) => definition.cardNo === id),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
      getRegisteredMagicActions: buildMagicLookup(definitions),
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (candidate) =>
        candidate.kind === "use_field_card_effect" &&
        candidate.sourceInstanceId === "alice-field-main-draw"
    );

    if (!action || action.kind !== "use_field_card_effect") {
      throw new Error("P3-75-FIELD-MAIN-DRAW action not found");
    }
    const declared = applyLegalAction({ state, action, ...lookups }).state;

    expect(
      declared.stackWindow?.pendingStackAction?.suppressionEffectDescriptor
    ).toEqual({
      sourceDefinitionId: FIELD_MAIN_DRAW_SOURCE.cardNo,
      sourceKind: "spirit",
      effectIndex: 0,
      timingKind: "activated",
      activatedMode: "main",
      containsActionKinds: ["draw"],
    });
  });

  it("P3-75-MAGIC-MAIN-DRAW は実 magic declaration の pending stack に suppression descriptor を保持する", () => {
    const magic = createCardInstance(MAGIC_MAIN_DRAW_SOURCE, {
      instanceId: "alice-magic-main-draw",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const definitions = [MAGIC_MAIN_DRAW_SOURCE, DECK_CARD];
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [magic],
      }),
      activePlayerId: "alice",
      step: "main",
    };
    const lookups = {
      getCardDefinitionById: (id: string) =>
        definitions.find((definition) => definition.cardNo === id),
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(definitions),
      getRegisteredMagicActions: buildMagicLookup(definitions),
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (candidate) =>
        candidate.kind === "use_magic" &&
        candidate.sourceInstanceId === "alice-magic-main-draw" &&
        candidate.effectIndex === 0
    );

    if (!action || action.kind !== "use_magic") {
      throw new Error("P3-75-MAGIC-MAIN-DRAW action not found");
    }
    const declared = applyLegalAction({ state, action, ...lookups }).state;

    expect(
      declared.stackWindow?.pendingStackAction?.suppressionEffectDescriptor
    ).toEqual({
      sourceDefinitionId: MAGIC_MAIN_DRAW_SOURCE.cardNo,
      sourceKind: "magic",
      effectIndex: 0,
      timingKind: "activated",
      activatedMode: "main",
      containsActionKinds: ["draw"],
    });
  });

  it("P3-75-HAND-MAIN-DRAW は実 hand declaration の pending stack に suppression descriptor を保持する", () => {
    const source = createCardInstance(HAND_MAIN_DRAW_SOURCE, {
      instanceId: "alice-hand-main-draw",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const definitions = [HAND_MAIN_DRAW_SOURCE, DECK_CARD];
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source],
      }),
      activePlayerId: "alice",
      step: "main",
    };
    const lookups = {
      getCardDefinitionById: (id: string) =>
        definitions.find((definition) => definition.cardNo === id),
      getRegisteredHandActivatedEffectActions:
        buildHandActivatedEffectLookup(definitions),
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (candidate) =>
        candidate.kind === "use_hand_card_effect" &&
        candidate.sourceInstanceId === "alice-hand-main-draw"
    );

    if (!action || action.kind !== "use_hand_card_effect") {
      throw new Error("P3-75-HAND-MAIN-DRAW action not found");
    }
    const declared = applyLegalAction({ state, action, ...lookups }).state;

    expect(
      declared.stackWindow?.pendingStackAction?.suppressionEffectDescriptor
    ).toEqual({
      sourceDefinitionId: HAND_MAIN_DRAW_SOURCE.cardNo,
      sourceKind: "spirit",
      effectIndex: 0,
      timingKind: "activated",
      activatedMode: "main",
      containsActionKinds: ["draw"],
    });
    expect(
      declared.stackWindow?.pendingStackAction?.reevaluationPoints
    ).toEqual([
      {
        timing: "before_each_step",
        checks: ["effect_suppression"],
        failurePolicy: "abort_remaining",
      },
    ]);
    expect(declared.stackWindow?.pendingStackAction?.preventionLevel).toBe(
      "unpreventable"
    );
  });

  it("P3-75-HAND-FLASH-DRAW は hand フラッシュ使用禁止中に legal action へ出ない", () => {
    const source = createCardInstance(HAND_FLASH_DRAW_SOURCE, {
      instanceId: "alice-hand-flash-draw",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const definitions = [HAND_FLASH_DRAW_SOURCE, DECK_CARD];
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source],
    });
    const restrictAliceHandFlash: ContinuousEffect = {
      effectId: "ce:restrict-flash-hand:alice",
      sourceInstanceId: "bob-source",
      sourceDefinitionId: HAND_FLASH_DRAW_SOURCE.cardNo,
      actingPlayerId: "bob",
      duration: { scope: "turn" },
      createdAtTurn: base.turnNumber,
      modifierTag: "restrict_flash_hand",
      targetInstanceId: "alice",
      metadata: { restrictedZones: ["hand"] },
    };
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "main",
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        restrictAliceHandFlash,
      ],
    };
    const lookups = {
      getCardDefinitionById: (id: string) =>
        definitions.find((definition) => definition.cardNo === id),
      getRegisteredHandActivatedEffectActions:
        buildHandActivatedEffectLookup(definitions),
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (candidate) =>
        candidate.kind === "use_hand_card_effect" &&
        candidate.sourceInstanceId === "alice-hand-flash-draw"
    );

    expect(action).toBeUndefined();
  });

  it("BSTH10.5-R21 はネクサス配置 pending stack への stack magic として列挙される", () => {
    const actions = legalActionsFor(
      buildBsth10_5StackResponseState({
        negateDefinition: BSTH10_5_R21,
        targetDefinition: P3_75_TARGET_NEXUS_COST4,
        targetActionKind: "place_nexus",
      })
    );

    expect(
      actions.some(
        (action) =>
          action.kind === "use_magic" &&
          action.sourceInstanceId === "alice-bsth10_5-negate" &&
          action.timing === "stack"
      )
    ).toBe(true);
  });

  it("BSTH10.5-R22 はライフ5以上では stack magic として列挙されない", () => {
    const actions = legalActionsFor(
      buildBsth10_5StackResponseState({
        negateDefinition: BSTH10_5_R22,
        targetDefinition: P3_75_TARGET_SPIRIT_COST4,
        targetActionKind: "summon",
        aliceLife: 5,
      })
    );

    expect(
      actions.some(
        (action) =>
          action.kind === "use_magic" &&
          action.sourceInstanceId === "alice-bsth10_5-negate" &&
          action.timing === "stack"
      )
    ).toBe(false);
  });

  it("BSTH10.5-R22 はライフ4以下なら召喚 pending stack への stack magic として列挙される", () => {
    const actions = legalActionsFor(
      buildBsth10_5StackResponseState({
        negateDefinition: BSTH10_5_R22,
        targetDefinition: P3_75_TARGET_SPIRIT_COST4,
        targetActionKind: "summon",
        aliceLife: 4,
      })
    );

    expect(
      actions.some(
        (action) =>
          action.kind === "use_magic" &&
          action.sourceInstanceId === "alice-bsth10_5-negate" &&
          action.timing === "stack"
      )
    ).toBe(true);
  });

  it("BSSG01-R02 自身の stack magic は対象記述だけでアタック時ラベルを持たない", () => {
    const registrations = buildMagicLookup([BSSG01_R02])("BSSG01-R02") ?? [];
    const stackRegistration = registrations.find(
      (registration) =>
        registration.timing === "stack" && registration.effectIndex === 3
    );

    expect(stackRegistration?.suppressionEffectDescriptor).toMatchObject({
      sourceDefinitionId: BSSG01_R02.cardNo,
      sourceKind: "magic",
      timingKind: "activated",
      activatedMode: "stack",
    });
    expect(
      stackRegistration?.suppressionEffectDescriptor.effectLabels
    ).toBeUndefined();
  });

  it("BSSG01-R02 は相手のスピリットのアタック時効果 pending stack への stack magic として列挙される", () => {
    const { state, lookups } = declareBssg01R02BattleImmediateAttackEffect();
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    });

    expect(
      actions.some(
        (action) =>
          action.kind === "use_magic" &&
          action.sourceInstanceId === "alice-bssg01-r02" &&
          action.timing === "stack" &&
          action.effectIndex === 3
      )
    ).toBe(true);
  });

  it("BSSG01-R02 は効果を受けない相手スピリットのアタック時効果には空撃ちとして使用できる", () => {
    const { state, lookups } = declareBssg01R02BattleImmediateAttackEffect();
    const immuneState: GameState = {
      ...state,
      activeContinuousEffects: [
        ...state.activeContinuousEffects,
        defenseImmuneCE("bob-battle-attack-draw"),
      ],
    };
    const actions = getLegalActions({
      state: immuneState,
      actingPlayerId: "alice",
      ...lookups,
    });

    expect(
      actions.some(
        (action) =>
          action.kind === "use_magic" &&
          action.sourceInstanceId === "alice-bssg01-r02" &&
          action.timing === "stack" &&
          action.effectIndex === 3
      )
    ).toBe(true);
  });

  it("BSSG01-R02 は相手の効果では防げないアタック時効果には空撃ちとして使用できる", () => {
    const { state, lookups } = declareBssg01R02BattleImmediateAttackEffect(
      BATTLE_ATTACK_DRAW_UNPREVENTABLE_SOURCE
    );
    expect(
      state.activeAttack?.flashWindowState?.pendingStackAction?.preventionLevel
    ).toBe("unpreventable");

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    });

    expect(
      actions.some(
        (action) =>
          action.kind === "use_magic" &&
          action.sourceInstanceId === "alice-bssg01-r02" &&
          action.timing === "stack" &&
          action.effectIndex === 3
      )
    ).toBe(true);
  });

  it("BSSG01-R02 は防げない条件が不成立のアタック時効果には列挙される", () => {
    const { state, lookups } = declareBssg01R02BattleImmediateAttackEffect(
      BATTLE_ATTACK_DRAW_CONDITIONAL_UNPREVENTABLE_SOURCE
    );
    expect(
      state.activeAttack?.flashWindowState?.pendingStackAction?.preventionLevel
    ).toBe("unpreventable");

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    });

    expect(
      actions.some(
        (action) =>
          action.kind === "use_magic" &&
          action.sourceInstanceId === "alice-bssg01-r02" &&
          action.timing === "stack" &&
          action.effectIndex === 3
      )
    ).toBe(true);
  });

  it("BSSG01-R02 は相手のスピリットの召喚時効果 pending stack には空撃ちとして使用できる", () => {
    const actions = getBssg01R02LegalActions({
      eventAction: "summon",
      targetCategory: "spirit",
    });

    expect(
      actions.some(
        (action) =>
          action.kind === "use_magic" &&
          action.sourceInstanceId === "alice-bssg01-r02" &&
          action.timing === "stack" &&
          action.effectIndex === 3
      )
    ).toBe(true);
  });

  it("BSSG01-R02 は相手のネクサスのアタック時効果 pending stack には空撃ちとして使用できる", () => {
    const actions = getBssg01R02LegalActions({
      eventAction: "attack",
      targetCategory: "nexus",
    });

    expect(
      actions.some(
        (action) =>
          action.kind === "use_magic" &&
          action.sourceInstanceId === "alice-bssg01-r02" &&
          action.timing === "stack" &&
          action.effectIndex === 3
      )
    ).toBe(true);
  });

  it("BSSG01-R02 はアタック時ラベルがあっても相手のネクサス効果には空撃ちとして使用できる", () => {
    const actions = getBssg01R02LegalActions({
      eventAction: "attack",
      targetCategory: "nexus",
      forceAttackLabel: true,
    });

    expect(
      actions.some(
        (action) =>
          action.kind === "use_magic" &&
          action.sourceInstanceId === "alice-bssg01-r02" &&
          action.timing === "stack" &&
          action.effectIndex === 3
      )
    ).toBe(true);
  });

  it("BSSG01-R02 は自分のスピリットのアタック時効果 pending stack には空撃ちとして使用できる", () => {
    const actions = getBssg01R02LegalActions({
      eventAction: "attack",
      targetCategory: "spirit",
      targetActingPlayerId: "alice",
    });

    expect(
      actions.some(
        (action) =>
          action.kind === "use_magic" &&
          action.sourceInstanceId === "alice-bssg01-r02" &&
          action.timing === "stack" &&
          action.effectIndex === 3
      )
    ).toBe(true);
  });

  it("BSSG01-C03 の複合アタック/ブロック時登録は実発火 timing ごとに effect filter を分離する", () => {
    const regs = generateBattleImmediateEffectRegistrations(BSSG01_C03);
    const attackReg = regs.find(
      (registration) =>
        registration.effectIndex === 3 && registration.timing === "attack"
    )!;
    const blockReg = regs.find(
      (registration) =>
        registration.effectIndex === 3 && registration.timing === "block"
    )!;

    expect(attackReg.suppressionEffectDescriptor?.eventAction).toBe("attack");
    expect(blockReg.suppressionEffectDescriptor?.eventAction).toBe("block");
    expect(attackReg.suppressionEffectDescriptor?.sourceDefinitionId).toBe(
      BSSG01_C03.cardNo
    );
    expect(blockReg.suppressionEffectDescriptor?.sourceDefinitionId).toBe(
      BSSG01_C03.cardNo
    );
    expect(attackReg.suppressionEffectDescriptor?.effectLabels).toEqual([
      "spirit_attack_time",
    ]);
    expect(blockReg.suppressionEffectDescriptor?.effectLabels).toEqual([
      "spirit_block_time",
    ]);
    expect(attackReg.reevaluationPoints).toEqual([
      {
        timing: "before_each_step",
        checks: ["effect_suppression"],
        failurePolicy: "abort_remaining",
      },
    ]);
    expect(blockReg.reevaluationPoints).toEqual([
      {
        timing: "before_each_step",
        checks: ["effect_suppression"],
        failurePolicy: "abort_remaining",
      },
    ]);
    expect(
      matchesEffectTargetFilter(
        { timingKind: "card_event", eventAction: "attack" },
        attackReg.suppressionEffectDescriptor!
      )
    ).toBe(true);
    expect(
      matchesEffectTargetFilter(
        { timingKind: "card_event", eventAction: "attack" },
        blockReg.suppressionEffectDescriptor!
      )
    ).toBe(false);
  });

  it("召喚/アタック時登録は summon event を保持しつつ attack label を導出する", () => {
    const regs = generateBattleImmediateEffectRegistrations(
      BATTLE_SUMMON_ATTACK_DRAW_SOURCE
    );
    const attackReg = regs.find(
      (registration) => registration.timing === "attack"
    )!;

    expect(attackReg.suppressionEffectDescriptor).toMatchObject({
      sourceDefinitionId: BATTLE_SUMMON_ATTACK_DRAW_SOURCE.cardNo,
      sourceKind: "spirit",
      effectIndex: 0,
      effectLabels: ["spirit_attack_time"],
      timingKind: "card_event",
      eventAction: "attack",
    });
    expect(
      matchesEffectTargetFilter(
        { timingKind: "card_event", eventAction: "attack" },
        attackReg.suppressionEffectDescriptor!
      )
    ).toBe(true);
  });

  it("BSSG01-R02 は相手のスピリットのアタック時効果1つを無効化し、効果解決をスキップする", () => {
    const result = runBssg01R02BattleImmediateNegate();

    expect(result.log).toContain(
      "effect:negate:pending-stack:effect:stack:battle:immediate:p3-75-bssg01-r02-attack-draw"
    );
    expect(result.log).not.toContain("effect:draw:bob:1");
    expect(
      result.cardInstances.find((card) => card.instanceId === "bob-deck-1")
        ?.zone
    ).toBe("deck");
    const suppression = result.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "effect_suppression" &&
        ce.sourceInstanceId === "alice-bssg01-r02"
    );
    expect(suppression?.targetInstanceId).toBe("bob-battle-attack-draw");
    expect(suppression?.duration).toEqual({ scope: "turn" });
    const effectFilter = suppression?.metadata
      ?.effectFilter as EffectTargetFilter;
    expect(effectFilter).toEqual({
      sourceDefinitionId: BATTLE_ATTACK_DRAW_SOURCE.cardNo,
      sourceKinds: ["spirit", "ultimate"],
      effectIndex: 0,
      effectLabels: ["spirit_attack_time"],
      timingKind: "card_event",
      eventAction: "attack",
    });
    expect(
      matchesEffectTargetFilter(effectFilter, {
        sourceDefinitionId: BATTLE_ATTACK_DRAW_SOURCE.cardNo,
        sourceKind: "spirit",
        effectIndex: 0,
        effectLabels: ["spirit_attack_time"],
        timingKind: "card_event",
        eventAction: "attack",
      })
    ).toBe(true);
    expect(
      matchesEffectTargetFilter(effectFilter, {
        sourceDefinitionId: BATTLE_ATTACK_DRAW_SOURCE.cardNo,
        sourceKind: "spirit",
        effectIndex: 0,
        effectLabels: ["spirit_attack_time"],
        timingKind: "card_event",
        eventAction: "summon",
      })
    ).toBe(false);
    expect(
      matchesEffectTargetFilter(effectFilter, {
        sourceDefinitionId: "P3-75-BATTLE-ATTACK-DRAW-BACK",
        sourceKind: "spirit",
        effectIndex: 0,
        effectLabels: ["spirit_attack_time"],
        timingKind: "card_event",
        eventAction: "attack",
      })
    ).toBe(false);
  });

  it("BSSG01-R02 は合体中ブレイヴに書かれた『このスピリットのアタック時』効果もラベルで無効化する", () => {
    const result = runBssg01R02BattleImmediateNegate(
      BATTLE_BRAVE_ATTACK_DRAW_SOURCE
    );

    expect(result.log).toContain(
      "effect:negate:pending-stack:effect:stack:battle:immediate:p3-75-bssg01-r02-attack-draw"
    );
    expect(result.log).not.toContain("effect:draw:bob:1");
    const suppression = result.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "effect_suppression" &&
        ce.targetInstanceId === "bob-battle-attack-draw"
    );
    expect(suppression?.metadata?.effectFilter).toEqual({
      sourceDefinitionId: BATTLE_BRAVE_ATTACK_DRAW_SOURCE.cardNo,
      sourceKinds: ["spirit", "ultimate"],
      effectIndex: 0,
      effectLabels: ["spirit_attack_time"],
      timingKind: "card_event",
      eventAction: "attack",
    });
  });

  it("BSSG01-R02 は textRef が本文行だけの分割アタック時効果も見出しラベル継承で無効化する", () => {
    const regs = generateBattleImmediateEffectRegistrations(
      BATTLE_SPLIT_ATTACK_DRAWS_SOURCE
    );
    expect(regs[1]?.suppressionEffectDescriptor).toMatchObject({
      sourceDefinitionId: BATTLE_SPLIT_ATTACK_DRAWS_SOURCE.cardNo,
      effectIndex: 1,
      effectLabels: ["spirit_attack_time"],
      timingKind: "card_event",
      eventAction: "attack",
    });

    const { state, lookups } = stackBssg01R02AgainstBattleImmediate(
      BATTLE_SPLIT_ATTACK_DRAWS_SOURCE,
      { registrationIndex: 1 }
    );
    const passAction = getLegalActions({
      state,
      actingPlayerId: "bob",
      ...lookups,
    }).find((action) => action.kind === "pass_battle_flash");
    if (!passAction) {
      throw new Error("expected pass_battle_flash after BSSG01-R02 stack use");
    }

    const result = applyLegalAction({
      state,
      action: passAction,
      ...lookups,
    }).state;

    expect(result.log).toContain(
      "effect:negate:pending-stack:effect:stack:battle:immediate:p3-75-bssg01-r02-attack-draw"
    );
    expect(result.log).not.toContain("effect:draw:bob:1");
    const suppression = result.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "effect_suppression" &&
        ce.targetInstanceId === "bob-battle-attack-draw"
    );
    expect(suppression?.metadata?.effectFilter).toEqual({
      sourceDefinitionId: BATTLE_SPLIT_ATTACK_DRAWS_SOURCE.cardNo,
      sourceKinds: ["spirit", "ultimate"],
      effectIndex: 1,
      effectLabels: ["spirit_attack_time"],
      timingKind: "card_event",
      eventAction: "attack",
    });
  });

  it("BSSG01-R02 で無効化された battle immediate は宣言時 usageLimit を維持する", () => {
    const { state, lookups } = stackBssg01R02AgainstBattleImmediate(
      BATTLE_ATTACK_DRAW_ONCE_SOURCE
    );
    expect(
      state.effectUsageRecords.some(
        (record) => record.sourceInstanceId === "bob-battle-attack-draw"
      )
    ).toBe(true);

    const passAction = getLegalActions({
      state,
      actingPlayerId: "bob",
      ...lookups,
    }).find((action) => action.kind === "pass_battle_flash");
    if (!passAction) {
      throw new Error("expected pass_battle_flash after BSSG01-R02 stack use");
    }

    const result = applyLegalAction({
      state,
      action: passAction,
      ...lookups,
    }).state;

    expect(result.log).toContain(
      "effect:negate:pending-stack:effect:stack:battle:immediate:p3-75-bssg01-r02-attack-draw"
    );
    expect(
      result.effectUsageRecords.some(
        (record) => record.sourceInstanceId === "bob-battle-attack-draw"
      )
    ).toBe(true);
  });

  it("BSSG01-R02 の turn effect_suppression は同じターンの後続アタック時効果を抑止する", () => {
    const firstResult = runBssg01R02BattleImmediateNegate();
    const suppression = firstResult.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "effect_suppression" &&
        ce.targetInstanceId === "bob-battle-attack-draw"
    );
    if (!suppression) {
      throw new Error("expected BSSG01-R02 effect_suppression CE");
    }

    const lookups = buildBssg01R02BattleImmediateLookups();
    const baseState: GameState = {
      ...buildBssg01R02BattleImmediateResponseState(),
      activeContinuousEffects: [suppression],
    };
    const declarations = getLegalActions({
      state: baseState,
      actingPlayerId: "bob",
      ...lookups,
    }).filter(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_battle_immediate_effect" }
      > => action.kind === "resolve_battle_immediate_effect"
    );
    expect(declarations.some((action) => action.skipOnly !== true)).toBe(false);
    const declaration = declarations.find((action) => action.skipOnly === true);
    if (!declaration) {
      throw new Error("expected suppressed battle immediate drain action");
    }

    const current = applyLegalAction({
      state: baseState,
      action: declaration,
      ...lookups,
    }).state;
    expect(
      current.activeAttack?.flashWindowState?.pendingStackAction
    ).toBeNull();
    expect(current.log).toContain(
      "skip_optional_battle_immediate_effect:p3-75-bssg01-r02-attack-draw"
    );
    expect(current.log).not.toContain("effect:draw:bob:1");
    expect(
      current.cardInstances.find((card) => card.instanceId === "bob-deck-1")
        ?.zone
    ).toBe("deck");
  });

  it("BSSG01-R02 の turn effect_suppression は選んだアタック時効果1つだけを抑止する", () => {
    const firstResult = runBssg01R02BattleImmediateNegate(
      BATTLE_TWO_ATTACK_DRAWS_SOURCE
    );
    const suppression = firstResult.activeContinuousEffects.find(
      (ce) =>
        ce.modifierTag === "effect_suppression" &&
        ce.targetInstanceId === "bob-battle-attack-draw"
    );
    if (!suppression) {
      throw new Error("expected BSSG01-R02 effect_suppression CE");
    }

    expect(suppression.metadata?.effectFilter).toEqual({
      sourceDefinitionId: BATTLE_TWO_ATTACK_DRAWS_SOURCE.cardNo,
      sourceKinds: ["spirit", "ultimate"],
      effectIndex: 0,
      effectLabels: ["spirit_attack_time"],
      timingKind: "card_event",
      eventAction: "attack",
    });

    const lookups = buildBssg01R02BattleImmediateLookups(
      BATTLE_TWO_ATTACK_DRAWS_SOURCE
    );
    const baseState: GameState = {
      ...buildBssg01R02BattleImmediateResponseState(
        BATTLE_TWO_ATTACK_DRAWS_SOURCE,
        {
          timing: "attack",
          registrationIndex: 1,
        }
      ),
      activeContinuousEffects: [suppression],
    };
    const declaration = getLegalActions({
      state: baseState,
      actingPlayerId: "bob",
      ...lookups,
    }).find((action) => action.kind === "resolve_battle_immediate_effect");
    if (
      !declaration ||
      declaration.kind !== "resolve_battle_immediate_effect"
    ) {
      throw new Error("expected second attack immediate declaration");
    }

    let current = applyLegalAction({
      state: baseState,
      action: declaration,
      ...lookups,
    }).state;
    expect(
      current.activeAttack?.flashWindowState?.pendingStackAction
        ?.suppressionEffectDescriptor
    ).toMatchObject({
      sourceDefinitionId: BATTLE_TWO_ATTACK_DRAWS_SOURCE.cardNo,
      effectIndex: 1,
      effectLabels: ["spirit_attack_time"],
      timingKind: "card_event",
      eventAction: "attack",
    });

    const passAction = getLegalActions({
      state: current,
      actingPlayerId: "alice",
      ...lookups,
    }).find((action) => action.kind === "pass_battle_flash");
    if (!passAction) {
      throw new Error("expected pass_battle_flash for alice");
    }
    current = applyLegalAction({
      state: current,
      action: passAction,
      ...lookups,
    }).state;

    expect(
      current.log.some((entry) =>
        entry.startsWith(
          "reevaluation:before_each_step:failed:effect_suppression"
        )
      )
    ).toBe(false);
    expect(current.log).toContain("effect:draw:bob:1");
    expect(
      current.cardInstances.find((card) => card.instanceId === "bob-deck-1")
        ?.zone
    ).toBe("hand");
  });

  it("turn effect_suppression は後続ブロック時効果を発揮宣言入口で抑止する", () => {
    const regs = generateBattleImmediateEffectRegistrations(
      BATTLE_ATTACK_BLOCK_DRAW_SOURCE
    );
    const blockRegistrationIndex = regs.findIndex(
      (registration) =>
        registration.effectIndex === 0 && registration.timing === "block"
    );
    expect(blockRegistrationIndex).toBeGreaterThanOrEqual(0);

    const blockSuppression: ContinuousEffect = {
      effectId: "p3-75-turn-block-suppression",
      sourceInstanceId: "alice-bssg01-r02",
      sourceDefinitionId: BSSG01_R02.cardNo,
      actingPlayerId: "alice",
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "effect_suppression",
      forceLevel: "prohibition",
      targetInstanceId: "bob-battle-attack-draw",
      metadata: {
        effectFilter: {
          sourceDefinitionId: BATTLE_ATTACK_BLOCK_DRAW_SOURCE.cardNo,
          effectIndex: 0,
          timingKind: "card_event",
          eventAction: "block",
        },
      },
    };
    const lookups = buildBssg01R02BattleImmediateLookups(
      BATTLE_ATTACK_BLOCK_DRAW_SOURCE
    );
    const baseState: GameState = {
      ...buildBssg01R02BattleImmediateResponseState(
        BATTLE_ATTACK_BLOCK_DRAW_SOURCE,
        {
          timing: "block",
          registrationIndex: blockRegistrationIndex,
        }
      ),
      activeContinuousEffects: [blockSuppression],
    };
    const declarations = getLegalActions({
      state: baseState,
      actingPlayerId: "bob",
      ...lookups,
    }).filter(
      (
        action
      ): action is Extract<
        LegalAction,
        { kind: "resolve_battle_immediate_effect" }
      > => action.kind === "resolve_battle_immediate_effect"
    );
    expect(declarations.some((action) => action.skipOnly !== true)).toBe(false);
    const declaration = declarations.find((action) => action.skipOnly === true);
    if (!declaration) {
      throw new Error("expected suppressed block immediate drain action");
    }

    const current = applyLegalAction({
      state: baseState,
      action: declaration,
      ...lookups,
    }).state;
    expect(
      current.activeAttack?.flashWindowState?.pendingStackAction
    ).toBeNull();
    expect(current.log).toContain(
      "skip_optional_battle_immediate_effect:p3-75-bssg01-r02-block-draw"
    );
    expect(current.log).not.toContain("effect:draw:bob:1");
    expect(
      current.cardInstances.find((card) => card.instanceId === "bob-deck-1")
        ?.zone
    ).toBe("deck");
  });

  it("BSSG01-R02 は解決直前に効果を受けない相手スピリットのアタック時効果を無効化しない", () => {
    const { state, lookups } = stackBssg01R02AgainstBattleImmediate();
    const immuneState: GameState = {
      ...state,
      activeContinuousEffects: [
        ...state.activeContinuousEffects,
        defenseImmuneCE("bob-battle-attack-draw"),
      ],
    };
    const passAction = getLegalActions({
      state: immuneState,
      actingPlayerId: "bob",
      ...lookups,
    }).find((action) => action.kind === "pass_battle_flash");
    if (!passAction) {
      throw new Error("expected pass_battle_flash after BSSG01-R02 stack use");
    }

    const result = applyLegalAction({
      state: immuneState,
      action: passAction,
      ...lookups,
    }).state;

    expect(result.log).not.toContain(
      "effect:negate:pending-stack:effect:stack:battle:immediate:p3-75-bssg01-r02-attack-draw"
    );
    expect(result.log).toContain("effect:draw:bob:1");
    expect(
      result.cardInstances.find((card) => card.instanceId === "bob-deck-1")
        ?.zone
    ).toBe("hand");
  });

  it("BSTH10.5-R21 は相手のコスト4スピリット召喚を無効化する", () => {
    const result = runPassWithState(
      buildBsth10_5NegateCascadeState({
        negateDefinition: BSTH10_5_R21,
        targetDefinition: P3_75_TARGET_SPIRIT_COST4,
        targetActionKind: "summon",
      }),
      [BSTH10_5_R21, P3_75_TARGET_SPIRIT_COST4]
    );

    expect(result.log).toContain(
      "effect:negate:pending-stack:summon:stack:bob-target"
    );
    expect(result.log).toContain(
      "effect:nullified:chain:bob-target:bob-target-card"
    );
    expect(
      result.cardInstances.find((card) => card.instanceId === "bob-target-card")
        ?.zone
    ).toBe("trash");
  });

  it("BSTH10.5-R21 は印字7でも提示時コスト4の BSSL01-M01 召喚を無効化する", () => {
    const result = runPassWithState(
      buildBsth10_5NegateCascadeState({
        negateDefinition: BSTH10_5_R21,
        targetDefinition: BSSL01_M01,
        targetActionKind: "summon",
        targetReducedCost: 4,
        targetCostForFilter: 4,
      }),
      [BSTH10_5_R21, BSSL01_M01]
    );

    expect(result.log).toContain(
      "effect:negate:pending-stack:summon:stack:bob-target"
    );
    expect(result.log).toContain(
      "effect:nullified:chain:bob-target:bob-target-card"
    );
    expect(
      result.cardInstances.find((card) => card.instanceId === "bob-target-card")
        ?.zone
    ).toBe("trash");
  });

  it("BSTH10.5-R21 は印字7を通常軽減で4支払いにしただけの BSSL01-M01 召喚を無効化しない", () => {
    const result = runPassWithState(
      buildBsth10_5NegateCascadeState({
        negateDefinition: BSTH10_5_R21,
        targetDefinition: BSSL01_M01,
        targetActionKind: "summon",
        targetReducedCost: 4,
      }),
      [BSTH10_5_R21, BSSL01_M01]
    );

    expect(result.log).not.toContain(
      "effect:negate:pending-stack:summon:stack:bob-target"
    );
    expect(result.log).not.toContain(
      "effect:nullified:chain:bob-target:bob-target-card"
    );
  });

  it("BSTH10.5-R21 は相手のコスト4ネクサス配置も無効化する", () => {
    const result = runPassWithState(
      buildBsth10_5NegateCascadeState({
        negateDefinition: BSTH10_5_R21,
        targetDefinition: P3_75_TARGET_NEXUS_COST4,
        targetActionKind: "place_nexus",
      }),
      [BSTH10_5_R21, P3_75_TARGET_NEXUS_COST4]
    );

    expect(result.log).toContain(
      "effect:negate:pending-stack:place:stack:bob-target"
    );
    expect(result.log).toContain(
      "effect:nullified:chain:bob-target:bob-target-card"
    );
    expect(
      result.cardInstances.find((card) => card.instanceId === "bob-target-card")
        ?.zone
    ).toBe("trash");
  });

  it("BSTH10.5-R22 はライフ4以下で召喚を無効化し、ライフ5以上では使用条件を満たさない", () => {
    const definitions = [BSTH10_5_R22, P3_75_TARGET_SPIRIT_COST4];
    const life4 = runPassWithState(
      buildBsth10_5NegateCascadeState({
        negateDefinition: BSTH10_5_R22,
        targetDefinition: P3_75_TARGET_SPIRIT_COST4,
        targetActionKind: "summon",
        aliceLife: 4,
      }),
      definitions
    );
    const life5 = runPassWithState(
      buildBsth10_5NegateCascadeState({
        negateDefinition: BSTH10_5_R22,
        targetDefinition: P3_75_TARGET_SPIRIT_COST4,
        targetActionKind: "summon",
        aliceLife: 5,
      }),
      definitions
    );

    expect(life4.log).toContain(
      "effect:negate:pending-stack:summon:stack:bob-target"
    );
    expect(
      life4.cardInstances.find((card) => card.instanceId === "bob-target-card")
        ?.zone
    ).toBe("trash");
    expect(life5.log).not.toContain(
      "effect:negate:pending-stack:summon:stack:bob-target"
    );
    expect(life5.log).not.toContain(
      "effect:nullified:chain:bob-target:bob-target-card"
    );
  });
});
