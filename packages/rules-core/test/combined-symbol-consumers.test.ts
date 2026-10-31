import { describe, expect, it } from "vitest";
import {
  calculateReduction,
  evaluateCondition,
  getCombinedUnitSymbolBundles,
} from "../src";
import { combinedSymbolFixture } from "./helpers/combined-symbol-fixture";
import {
  createCardInstance,
  getEffectiveSymbolBundles,
  executeEffect,
} from "../src";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import {
  getEffectiveSymbolBundlesForEntity,
  recomputeBattleEntityBp,
} from "../src/battle/battle-shared";

describe("合体単位のシンボル参照", () => {
  it("旧バトル情報の同値再計算は不変で、多色化したときは物理個数を保存する", () => {
    const { state, host, brave, getDef, ce } = combinedSymbolFixture();
    state.battleEntities = [
      {
        entityId: "legacy-symbols",
        memberInstanceIds: [host.instanceId, brave.instanceId],
        resolvedBp: 10000,
        resolvedSymbols: ["red", "blue"],
        attackState: "idle",
      },
    ];
    expect(recomputeBattleEntityBp(state, getDef)).toBe(state);
    const colored = {
      ...state,
      activeContinuousEffects: [
        ce({
          modifierTag: "treat_as_symbol",
          modifierSymbol: ["white"],
        }),
      ],
    };
    const recomputed = recomputeBattleEntityBp(colored, getDef);
    expect(recomputed.battleEntities[0]!.resolvedSymbols).toHaveLength(4);
    expect(recomputed.battleEntities[0]!.resolvedSymbolCount).toBe(2);
    expect(recomputeBattleEntityBp(recomputed, getDef)).toBe(recomputed);
  });

  it.each(["text_role", "advent_source"] as const)(
    "%sの下カードは合体シンボルに数えない",
    (role) => {
      const { state, host, brave, hostDef, getDef } = combinedSymbolFixture();
      host.underCards = [
        role === "text_role"
          ? { cardInstanceId: brave.instanceId, role, roleTag: "test" }
          : { cardInstanceId: brave.instanceId, role },
      ];
      expect(
        getCombinedUnitSymbolBundles(state, host, hostDef, getDef)
      ).toEqual([{ colors: ["red"], count: 1 }]);
      expect(
        calculateReduction({
          state,
          actingPlayerId: "alice",
          card: { ...hostDef, cost: 2, reductionSymbols: ["blue"] },
          getCardDefinitionById: getDef,
        }).finalCost
      ).toBe(2);
    }
  );
  it.each([0, 1])(
    "継続全体コピーは後から参加した対象にも多色バンドルを適用する（初期対象=%s）",
    (initialCount) => {
      const { state, host, brave, hostDef, getDef, ce } =
        combinedSymbolFixture();
      const makeTarget = (id: string) =>
        createCardInstance(hostDef, {
          instanceId: id,
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        });
      if (initialCount) state.cardInstances.push(makeTarget("initial-copy"));
      state.activeContinuousEffects = [
        ce({
          targetInstanceId: brave.instanceId,
          modifierTag: "treat_as_symbol",
          modifierSymbol: ["white"],
        }),
      ];
      const expected = getCombinedUnitSymbolBundles(
        state,
        host,
        hostDef,
        getDef
      );
      const copied = executeEffect({
        chainId: "continuous-symbol-copy",
        state,
        sourceInstanceId: host.instanceId,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        effect: {
          timing: { kind: "continuous" },
          steps: [
            {
              action: {
                kind: "override_properties",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"] },
                  count: "all",
                },
                duration: { scope: "while_on_field" },
                properties: { symbols: { copy_from: { kind: "self" } } },
              },
            },
          ],
        },
      });
      const newcomer = makeTarget("late-copy");
      const after = {
        ...copied,
        cardInstances: [...copied.cardInstances, newcomer],
      };
      expect(
        getCombinedUnitSymbolBundles(after, newcomer, hostDef, getDef)
      ).toEqual(expected);
      expect(
        copied.activeContinuousEffects.find(
          (e) => e.modifierTag === "override_properties"
        )
      ).toMatchObject({
        targetFilter: { player: "opponent", category: ["spirit"] },
      });
    }
  );
  it.each(["spirit", "ultimate", "nexus"] as const)(
    "%s: 本体のシンボル色追加は合体・仮想合体・効果追加分にも反映する（Q3263）",
    (category) => {
      const { state, host, brave, hostDef, braveDef, getDef, ce } =
        combinedSymbolFixture(category);
      state.activeContinuousEffects = [
        ce({ modifierTag: "treat_as_symbol", modifierSymbol: ["white"] }),
        ce({
          effectId: "extra",
          modifierTag: "symbol_addition",
          modifierSymbol: ["purple"],
        }),
        ce({
          effectId: "virtual",
          metadata: {
            properties: { virtualAttachedBraves: [{ symbols: ["green"] }] },
          },
        }),
      ];
      const bundles = getCombinedUnitSymbolBundles(
        state,
        host,
        hostDef,
        getDef
      );
      expect(bundles.reduce((n, b) => n + b.count, 0)).toBe(4);
      expect(bundles.every((b) => b.colors.includes("white"))).toBe(true);
      expect(bundles).toContainEqual({ colors: ["white", "blue"], count: 1 });
      expect(getEffectiveSymbolBundles(state, brave, braveDef, getDef)).toEqual(
        [{ colors: ["blue"], count: 1 }]
      );
      expect(
        getEffectiveSymbolBundlesForEntity(
          state,
          {
            entityId: "colored-unit",
            memberInstanceIds: [host.instanceId, brave.instanceId],
            resolvedBp: 5000,
            resolvedSymbols: [],
            attackState: "idle",
          },
          new Map(state.cardInstances.map((c) => [c.instanceId, c])),
          getDef
        )
      ).toEqual(bundles);
      expect(
        calculateReduction({
          state,
          actingPlayerId: "alice",
          card: {
            ...hostDef,
            cost: 5,
            reductionSymbols: ["white", "white", "white", "white"],
          },
          getCardDefinitionById: getDef,
        }).finalCost
      ).toBe(1);
    }
  );
  it.each([false, true])(
    "copy_fromは合体先のシンボル全部を取得する（多色=%s）",
    (dualColor) => {
      const { state, host, brave, hostDef, getDef, ce } =
        combinedSymbolFixture();
      if (dualColor)
        state.activeContinuousEffects = [
          ce({
            targetInstanceId: brave.instanceId,
            modifierTag: "treat_as_symbol",
            modifierSymbol: ["white"],
          }),
        ];
      const copy = createCardInstance(hostDef, {
        instanceId: "copy",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      });
      const after = executeEffect({
        chainId: "combined-symbol-copy",
        state: { ...state, cardInstances: [...state.cardInstances, copy] },
        sourceInstanceId: copy.instanceId,
        actingPlayerId: "bob",
        getCardDefinitionById: getDef,
        effect: {
          timing: { kind: "card_event", event: "summon" },
          steps: [
            {
              action: {
                kind: "override_properties",
                target: { kind: "self" },
                duration: { scope: "turn" },
                properties: {
                  symbols: {
                    copy_from: {
                      kind: "filter",
                      player: "opponent",
                      filter: { category: ["spirit"] },
                      count: 1,
                    },
                  },
                },
              },
            },
          ],
        },
      });
      expect(
        getCombinedUnitSymbolBundles(after, copy, hostDef, getDef)
      ).toEqual(getCombinedUnitSymbolBundles(state, host, hostDef, getDef));
    }
  );

  it("分身は左右合体・仮想合体・多色1個・固定シンボルを本体と同じくコピーする", () => {
    const { state, host, brave, hostDef, getDef, ce } = combinedSymbolFixture();
    const token = createCardInstance(hostDef, {
      instanceId: "token",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
      faceDown: true,
    });
    const copied = {
      ...state,
      cardInstances: [
        { ...host, attachedChildrenIds: [] },
        {
          ...brave,
          attachedToInstanceId: null,
          imaginRightCombinedWith: host.instanceId,
        },
        token,
      ],
      activeContinuousEffects: [
        ce({
          effectId: "copy",
          targetInstanceId: token.instanceId,
          modifierTag: "act_as_spirit",
          metadata: {
            statBlueprint: {
              kind: "live_copy_from",
              sourceInstanceId: host.instanceId,
              aspects: ["symbolColors"],
            },
            overrides: {},
          },
        }),
        ce({
          effectId: "dual",
          targetInstanceId: brave.instanceId,
          modifierTag: "treat_as_symbol",
          modifierSymbol: ["white"],
        }),
        ce({
          effectId: "virtual",
          metadata: {
            properties: { virtualAttachedBraves: [{ symbols: ["green"] }] },
          },
        }),
      ],
    };
    expect(getEffectiveSymbolBundles(copied, token, hostDef, getDef)).toEqual(
      getCombinedUnitSymbolBundles(copied, host, hostDef, getDef)
    );
    expect(
      getEffectiveSymbolBundles(copied, token, hostDef, getDef).reduce(
        (n, b) => n + b.count,
        0
      )
    ).toBe(3);
    const fixed = {
      ...copied,
      activeContinuousEffects: [
        ...copied.activeContinuousEffects,
        ce({
          effectId: "fixed",
          metadata: { properties: { symbols: [], symbolCountFixed: true } },
        }),
      ],
    };
    expect(getEffectiveSymbolBundles(fixed, token, hostDef, getDef)).toEqual(
      []
    );
  });

  it("相手シンボル依存の耐性は仮想合体を含め、0固定で付与を失う", () => {
    const { state, hostDef, getDef, ce } = combinedSymbolFixture();
    const protectedCard = createCardInstance(hostDef, {
      instanceId: "protected",
      ownerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    const protectedState = {
      ...state,
      cardInstances: [...state.cardInstances, protectedCard],
      activeContinuousEffects: [
        ce({
          effectId: "immune",
          actingPlayerId: "bob",
          targetInstanceId: protectedCard.instanceId,
          modifierTag: "defense_immune",
          immunitySourceScope: { colorsFromOpponentFieldSymbols: true },
        }),
        ce({
          effectId: "virtual",
          metadata: {
            properties: { virtualAttachedBraves: [{ symbols: ["green"] }] },
          },
        }),
      ],
    };
    const immune = (current: typeof protectedState, color: "blue" | "green") =>
      isCardImmuneToOpponentEffect(
        current,
        protectedCard,
        "alice",
        "none",
        { definition: { ...hostDef, colors: [color] } },
        getDef
      );
    expect(immune(protectedState, "blue")).toBe(true);
    expect(immune(protectedState, "green")).toBe(true);
    const fixed = {
      ...protectedState,
      activeContinuousEffects: [
        ...protectedState.activeContinuousEffects,
        ce({
          effectId: "fixed",
          metadata: { properties: { symbols: [], symbolCountFixed: true } },
        }),
      ],
    };
    expect(immune(fixed, "blue")).toBe(false);
    expect(immune(fixed, "green")).toBe(false);
  });

  it("フィールドの色を得るシンボルも仮想合体・固定・魂状態に追従する", () => {
    const { state, host, hostDef, getDef, ce } = combinedSymbolFixture();
    const copyDef = { ...hostDef, cardNo: "FIELD-COPY", symbolColors: [] };
    const copy = createCardInstance(copyDef, {
      instanceId: "field-copy",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const lookup = (id: string) =>
      id === copyDef.cardNo ? copyDef : getDef(id);
    const copied = {
      ...state,
      cardInstances: [...state.cardInstances, copy],
      activeContinuousEffects: [
        ce({
          effectId: "field-copy",
          targetInstanceId: copy.instanceId,
          modifierTag: "symbol_addition",
          modifierSymbolSource: {
            kind: "field_colors_present" as const,
            playerId: "alice",
          },
        }),
        ce({
          effectId: "virtual",
          metadata: {
            properties: { virtualAttachedBraves: [{ symbols: ["green"] }] },
          },
        }),
      ],
    };
    expect(getEffectiveSymbolBundles(copied, copy, copyDef, lookup)).toEqual([
      { colors: ["red", "green", "blue"], count: 1 },
    ]);
    const fixed = {
      ...copied,
      activeContinuousEffects: [
        ...copied.activeContinuousEffects,
        ce({
          effectId: "fixed",
          metadata: { properties: { symbols: [], symbolCountFixed: true } },
        }),
      ],
    };
    expect(getEffectiveSymbolBundles(fixed, copy, copyDef, lookup)).toEqual([]);
    const soul = {
      ...copied,
      players: copied.players.map((p) =>
        p.id === "alice" ? { ...p, soulStateInstanceIds: [host.instanceId] } : p
      ),
    };
    expect(getEffectiveSymbolBundles(soul, copy, copyDef, lookup)).toEqual([]);
  });
  for (const category of ["spirit", "ultimate", "nexus"] as const) {
    it(`${category}: 合体先の種類を指定した存在/不在条件にブレイヴの色を含む`, () => {
      const { state, host, getDef } = combinedSymbolFixture(category);
      expect(
        evaluateCondition(
          state,
          [
            {
              kind: "field_has",
              player: "self",
              category: [category],
              symbolColors: ["blue"],
            },
          ],
          host.instanceId,
          "alice",
          getDef
        )
      ).toBe(true);
      expect(
        evaluateCondition(
          state,
          [
            {
              kind: "field_lacks",
              player: "self",
              category: [category],
              symbolColors: ["blue"],
            },
          ],
          host.instanceId,
          "alice",
          getDef
        )
      ).toBe(false);
    });

    it(`${category}: 古いバトルmemberを参照せず現在の合体から軽減する`, () => {
      const { state, host, hostDef, getDef } = combinedSymbolFixture(category);
      const stale = {
        ...state,
        battleEntities: [
          {
            entityId: "stale",
            memberInstanceIds: [host.instanceId],
            resolvedBp: 5000,
            resolvedSymbols: hostDef.symbolColors,
            attackState: "idle" as const,
          },
        ],
      };
      const result = calculateReduction({
        state: stale,
        actingPlayerId: "alice",
        card: { ...hostDef, cost: 3, reductionSymbols: ["blue"] },
        getCardDefinitionById: getDef,
      });
      expect(result.finalCost).toBe(2);
      expect(result.fieldSymbolSources).toHaveLength(1);
    });
  }

  it("色条件で合体ブレイヴを独立した2体目として数えない", () => {
    const { state, host, getDef } = combinedSymbolFixture();
    expect(
      evaluateCondition(
        state,
        [
          {
            kind: "field_has",
            player: "self",
            symbolColors: ["blue"],
            minCount: 2,
          },
        ],
        host.instanceId,
        "alice",
        getDef
      )
    ).toBe(false);
  });

  it("0シンボル固定中は合体子の色によって存在条件を満たさない", () => {
    const { state, host, getDef, ce } = combinedSymbolFixture();
    const fixed = {
      ...state,
      activeContinuousEffects: [
        ce({
          metadata: { properties: { symbols: [], symbolCountFixed: true } },
        }),
      ],
    };
    expect(
      evaluateCondition(
        fixed,
        [{ kind: "field_has", player: "self", symbolColors: ["blue"] }],
        host.instanceId,
        "alice",
        getDef
      )
    ).toBe(false);
    expect(
      evaluateCondition(
        fixed,
        [{ kind: "field_lacks", player: "self", symbolColors: ["blue"] }],
        host.instanceId,
        "alice",
        getDef
      )
    ).toBe(true);
  });

  it("異魔神が右合体のみになっても軽減に二重計上しない", () => {
    const { state, host, brave, hostDef, getDef } = combinedSymbolFixture();
    const rightOnly = {
      ...state,
      cardInstances: [
        { ...host, attachedChildrenIds: [] },
        {
          ...brave,
          attachedToInstanceId: null,
          imaginRightCombinedWith: host.instanceId,
        },
      ],
    };
    expect(
      getCombinedUnitSymbolBundles(rightOnly, host, hostDef, getDef)
    ).toEqual([
      { colors: ["red"], count: 1 },
      { colors: ["blue"], count: 1 },
    ]);
    const result = calculateReduction({
      state: rightOnly,
      actingPlayerId: "alice",
      card: { ...hostDef, cost: 3, reductionSymbols: ["blue", "blue"] },
      getCardDefinitionById: getDef,
    });
    expect(result.finalCost).toBe(2);
    expect(result.fieldSymbolSources).toHaveLength(1);
  });
});
