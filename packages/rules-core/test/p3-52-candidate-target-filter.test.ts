/**
 * P3-52 検証: getCandidateTargetInstanceIds が target.player / target.filter を反映する。
 *
 * - target.player === "opponent" → 相手プレイヤーのカードのみ候補
 * - target.filter (category / maxBp 等) → matchesCardFilter で 2 次絞り込み
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState } from "../src";
import type { ContinuousEffect, ContinuousEffectTag } from "../src/model";
import { createCardInstance, createEmptyGameState } from "../src/index";
import { getCandidateTargetInstanceIds } from "../src/legal/legal-actions-shared";
import { generateBattleImmediateEffectRegistrations } from "../src/effect/structured-effect-registrations";

function makeAttackerWithOpponentNexusDestroy(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `P3-52 ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      {
        timing: { kind: "card_event", event: "attack" },
        applicability: { zone: "field" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: {
                  category: ["nexus"],
                  hasMechanic: ["grandwalker"],
                  targetsGrandwalker: true,
                },
                count: 1,
              },
            },
          },
        ],
      },
    ],
  };
}

function makeNexusDef(
  cardNo: string,
  options?: { isGrandwalker?: boolean }
): CardDefinition {
  return {
    cardNo,
    name: `nexus ${cardNo}`,
    printedCategory: "nexus",
    colors: ["red"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    ...(options?.isGrandwalker
      ? {
          grandwalkerData: {
            kind: "grandwalker" as const,
            divineSkills: [],
          },
        }
      : {}),
  };
}

function makeSpiritDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `spirit ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

describe("P3-52: getCandidateTargetInstanceIds が target spec を反映する", () => {
  it("target.player='opponent' + filter.category=['nexus'] + targetsGrandwalker で相手創界神 nexus のみ候補", () => {
    const attackerDef = makeAttackerWithOpponentNexusDestroy("P3-52-ATK");
    const grandwalkerDef = makeNexusDef("P3-52-NEX-GW", {
      isGrandwalker: true,
    });
    const normalNexusDef = makeNexusDef("P3-52-NEX-NORMAL");
    const opponentSpiritDef = makeSpiritDef("P3-52-OPP-SPIRIT");
    const selfNexusDef = makeNexusDef("P3-52-SELF-NEX", {
      isGrandwalker: true,
    });

    const defs = new Map([
      [attackerDef.cardNo, attackerDef],
      [grandwalkerDef.cardNo, grandwalkerDef],
      [normalNexusDef.cardNo, normalNexusDef],
      [opponentSpiritDef.cardNo, opponentSpiritDef],
      [selfNexusDef.cardNo, selfNexusDef],
    ]);
    const getDef = (id: string) => defs.get(id);

    const state: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(attackerDef, {
          instanceId: "alice-attacker",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(grandwalkerDef, {
          instanceId: "bob-grandwalker",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(normalNexusDef, {
          instanceId: "bob-nexus-normal",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(opponentSpiritDef, {
          instanceId: "bob-spirit",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(selfNexusDef, {
          instanceId: "alice-grandwalker",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });

    const regs = generateBattleImmediateEffectRegistrations(attackerDef);
    expect(regs.length).toBe(1);
    const reg = regs[0]!;
    expect(reg.candidateTargetPlayerScope).toBe("opponent");
    expect(reg.targetCardFilter).toBeDefined();
    expect(reg.targetCardFilter?.category).toEqual(["nexus"]);
    expect(reg.targetCardFilter?.hasMechanic).toEqual(["grandwalker"]);
    expect(reg.targetCardFilter?.targetsGrandwalker).toBe(true);

    const candidates = getCandidateTargetInstanceIds(state, "alice", reg, {
      getCardDefinitionById: getDef,
      sourceInstanceId: "alice-attacker",
    });

    // 期待: 相手の創界神 nexus のみ
    expect(candidates).toEqual(["bob-grandwalker"]);
    // 自陣カード除外
    expect(candidates).not.toContain("alice-grandwalker");
    expect(candidates).not.toContain("alice-attacker");
    // 相手 spirit / 通常 nexus 除外
    expect(candidates).not.toContain("bob-spirit");
    expect(candidates).not.toContain("bob-nexus-normal");
  });

  it("getCardDefinitionById 未指定 (legacy 呼び出し) では filter は適用されない (backwards-compat)", () => {
    const attackerDef = makeAttackerWithOpponentNexusDestroy("P3-52-LEGACY");
    const grandwalkerDef = makeNexusDef("P3-52-LEGACY-GW", {
      isGrandwalker: true,
    });
    const normalNexusDef = makeNexusDef("P3-52-LEGACY-NORMAL");

    const state: GameState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(attackerDef, {
          instanceId: "alice-attacker",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(grandwalkerDef, {
          instanceId: "bob-grandwalker",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(normalNexusDef, {
          instanceId: "bob-nexus-normal",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    });

    const reg = generateBattleImmediateEffectRegistrations(attackerDef)[0]!;
    // options 無し → filter スキップ。target.player='opponent' は適用される。
    const candidates = getCandidateTargetInstanceIds(state, "alice", reg);
    expect(candidates.sort()).toEqual(
      ["bob-grandwalker", "bob-nexus-normal"].sort()
    );
  });

  it("filter.colors は treat_as_color の実効色で候補判定する", () => {
    const attackerDef: CardDefinition = {
      ...makeAttackerWithOpponentNexusDestroy("P3-52-COLOR-ATK"),
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          applicability: { zone: "field" },
          steps: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"], colors: ["green"] },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    };
    const purpleSpiritDef: CardDefinition = {
      ...makeSpiritDef("P3-52-COLOR-PURPLE"),
      colors: ["purple"],
      symbolColors: ["purple"],
    };
    const greenSpiritDef: CardDefinition = {
      ...makeSpiritDef("P3-52-COLOR-GREEN"),
      colors: ["green"],
      symbolColors: ["green"],
    };
    const defs = new Map([
      [attackerDef.cardNo, attackerDef],
      [purpleSpiritDef.cardNo, purpleSpiritDef],
      [greenSpiritDef.cardNo, greenSpiritDef],
    ]);
    const getDef = (id: string) => defs.get(id);

    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(attackerDef, {
          instanceId: "alice-attacker",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(purpleSpiritDef, {
          instanceId: "bob-purple-as-green",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(purpleSpiritDef, {
          instanceId: "bob-purple-plain",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(greenSpiritDef, {
          instanceId: "bob-green",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    });
    const state: GameState = {
      ...base,
      activeContinuousEffects: [
        {
          effectId: "ce-purple-as-green",
          sourceInstanceId: "bob-purple-as-green",
          sourceDefinitionId: purpleSpiritDef.cardNo,
          actingPlayerId: "bob",
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "treat_as_color" as ContinuousEffectTag,
          targetInstanceId: "bob-purple-as-green",
          modifierSymbol: ["green"],
        },
      ],
    };

    const reg = generateBattleImmediateEffectRegistrations(attackerDef)[0]!;
    expect(reg.targetCardFilter?.colors).toEqual(["green"]);

    const candidates = getCandidateTargetInstanceIds(state, "alice", reg, {
      getCardDefinitionById: getDef,
      sourceInstanceId: "alice-attacker",
    });

    expect(candidates).toEqual(["bob-purple-as-green", "bob-green"]);
  });

  it("filter.colors は裏向き付与無しカードの印字色を候補に漏らさない", () => {
    const attackerDef: CardDefinition = {
      ...makeAttackerWithOpponentNexusDestroy("P3-52-COLOR-HIDDEN-ATK"),
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          applicability: { zone: "field" },
          steps: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"], colors: ["green"] },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    };
    const greenDef: CardDefinition = {
      ...makeSpiritDef("P3-52-COLOR-HIDDEN-GREEN"),
      colors: ["green"],
      symbolColors: ["green"],
    };
    const defs = new Map([
      [attackerDef.cardNo, attackerDef],
      [greenDef.cardNo, greenDef],
    ]);
    const getDef = (id: string) => defs.get(id);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(attackerDef, {
          instanceId: "alice-attacker",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(greenDef, {
          instanceId: "bob-green-face-up",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(greenDef, {
          instanceId: "bob-green-face-down",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
          faceDown: true,
        }),
      ],
    });

    const reg = generateBattleImmediateEffectRegistrations(attackerDef)[0]!;
    const candidates = getCandidateTargetInstanceIds(base, "alice", reg, {
      getCardDefinitionById: getDef,
      sourceInstanceId: "alice-attacker",
    });

    expect(candidates).toEqual(["bob-green-face-up"]);
  });

  it("filter.tribes は override_properties.addTribes の実効系統で候補判定する", () => {
    const attackerDef: CardDefinition = {
      ...makeAttackerWithOpponentNexusDestroy("P3-52-TRIBE-ATK"),
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          applicability: { zone: "field" },
          steps: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: {
                    category: ["spirit"],
                    colors: ["green"],
                    tribes: ["幻想"],
                  },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    };
    const greenNoTribeDef: CardDefinition = {
      ...makeSpiritDef("P3-52-TRIBE-GREEN-NONE"),
      colors: ["green"],
      symbolColors: ["green"],
      tribe: "",
    };
    const greenFantasyDef: CardDefinition = {
      ...makeSpiritDef("P3-52-TRIBE-GREEN-FANTASY"),
      colors: ["green"],
      symbolColors: ["green"],
      tribe: "幻想",
    };
    const defs = new Map([
      [attackerDef.cardNo, attackerDef],
      [greenNoTribeDef.cardNo, greenNoTribeDef],
      [greenFantasyDef.cardNo, greenFantasyDef],
    ]);
    const getDef = (id: string) => defs.get(id);
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(attackerDef, {
          instanceId: "alice-attacker",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(greenNoTribeDef, {
          instanceId: "bob-green-as-fantasy",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(greenNoTribeDef, {
          instanceId: "bob-green-plain",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(greenFantasyDef, {
          instanceId: "bob-green-printed-fantasy",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    });
    const state: GameState = {
      ...base,
      activeContinuousEffects: [
        {
          effectId: "ce-add-fantasy",
          sourceInstanceId: "bob-green-as-fantasy",
          sourceDefinitionId: greenNoTribeDef.cardNo,
          actingPlayerId: "bob",
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "override_properties" as ContinuousEffectTag,
          targetInstanceId: "bob-green-as-fantasy",
          metadata: { properties: { addTribes: ["幻想"] } },
        },
      ],
    };

    const reg = generateBattleImmediateEffectRegistrations(attackerDef)[0]!;
    expect(reg.targetCardFilter?.tribes).toEqual(["幻想"]);

    const candidates = getCandidateTargetInstanceIds(state, "alice", reg, {
      getCardDefinitionById: getDef,
      sourceInstanceId: "alice-attacker",
    });

    expect(candidates).toEqual([
      "bob-green-as-fantasy",
      "bob-green-printed-fantasy",
    ]);
  });

  it("filter.maxBp は分身(act_as_spirit)・現在レベルの実効 BP で判定する (R21 紅魔館の分身破壊)", () => {
    // R21「BP5000以下のスピリットを破壊」の候補列挙。印字 BP ではなく実効 BP を読むことの回帰防止。
    const attackerDef: CardDefinition = {
      ...makeAttackerWithOpponentNexusDestroy("P3-52-BP-ATK"),
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          applicability: { zone: "field" },
          steps: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"], maxBp: 5000 },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    };
    // 分身の器: 印字 nexus (Lv1 BP=0)。act_as_spirit static_copy で実効 BP=6000 を載せる。
    const hostNexusDef = makeNexusDef("P3-52-BP-NEXUS");
    const smallSpiritDef: CardDefinition = {
      ...makeSpiritDef("P3-52-BP-SMALL"),
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
    };
    const lv2SpiritDef: CardDefinition = {
      ...makeSpiritDef("P3-52-BP-LV2"),
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 3000 },
        { level: 2, requiredCores: 2, bp: 7000 },
      ],
    };

    const defs = new Map([
      [attackerDef.cardNo, attackerDef],
      [hostNexusDef.cardNo, hostNexusDef],
      [smallSpiritDef.cardNo, smallSpiritDef],
      [lv2SpiritDef.cardNo, lv2SpiritDef],
    ]);
    const getDef = (id: string) => defs.get(id);

    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(attackerDef, {
          instanceId: "alice-attacker",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(hostNexusDef, {
          instanceId: "bob-bunshin",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(smallSpiritDef, {
          instanceId: "bob-spirit-small",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(lv2SpiritDef, {
          instanceId: "bob-spirit-lv2",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 2,
        }),
      ],
    });
    const bunshinCE: ContinuousEffect = {
      effectId: "ce-bunshin",
      sourceInstanceId: "bob-bunshin",
      sourceDefinitionId: hostNexusDef.cardNo,
      actingPlayerId: "bob",
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "act_as_spirit" as ContinuousEffectTag,
      targetInstanceId: "bob-bunshin",
      metadata: {
        statBlueprint: {
          kind: "static_copy",
          snapshot: {
            cost: 0,
            reductionSymbols: [],
            symbolColors: ["red"],
            tribes: [],
            levelDefs: [{ level: 1, requiredCores: 0, bp: 6000 }],
          },
        },
      } as unknown as Record<string, unknown>,
    };
    const state: GameState = {
      ...base,
      activeContinuousEffects: [bunshinCE],
    };

    const reg = generateBattleImmediateEffectRegistrations(attackerDef)[0]!;
    expect(reg.targetCardFilter?.maxBp).toBe(5000);

    const candidates = getCandidateTargetInstanceIds(state, "alice", reg, {
      getCardDefinitionById: getDef,
      sourceInstanceId: "alice-attacker",
    });

    // 分身(実効6000) と Lv2スピリット(実効7000) は BP5000超で除外。
    // 印字BP(分身=0 / Lv2の Lv1=3000)を読む旧挙動なら誤って含まれてしまう。
    expect(candidates).toEqual(["bob-spirit-small"]);
  });

  it("viewer 秘匿の裏向き分身 (def 未取得) も実効 BP で maxBp 判定する (紅魔館 desync 回帰防止)", () => {
    // 紅魔館 desync の核心: 相手の裏向き分身は viewer 視点で definitionId=_hidden_card_
    // (getDef→undefined) になる。旧挙動は `if (!def) return true` で filter を素通りさせ
    // 候補に残したため、サーバ実 state (def あり=BP5000超で除外) と候補集合が食い違い、
    // 「ことで」ガード付き紅魔館フラッシュを過剰提示して操作同期エラーになっていた。
    // 修正後は裏向きカードを null-identity placeholder + 実効 BP で評価し、実効 6000>5000 の
    // 分身を除外する (= サーバと一致)。
    const attackerDef: CardDefinition = {
      ...makeAttackerWithOpponentNexusDestroy("P3-52-HIDDEN-ATK"),
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          applicability: { zone: "field" },
          steps: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"], maxBp: 5000 },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    };
    // 裏向き分身の器。印字 def は defs マップに登録しない → getDef("_hidden_card_")=undefined。
    const hiddenDef: CardDefinition = {
      ...makeNexusDef("_hidden_card_"),
      name: "",
    };

    const defs = new Map([[attackerDef.cardNo, attackerDef]]);
    const getDef = (id: string) => defs.get(id);

    const mkBunshinCE = (
      targetInstanceId: string,
      bp: number
    ): ContinuousEffect => ({
      effectId: `ce-${targetInstanceId}`,
      sourceInstanceId: "alice-host",
      sourceDefinitionId: "_hidden_card_",
      actingPlayerId: "bob",
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "act_as_spirit" as ContinuousEffectTag,
      targetInstanceId,
      metadata: {
        statBlueprint: {
          kind: "static_copy",
          snapshot: {
            cost: 0,
            reductionSymbols: [],
            symbolColors: ["red"],
            tribes: [],
            levelDefs: [{ level: 1, requiredCores: 0, bp }],
          },
        },
      } as unknown as Record<string, unknown>,
    });

    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(attackerDef, {
          instanceId: "alice-attacker",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        // 裏向き分身: 実効 BP 6000 (>5000 → 除外されるべき)
        createCardInstance(hiddenDef, {
          instanceId: "bob-hidden-big",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
          faceDown: true,
        }),
        // 裏向き分身: 実効 BP 4000 (<=5000 → 候補に残るべき)
        createCardInstance(hiddenDef, {
          instanceId: "bob-hidden-small",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
          faceDown: true,
        }),
        // 付与なしの裏向きカード (素性なし null identity → spirit filter に一切マッチしない)
        createCardInstance(hiddenDef, {
          instanceId: "bob-hidden-plain",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
          faceDown: true,
        }),
      ],
    });
    const state: GameState = {
      ...base,
      activeContinuousEffects: [
        mkBunshinCE("bob-hidden-big", 6000),
        mkBunshinCE("bob-hidden-small", 4000),
      ],
    };

    const reg = generateBattleImmediateEffectRegistrations(attackerDef)[0]!;
    const candidates = getCandidateTargetInstanceIds(state, "alice", reg, {
      getCardDefinitionById: getDef,
      sourceInstanceId: "alice-attacker",
    });

    // 実効6000 の裏向き分身と素性なし裏向きは除外。実効4000 の分身のみ候補。
    // 旧挙動 (def 未取得 → return true) なら 3 体すべて誤って候補に残る。
    expect(candidates).toEqual(["bob-hidden-small"]);
  });

  it("filter.maxCores はカード上の合計コア数 (soul 含む) で判定する (engine batch2-1)", () => {
    // 「コア3個以下の相手のスピリットを破壊」型の候補列挙。coreCount 注入経路の end-to-end 検証。
    const attackerDef: CardDefinition = {
      ...makeAttackerWithOpponentNexusDestroy("P3-CORE-ATK"),
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          applicability: { zone: "field" },
          steps: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { category: ["spirit"], maxCores: 3 },
                  count: 1,
                },
              },
            },
          ],
        },
      ],
    };
    const spiritDef = makeSpiritDef("P3-CORE-SPIRIT");
    const defs = new Map([
      [attackerDef.cardNo, attackerDef],
      [spiritDef.cardNo, spiritDef],
    ]);
    const getDef = (id: string) => defs.get(id);

    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(attackerDef, {
          instanceId: "alice-attacker",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        // 通常コア2 → 合計2 (<=3, 候補)
        createCardInstance(spiritDef, {
          instanceId: "bob-spirit-2",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 2,
        }),
        // 通常コア4 → 合計4 (>3, 除外)
        createCardInstance(spiritDef, {
          instanceId: "bob-spirit-4",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 4,
        }),
        // 通常コア3 + soul1 → 合計4 (>3, 除外: soul を数えている証拠)
        createCardInstance(spiritDef, {
          instanceId: "bob-spirit-3plus-soul",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 3,
        }),
      ],
      playerOverrides: [
        {},
        {
          soulCoreLocation: {
            kind: "card",
            instanceId: "bob-spirit-3plus-soul",
          },
        },
      ],
    });

    const reg = generateBattleImmediateEffectRegistrations(attackerDef)[0]!;
    expect(reg.targetCardFilter?.maxCores).toBe(3);

    const candidates = getCandidateTargetInstanceIds(base, "alice", reg, {
      getCardDefinitionById: getDef,
      sourceInstanceId: "alice-attacker",
    });

    // 合計コア <=3 は 通常2 のスピリットのみ。通常4 と (通常3+soul=4) は除外。
    expect(candidates).toEqual(["bob-spirit-2"]);
  });
});
