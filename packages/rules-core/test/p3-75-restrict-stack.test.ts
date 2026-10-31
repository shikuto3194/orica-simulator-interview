import { describe, it, expect, beforeEach } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { executeEffect } from "../src/effect/effect-interpreter";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { getLegalActions } from "../src/legal/legal-actions";
import {
  generateMagicRegistrations,
  generateTriggeredEffectRegistrations,
} from "../src/effect/structured-effect-registrations";
import { evaluateCondition } from "../src/effect/structured-effect-interpreter";
import type {
  CardDefinition,
  CardInstance,
  GameState,
  ContinuousEffectTag,
} from "../src/model";
import type { Effect } from "../src/dsl-types";
import {
  isFlashRestricted,
  isStackRestricted,
  isStackSourceSuppressedForPlayer,
  filterRestrictedTimings,
  getResponseStackSourceInstanceId,
} from "../src/legal/legal-actions-shared";
import type { ActiveStack } from "../src/model";

// ============================================================
// P3-75: restrict_stack プリミティブ + restrict_flash/restrict_stack 消費
// ============================================================
//
// 1. restrict_stack CE 登録が正しく行われることを検証
// 2. isFlashRestricted / isStackRestricted が CE を正しく読むことを検証
// 3. filterRestrictedTimings が制限タイミングを正しく除外することを検証

function makeDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-RS-001",
    name: "テストスピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "星竜",
    sourceUrls: [],
    sourceConfidence: "C",
    ...overrides,
  };
}

function makeInstance(
  def: CardDefinition,
  overrides: Partial<CardInstance> = {}
): CardInstance {
  const base = createCardInstance(def, {
    ownerPlayerId: "alice",
    zone: "field",
    cores: 1,
  });
  return { ...base, ...overrides };
}

function makeState(cards: CardInstance[]): GameState {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: cards,
    startingLife: 5,
  });
}

const defRegistry = new Map<string, CardDefinition>();
function getDef(id: string): CardDefinition | undefined {
  return defRegistry.get(id);
}
function registerDef(def: CardDefinition): void {
  defRegistry.set(def.cardNo, def);
}

function runEffect(action: Effect["steps"][number]["action"]) {
  const sourceDef = makeDef({ cardNo: "RS-SRC" });
  registerDef(sourceDef);
  const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
  const state = makeState([sourceCard]);

  const effect: Effect = {
    timing: { kind: "card_event", event: "attack" },
    steps: [{ action }],
  };

  return executeEffect({
    chainId: "test:p3-75-restrict-stack:93",
    state,
    effect,
    sourceInstanceId: "src-1",
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
  });
}

describe("P3-75: restrict_stack — CE 登録", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it("restrict_stack アクションで restrict_stack タグの CE が登録される", () => {
    const result = runEffect({
      kind: "restrict_stack",
      player: "opponent",
      duration: { scope: "turn" },
    });

    const ces = result.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === ("restrict_stack" as ContinuousEffectTag)
    );
    expect(ces).toHaveLength(1);
    expect(ces[0]!.targetInstanceId).toBe("bob"); // opponent
    expect(ces[0]!.duration.scope).toBe("turn");
  });

  it("restrict_stack CE の duration が while_on_field で登録できる", () => {
    const result = runEffect({
      kind: "restrict_stack",
      player: "opponent",
      duration: { scope: "while_on_field" },
    });

    const ces = result.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === ("restrict_stack" as ContinuousEffectTag)
    );
    expect(ces).toHaveLength(1);
    expect(ces[0]!.duration.scope).toBe("while_on_field");
  });

  it("ログに restrict_stack:registered が記録される", () => {
    const result = runEffect({
      kind: "restrict_stack",
      player: "opponent",
      duration: { scope: "turn" },
    });

    expect(
      result.log.some((l) => l.includes("effect:restrict_stack:registered"))
    ).toBe(true);
  });
});

describe("P3-75: restrict_flash CE 登録", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it("restrict_flash アクションで restrict_flash_any タグの CE が登録される", () => {
    const result = runEffect({
      kind: "restrict_flash",
      player: "opponent",
      duration: { scope: "battle" },
    });

    const ces = result.activeContinuousEffects.filter((ce) =>
      (ce.modifierTag as string).startsWith("restrict_flash")
    );
    expect(ces).toHaveLength(1);
    expect(ces[0]!.targetInstanceId).toBe("bob");
  });
});

describe("P3-75: isFlashRestricted / isStackRestricted — CE 消費", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it("restrict_stack CE があるとき isStackRestricted が true", () => {
    const result = runEffect({
      kind: "restrict_stack",
      player: "opponent",
      duration: { scope: "turn" },
    });

    expect(isStackRestricted(result, "bob")).toBe(true);
    // alice (CE 発動者) は制限されない
    expect(isStackRestricted(result, "alice")).toBe(false);
  });

  it("restrict_stack CE が無いとき isStackRestricted が false", () => {
    const state = makeState([]);
    expect(isStackRestricted(state, "bob")).toBe(false);
  });

  it("restrict_flash CE があるとき isFlashRestricted が true", () => {
    const result = runEffect({
      kind: "restrict_flash",
      player: "opponent",
      duration: { scope: "battle" },
    });

    expect(isFlashRestricted(result, "bob")).toBe(true);
    expect(isFlashRestricted(result, "alice")).toBe(false);
  });

  it("restrict_flash CE が無いとき isFlashRestricted が false", () => {
    const state = makeState([]);
    expect(isFlashRestricted(state, "bob")).toBe(false);
  });
});

describe("P3-75: suppress_stack_source — スタックタイミング元抑止", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it("BSDB01-M02 型: 発揮元カードだけを相手の stack timing source から外す", () => {
    const result = runEffect({
      kind: "suppress_stack_source",
      target: "self",
      player: "opponent",
      duration: { scope: "while_on_field" },
    });

    expect(isStackSourceSuppressedForPlayer(result, "src-1", "bob")).toBe(true);
    expect(isStackSourceSuppressedForPlayer(result, "src-1", "alice")).toBe(
      false
    );
    expect(isStackSourceSuppressedForPlayer(result, "other", "bob")).toBe(
      false
    );
  });

  it("BSDB01-M02 型: source 抑止は stack だけを除去し flash は残す", () => {
    const result = runEffect({
      kind: "suppress_stack_source",
      target: "self",
      player: "opponent",
      duration: { scope: "while_on_field" },
    });

    const filtered = filterRestrictedTimings(
      ["flash", "stack"],
      result,
      "bob",
      "src-1"
    );
    expect(filtered).toEqual(["flash"]);

    const unrelated = filterRestrictedTimings(
      ["flash", "stack"],
      result,
      "bob",
      "other"
    );
    expect(unrelated).toEqual(["flash", "stack"]);
  });

  it("効果単位の suppress_stack_source は effectFilter が一致する stack source だけを除去する", () => {
    const result = runEffect({
      kind: "suppress_stack_source",
      target: "self",
      player: "opponent",
      duration: { scope: "while_on_field" },
      effectFilter: { effectIndex: 2 },
    });
    const matchingStack = {
      cardInstanceId: "src-1",
      suppressionEffectDescriptor: { effectIndex: 2 },
    } as ActiveStack;
    const otherStack = {
      cardInstanceId: "src-1",
      suppressionEffectDescriptor: { effectIndex: 0 },
    } as ActiveStack;

    expect(
      filterRestrictedTimings(
        ["flash", "stack"],
        result,
        "bob",
        "src-1",
        getDef,
        matchingStack
      )
    ).toEqual(["flash"]);
    expect(
      filterRestrictedTimings(
        ["flash", "stack"],
        result,
        "bob",
        "src-1",
        getDef,
        otherStack
      )
    ).toEqual(["flash", "stack"]);
  });

  it("effectFilter は stack source の keyword descriptor でも一致判定できる", () => {
    const result = runEffect({
      kind: "suppress_stack_source",
      target: "self",
      player: "opponent",
      duration: { scope: "while_on_field" },
      effectFilter: { keywords: ["accel"] },
    });
    const accelStack = {
      cardInstanceId: "src-1",
      suppressionEffectDescriptor: { keywords: ["accel"] },
    } as ActiveStack;
    const changeStack = {
      cardInstanceId: "src-1",
      suppressionEffectDescriptor: { keywords: ["change"] },
    } as ActiveStack;

    expect(
      filterRestrictedTimings(
        ["flash", "stack"],
        result,
        "bob",
        "src-1",
        getDef,
        accelStack
      )
    ).toEqual(["flash"]);
    expect(
      filterRestrictedTimings(
        ["flash", "stack"],
        result,
        "bob",
        "src-1",
        getDef,
        changeStack
      )
    ).toEqual(["flash", "stack"]);
  });

  it("ultimate の triggered registration は descriptor sourceKind を ultimate として保持する", () => {
    const ultimateDef = makeDef({
      cardNo: "ULTIMATE-DESCRIPTOR-SOURCE",
      printedCategory: "ultimate",
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
    });

    const [registration] = generateTriggeredEffectRegistrations(ultimateDef);

    expect(registration).toBeDefined();
    expect(registration?.sourceKind).toBe("spirit");
    expect(registration?.suppressionEffectDescriptor?.sourceKind).toBe(
      "ultimate"
    );
  });

  it("direct fallback の suppress_stack_source は timingScope 外では抑止しない", () => {
    const sourceDef = makeDef({
      cardNo: "TIMING-SCOPE-SRC",
      effects: [
        {
          timing: { kind: "continuous" },
          timingScope: { player: "self", period: "attack" },
          steps: [
            {
              action: {
                kind: "suppress_stack_source",
                target: "self",
                player: "opponent",
                duration: { scope: "while_on_field" },
              },
            },
          ],
        },
      ],
    });
    registerDef(sourceDef);
    const sourceCard = makeInstance(sourceDef, {
      instanceId: "timing-source",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const ownAttackState = {
      ...makeState([sourceCard]),
      activePlayerId: "alice",
      step: "attack",
    };
    const opponentAttackState = {
      ...makeState([sourceCard]),
      activePlayerId: "bob",
      step: "attack",
    };

    expect(
      filterRestrictedTimings(
        ["flash", "stack"],
        ownAttackState,
        "bob",
        "timing-source",
        getDef
      )
    ).toEqual(["flash"]);
    expect(
      filterRestrictedTimings(
        ["flash", "stack"],
        opponentAttackState,
        "bob",
        "timing-source",
        getDef
      )
    ).toEqual(["flash", "stack"]);
  });

  it("BSDB01-M02 型: 手札のこのカードが stack source でも相手の stack だけを除去する", () => {
    const piccoloDef = makeDef({
      cardNo: "BSDB01-M02",
      effects: [
        {
          timing: { kind: "continuous" },
          applicability: { zone: ["hand", "in_use", "field"] },
          steps: [
            {
              action: {
                kind: "suppress_stack_source",
                target: "self",
                player: "opponent",
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [0],
        },
      ],
    });
    registerDef(piccoloDef);
    const handPiccolo = makeInstance(piccoloDef, {
      instanceId: "piccolo-hand",
      zone: "hand",
      normalCoreCount: 0,
    });
    const declaredPiccolo = makeInstance(piccoloDef, {
      instanceId: "piccolo-in-use",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const state = makeState([handPiccolo, declaredPiccolo]);

    expect(
      isStackSourceSuppressedForPlayer(state, "piccolo-hand", "bob", getDef)
    ).toBe(true);

    expect(
      filterRestrictedTimings(
        ["flash", "stack"],
        state,
        "bob",
        "piccolo-hand",
        getDef
      )
    ).toEqual(["flash"]);
    expect(
      filterRestrictedTimings(
        ["flash", "stack"],
        state,
        "bob",
        "piccolo-in-use",
        getDef
      )
    ).toEqual(["flash"]);
    expect(
      filterRestrictedTimings(
        ["flash", "stack"],
        state,
        "alice",
        "piccolo-hand",
        getDef
      )
    ).toEqual(["flash", "stack"]);
  });

  it("BSDB01-M02 型: preDeclaration nested stack は pending stack source を優先する", () => {
    const pending = {
      cardInstanceId: "BSDB01-M02-pending-stack-source",
    } as ActiveStack;

    expect(
      getResponseStackSourceInstanceId(
        { pendingStackAction: pending },
        "attack-declaration-source"
      )
    ).toBe("BSDB01-M02-pending-stack-source");
    expect(
      getResponseStackSourceInstanceId(
        { pendingStackAction: null },
        "attack-declaration-source"
      )
    ).toBe("attack-declaration-source");
  });

  it("BSDB01-M02 型: 条件付き direct source fallback は fail-closed", () => {
    const conditionalDef = makeDef({
      cardNo: "BSDB01-M02-CONDITIONAL",
      effects: [
        {
          timing: { kind: "continuous" },
          applicability: { zone: ["hand", "in_use", "field"] },
          condition: [{ kind: "count_value", player: "self", min: 99 }],
          steps: [
            {
              action: {
                kind: "suppress_stack_source",
                target: "self",
                player: "opponent",
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [0],
        },
      ],
    });
    registerDef(conditionalDef);
    const conditionalSource = makeInstance(conditionalDef, {
      instanceId: "piccolo-conditional-in-use",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const state = makeState([conditionalSource]);

    expect(
      filterRestrictedTimings(
        ["flash", "stack"],
        state,
        "bob",
        "piccolo-conditional-in-use",
        getDef
      )
    ).toEqual(["flash", "stack"]);
  });

  it("条件付き direct source fallback は evaluateCondition 注入時に条件を評価して抑止する", () => {
    const conditionalDef = makeDef({
      cardNo: "BSDB01-M02-CONDITIONAL-EVALUATED",
      effects: [
        {
          timing: { kind: "continuous" },
          applicability: { zone: ["hand", "in_use", "field"] },
          condition: [{ kind: "count_value", player: "self", min: 1 }],
          steps: [
            {
              action: {
                kind: "suppress_stack_source",
                target: "self",
                player: "opponent",
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [0],
        },
      ],
    });
    registerDef(conditionalDef);
    const conditionalSource = makeInstance(conditionalDef, {
      instanceId: "piccolo-conditional-evaluated-in-use",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const state = {
      ...makeState([conditionalSource]),
      players: makeState([conditionalSource]).players.map((player) =>
        player.id === "alice" ? { ...player, countValue: 1 } : player
      ),
    };

    expect(
      filterRestrictedTimings(
        ["flash", "stack"],
        state,
        "bob",
        "piccolo-conditional-evaluated-in-use",
        getDef,
        undefined,
        undefined,
        undefined,
        undefined,
        evaluateCondition
      )
    ).toEqual(["flash"]);
  });

  it("BSDB01-M02 型: zone 以外の applicability がある direct source fallback は fail-closed", () => {
    const leveledDef = makeDef({
      cardNo: "BSDB01-M02-LEVEL-GATED",
      effects: [
        {
          timing: { kind: "continuous" },
          applicability: {
            zone: ["hand", "in_use", "field"],
            level: { min: 2 },
          },
          steps: [
            {
              action: {
                kind: "suppress_stack_source",
                target: "self",
                player: "opponent",
                duration: { scope: "while_on_field" },
              },
            },
          ],
          textRef: [0],
        },
      ],
    });
    registerDef(leveledDef);
    const leveledSource = makeInstance(leveledDef, {
      instanceId: "piccolo-leveled-in-use",
      zone: "in_use",
      normalCoreCount: 0,
    });
    const state = makeState([leveledSource]);

    expect(
      filterRestrictedTimings(
        ["flash", "stack"],
        state,
        "bob",
        "piccolo-leveled-in-use",
        getDef
      )
    ).toEqual(["flash", "stack"]);
  });

  it("BSDB01-M02 実カード: stack window の応答は mode:stack のみ残り、抑止時は pass のみにする", () => {
    const piccoloDef = ALL_CARDS.find((c) => c.cardNo === "BSDB01-M02");
    expect(piccoloDef).toBeDefined();
    if (!piccoloDef) throw new Error("BSDB01-M02 not found");
    const plainSourceDef = makeDef({ cardNo: "PLAIN-SOURCE" });
    const stackMagicDef = makeDef({
      cardNo: "STACK-MAGIC-RESPONDER",
      printedCategory: "magic",
      cost: 0,
      levelDefs: [],
      effects: [
        {
          timing: { kind: "activated", mode: "stack" },
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
    });
    const grandwalkerDef = makeDef({
      cardNo: "GW-STACK-RESPONDER",
      printedCategory: "nexus",
      grandwalkerData: {
        kind: "guided",
        oracleTriggerKinds: ["summon"] as const,
        oracleConditions: [],
        divineSkills: [
          {
            label: "guided_skill",
            coreCost: 0,
            timing: "flash",
            minLevel: 1,
          },
        ],
      },
    });
    registerDef(piccoloDef);
    registerDef(plainSourceDef);
    registerDef(stackMagicDef);
    registerDef(grandwalkerDef);

    const makeStackState = (source: CardInstance): GameState => ({
      ...makeState([
        source,
        makeInstance(stackMagicDef, {
          instanceId: "stack-magic-bob",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "hand",
          normalCoreCount: 0,
        }),
        makeInstance(grandwalkerDef, {
          instanceId: "gw-bob",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ]),
      step: "attack",
      window: "stack",
      stackWindow: {
        actingPlayerId: "alice",
        previousWindow: "main",
        priorityPlayerId: "bob",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "alice",
        pendingStackAction: {
          cardInstanceId: source.instanceId,
          chainId: "test:stack-suppression",
        } as ActiveStack,
        subStackEverOpened: false,
        burstWindowKind: null,
      },
    });
    const optionsFor = (state: GameState) => ({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: () => [],
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredMagicActions: (cardNo: string) => {
        const def = getDef(cardNo);
        return def ? generateMagicRegistrations(def) : [];
      },
    });

    const unsuppressedActions = getLegalActions(
      optionsFor(
        makeStackState(
          makeInstance(plainSourceDef, {
            instanceId: "plain-source",
            zone: "in_use",
            normalCoreCount: 0,
          })
        )
      )
    );
    expect(unsuppressedActions.some((a) => a.kind === "use_magic")).toBe(true);
    expect(unsuppressedActions.some((a) => a.kind === "use_divine_skill")).toBe(
      false
    );

    const livePiccoloSource = makeInstance(piccoloDef, {
      instanceId: "piccolo-in-use",
      zone: "in_use",
      normalCoreCount: 0,
    });
    expect(
      filterRestrictedTimings(
        ["flash", "stack"],
        makeState([livePiccoloSource]),
        "bob",
        "piccolo-in-use",
        getDef
      )
    ).toEqual(["flash"]);

    const suppressedActions = getLegalActions(
      optionsFor(makeStackState(livePiccoloSource))
    );
    expect(suppressedActions.map((a) => a.kind)).toEqual(["pass_stack"]);
  });
});

describe("P3-75: filterRestrictedTimings — タイミング制限消費", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it.each(["flash", "stack"] as const)(
    "本文中の%sタイミング行動には効果種別の禁止を適用しない",
    (mode) => {
      const state = runEffect({
        kind: mode === "flash" ? "restrict_flash" : "restrict_stack",
        player: "opponent",
        duration: { scope: "turn" },
      });
      expect(filterRestrictedTimings([mode], state, "bob")).toEqual([]);
      expect(
        filterRestrictedTimings(
          [mode],
          state,
          "bob",
          undefined,
          getDef,
          undefined,
          "field",
          undefined,
          { activatedMode: mode, activationLabel: "none" }
        )
      ).toEqual([mode]);
    }
  );

  it("スタックタイミング元の抑止はラベルのない行動にも適用する", () => {
    const state = runEffect({
      kind: "suppress_stack_source",
      target: "self",
      player: "opponent",
      duration: { scope: "while_on_field" },
    });
    expect(
      filterRestrictedTimings(
        ["stack"],
        state,
        "bob",
        "src-1",
        getDef,
        undefined,
        "field",
        undefined,
        { activatedMode: "stack", activationLabel: "none" }
      )
    ).toEqual([]);
  });

  it("restrict_stack CE で stack タイミングが除去される", () => {
    const result = runEffect({
      kind: "restrict_stack",
      player: "opponent",
      duration: { scope: "turn" },
    });

    // bob (opponent) のタイミングからは stack が消える
    const filtered = filterRestrictedTimings(["flash", "stack"], result, "bob");
    expect(filtered).toEqual(["flash"]);

    // alice (発動者) のタイミングは影響を受けない
    const aliceFiltered = filterRestrictedTimings(
      ["flash", "stack"],
      result,
      "alice"
    );
    expect(aliceFiltered).toEqual(["flash", "stack"]);
  });

  it("restrict_flash CE で flash タイミングが除去される", () => {
    const result = runEffect({
      kind: "restrict_flash",
      player: "opponent",
      duration: { scope: "battle" },
    });

    const filtered = filterRestrictedTimings(["main", "flash"], result, "bob");
    expect(filtered).toEqual(["main"]);
  });

  it("restrict_stack と restrict_flash 両方で flash + stack が除去される", () => {
    // restrict_stack を登録
    let state = runEffect({
      kind: "restrict_stack",
      player: "opponent",
      duration: { scope: "turn" },
    });

    // restrict_flash も登録
    const sourceDef = makeDef({ cardNo: "RS-SRC2" });
    registerDef(sourceDef);
    const sourceCard = makeInstance(sourceDef, { instanceId: "src-2" });
    state = {
      ...state,
      cardInstances: [...state.cardInstances, sourceCard],
    };

    const effect: Effect = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "restrict_flash",
            player: "opponent",
            duration: { scope: "turn" },
          },
        },
      ],
    };

    state = executeEffect({
      chainId: "test:p3-75-restrict-stack:866",
      state,
      effect,
      sourceInstanceId: "src-2",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });

    const filtered = filterRestrictedTimings(
      ["main", "flash", "stack"],
      state,
      "bob"
    );
    expect(filtered).toEqual(["main"]);
  });

  it("main タイミングは restrict_flash / restrict_stack の影響を受けない", () => {
    const result = runEffect({
      kind: "restrict_stack",
      player: "opponent",
      duration: { scope: "turn" },
    });

    const filtered = filterRestrictedTimings(["main"], result, "bob");
    expect(filtered).toEqual(["main"]);
  });

  it("CE が無いとき全タイミングがそのまま返る", () => {
    const state = makeState([]);
    const filtered = filterRestrictedTimings(
      ["main", "flash", "stack"],
      state,
      "bob"
    );
    expect(filtered).toEqual(["main", "flash", "stack"]);
  });
});
