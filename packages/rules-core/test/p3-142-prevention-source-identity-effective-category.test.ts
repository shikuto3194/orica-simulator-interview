/**
 * P3-142: 防止元 identity の実効カテゴリが合体中ブレイヴ／転神中創界神を反映するか。
 *
 * `EffectSourceIdentity.categories`（複数値化, target-affect-gate.ts）を
 * `getEffectiveCategories()`（mechanics/act-as-spirit.ts）が合成し、
 * BSTH06-転醒X01(B)『転醒時』全体破壊の `notPreventableByCategories:["spirit","ultimate"]`
 * 経由で end-to-end に検証する（prevention-restriction-scope.test.ts と同型パターン）。
 *
 * done-definition（issues/P3-142）: 「合体中ブレイヴの効果は spirit/ultimate として照合される」
 * 「非合体かつ非スピリット状態のブレイヴは brave として照合される」の両方を assert する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import { getEffectiveCategories } from "../src/mechanics/act-as-spirit";
import type { CardDefinition, ContinuousEffect, GameState } from "../src/model";

const expanded = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const cardNoMap = new Map<string, CardDefinition>(
  expanded.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

/** 対象が「実際に離脱する」かを判定する（pendingLeave 経由を含む）。 */
function isLeaving(result: GameState, id: string): boolean {
  const c = result.cardInstances.find((x) => x.instanceId === id);
  const leftField = !c || c.zone !== "field";
  const realLeave = result.pendingLeaveEntities.some(
    (e) => e.instanceId === id && !e.blockedByResistance
  );
  return leftField || realLeave;
}

const braveDef = card("BSAZ01-C18"); // アナリティカルエンジン (printedCategory: "brave")
const hostSpiritDef = card("BSTH06-C01"); // 相手スピリット (対象になり得る破壊先)

describe("P3-142: getEffectiveCategories — 合体状態/スピリット状態の実効カテゴリ合成", () => {
  it("合体中のブレイヴはホスト側(spirit)のカテゴリも持つ", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const host = createCardInstance(hostSpiritDef, {
      instanceId: "host-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      attachedChildrenIds: ["brave-1"],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "brave-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      attachedToInstanceId: "host-1",
    });
    const state: GameState = {
      ...base,
      cardInstances: [host, brave],
    };
    const categories = getEffectiveCategories(
      state,
      brave,
      braveDef,
      getCardDefinitionById
    );
    expect(categories).toContain("spirit");
    expect(categories).toContain("brave");
  });

  it("非合体かつ非スピリット状態(アンダーカード)のブレイヴは brave のみ", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const host = createCardInstance(hostSpiritDef, {
      instanceId: "host-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "brave-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      attachedToInstanceId: "host-1",
    });
    const state: GameState = {
      ...base,
      cardInstances: [
        {
          ...host,
          underCards: [{ cardInstanceId: "brave-1", role: "text_role" }],
        },
        brave,
      ],
    };
    const categories = getEffectiveCategories(
      state,
      brave,
      braveDef,
      getCardDefinitionById
    );
    expect(categories).toEqual(["brave"]);
  });

  it("フィールドで単独のブレイヴ(スピリット状態)は spirit も持つ", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const brave = createCardInstance(braveDef, {
      instanceId: "brave-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const state: GameState = { ...base, cardInstances: [brave] };
    const categories = getEffectiveCategories(
      state,
      brave,
      braveDef,
      getCardDefinitionById
    );
    expect(categories).toContain("spirit");
    expect(categories).toContain("brave");
  });

  it("転神中のネクサスは自身のカテゴリに加え spirit も持つ (二重状態)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const nexusDef = card("BSTH06-X01");
    const nexus = {
      ...createCardInstance(nexusDef, {
        instanceId: "nexus-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
      }),
      divineTransformState: {
        bpByLevel: [{ level: 1, bp: 3000 }],
        protectedFromNonGrandwalker: false,
      },
    };
    const state: GameState = { ...base, cardInstances: [nexus] };
    const categories = getEffectiveCategories(
      state,
      nexus,
      nexusDef,
      getCardDefinitionById
    );
    expect(categories).toContain("spirit");
    expect(categories).toContain("nexus");
  });
});

describe("P3-142: BSTH06-転醒X01(B)『転醒時』全体破壊 — 合体中ブレイヴ発生源の耐性は貫通/非貫通が切り替わる", () => {
  const def = card("BSTH06-転醒X01(B)");
  const rebirthEffectIndex = 0;

  function cannotBeDestroyedFromBrave(): ContinuousEffect {
    return {
      effectId: "test-cannot_be_destroyed-host-1",
      sourceInstanceId: "brave-1",
      sourceDefinitionId: braveDef.cardNo,
      actingPlayerId: "bob",
      duration: { scope: "permanent" },
      createdAtTurn: 0,
      createdAtAttackId: null,
      modifierTag: "cannot_be_destroyed",
      targetInstanceId: "host-1",
      metadata: { source: "opponent_effect" },
    };
  }

  function makeState(combined: boolean): GameState {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(def, {
      instanceId: "utsuho-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
    });
    const host = createCardInstance(hostSpiritDef, {
      instanceId: "host-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: combined ? ["brave-1"] : [],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "brave-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      attachedToInstanceId: "host-1",
    });
    return {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        self,
        {
          ...host,
          underCards: combined
            ? []
            : [{ cardInstanceId: "brave-1", role: "text_role" }],
        },
        brave,
      ],
      activeContinuousEffects: [cannotBeDestroyedFromBrave()],
    };
  }

  it("合体中ブレイヴ発生源の cannot_be_destroyed は spirit/ultimate 扱いで貫通し破壊される", () => {
    const result = executeEffect({
      chainId: "test:p3-142-prevention-source-identity-effective-category:220",
      state: makeState(true),
      effect: def.effects![rebirthEffectIndex]!,
      sourceInstanceId: "utsuho-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(isLeaving(result, "host-1")).toBe(true);
  });

  it("非合体かつ非スピリット状態(アンダーカード)のブレイヴ発生源の cannot_be_destroyed は brave 扱いで阻まれ残存する", () => {
    const result = executeEffect({
      chainId: "test:p3-142-prevention-source-identity-effective-category:231",
      state: makeState(false),
      effect: def.effects![rebirthEffectIndex]!,
      sourceInstanceId: "utsuho-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(isLeaving(result, "host-1")).toBe(false);
  });
});
