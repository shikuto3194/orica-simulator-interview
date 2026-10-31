/**
 * BSTH08.5-X04「希望の面」effects[0]「このカードは効果以外で召喚できない」回帰テスト。
 *
 * このテストは同時に、continuous-effect-rebuild.ts の REBUILD_ZONES 拡張
 * (手札/手元ゾーンの continuous 効果を `applicability.zone` opt-in で登録可能にした変更) の
 * 検証も兼ねる。従来 REBUILD_ZONES は field/mirage/burst (+trash opt-in) のみで、
 * hand/set_aside ゾーンの continuous 効果 (BSGE01-C16 等の「手札にあるこのカードは
 * 相手の効果を受けない」型) は一切登録されない latent gap があった。
 *
 * 同じ textRef[0]「このカードの効果以外で手元に置けない」側の実装は
 * ENGINE-set-aside-entry-restriction (effects[1], destination-zone-scoped resistance) で
 * 別途行った。検証は bsth08-5-x04-set-aside-entry-restriction.test.ts 参照。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  isCardUseRestricted,
  rebuildContinuousEffectsFromField,
  recomputeAndRebuildContinuousEffects,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

function makeState(): GameState {
  return createEmptyGameState({ playerIds: ["alice", "bob"] });
}

describe("BSTH08.5-X04 希望の面 effects[0]: 効果以外で召喚できない", () => {
  const def = cardNoMap.get("BSTH08.5-X04")!;

  it("restrict_use restrictedKinds:['summon'] を持つ", () => {
    const effect = def.effects![0]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.applicability?.zone).toEqual(["hand", "set_aside"]);
    const action = effect.steps[0]!.action as {
      kind: string;
      filter?: { cardName?: unknown };
      restrictedKinds?: string[];
    };
    expect(action.kind).toBe("restrict_use");
    expect(action.restrictedKinds).toEqual(["summon"]);
    expect(action.filter?.cardName).toBe("self");
  });

  it.each(["hand", "set_aside"] as const)(
    "%s ゾーンでは restrict_use CE が登録され、召喚のみ禁止・アクセルは許可",
    (zone) => {
      const state: GameState = {
        ...makeState(),
        cardInstances: [
          createCardInstance(def, {
            instanceId: "x04-1",
            ownerPlayerId: "alice",
            zone,
          }),
        ],
      };

      const rebuilt = rebuildContinuousEffectsFromField(
        state,
        getCardDefinitionById
      );
      const restrictCe = rebuilt.activeContinuousEffects.find(
        (ce) => ce.modifierTag === "restrict_use"
      );
      expect(restrictCe).toBeDefined();
      expect(restrictCe!.targetInstanceId).toBe("alice");
      expect(restrictCe!.metadata?.restrictedKinds).toEqual(["summon"]);

      const card = rebuilt.cardInstances[0]!;
      expect(
        isCardUseRestricted(
          rebuilt,
          "alice",
          card,
          def,
          getCardDefinitionById,
          "summon"
        )
      ).toBe(true);
      expect(
        isCardUseRestricted(
          rebuilt,
          "alice",
          card,
          def,
          getCardDefinitionById,
          "accel"
        )
      ).toBe(false);
      // opponent (bob) は制限対象外
      expect(
        isCardUseRestricted(
          rebuilt,
          "bob",
          card,
          def,
          getCardDefinitionById,
          "summon"
        )
      ).toBe(false);
    }
  );

  it("フィールドでは restrict_use CE は登録されない (applicability.zone が hand/set_aside のみ)", () => {
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "x04-field",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    expect(
      rebuilt.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "restrict_use"
      )
    ).toBe(false);
  });

  it("手札→トラッシュ遷移後は recompute で restrict_use CE が除去される", () => {
    const handState: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "x04-2",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    };
    const registered = rebuildContinuousEffectsFromField(
      handState,
      getCardDefinitionById
    );
    expect(
      registered.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "restrict_use"
      )
    ).toBe(true);

    const moved: GameState = {
      ...registered,
      cardInstances: registered.cardInstances.map((c) =>
        c.instanceId === "x04-2" ? { ...c, zone: "trash" as const } : c
      ),
    };
    const recomputed = recomputeAndRebuildContinuousEffects(
      moved,
      getCardDefinitionById
    );
    expect(
      recomputed.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "restrict_use"
      )
    ).toBe(false);
  });
});
