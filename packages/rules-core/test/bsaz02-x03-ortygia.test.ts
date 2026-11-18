/**
 * BSAZ02-X03「オルテュギア」effects[0] (Lv3【分身：1】『召喚/アタック/ブロック時』) の単体テスト。
 *
 * engine-deck-derived-clone-spirit primitive (BSAZ01-C12/BSAZ02-C07 precedent) の
 * デッキ→field face-down 配置 + register_act_as_spirit(static_copy) はそのまま流用し、
 * override_properties(treatAsCategory:"ultimate") を併用することで「分身アルティメット」
 * (分身スピリットではなくアルティメット) を表現する新規組み合わせを検証する。
 *
 * 併せて model.ts field_has.excludeCardNames (新設) + structured-condition-eval.ts の
 * 「『オルテュギア』以外の…0体」召喚条件が、自身の生成した分身トークンを自己ブロックしない
 * ことを検証する。
 */
import { describe, it, expect } from "vitest";
import { BSAZ02_CARDS } from "../../card-data/src/cards/BSAZ02";
import { executeEffect } from "../src/effect/effect-interpreter";
import { evaluateConditionClause } from "../src/effect/structured-condition-eval";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { getEffectiveBp, getEffectiveLevel } from "../src/battle/battle-shared";
import {
  getEffectiveCardName,
  getEffectiveCost,
  getEffectiveColors,
} from "../src/legal/legal-actions-shared";
import {
  getEffectiveTribe,
  getEffectiveCategory,
} from "../src/mechanics/act-as-spirit";
import type { CardDefinition, CardInstance, GameState } from "../src/model";

const ALICE = "player-1";
const BOB = "player-2";

const X03_CARD = BSAZ02_CARDS.find((c) => c.cardNo === "BSAZ02-X03")!;

const fillerDef: CardDefinition = {
  cardNo: "FILLER-X03-CLONE",
  name: "Filler",
  printedCategory: "magic",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "紅魔",
  sourceUrls: [],
  sourceConfidence: "C",
};

const aldnoahDriveFillerDef: CardDefinition = {
  ...fillerDef,
  cardNo: "FILLER-X03-ALDNOAH-DRIVE",
};

const otherCfUltimateDef: CardDefinition = {
  ...fillerDef,
  cardNo: "FILLER-X03-OTHER-CF-ULTIMATE",
  name: "OtherCfUltimate",
  printedCategory: "ultimate",
  tribe: "ＣＦ",
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
};

const defRegistry = new Map<string, CardDefinition>([
  [X03_CARD.cardNo, X03_CARD],
  [fillerDef.cardNo, fillerDef],
  [aldnoahDriveFillerDef.cardNo, aldnoahDriveFillerDef],
  [otherCfUltimateDef.cardNo, otherCfUltimateDef],
]);
const getCardDefinitionById = (id: string) => defRegistry.get(id);

function buildDeckFillerState(opts: {
  deckCount?: number;
  hostCores?: number;
  reserveCores?: number;
}): { state: GameState; hostId: string } {
  const deckCount = opts.deckCount ?? 4;
  const reserveCores = opts.reserveCores ?? 3;
  const host = createCardInstance(X03_CARD, {
    instanceId: "host",
    ownerPlayerId: ALICE,
    zone: "field",
    cores: opts.hostCores ?? 1,
  });
  const deckCards: CardInstance[] = [];
  for (let i = 0; i < deckCount; i++) {
    deckCards.push(
      createCardInstance(fillerDef, {
        instanceId: `filler-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
        cores: 0,
      })
    );
  }
  const baseState = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [host, ...deckCards],
    startingLife: 5,
  });
  const state: GameState = {
    ...baseState,
    activePlayerId: ALICE,
    players: baseState.players.map((p) =>
      p.id === ALICE
        ? {
            ...p,
            reserveNormalCoreCount: reserveCores,
            deckCount,
            voidNormalCoreCount: 3,
          }
        : p
    ),
  };
  return { state, hostId: host.instanceId };
}

function attachAldnoahDriveUnderCard(
  state: GameState,
  hostId: string
): GameState {
  // host ごとに一意な id にする (複数 host に付与する既存テストで instanceId 衝突を避ける)。
  const underCardId = `aldnoah-drive-under-${hostId}`;
  const underCard = createCardInstance(aldnoahDriveFillerDef, {
    instanceId: underCardId,
    ownerPlayerId: ALICE,
    zone: "field",
    attachedToInstanceId: hostId,
  });
  return {
    ...state,
    cardInstances: [
      ...state.cardInstances.map((c) =>
        c.instanceId === hostId
          ? {
              ...c,
              underCards: [
                ...c.underCards,
                {
                  cardInstanceId: underCardId,
                  role: "text_role" as const,
                  roleTag: "アルドノアドライブ",
                },
              ],
            }
          : c
      ),
      underCard,
    ],
  };
}

describe("BSAZ02-X03「オルテュギア」effects[0]: 召喚/アタック/ブロック時の分身アルティメット生成", () => {
  it("【アルドノアドライブ：1】が下にあるとき、デッキ上1枚を裏向きでフィールドに置きボイドからコア1個を配置、「オルテュギア」固定スタットの分身アルティメット(category:ultimate)として扱う", () => {
    const built = buildDeckFillerState({ deckCount: 4, hostCores: 1 });
    const state = attachAldnoahDriveUnderCard(built.state, built.hostId);
    const hostId = built.hostId;
    const summonEffect = X03_CARD.effects!.find(
      (e) => e.timing.kind === "card_event"
    )!;
    const effectIndex = X03_CARD.effects!.indexOf(summonEffect);

    const afterEffect = executeEffect({
      chainId: "test:bsaz02-x03-ortygia:164",
      state,
      effect: summonEffect,
      effectIndex,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });

    const placed = afterEffect.cardInstances.filter(
      (c) => c.zone === "field" && c.definitionId === fillerDef.cardNo
    );
    expect(placed).toHaveLength(1);
    expect(placed[0]!.faceDown).toBe(true);
    expect(placed[0]!.normalCoreCount).toBe(1);

    const token = placed[0]!;
    expect(
      getEffectiveCardName(afterEffect, token, fillerDef, getCardDefinitionById)
    ).toBe("オルテュギア");
    expect(
      getEffectiveCost(afterEffect, token, fillerDef, getCardDefinitionById)
    ).toBe(7);
    expect(
      getEffectiveTribe(afterEffect, token, fillerDef, getCardDefinitionById)
    ).toBe("火星・ＣＦ・アルドノア");
    expect(
      getEffectiveBp(afterEffect, token, fillerDef, getCardDefinitionById)
    ).toBe(3000);
    expect(
      getEffectiveLevel(afterEffect, token, fillerDef, getCardDefinitionById)
    ).toBe(3);
    expect(getEffectiveColors(afterEffect, token, fillerDef)).toEqual([
      "white",
    ]);
    expect(getEffectiveCategory(afterEffect, token, fillerDef)).toBe(
      "ultimate"
    );
  });

  it("自分は分身のコアを1個未満にできず、相手のコア除去は防がない", () => {
    const built = buildDeckFillerState({ deckCount: 4, hostCores: 1 });
    const state = attachAldnoahDriveUnderCard(built.state, built.hostId);
    const hostId = built.hostId;
    const summonEffect = X03_CARD.effects!.find(
      (e) => e.timing.kind === "card_event"
    )!;
    const effectIndex = X03_CARD.effects!.indexOf(summonEffect);

    const afterSummon = executeEffect({
      chainId: "test:bsaz02-x03-ortygia:213",
      state,
      effect: summonEffect,
      effectIndex,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    const token = afterSummon.cardInstances.find(
      (c) => c.zone === "field" && c.definitionId === fillerDef.cardNo
    )!;
    expect(token.normalCoreCount).toBe(1);

    const afterOpponentCoreMove = executeEffect({
      chainId: "test:bsaz02-x03-ortygia:226",
      state: {
        ...afterSummon,
        cardInstances: [
          ...afterSummon.cardInstances,
          createCardInstance(fillerDef, {
            instanceId: "opponent-source",
            ownerPlayerId: BOB,
            controllerPlayerId: BOB,
            zone: "field",
            cores: 1,
          }),
        ],
      },
      effect: {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "target_card" },
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["ultimate"] },
                count: 1,
              },
              to: { kind: "reserve", player: "opponent" },
              amount: 1,
            },
          },
        ],
      },
      resolvedTargetIds: [token.instanceId],
      targetInstanceIds: [token.instanceId],
      targetSelectionResolved: true,
      sourceInstanceId: "opponent-source",
      actingPlayerId: BOB,
      getCardDefinitionById,
    });
    expect(
      afterOpponentCoreMove.cardInstances.find(
        (c) => c.instanceId === token.instanceId
      )!.normalCoreCount,
      JSON.stringify(afterOpponentCoreMove.log)
    ).toBe(0);

    const afterSelfCoreMove = executeEffect({
      chainId: "test:bsaz02-x03-ortygia:273",
      state: afterSummon,
      effect: {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "target_card" },
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["ultimate"] },
                count: 1,
              },
              to: { kind: "reserve", player: "self" },
              amount: 1,
            },
          },
        ],
      },
      resolvedTargetIds: [token.instanceId],
      targetInstanceIds: [token.instanceId],
      targetSelectionResolved: true,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(
      afterSelfCoreMove.cardInstances.find(
        (c) => c.instanceId === token.instanceId
      )!.normalCoreCount
    ).toBe(1);
  });

  it("【アルドノアドライブ：1】が下に無いとき、トリガーは発揮されない (condition:self_under_card_count ゲート)", () => {
    const { state, hostId } = buildDeckFillerState({
      deckCount: 4,
      hostCores: 1,
    });
    const summonEffect = X03_CARD.effects!.find(
      (e) => e.timing.kind === "card_event"
    )!;
    const effectIndex = X03_CARD.effects!.indexOf(summonEffect);

    const afterEffect = executeEffect({
      chainId: "test:bsaz02-x03-ortygia:318",
      state,
      effect: summonEffect,
      effectIndex,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });

    const placed = afterEffect.cardInstances.filter(
      (c) => c.zone === "field" && c.definitionId === fillerDef.cardNo
    );
    expect(placed).toHaveLength(0);
  });

  it("【分身：1】は1回の発揮ごとの上限で、既存の分身がいても次の発揮で1体を生成する", () => {
    const built = buildDeckFillerState({ deckCount: 4, hostCores: 1 });
    const state = attachAldnoahDriveUnderCard(built.state, built.hostId);
    const hostId = built.hostId;
    const summonEffect = X03_CARD.effects!.find(
      (e) => e.timing.kind === "card_event"
    )!;
    const effectIndex = X03_CARD.effects!.indexOf(summonEffect);

    const afterFirst = executeEffect({
      chainId: "test:bsaz02-x03-ortygia:342",
      state,
      effect: summonEffect,
      effectIndex,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    const firstPlaced = afterFirst.cardInstances.filter(
      (c) => c.zone === "field" && c.definitionId === fillerDef.cardNo
    );
    expect(firstPlaced).toHaveLength(1);

    const afterSecond = executeEffect({
      chainId: "test:bsaz02-x03-ortygia:355",
      state: afterFirst,
      effect: summonEffect,
      effectIndex,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    const secondPlaced = afterSecond.cardInstances.filter(
      (c) => c.zone === "field" && c.definitionId === fillerDef.cardNo
    );
    expect(secondPlaced).toHaveLength(2);
  });

  it("場に『オルテュギア』実カードが2枚あっても、互いを分身と誤カウントしてトリガーを誤ブロックしない (field_has.actAsSpiritOnly 回帰テスト、round2 adversarial verifier 指摘)", () => {
    const deckCount = 4;
    const hostA = createCardInstance(X03_CARD, {
      instanceId: "host-a",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const hostB = createCardInstance(X03_CARD, {
      instanceId: "host-b",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const deckCards: CardInstance[] = [];
    for (let i = 0; i < deckCount; i++) {
      deckCards.push(
        createCardInstance(fillerDef, {
          instanceId: `filler-${i}`,
          ownerPlayerId: ALICE,
          zone: "deck",
          cores: 0,
        })
      );
    }
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [hostA, hostB, ...deckCards],
      startingLife: 5,
    });
    let state: GameState = {
      ...baseState,
      activePlayerId: ALICE,
      players: baseState.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              reserveNormalCoreCount: 3,
              deckCount,
              voidNormalCoreCount: 3,
            }
          : p
      ),
    };
    state = attachAldnoahDriveUnderCard(state, hostA.instanceId);
    state = attachAldnoahDriveUnderCard(state, hostB.instanceId);

    const summonEffect = X03_CARD.effects!.find(
      (e) => e.timing.kind === "card_event"
    )!;
    const effectIndex = X03_CARD.effects!.indexOf(summonEffect);

    const afterHostA = executeEffect({
      chainId: "test:bsaz02-x03-ortygia:421",
      state,
      effect: summonEffect,
      effectIndex,
      sourceInstanceId: hostA.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(
      afterHostA.cardInstances.filter(
        (c) => c.zone === "field" && c.definitionId === fillerDef.cardNo
      )
    ).toHaveLength(1);

    const afterHostB = executeEffect({
      chainId: "test:bsaz02-x03-ortygia:435",
      state,
      effect: summonEffect,
      effectIndex,
      sourceInstanceId: hostB.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(
      afterHostB.cardInstances.filter(
        (c) => c.zone === "field" && c.definitionId === fillerDef.cardNo
      )
    ).toHaveLength(1);
  });

  it("2体の本体が続けて分身を生成しても、互いの実ドライブを動かさず発揮条件を保つ", () => {
    const deckCount = 4;
    const hostA = createCardInstance(X03_CARD, {
      instanceId: "host-a",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const hostB = createCardInstance(X03_CARD, {
      instanceId: "host-b",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const deckCards: CardInstance[] = [];
    for (let i = 0; i < deckCount; i++) {
      deckCards.push(
        createCardInstance(fillerDef, {
          instanceId: `filler-chain-${i}`,
          ownerPlayerId: ALICE,
          zone: "deck",
          cores: 0,
        })
      );
    }
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [hostA, hostB, ...deckCards],
      startingLife: 5,
    });
    let state: GameState = {
      ...baseState,
      activePlayerId: ALICE,
      players: baseState.players.map((p) =>
        p.id === ALICE
          ? {
              ...p,
              reserveNormalCoreCount: 3,
              deckCount,
              voidNormalCoreCount: 3,
            }
          : p
      ),
    };
    state = attachAldnoahDriveUnderCard(state, hostA.instanceId);
    state = attachAldnoahDriveUnderCard(state, hostB.instanceId);

    const summonEffect = X03_CARD.effects!.find(
      (e) => e.timing.kind === "card_event"
    )!;
    const effectIndex = X03_CARD.effects!.indexOf(summonEffect);

    const afterHostA = executeEffect({
      chainId: "test:bsaz02-x03-ortygia:502",
      state,
      effect: summonEffect,
      effectIndex,
      sourceInstanceId: hostA.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    const hostBAfterTheft = afterHostA.cardInstances.find(
      (c) => c.instanceId === hostB.instanceId
    )!;
    expect(hostBAfterTheft.underCards).toHaveLength(1);

    const gateCondition = summonEffect.condition!.find(
      (c) => c.kind === "self_under_card_count"
    )!;
    expect(
      evaluateConditionClause(
        afterHostA,
        gateCondition,
        hostB.instanceId,
        ALICE,
        getCardDefinitionById
      )
    ).toBe(true);

    const afterHostBChained = executeEffect({
      chainId: "test:bsaz02-x03-ortygia:528",
      state: afterHostA,
      effect: summonEffect,
      effectIndex,
      sourceInstanceId: hostB.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    expect(
      afterHostBChained.cardInstances.filter(
        (c) => c.zone === "field" && c.definitionId === fillerDef.cardNo
      )
    ).toHaveLength(2);
  });

  it("アタック時/ブロック時も同じ card_event trigger に含まれる (event 配列)", () => {
    const summonEffect = X03_CARD.effects!.find(
      (e) => e.timing.kind === "card_event"
    )!;
    expect(summonEffect.timing).toEqual({
      kind: "card_event",
      event: ["summon", "attack", "block"],
    });
  });
});

describe("BSAZ02-X03「オルテュギア」召喚条件: 「オルテュギア」以外の自分の系統：「ＣＦ」のアルティメット0体", () => {
  it("自分が生成した『オルテュギア』分身トークン(category:ultimate)は0体カウントに含まれない (excludeCardNames)", () => {
    const built = buildDeckFillerState({ deckCount: 4, hostCores: 1 });
    const state = attachAldnoahDriveUnderCard(built.state, built.hostId);
    const summonEffect = X03_CARD.effects!.find(
      (e) => e.timing.kind === "card_event"
    )!;
    const effectIndex = X03_CARD.effects!.indexOf(summonEffect);
    const afterEffect = executeEffect({
      chainId: "test:bsaz02-x03-ortygia:562",
      state,
      effect: summonEffect,
      effectIndex,
      sourceInstanceId: built.hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    const token = afterEffect.cardInstances.find(
      (c) => c.zone === "field" && c.definitionId === fillerDef.cardNo
    )!;
    expect(getEffectiveCategory(afterEffect, token, fillerDef)).toBe(
      "ultimate"
    );

    const clause = X03_CARD.summonCondition![0]!;
    const satisfied = evaluateConditionClause(
      afterEffect,
      clause,
      built.hostId,
      ALICE,
      getCardDefinitionById
    );
    expect(satisfied).toBe(true);
  });

  it("『オルテュギア』以外の系統：「ＣＦ」のアルティメットが場にあるときは召喚条件不成立", () => {
    const other = createCardInstance(otherCfUltimateDef, {
      instanceId: "other-cf-ultimate",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const baseState = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [other],
      startingLife: 5,
    });
    const state: GameState = { ...baseState, activePlayerId: ALICE };

    const clause = X03_CARD.summonCondition![0]!;
    const satisfied = evaluateConditionClause(
      state,
      clause,
      "not-on-field",
      ALICE,
      getCardDefinitionById
    );
    expect(satisfied).toBe(false);
  });
});

describe("BSAZ02-X03「オルテュギア」effects[0] step5: textRef[5]「フィールド/トラッシュの『オルテュギア』の【アルドノアドライブ】1つを...得る」", () => {
  it("stub が残っていない (全 textRef 実装済み)", () => {
    const remaining = X03_CARD.effects!.find((e) => e.stub !== undefined);
    expect(remaining).toBeUndefined();
  });

  it("別の本体の下にある実ドライブを保持したまま分身を生成する", () => {
    const built = buildDeckFillerState({ deckCount: 4, hostCores: 1 });
    let state = attachAldnoahDriveUnderCard(built.state, built.hostId);
    const hostId = built.hostId;
    const secondOrtygia = createCardInstance(X03_CARD, {
      instanceId: "second-ortygia",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const secondUnderId = "second-aldnoah-drive-under";
    const secondUnder = createCardInstance(aldnoahDriveFillerDef, {
      instanceId: secondUnderId,
      ownerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: secondOrtygia.instanceId,
    });
    state = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        {
          ...secondOrtygia,
          underCards: [
            {
              cardInstanceId: secondUnderId,
              role: "text_role" as const,
              roleTag: "アルドノアドライブ",
            },
          ],
        },
        secondUnder,
      ],
    };

    const summonEffect = X03_CARD.effects!.find(
      (e) => e.timing.kind === "card_event"
    )!;
    const effectIndex = X03_CARD.effects!.indexOf(summonEffect);
    const afterEffect = executeEffect({
      chainId: "test:bsaz02-x03-ortygia:658",
      state,
      effect: summonEffect,
      effectIndex,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });

    const token = afterEffect.cardInstances.find(
      (c) => c.zone === "field" && c.definitionId === fillerDef.cardNo
    )!;
    const movedUnder = afterEffect.cardInstances.find(
      (c) => c.instanceId === secondUnderId
    )!;
    expect(movedUnder.attachedToInstanceId).toBe(secondOrtygia.instanceId);
    expect(
      token.underCards.some(
        (uc) =>
          uc.cardInstanceId === secondUnderId &&
          uc.roleTag === "アルドノアドライブ"
      )
    ).toBe(false);
    const secondHostAfter = afterEffect.cardInstances.find(
      (c) => c.instanceId === "second-ortygia"
    )!;
    expect(secondHostAfter.underCards).toHaveLength(1);
  });

  it("別の本体が無くても、分身の下に物理カードを追加しない", () => {
    const built = buildDeckFillerState({ deckCount: 4, hostCores: 1 });
    const state = attachAldnoahDriveUnderCard(built.state, built.hostId);
    const hostId = built.hostId;
    const summonEffect = X03_CARD.effects!.find(
      (e) => e.timing.kind === "card_event"
    )!;
    const effectIndex = X03_CARD.effects!.indexOf(summonEffect);
    const afterEffect = executeEffect({
      chainId: "test:bsaz02-x03-ortygia:695",
      state,
      effect: summonEffect,
      effectIndex,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });

    const token = afterEffect.cardInstances.find(
      (c) => c.zone === "field" && c.definitionId === fillerDef.cardNo
    )!;
    expect(token.underCards).toEqual([]);
  });

  it("元の本体から離れた実ドライブがトラッシュにあっても移動しない", () => {
    const built = buildDeckFillerState({ deckCount: 4, hostCores: 1 });
    const state = attachAldnoahDriveUnderCard(built.state, built.hostId);
    const hostId = built.hostId;
    const detachedUnderId = "detached-aldnoah-drive";
    const detachedUnder = createCardInstance(aldnoahDriveFillerDef, {
      instanceId: detachedUnderId,
      ownerPlayerId: ALICE,
      zone: "trash",
      attachedToInstanceId: null,
      detachedUnderCardOrigin: {
        hostCardNameEffective: "オルテュギア",
        roleTag: "アルドノアドライブ",
      },
    });
    const stateWithDetached: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, detachedUnder],
    };

    const summonEffect = X03_CARD.effects!.find(
      (e) => e.timing.kind === "card_event"
    )!;
    const effectIndex = X03_CARD.effects!.indexOf(summonEffect);
    const afterEffect = executeEffect({
      chainId: "test:bsaz02-x03-ortygia:734",
      state: stateWithDetached,
      effect: summonEffect,
      effectIndex,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });

    const token = afterEffect.cardInstances.find(
      (c) => c.zone === "field" && c.definitionId === fillerDef.cardNo
    )!;
    const movedUnder = afterEffect.cardInstances.find(
      (c) => c.instanceId === detachedUnderId
    )!;
    expect(movedUnder.zone).toBe("trash");
    expect(movedUnder.attachedToInstanceId).toBeNull();
    expect(movedUnder.detachedUnderCardOrigin).not.toBeNull();
    expect(
      token.underCards.some(
        (uc) =>
          uc.cardInstanceId === detachedUnderId &&
          uc.roleTag === "アルドノアドライブ"
      )
    ).toBe(false);
  });

  it("フィールドとトラッシュの両方に実ドライブがあってもどちらも移動しない", () => {
    const built = buildDeckFillerState({ deckCount: 4, hostCores: 1 });
    let state = attachAldnoahDriveUnderCard(built.state, built.hostId);
    const hostId = built.hostId;
    const secondOrtygia = createCardInstance(X03_CARD, {
      instanceId: "second-ortygia",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const secondUnderId = "second-aldnoah-drive-under";
    const secondUnder = createCardInstance(aldnoahDriveFillerDef, {
      instanceId: secondUnderId,
      ownerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: secondOrtygia.instanceId,
    });
    const detachedUnderId = "detached-aldnoah-drive-priority";
    const detachedUnder = createCardInstance(aldnoahDriveFillerDef, {
      instanceId: detachedUnderId,
      ownerPlayerId: ALICE,
      zone: "trash",
      attachedToInstanceId: null,
      detachedUnderCardOrigin: {
        hostCardNameEffective: "オルテュギア",
        roleTag: "アルドノアドライブ",
      },
    });
    state = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        {
          ...secondOrtygia,
          underCards: [
            {
              cardInstanceId: secondUnderId,
              role: "text_role" as const,
              roleTag: "アルドノアドライブ",
            },
          ],
        },
        secondUnder,
        detachedUnder,
      ],
    };

    const summonEffect = X03_CARD.effects!.find(
      (e) => e.timing.kind === "card_event"
    )!;
    const effectIndex = X03_CARD.effects!.indexOf(summonEffect);
    const afterEffect = executeEffect({
      chainId: "test:bsaz02-x03-ortygia:812",
      state,
      effect: summonEffect,
      effectIndex,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });

    const token = afterEffect.cardInstances.find(
      (c) => c.zone === "field" && c.definitionId === fillerDef.cardNo
    )!;
    const movedFieldUnder = afterEffect.cardInstances.find(
      (c) => c.instanceId === secondUnderId
    )!;
    expect(movedFieldUnder.attachedToInstanceId).toBe(secondOrtygia.instanceId);
    expect(token.underCards).toEqual([]);
    const untouchedTrashUnder = afterEffect.cardInstances.find(
      (c) => c.instanceId === detachedUnderId
    )!;
    expect(untouchedTrashUnder.zone).toBe("trash");
    expect(untouchedTrashUnder.attachedToInstanceId).toBeNull();
    expect(untouchedTrashUnder.detachedUnderCardOrigin).not.toBeNull();
  });

  it("途中で別の本体が増えても次の発揮で分身を1体追加し、実ドライブと既存分身のコアを保持する", () => {
    const built = buildDeckFillerState({ deckCount: 4, hostCores: 1 });
    const state = attachAldnoahDriveUnderCard(built.state, built.hostId);
    const hostId = built.hostId;
    const summonEffect = X03_CARD.effects!.find(
      (e) => e.timing.kind === "card_event"
    )!;
    const effectIndex = X03_CARD.effects!.indexOf(summonEffect);

    const afterFirst = executeEffect({
      chainId: "test:bsaz02-x03-ortygia:846",
      state,
      effect: summonEffect,
      effectIndex,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    const tokenAfterFirst = afterFirst.cardInstances.find(
      (c) => c.zone === "field" && c.definitionId === fillerDef.cardNo
    )!;
    expect(tokenAfterFirst.underCards).toEqual([]);

    const laterOrtygia = createCardInstance(X03_CARD, {
      instanceId: "later-ortygia",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
    });
    const laterUnderId = "later-aldnoah-drive-under";
    const laterUnder = createCardInstance(aldnoahDriveFillerDef, {
      instanceId: laterUnderId,
      ownerPlayerId: ALICE,
      zone: "field",
      attachedToInstanceId: laterOrtygia.instanceId,
    });
    const stateWithLaterDonor: GameState = {
      ...afterFirst,
      cardInstances: [
        ...afterFirst.cardInstances,
        {
          ...laterOrtygia,
          underCards: [
            {
              cardInstanceId: laterUnderId,
              role: "text_role" as const,
              roleTag: "アルドノアドライブ",
            },
          ],
        },
        laterUnder,
      ],
    };

    const afterSecond = executeEffect({
      chainId: "test:bsaz02-x03-ortygia:890",
      state: stateWithLaterDonor,
      effect: summonEffect,
      effectIndex,
      sourceInstanceId: hostId,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });

    const tokensAfterSecond = afterSecond.cardInstances.filter(
      (c) => c.zone === "field" && c.definitionId === fillerDef.cardNo
    );
    expect(tokensAfterSecond).toHaveLength(2);
    const tokenAfterSecond = tokensAfterSecond[0]!;

    const movedUnder = afterSecond.cardInstances.find(
      (c) => c.instanceId === laterUnderId
    )!;
    expect(movedUnder.attachedToInstanceId).toBe(laterOrtygia.instanceId);
    expect(
      tokenAfterSecond.underCards.some(
        (uc) =>
          uc.cardInstanceId === laterUnderId &&
          uc.roleTag === "アルドノアドライブ"
      )
    ).toBe(false);
    const donorAfter = afterSecond.cardInstances.find(
      (c) => c.instanceId === "later-ortygia"
    )!;
    expect(donorAfter.underCards).toHaveLength(1);

    const hostAfterSecond = afterSecond.cardInstances.find(
      (c) => c.instanceId === hostId
    )!;
    expect(hostAfterSecond.normalCoreCount).toBe(1);
    expect(tokenAfterSecond.normalCoreCount).toBe(1);
  });
});
