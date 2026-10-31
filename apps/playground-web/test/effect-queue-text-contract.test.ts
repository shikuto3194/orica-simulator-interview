import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  generateBattleImmediateEffectRegistrations,
  generateBurstRegistrations,
  generateFieldCardEffectRegistrations,
  generateTriggeredEffectRegistrations,
  generateHandActivatedEffectRegistrations,
  generateMagicRegistrations,
  type ActiveStack,
  type BattleImmediateEffect,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";
import { buildEffectQueue } from "../src/components/EffectQueueOverlay";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const getDefinition = (id: string) => definitions.get(id);
const triggeredLookup = buildTriggeredEffectLookup(ALL_CARDS);
const base = createEmptyGameState({ playerIds: ["alice", "bob"] });

function stateFor(def: CardDefinition): GameState {
  return {
    ...base,
    step: "attack",
    turnNumber: 5,
    cardInstances: [
      createCardInstance(def, {
        instanceId: "source",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 3,
      }),
    ],
  };
}

function withStack(
  state: GameState,
  def: CardDefinition,
  action: Partial<ActiveStack>,
  surface: "stack" | "battle_flash" | "pre_declaration" = "stack"
): GameState {
  const pendingStackAction: ActiveStack = {
    stackId: "text-contract",
    actionKind: "battle_immediate_effect",
    chainId: "text-contract",
    actingPlayerId: "alice",
    cardInstanceId: "source",
    cardDefinitionId: def.cardNo,
    targetInstanceIds: [],
    targetEffectFilterTags: [],
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
    ...action,
  };
  const window = {
    actingPlayerId: "alice",
    previousWindow: "declare_attack" as const,
    priorityPlayerId: "bob",
    consecutivePassCount: 0,
    stackResponseSourcePlayerId: "alice",
    subStackEverOpened: false,
    burstWindowKind: null,
    pendingStackAction,
  };
  if (surface === "battle_flash") {
    return {
      ...state,
      window: "stack_before_block",
      activeAttack: {
        attackId: "attack-5",
        primaryEntityId: "entity-source",
        participantEntityIds: ["entity-source"],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [],
        symbolResolutionOrder: ["entity-source"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: { ...window, kind: "before_block" },
      },
    };
  }
  if (surface === "pre_declaration") {
    return {
      ...state,
      preDeclarationStackWindow: {
        ...window,
        kind: "attack",
        sourceInstanceId: "source",
      },
    };
  }
  return { ...state, window: "stack", stackWindow: window };
}

function texts(state: GameState) {
  return buildEffectQueue(state, getDefinition, triggeredLookup, "bob").map(
    (item) => item.effectText
  );
}

function printedText(def: CardDefinition, effectIndex: number) {
  return (def.effects?.[effectIndex]?.textRef ?? [])
    .map((index) => def.textLines[index])
    .filter(Boolean)
    .join("\n");
}

describe("効果本文の同一性: 宣言待ちからスタックへ移っても同じ効果を表示", () => {
  it.each(["stack", "battle_flash", "pre_declaration"] as const)(
    "BSSA01-X02 第2効果を %s で第1効果に取り違えない",
    (surface) => {
      const def = getDefinition("BSSA01-X02")!;
      const prompt: BattleImmediateEffect = {
        promptId: "alice-life",
        attackId: "attack-5",
        timing: "attack",
        sourceKind: "spirit",
        sourceCardNo: def.cardNo,
        sourceDefinitionId: def.cardNo,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        registrationIndex: 1,
      };
      const state = stateFor(def);
      const expected = printedText(def, 2);
      expect(texts({ ...state, battleImmediateEffects: [prompt] })).toEqual([
        expected,
      ]);
      for (const metadata of [
        { battleImmediatePromptSnapshot: prompt },
        {
          battleImmediateRegistrationIndex: 1,
          battleImmediateSourceCardNo: def.cardNo,
        },
      ]) {
        expect(texts(withStack(state, def, metadata, surface))).toEqual([
          expected,
        ]);
      }
    }
  );

  const registries = {
    battle_immediate_effect: generateBattleImmediateEffectRegistrations,
    burst_activation: generateBurstRegistrations,
    field_card_effect: generateFieldCardEffectRegistrations,
    triggered_effect: generateTriggeredEffectRegistrations,
    hand_card_effect: generateHandActivatedEffectRegistrations,
    magic: generateMagicRegistrations,
  };

  it.each(Object.entries(registries))(
    "全収録カードの %s: 登録番号に対応する本文を表示する",
    (actionKind, generate) => {
      const mismatches: string[] = [];
      let audited = 0;
      for (const def of definitions.values()) {
        for (const [index, registration] of generate(def).entries()) {
          if (registration.effectIndex === undefined) continue;
          const expected = printedText(def, registration.effectIndex);
          expect(expected, def.cardNo + " registration=" + index).not.toBe("");
          const state = stateFor(def);
          const actions: Record<string, Partial<ActiveStack>> = {
            battle_immediate_effect: {
              battleImmediateRegistrationIndex: index,
              battleImmediateSourceCardNo: def.cardNo,
            },
            burst_activation: { burstRegistrationIndex: index },
            hand_card_effect: {
              handActivatedEffectIndex: registration.effectIndex,
            },
            magic: { magicEffectIndex: registration.effectIndex },
            field_card_effect: { fieldEffectRegistrationIndex: index },
            triggered_effect: {
              triggeredRegistrationIndex: index,
              triggeredSourceCardNo: def.cardNo,
            },
          };
          for (const surface of [
            "stack",
            "battle_flash",
            "pre_declaration",
          ] as const) {
            const actual = texts(
              withStack(
                state,
                def,
                {
                  actionKind: actionKind as ActiveStack["actionKind"],
                  ...actions[actionKind],
                },
                surface
              )
            );
            if (actual.length !== 1 || actual[0] !== expected) {
              mismatches.push(
                def.cardNo + " registration=" + index + " surface=" + surface
              );
            }
          }
          if (actionKind === "battle_immediate_effect") {
            const prompt: BattleImmediateEffect = {
              promptId: "corpus",
              attackId: "corpus-attack",
              actingPlayerId: "alice",
              sourceInstanceId: "source",
              sourceDefinitionId: def.cardNo,
              sourceCardNo: def.cardNo,
              sourceKind: "spirit",
              registrationIndex: index,
              timing:
                generateBattleImmediateEffectRegistrations(def)[index]!.timing,
            };
            if (
              texts({ ...state, battleImmediateEffects: [prompt] })[0] !==
              expected
            )
              mismatches.push(
                def.cardNo + " registration=" + index + " surface=queued"
              );
          }
          audited++;
        }
      }
      console.info(`${actionKind}: ${audited} registrations audited`);
      expect(audited).toBeGreaterThan(0);
      expect(mismatches, `${actionKind}: ${audited} registrations`).toEqual([]);
    }
  );
  it("全収録カードのアクセル/チェンジ/神技: 機構内の効果本文を表示する", () => {
    const mismatches: string[] = [];
    const audited: Record<string, number> = {};
    for (const def of definitions.values()) {
      const mechanics = [
        { actionKind: "accel" as const, effects: def.accelData?.effects },
        { actionKind: "change" as const, effects: def.changeData?.effects },
        ...(def.grandwalkerData?.divineSkills ?? []).map(
          (skill, divineSkillIndex) => ({
            actionKind: "divine_skill" as const,
            effects: skill.effects,
            divineSkillIndex,
          })
        ),
      ];
      for (const { effects, ...action } of mechanics) {
        const indices = [
          ...new Set(effects?.flatMap((effect) => effect.textRef ?? []) ?? []),
        ].sort((a, b) => a - b);
        const expected = indices
          .map((index) => def.textLines[index])
          .filter(Boolean)
          .join("\n");
        if (!effects) continue;
        for (const [effectIndex, effect] of effects.entries()) {
          expect(
            effect.textRef?.length ?? 0,
            def.cardNo + ":" + action.actionKind + ":" + effectIndex
          ).toBeGreaterThan(0);
        }
        expect(expected, def.cardNo + ":" + action.actionKind).not.toBe("");
        const actual = texts(withStack(stateFor(def), def, action));
        if (actual.length !== 1 || actual[0] !== expected)
          mismatches.push(def.cardNo + ":" + action.actionKind);
        audited[action.actionKind] = (audited[action.actionKind] ?? 0) + 1;
      }
    }
    console.info("Mechanic registrations audited", audited);
    expect(Object.keys(audited).length).toBe(3);
    expect(mismatches).toEqual([]);
  });
});
