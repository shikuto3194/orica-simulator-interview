import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  evaluateCondition,
  isAdventSourceUnderCard,
  isTextRoleUnderCard,
} from "../src";
import type { CardDefinition, UnderCardEntry } from "../src";
import { collectFieldCardDestinationCandidates } from "../src/effect/structured-core-move";
import { resolveTargetSpec } from "../src/effect/target-resolution";
import { isEffectivelyCombined } from "../src/mechanics/virtual-combine";
import {
  attachAsAdventSource,
  executeAdvent,
} from "../src/mechanics/advent-system";
import { evaluateEffectApplicabilityForCard } from "../src/effect/effect-applicability-core";
import { rebuildContinuousEffectsFromField } from "../src/effect/continuous-effect-rebuild";
import { isActiveTextRoleUnderEffectSource } from "../src/mechanics/star-garment-utils";

describe("下カードの効果は上カードの有効なギミックを要求する", () => {
  it("契約煌臨の資格付与は下カードが先に並んでいても同じ再構築で反映する", () => {
    const initial = board("advent_source");
    initial.cardInstances[0]!.definitionId = "BSKB01-R02";
    initial.cardInstances.reverse();
    const sourceDefinition: CardDefinition = {
      ...lookup("BSTS01-CX01")!,
      effects: [
        {
          timing: { kind: "continuous" },
          applicability: {
            zone: "advent_source",
            adventSourceHostVariants: ["contract", "f_contract"],
          },
          steps: [
            {
              action: {
                kind: "bp_modify",
                target: {
                  kind: "filter",
                  player: "self",
                  filter: {},
                  count: "all",
                },
                amount: 1000,
                duration: { scope: "while_on_field" },
              },
            },
          ],
        },
      ],
    };
    const state = rebuildContinuousEffectsFromField(initial, (id) =>
      id === sourceDefinition.cardNo ? sourceDefinition : lookup(id)
    );
    expect(
      state.activeContinuousEffects.map((ce) => ({
        source: ce.sourceInstanceId,
        tag: ce.modifierTag,
      }))
    ).toContainEqual({ source: "under", tag: "bp_modifier" });
  });
  for (const [cardNo, expected] of [
    ["BSTS01-C01", true],
    ["BSTS01-C03", false],
    ["BSKB01-R02", true],
  ] as const) {
    it(`契約煌臨元: ${cardNo} => ${expected}`, () => {
      const initial = board("advent_source");
      initial.cardInstances[0]!.definitionId = cardNo;
      const state = rebuildContinuousEffectsFromField(initial, lookup);
      const under = state.cardInstances[1]!;
      const applies = (current = state) =>
        evaluateEffectApplicabilityForCard({
          state: current,
          card: under,
          definition: lookup(under.definitionId),
          applicability: {
            zone: "advent_source",
            adventSourceHostVariants: ["contract", "f_contract"],
          },
          getCardDefinitionById: lookup,
          getCurrentLevel: () => 1,
        });
      expect(applies()).toBe(expected);
      if (cardNo === "BSKB01-R02") {
        expect(applies({ ...state, activeContinuousEffects: [] })).toBe(false);
      }
    });
  }
  for (const roleTag of [
    "星霊衣",
    "バレットエディット",
    "アルドノアドライブ",
  ]) {
    it(`${roleTag}: 役割を残してもギミックなしの上カードでは発揮しない`, () => {
      const state = board("text_role", roleTag);
      const hostCard = state.cardInstances[0]!;
      const hostDefinition = {
        ...lookup(hostCard.definitionId)!,
        underCardSlots: [{ roleTag, maxCount: 1 }],
      };
      const options = {
        state,
        hostCard,
        hostDefinition,
        effectSourceInstanceId: "under",
      };
      expect(isActiveTextRoleUnderEffectSource(options)).toBe(true);
      expect(
        isActiveTextRoleUnderEffectSource({
          ...options,
          hostDefinition: {
            ...hostDefinition,
            underCardSlots: [],
            effects: [],
          },
        })
      ).toBe(false);
      expect(hostCard.underCards[0]!.role).toBe("text_role");
    });
  }
});

const definitions = new Map<string, CardDefinition>(
  ALL_CARDS.map((card) => [card.cardNo, card])
);
const lookup = (id: string) => definitions.get(id);

function board(role: UnderCardEntry["role"], roleTag?: string) {
  const host = createCardInstance(definitions.get("BSTS01-C01")!, {
    instanceId: "host",
    ownerPlayerId: "alice",
    zone: "field",
    cores: 1,
  });
  const under = createCardInstance(definitions.get("BSTS01-CX01")!, {
    instanceId: "under",
    ownerPlayerId: "alice",
    zone: "field",
    cores: 0,
    attachedToInstanceId: role === "text_role" ? "host" : null,
  });
  host.underCards = [
    { cardInstanceId: "under", role, ...(roleTag ? { roleTag } : {}) },
  ];
  return {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    cardInstances: [host, under],
  };
}

describe("underCard 全経路の所属スコープ監査", () => {
  for (const [role, tag] of [
    ["advent_source", undefined],
    ["text_role", "バレットエディット"],
    ["text_role", "星霊衣"],
    ["text_role", "アルドノアドライブ"],
  ] as const) {
    for (const mode of ["advent", "fold"] as const) {
      it(`${tag ?? role}: ${mode} 後も役割と親参照を維持`, () => {
        const state = board(role, tag);
        state.players[0]!.handCount = 1;
        state.cardInstances.push(
          createCardInstance(definitions.get("BSTS01-C01")!, {
            instanceId: "next",
            ownerPlayerId: "alice",
            zone: mode === "advent" ? "hand" : "field",
            cores: 1,
          })
        );
        const result =
          mode === "advent"
            ? executeAdvent(
                state,
                "alice",
                {
                  adventCardInstanceId: "next",
                  targetInstanceId: "host",
                  useAlternateCost: true,
                  adventData: {
                    adventCondition: { targetCategory: ["spirit"] },
                    adventTiming: "both_attack_step",
                    soulCoreDest: "trash",
                  },
                },
                lookup
              )
            : attachAsAdventSource(state, "host", "next")!;
        expect(
          result.cardInstances.find((card) => card.instanceId === "next")!
            .underCards
        ).toEqual([
          { cardInstanceId: "host", role: "advent_source" },
          { cardInstanceId: "under", role, ...(tag ? { roleTag: tag } : {}) },
        ]);
        expect(
          result.cardInstances.find((card) => card.instanceId === "host")!
            .underCards
        ).toEqual([]);
        expect(
          result.cardInstances.find((card) => card.instanceId === "under")!
            .attachedToInstanceId
        ).toBe(role === "text_role" ? "next" : null);
      });
    }
    it(`${tag ?? role}: 通常の対象・枚数・合体に含めない`, () => {
      const state = board(role, tag);
      expect(isTextRoleUnderCard(state, state.cardInstances[1]!)).toBe(
        role === "text_role"
      );
      expect(isAdventSourceUnderCard(state, state.cardInstances[1]!)).toBe(
        role === "advent_source"
      );
      expect(isEffectivelyCombined(state, state.cardInstances[0]!)).toBe(false);
      expect(isEffectivelyCombined(state, state.cardInstances[1]!)).toBe(false);
      expect(
        evaluateCondition(
          state,
          [{ kind: "field_has", player: "self", minCount: 2 }],
          "host",
          "alice",
          lookup
        )
      ).toBe(false);
      expect(
        resolveTargetSpec({
          state,
          actingPlayerId: "alice",
          sourceInstanceId: "host",
          getCardDefinitionById: lookup,
          targetSpec: {
            kind: "filter",
            player: "self",
            filter: {},
            count: "all",
          },
        }).map((card) => card.instanceId)
      ).toEqual(["host"]);
    });

    for (const explicit of [false, true]) {
      it(`${tag ?? role}: コア配置先に含めない（明示対象=${explicit}）`, () => {
        const state = board(role, tag);
        expect(
          collectFieldCardDestinationCandidates({
            state,
            to: explicit
              ? { kind: "field_card", player: "self" }
              : { kind: "field", player: "self" },
            toPlayerId: "alice",
            getCardDefinitionById: lookup,
            coreMoveDestinationTargetIds: explicit
              ? ["host", "under"]
              : undefined,
          }).map((card) => card.instanceId)
        ).toEqual(["host"]);
      });
    }
  }
});
