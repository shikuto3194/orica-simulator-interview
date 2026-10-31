/**
 * 増分1: 煌臨宣言 (declare_advent) を legal-actions API 経由で検証する。
 *
 * executeAdvent / getAdventTargets 自体のユニットは `phase-c-advent.test.ts` で担保済み。
 * 本テストは「production 経路」(getLegalActions → declare_advent → applyLegalAction) が
 * 配線されたことと、煌臨時/召喚時 の誘発判別 (trigger-system fix) を担保する。
 *
 * fixture: フィールドにスピリット (煌臨先) + 手札に煌臨カード。
 * 煌臨カードは card_event:advent (煌臨時) と card_event:summon (召喚時) の
 * 両方の effect を持つ。煌臨では advent のみ誘発し summon は誘発しないことを確認する。
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  collectAndQueueTriggerReactions,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type {
  ActiveStack,
  CardDefinition,
  ContinuousEffect,
  GameState,
  LegalAction,
  PlayerState,
} from "../src";
import { adventSourceIdsOf } from "../src/model";

const ALICE = "alice";
const BOB = "bob";

// 煌臨先のフィールドスピリット (赤・コスト4)。
const hostSpirit: CardDefinition = {
  cardNo: "ADV-DECL-HOST",
  name: "煌臨先スピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [
    { level: 1, requiredCores: 1, bp: 3000 },
    { level: 2, requiredCores: 3, bp: 5000 },
  ],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

// 煌臨カード (赤・コスト6)。煌臨時 (advent) と 召喚時 (summon) の両 effect を持つ。
// どちらの effect も count_increase 1 を行うので、誘発した方だけ pending に積まれる。
const adventCard: CardDefinition = {
  cardNo: "ADV-DECL-ADVENT",
  name: "煌臨スピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 6,
  reductionSymbols: [],
  levelDefs: [
    { level: 1, requiredCores: 1, bp: 4000 },
    { level: 2, requiredCores: 4, bp: 7000 },
  ],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: ["advent"],
  adventData: {
    adventCondition: {
      colors: ["red"],
      minCost: 3,
      targetCategory: ["spirit"],
    },
    adventTiming: "main_and_flash",
    soulCoreDest: "trash",
  },
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      // 煌臨時
      timing: { kind: "card_event", event: "advent" },
      applicability: { zone: "field" },
      steps: [
        {
          id: "advent-effect",
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    },
    {
      // 召喚時
      timing: { kind: "card_event", event: "summon" },
      applicability: { zone: "field" },
      steps: [
        {
          id: "summon-effect",
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    },
  ],
};

const alternateCostAdventCard: CardDefinition = {
  ...adventCard,
  cardNo: "ADV-DECL-ADVENT-ALT",
  name: "擬制煌臨スピリット",
  adventData: {
    ...adventCard.adventData!,
    alternateCostAdvent: {
      condition: [],
      timing: "own_turn",
    },
  },
};

const lucyOnlyKeyBrave: CardDefinition = {
  cardNo: "BSFT01-TR02(A)",
  name: "時計座の鍵",
  printedCategory: "brave",
  colors: ["blue"],
  cost: 5,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 2000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  braveCondition: { cardNameContains: ["ルーシィ・ハートフィリア"] },
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const cardNoMap = new Map<string, CardDefinition>([
  [hostSpirit.cardNo, hostSpirit],
  [adventCard.cardNo, adventCard],
  [alternateCostAdventCard.cardNo, alternateCostAdventCard],
  [lucyOnlyKeyBrave.cardNo, lucyOnlyKeyBrave],
]);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const TEST_CARDS = [
  hostSpirit,
  adventCard,
  alternateCostAdventCard,
  lucyOnlyKeyBrave,
];
const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(TEST_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(TEST_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(TEST_CARDS),
};

/** メインステップ・ソウルコアの所在を指定して fixture state を作る。 */
function buildState(
  opts: {
    soulCoreLocation?: PlayerState["soulCoreLocation"] | "none";
    hostCores?: number;
  } = {}
): GameState {
  const host = createCardInstance(hostSpirit, {
    instanceId: "host-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: opts.hostCores ?? 3,
  });
  const advent = createCardInstance(adventCard, {
    instanceId: "advent-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const soulCoreLocation =
    opts.soulCoreLocation === "none"
      ? null
      : (opts.soulCoreLocation ?? ({ kind: "reserve" } as const));
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [{ handCount: 1, soulCoreLocation, countValue: 0 }, {}],
  });
  return {
    ...base,
    activePlayerId: ALICE,
    step: "main",
    window: "none",
    cardInstances: [host, advent],
  };
}

function findAdventDeclaration(
  state: GameState,
  actingPlayerId = ALICE
): Extract<LegalAction, { kind: "declare_advent" }> | undefined {
  const actions = getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById,
    ...effectLookups,
  });
  return actions.find(
    (a): a is Extract<LegalAction, { kind: "declare_advent" }> =>
      a.kind === "declare_advent" && a.sourceInstanceId === "advent-1"
  );
}

function getCard(state: GameState, id: string) {
  return state.cardInstances.find((c) => c.instanceId === id)!;
}

function getPlayer(state: GameState, id: string) {
  return state.players.find((p) => p.id === id)!;
}

/**
 * P3-112: declare_advent は今やスタック窓を開く（apply 即時解決ではない）。
 * responder のパスで窓を閉じ、deferred 解決（ソウルコア消費＋重ね）まで進める。
 */
function passStackUntilClosed(
  state: GameState,
  getCardDefinitionByIdFn: (id: string) => CardDefinition | undefined,
  extraOptions: Record<string, unknown> = {}
): GameState {
  let current = state;
  let guard = 0;
  while (
    (current.stackWindow ||
      current.activeAttack?.flashWindowState?.pendingStackAction) &&
    guard++ < 10
  ) {
    const responderId =
      current.stackWindow?.priorityPlayerId ??
      current.activeAttack!.flashWindowState!.priorityPlayerId;
    const actions = getLegalActions({
      state: current,
      actingPlayerId: responderId,
      getCardDefinitionById: getCardDefinitionByIdFn,
      ...extraOptions,
    } as unknown as Parameters<typeof getLegalActions>[0]);
    const pass = actions.find(
      (a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash"
    );
    if (!pass) {
      throw new Error(
        `pass_stack/pass_battle_flash for ${responderId} not found`
      );
    }
    current = (
      applyLegalAction({
        state: current,
        action: pass,
        getCardDefinitionById: getCardDefinitionByIdFn,
        ...extraOptions,
      } as Parameters<typeof applyLegalAction>[0]) as { state: GameState }
    ).state;
  }
  return current;
}

function resolvePendingEffectTarget(
  state: GameState,
  targetInstanceIds: string[],
  getCardDefinitionByIdFn: (id: string) => CardDefinition | undefined,
  extraOptions: Record<string, unknown> = {}
): GameState {
  const pending = state.pendingEffectTargetSelection;
  expect(pending).not.toBeNull();
  const actions = getLegalActions({
    state,
    actingPlayerId: pending!.actingPlayerId,
    getCardDefinitionById: getCardDefinitionByIdFn,
    ...extraOptions,
  } as unknown as Parameters<typeof getLegalActions>[0]);
  const resolveAction = actions.find(
    (a): a is Extract<LegalAction, { kind: "resolve_pending_effect_target" }> =>
      a.kind === "resolve_pending_effect_target"
  );
  expect(resolveAction).toBeDefined();
  for (const id of targetInstanceIds) {
    expect(resolveAction!.candidateTargetInstanceIds).toContain(id);
  }
  return applyLegalAction({
    state,
    action: resolveAction!,
    targetInstanceIds,
    getCardDefinitionById: getCardDefinitionByIdFn,
    ...extraOptions,
  } as Parameters<typeof applyLegalAction>[0]).state;
}

function resolvePendingAsIfSoulCoreChoice(
  state: GameState,
  choiceId: string,
  getCardDefinitionByIdFn: (id: string) => CardDefinition | undefined,
  extraOptions: Record<string, unknown> = {}
): GameState {
  const pending = state.pendingAsIfSoulCoreChoice;
  expect(pending).not.toBeNull();
  const actions = getLegalActions({
    state,
    actingPlayerId: pending!.actingPlayerId,
    getCardDefinitionById: getCardDefinitionByIdFn,
    ...extraOptions,
  } as unknown as Parameters<typeof getLegalActions>[0]);
  const resolveAction = actions.find(
    (
      a
    ): a is Extract<
      LegalAction,
      { kind: "resolve_pending_as_if_soul_core_choice" }
    > =>
      a.kind === "resolve_pending_as_if_soul_core_choice" &&
      a.choiceId === choiceId
  );
  expect(resolveAction).toBeDefined();
  return applyLegalAction({
    state,
    action: resolveAction!,
    getCardDefinitionById: getCardDefinitionByIdFn,
    ...extraOptions,
  } as Parameters<typeof applyLegalAction>[0]).state;
}

function passStackAndResolveTarget(
  state: GameState,
  targetInstanceIds: string[],
  getCardDefinitionByIdFn: (id: string) => CardDefinition | undefined,
  extraOptions: Record<string, unknown> = {}
): GameState {
  const afterStack = passStackUntilClosed(
    state,
    getCardDefinitionByIdFn,
    extraOptions
  );
  return resolvePendingEffectTarget(
    afterStack,
    targetInstanceIds,
    getCardDefinitionByIdFn,
    extraOptions
  );
}

describe("増分1: declare_advent legal action の出現と適用", () => {
  it("メインステップでソウルコアと有効な煌臨先があれば declare_advent が legal になる", () => {
    const state = buildState();
    const decl = findAdventDeclaration(state);
    expect(decl).toBeDefined();
    expect(decl!.actingPlayerId).toBe(ALICE);
    expect(decl!.requiredTargetCount).toBe(1);
    expect(decl!.targetMode).toBe("manual");
    expect(decl!.adventMode).toBe("normal");
    expect(decl!.soulCoreDest).toBe("trash");
    // 煌臨先候補に host-1 が含まれる
    expect(decl!.candidateTargetInstanceIds).toContain("host-1");
  });

  it("ソウルコアが使用不可 (trash) なら declare_advent は出ない", () => {
    const state = buildState({ soulCoreLocation: { kind: "trash" } });
    expect(findAdventDeclaration(state)).toBeUndefined();
  });

  it("ソウルコアが無い (null) なら declare_advent は出ない", () => {
    const state = buildState({ soulCoreLocation: "none" });
    expect(findAdventDeclaration(state)).toBeUndefined();
  });

  it("有効な煌臨先がフィールドに無ければ declare_advent は出ない", () => {
    // host を場から除く: 煌臨先 0 件
    const state = buildState();
    const withoutHost: GameState = {
      ...state,
      cardInstances: state.cardInstances.filter(
        (c) => c.instanceId !== "host-1"
      ),
    };
    expect(findAdventDeclaration(withoutHost)).toBeUndefined();
  });

  it("ENGINE-restrict-advent: restrict_advent CE があると declare_advent は出ない (BSFT01-X01 [4,5])", () => {
    const state = buildState();
    const restrictAlice: ContinuousEffect = {
      effectId: "ce:restrict-advent:alice",
      sourceInstanceId: "bob-source",
      sourceDefinitionId: adventCard.cardNo,
      actingPlayerId: BOB,
      duration: { scope: "turn" },
      createdAtTurn: state.turnNumber,
      createdAtAttackId: state.activeAttack?.attackId ?? null,
      modifierTag: "restrict_advent",
      targetInstanceId: ALICE,
    };
    const restrictedState: GameState = {
      ...state,
      activeContinuousEffects: [
        ...state.activeContinuousEffects,
        restrictAlice,
      ],
    };

    expect(findAdventDeclaration(restrictedState)).toBeUndefined();
    // CE の対象でない bob は制限を受けない (対称確認は fixture が Alice 視点前提のため
    // targetInstanceId を反転した別 CE で isAdventRestricted 単体テストは restrict-advent.test.ts 側で担保)
    expect(findAdventDeclaration(state)).toBeDefined();
  });

  it("適用後: 煌臨カードが煌臨先の上に重なる (advent overlay) + ソウルコア消費", () => {
    const state = buildState();
    const decl = findAdventDeclaration(state)!;

    const result = applyLegalAction({
      state,
      action: decl,
      getCardDefinitionById,
      ...effectLookups,
    });
    // P3-112: 発揮宣言はスタック窓を開くのみ。相手のパスで窓を閉じ deferred 解決へ進める。
    const newState = passStackAndResolveTarget(
      result.state,
      ["host-1"],
      getCardDefinitionById,
      effectLookups
    );

    // 煌臨カードはフィールドに移り、煌臨元 host-1 を adventSourceCardIds に持つ
    const adv = getCard(newState, "advent-1");
    expect(adv.zone).toBe("field");
    expect(adv.zoneRoleName).toBe("spirit");
    expect(adventSourceIdsOf(adv)).toContain("host-1");

    // 煌臨先は煌臨元になる
    const host = getCard(newState, "host-1");
    expect(host.zoneRoleName).toBe("advent-source");

    // ソウルコアが soulCoreDest (trash) へ消費される
    expect(getPlayer(newState, ALICE).soulCoreLocation).toEqual({
      kind: "trash",
    });
    // 手札枚数が減る
    expect(getPlayer(newState, ALICE).handCount).toBe(0);
  });

  it.each(["normal", "contract", "f_contract"] as const)(
    "%s: ソウルコア単独の対象へ擬制煌臨し、コアと煌臨元を引き継ぐ",
    (adventVariant) => {
      const definition: CardDefinition = {
        ...alternateCostAdventCard,
        effects: [],
        adventData: { ...alternateCostAdventCard.adventData!, adventVariant },
      };
      const localCards = [hostSpirit, definition];
      const localEffects = {
        getRegisteredFieldCardEffectActions:
          buildFieldCardEffectLookup(localCards),
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(localCards),
        getRegisteredBattleImmediateEffectActions:
          buildBattleImmediateEffectLookup(localCards),
      };
      const lookup = (id: string) =>
        id === definition.cardNo ? definition : getCardDefinitionById(id);
      const base = buildState({
        hostCores: 0,
        soulCoreLocation: { kind: "card", instanceId: "host-1" },
      });
      const state: GameState = {
        ...base,
        cardInstances: base.cardInstances.map((c) =>
          c.instanceId === "host-1"
            ? { ...c, soulCoreCount: 1 }
            : c.instanceId === "advent-1"
              ? { ...c, definitionId: definition.cardNo }
              : c
        ),
      };
      const actions = (state: GameState) =>
        getLegalActions({
          state,
          actingPlayerId: ALICE,
          getCardDefinitionById: lookup,
          ...localEffects,
        });
      const declaration = actions(state).find(
        (a) => a.kind === "declare_advent"
      );
      expect(declaration).toMatchObject({
        candidateTargetInstanceIds: ["host-1"],
      });
      const declared = applyLegalAction({
        state,
        action: declaration!,
        getCardDefinitionById: lookup,
        ...localEffects,
      }).state;
      expect(declared.stackWindow).not.toBeNull();
      const afterStack = passStackUntilClosed(declared, lookup, localEffects);
      expect(afterStack.pendingAsIfSoulCoreChoice).toBeNull();
      const resolved = resolvePendingEffectTarget(
        afterStack,
        ["host-1"],
        lookup,
        localEffects
      );
      expect(getCard(resolved, "advent-1")).toMatchObject({
        zone: "field",
        normalCoreCount: 0,
        soulCoreCount: 1,
        underCards: [{ cardInstanceId: "host-1", role: "advent_source" }],
      });
      expect(getCard(resolved, "host-1").soulCoreCount).toBe(0);
      expect(getPlayer(resolved, ALICE).soulCoreLocation).toEqual({
        kind: "card",
        instanceId: "advent-1",
      });
      expect(resolved.pendingEffectTargetSelection).toBeNull();
      expect(resolved.pendingLeaveEntities).toEqual([]);
      expect(resolved.usedAlternateCostAdventKeysThisTurn).toContain(
        "name:" + definition.name
      );
      expect(
        actions({
          ...state,
          usedAlternateCostAdventKeysThisTurn: ["name:" + definition.name],
        }).some((a) => a.kind === "declare_advent")
      ).toBe(false);
    }
  );

  it("通常コストと擬制コストが両方ある場合、選択はスタック窓後・対象選択前に開く", () => {
    const base = buildState();
    const state: GameState = {
      ...base,
      cardInstances: base.cardInstances.map((card) =>
        card.instanceId === "advent-1"
          ? { ...card, definitionId: alternateCostAdventCard.cardNo }
          : card
      ),
    };
    const decl = findAdventDeclaration(state)!;

    const declared = applyLegalAction({
      state,
      action: decl,
      getCardDefinitionById,
      ...effectLookups,
    }).state;
    expect(declared.stackWindow).not.toBeNull();
    expect(declared.pendingAsIfSoulCoreChoice).toBeNull();
    expect(declared.pendingEffectTargetSelection).toBeNull();

    const afterStack = passStackUntilClosed(
      declared,
      getCardDefinitionById,
      effectLookups
    );
    expect(afterStack.stackWindow).toBeNull();
    expect(afterStack.pendingEffectTargetSelection).toBeNull();
    expect(afterStack.pendingAsIfSoulCoreChoice).toMatchObject({
      actionKind: "declare_advent",
      sourceInstanceId: "advent-1",
    });
    expect(
      afterStack.pendingAsIfSoulCoreChoice!.options.map(
        (option) => option.choiceId
      )
    ).toEqual(["normal", "alternate"]);

    const afterChoice = resolvePendingAsIfSoulCoreChoice(
      afterStack,
      "alternate",
      getCardDefinitionById,
      effectLookups
    );
    expect(afterChoice.pendingAsIfSoulCoreChoice).toBeNull();
    expect(afterChoice.pendingEffectTargetSelection).not.toBeNull();

    const resolved = resolvePendingEffectTarget(
      afterChoice,
      ["host-1"],
      getCardDefinitionById,
      effectLookups
    );
    expect(getPlayer(resolved, ALICE).soulCoreLocation).toEqual({
      kind: "reserve",
    });
    expect(resolved.usedAlternateCostAdventKeysThisTurn).toContain(
      `name:${alternateCostAdventCard.name}`
    );
  });

  it("不発: 窓中に煌臨先が場を離れたら、パス後も手札のまま・ソウルコア未消費 (P3-112 fizzle)", () => {
    const state = buildState();
    const decl = findAdventDeclaration(state)!;

    const declared = applyLegalAction({
      state,
      action: decl,
      targetInstanceIds: ["host-1"],
      getCardDefinitionById,
      ...effectLookups,
    }).state;
    expect(declared.stackWindow).not.toBeNull();

    // 窓中に煌臨先が場を離れる (相手効果でトラッシュへ、を模擬)。
    const hostLeftField: GameState = {
      ...declared,
      cardInstances: declared.cardInstances.map((c) =>
        c.instanceId === "host-1" ? { ...c, zone: "trash" as const } : c
      ),
    };

    const passAction = getLegalActions({
      state: hostLeftField,
      actingPlayerId: hostLeftField.stackWindow!.priorityPlayerId,
      getCardDefinitionById,
      ...effectLookups,
    }).find((a) => a.kind === "pass_stack");
    expect(passAction).toBeDefined();
    const resolved = applyLegalAction({
      state: hostLeftField,
      action: passAction!,
      getCardDefinitionById,
      ...effectLookups,
    }).state;

    // 不発 (executeAdvent の事前検証再実行が target-not-on-field で弾く):
    // 煌臨カードは手札のまま、ソウルコアは消費されない。
    const adv = getCard(resolved, "advent-1");
    expect(adv.zone).toBe("hand");
    expect(getPlayer(resolved, ALICE).soulCoreLocation).toEqual({
      kind: "reserve",
    });
    expect(getPlayer(resolved, ALICE).handCount).toBe(1);
  });

  it("BSFT01-TR02(A) は advent 継承時も cardNameContains の braveCondition を見て、非ルーシィ煌臨先では分離して破棄する", () => {
    const state = buildState();
    const keyBrave = createCardInstance(lucyOnlyKeyBrave, {
      instanceId: "bsft01-tr02a-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "host-1",
      normalCoreCount: 1,
    });
    const withBrave: GameState = {
      ...state,
      step: "attack",
      window: "flash_before_block",
      cardInstances: [
        ...state.cardInstances.map((card) =>
          card.instanceId === "host-1"
            ? { ...card, attachedChildrenIds: ["bsft01-tr02a-brave"] }
            : card
        ),
        keyBrave,
      ],
      activeAttack: {
        attackId: "advent-detach-battle",
        primaryEntityId: "be-advent-host",
        participantEntityIds: ["be-advent-host"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: ALICE,
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: ALICE,
          pendingStackAction: null,
        },
      },
      battleEntities: [
        {
          entityId: "be-advent-host",
          memberInstanceIds: ["host-1", "bsft01-tr02a-brave"],
          resolvedBp: 5000,
          resolvedSymbols: ["red", "blue"],
          attackState: "attacking",
        },
      ],
    };
    const decl = findAdventDeclaration(withBrave)!;
    const reserveBefore = getPlayer(withBrave, ALICE).reserveNormalCoreCount;

    const result = applyLegalAction({
      state: withBrave,
      action: decl,
      getCardDefinitionById,
      ...effectLookups,
    });
    const newState = passStackAndResolveTarget(
      result.state,
      ["host-1"],
      getCardDefinitionById,
      effectLookups
    );

    expect(getCard(newState, "advent-1").attachedChildrenIds).toEqual([]);
    expect(
      getCard(newState, "bsft01-tr02a-brave").attachedToInstanceId
    ).toBeNull();
    expect(getCard(newState, "bsft01-tr02a-brave").zone).toBe("trash");
    expect(
      newState.battleEntities.find(
        (entity) => entity.entityId === "be-advent-host"
      )?.memberInstanceIds
    ).toEqual(["advent-1"]);
    expect(
      newState.battleEntities.find(
        (entity) => entity.entityId === "be-advent-host"
      )?.resolvedSymbols
    ).toEqual(["red"]);
    expect(getPlayer(newState, ALICE).reserveNormalCoreCount).toBe(
      reserveBefore + 1
    );
  });

  it("BSFT01-TR02(A) は advent 継承時に期間指定の名称上書きを引き継いでから合体条件を判定する", () => {
    const state = buildState();
    const keyBrave = createCardInstance(lucyOnlyKeyBrave, {
      instanceId: "bsft01-tr02a-duration-name-brave",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: "host-1",
    });
    const nameOverride: ContinuousEffect = {
      effectId: "test-advent-duration-lucy-name",
      sourceInstanceId: "name-source",
      sourceDefinitionId: "TEST-NAME-SOURCE",
      actingPlayerId: ALICE,
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "override_properties",
      targetInstanceId: "host-1",
      metadata: { properties: { cardName: "ルーシィ・ハートフィリア" } },
    };
    const withBraveAndDurationName: GameState = {
      ...state,
      activeContinuousEffects: [...state.activeContinuousEffects, nameOverride],
      cardInstances: [
        ...state.cardInstances.map((card) =>
          card.instanceId === "host-1"
            ? {
                ...card,
                attachedChildrenIds: ["bsft01-tr02a-duration-name-brave"],
              }
            : card
        ),
        keyBrave,
      ],
    };
    const decl = findAdventDeclaration(withBraveAndDurationName)!;

    const result = applyLegalAction({
      state: withBraveAndDurationName,
      action: decl,
      getCardDefinitionById,
      ...effectLookups,
    });
    const newState = passStackAndResolveTarget(
      result.state,
      ["host-1"],
      getCardDefinitionById,
      effectLookups
    );

    expect(getCard(newState, "advent-1").attachedChildrenIds).toEqual([
      "bsft01-tr02a-duration-name-brave",
    ]);
    expect(
      getCard(newState, "bsft01-tr02a-duration-name-brave").attachedToInstanceId
    ).toBe("advent-1");
    expect(
      newState.activeContinuousEffects.find(
        (ce) => ce.effectId === "test-advent-duration-lucy-name"
      )?.targetInstanceId
    ).toBe("advent-1");
  });

  it("REGRESSION: 煌臨では『煌臨時』が誘発し『召喚時』は誘発しない", () => {
    const state = buildState();
    const decl = findAdventDeclaration(state)!;

    const result = applyLegalAction({
      state,
      action: decl,
      getCardDefinitionById,
      ...effectLookups,
    });
    const newState = passStackAndResolveTarget(
      result.state,
      ["host-1"],
      getCardDefinitionById,
      effectLookups
    );

    // 誘発 pending は advent-1 由来で 1 件のみ (煌臨時)。召喚時は積まれない。
    const pendings = newState.pendingTriggeredEffects.filter(
      (p) => p.relatedInstanceId === "advent-1"
    );
    expect(pendings).toHaveLength(1);
    expect(pendings[0]!.eventKind).toBe("advent");
    expect(
      newState.pendingTriggeredEffects.some(
        (p) => p.eventKind === "summon" && p.relatedInstanceId === "advent-1"
      )
    ).toBe(false);
  });

  it("REGRESSION: 同じカードの通常召喚では『召喚時』が誘発する (summon 検出を壊さない)", () => {
    // 煌臨ではなく通常召喚で advent-1 がフィールドに入ったケースを差分から検出する。
    // before: 手札、after: フィールド (adventSourceCardIds は空のまま)。
    const advHand = createCardInstance(adventCard, {
      instanceId: "advent-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const before = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [{ handCount: 1, countValue: 0 }, {}],
    });
    const beforeState: GameState = {
      ...before,
      activePlayerId: ALICE,
      step: "main",
      cardInstances: [advHand],
    };

    // 通常召喚相当: フィールドへ (adventSourceCardIds は空)。
    const afterState: GameState = {
      ...beforeState,
      cardInstances: beforeState.cardInstances.map((c) =>
        c.instanceId === "advent-1"
          ? {
              ...c,
              zone: "field" as const,
              zoneRoleName: "spirit",
              normalCoreCount: 1,
            }
          : c
      ),
      players: beforeState.players.map((p) =>
        p.id === ALICE ? { ...p, handCount: 0 } : p
      ),
    };

    // trigger-system の差分検出を直接通す
    const stateWithTriggers = collectTriggersForTest(beforeState, afterState);

    const pendings = stateWithTriggers.pendingTriggeredEffects.filter(
      (p) => p.relatedInstanceId === "advent-1"
    );
    expect(pendings).toHaveLength(1);
    expect(pendings[0]!.eventKind).toBe("summon");
  });
});

// collectAndQueueTriggerReactions を test から直接呼ぶための薄いラッパ。
function collectTriggersForTest(
  beforeState: GameState,
  afterState: GameState
): GameState {
  return collectAndQueueTriggerReactions({
    beforeState,
    afterState,
    source: "action_resolution",
    chainId: "test:advent-declaration:874",
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      effectLookups.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: undefined,
    causedByPlayerId: ALICE,
  });
}

// ===========================================================================
// 増分2: 契約煌臨 / F契約煌臨 の宣言配線。
// ===========================================================================

// 契約煌臨カード (adventVariant: "contract")。魂状態の契約カードに煌臨できる。
const contractAdventCard: CardDefinition = {
  cardNo: "ADV-DECL-CONTRACT",
  name: "契約煌臨スピリット",
  printedCategory: "spirit",
  colors: ["purple"],
  cost: 5,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: ["advent"],
  adventData: {
    adventCondition: {
      colors: ["purple"],
      minCost: 3,
      targetCategory: ["spirit"],
    },
    adventTiming: "main_and_flash",
    soulCoreDest: "trash",
    adventVariant: "contract",
  },
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

// F契約煌臨カード (adventVariant: "f_contract")。魂状態 + ネクサスにも煌臨できる。
const fContractAdventCard: CardDefinition = {
  cardNo: "ADV-DECL-FCONTRACT",
  name: "F契約煌臨スピリット",
  printedCategory: "spirit",
  colors: ["purple"],
  cost: 5,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: ["advent"],
  adventData: {
    adventCondition: {
      colors: ["purple"],
      minCost: 2,
      targetCategory: ["spirit"],
    },
    adventTiming: "main_and_flash",
    soulCoreDest: "trash",
    adventVariant: "f_contract",
  },
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

// 契約カード本体 (フィールドに魂状態で存在しうる)。紫・コスト3。
const contractBodySpirit: CardDefinition = {
  cardNo: "ADV-DECL-CONTRACT-BODY",
  name: "契約スピリット本体",
  printedCategory: "spirit",
  colors: ["purple"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: ["contract"],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

// 契約フラッグネクサス相当 (紫・コスト2)。F契約煌臨先。
const contractNexus: CardDefinition = {
  cardNo: "ADV-DECL-NEXUS",
  name: "契約ネクサス",
  printedCategory: "nexus",
  colors: ["purple"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const inc2CardList = [
  contractAdventCard,
  fContractAdventCard,
  contractBodySpirit,
  contractNexus,
  hostSpirit,
];
const inc2CardMap = new Map<string, CardDefinition>(
  inc2CardList.map((c) => [c.cardNo, c])
);
const getInc2Def = (id: string) => inc2CardMap.get(id);
const inc2Lookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(inc2CardList),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(inc2CardList),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(inc2CardList),
};

function findDecl(
  state: GameState,
  sourceInstanceId: string,
  actingPlayerId = ALICE
): Extract<LegalAction, { kind: "declare_advent" }> | undefined {
  const actions = getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById: getInc2Def,
    ...inc2Lookups,
  });
  return actions.find(
    (a): a is Extract<LegalAction, { kind: "declare_advent" }> =>
      a.kind === "declare_advent" && a.sourceInstanceId === sourceInstanceId
  );
}

describe("増分2: 契約煌臨 (declare_advent adventMode='contract')", () => {
  /** ALICE の手札に契約煌臨カード + フィールドに魂状態の契約カードを置く。 */
  function buildContractState(): GameState {
    const soulBody = createCardInstance(contractBodySpirit, {
      instanceId: "soul-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const advent = createCardInstance(contractAdventCard, {
      instanceId: "c-advent-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [
        {
          handCount: 1,
          soulCoreLocation: { kind: "reserve" },
          countValue: 0,
          soulStateInstanceIds: ["soul-1"],
          contractCardNo: contractBodySpirit.cardNo,
        },
        {},
      ],
    });
    return {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      window: "none",
      cardInstances: [soulBody, advent],
    };
  }

  it("魂状態の契約カードへの契約煌臨が legal になり adventMode='contract'", () => {
    const state = buildContractState();
    const decl = findDecl(state, "c-advent-1");
    expect(decl).toBeDefined();
    expect(decl!.adventMode).toBe("contract");
    // 魂状態の soul-1 が候補に含まれる (通常煌臨では出ない)
    expect(decl!.candidateTargetInstanceIds).toContain("soul-1");
  });

  it("適用後: 魂状態に煌臨カードが重なり、魂状態が解除され、ソウルコアが trash へ", () => {
    const state = buildContractState();
    const decl = findDecl(state, "c-advent-1")!;

    const result = applyLegalAction({
      state,
      action: decl,
      getCardDefinitionById: getInc2Def,
      ...inc2Lookups,
    });
    const newState = passStackAndResolveTarget(
      result.state,
      ["soul-1"],
      getInc2Def,
      inc2Lookups
    );

    // 煌臨カードはフィールドに移り soul-1 を煌臨元に持つ
    const adv = getCard(newState, "c-advent-1");
    expect(adv.zone).toBe("field");
    expect(adventSourceIdsOf(adv)).toContain("soul-1");
    // soul-1 は煌臨元になる
    expect(getCard(newState, "soul-1").zoneRoleName).toBe("advent-source");
    // 魂状態が解除される
    const alice = getPlayer(newState, ALICE);
    expect(alice.soulStateInstanceIds).not.toContain("soul-1");
    // ソウルコアは soulCoreDest=trash へ消費 (契約煌臨)
    expect(alice.soulCoreLocation).toEqual({ kind: "trash" });
  });

  it("contractCardNo 不一致なら魂状態カードは候補に出ない (通常スピリット先のみ)", () => {
    // 魂状態カードを非契約に: getContractAdventTargets は soul を除外し、
    // 通常先 (条件を満たすスピリット) のみ残る。ここでは通常先も無いので legal 自体が消える。
    const state = buildContractState();
    const mismatched: GameState = {
      ...state,
      players: state.players.map((p) =>
        p.id === ALICE ? { ...p, contractCardNo: "OTHER-CARD" } : p
      ),
    };
    expect(findDecl(mismatched, "c-advent-1")).toBeUndefined();
  });
});

describe("増分2: F契約煌臨 (declare_advent adventMode='f_contract')", () => {
  /** ALICE の手札に F契約煌臨カード + フィールドにネクサスを置く。 */
  function buildFContractState(): GameState {
    const nexus = createCardInstance(contractNexus, {
      instanceId: "nexus-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const advent = createCardInstance(fContractAdventCard, {
      instanceId: "f-advent-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [
        {
          handCount: 1,
          soulCoreLocation: { kind: "reserve" },
          countValue: 0,
          contractCardNo: contractNexus.cardNo,
        },
        {},
      ],
    });
    return {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      window: "none",
      cardInstances: [nexus, advent],
    };
  }

  it("ネクサスへの F契約煌臨が legal になり adventMode='f_contract'", () => {
    const state = buildFContractState();
    const decl = findDecl(state, "f-advent-1");
    expect(decl).toBeDefined();
    expect(decl!.adventMode).toBe("f_contract");
    // ネクサス nexus-1 が候補に含まれる (通常/契約煌臨では出ない)
    expect(decl!.candidateTargetInstanceIds).toContain("nexus-1");
  });

  it("適用後: ネクサスに煌臨カードが重なり、isFContractAdvent 経路で解決される", () => {
    const state = buildFContractState();
    const decl = findDecl(state, "f-advent-1")!;

    const result = applyLegalAction({
      state,
      action: decl,
      getCardDefinitionById: getInc2Def,
      ...inc2Lookups,
    });
    const newState = passStackAndResolveTarget(
      result.state,
      ["nexus-1"],
      getInc2Def,
      inc2Lookups
    );

    // 煌臨カードはフィールドに移り nexus-1 を煌臨元に持つ (condition-not-met で弾かれていない)
    const adv = getCard(newState, "f-advent-1");
    expect(adv.zone).toBe("field");
    expect(adventSourceIdsOf(adv)).toContain("nexus-1");
    // nexus-1 は煌臨元になる
    expect(getCard(newState, "nexus-1").zoneRoleName).toBe("advent-source");
    // ソウルコア消費
    expect(getPlayer(newState, ALICE).soulCoreLocation).toEqual({
      kind: "trash",
    });
  });
});

describe("増分2: 非契約カードは contract/f_contract を誤って出さない", () => {
  it("adventVariant 未指定の通常煌臨カードは adventMode='normal' のまま (魂状態/ネクサスを候補にしない)", () => {
    // hostSpirit を煌臨先 (赤・コスト4) として通常 adventCard を使う。
    // さらに魂状態カード・ネクサスを場に置いても、normal なので候補に含めない。
    const host = createCardInstance(hostSpirit, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const soulBody = createCardInstance(contractBodySpirit, {
      instanceId: "soul-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 0,
    });
    const nexus = createCardInstance(contractNexus, {
      instanceId: "nexus-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const advent = createCardInstance(adventCard, {
      instanceId: "advent-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [
        {
          handCount: 1,
          soulCoreLocation: { kind: "reserve" },
          countValue: 0,
          soulStateInstanceIds: ["soul-1"],
          contractCardNo: contractBodySpirit.cardNo,
        },
        {},
      ],
    });
    const state: GameState = {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      window: "none",
      cardInstances: [host, soulBody, nexus, advent],
    };

    // adventCard は cardNoMap (増分1 fixtures) に居るので getCardDefinitionById を使う。
    const merged = new Map<string, CardDefinition>([
      ...inc2CardMap,
      [adventCard.cardNo, adventCard],
    ]);
    const getMergedDef = (id: string) => merged.get(id);
    const mergedCards = [...inc2CardList, adventCard];
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getMergedDef,
      getRegisteredFieldCardEffectActions:
        buildFieldCardEffectLookup(mergedCards),
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(mergedCards),
      getRegisteredBattleImmediateEffectActions:
        buildBattleImmediateEffectLookup(mergedCards),
    });
    const decl = actions.find(
      (a): a is Extract<LegalAction, { kind: "declare_advent" }> =>
        a.kind === "declare_advent" && a.sourceInstanceId === "advent-1"
    );
    expect(decl).toBeDefined();
    expect(decl!.adventMode).toBe("normal");
    // 通常先 host-1 のみ。魂状態 soul-1 / ネクサス nexus-1 は含まれない。
    expect(decl!.candidateTargetInstanceIds).toContain("host-1");
    expect(decl!.candidateTargetInstanceIds).not.toContain("soul-1");
    expect(decl!.candidateTargetInstanceIds).not.toContain("nexus-1");
  });
});

describe("増分2: フラッシュ窓での煌臨宣言 (both_attack_step)", () => {
  // both_attack_step 煌臨カードを BOB (responder) の手札に置き、
  // ALICE のアタックステップの before_block フラッシュ窓で BOB が priority を持つ状況。
  const flashAdventCard: CardDefinition = {
    cardNo: "ADV-DECL-FLASH",
    name: "フラッシュ煌臨スピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 6,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: ["advent"],
    adventData: {
      adventCondition: {
        colors: ["red"],
        minCost: 3,
        targetCategory: ["spirit"],
      },
      adventTiming: "both_attack_step",
      soulCoreDest: "trash",
    },
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
  const flashCardList = [flashAdventCard, hostSpirit];
  const flashCardMap = new Map<string, CardDefinition>(
    flashCardList.map((c) => [c.cardNo, c])
  );
  const getFlashDef = (id: string) => flashCardMap.get(id);
  const flashLookups = {
    getRegisteredFieldCardEffectActions:
      buildFieldCardEffectLookup(flashCardList),
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(flashCardList),
    getRegisteredBattleImmediateEffectActions:
      buildBattleImmediateEffectLookup(flashCardList),
  };

  /**
   * ALICE がアタック宣言し、before_block フラッシュ窓で responder=BOB が priority を持つ state。
   * BOB の手札に both_attack_step 煌臨カード、BOB のフィールドに煌臨先スピリット。
   */
  function buildFlashState(): GameState {
    const bobHost = createCardInstance(hostSpirit, {
      instanceId: "bob-host-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 3,
    });
    const bobAdvent = createCardInstance(flashAdventCard, {
      instanceId: "bob-advent-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [
        {},
        { handCount: 1, soulCoreLocation: { kind: "reserve" }, countValue: 0 },
      ],
    });
    return {
      ...base,
      activePlayerId: ALICE,
      step: "attack",
      window: "flash_before_block",
      cardInstances: [bobHost, bobAdvent],
      activeAttack: {
        attackId: "atk-1",
        primaryEntityId: "e-atk",
        participantEntityIds: ["e-atk"],
        groupMode: "single",
        target: { kind: "player", playerId: BOB },
        blockAssignments: [],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: BOB,
          consecutivePassCount: 0,
          // フラッシュ本体ループでは優先権者が現在の flash 宣言者。
          stackResponseSourcePlayerId: BOB,
          pendingStackAction: null,
        },
      },
    };
  }

  const pendingStackAction: ActiveStack = {
    stackId: "stack:alice-flash",
    actionKind: "field_card_effect",
    chainId: "chain:alice-flash",
    actingPlayerId: ALICE,
    cardInstanceId: "alice-source",
    cardDefinitionId: hostSpirit.cardNo,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    chosenTiming: "flash",
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };

  function buildStackSubwindowState(): GameState {
    const state = buildFlashState();
    return {
      ...state,
      window: "stack_before_block",
      activeAttack: {
        ...state.activeAttack!,
        flashWindowState: {
          ...state.activeAttack!.flashWindowState!,
          priorityPlayerId: BOB,
          stackResponseSourcePlayerId: ALICE,
          pendingStackAction,
        },
      },
    };
  }

  function buildMainStepStateWithBothAttackAdvent(): GameState {
    const aliceHost = createCardInstance(hostSpirit, {
      instanceId: "alice-host-main",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const aliceAdvent = createCardInstance(flashAdventCard, {
      instanceId: "alice-advent-main",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [
        { handCount: 1, soulCoreLocation: { kind: "reserve" }, countValue: 0 },
        {},
      ],
    });
    return {
      ...base,
      activePlayerId: ALICE,
      step: "main",
      window: "none",
      cardInstances: [aliceHost, aliceAdvent],
    };
  }

  it("both_attack_step 煌臨が responder=BOB のフラッシュ窓で legal になる", () => {
    const state = buildFlashState();
    const decl = findDeclForPlayer(state, "bob-advent-1", BOB);
    expect(decl).toBeDefined();
    expect(decl!.actingPlayerId).toBe(BOB);
    expect(decl!.adventMode).toBe("normal");
    expect(decl!.candidateTargetInstanceIds).toContain("bob-host-1");
  });

  it("手札フラッシュ使用禁止中は both_attack_step 煌臨を宣言できない", () => {
    const state = buildFlashState();
    const restrictBobHandFlash: ContinuousEffect = {
      effectId: "ce:restrict-flash-hand:bob",
      sourceInstanceId: "alice-source",
      sourceDefinitionId: flashAdventCard.cardNo,
      actingPlayerId: ALICE,
      duration: { scope: "battle" },
      createdAtTurn: state.turnNumber,
      createdAtAttackId: state.activeAttack?.attackId ?? null,
      modifierTag: "restrict_flash_hand",
      targetInstanceId: BOB,
      metadata: { restrictedZones: ["hand"] },
    };
    const restrictedState: GameState = {
      ...state,
      activeContinuousEffects: [
        ...state.activeContinuousEffects,
        restrictBobHandFlash,
      ],
    };

    const decl = findDeclForPlayer(restrictedState, "bob-advent-1", BOB);
    expect(decl).toBeUndefined();
  });

  it("stack 応答窓では both_attack_step 煌臨を宣言できない", () => {
    const state = buildStackSubwindowState();
    const decl = findDeclForPlayer(state, "bob-advent-1", BOB);
    expect(decl).toBeUndefined();
  });

  it("フラッシュ窓で priority を持たない側 (ALICE) には both_attack_step 煌臨は出ない", () => {
    // priority=BOB の窓では ALICE の timing は空 → 煌臨も出ない (availability gating)。
    const state = buildFlashState();
    const decl = findDeclForPlayer(state, "bob-advent-1", ALICE);
    expect(decl).toBeUndefined();
  });

  it("both_attack_step 煌臨はメインステップの raw flash timing では legal にならない", () => {
    const state = buildMainStepStateWithBothAttackAdvent();
    const decl = findDeclForPlayer(state, "alice-advent-main", ALICE);
    expect(decl).toBeUndefined();
  });

  function findDeclForPlayer(
    state: GameState,
    sourceInstanceId: string,
    actingPlayerId: string
  ): Extract<LegalAction, { kind: "declare_advent" }> | undefined {
    const actions = getLegalActions({
      state,
      actingPlayerId,
      getCardDefinitionById: getFlashDef,
      ...flashLookups,
    });
    return actions.find(
      (a): a is Extract<LegalAction, { kind: "declare_advent" }> =>
        a.kind === "declare_advent" && a.sourceInstanceId === sourceInstanceId
    );
  }
});
