import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  applyLegalAction,
  executeEffect,
  collectStateBasedActions,
} from "../src";
import { getValidBraveCombineHosts } from "../src/legal/legal-actions-shared";
import { executeBraveCombine } from "../src/legal/brave-combine-state-helpers";
import { matchesBraveConditionForCard } from "../src/legal/legal-actions-shared";

const getDefinition = (id: string) =>
  ALL_CARDS.find((card) => card.cardNo === id);

describe("合体条件の本文とデータ", () => {
  const faces = ALL_CARDS.flatMap((card) => [
    card,
    ...(card.backFace
      ? [{ ...card.backFace, cardNo: `${card.cardNo}:back` }]
      : []),
  ]);
  it("本文に合体条件がある全カード面は判定用の条件を持つ", () => {
    const missing = faces.filter(
      (card) =>
        card.textLines.some((line) =>
          /【(?:左右|左|右)?合体条件[：:】]/.test(line)
        ) &&
        !card.braveCondition &&
        !card.keywordTags.includes("cannot_combine")
    );
    expect(
      missing.map((card) => ({
        cardNo: card.cardNo,
        lines: card.textLines.filter((line) => line.includes("合体条件")),
      }))
    ).toEqual([]);
  });

  for (const face of faces) {
    const name = face.textLines
      .map((line) => line.match(/^【合体条件：「([^」]+)」】$/)?.[1])
      .find(Boolean);
    if (!name) continue;
    it(`${face.cardNo} の名前指定は変種を許し、別名を拒否する`, () => {
      expect(face.braveCondition?.cardNameContains).toContain(name);
      for (const [hostName, expected] of [
        [`[変種]${name}`, true],
        ["無関係なスピリット", false],
      ] as const) {
        const definition = { ...getDefinition("BSTS01-R02")!, name: hostName };
        const host = createCardInstance(definition, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        });
        const state = createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [host],
        });
        expect(
          matchesBraveConditionForCard({
            state,
            card: host,
            definition,
            condition: face.braveCondition!,
          })
        ).toBe(expected);
      }
    });
  }

  it.each([
    ["BSRK01-X01", "BSRK01-C04"],
    ["BSSL01-C05", "BSSL01-CX01"],
    ["BSSL01-R03", "BSSL01-CX01"],
  ])("%s は通常・直接・効果合体で条件外を拒否する", (braveNo, legalHostNo) => {
    const brave = createCardInstance(getDefinition(braveNo)!, {
      instanceId: "brave",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const hosts = ["BSTS01-R02", legalHostNo].map((no, index) =>
      createCardInstance(getDefinition(no)!, {
        instanceId: `host-${index}`,
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      })
    );
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [brave, ...hosts],
      }),
      step: "main" as const,
    };
    // 添付snapshotと同じ違法な既存合体も、状態チェックで分離対象になる。
    const invalid = {
      ...state,
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "brave"
          ? { ...card, attachedToInstanceId: "host-0", normalCoreCount: 0 }
          : card.instanceId === "host-0"
            ? { ...card, attachedChildrenIds: ["brave"] }
            : card
      ),
    };
    expect(collectStateBasedActions(invalid, getDefinition)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "brave_forced_separation",
          instanceId: "brave",
        }),
      ])
    );
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      getRegisteredFieldCardEffectActions: () => [],
    });
    const combines = actions.filter(
      (action) => action.kind === "brave_combine"
    );
    expect(combines).toHaveLength(1);
    expect(combines[0]).toMatchObject({ targetInstanceId: "host-1" });
    expect(
      getValidBraveCombineHosts(
        state,
        getDefinition(braveNo)!,
        "alice",
        getDefinition,
        "brave"
      ).map((host) => host.instanceId)
    ).toEqual(["host-1"]);
    expect(
      executeBraveCombine(state, "alice", "brave", "host-0", getDefinition)
    ).toBe(state);
    const effect = executeEffect({
      chainId: "test:brave-condition-fidelity:144",
      state,
      sourceInstanceId: "brave",
      actingPlayerId: "alice",
      getCardDefinitionById: getDefinition,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "brave_combine_effect",
              target: {
                kind: "filter",
                player: "self",
                filter: {
                  cardName: [{ exact: getDefinition("BSTS01-R02")!.name }],
                },
                count: 1,
              },
            },
          },
        ],
      },
    });
    expect(
      effect.cardInstances.find((card) => card.instanceId === "brave")
        ?.attachedToInstanceId
    ).toBeNull();
    const legal = applyLegalAction({
      state,
      action: combines[0]!,
      getCardDefinitionById: getDefinition,
    }).state;
    expect(
      legal.cardInstances.find((card) => card.instanceId === "brave")
        ?.attachedToInstanceId
    ).toBe("host-1");
    expect(
      getLegalActions({
        state: legal,
        actingPlayerId: "alice",
        getCardDefinitionById: getDefinition,
        getRegisteredFieldCardEffectActions: () => [],
      }).filter((action) => action.kind === "brave_swap")
    ).toEqual([]);
  });
});
