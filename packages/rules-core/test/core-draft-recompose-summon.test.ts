/**
 * P3-46 Phase 3 entry gate (検証計画 #15): 召喚 (コスト + 配置) 2 段階の
 * `recomposeSummonLegalAction` golden test。
 *
 * ねらい: GUI facade が draft から組み立てる payload と、現行 `BattleScreen.tsx` が
 * 直接組み立てている `paymentSources` + `summonEnterFieldCorePlacements` が
 * **byte-equal** であることを保証する。recompose に bug が混ざると Phase 3 GUI 移行で
 * 原因切り分けが難しくなるため、移行前にここで弾く。
 *
 * 比較対象は:
 * - `paymentSources` の **順序 / amount / includeSoulCore**
 * - `summonEnterFieldCorePlacements` の **順序 / kind / amount / instanceId**
 *
 * 生成元の対応関係 (BattleScreen.tsx の組み立てロジックとの byte-equal):
 * - paymentSources: `BattleScreen.tsx:3209-3229` (`confirmCostPayment` 内)
 * - placements:    `BattleScreen.tsx:3097-3126` (`confirmPlacement` 内)
 */
import { describe, expect, it } from "vitest";
import {
  applyDraftCoreMoves,
  createCardInstance,
  createEmptyGameState,
  recomposeSummonLegalAction,
} from "../src";
import type { CardDefinition, CardInstance, DraftCoreMove } from "../src";

const ALICE = "player-1";

function dummyDef(cardNo = "TEST-SUMMON-001"): CardDefinition {
  return {
    cardNo,
    name: "Test Summon",
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    images: {},
    tribe: [],
  } as CardDefinition;
}

function fieldCard(
  instanceId: string,
  cores: number,
  opts: Partial<CardInstance> = {}
): CardInstance {
  return createCardInstance(dummyDef(), {
    instanceId,
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: cores,
    ...opts,
  });
}

describe("P3-46 #15: recomposeSummonLegalAction (召喚 cost+placement 2 段階) golden", () => {
  it("コスト 3 全額リザーブ + 1 コアのみ配置 (最小ケース) - reserveのみ", () => {
    // 既存 BattleScreen 経路: cost paid via reserve(3), placement via reserve(1).
    // facade 経路の draft は (card_cost ×1) → (placement ×1) の 2 件にまとまる。
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "trash", playerId: ALICE },
        amount: 3,
        purpose: "card_cost",
      },
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "summon-target" },
        amount: 1,
        purpose: "placement",
      },
    ];

    const recomposed = recomposeSummonLegalAction(drafts);

    expect(recomposed).toEqual({
      paymentSources: [{ kind: "reserve", amount: 3 }],
      summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    });
  });

  it("コスト 3 = リザーブ 2 + 場 1 / 配置 = リザーブ 1 (場混在の典型ケース)", () => {
    // 既存 BattleScreen 経路:
    //   paymentSources = [
    //     { kind: "reserve", amount: 2 },
    //     { kind: "card", instanceId: "ally-1", amount: 1 },
    //   ]
    //   placements = [{ kind: "reserve_normal", amount: 1 }]
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "trash", playerId: ALICE },
        amount: 2,
        purpose: "card_cost",
      },
      {
        kind: "normal",
        from: { kind: "card", instanceId: "ally-1" },
        to: { kind: "trash", playerId: ALICE },
        amount: 1,
        purpose: "card_cost",
      },
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "summon-target" },
        amount: 1,
        purpose: "placement",
      },
    ];

    const recomposed = recomposeSummonLegalAction(drafts);

    expect(recomposed).toEqual({
      paymentSources: [
        { kind: "reserve", amount: 2 },
        { kind: "card", instanceId: "ally-1", amount: 1 },
      ],
      summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    });
  });

  it("コスト 3 = リザーブ 2 (ソウル含む) + 場 1 / 配置 = リザーブ 1 (ソウルがコストへ)", () => {
    // ソウルコアをリザーブから支払いに使うケース。
    // 既存 BattleScreen: { kind: "reserve", amount: 2, includeSoulCore: true } になる。
    // (reserveNormal 1 + soul 1 = 合計 2)
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "trash", playerId: ALICE },
        amount: 1,
        purpose: "card_cost",
      },
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "trash", playerId: ALICE },
        purpose: "card_cost",
      },
      {
        kind: "normal",
        from: { kind: "card", instanceId: "ally-1" },
        to: { kind: "trash", playerId: ALICE },
        amount: 1,
        purpose: "card_cost",
      },
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "summon-target" },
        amount: 1,
        purpose: "placement",
      },
    ];

    const recomposed = recomposeSummonLegalAction(drafts);

    expect(recomposed).toEqual({
      paymentSources: [
        { kind: "reserve", amount: 2, includeSoulCore: true },
        { kind: "card", instanceId: "ally-1", amount: 1 },
      ],
      summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    });
  });

  it("コスト 2 / 配置 = 場 (ソウル含む) + リザーブ - placement のソウルが場経由", () => {
    // ソウルコアを場のカードから持ってくる典型 placement。
    // 既存 BattleScreen の placements は [reserve_normal, card_normal, card_soul] 順。
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "trash", playerId: ALICE },
        amount: 2,
        purpose: "card_cost",
      },
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "summon-target" },
        amount: 1,
        purpose: "placement",
      },
      {
        kind: "normal",
        from: { kind: "card", instanceId: "ally-soul" },
        to: { kind: "card", instanceId: "summon-target" },
        amount: 1,
        purpose: "placement",
      },
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "card", instanceId: "ally-soul" },
        to: { kind: "card", instanceId: "summon-target" },
        purpose: "placement",
      },
    ];

    const recomposed = recomposeSummonLegalAction(drafts);

    expect(recomposed).toEqual({
      paymentSources: [{ kind: "reserve", amount: 2 }],
      summonEnterFieldCorePlacements: [
        { kind: "reserve_normal", amount: 1 },
        { kind: "card_normal", instanceId: "ally-soul", amount: 1 },
        { kind: "card_soul", instanceId: "ally-soul" },
      ],
    });
  });

  it("複数 draft が同一 source へ重なる場合 1 件にまとまる (順序保持)", () => {
    // facade が同じ reserve→target に対して連続 draft を append したケース。
    // 既存 BattleScreen 経路は reserveTaken 集計値で 1 件にまとまる。
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "trash", playerId: ALICE },
        amount: 1,
        purpose: "card_cost",
      },
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "trash", playerId: ALICE },
        amount: 2,
        purpose: "card_cost",
      },
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "summon-target" },
        amount: 1,
        purpose: "placement",
      },
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "summon-target" },
        amount: 1,
        purpose: "placement",
      },
    ];

    const recomposed = recomposeSummonLegalAction(drafts);

    expect(recomposed).toEqual({
      paymentSources: [{ kind: "reserve", amount: 3 }],
      summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 2 }],
    });
  });

  it("placement 先 instanceId が draft 間で食い違う場合は throw (誤入力検出)", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "summon-target" },
        amount: 1,
        purpose: "placement",
      },
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "another-target" },
        amount: 1,
        purpose: "placement",
      },
    ];

    expect(() => recomposeSummonLegalAction(drafts)).toThrow(
      /placement drafts must share one destination instanceId/
    );
  });

  it("card_cost draft の to が trash 以外なら throw", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "void", playerId: ALICE },
        amount: 1,
        purpose: "card_cost",
      },
    ];

    expect(() => recomposeSummonLegalAction(drafts)).toThrow(
      /card_cost draft must target trash/
    );
  });

  it("対象外 purpose (shoot 等) は無視され空 payload を返す", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "card", instanceId: "victim" },
        to: { kind: "reserve", playerId: ALICE },
        amount: 1,
        purpose: "shoot",
      },
    ];

    const recomposed = recomposeSummonLegalAction(drafts);

    expect(recomposed).toEqual({
      paymentSources: [],
      summonEnterFieldCorePlacements: [],
    });
  });

  // 等価性確認: drafts を applyDraftCoreMoves で適用した core 状態と、
  // recomposed payload を「等価な手順 (cost: source→trash, placement: source→summon-target)」
  // で適用した core 状態が一致することを確認する。
  // (Phase 3 GUI 移行前に、recompose の意味的損失が無いことを担保)
  it("drafts vs recomposed payload を core 移動として適用した結果が一致 (mixed ケース)", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "trash", playerId: ALICE },
        amount: 1,
        purpose: "card_cost",
      },
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "trash", playerId: ALICE },
        purpose: "card_cost",
      },
      {
        kind: "normal",
        from: { kind: "card", instanceId: "ally-soul" },
        to: { kind: "trash", playerId: ALICE },
        amount: 1,
        purpose: "card_cost",
      },
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "summon-target" },
        amount: 1,
        purpose: "placement",
      },
    ];

    const baseState = createEmptyGameState({
      cardInstances: [fieldCard("summon-target", 0), fieldCard("ally-soul", 1)],
      playerOverrides: [
        { reserveNormalCoreCount: 4, soulCoreLocation: { kind: "reserve" } },
      ],
    });

    const draftApplied = applyDraftCoreMoves(baseState, drafts);

    // recomposed payload を「同じ移動列」として再適用するための draft 列に変換し、
    // applyDraftCoreMoves で適用すれば同じ最終状態が得られる。
    const { paymentSources, summonEnterFieldCorePlacements } =
      recomposeSummonLegalAction(drafts);
    const replayDrafts: DraftCoreMove[] = [];
    for (const source of paymentSources) {
      if (source.kind === "reserve") {
        const normalAmount = source.amount - (source.includeSoulCore ? 1 : 0);
        if (normalAmount > 0) {
          replayDrafts.push({
            kind: "normal",
            from: { kind: "reserve", playerId: ALICE },
            to: { kind: "trash", playerId: ALICE },
            amount: normalAmount,
            purpose: "card_cost",
          });
        }
        if (source.includeSoulCore) {
          replayDrafts.push({
            kind: "soul",
            playerId: ALICE,
            from: { kind: "reserve", playerId: ALICE },
            to: { kind: "trash", playerId: ALICE },
            purpose: "card_cost",
          });
        }
      } else {
        const normalAmount = source.amount - (source.includeSoulCore ? 1 : 0);
        if (normalAmount > 0) {
          replayDrafts.push({
            kind: "normal",
            from: { kind: "card", instanceId: source.instanceId },
            to: { kind: "trash", playerId: ALICE },
            amount: normalAmount,
            purpose: "card_cost",
          });
        }
        if (source.includeSoulCore) {
          replayDrafts.push({
            kind: "soul",
            playerId: ALICE,
            from: { kind: "card", instanceId: source.instanceId },
            to: { kind: "trash", playerId: ALICE },
            purpose: "card_cost",
          });
        }
      }
    }
    for (const placement of summonEnterFieldCorePlacements) {
      switch (placement.kind) {
        case "reserve_normal":
          replayDrafts.push({
            kind: "normal",
            from: { kind: "reserve", playerId: ALICE },
            to: { kind: "card", instanceId: "summon-target" },
            amount: placement.amount,
            purpose: "placement",
          });
          break;
        case "reserve_soul":
          replayDrafts.push({
            kind: "soul",
            playerId: ALICE,
            from: { kind: "reserve", playerId: ALICE },
            to: { kind: "card", instanceId: "summon-target" },
            purpose: "placement",
          });
          break;
        case "card_normal":
          replayDrafts.push({
            kind: "normal",
            from: { kind: "card", instanceId: placement.instanceId },
            to: { kind: "card", instanceId: "summon-target" },
            amount: placement.amount,
            purpose: "placement",
          });
          break;
        case "card_soul":
          replayDrafts.push({
            kind: "soul",
            playerId: ALICE,
            from: { kind: "card", instanceId: placement.instanceId },
            to: { kind: "card", instanceId: "summon-target" },
            purpose: "placement",
          });
          break;
      }
    }
    const replayApplied = applyDraftCoreMoves(baseState, replayDrafts);

    const target1 = draftApplied.cardInstances.find(
      (c) => c.instanceId === "summon-target"
    )!;
    const target2 = replayApplied.cardInstances.find(
      (c) => c.instanceId === "summon-target"
    )!;
    const ally1 = draftApplied.cardInstances.find(
      (c) => c.instanceId === "ally-soul"
    )!;
    const ally2 = replayApplied.cardInstances.find(
      (c) => c.instanceId === "ally-soul"
    )!;
    const player1 = draftApplied.players[0]!;
    const player2 = replayApplied.players[0]!;

    expect(target2.normalCoreCount).toBe(target1.normalCoreCount);
    expect(ally2.normalCoreCount).toBe(ally1.normalCoreCount);
    expect(player2.reserveNormalCoreCount).toBe(player1.reserveNormalCoreCount);
    expect(player2.trashNormalCoreCount).toBe(player1.trashNormalCoreCount);
    expect(player2.soulCoreLocation).toEqual(player1.soulCoreLocation);
  });
});
