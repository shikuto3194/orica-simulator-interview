import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardInstance, GameState, LegalAction } from "../src";
import { getHostGrantedAdventChoiceOptions } from "../src/mechanics/host-dual-advent";
import { getContractCombineAsIfSoulCoreChoiceOptions } from "../src/mechanics/contract-combine-system";
import { adventFlashPosition } from "./advent-flash-position";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const getCardDefinitionById = (id: string) => definitions.get(id);
const lookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredBattleImmediateEffectActions: () => [],
};
function instance(
  cardNo: string,
  instanceId: string,
  zone: CardInstance["zone"],
  cores = 0
) {
  return createCardInstance(definitions.get(cardNo)!, {
    instanceId,
    ownerPlayerId: "alice",
    zone,
    normalCoreCount: cores,
  });
}
function actions(state: GameState, actingPlayerId = "alice") {
  return getLegalActions({ state, actingPlayerId, ...lookups });
}
function act(
  state: GameState,
  action: LegalAction,
  targetInstanceIds?: string[]
) {
  return applyLegalAction({
    state,
    action,
    ...lookups,
    ...(targetInstanceIds ? { targetInstanceIds } : {}),
  }).state;
}
function passWindow(state: GameState) {
  let current = state;
  for (let i = 0; current.stackWindow && i < 10; i++) {
    const pass = actions(current, current.stackWindow.priorityPlayerId).find(
      (action) => action.kind === "pass_stack"
    );
    expect(pass).toBeDefined();
    current = act(current, pass!);
  }
  expect(current.stackWindow).toBeNull();
  if (current.activeAttack?.flashWindowState?.pendingStackAction) {
    const pass = actions(
      current,
      current.activeAttack.flashWindowState.priorityPlayerId
    ).find((action) => action.kind === "pass_battle_flash")!;
    current = act(current, pass);
  }
  return current;
}
function resolveTarget(state: GameState, targetId: string, owner = "alice") {
  const resolve = actions(state, owner).find(
    (action) => action.kind === "resolve_pending_effect_target"
  );
  expect(resolve).toBeDefined();
  return act(state, resolve!, [targetId]);
}
function base(cardInstances: CardInstance[]): GameState {
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances,
      playerOverrides: [
        {
          handCount: 1,
          soulCoreLocation: { kind: "trash" },
          reserveNormalCoreCount: 0,
        },
        {},
      ],
    }),
    step: "main",
    activePlayerId: "alice",
  };
  return cardInstances.some(
    (card) =>
      card.zone === "hand" &&
      definitions.get(card.definitionId)?.adventData?.adventTiming ===
        "both_attack_step"
  )
    ? adventFlashPosition(state)
    : state;
}

const hostCases = [
  ["BSDB01-CX01", "BSDB01-C02"],
  ["BSSG01-M01", "BSSG01-M03"],
  ["BSSG01-M02", "BSSG01-M04"],
] as const;
const proxyCases = [
  ["BSGE01-C09", "BSGE01-CX01", "BSGE01-C05"],
  ["BSGE01-C10", "BSGE01-CX03", "BSGE01-C05"],
  ["BSGE01-C11", "BSGE01-CX02", "BSGE01-C07"],
  ["BSGE01-C12", "BSGE01-CX04", "BSGE01-C07"],
  ["BSGE01-C13", "BSGE01-CX01", "BSGE01-C05"],
] as const;

describe("常時型『置いたものとして』全カード監査", () => {
  it("全11枚を常時10枚と誘発1枚に分類し、追加カードの監査漏れを検知する", () => {
    const cards = ALL_CARDS.filter((card) =>
      card.textLines.some((line) => /置いたもの/.test(line))
    );
    expect(cards.map((card) => card.cardNo).sort()).toEqual(
      [
        ...hostCases.map(([id]) => id),
        ...proxyCases.map(([id]) => id),
        "BSRK01-M01",
        "BSSL01-X01",
        "BSDB01-R01",
      ].sort()
    );
    for (const [id] of hostCases)
      expect(definitions.get(id)?.hostDualAdventGrant).toBeDefined();
    for (const [id] of proxyCases)
      expect(definitions.get(id)?.contractCombineProxyData).toBeDefined();
    for (const id of ["BSRK01-M01", "BSSL01-X01"])
      expect(
        definitions.get(id)?.adventData?.alternateCostAdvent
      ).toBeDefined();
    const triggered = definitions.get("BSDB01-R01")!;
    expect(triggered.hostDualAdventGrant).toBeUndefined();
    expect(triggered.adventData?.alternateCostAdvent).toBeUndefined();
    expect(
      triggered.effects?.find((effect) => effect.textRef?.includes(4))?.timing
        .kind
    ).toBe("card_event");
  });

  it("提供スナップショット: ベジータは手札宣言1つからソウルコアを維持して煌臨する", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("./fixtures/buddy-soul-only-2026-09-13.json", import.meta.url),
        "utf8"
      )
    );
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      ...fixture,
    };
    const legal = actions(state, "bob");
    // 02:23:39 の再提供snapshotもこのfixtureと同一盤面。メイン・カウント1のX02は対象外。
    expect(
      state.cardInstances.find((card) => card.instanceId === "card-43")
        ?.definitionId
    ).toBe("BSDB01-X02");
    expect(
      legal.some(
        (action) =>
          action.kind === "declare_advent" &&
          action.sourceInstanceId === "card-43"
      )
    ).toBe(false);
    expect(
      legal.some((action) => action.kind === "declare_host_dual_advent")
    ).toBe(false);
    const declarations = legal.filter(
      (action) =>
        action.kind === "declare_advent" &&
        action.sourceInstanceId === "card-42"
    );
    expect(declarations).toHaveLength(1);
    const declared = act(state, declarations[0]!);
    expect(declared.pendingAsIfSoulCoreChoice).toBeNull();
    expect(declared.usedAlternateCostAdventKeysThisTurn).toEqual([]);
    const ready = passWindow(declared);
    expect(ready.pendingEffectTargetSelection).toMatchObject({
      sourceInstanceId: "card-42",
      candidateInstanceIds: ["card-65"],
    });
    const resolved = resolveTarget(ready, "card-65", "bob");
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "card-42")
    ).toMatchObject({
      zone: "field",
      soulCoreCount: 1,
      normalCoreCount: 0,
      underCards: [{ role: "advent_source", cardInstanceId: "card-65" }],
    });
    expect(
      resolved.players.find((player) => player.id === "bob")?.trashSoulCoreCount
    ).toBe(0);
    expect(resolved.usedAlternateCostAdventKeysThisTurn).toEqual([
      "name:孫悟空＆ベジータ",
    ]);
  });

  it.each(hostCases)(
    "%s の許可はホストの発揮宣言を作らず、%s の手札宣言から解決する",
    (hostNo, handNo) => {
      const state = base([
        instance(hostNo, "host", "field", 1),
        instance(handNo, "hand", "hand"),
      ]);
      const declarations = actions(state).filter(
        (action) => action.kind === "declare_advent"
      );
      expect(declarations).toHaveLength(1);
      expect(declarations[0]).toMatchObject({
        sourceInstanceId: "hand",
        candidateTargetInstanceIds: ["host"],
      });
      expect(
        actions(state).some(
          (action) => action.kind === "declare_host_dual_advent"
        )
      ).toBe(false);
      const ready = passWindow(act(state, declarations[0]!));
      expect(ready.pendingAsIfSoulCoreChoice).toBeNull();
      expect(ready.pendingEffectTargetSelection?.deferredStack).toMatchObject({
        cardInstanceId: "hand",
        sourceActivationZone: "hand",
        adventGrantSourceInstanceId: "host",
      });
      const resolved = resolveTarget(ready, "host");
      expect(
        resolved.cardInstances.find((card) => card.instanceId === "hand")
      ).toMatchObject({
        zone: "field",
        normalCoreCount: 1,
        underCards: [{ role: "advent_source", cardInstanceId: "host" }],
      });
      expect(resolved.players[0]?.soulCoreLocation).toEqual({ kind: "trash" });
      expect(resolved.usedAlternateCostAdventKeysThisTurn).toEqual(
        hostNo === "BSDB01-CX01" ? ["name:孫悟空＆ベジータ"] : []
      );
    }
  );

  it.each(hostCases)(
    "%s の許可が窓中に失われたら不発となり、回数を消費しない",
    (hostNo, handNo) => {
      const state = base([
        instance(hostNo, "host", "field", 1),
        instance(handNo, "hand", "hand"),
      ]);
      const declaration = actions(state).find(
        (action) => action.kind === "declare_advent"
      )!;
      const declared = act(state, declaration);
      const changed = {
        ...declared,
        cardInstances: declared.cardInstances.map((card) =>
          card.instanceId === "host"
            ? { ...card, zone: "trash" as const }
            : card
        ),
      };
      const result = passWindow(changed);
      expect(result.pendingEffectTargetSelection).toBeNull();
      expect(
        result.cardInstances.find((card) => card.instanceId === "hand")?.zone
      ).toBe("hand");
      expect(result.usedAlternateCostAdventKeysThisTurn).toEqual([]);
    }
  );

  it.each(hostCases.slice(1))(
    "%s は煌臨元になった後に通常Lvの常時許可を提供しない",
    (hostNo, handNo) => {
      const state = base([
        instance(hostNo, "host", "field", 1),
        instance(handNo, "hand", "hand"),
        {
          ...instance("BSDB01-C05", "top", "field", 1),
          underCards: [{ role: "advent_source", cardInstanceId: "host" }],
        },
      ]);
      expect(
        getHostGrantedAdventChoiceOptions(
          state,
          "hand",
          "alice",
          getCardDefinitionById
        )
      ).toEqual([]);
    }
  );

  it("通常支払いと常時擬制が両立しても宣言1つ・支払い選択2つで、選択は窓後", () => {
    const state = base([
      instance("BSDB01-CX01", "host", "field", 1),
      instance("BSDB01-C02", "hand", "hand"),
    ]);
    state.players[0] = {
      ...state.players[0]!,
      soulCoreLocation: { kind: "reserve" },
      reserveSoulCoreCount: 1,
      trashSoulCoreCount: 0,
    };
    const declarations = actions(state).filter(
      (action) => action.kind === "declare_advent"
    );
    expect(declarations).toHaveLength(1);
    const declared = act(state, declarations[0]!);
    expect(declared.pendingAsIfSoulCoreChoice).toBeNull();
    const ready = passWindow(declared);
    expect(ready.pendingAsIfSoulCoreChoice?.sourceInstanceId).toBe("hand");
    expect(
      ready.pendingAsIfSoulCoreChoice?.options
        .map((option) => option.useAlternateCost)
        .sort()
    ).toEqual([false, true]);
    expect(ready.pendingEffectTargetSelection).toBeNull();
  });

  it("常時許可で煌臨カード自身のアタックステップ指定をメインへ拡張しない", () => {
    const state = base([
      instance("BSDB01-CX01", "host", "field", 1),
      instance("BSDB01-C03", "hand", "hand"),
    ]);
    state.step = "main";
    state.window = "none";
    state.activeAttack = null;
    expect(
      actions(state).some((action) => action.kind === "declare_advent")
    ).toBe(false);
  });

  it.each(proxyCases)(
    "%s の常時許可は %s への %s の手札契約合体だけを許可する",
    (proxyNo, targetNo, braveNo) => {
      const state = base([
        instance(proxyNo, "proxy", "field", 1),
        instance(targetNo, "host", "field", 1),
        instance(braveNo, "hand", "hand"),
      ]);
      const declaration = actions(state).find(
        (action) => action.kind === "contract_combine"
      );
      expect(declaration).toMatchObject({
        braveInstanceId: "hand",
        candidateTargetInstanceIds: ["host"],
      });
      const declared = act(state, declaration!);
      expect(declared.pendingAsIfSoulCoreChoice).toBeNull();
      const ready = passWindow(declared);
      expect(ready.pendingEffectTargetSelection?.deferredStack).toMatchObject({
        cardInstanceId: "hand",
        sourceActivationZone: "hand",
        contractCombineProxySourceInstanceId: "proxy",
      });
      const resolved = resolveTarget(ready, "host");
      expect(
        resolved.cardInstances.find((card) => card.instanceId === "hand")
      ).toMatchObject({ zone: "field", attachedToInstanceId: "host" });
      expect(resolved.players[0]?.soulCoreLocation).toEqual({ kind: "trash" });
      expect(
        getContractCombineAsIfSoulCoreChoiceOptions(
          {
            ...resolved,
            cardInstances: resolved.cardInstances.map((card) =>
              card.instanceId === "hand"
                ? { ...card, zone: "hand" as const }
                : card
            ),
          },
          ready.pendingEffectTargetSelection!.deferredStack,
          getCardDefinitionById
        )
      ).toEqual([]);
    }
  );
});
