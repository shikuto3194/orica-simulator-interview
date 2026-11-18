/**
 * P3-99 grant_effect プリミティブ — 登録 / lifecycle の foundation テスト。
 *
 * 本イテレーションのスコープ: ContinuousEffect (modifierTag:"granted_effect") の
 * **登録**と、act_as_spirit と同じ while_on_field lifecycle (発揮元離脱で即消滅) の
 * 再利用を検証する。被付与カードのイベントで grantedEffect を発火させる「注入点」
 * (P3-99 §3) は別イテレーションで配線するため、ここでは扱わない。
 */
import { describe, it, expect } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { recomputeContinuousEffects } from "../src/legal/legal-actions-shared";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type { Effect } from "../src/dsl-types";
import type { CardDefinition, GameState } from "../src/model";

const ALICE = "player-1";
const BOB = "player-2";

function spiritDef(cardNo: string, name: string): CardDefinition {
  return {
    cardNo,
    name,
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 4,
    cost: 4,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
    textLines: [],
    images: {},
    tribe: "サイヤ人",
    colors: ["red"],
  } as CardDefinition;
}

// grant 源は別系統 (サイヤ人でない) にして、被付与フィルタ tribes:["サイヤ人"] に
// 自身が一致しないようにする (自己付与を含めないことで CE 数を明確に保つ)。
const SOURCE_DEF = {
  ...spiritDef("GRANT-SOURCE", "グラント源"),
  tribe: "魔人",
} as CardDefinition;
const TARGET_DEF = spiritDef("GRANT-TARGET", "ベジータ");

/** grant 源 1 体 + サイヤ人スピリット 2 体を場に並べた state。 */
function makeState(opts?: { sourceZone?: "field" | "trash" }): {
  state: GameState;
  getDef: (id: string) => CardDefinition | undefined;
} {
  const source = createCardInstance(SOURCE_DEF, {
    instanceId: "source-1",
    ownerPlayerId: ALICE,
    zone: opts?.sourceZone ?? "field",
    normalCoreCount: 1,
  });
  const targets = [0, 1].map((i) =>
    createCardInstance(TARGET_DEF, {
      instanceId: `target-${i}`,
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    })
  );
  const base = createEmptyGameState({ playerIds: [ALICE, BOB] });
  const defs: Record<string, CardDefinition> = {
    "GRANT-SOURCE": SOURCE_DEF,
    "GRANT-TARGET": TARGET_DEF,
  };
  return {
    state: {
      ...base,
      activePlayerId: ALICE,
      cardInstances: [source, ...targets],
      activeContinuousEffects: [],
    },
    getDef: (id) => defs[id],
  };
}

/** 付与される入れ子効果 (アタック時にライフのコアをボイドへ — BSDB01-R03 想定の縮約版)。 */
const NESTED_GRANTED_EFFECT: Effect = {
  timing: { kind: "card_event", event: "attack" },
  steps: [
    {
      action: {
        kind: "core_move",
        from: { zone: "life", playerRef: "opponent" },
        to: { zone: "void" },
        amount: 1,
      },
    },
  ],
} as unknown as Effect;

function grantEffect(opts?: {
  duration?: { scope: "while_on_field" } | { scope: "turn" };
}): Effect {
  return {
    timing: { kind: "activated", mode: "flash" },
    steps: [
      {
        action: {
          kind: "grant_effect",
          target: {
            kind: "filter",
            player: "self",
            count: "all",
            filter: { category: ["spirit"], tribes: ["サイヤ人"] },
          },
          grantedEffect: NESTED_GRANTED_EFFECT,
          ...(opts?.duration ? { duration: opts.duration } : {}),
        },
      },
    ],
  } as unknown as Effect;
}

describe("P3-99 grant_effect: 登録", () => {
  it("解決した各 target に granted_effect CE を 1 件ずつ登録する", () => {
    const { state, getDef } = makeState();
    const next = executeEffect({
      chainId: "test:grant-effect-foundation:121",
      state,
      effect: grantEffect(),
      sourceInstanceId: "source-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const ces = next.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "granted_effect"
    );
    expect(ces).toHaveLength(2);

    const targetIds = ces.map((ce) => ce.targetInstanceId).sort();
    expect(targetIds).toEqual(["target-0", "target-1"]);

    for (const ce of ces) {
      // 発揮元 = grant 源
      expect(ce.sourceInstanceId).toBe("source-1");
      expect(ce.sourceDefinitionId).toBe("GRANT-SOURCE");
      // duration 既定は while_on_field (発揮元離脱で消滅)
      expect(ce.duration).toEqual({ scope: "while_on_field" });
      // metadata に grantedEffect + grantPlayerRef (既定 self)
      const meta = ce.metadata as {
        grantedEffect: Effect;
        grantPlayerRef: string;
      };
      expect(meta.grantPlayerRef).toBe("self");
      expect(meta.grantedEffect).toBe(NESTED_GRANTED_EFFECT);
      expect(meta.grantedEffect.timing).toEqual({
        kind: "card_event",
        event: "attack",
      });
    }
  });

  it("対象が 0 体なら CE を登録しない", () => {
    const { state, getDef } = makeState();
    // サイヤ人でないフィルタにして候補を 0 にする
    const effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "grant_effect",
            target: {
              kind: "filter",
              player: "self",
              count: "all",
              filter: { category: ["nexus"] },
            },
            grantedEffect: NESTED_GRANTED_EFFECT,
          },
        },
      ],
    } as unknown as Effect;
    const next = executeEffect({
      chainId: "test:grant-effect-foundation:177",
      state,
      effect,
      sourceInstanceId: "source-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    expect(
      next.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "granted_effect"
      )
    ).toHaveLength(0);
  });

  it("card_event grant_effect の dynamic targetFilter は hasBurstEffect を保持する", () => {
    const { state, getDef } = makeState();
    const effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "grant_effect",
            target: {
              kind: "filter",
              player: "self",
              count: "all",
              filter: { hasBurstEffect: true },
            },
            grantedEffect: NESTED_GRANTED_EFFECT,
            duration: { scope: "turn" },
          },
        },
      ],
    } as unknown as Effect;

    const next = executeEffect({
      chainId: "test:grant-effect-foundation:212",
      state,
      effect,
      sourceInstanceId: "source-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const ces = next.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "granted_effect"
    );
    expect(ces).toHaveLength(1);
    expect(ces[0]!.targetInstanceId).toBeUndefined();
    expect(ces[0]!.targetFilter).toMatchObject({
      player: "self",
      hasBurstEffect: true,
    });
  });

  it("duration:{scope:'turn'} を指定すると CE に反映される", () => {
    const { state, getDef } = makeState();
    const next = executeEffect({
      chainId: "test:grant-effect-foundation:233",
      state,
      effect: grantEffect({ duration: { scope: "turn" } }),
      sourceInstanceId: "source-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const ces = next.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "granted_effect"
    );
    expect(ces).toHaveLength(2);
    for (const ce of ces) {
      expect(ce.duration).toEqual({ scope: "turn" });
    }
  });
});

describe("P3-99 grant_effect: lifecycle (while_on_field)", () => {
  it("発揮元が場に残る間は CE 残存", () => {
    const { state, getDef } = makeState();
    const registered = executeEffect({
      chainId: "test:grant-effect-foundation:253",
      state,
      effect: grantEffect(),
      sourceInstanceId: "source-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const next = recomputeContinuousEffects(registered);
    expect(
      next.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "granted_effect"
      )
    ).toHaveLength(2);
  });

  it("発揮元 (source) がフィールドを離れると付与 CE は即消滅する (04 一般化)", () => {
    const { state, getDef } = makeState();
    const registered = executeEffect({
      chainId: "test:grant-effect-foundation:270",
      state,
      effect: grantEffect(),
      sourceInstanceId: "source-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    // 発揮元を trash へ (= フィールド離脱)
    const afterLeave: GameState = {
      ...registered,
      cardInstances: registered.cardInstances.map((c) =>
        c.instanceId === "source-1" ? { ...c, zone: "trash" } : c
      ),
    };
    const next = recomputeContinuousEffects(afterLeave);
    expect(
      next.activeContinuousEffects.filter(
        (ce) => ce.modifierTag === "granted_effect"
      )
    ).toHaveLength(0);
  });

  it("被付与カード (target) がフィールドを離れるとその CE は消滅する", () => {
    const { state, getDef } = makeState();
    const registered = executeEffect({
      chainId: "test:grant-effect-foundation:294",
      state,
      effect: grantEffect(),
      sourceInstanceId: "source-1",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    const afterLeave: GameState = {
      ...registered,
      cardInstances: registered.cardInstances.map((c) =>
        c.instanceId === "target-0" ? { ...c, zone: "trash" } : c
      ),
    };
    const next = recomputeContinuousEffects(afterLeave);
    const remaining = next.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "granted_effect"
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.targetInstanceId).toBe("target-1");
  });
});
