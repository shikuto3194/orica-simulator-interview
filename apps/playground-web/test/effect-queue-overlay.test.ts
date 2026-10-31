import { describe, expect, it } from "vitest";
import type {
  BurstEventKind,
  CardDefinition,
  ContinuousEffect,
  GameState,
  LegalAction,
  PendingBurstCheck,
  PendingTriggeredEffect,
} from "@orica/rules-core";
import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  createMechanicPendingTriggeredEffect,
} from "@orica/rules-core";
import { buildEffectQueue } from "../src/components/EffectQueueOverlay";
import {
  getCurrentEffectDisplaysForCard,
  getGrantedEffectsForCard,
} from "../src/utils/granted-effect-display";

/** main-step スタック窓 1 件だけの GameState を組む (効果テキスト/ラベル抽出の検証用)。 */
function makeStackState(
  definition: CardDefinition,
  pendingStackAction: Record<string, unknown>,
  burstWindowKind: "activation" | "effect_declaration" | null = null
): GameState {
  const source = createCardInstance(definition, {
    instanceId: "stack-src",
    ownerPlayerId: "alice",
    zone: "field",
    cores: 1,
  });
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source],
    }),
    step: "main",
    window: "stack",
    stackWindow: {
      actingPlayerId: "alice",
      previousWindow: "none",
      priorityPlayerId: "bob",
      consecutivePassCount: 0,
      stackResponseSourcePlayerId: "alice",
      subStackEverOpened: false,
      burstWindowKind,
      pendingStackAction: {
        stackId: "stack-1",
        chainId: "chain-1",
        actingPlayerId: "alice",
        cardInstanceId: source.instanceId,
        cardDefinitionId: definition.cardNo,
        targetInstanceIds: [],
        targetEffectFilterTags: [],
        previousResponseSourcePlayerId: null,
        previousPendingStackAction: null,
        ...pendingStackAction,
      },
    },
  } as unknown as GameState;
}

function makeDefinition(): CardDefinition {
  return {
    cardNo: "P3-28-HAND",
    name: "P3-28 Private Source",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    textLines: ["『スタートステップ』このカードを召喚できる。"],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}

describe("queue source state labels", () => {
  it.each([
    ["spirit", "スピリット"],
    ["ultimate", "アルティメット"],
    ["brave", "ブレイヴ"],
    ["nexus", "ネクサス"],
    ["magic", "マジック"],
  ] as const)("labels declared %s effects", (printedCategory, label) => {
    const definition = { ...makeDefinition(), printedCategory };
    const state = makeStackState(definition, {
      actionKind: "field_card_effect",
    });
    const items = buildEffectQueue(
      state,
      () => definition,
      () => [],
      "alice"
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.sourceStateLabel).toBe(label);

    definition.effects = [
      {
        timing: { kind: "phase", step: "main", subPhase: "start" },
        steps: [{ action: { kind: "draw", player: "self", count: 1 } }],
      },
    ];
    const triggered = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: state.cardInstances,
      pendingTriggeredEffects: [
        {
          pendingId: "category-label",
          actingPlayerId: "alice",
          eventKind: "start_step",
          event: {
            family: "step_timing",
            validationMode: "snapshot_only",
            step: "main",
            subPhase: "start",
          },
          source: "step_transition",
          chainId: "test:effect-queue-overlay:115",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: null,
          step: "main",
          window: "none",
          resolvedSourceInstanceIds: [],
        },
      ],
    });
    const queued = buildEffectQueue(
      triggered,
      () => definition,
      buildTriggeredEffectLookup([definition]),
      "alice"
    );
    expect(queued).toHaveLength(1);
    expect(queued[0]?.sourceStateLabel).toBe(label);
  });

  it("prioritizes soul state and the current zone over card category", () => {
    const definition = makeDefinition();
    const state = makeStackState(definition, {
      actionKind: "field_card_effect",
    });
    state.players[0]!.soulStateInstanceIds = ["stack-src"];
    expect(
      buildEffectQueue(
        state,
        () => definition,
        () => [],
        "alice"
      )[0]?.sourceStateLabel
    ).toBe("魂状態");
    state.cardInstances[0]!.zone = "trash";
    expect(
      buildEffectQueue(
        state,
        () => definition,
        () => [],
        "alice"
      )[0]?.sourceStateLabel
    ).toBe("トラッシュ");
  });
});

function makeBurstDefinition(): CardDefinition {
  return {
    cardNo: "BSGE01-M03",
    name: "雨宮 ツバキ",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [
      "【バースト：自分のライフ減少後】",
      "相手のスピリット1体のコアをリザーブに置く。",
      "【バースト：自分のスピリットのアタック後】",
      "相手のスピリット1体のコアすべてをリザーブに置く。",
    ],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: {
          kind: "burst",
          trigger: { kind: "life_decrease", player: "self" },
        },
        textRef: [0, 1],
        steps: [],
      },
      {
        timing: {
          kind: "burst",
          trigger: { kind: "own_attack", player: "self" },
        },
        textRef: [2, 3],
        steps: [],
      },
    ] as CardDefinition["effects"],
  };
}

function burstResolve(
  extra: Partial<Record<string, unknown>> = {}
): LegalAction {
  return {
    chainId: "test:effect-queue-overlay:216",
    kind: "resolve_pending_burst_check",
    actionId: String(extra.actionId ?? "burst-resolve"),
    can: true,
    reason: "",
    actingPlayerId: "alice",
    checkId: "bc-attack",
    eventKind: "own_attack",
    relatedPlayerId: "alice",
    sourceKind: "spirit",
    sourceInstanceId: "burst-src",
    sourceDefinitionId: "BSGE01-M03",
    sourceCardNo: "BSGE01-M03",
    registrationIndex: 1,
    targetMode: "none",
    requiredTargetCount: 0,
    targetEffectFilterTags: [],
    candidateTargetInstanceIds: [],
    availableChosenLifeCoreKinds: [],
    requiresChosenLifeCoreKind: false,
    playsSourceCardWithoutCostAfterResolve: false,
    usesSourceCardWithoutCostAfterResolve: false,
    playsTargetCardWithoutCostAfterResolve: false,
    usesTargetCardWithoutCostAfterResolve: false,
    enterFieldCorePlacementRule: "optional",
    minimumEnterFieldCoreCount: 0,
    maximumEnterFieldCoreCount: null,
    requiresEnterFieldCorePlacements: false,
    targetFollowUpMagicOptions: [],
    targetEnterFieldCorePlacementOptions: [],
    ...extra,
  } as unknown as LegalAction;
}

function burstDecline(): LegalAction {
  return {
    chainId: "test:effect-queue-overlay:251",
    kind: "decline_pending_burst_check",
    actionId: "burst-decline",
    can: true,
    reason: "",
    actingPlayerId: "alice",
    checkId: "bc-attack",
    eventKind: "own_attack",
    relatedPlayerId: "alice",
  } as unknown as LegalAction;
}

describe("EffectQueueOverlay stack source display", () => {
  it("uses effectSource for combined brave field-effect stack cards and text", () => {
    const hostDefinition: CardDefinition = {
      cardNo: "QUEUE-HOST",
      name: "Queue Host",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: ["ホスト側の起動効果テキスト。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          textRef: [0],
          steps: [],
        },
      ] as CardDefinition["effects"],
    };
    const braveDefinition: CardDefinition = {
      cardNo: "QUEUE-BRAVE",
      name: "Queue Brave",
      printedCategory: "brave",
      colors: ["white"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 2000 }],
      symbolColors: ["white"],
      image: "images/QUEUE-BRAVE.png",
      textLines: ["【合体中】フラッシュ：", "相手のスピリット1体を破壊する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          textRef: [0, 1],
          steps: [],
        },
      ] as CardDefinition["effects"],
    };
    const host = {
      ...createCardInstance(hostDefinition, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      attachedChildrenIds: ["brave-1"],
    };
    const brave = {
      ...createCardInstance(braveDefinition, {
        instanceId: "brave-1",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      attachedToInstanceId: "host-1",
    };
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, brave],
      }),
      step: "main",
      window: "stack",
      stackWindow: {
        actingPlayerId: "alice",
        previousWindow: "main",
        priorityPlayerId: "bob",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "alice",
        subStackEverOpened: false,
        burstWindowKind: null,
        pendingStackAction: {
          stackId: "stack-combined-brave",
          actionKind: "field_card_effect",
          chainId: "chain-combined-brave",
          actingPlayerId: "alice",
          cardInstanceId: "host-1",
          cardDefinitionId: hostDefinition.cardNo,
          effectSourceInstanceId: "brave-1",
          effectSourceDefinitionId: braveDefinition.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          chosenTiming: "flash",
          fieldEffectRegistrationIndex: 0,
          fieldEffectSourceKind: "combined_brave",
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
      },
    } as unknown as GameState;
    const getDefinition = (id: string) =>
      id === hostDefinition.cardNo
        ? hostDefinition
        : id === braveDefinition.cardNo
          ? braveDefinition
          : undefined;

    const items = buildEffectQueue(state, getDefinition, () => [], "alice");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "stack",
      definitionId: "QUEUE-BRAVE",
      cardName: "Queue Brave",
      sourceStateLabel: "ブレイヴ",
      imagePath: "/images/QUEUE-BRAVE.png",
      effectText: "【合体中】フラッシュ：\n相手のスピリット1体を破壊する。",
    });
    expect(items[0]?.effectText).not.toContain("ホスト側");
  });
});

describe("EffectQueueOverlay private declarations", () => {
  it("shows pendingPrivateDeclarations only to the owning viewer", () => {
    const definition = makeDefinition();
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "alice-hand",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
      pendingPrivateDeclarations: [
        {
          declarationId: "decl-alice",
          ownerPlayerId: "alice",
          actingPlayerId: "alice",
          sourceInstanceId: "alice-hand",
          sourceDefinitionId: definition.cardNo,
          sourceKind: "spirit",
          sourceZone: "hand",
          registrationIndex: 0,
          pendingId: "pending-alice",
          eventKind: "start_step",
          source: "step_transition",
          chainId: "test:effect-queue-overlay:394",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: null,
          step: "start",
          window: "none",
        },
      ],
    });
    const getDefinition = (id: string) =>
      id === definition.cardNo ? definition : undefined;
    const getRegisteredTriggeredEffectActions = () => [];

    const aliceItems = buildEffectQueue(
      state,
      getDefinition,
      getRegisteredTriggeredEffectActions,
      "alice"
    );
    const bobItems = buildEffectQueue(
      state,
      getDefinition,
      getRegisteredTriggeredEffectActions,
      "bob"
    );

    expect(aliceItems).toHaveLength(1);
    expect(aliceItems[0]).toMatchObject({
      kind: "private_declaration",
      cardName: "P3-28 Private Source",
      actingPlayerId: "alice",
    });
    expect(bobItems).toHaveLength(0);
  });

  it("pinpoints private declaration text via registration effectIndex", () => {
    const definition: CardDefinition = {
      cardNo: "PRIVATE-MULTI",
      name: "Private Multi",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["purple"],
      textLines: ["非公開効果A: 1枚引く。", "非公開効果B: 相手1体を破壊する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "phase", step: "start", subPhase: "start" },
          textRef: [0],
          steps: [],
        },
        {
          timing: { kind: "phase", step: "start", subPhase: "start" },
          textRef: [1],
          steps: [],
        },
      ] as CardDefinition["effects"],
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "alice-private-multi",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
      pendingPrivateDeclarations: [
        {
          declarationId: "decl-private-multi",
          ownerPlayerId: "alice",
          actingPlayerId: "alice",
          sourceInstanceId: "alice-private-multi",
          sourceDefinitionId: definition.cardNo,
          sourceKind: "spirit",
          sourceZone: "hand",
          registrationIndex: 1,
          pendingId: "pending-private-multi",
          eventKind: "start_step",
          source: "step_transition",
          chainId: "test:effect-queue-overlay:479",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: null,
          step: "start",
          window: "none",
        },
      ],
    });
    const items = buildEffectQueue(
      state,
      (id) => (id === definition.cardNo ? definition : undefined),
      buildTriggeredEffectLookup([definition]),
      "alice"
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.effectText).toBe("非公開効果B: 相手1体を破壊する。");
    expect(items[0]?.effectText).not.toContain("非公開効果A");
  });

  it("labels P3-29 triggered effect stack windows as pending effect declarations", () => {
    const definition = makeDefinition();
    const source = createCardInstance(definition, {
      instanceId: "alice-field",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source],
      }),
      step: "main" as const,
      window: "stack" as const,
      stackWindow: {
        actingPlayerId: "alice",
        previousWindow: "none" as const,
        priorityPlayerId: "bob",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "alice",
        subStackEverOpened: false,
        burstWindowKind: null,
        pendingStackAction: {
          stackId: "stack-triggered",
          actionKind: "triggered_effect" as const,
          chainId: "chain-triggered",
          actingPlayerId: "alice",
          cardInstanceId: source.instanceId,
          cardDefinitionId: definition.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          triggeredPendingSnapshot: {
            pendingId: "pending-triggered",
            eventKind: "start_step",
            actingPlayerId: "alice",
            source: "action_resolution",
            chainId: "test:effect-queue-overlay:545",
            attackId: null,
            relatedPlayerId: null,
            relatedInstanceId: source.instanceId,
            amount: null,
            step: "main",
            window: "none",
            resolvedSourceInstanceIds: [],
          },
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
      },
    };
    const getDefinition = (id: string) =>
      id === definition.cardNo ? definition : undefined;
    const items = buildEffectQueue(state, getDefinition, () => [], "alice");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "stack",
      cardName: "P3-28 Private Source",
      timingLabel: "誘発発揮・応答待ち",
    });
  });

  it("blanks effect text for summon stack windows (card-wide action)", () => {
    // 召喚はカード全体の動作で、スタックに乗るのは召喚宣言そのもの。
    // 「召喚時」効果は解決後に別の誘発キューカードとして出るため、召喚スタックの
    // 効果テキストは空欄にし、ラベル「召喚・応答待ち」のみで示す。
    // definitionId は画像/カード名と同じ def を指し、カード詳細モーダルの正源になる。
    const definition: CardDefinition = {
      cardNo: "SUMMON-STACK",
      name: "Summon Stack Spirit",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      // 召喚時ブロックを持たせ、それが抽出 *されない* (空欄) ことを検証する。
      textLines: ["『召喚時』カードを1枚引く。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const source = createCardInstance(definition, {
      instanceId: "alice-summon",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source],
      }),
      step: "main" as const,
      window: "stack" as const,
      stackWindow: {
        actingPlayerId: "alice",
        previousWindow: "none" as const,
        priorityPlayerId: "bob",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "alice",
        subStackEverOpened: false,
        burstWindowKind: null,
        pendingStackAction: {
          stackId: "stack-summon",
          actionKind: "summon" as const,
          chainId: "chain-summon",
          actingPlayerId: "alice",
          cardInstanceId: source.instanceId,
          cardDefinitionId: definition.cardNo,
          targetInstanceIds: [],
          targetEffectFilterTags: [],
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        },
      },
    };
    const getDefinition = (id: string) =>
      id === definition.cardNo ? definition : undefined;
    const items = buildEffectQueue(state, getDefinition, () => [], "alice");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "stack",
      cardName: "Summon Stack Spirit",
      timingLabel: "召喚・応答待ち",
      // 召喚スタックは効果テキスト空欄。「召喚時」ブロックを抜き出さない。
      effectText: "",
      // 詳細モーダル用 definitionId が設定されていること (Issue 1 回帰防止)。
      definitionId: "SUMMON-STACK",
    });
  });

  it("uses pte.event.step to disambiguate step-specific trigger text (P3-39)", () => {
    // 同じカードに「スタートステップ召喚 (手札)」と「アタックステップ開始時 (Lv2-Lv3)」
    // のような複数の step_timing trigger があると、pte.eventKind は両方 "start_step"
    // になる。event.step を見ずに TIMING_KEYWORDS["start_step"] = ["スタートステップ"]
    // だけで抽出すると、attack step の trigger でも「スタートステップ」のテキストを
    // 拾ってしまう。step="attack" のときは「アタックステップ」キーワードで抽出する。
    //
    // 注: source は applicability スキャンで解決される未解決 responder として表現する。
    // resolvedSourceInstanceIds は「解決済み responder = 表示除外」を意味するため、
    // 表示ソースの固定には使えない (resolution-items (a) は private 宣言専用)。
    const definition: CardDefinition = {
      cardNo: "P3-39-MULTI",
      name: "P3-39 Multi-Trigger",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 5000 },
        { level: 2, requiredCores: 2, bp: 7000 },
      ],
      symbolColors: ["purple"],
      textLines: [
        "手札にあるこのカードは『自分のスタートステップ』に召喚できる。",
        "",
        "Lv2『自分のアタックステップ開始時』",
        "自分のスピリットを回復する。",
      ],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      // textRef を持たせず、step keyword 抽出フォールバックを検証対象にする。
      effects: [
        {
          timing: { kind: "phase", step: "attack", subPhase: "start" },
          applicability: { level: { min: 1 } },
          executionMode: "optional",
          steps: [
            {
              action: {
                kind: "recover",
                target: {
                  kind: "filter",
                  player: "self",
                  filter: { category: ["spirit"] },
                  count: "all",
                },
              },
            },
          ],
        },
      ],
    };
    const source = createCardInstance(definition, {
      instanceId: "field-source",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 2,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source],
      pendingTriggeredEffects: [
        {
          pendingId: "pte-attack-start",
          actingPlayerId: "alice",
          eventKind: "start_step",
          event: {
            family: "step_timing",
            validationMode: "snapshot_only",
            step: "attack",
            subPhase: "start",
          },
          source: "step_transition",
          chainId: "test:effect-queue-overlay:711",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: null,
          step: "attack",
          window: "none",
          resolvedSourceInstanceIds: [],
        },
      ],
    });
    const getDefinition = (id: string) =>
      id === definition.cardNo ? definition : undefined;
    const triggeredLookup = buildTriggeredEffectLookup([definition]);

    const items = buildEffectQueue(
      state,
      getDefinition,
      triggeredLookup,
      "alice"
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("triggered");
    expect(items[0]?.effectText).toContain("アタックステップ開始時");
    expect(items[0]?.effectText).toContain("自分のスピリットを回復する。");
    // スタートステップ召喚の文面は混入させない
    expect(items[0]?.effectText).not.toContain("手札にある");
    expect(items[0]?.effectText).not.toContain("召喚できる");
  });

  it("labels the summon side of a summon/contract-combine printed trigger as 召喚時", () => {
    const definition: CardDefinition = {
      cardNo: "QUEUE-SUMMON-CONTRACT",
      name: "Queue Summon Contract",
      printedCategory: "brave",
      colors: ["red"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["red"],
      textLines: ["『このブレイヴの召喚/契約合体時』", "1枚引く。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          textRef: [0, 1],
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
    };
    const source = createCardInstance(definition, {
      instanceId: "queue-summon-contract-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const pending: PendingTriggeredEffect = {
      pendingId: "pte-summon-contract-summon",
      actingPlayerId: "alice",
      eventKind: "summon",
      event: { family: "enter_field", actionKind: "summon" },
      source: "action_resolution",
      chainId: "test:effect-queue-overlay:781",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: source.instanceId,
      amount: null,
      step: "main",
      window: "none",
      resolvedSourceInstanceIds: [],
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source],
      pendingTriggeredEffects: [pending],
    });
    const items = buildEffectQueue(
      state,
      (id) => (id === definition.cardNo ? definition : undefined),
      buildTriggeredEffectLookup([definition]),
      "alice"
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.timingLabel).toBe("召喚時");
  });

  it("labels the contract-combine side of a summon/contract-combine printed trigger as 契約合体時", () => {
    const definition: CardDefinition = {
      cardNo: "QUEUE-CONTRACT-COMBINE",
      name: "Queue Contract Combine",
      printedCategory: "brave",
      colors: ["red"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["red"],
      textLines: ["『このブレイヴの召喚/契約合体時』", "1枚引く。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "summon" },
          textRef: [0, 1],
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
    };
    const source = createCardInstance(definition, {
      instanceId: "queue-contract-combine-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
      attachedToInstanceId: "host-1",
    });
    const pending: PendingTriggeredEffect = {
      pendingId: "pte-summon-contract-contract",
      actingPlayerId: "alice",
      eventKind: "brave_combined",
      event: { family: "brave_link", cause: "contract_combine" },
      source: "action_resolution",
      chainId: "test:effect-queue-overlay:841",
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: source.instanceId,
      triggerRelatedCombinedHostInstanceId: "host-1",
      amount: null,
      step: "main",
      window: "none",
      resolvedSourceInstanceIds: [],
      cause: "contract_combine",
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source],
      pendingTriggeredEffects: [pending],
    });
    const items = buildEffectQueue(
      state,
      (id) => (id === definition.cardNo ? definition : undefined),
      buildTriggeredEffectLookup([definition]),
      "alice"
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.timingLabel).toBe("契約合体時");
  });

  it("pinpoints granted-effect queue text from active CE metadata instead of host full text", () => {
    const hostDefinition: CardDefinition = {
      cardNo: "QUEUE-GRANTEE",
      name: "Queue Grantee",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["red"],
      textLines: [
        "ホスト常時テキスト。",
        "ホスト側の別効果全文が混ざってはいけない。",
      ],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const grantedSourceDefinition: CardDefinition = {
      cardNo: "QUEUE-GRANTED-SOURCE",
      name: "Queue Granted Source",
      printedCategory: "spirit",
      colors: ["yellow"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["yellow"],
      textLines: [
        "付与元の常時テキスト。",
        "『このスピリットのアタック時』",
        "相手のライフのコア1個をリザーブに置く。",
        "付与元の別効果全文も混ざってはいけない。",
      ],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          textRef: [1, 2],
          steps: [],
        },
      ] as CardDefinition["effects"],
    };
    const grantee = createCardInstance(hostDefinition, {
      instanceId: "grantee-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const grantedSource = createCardInstance(grantedSourceDefinition, {
      instanceId: "grant-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const grantCe: ContinuousEffect = {
      effectId: "ce-granted-attack",
      sourceInstanceId: grantedSource.instanceId,
      sourceDefinitionId: grantedSourceDefinition.cardNo,
      actingPlayerId: "alice",
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "granted_effect",
      targetInstanceId: grantee.instanceId,
      metadata: {
        grantedEffect: grantedSourceDefinition.effects![0],
        grantPlayerRef: "self",
      },
    };
    const baseState: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [grantee, grantedSource],
      }),
      step: "attack",
    };
    const state: GameState = {
      ...baseState,
      activeContinuousEffects: [grantCe],
      pendingTriggeredEffects: [
        createMechanicPendingTriggeredEffect({
          chainId: "test:effect-queue-overlay:957",
          state: baseState,
          pendingId: "pte-granted-attack",
          actingPlayerId: "alice",
          relatedInstanceId: grantee.instanceId,
          mechanic: {
            kind: "granted_effect",
            grantCeEffectId: grantCe.effectId,
            granteeInstanceId: grantee.instanceId,
          },
        }),
      ],
    };
    const getDefinition = (id: string) =>
      id === hostDefinition.cardNo
        ? hostDefinition
        : id === grantedSourceDefinition.cardNo
          ? grantedSourceDefinition
          : undefined;

    const items = buildEffectQueue(state, getDefinition, () => [], "alice");

    expect(items).toHaveLength(1);
    expect(items[0]?.definitionId).toBe(hostDefinition.cardNo);
    expect(items[0]?.effectText).toBe(
      "『このスピリットのアタック時』\n相手のライフのコア1個をリザーブに置く。"
    );
    expect(items[0]?.effectText).not.toContain("ホスト側の別効果全文");
    expect(items[0]?.effectText).not.toContain("付与元の別効果全文");
    expect(
      getGrantedEffectsForCard(state, grantee, hostDefinition, getDefinition)[0]
        ?.text
    ).toBe(items[0]?.effectText);

    const { textRef: _textRef, ...effectWithoutTextRef } =
      grantedSourceDefinition.effects![0]!;
    void _textRef;
    const grantCeWithoutTextRef: ContinuousEffect = {
      ...grantCe,
      effectId: "ce-granted-no-text-ref",
      metadata: {
        grantedEffect: effectWithoutTextRef,
        grantPlayerRef: "self",
      },
    };
    const noTextRefState: GameState = {
      ...baseState,
      activeContinuousEffects: [grantCeWithoutTextRef],
      pendingTriggeredEffects: [
        createMechanicPendingTriggeredEffect({
          chainId: "test:effect-queue-overlay:1006",
          state: baseState,
          pendingId: "pte-granted-no-text-ref",
          actingPlayerId: "alice",
          relatedInstanceId: grantee.instanceId,
          mechanic: {
            kind: "granted_effect",
            grantCeEffectId: grantCeWithoutTextRef.effectId,
            granteeInstanceId: grantee.instanceId,
          },
        }),
      ],
    };
    const noTextRefItems = buildEffectQueue(
      noTextRefState,
      getDefinition,
      () => [],
      "alice"
    );
    expect(noTextRefItems[0]?.effectText).toBe("");
    expect(noTextRefItems[0]?.effectText).not.toContain("ホスト側の別効果全文");
  });

  it("shows text-role under-card provided continuous effects in current card detail display", () => {
    const hostDefinition: CardDefinition = {
      cardNo: "DETAIL-HOST",
      name: "Detail Host",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: ["ホスト本文。", "ホスト全文にfallbackしてはいけない。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const underDefinition: CardDefinition = {
      cardNo: "DETAIL-UNDER-R04",
      name: "Detail Under R04",
      printedCategory: "spirit",
      colors: ["purple"],
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["purple"],
      textLines: [
        "下カードの別効果。",
        "【呪縛：モルター】（自分の【バレットエディット】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
        "このスピリットが効果を発揮するとき、自分のカウント-1することで、その効果は相手の効果で防げない。",
      ],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
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
          textRef: [1, 2],
        },
      ] as CardDefinition["effects"],
    };
    const host = {
      ...createCardInstance(hostDefinition, {
        instanceId: "detail-host-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      underCards: [
        {
          role: "text_role" as const,
          roleTag: "バレットエディット",
          cardInstanceId: "detail-under-1",
        },
      ],
    };
    const under = {
      ...createCardInstance(underDefinition, {
        instanceId: "detail-under-1",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      attachedToInstanceId: host.instanceId,
      zoneRoleName: "bullet-edit",
    };
    const providedCe: ContinuousEffect = {
      effectId: "ce-under-paid-prevention",
      sourceInstanceId: host.instanceId,
      sourceDefinitionId: hostDefinition.cardNo,
      actingPlayerId: "alice",
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "paid_prevention_immunity_offer",
      targetInstanceId: host.instanceId,
      metadata: { cost: { resource: "count", amount: 1 } },
      provenance: {
        effectIndex: 0,
        stepIndex: 0,
        effectSourceInstanceId: under.instanceId,
        effectSourceDefinitionId: underDefinition.cardNo,
      },
    };
    const duplicateProvidedCe: ContinuousEffect = {
      ...providedCe,
      effectId: "ce-under-paid-prevention-duplicate-step",
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [host, under],
      }),
      activeContinuousEffects: [providedCe, duplicateProvidedCe],
    };
    const getDefinition = (id: string) =>
      id === hostDefinition.cardNo
        ? hostDefinition
        : id === underDefinition.cardNo
          ? underDefinition
          : undefined;

    const displays = getCurrentEffectDisplaysForCard(
      state,
      host,
      hostDefinition,
      getDefinition
    );

    expect(displays).toHaveLength(1);
    expect(displays[0]?.sourceDefinition?.cardNo).toBe(underDefinition.cardNo);
    expect(displays[0]?.text).toBe(
      "【呪縛：モルター】（自分の【バレットエディット】でスピリットの下にあるこのカードは以下の効果を発揮する。）\nこのスピリットが効果を発揮するとき、自分のカウント-1することで、その効果は相手の効果で防げない。"
    );
    expect(displays[0]?.text).not.toContain("ホスト全文");
    expect(displays[0]?.text).not.toContain("下カードの別効果");
  });

  it("pinpoints battle immediate text via registration effectIndex", () => {
    const definition: CardDefinition = {
      cardNo: "BATTLE-MULTI",
      name: "Battle Multi",
      printedCategory: "spirit",
      colors: ["green"],
      cost: 4,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      symbolColors: ["green"],
      textLines: [
        "アタック効果A: 1枚引く。",
        "アタック効果B: 相手1体を疲労させる。",
      ],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          textRef: [0],
          steps: [],
        },
        {
          timing: { kind: "card_event", event: "attack" },
          textRef: [1],
          steps: [],
        },
      ] as CardDefinition["effects"],
    };
    const source = createCardInstance(definition, {
      instanceId: "battle-multi-src",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source],
      }),
      battleImmediateEffects: [
        {
          promptId: "bie-battle-multi",
          attackId: "attack-1",
          timing: "attack" as const,
          sourceKind: "spirit" as const,
          sourceInstanceId: source.instanceId,
          sourceDefinitionId: definition.cardNo,
          sourceCardNo: definition.cardNo,
          actingPlayerId: "alice",
          participantEntityId: "battle-entity:battle-multi-src",
          registrationIndex: 1,
        },
      ],
    } as GameState;

    const items = buildEffectQueue(
      state,
      (id) => (id === definition.cardNo ? definition : undefined),
      () => [],
      "alice"
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("battle_immediate");
    expect(items[0]?.effectText).toBe("アタック効果B: 相手1体を疲労させる。");
    expect(items[0]?.effectText).not.toContain("アタック効果A");
  });

  it("includes battle flash pending stack actions in the queue", () => {
    const definition = makeDefinition();
    const source = createCardInstance(definition, {
      instanceId: "alice-attacker",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [source],
      }),
      step: "attack" as const,
      window: "stack_before_block" as const,
      battleEntities: [
        {
          entityId: "battle-entity:alice-attacker",
          memberInstanceIds: [source.instanceId],
          resolvedBp: 1000,
          resolvedSymbols: ["red" as const],
          attackState: "attacking" as const,
        },
      ],
      activeAttack: {
        attackId: "attack:test",
        primaryEntityId: "battle-entity:alice-attacker",
        participantEntityIds: ["battle-entity:alice-attacker"],
        groupMode: "single" as const,
        target: { kind: "player" as const, playerId: "bob" },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:alice-attacker",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-entity:alice-attacker"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block" as const,
          priorityPlayerId: "bob",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: "alice",
          pendingStackAction: {
            stackId: "stack-battle-immediate",
            actionKind: "battle_immediate_effect" as const,
            chainId: "chain-battle-immediate",
            actingPlayerId: "alice",
            cardInstanceId: source.instanceId,
            cardDefinitionId: definition.cardNo,
            targetInstanceIds: [],
            targetEffectFilterTags: [],
            battleImmediatePromptSnapshot: {
              promptId: "prompt-battle-immediate",
              attackId: "attack:test",
              timing: "attack" as const,
              sourceKind: "spirit" as const,
              sourceInstanceId: source.instanceId,
              sourceDefinitionId: definition.cardNo,
              sourceCardNo: definition.cardNo,
              actingPlayerId: "alice",
              participantEntityId: "battle-entity:alice-attacker",
              registrationIndex: 0,
            },
            previousResponseSourcePlayerId: null,
            previousPendingStackAction: null,
          },
        },
      },
    };
    const getDefinition = (id: string) =>
      id === definition.cardNo ? definition : undefined;
    const items = buildEffectQueue(state, getDefinition, () => [], "alice");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "stack_battle_flash",
      cardName: "P3-28 Private Source",
      timingLabel: "即時発揮・応答待ち",
    });
  });

  it("localizes previously-English trigger event kinds to Japanese labels", () => {
    // 旧 triggerEventLabel は default で raw eventKind を返し、advent/battle_end など
    // 実装済み機構が英字ラベルのまま表示されていた。Record 網羅化で日本語になることを検証。
    const definition = makeDefinition();
    const base = {
      ownerPlayerId: "alice",
      actingPlayerId: "alice",
      sourceInstanceId: "alice-hand",
      sourceDefinitionId: definition.cardNo,
      sourceKind: "spirit" as const,
      sourceZone: "hand" as const,
      registrationIndex: 0,
      source: "step_transition" as const,
      chainId: null,
      attackId: null,
      relatedPlayerId: "alice",
      relatedInstanceId: null,
      amount: null,
      step: "main" as const,
      window: "none" as const,
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "alice-hand",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
      pendingPrivateDeclarations: [
        {
          ...base,
          declarationId: "d-advent",
          pendingId: "p-advent",
          eventKind: "advent",
        },
        {
          ...base,
          declarationId: "d-battle-end",
          pendingId: "p-battle-end",
          eventKind: "battle_end",
        },
      ],
    });
    const getDefinition = (id: string) =>
      id === definition.cardNo ? definition : undefined;
    const items = buildEffectQueue(state, getDefinition, () => [], "alice");

    const labels = items.map((i) => i.timingLabel);
    expect(labels).toContain("煌臨時");
    expect(labels).toContain("バトル終了時");
    // 英字 eventKind が素通しで残っていないこと
    expect(labels).not.toContain("advent");
    expect(labels).not.toContain("battle_end");
  });

  it("pinpoints hand_card_effect stack text via handActivatedEffectIndex", () => {
    // 複数起動効果カードで、解決対象 (index 1) の textRef だけを表示する。
    const definition: CardDefinition = {
      cardNo: "HAND-MULTI",
      name: "Hand Multi Effect",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: ["起動効果Aを発揮する。", "起動効果Bを発揮する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "phase", step: "main", subPhase: "start" },
          textRef: [0],
          steps: [],
        },
        {
          timing: { kind: "phase", step: "main", subPhase: "start" },
          textRef: [1],
          steps: [],
        },
      ] as CardDefinition["effects"],
    };
    const state = makeStackState(definition, {
      actionKind: "hand_card_effect",
      handActivatedEffectIndex: 1,
    });
    const items = buildEffectQueue(
      state,
      (id) => (id === definition.cardNo ? definition : undefined),
      () => [],
      "alice"
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.timingLabel).toBe("起動効果・応答待ち");
    expect(items[0]?.effectText).toBe("起動効果Bを発揮する。");
  });

  it("labels burst activation declaration stacks separately from burst effect declarations", () => {
    const definition = makeDefinition();
    const activationState = makeStackState(
      definition,
      {
        actionKind: "burst_activation",
        burstCheckId: "burst-activation-1",
      },
      "activation"
    );
    const effectDeclarationState = makeStackState(
      definition,
      {
        actionKind: "burst_activation",
        burstCheckId: "burst-effect-decl-1",
      },
      "effect_declaration"
    );

    const getDefinition = (id: string) =>
      id === definition.cardNo ? definition : undefined;
    const activationItems = buildEffectQueue(
      activationState,
      getDefinition,
      () => [],
      "alice"
    );
    const effectDeclarationItems = buildEffectQueue(
      effectDeclarationState,
      getDefinition,
      () => [],
      "alice"
    );

    expect(activationItems[0]?.timingLabel).toBe("バースト発動宣言・応答待ち");
    expect(effectDeclarationItems[0]?.timingLabel).toBe(
      "バースト効果発揮宣言・応答待ち"
    );
  });

  it("extracts only the burst block for burst_activation stacks (not whole card)", () => {
    const definition: CardDefinition = {
      cardNo: "BURST-STACK",
      name: "Burst Stack",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 4,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      symbolColors: ["red"],
      textLines: [
        "Lv1 このスピリットのBPを上げる常時効果",
        "",
        "【バースト：相手のスピリットのアタック後】",
        "相手スピリット1体を破壊する。",
      ],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const state = makeStackState(
      definition,
      {
        actionKind: "burst_activation",
        burstCheckId: "burst-1",
      },
      "activation"
    );
    const items = buildEffectQueue(
      state,
      (id) => (id === definition.cardNo ? definition : undefined),
      () => [],
      "alice"
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.timingLabel).toBe("バースト発動宣言・応答待ち");
    expect(items[0]?.effectText).toContain("相手スピリット1体を破壊する。");
    // 無関係な常時効果テキストを巻き込まない (旧: カード全文フォールバック)
    expect(items[0]?.effectText).not.toContain("常時効果");
  });

  it("extracts the mirage set text for set_mirage stacks (not whole card)", () => {
    const definition: CardDefinition = {
      cardNo: "MIRAGE-STACK",
      name: "Mirage Stack",
      printedCategory: "magic",
      colors: ["purple"],
      cost: 4,
      reductionSymbols: ["purple"],
      levelDefs: [],
      symbolColors: [],
      textLines: [
        "【ミラージュ：コスト2<紫>（このカードは手札からセットできる）】",
        "",
        "【セット中】『自分のメインステップ』",
        "相手の手札2枚の内容を見れる。",
        "",
        "【セット中】",
        "お互い、ボイドからコアをライフに置けない。",
        "",
        "メイン",
        "自分はデッキの上から3枚ドローする。",
      ],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const state = makeStackState(definition, {
      actionKind: "set_mirage",
    });
    const items = buildEffectQueue(
      state,
      (id) => (id === definition.cardNo ? definition : undefined),
      () => [],
      "alice"
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.timingLabel).toBe("ミラージュセット・応答待ち");
    expect(items[0]?.effectText).toBe(
      [
        "【ミラージュ：コスト2<紫>（このカードは手札からセットできる）】",
        "【セット中】『自分のメインステップ』",
        "相手の手札2枚の内容を見れる。",
        "【セット中】",
        "お互い、ボイドからコアをライフに置けない。",
      ].join("\n")
    );
    expect(items[0]?.effectText).not.toContain("デッキの上から3枚");
  });

  it("extracts only the quartz mechanic block for set_quartz stacks (not whole card)", () => {
    const definition: CardDefinition = {
      cardNo: "QUARTZ-STACK",
      name: "Quartz Stack",
      printedCategory: "spirit",
      colors: ["white"],
      cost: 3,
      reductionSymbols: ["white"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["white"],
      textLines: [
        "Lv1-Lv2『このスピリットの召喚時』",
        "自分はデッキの上から1枚ドローできる。",
        "",
        "【クォーツ：機功｜コストC2｜属性値：<地>3　<水>2　<時>1（手札から対象にセットできる）】",
        "自分のエンドステップ、自分の魂状態の「ENIGMA」の【クォーツ】の属性値の<地>の合計が10以上のとき、ボイドからコア2個を自分のリザーブに置ける。",
      ],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const state = makeStackState(definition, {
      actionKind: "set_quartz",
    });
    const items = buildEffectQueue(
      state,
      (id) => (id === definition.cardNo ? definition : undefined),
      () => [],
      "alice"
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.timingLabel).toBe("クォーツセット・応答待ち");
    expect(items[0]?.effectText).toContain("【クォーツ：機功");
    expect(items[0]?.effectText).toContain("ボイドからコア2個");
    expect(items[0]?.effectText).not.toContain("召喚時");
    expect(items[0]?.effectText).not.toContain("1枚ドロー");
  });

  it("extracts the printed mechanic block for mechanic-driven (placement_oracle) triggered items", () => {
    // 神託/解封/転醒 (P3-92 mechanic) は創界神/創界石に印字された機構ブロックを持つ。
    // カード全文ではなく【神託：…】ブロックだけを抽出し、無関係な常時/神技本文は除く。
    const definition: CardDefinition = {
      cardNo: "GRANDWALKER-ORACLE",
      name: "創界神テスト",
      printedCategory: "nexus",
      colors: ["yellow"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["yellow"],
      textLines: [
        "このネクサスは創界神ネクサス対象の効果しか受けない。",
        "",
        "【神託：〔テスト〕】",
        "◆対象を召喚したとき、ボイドからコア1個を置ける。",
        "◆このネクサスを配置したとき、デッキの上から3枚をトラッシュに置ける。",
        "",
        "【神技：2】Lv1『自分のメインステップ』",
        "別の神技効果テキスト。",
      ],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const source = createCardInstance(definition, {
      instanceId: "alice-grandwalker",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source],
      pendingTriggeredEffects: [
        {
          pendingId: "pte-oracle",
          actingPlayerId: "alice",
          eventKind: "placement_oracle",
          source: "action_resolution",
          chainId: "test:effect-queue-overlay:1616",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "alice-grandwalker",
          amount: null,
          step: "main",
          window: "none",
          resolvedSourceInstanceIds: [],
          mechanic: {
            kind: "placement_oracle",
            grandwalkerInstanceId: "alice-grandwalker",
          },
        },
      ],
    });
    const items = buildEffectQueue(
      state,
      (id) => (id === definition.cardNo ? definition : undefined),
      () => [],
      "alice"
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("triggered");
    expect(items[0]?.timingLabel).toBe("配置時神託");
    // 印字された【神託：…】ブロックが抽出される
    expect(items[0]?.effectText).toContain("【神託：〔テスト〕】");
    expect(items[0]?.effectText).toContain("このネクサスを配置したとき");
    // 無関係な常時/神技本文は混入しない (旧: カード全文フォールバック)
    expect(items[0]?.effectText).not.toContain("創界神ネクサス対象の効果しか");
    expect(items[0]?.effectText).not.toContain("別の神技効果");
  });

  it("extracts the 導託 block for 導界者 mechanic items (神↔導 同義)", () => {
    // 導界者ネクサスは神託でなく【導託：…】で印字される。oracle 機構として同じく抽出する。
    const definition: CardDefinition = {
      cardNo: "GUIDE-ORACLE",
      name: "導界者テスト",
      printedCategory: "nexus",
      colors: ["purple"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["god"],
      textLines: [
        "このネクサスは導界者ネクサス対象の効果しか受けない。また、導託・導技は神託・神技としても扱う。",
        "",
        "【導託：〔幻想＆コスト3以上〕〕】",
        "◆対象を召喚したとき、ボイドからコア1個を置ける。",
        "",
        "【導技：2】Lv1『自分のメインステップ』",
        "別の導技効果テキスト。",
      ],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const source = createCardInstance(definition, {
      instanceId: "alice-guide",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source],
      pendingTriggeredEffects: [
        {
          pendingId: "pte-doutaku",
          actingPlayerId: "alice",
          eventKind: "oracle",
          source: "action_resolution",
          chainId: "test:effect-queue-overlay:1688",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "alice-guide",
          amount: null,
          step: "main",
          window: "none",
          resolvedSourceInstanceIds: [],
          mechanic: {
            chainId: "test:effect-queue-overlay:1701",
            kind: "oracle",
            grandwalkerInstanceId: "alice-guide",
            triggerCardInstanceId: "alice-guide",
            triggerKind: "summon",
          },
        },
      ],
    });
    const items = buildEffectQueue(
      state,
      (id) => (id === definition.cardNo ? definition : undefined),
      () => [],
      "alice"
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.timingLabel).toBe("神託コア+1");
    expect(items[0]?.effectText).toContain("【導託：");
    expect(items[0]?.effectText).toContain("対象を召喚したとき");
    // 本文中の「導託・導技は神託…」参照行や別の導技ブロックを誤抽出しない
    expect(items[0]?.effectText).not.toContain("導界者ネクサス対象の効果しか");
    expect(items[0]?.effectText).not.toContain("別の導技効果");
  });

  it("pinpoints stack triggered_effect text via registration effectIndex", () => {
    // スタック化された誘発効果も registration→effectIndex→textRef で解決し、
    // 見出し無し game_event でカード全文を拾わない。
    const definition: CardDefinition = {
      cardNo: "STACK-TRIGGERED",
      name: "Stack Triggered",
      printedCategory: "spirit",
      colors: ["green"],
      cost: 4,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      symbolColors: ["green"],
      textLines: ["効果A: 1枚引く。", "効果B: 相手1体を破壊する。"],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "game_event", event: "summon", who: "opponent" },
          textRef: [0],
          steps: [],
        },
        {
          timing: { kind: "game_event", event: "summon", who: "opponent" },
          textRef: [1],
          steps: [],
        },
      ] as CardDefinition["effects"],
    };
    const lookup = (() => [
      { effectIndex: 0 },
      { effectIndex: 1 },
    ]) as unknown as Parameters<typeof buildEffectQueue>[2];
    const state = makeStackState(definition, {
      actionKind: "triggered_effect",
      triggeredSourceCardNo: definition.cardNo,
      triggeredRegistrationIndex: 1,
      triggeredPendingSnapshot: {
        pendingId: "pte-stack",
        eventKind: "summon",
        actingPlayerId: "alice",
        source: "action_resolution",
        chainId: "test:effect-queue-overlay:1762",
        attackId: null,
        relatedPlayerId: null,
        relatedInstanceId: "stack-src",
        amount: null,
        step: "main",
        window: "none",
        resolvedSourceInstanceIds: [],
      },
    });
    const items = buildEffectQueue(
      state,
      (id) => (id === definition.cardNo ? definition : undefined),
      lookup,
      "alice"
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.effectText).toBe("効果B: 相手1体を破壊する。");
    expect(items[0]?.effectText).not.toContain("効果A");
  });

  it("pinpoints magic stack text via chosenTiming-matched effect textRef", () => {
    // フラッシュ/メイン両持ちマジックで、選んだ chosenTiming の効果テキストだけを表示する。
    const definition: CardDefinition = {
      cardNo: "MAGIC-MULTI",
      name: "Magic Multi",
      printedCategory: "magic",
      colors: ["blue"],
      cost: 3,
      reductionSymbols: [],
      levelDefs: [],
      symbolColors: [],
      textLines: [
        "フラッシュ効果: 1枚引く。",
        "メイン効果: 相手のコアを奪う。",
      ],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          textRef: [0],
          steps: [],
        },
        {
          timing: { kind: "activated", mode: "main" },
          textRef: [1],
          steps: [],
        },
      ] as CardDefinition["effects"],
    };
    const state = makeStackState(definition, {
      actionKind: "magic",
      chosenTiming: "main",
    });
    const items = buildEffectQueue(
      state,
      (id) => (id === definition.cardNo ? definition : undefined),
      () => [],
      "alice"
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.effectText).toBe("メイン効果: 相手のコアを奪う。");
    expect(items[0]?.effectText).not.toContain("フラッシュ効果");
  });

  it("extracts the 真・神託 block (god-family prefix generalization)", () => {
    // 真・神託/真・導託 は未収録だが実在キーワード。接頭 (真・) を問わず末尾 託 で
    // ヘッダー認識し、keyword "神託" の部分一致で抽出できることを確認 (将来カード追従)。
    const definition: CardDefinition = {
      cardNo: "TRUE-ORACLE",
      name: "真創界神テスト",
      printedCategory: "nexus",
      colors: ["yellow"],
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["god"],
      textLines: [
        "このネクサスは創界神ネクサス対象の効果しか受けない。",
        "",
        "【真・神託：〔テスト〕】",
        "◆対象を召喚したとき、ボイドからコア2個を置ける。",
      ],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const source = createCardInstance(definition, {
      instanceId: "alice-true-grandwalker",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source],
      pendingTriggeredEffects: [
        {
          pendingId: "pte-true-oracle",
          actingPlayerId: "alice",
          eventKind: "oracle",
          source: "action_resolution",
          chainId: "test:effect-queue-overlay:1867",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "alice-true-grandwalker",
          amount: null,
          step: "main",
          window: "none",
          resolvedSourceInstanceIds: [],
          mechanic: {
            chainId: "test:effect-queue-overlay:1880",
            kind: "oracle",
            grandwalkerInstanceId: "alice-true-grandwalker",
            triggerCardInstanceId: "alice-true-grandwalker",
            triggerKind: "summon",
          },
        },
      ],
    });
    const items = buildEffectQueue(
      state,
      (id) => (id === definition.cardNo ? definition : undefined),
      () => [],
      "alice"
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.effectText).toContain("【真・神託：〔テスト〕】");
    expect(items[0]?.effectText).toContain("コア2個を置ける");
    expect(items[0]?.effectText).not.toContain("創界神ネクサス対象の効果しか");
  });

  it("extracts 契約技 divine_skill stacks (契約者)", () => {
    const definition: CardDefinition = {
      cardNo: "CONTRACT-DIVINE",
      name: "契約者テスト",
      printedCategory: "nexus",
      colors: ["yellow"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
      symbolColors: ["god"],
      textLines: [
        "Lv1 配置時の常時テキスト",
        "",
        "【契約技：3】Lv1-Lv2 フラッシュ",
        "デッキの上から2枚をトラッシュに置く。",
      ],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const state = makeStackState(definition, {
      actionKind: "divine_skill",
    });
    const items = buildEffectQueue(
      state,
      (id) => (id === definition.cardNo ? definition : undefined),
      () => [],
      "alice"
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.timingLabel).toBe("神技・応答待ち");
    expect(items[0]?.effectText).toContain("デッキの上から2枚をトラッシュ");
    expect(items[0]?.effectText).not.toContain("常時テキスト");
  });

  it("labels and extracts divine_skill stacks (神技)", () => {
    const definition: CardDefinition = {
      cardNo: "DIVINE-STACK",
      name: "Divine Stack",
      printedCategory: "nexus",
      colors: ["white"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
      symbolColors: ["white"],
      textLines: [
        "Lv1 配置時の常時テキスト",
        "",
        "【神技：3】Lv2 フラッシュ",
        "デッキを3枚オープンする。",
      ],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const state = makeStackState(definition, {
      actionKind: "divine_skill",
    });
    const items = buildEffectQueue(
      state,
      (id) => (id === definition.cardNo ? definition : undefined),
      () => [],
      "alice"
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.timingLabel).toBe("神技・応答待ち");
    expect(items[0]?.effectText).toContain("デッキを3枚オープンする。");
    expect(items[0]?.effectText).not.toContain("常時テキスト");
  });
});

describe("EffectQueueOverlay burst checks", () => {
  const causes: Record<BurstEventKind, string> = {
    reduce_life: "ライフ－2",
    attack_after: "アタック",
    summon: "召喚",
    place: "配置",
    leave_field: "フィールド離脱",
    exhaust: "疲労",
    effect_activated: "効果発揮",
    hand_increase: "手札＋2枚",
    step_timing: "メインステップ開始",
    own_attack: "アタック",
    enter_soul_state: "魂状態化",
  };
  function pendingCause(eventKind: BurstEventKind): PendingBurstCheck {
    return {
      checkId: "bc-attack",
      actingPlayerId: "alice",
      eventKind,
      source: "action_resolution",
      chainId: "test:effect-queue-overlay:1989",
      attackId: null,
      relatedPlayerId: "bob",
      relatedInstanceId: null,
      amount: 2,
      step: "main",
      window: "none",
      resolvedBurstCardInstanceIds: [],
    };
  }
  it.each(Object.entries(causes) as [BurstEventKind, string][])(
    "%s の原因を候補・発動宣言・効果発揮宣言の全段階で表示する（旧snapshotも対応）",
    (kind, cause) => {
      const definition = makeBurstDefinition();
      const pending = pendingCause(kind);
      const getDefinition = (id: string) =>
        id === definition.cardNo ? definition : undefined;
      const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
      state.pendingBurstChecks = [pending];
      expect(
        buildEffectQueue(state, getDefinition, () => [], "alice", [
          burstResolve(),
        ])[0]?.timingLabel
      ).toBe(`バースト発動：相手の${cause}`);
      for (const window of ["activation", "effect_declaration"] as const) {
        const active = makeStackState(
          definition,
          {
            actionKind: "burst_activation",
            burstCheckId: pending.checkId,
            burstPendingSnapshot: pending,
          },
          window
        );
        const prefix =
          window === "activation" ? "バースト発動宣言" : "バースト効果発揮宣言";
        expect(
          buildEffectQueue(active, getDefinition, () => [], "alice")[0]
            ?.timingLabel
        ).toBe(`${prefix}：相手の${cause}・応答待ち`);
      }
    }
  );
  it.each([
    ["leave_field", { family: "leave_field", causeKind: "destroy" }, "破壊"],
    ["leave_field", { family: "leave_field", causeKind: "vanish" }, "消滅"],
    [
      "effect_activated",
      { family: "effect_activation", actionKind: "summon" },
      "召喚時効果発揮",
    ],
    [
      "effect_activated",
      { family: "effect_activation", actionKind: "placement" },
      "配置時効果発揮",
    ],
    [
      "effect_activated",
      { family: "effect_activation", actionKind: "magic_use" },
      "マジック使用時効果発揮",
    ],
    [
      "step_timing",
      { family: "step_timing", step: "attack", subPhase: "end" },
      "アタックステップ終了",
    ],
  ] as const)("%s の詳細条件を保持する: %s", (kind, event, cause) => {
    const definition = makeBurstDefinition();
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    state.pendingBurstChecks = [
      {
        ...pendingCause(kind),
        event: { ...event, validationMode: "snapshot_only" },
      },
    ];
    expect(
      buildEffectQueue(
        state,
        (id) => (id === definition.cardNo ? definition : undefined),
        () => [],
        "alice",
        [burstResolve()]
      )[0]?.timingLabel
    ).toBe(`バースト発動：相手の${cause}`);
  });
  it("公開された自己回収の原因名を維持し、非公開カードの名前を補完しない", () => {
    const definition = makeBurstDefinition();
    const source = { ...makeDefinition(), name: "自己回収カード" };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(source, {
          instanceId: "hidden",
          ownerPlayerId: "bob",
          zone: "hand",
          faceDown: true,
        }),
      ],
    });
    const getDefinition = (id: string) =>
      [source, definition].find((d) => d.cardNo === id);
    const pending = {
      ...pendingCause("hand_increase"),
      relatedInstanceId: "hidden",
    };
    state.pendingBurstChecks = [pending];
    expect(
      buildEffectQueue(state, getDefinition, () => [], "alice", [
        burstResolve(),
      ])[0]?.timingLabel
    ).toBe("バースト発動：相手の手札＋2枚");
    state.pendingBurstChecks = [
      {
        ...pending,
        event: {
          family: "hand_increase",
          validationMode: "snapshot_only",
          effectSourceInstanceId: "hidden",
          effectSourceDefinitionId: source.cardNo,
        },
      },
    ];
    expect(
      buildEffectQueue(state, getDefinition, () => [], "alice", [
        burstResolve(),
      ])[0]?.timingLabel
    ).toBe("バースト発動：相手の手札＋2枚（自己回収カード）");
  });

  it("shows one burst_check queue item for one pending burst source with multiple choice variants", () => {
    const definition = makeBurstDefinition();
    const burstCard = createCardInstance(definition, {
      instanceId: "burst-src",
      ownerPlayerId: "alice",
      zone: "burst",
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [burstCard],
      }),
      setBurstStates: [
        { playerId: "alice", cardInstanceId: burstCard.instanceId },
      ],
      pendingBurstChecks: [
        {
          checkId: "bc-attack",
          actingPlayerId: "alice",
          eventKind: "own_attack",
          event: {
            family: "action_declared",
            actionKind: "attack",
            validationMode: "require_related_instance_on_field",
          },
          source: "action_resolution",
          chainId: "test:effect-queue-overlay:2139",
          attackId: "attack-1",
          relatedPlayerId: "alice",
          relatedInstanceId: "attacker-1",
          amount: 0,
          step: "attack",
          window: "none",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    } as unknown as GameState;
    const actions = [
      burstResolve({ actionId: "burst-resolve:0", choiceIndex: 0 }),
      burstResolve({ actionId: "burst-resolve:1", choiceIndex: 1 }),
      burstDecline(),
    ];

    const items = buildEffectQueue(
      state,
      (id) => (id === definition.cardNo ? definition : undefined),
      buildTriggeredEffectLookup([definition]),
      "alice",
      actions
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "burst_check",
      cardName: "雨宮 ツバキ",
      timingLabel: "バースト発動：自分のアタック",
      sourceInstanceId: "burst-src",
      registrationIndex: 1,
    });
    expect(items[0]?.effectText).toContain("自分のスピリットのアタック後");
    expect(items[0]?.effectText).not.toContain("ライフ減少後");
    expect(items[0]?.actions).toHaveLength(3);

    const bobItems = buildEffectQueue(
      state,
      (id) => (id === definition.cardNo ? definition : undefined),
      buildTriggeredEffectLookup([definition]),
      "bob",
      []
    );
    expect(bobItems).toHaveLength(0);
  });
});
