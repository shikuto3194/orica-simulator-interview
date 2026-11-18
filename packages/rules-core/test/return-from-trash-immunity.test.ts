/**
 * needs-dsl: ENGINE-effect-immunity-return-from-trash-gate
 *
 * トラッシュ束縛 effect_immunity (`while_in_trash`, BSTH002-M01 / BSTH08-C01 /
 * BSSG01-R01 / BSKB01-R04 / BSKB01-C06 / BSTH04-R01 effects[0]) の return_from_trash 経路での
 * gate 検証。
 *
 * 既存トラッシュ束縛耐性は rebuildContinuousEffectsFromField が defense_immune CE
 * として登録するところまでは配線済みだが、executeReturnFromTrash の候補集合は
 * resolveCardImmunityAffect を通っておらず、相手 acting の return_from_trash で
 * silent semantic bug (immune トラッシュカードが手札へ戻る) を起こしていた。
 *
 * - opponent-only (sourcePlayerScope:undefined, 合成カードで検証。
 *   BSTH002-M01 等「一切の効果を受けない」型は P3-144 で sourcePlayerScope:"any" 化
 *   済みのため opponent-only の実例には使えない):
 *   相手 acting の return_from_trash でのみ除外。自分 acting では除外しない。
 * - any-source (sourcePlayerScope:"any", e.g. BSTH04-R01 / BSTH002-M01): 双方の
 *   return_from_trash で除外。
 * - self-source (sourcePlayerScope:"self", e.g. BSKB01-C06): 自分 acting の
 *   return_from_trash でのみ除外。相手 acting では除外しない。
 *
 * 関連: 10_rules/03b §常在効果 / 10_rules/04b §防げない>受けない貫通。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  rebuildContinuousEffectsFromField,
} from "../src/index";
import type { CardDefinition, GameState } from "../src/index";

const ALL_CARDS_MAP = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const card = (cardNo: string): CardDefinition => {
  const def = ALL_CARDS_MAP.get(cardNo);
  if (!def) throw new Error(`Card ${cardNo} not in registry`);
  return def;
};
const getCardDefinitionById = (id: string) => ALL_CARDS_MAP.get(id);
const emptyLookup = () => undefined;

/**
 * 相手トラッシュへ search_zone する効果源。
 * `acting` プレイヤーが効果を使い、target は相手 (acting の opponent) のトラッシュ。
 */
function makeOpponentTrashSource(): CardDefinition {
  return {
    cardNo: "SRC-OPP-TRASH",
    name: "相手トラッシュ操作源",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: "trash",
              player: "opponent",
              count: 5, // 余裕を持って全部選択候補に
              destination: "hand",
            },
          },
        ],
      },
    ],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

/** 自分のトラッシュへ search_zone する効果源。 */
function makeSelfTrashSource(): CardDefinition {
  return {
    cardNo: "SRC-SELF-TRASH",
    name: "自分トラッシュ操作源",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: "trash",
              player: "self",
              count: 5,
              destination: "hand",
            },
          },
        ],
      },
    ],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

/** 自分のトラッシュから直接 move_card する効果源。 */
function makeSelfTrashMoveSource(): CardDefinition {
  return {
    cardNo: "SRC-SELF-TRASH-MOVE",
    name: "自分トラッシュ直接移動源",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "move_card",
              from: { zone: "trash", player: "self" },
              to: { zone: "hand", player: "self" },
              count: 1,
            },
          },
        ],
      },
    ],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

/**
 * opponent-only (sourcePlayerScope:undefined 既定) のトラッシュ束縛耐性を持つ合成カード。
 * 実カードは P3-144 で「一切の効果を受けない」型がすべて "any" 化されたため、
 * opponent-only 経路の検証には合成カードを使う。
 */
function makeOpponentOnlyTrashImmuneCard(): CardDefinition {
  return {
    cardNo: "TEST-OPPONENT-ONLY-TRASH-IMMUNE",
    name: "opponent-onlyトラッシュ耐性テストカード",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    effects: [
      {
        applicability: { zone: "trash" },
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "effect_immunity",
              target: { kind: "self" },
              duration: { scope: "while_in_trash" },
            },
          },
        ],
      },
    ],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

function makeBaseState(
  cardInstances: GameState["cardInstances"],
  activePlayerId: string
): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const seeded = { ...base, activePlayerId, cardInstances };
  return rebuildContinuousEffectsFromField(seeded, getCardDefinitionById);
}

/**
 * ALL_CARDS に登録されていない合成カードを使うテスト用。makeBaseState は
 * module-level の getCardDefinitionById (ALL_CARDS 限定) で rebuild するため、
 * 合成カードの defense_immune CE が登録されずに no-op 化する
 * (executeEffect 側は local defs map を渡すので解決できるが、初期 rebuild が抜け落ちる)。
 */
function makeBaseStateWithDefs(
  cardInstances: GameState["cardInstances"],
  activePlayerId: string,
  defs: Map<string, CardDefinition>
): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const seeded = { ...base, activePlayerId, cardInstances };
  return rebuildContinuousEffectsFromField(seeded, (id) => defs.get(id));
}

describe("return_from_trash respects trash-bound effect_immunity (ENGINE-effect-immunity-return-from-trash-gate)", () => {
  it("opponent-only immunity (合成カード): 相手 acting の return_from_trash 候補から除外され、トラッシュ滞在", () => {
    const src = makeOpponentTrashSource();
    const immune = makeOpponentOnlyTrashImmuneCard();
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [immune.cardNo, immune],
    ]);
    // alice のトラッシュに opponent-only 耐性カードがいる。bob が src を発揮して alice のトラッシュを操作。
    const state = makeBaseStateWithDefs(
      [
        createCardInstance(src, {
          instanceId: "src-bob",
          ownerPlayerId: "bob",
          zone: "field",
        }),
        createCardInstance(immune, {
          instanceId: "alice-immune",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
      ],
      "bob",
      defs
    );

    const result = executeEffect({
      chainId: "test:return-from-trash-immunity:237",
      state,
      effect: src.effects![0]!,
      sourceInstanceId: "src-bob",
      actingPlayerId: "bob",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-immune"
    )!;
    expect(after.zone).toBe("trash");
    // pendingZoneSelection が候補 0 件で発生しないこと。
    expect(result.pendingZoneSelection).toBeNull();
  });

  it("opponent-only immunity (合成カード): 自分 acting の return_from_trash では除外されず、手札へ戻る", () => {
    const src = makeSelfTrashSource();
    const immune = makeOpponentOnlyTrashImmuneCard();
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [immune.cardNo, immune],
    ]);
    // alice 自身が src を発揮して alice のトラッシュを操作 (自分の効果なので opponent-only 耐性は効かない)。
    const state = makeBaseStateWithDefs(
      [
        createCardInstance(src, {
          instanceId: "src-alice",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(immune, {
          instanceId: "alice-immune",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
      ],
      "alice",
      defs
    );

    const result = executeEffect({
      chainId: "test:return-from-trash-immunity:279",
      state,
      effect: src.effects![0]!,
      sourceInstanceId: "src-alice",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-immune"
    )!;
    expect(after.zone).toBe("hand");
  });

  it("self-source immunity (BSKB01-C06): 自分 acting の return_from_trash 候補から除外され、トラッシュ滞在", () => {
    const src = makeSelfTrashSource();
    const immune = card("BSKB01-C06");
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [immune.cardNo, immune],
    ]);
    // alice 自身が src を発揮して alice のトラッシュを操作。BSKB01-C06 は自分の効果だけを受けない。
    const state = makeBaseState(
      [
        createCardInstance(src, {
          instanceId: "src-alice",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(immune, {
          instanceId: "alice-self-immune",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
      ],
      "alice"
    );

    const result = executeEffect({
      chainId: "test:return-from-trash-immunity:318",
      state,
      effect: src.effects![0]!,
      sourceInstanceId: "src-alice",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-self-immune"
    )!;
    expect(after.zone).toBe("trash");
    expect(result.pendingZoneSelection).toBeNull();
  });

  it("self-source immunity (BSKB01-C06): 自分 acting の direct move_card trash->hand でも除外され、トラッシュ滞在", () => {
    const src = makeSelfTrashMoveSource();
    const immune = card("BSKB01-C06");
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [immune.cardNo, immune],
    ]);
    const state = makeBaseState(
      [
        createCardInstance(src, {
          instanceId: "src-alice",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(immune, {
          instanceId: "alice-self-immune",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
      ],
      "alice"
    );

    const result = executeEffect({
      chainId: "test:return-from-trash-immunity:357",
      state,
      effect: src.effects![0]!,
      sourceInstanceId: "src-alice",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-self-immune"
    )!;
    expect(after.definitionId).toBe("BSKB01-C06");
    expect(after.zone).toBe("trash");
  });

  it("self-source immunity (BSKB01-C06): トラッシュでは controller ずれがあっても owner 自身の効果を受けない", () => {
    const src = makeSelfTrashMoveSource();
    const immune = card("BSKB01-C06");
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [immune.cardNo, immune],
    ]);
    const state = makeBaseState(
      [
        createCardInstance(src, {
          instanceId: "src-alice",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(immune, {
          instanceId: "alice-self-immune",
          ownerPlayerId: "alice",
          controllerPlayerId: "bob",
          zone: "trash",
        }),
      ],
      "alice"
    );

    const result = executeEffect({
      chainId: "test:return-from-trash-immunity:397",
      state,
      effect: src.effects![0]!,
      sourceInstanceId: "src-alice",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-self-immune"
    )!;
    expect(after.zone).toBe("trash");
  });

  it("self-source immunity (BSKB01-C06): 相手 acting の return_from_trash では除外されず、手札へ戻る", () => {
    const src = makeOpponentTrashSource();
    const immune = card("BSKB01-C06");
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [immune.cardNo, immune],
    ]);
    // bob が src を発揮して alice のトラッシュを操作。相手の効果なので BSKB01-C06 の self-source 耐性は効かない。
    const state = makeBaseState(
      [
        createCardInstance(src, {
          instanceId: "src-bob",
          ownerPlayerId: "bob",
          zone: "field",
        }),
        createCardInstance(immune, {
          instanceId: "alice-self-immune",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
      ],
      "bob"
    );

    const result = executeEffect({
      chainId: "test:return-from-trash-immunity:436",
      state,
      effect: src.effects![0]!,
      sourceInstanceId: "src-bob",
      actingPlayerId: "bob",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-self-immune"
    )!;
    expect(after.zone).toBe("hand");
  });

  it("self-source immunity (BSKB01-C06): トラッシュでは controller ずれがあっても owner から見た相手効果を受ける", () => {
    const src = makeOpponentTrashSource();
    const immune = card("BSKB01-C06");
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [immune.cardNo, immune],
    ]);
    const state = makeBaseState(
      [
        createCardInstance(src, {
          instanceId: "src-bob",
          ownerPlayerId: "bob",
          zone: "field",
        }),
        createCardInstance(immune, {
          instanceId: "alice-self-immune",
          ownerPlayerId: "alice",
          controllerPlayerId: "bob",
          zone: "trash",
        }),
      ],
      "bob"
    );

    const result = executeEffect({
      chainId: "test:return-from-trash-immunity:475",
      state,
      effect: src.effects![0]!,
      sourceInstanceId: "src-bob",
      actingPlayerId: "bob",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-self-immune"
    )!;
    expect(after.zone).toBe("hand");
  });

  it("any-source immunity (BSTH04-R01): 自分 acting でも除外され、トラッシュ滞在", () => {
    const src = makeSelfTrashSource();
    const immune = card("BSTH04-R01");
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [immune.cardNo, immune],
    ]);
    // alice 自身が src を発揮して alice のトラッシュを操作。BSTH04-R01 は sourcePlayerScope:any。
    const state = makeBaseState(
      [
        createCardInstance(src, {
          instanceId: "src-alice",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(immune, {
          instanceId: "alice-any-immune",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
      ],
      "alice"
    );

    const result = executeEffect({
      chainId: "test:return-from-trash-immunity:514",
      state,
      effect: src.effects![0]!,
      sourceInstanceId: "src-alice",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-any-immune"
    )!;
    expect(after.zone).toBe("trash");
    expect(result.pendingZoneSelection).toBeNull();
  });

  it("any-source immunity (BSTH04-R01): 相手 acting でも除外され、トラッシュ滞在", () => {
    const src = makeOpponentTrashSource();
    const immune = card("BSTH04-R01");
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [immune.cardNo, immune],
    ]);
    // bob が src を発揮して alice のトラッシュを操作。
    const state = makeBaseState(
      [
        createCardInstance(src, {
          instanceId: "src-bob",
          ownerPlayerId: "bob",
          zone: "field",
        }),
        createCardInstance(immune, {
          instanceId: "alice-any-immune",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
      ],
      "bob"
    );

    const result = executeEffect({
      chainId: "test:return-from-trash-immunity:554",
      state,
      effect: src.effects![0]!,
      sourceInstanceId: "src-bob",
      actingPlayerId: "bob",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-any-immune"
    )!;
    expect(after.zone).toBe("trash");
    expect(result.pendingZoneSelection).toBeNull();
  });

  it("immune と非 immune が混在: 候補集合は非 immune のみ。candidate <= count のとき自動回収", () => {
    // 候補 = 2 (immune + normal), count = 5, immune 除外で残 1 → 自動回収。
    const src = makeOpponentTrashSource();
    const immune = card("BSTH002-M01");
    // 非 immune の普通カード (簡単のため category:nexus で立ち上げる)。
    const normal: CardDefinition = {
      cardNo: "NORMAL-TRASH-CARD",
      name: "通常トラッシュカード",
      printedCategory: "nexus",
      colors: ["yellow"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [immune.cardNo, immune],
      [normal.cardNo, normal],
    ]);
    const state = makeBaseState(
      [
        createCardInstance(src, {
          instanceId: "src-bob",
          ownerPlayerId: "bob",
          zone: "field",
        }),
        createCardInstance(immune, {
          instanceId: "alice-immune",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
        createCardInstance(normal, {
          instanceId: "alice-normal",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
      ],
      "bob"
    );

    const result = executeEffect({
      chainId: "test:return-from-trash-immunity:615",
      state,
      effect: src.effects![0]!,
      sourceInstanceId: "src-bob",
      actingPlayerId: "bob",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const immuneAfter = result.cardInstances.find(
      (c) => c.instanceId === "alice-immune"
    )!;
    const normalAfter = result.cardInstances.find(
      (c) => c.instanceId === "alice-normal"
    )!;
    // 自動選択時、source の actingPlayerId (bob) が回収。alice 所有のままだが bob の手札カウントが増える。
    expect(immuneAfter.zone).toBe("trash");
    expect(normalAfter.zone).toBe("hand");
  });
});

describe("P3-144: 「トラッシュにあるこのカードは、一切の効果を受けない」7枚 sourcePlayerScope:any (Q7010/Q7065/Q25555)", () => {
  const P3_144_CARDS = [
    "BSKB01-R04",
    "BSLH01-C03",
    "BSLH01-C13",
    "BSLH01-M02",
    "BSSG01-R01",
    "BSTH002-M01",
    "BSTH08-C01",
  ] as const;

  it.each(P3_144_CARDS)(
    "%s: 自分のトラッシュ回収 (search_zone trash->hand) の候補から除外され、トラッシュ滞在 (no-op)",
    (cardNo) => {
      const src = makeSelfTrashSource();
      const immune = card(cardNo);
      const defs = new Map<string, CardDefinition>([
        [src.cardNo, src],
        [immune.cardNo, immune],
      ]);
      const state = makeBaseState(
        [
          createCardInstance(src, {
            instanceId: "src-alice",
            ownerPlayerId: "alice",
            zone: "field",
          }),
          createCardInstance(immune, {
            instanceId: "alice-immune",
            ownerPlayerId: "alice",
            zone: "trash",
          }),
        ],
        "alice"
      );

      const result = executeEffect({
        chainId: "test:return-from-trash-immunity:672",
        state,
        effect: src.effects![0]!,
        sourceInstanceId: "src-alice",
        actingPlayerId: "alice",
        getCardDefinitionById: (id) => defs.get(id),
        getRegisteredTriggeredEffectActions: emptyLookup,
      });

      const after = result.cardInstances.find(
        (c) => c.instanceId === "alice-immune"
      )!;
      expect(after.zone).toBe("trash");
    }
  );

  it("sourcePlayerScope:'any' を外すと自分のトラッシュ回収が通ってしまう (修正前挙動の再現、BSTH002-M01 で実証)", () => {
    const src = makeSelfTrashSource();
    const fixed = card("BSTH002-M01");
    const trashImmunityEffect = fixed.effects!.find(
      (e) =>
        e.steps.some((s) => s.action.kind === "effect_immunity") &&
        (Array.isArray(e.applicability?.zone)
          ? e.applicability!.zone.includes("trash")
          : e.applicability?.zone === "trash")
    )!;
    // sourcePlayerScope:"any" を外した (修正前相当の) 複製カード。
    const regressed: CardDefinition = {
      ...fixed,
      effects: fixed.effects!.map((e) =>
        e === trashImmunityEffect
          ? {
              ...e,
              steps: e.steps.map((s) =>
                s.action.kind === "effect_immunity"
                  ? {
                      ...s,
                      action: {
                        ...(s.action as object),
                        sourcePlayerScope: undefined,
                      } as typeof s.action,
                    }
                  : s
              ),
            }
          : e
      ),
      cardNo: "TEST-BSTH002-M01-SCOPE-STRIPPED",
    };
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [regressed.cardNo, regressed],
    ]);
    const state = makeBaseStateWithDefs(
      [
        createCardInstance(src, {
          instanceId: "src-alice",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(regressed, {
          instanceId: "alice-regressed",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
      ],
      "alice",
      defs
    );

    const result = executeEffect({
      chainId: "test:return-from-trash-immunity:742",
      state,
      effect: src.effects![0]!,
      sourceInstanceId: "src-alice",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-regressed"
    )!;
    // sourcePlayerScope 既定 (opponent-only) だと自分の効果は防げず、手札へ戻ってしまう。
    expect(after.zone).toBe("hand");
  });
});
