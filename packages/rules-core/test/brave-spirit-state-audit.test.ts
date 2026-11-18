import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeExhaust,
  expandCardDefinitionsWithBackFaces,
  getAttackDeclarationBlockReason,
  getBlockDeclarationBlockReason,
  getLegalActions,
  recomputeAndRebuildContinuousEffects,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const byNo = new Map(definitions.map((card) => [card.cardNo, card]));
const host: CardDefinition = {
  cardNo: "AUDIT-HOST",
  name: "監査用スピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 8,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 10000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};
byNo.set(host.cardNo, host);
const getDef = (id: string) => byNo.get(id);
const braves = definitions.filter((card) => card.printedCategory === "brave");
// 本文から抽出するため、禁止 DSL 自体の欠落も検知する。異魔神は本文に
// 攻防不可を省略する場合があるので、ルール定義からも監査へ含める。
const restrictedBraves = braves.filter(
  (card) =>
    card.imaginBraveData !== undefined ||
    card.textLines.some(
      (line) =>
        /このブレイヴ/.test(line) &&
        /アタック.*ブロック.*でき(?:ない|ず)/.test(line)
    )
);
const cases = restrictedBraves.map((card) => [card.cardNo, card] as const);
const hasNoExhaust = (card: CardDefinition) =>
  card.imaginBraveData !== undefined ||
  card.textLines.some(
    (line) =>
      /スピリット状態/.test(line) &&
      /このブレイヴ/.test(line) &&
      /疲労せず|疲労しない/.test(line)
  );

function fieldState(card: CardDefinition): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(card, {
          instanceId: "brave",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: card.levelDefs[0]?.requiredCores ?? 0,
        }),
        createCardInstance(host, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(host, {
          instanceId: "opponent",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    }),
    activePlayerId: "alice",
    turnNumber: 5,
    step: "attack",
    window: "none",
  };
}

function blockState(state: GameState): GameState {
  return {
    ...state,
    activePlayerId: "bob",
    window: "declare_attack",
    battleEntities: [
      {
        entityId: "attacker",
        resolvedBp: 10000,
        attackState: "attacking",
        resolvedSymbols: ["red"],
        memberInstanceIds: ["opponent"],
      },
    ],
    activeAttack: {
      attackId: "audit-attack",
      primaryEntityId: "attacker",
      participantEntityIds: ["attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: "alice" },
      blockAssignments: [
        { participantEntityId: "attacker", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["attacker"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    },
  };
}

function attackReason(state: GameState, sourceInstanceId: string) {
  return getAttackDeclarationBlockReason({
    state,
    actingPlayerId: "alice",
    sourceInstanceId,
    getCardDefinitionById: getDef,
  });
}
function blockReason(state: GameState, sourceInstanceId: string) {
  return getBlockDeclarationBlockReason({
    state: blockState(state),
    actingPlayerId: "alice",
    sourceInstanceId,
    participantEntityId: "attacker",
    getCardDefinitionById: getDef,
  });
}
function exhaust(state: GameState, instanceId: string, unpreventable = false) {
  return executeExhaust(
    state,
    "bob",
    { selfCard: false, player: "opponent", count: 1 },
    getDef,
    "heavily_exhausted",
    "opponent",
    [instanceId],
    unpreventable ? "unpreventable" : "none"
  );
}

describe("攻防不可ブレイヴ全件監査", () => {
  it("表記ゆれ・片側だけの禁止・異魔神も監査対象から漏らさない", () => {
    const candidates = braves.filter(
      (card) =>
        card.imaginBraveData !== undefined ||
        card.textLines.some(
          (line) =>
            /このブレイヴ/.test(line) &&
            /(アタック|ブロック)[^。]*でき(?:ない|ず)/.test(line)
        )
    );
    expect(candidates.map((card) => card.cardNo)).toEqual(
      restrictedBraves.map((card) => card.cardNo)
    );
    expect(restrictedBraves.length).toBeGreaterThanOrEqual(46);
    // 生のB面にある異魔神データが、GUI/APIの展開プールでも失われない。
    for (const front of ALL_CARDS) {
      if (front.backFace?.imaginBraveData) {
        expect(getDef(front.backFace.cardNo!)?.imaginBraveData).toEqual(
          front.backFace.imaginBraveData
        );
      }
    }
  });

  describe.each(cases)("%s", (_cardNo, card) => {
    it.each([false, true])(
      "CE登録済み=%s: アタック・ブロック禁止と疲労制約",
      (registered) => {
        const initial = fieldState(card);
        const state = registered
          ? recomputeAndRebuildContinuousEffects(initial, getDef)
          : initial;
        if (registered && !card.imaginBraveData) {
          expect(state.activeContinuousEffects).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                sourceInstanceId: "brave",
                targetInstanceId: "brave",
                modifierTag: "prevent_battle_both",
                metadata: { ruleStrength: true },
              }),
            ])
          );
        }
        // 盤面自体の不正や窓の閉鎖による偽陽性を除く。
        expect(attackReason(state, "host")).toBeNull();
        expect(blockReason(state, "host")).toBeNull();
        expect(attackReason(state, "brave")).toBe("source_not_ready");
        expect(blockReason(state, "brave")).toBe("source_not_ready");
        const attacks = getLegalActions({
          state,
          actingPlayerId: "alice",
          getCardDefinitionById: getDef,
          getRegisteredFieldCardEffectActions: () => [],
        }).filter((a) => a.kind === "attack" && a.can);
        expect(attacks.some((a) => a.sourceInstanceId === "brave")).toBe(false);
        const blocks = getLegalActions({
          state: blockState(state),
          actingPlayerId: "alice",
          getCardDefinitionById: getDef,
          getRegisteredFieldCardEffectActions: () => [],
        }).filter((a) => a.kind === "block" && a.can);
        expect(blocks.some((a) => a.sourceInstanceId === "brave")).toBe(false);
        for (const unpreventable of [false, true]) {
          const after = exhaust(structuredClone(state), "brave", unpreventable);
          expect(
            after.cardInstances.find((c) => c.instanceId === "brave")
              ?.exhaustState
          ).toBe(hasNoExhaust(card) ? "recovered" : "heavily_exhausted");
        }
      }
    );

    it("合体先は攻防・疲労可能で、分離後は自身の制約が戻る", () => {
      let state = recomputeAndRebuildContinuousEffects(
        fieldState(card),
        getDef
      );
      state = {
        ...state,
        cardInstances: state.cardInstances.map((c) =>
          c.instanceId === "brave"
            ? { ...c, attachedToInstanceId: "host" }
            : c.instanceId === "host"
              ? { ...c, attachedChildrenIds: ["brave"] }
              : c
        ),
      };
      state = recomputeAndRebuildContinuousEffects(state, getDef);
      expect(attackReason(state, "host")).toBeNull();
      expect(blockReason(state, "host")).toBeNull();
      expect(
        exhaust(structuredClone(state), "host").cardInstances.find(
          (c) => c.instanceId === "host"
        )?.exhaustState
      ).toBe("heavily_exhausted");
      state = {
        ...state,
        cardInstances: state.cardInstances.map((c) =>
          c.instanceId === "brave"
            ? { ...c, attachedToInstanceId: null }
            : c.instanceId === "host"
              ? { ...c, attachedChildrenIds: [] }
              : c
        ),
      };
      state = recomputeAndRebuildContinuousEffects(state, getDef);
      expect(attackReason(state, "brave")).toBe("source_not_ready");
      expect(blockReason(state, "brave")).toBe("source_not_ready");
    });
  });

  it("添付盤面の最小再現: コア0・未合体のクレメンサーをAPIで直接アタック指定しても拒否する", () => {
    const state = fieldState(getDef("BSGE01-TX01(A)")!);
    expect(state.activeContinuousEffects).toEqual([]);
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: () => [],
    });
    const legalHostAttack = actions.find(
      (a) => a.kind === "attack" && a.sourceInstanceId === "host" && a.can
    );
    expect(legalHostAttack?.kind).toBe("attack");
    if (legalHostAttack?.kind !== "attack")
      throw new Error("missing control attack");
    expect(() =>
      applyLegalAction({
        state,
        action: { ...legalHostAttack, sourceInstanceId: "brave" },
        getCardDefinitionById: getDef,
      })
    ).toThrow(/source_not_ready/);
    expect(state.activeAttack).toBeNull();
    expect(
      state.cardInstances.find((c) => c.instanceId === "brave")?.exhaustState
    ).toBe("recovered");
  });
});
