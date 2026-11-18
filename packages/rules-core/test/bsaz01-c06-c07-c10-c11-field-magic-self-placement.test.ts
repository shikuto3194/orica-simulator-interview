/**
 * BSAZ01-C07/C10/C11 effects[0]:
 * 「フラッシュ効果使用後以外でトラッシュに置かれたこのカードはフィールドに置く。」
 *
 * BSAZ01-C04[2] と同型の自己配置トリガー (engine-field-magic-self-placement)。
 * 明示本文を持つ 3 枚とも同一プリミティブ (findMovedToTrashAutoEffect /
 * processMovedToTrashEffects の "move_to_field" disposition kind) をカード固有の
 * cardFilter.cardName で再利用するのみで、dispatch 側の新規コードは無い (SSOT)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type GameState,
} from "../src";
import {
  findMovedToTrashAutoEffect,
  processMovedToTrashEffects,
} from "../src/effect/structured-effect-interpreter";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

describe.each([["BSAZ01-C07"], ["BSAZ01-C10"], ["BSAZ01-C11"]])(
  "%s [2] フラッシュ効果使用後以外でトラッシュに置かれたこのカードはフィールドに置く",
  (cardNo) => {
    const def = cardNoMap.get(cardNo)!;

    it("フラッシュ未使用のトラッシュ行きは move_to_field / mandatory でマッチする", () => {
      const self = createCardInstance(def, {
        instanceId: `${cardNo}-1`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "trash",
      });
      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [self],
      });
      const match = findMovedToTrashAutoEffect(
        state,
        self.instanceId,
        def,
        getDef,
        {
          fromZone: "hand",
        }
      );
      expect(match).toBeDefined();
      expect(match!.kind).toBe("move_to_field");
      expect(match!.executionMode).toBe("mandatory");
    });

    it("同ステップで自分のフラッシュ使用が既にログされていればマッチしない", () => {
      const self = createCardInstance(def, {
        instanceId: `${cardNo}-2`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "trash",
      });
      const state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [self],
        }),
        step: "main",
        turnNumber: 1,
        flashCardUsageLog: [
          {
            playerId: "alice",
            cardInstanceId: self.instanceId,
            cardDefinitionId: self.definitionId,
            turnNumber: 1,
            step: "main",
            attackId: null,
          },
        ],
      };
      const match = findMovedToTrashAutoEffect(
        state,
        self.instanceId,
        def,
        getDef,
        {
          fromZone: "hand",
        }
      );
      expect(match).toBeUndefined();
    });

    it("[board] フラッシュ未使用でトラッシュに置かれたこのカードはフィールドへ強制移動する", () => {
      const self = createCardInstance(def, {
        instanceId: `${cardNo}-board-1`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "trash",
      });
      const state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [self],
        }),
        step: "main",
        turnNumber: 1,
      };

      const result = processMovedToTrashEffects(
        state,
        [self.instanceId],
        getDef,
        {
          fromZone: "hand",
        }
      );

      expect(
        result.cardInstances.find((c) => c.instanceId === self.instanceId)?.zone
      ).toBe("field");
    });

    it("[board] 自分のフラッシュ使用直後のトラッシュ確定はフィールドへ移動しない (通常のトラッシュ据え置き)", () => {
      const self = createCardInstance(def, {
        instanceId: `${cardNo}-board-2`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "trash",
      });
      const state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [self],
        }),
        step: "main",
        turnNumber: 1,
        flashCardUsageLog: [
          {
            playerId: "alice",
            cardInstanceId: self.instanceId,
            cardDefinitionId: self.definitionId,
            turnNumber: 1,
            step: "main",
            attackId: null,
          },
        ],
      };

      const result = processMovedToTrashEffects(
        state,
        [self.instanceId],
        getDef,
        {
          fromZone: "in_use",
        }
      );

      expect(
        result.cardInstances.find((c) => c.instanceId === self.instanceId)?.zone
      ).toBe("trash");
    });
  }
);

describe("BSAZ01-C06 【タイプ：作戦】だが自己配置本文なし", () => {
  const cardNo = "BSAZ01-C06";
  const def = cardNoMap.get(cardNo)!;

  it("フラッシュ未使用でトラッシュに置かれても move_to_field を登録せず、トラッシュに留まる", () => {
    const self = createCardInstance(def, {
      instanceId: `${cardNo}-board`,
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [self],
    });

    expect(
      findMovedToTrashAutoEffect(state, self.instanceId, def, getDef, {
        fromZone: "hand",
      })
    ).toBeUndefined();

    const result = processMovedToTrashEffects(
      state,
      [self.instanceId],
      getDef,
      { fromZone: "hand" }
    );

    expect(
      result.cardInstances.find((card) => card.instanceId === self.instanceId)
        ?.zone
    ).toBe("trash");
  });
});
