import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildMagicLookup,
  buildFieldCardEffectLookup,
  checkAndQueueOracleChoices,
  checkAndQueuePlacementOracle,
  createCardInstance,
  createEmptyGameState,
  getAvailableMagicPaymentSources,
  getLegalActions,
  type CardDefinition,
  type GameState,
  type OracleTriggerKind,
} from "../src/runtime";

const source = ALL_CARDS.find((card) => card.cardNo === "BSTH10.5-X01")!;
const nexus: CardDefinition = {
  cardNo: "TEST-DEPENDENT-NEXUS",
  name: "依神対象",
  printedCategory: "nexus",
  tribe: "依神",
  colors: ["blue"],
  cost: 0,
  reductionSymbols: [],
  symbolColors: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  textLines: [],
  keywordTags: [],
};
const magic: CardDefinition = {
  ...nexus,
  cardNo: "TEST-BLUE-STACK-MAGIC",
  name: "青スタック",
  printedCategory: "magic",
  tribe: "非対象",
  cost: 2,
  levelDefs: [],
  textLines: ["スタック", "自分のカウント+1する。"],
  effects: [
    {
      timing: { kind: "activated", mode: "stack" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
      textRef: [0, 1],
    },
  ],
};
const miss: CardDefinition = {
  ...nexus,
  cardNo: "TEST-NON-DEPENDENT",
  tribe: "非対象",
};
const normalMagic: CardDefinition = {
  ...magic,
  cardNo: "TEST-NORMAL-MAGIC",
  textLines: ["メイン", "自分のカウント+1する。"],
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
      textRef: [0, 1],
    },
  ],
};
const definitions = [source, nexus, magic, miss, normalMagic];
const lookup = (id: string) => definitions.find((card) => card.cardNo === id);
const magicLookup = buildMagicLookup(definitions);
const fieldLookup = buildFieldCardEffectLookup(definitions);
function make(
  definition: CardDefinition,
  id: string,
  zone: "field" | "deck" | "hand",
  owner = "alice",
  cores = 0
) {
  return createCardInstance(definition, {
    instanceId: id,
    ownerPlayerId: owner,
    controllerPlayerId: owner,
    zone,
    normalCoreCount: cores,
  });
}
function fixture(target = nexus, owner = "alice") {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      make(source, "source", "field"),
      make(target, "target", "field", owner),
    ],
    playerOverrides: [{ voidNormalCoreCount: 20 }, { voidNormalCoreCount: 20 }],
  });
}
function actions(
  state: GameState,
  player = state.stackWindow?.priorityPlayerId ?? "alice"
) {
  return getLegalActions({
    state,
    actingPlayerId: player,
    getCardDefinitionById: lookup,
    getRegisteredMagicActions: magicLookup,
    getRegisteredFieldCardEffectActions: fieldLookup,
    getRegisteredTriggeredEffectActions: () => [],
  });
}
function apply(
  state: GameState,
  action: ReturnType<typeof actions>[number],
  extra: Partial<Parameters<typeof applyLegalAction>[0]> = {}
) {
  return applyLegalAction({
    state,
    action,
    getCardDefinitionById: lookup,
    getRegisteredMagicActions: magicLookup,
    getRegisteredFieldCardEffectActions: fieldLookup,
    getRegisteredTriggeredEffectActions: () => [],
    ...extra,
  }).state;
}
function close(state: GameState) {
  let current = state;
  for (let i = 0; current.stackWindow && i < 12; i++) {
    const pass = actions(current).find(
      (action) => action.kind === "pass_stack"
    );
    expect(pass).toBeDefined();
    current = apply(current, pass!);
  }
  expect(current.stackWindow).toBeNull();
  return current;
}
function resolve(
  state: GameState,
  kind: "oracle" | "placement_oracle" | "magic_stack_domain",
  accept = true
) {
  const pending = state.pendingTriggeredEffects.find(
    (entry) => entry.mechanic?.kind === kind
  )!;
  expect(pending).toBeDefined();
  const select = actions(state, state.activePlayerId).find(
    (entry) =>
      entry.kind === "select_pending_to_resolve" &&
      entry.pendingId === pending.pendingId
  );
  if (select) state = apply(state, select);
  const action = actions(state).find(
    (entry) =>
      entry.kind === "resolve_pending_triggered_effect" &&
      entry.pendingId === pending.pendingId
  )!;
  expect(action).toBeDefined();
  if (kind === "magic_stack_domain")
    expect(action).toMatchObject({ executionMode: "mandatory" });
  const declared = apply(state, action, { skipOptionalEffect: !accept });
  expect(
    declared.cardInstances.find((card) => card.instanceId === "source")
      ?.normalCoreCount
  ).toBe(
    state.cardInstances.find((card) => card.instanceId === "source")
      ?.normalCoreCount
  );
  if (accept || kind === "magic_stack_domain")
    expect(declared.stackWindow).not.toBeNull();
  return close(declared);
}

describe("BSTH10.5-X01 印字神託と導域", () => {
  it("BSTH10.5-X01 printed_oracle: 依神配置とスタックマジック使用を受諾/辞退し非印字イベントは不発", () => {
    for (const [target, event] of [
      [nexus, "place"],
      [magic, "use_magic"],
    ] as const) {
      for (const accept of [true, false]) {
        const state = fixture(target);
        const queued = checkAndQueueOracleChoices(
          state,
          "target",
          event,
          lookup,
          "test:x01:printed",
          { magicTiming: "stack" }
        );
        const after = resolve(queued, "oracle", accept);
        expect(after.pendingTriggeredEffects).toHaveLength(0);
        expect(
          after.cardInstances.find((card) => card.instanceId === "source")
            ?.normalCoreCount
        ).toBe(accept ? 1 : 0);
        expect(after.players[0]!.voidNormalCoreCount).toBe(accept ? 19 : 20);
        for (const wrong of [
          "summon",
          "advent",
          "use_accel",
        ] as OracleTriggerKind[]) {
          expect(
            checkAndQueueOracleChoices(
              state,
              "target",
              wrong,
              lookup,
              "test:x01:wrong",
              { magicTiming: "stack" }
            ).pendingTriggeredEffects
          ).toHaveLength(0);
        }
      }
    }
    for (const target of [miss, normalMagic]) {
      const state = fixture(target);
      expect(
        checkAndQueueOracleChoices(
          state,
          "target",
          target === miss ? "place" : "use_magic",
          lookup,
          "test:x01:nonmatch",
          { magicTiming: "stack" }
        ).pendingTriggeredEffects
      ).toHaveLength(0);
    }
    expect(
      checkAndQueueOracleChoices(
        fixture(magic),
        "target",
        "use_magic",
        lookup,
        "test:x01:main",
        { magicTiming: "main" }
      ).pendingTriggeredEffects
    ).toHaveLength(0);
    expect(
      checkAndQueueOracleChoices(
        fixture(nexus, "bob"),
        "target",
        "place",
        lookup,
        "test:x01:opponent"
      ).pendingTriggeredEffects
    ).toHaveLength(0);
  });

  it("BSTH10.5-X01 printed_placement_oracle: 上3枚の対象2枚を数え直接トラッシュに置き同名不在条件を守る", () => {
    const base = fixture();
    const state = {
      ...base,
      cardInstances: [
        base.cardInstances[0]!,
        make(nexus, "hit-nexus", "deck"),
        make(magic, "hit-magic", "deck"),
        make(normalMagic, "miss", "deck"),
        make(magic, "fourth", "deck"),
      ],
      players: base.players.map((p) =>
        p.id === "alice" ? { ...p, deckCount: 4 } : p
      ),
    };
    for (const accept of [true, false]) {
      const queued = checkAndQueuePlacementOracle(
        state,
        "source",
        lookup,
        "test:x01:placement"
      );
      const after = resolve(queued, "placement_oracle", accept);
      expect(after.pendingTriggeredEffects).toHaveLength(0);
      expect(
        after.cardInstances.find((card) => card.instanceId === "source")
          ?.normalCoreCount
      ).toBe(accept ? 2 : 0);
      expect(after.players[0]!.voidNormalCoreCount).toBe(accept ? 18 : 20);
      expect(after.players[0]!.deckCount).toBe(accept ? 1 : 4);
      for (const id of ["hit-nexus", "hit-magic", "miss"])
        expect(
          after.cardInstances.find((card) => card.instanceId === id)?.zone
        ).toBe(accept ? "trash" : "deck");
      expect(
        after.cardInstances.find((card) => card.instanceId === "fourth")?.zone
      ).toBe("deck");
    }
    for (const owner of ["alice", "bob"]) {
      const duplicate = {
        ...state,
        cardInstances: [
          ...state.cardInstances,
          make(source, "duplicate", "field", owner),
        ],
      };
      const queued = checkAndQueuePlacementOracle(
        duplicate,
        "source",
        lookup,
        "test:x01:name"
      );
      if (owner === "alice")
        expect(queued.pendingTriggeredEffects).toHaveLength(0);
      else
        expect(resolve(queued, "placement_oracle").players[0]!.deckCount).toBe(
          1
        );
    }
  });

  it("BSTH10.5-X01 printed_blue_magic_domain: Lv1/Lv2のボイド支払いとLv2のスタック完走後4枚破棄・コア増加を確認", () => {
    for (const cores of [2, 5]) {
      const base = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          make(source, "source", "field", "alice", cores),
          make(magic, "magic", "hand"),
          make(normalMagic, "bob-magic", "hand", "bob"),
          ...Array.from({ length: 5 }, (_, i) =>
            make(miss, `bob-deck-${i}`, "deck", "bob")
          ),
        ],
        playerOverrides: [
          { voidNormalCoreCount: 20 },
          { voidNormalCoreCount: 20, reserveNormalCoreCount: 2, deckCount: 5 },
        ],
      });
      const state: GameState = { ...base, activePlayerId: "bob", step: "main" };
      const payment = getAvailableMagicPaymentSources({
        state,
        actingPlayerId: "alice",
        magicInstanceId: "magic",
        getCardDefinitionById: lookup,
      });
      expect(payment.onBoardCoreSources).toContainEqual(
        expect.objectContaining({
          instanceId: "source",
          destination: "void",
          availableCoreAmount: cores,
        })
      );
      const bobUse = actions(state, "bob").find(
        (a) => a.kind === "use_magic" && a.sourceInstanceId === "bob-magic"
      )!;
      expect(bobUse).toBeDefined();
      const open = apply(state, bobUse, {
        paymentSources: [{ kind: "reserve", amount: 2 }],
      });
      expect(open.stackWindow?.priorityPlayerId).toBe("alice");
      const stackUse = actions(open).find(
        (a) =>
          a.kind === "use_magic" &&
          a.sourceInstanceId === "magic" &&
          a.timing === "stack"
      )!;
      expect(stackUse).toBeDefined();
      const declared = apply(open, stackUse, {
        paymentSources: [
          {
            kind: "card",
            instanceId: "source",
            amount: 2,
            destination: "void",
          },
        ],
      });
      const afterMagic = close(declared);
      expect(
        afterMagic.cardInstances.find((c) => c.instanceId === "magic")?.zone
      ).toBe("trash");
      expect(afterMagic.players[0]!.countValue).toBe(1);
      expect(
        afterMagic.cardInstances.find((c) => c.instanceId === "source")
          ?.normalCoreCount
      ).toBe(cores - 2);
      expect(afterMagic.players[0]!.voidNormalCoreCount).toBe(21); // payment +2, count +1 consumes 1
      expect(afterMagic.players[1]!.deckCount).toBe(5);
      const domain = afterMagic.pendingTriggeredEffects.find(
        (p) => p.mechanic?.kind === "magic_stack_domain"
      );
      expect(Boolean(domain)).toBe(cores === 5);
      // 神託の使用時誘発を先に完走し、残る発揮後導域を解決する。
      // 親のBobマジックは両方の内側誘発が完了してから再開する。
      let final = resolve(afterMagic, "oracle");
      if (domain) {
        final = resolve(final, "magic_stack_domain", false);
        expect(final.players[1]!.deckCount).toBe(1);
        expect(
          final.cardInstances.filter(
            (c) =>
              c.ownerPlayerId === "bob" &&
              c.instanceId.startsWith("bob-deck-") &&
              c.zone === "trash"
          )
        ).toHaveLength(4);
        expect(
          final.cardInstances.find((c) => c.instanceId === "bob-deck-4")?.zone
        ).toBe("deck");
        expect(
          final.cardInstances.find((c) => c.instanceId === "source")
            ?.normalCoreCount
        ).toBe(5);
        expect(final.players[0]!.voidNormalCoreCount).toBe(19);
      }
      expect(final.pendingTriggeredEffects).toHaveLength(0);
      expect(
        final.cardInstances.find((c) => c.instanceId === "source")
          ?.normalCoreCount
      ).toBe(cores === 5 ? 5 : 1);
      expect(final.players[0]!.voidNormalCoreCount).toBe(cores === 5 ? 19 : 20);
      expect(final.players[1]!.deckCount).toBe(cores === 5 ? 1 : 5);
      expect(
        final.cardInstances.find((c) => c.instanceId === "bob-magic")?.zone
      ).toBe("trash");
    }
    const redMagic = { ...magic, colors: ["red"] } as CardDefinition;
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        make(source, "source", "field", "alice", 3),
        make(redMagic, "red", "hand"),
      ],
    });
    const redPayment = getAvailableMagicPaymentSources({
      state: base,
      actingPlayerId: "alice",
      magicInstanceId: "red",
      getCardDefinitionById: (id) =>
        id === magic.cardNo ? redMagic : lookup(id),
    });
    expect(redPayment.onBoardCoreSources).not.toContainEqual(
      expect.objectContaining({ instanceId: "source", destination: "void" })
    );
  });
});
