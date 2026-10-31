/**
 * BSAZ01-C04「アセイラム姫暗殺計画」effects[0] (textRef[2]):
 * 「フラッシュ効果使用後以外でトラッシュに置かれたこのカードはフィールドに置く。」
 *
 * engine-field-magic-self-placement クラスタの中核プリミティブ。
 * BSES01-C01[4,5]（自分自身のフラッシュ解決トレイリングステップとしての optional
 * 自己配置）とは異なり、こちらは ANY trash 行き (discard/destroy 等) に反応する
 * card_event(moved_to_trash) の強制トリガーで、「フラッシュ効果使用後」(=自分の
 * フラッシュ解決による通常のトラッシュ確定) だけを flash_used(negate:true) で除外する。
 * 裁定源: 10_rules/07b_card-observed-mechanics.md §6 タイプ：作戦。
 *
 * 新設プリミティブ: findMovedToTrashAutoEffect / processMovedToTrashEffects
 * (structured-trash-ops.ts) の "move_to_field" disposition kind。
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
const C04 = cardNoMap.get("BSAZ01-C04")!;

describe("BSAZ01-C04 [2] フラッシュ効果使用後以外でトラッシュに置かれたこのカードはフィールドに置く", () => {
  it("findMovedToTrashAutoEffect: フラッシュ未使用のトラッシュ行きは move_to_field / mandatory でマッチする", () => {
    const self = createCardInstance(C04, {
      instanceId: "c04-1",
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
      C04,
      getDef,
      {
        fromZone: "hand",
      }
    );
    expect(match).toBeDefined();
    expect(match!.kind).toBe("move_to_field");
    expect(match!.executionMode).toBe("mandatory");
  });

  it("findMovedToTrashAutoEffect: 同ステップで自分のフラッシュ使用が既にログされていればマッチしない", () => {
    const self = createCardInstance(C04, {
      instanceId: "c04-2",
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
      C04,
      getDef,
      {
        fromZone: "hand",
      }
    );
    expect(match).toBeUndefined();
  });

  it("findMovedToTrashAutoEffect: 別ステップでのフラッシュ使用ログはスコープ外なのでマッチする (scope:step)", () => {
    const self = createCardInstance(C04, {
      instanceId: "c04-3",
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
          step: "attack",
          attackId: null,
        },
      ],
    };
    const match = findMovedToTrashAutoEffect(
      state,
      self.instanceId,
      C04,
      getDef,
      {
        fromZone: "hand",
      }
    );
    expect(match).toBeDefined();
    expect(match!.kind).toBe("move_to_field");
  });

  it("findMovedToTrashAutoEffect: 別カード(同名でない)のフラッシュ使用ログでは除外されずマッチする", () => {
    const self = createCardInstance(C04, {
      instanceId: "c04-4",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "trash",
    });
    const otherMagic = cardNoMap.get("BSAZ01-C06")!;
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
          cardInstanceId: "other-instance",
          cardDefinitionId: otherMagic.cardNo,
          turnNumber: 1,
          step: "main",
          attackId: null,
        },
      ],
    };
    const match = findMovedToTrashAutoEffect(
      state,
      self.instanceId,
      C04,
      getDef,
      {
        fromZone: "hand",
      }
    );
    expect(match).toBeDefined();
    expect(match!.kind).toBe("move_to_field");
  });

  it("[board] processMovedToTrashEffects: フラッシュ未使用でトラッシュに置かれたこのカードはフィールドへ強制移動する", () => {
    const self = createCardInstance(C04, {
      instanceId: "c04-board-1",
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
      { fromZone: "hand" }
    );

    expect(
      result.cardInstances.find((c) => c.instanceId === self.instanceId)?.zone
    ).toBe("field");
  });

  it("[board] processMovedToTrashEffects: 自分のフラッシュ使用直後のトラッシュ確定はフィールドへ移動しない (通常のトラッシュ据え置き)", () => {
    const self = createCardInstance(C04, {
      instanceId: "c04-board-2",
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
      { fromZone: "in_use" }
    );

    expect(
      result.cardInstances.find((c) => c.instanceId === self.instanceId)?.zone
    ).toBe("trash");
  });
});
