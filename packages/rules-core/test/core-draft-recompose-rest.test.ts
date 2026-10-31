/**
 * P3-46 Phase 3 サブステップ #16-19 の recompose golden test。
 *
 * `recomposeSummonLegalAction` (#15) の入口 gate が pass した後、残 5 種の
 * recompose 関数 (magic / core_shoot / brave_separation / trash_distribution /
 * core_move) を同パターンで段階的に追加する計画 (issues/P3-46/implementation-plan.md
 * Phase 3) のうち、LegalAction payload を組み立てる #16-19 をここで goldenize する。
 *
 * #20 (core_move) は LegalAction を持たず `applyDraftCoreMoves` 直呼びで完結する
 * ため独立した recompose 関数を必要としない (検証計画 #20 参照)。
 *
 * 比較対象は以下の通り (BattleScreen.tsx の組み立てロジックと byte-equal):
 * - #16 magic:        `paymentSources` (BattleScreen.tsx:3209-3229 と同一)
 * - #17 core_shoot:   `coreShootDistribution` + optional `coreShootSoulCoreInstanceId`
 *                     (BattleScreen.tsx:3534-3540 / 3552-3558 と同一)
 * - #18 separation:   `separateCoreDistribution` + optional `separationSoulCoreSource`
 *                     (BattleScreen.tsx:3587-3606 と同一)
 * - #19 trash_dist:   `coreDistributionAllocations` + optional
 *                     `coreDistributionSoulCoreInstanceId`
 *                     (BattleScreen.tsx:4540-4552 と同一)
 */
import { describe, expect, it } from "vitest";
import {
  recomposeBraveSeparationLegalAction,
  recomposeCoreShootLegalAction,
  recomposeMagicLegalAction,
  recomposeTrashDistributionLegalAction,
} from "../src";
import type { DraftCoreMove } from "../src";

const ALICE = "player-1";
const BOB = "player-2";

describe("P3-46 #16: recomposeMagicLegalAction (マジック cost-only) golden", () => {
  it("コスト 2 全額リザーブ (最小ケース)", () => {
    // BattleScreen.tsx:3214-3218: { kind: "reserve", amount: 2 }
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "trash", playerId: ALICE },
        amount: 2,
        purpose: "card_cost",
      },
    ];

    expect(recomposeMagicLegalAction(drafts)).toEqual({
      paymentSources: [{ kind: "reserve", amount: 2 }],
    });
  });

  it("コスト 3 = リザーブ 2 + 場 1 (場混在)", () => {
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
    ];

    expect(recomposeMagicLegalAction(drafts)).toEqual({
      paymentSources: [
        { kind: "reserve", amount: 2 },
        { kind: "card", instanceId: "ally-1", amount: 1 },
      ],
    });
  });

  it("ソウルコアを場のカードから cost に含める", () => {
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
        from: { kind: "card", instanceId: "ally-soul" },
        to: { kind: "trash", playerId: ALICE },
        purpose: "card_cost",
      },
    ];

    expect(recomposeMagicLegalAction(drafts)).toEqual({
      paymentSources: [
        { kind: "reserve", amount: 1 },
        {
          kind: "card",
          instanceId: "ally-soul",
          amount: 1,
          includeSoulCore: true,
        },
      ],
    });
  });

  it("導域などのマジック支払いは場のカードから void destination を保持する", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "card", instanceId: "domain-nexus" },
        to: { kind: "void", playerId: ALICE },
        amount: 2,
        purpose: "card_cost",
      },
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "card", instanceId: "domain-nexus" },
        to: { kind: "void", playerId: ALICE },
        purpose: "card_cost",
      },
    ];

    expect(recomposeMagicLegalAction(drafts)).toEqual({
      paymentSources: [
        {
          kind: "card",
          instanceId: "domain-nexus",
          amount: 3,
          includeSoulCore: true,
          destination: "void",
        },
      ],
    });
  });

  it("placement 等の対象外 purpose は無視 (空 paymentSources)", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "summon-target" },
        amount: 1,
        purpose: "placement",
      },
    ];

    expect(recomposeMagicLegalAction(drafts)).toEqual({
      paymentSources: [],
    });
  });

  it("card_cost draft の to が trash 以外なら throw", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "x" },
        amount: 1,
        purpose: "card_cost",
      },
    ];
    expect(() => recomposeMagicLegalAction(drafts)).toThrow(
      /card_cost draft must target trash or void/
    );
  });
});

describe("P3-46 #17: recomposeCoreShootLegalAction (コアシュート) golden", () => {
  it("単一相手カードから 2 コア (最小ケース)", () => {
    // BattleScreen.tsx:3534: coreShootDistribution: pendingCoreShoot.cardAmounts
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "card", instanceId: "victim-1" },
        to: { kind: "reserve", playerId: BOB },
        amount: 2,
        purpose: "shoot",
      },
    ];

    expect(recomposeCoreShootLegalAction(drafts)).toEqual({
      coreShootDistribution: { "victim-1": 2 },
    });
  });

  it("複数相手カードへの分配 (順序保持・key 一意)", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "card", instanceId: "victim-1" },
        to: { kind: "reserve", playerId: BOB },
        amount: 1,
        purpose: "shoot",
      },
      {
        kind: "normal",
        from: { kind: "card", instanceId: "victim-2" },
        to: { kind: "reserve", playerId: BOB },
        amount: 2,
        purpose: "shoot",
      },
    ];

    expect(recomposeCoreShootLegalAction(drafts)).toEqual({
      coreShootDistribution: { "victim-1": 1, "victim-2": 2 },
    });
  });

  it("同一 source への複数 draft が合算される", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "card", instanceId: "victim-1" },
        to: { kind: "reserve", playerId: BOB },
        amount: 1,
        purpose: "shoot",
      },
      {
        kind: "normal",
        from: { kind: "card", instanceId: "victim-1" },
        to: { kind: "reserve", playerId: BOB },
        amount: 1,
        purpose: "shoot",
      },
    ];

    expect(recomposeCoreShootLegalAction(drafts)).toEqual({
      coreShootDistribution: { "victim-1": 2 },
    });
  });

  it("ソウルコア指定付き (相手 card → trash)", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "card", instanceId: "victim-1" },
        to: { kind: "trash", playerId: BOB },
        amount: 1,
        purpose: "shoot",
      },
      {
        kind: "soul",
        playerId: BOB,
        from: { kind: "card", instanceId: "victim-1" },
        to: { kind: "trash", playerId: BOB },
        purpose: "shoot",
      },
    ];

    expect(recomposeCoreShootLegalAction(drafts)).toEqual({
      coreShootDistribution: { "victim-1": 1 },
      coreShootSoulCoreInstanceId: "victim-1",
    });
  });

  it("対象外 purpose (card_cost 等) は無視", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "trash", playerId: ALICE },
        amount: 1,
        purpose: "card_cost",
      },
    ];

    expect(recomposeCoreShootLegalAction(drafts)).toEqual({
      coreShootDistribution: {},
    });
  });

  it("reserve シュート draft は reserve:<playerId> sentinel キーに集約する (BSTH001-X01)", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: BOB },
        to: { kind: "void", playerId: BOB },
        amount: 2,
        purpose: "shoot",
      },
    ];
    expect(recomposeCoreShootLegalAction(drafts)).toEqual({
      coreShootDistribution: { [`reserve:${BOB}`]: 2 },
    });
  });

  it("reserve ソウルシュート draft は所在 sentinel を保持する", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "soul",
        playerId: BOB,
        from: { kind: "reserve", playerId: BOB },
        to: { kind: "void", playerId: BOB },
        purpose: "shoot",
      },
    ];
    expect(recomposeCoreShootLegalAction(drafts)).toEqual({
      coreShootDistribution: {},
      coreShootSoulCoreInstanceId: `reserve:${BOB}`,
    });
  });

  it("複数 soul draft で throw", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "soul",
        playerId: BOB,
        from: { kind: "card", instanceId: "victim-1" },
        to: { kind: "trash", playerId: BOB },
        purpose: "shoot",
      },
      {
        kind: "soul",
        playerId: BOB,
        from: { kind: "card", instanceId: "victim-2" },
        to: { kind: "trash", playerId: BOB },
        purpose: "shoot",
      },
    ];
    expect(() => recomposeCoreShootLegalAction(drafts)).toThrow(
      /only one soul-core draft is allowed/
    );
  });
});

describe("P3-46 #18: recomposeBraveSeparationLegalAction (ブレイヴ分離) golden", () => {
  it("リザーブから 1 コア補填 (最小ケース)", () => {
    // BattleScreen.tsx:3587: separateCoreDistribution: pendingSeparation.coreDistribution
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "brave-1" },
        amount: 1,
        purpose: "separation",
      },
    ];

    expect(recomposeBraveSeparationLegalAction(drafts)).toEqual({
      separateCoreDistribution: { reserve: 1 },
      braveInstanceId: "brave-1",
    });
  });

  it("リザーブ 1 + 場カード 2 から補填 (混在)", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "brave-1" },
        amount: 1,
        purpose: "separation",
      },
      {
        kind: "normal",
        from: { kind: "card", instanceId: "ally-1" },
        to: { kind: "card", instanceId: "brave-1" },
        amount: 2,
        purpose: "separation",
      },
    ];

    expect(recomposeBraveSeparationLegalAction(drafts)).toEqual({
      separateCoreDistribution: { reserve: 1, "ally-1": 2 },
      braveInstanceId: "brave-1",
    });
  });

  it("ソウルコア補填 (リザーブから)", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "brave-1" },
        amount: 1,
        purpose: "separation",
      },
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "brave-1" },
        purpose: "separation",
      },
    ];

    expect(recomposeBraveSeparationLegalAction(drafts)).toEqual({
      separateCoreDistribution: { reserve: 1 },
      separationSoulCoreSource: "reserve",
      braveInstanceId: "brave-1",
    });
  });

  it("ソウルコア補填 (場のカードから)", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "card", instanceId: "ally-soul" },
        to: { kind: "card", instanceId: "brave-1" },
        purpose: "separation",
      },
    ];

    expect(recomposeBraveSeparationLegalAction(drafts)).toEqual({
      separateCoreDistribution: {},
      separationSoulCoreSource: "ally-soul",
      braveInstanceId: "brave-1",
    });
  });

  it("同一 source への複数 normal draft が合算される", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "brave-1" },
        amount: 1,
        purpose: "separation",
      },
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "brave-1" },
        amount: 2,
        purpose: "separation",
      },
    ];

    expect(recomposeBraveSeparationLegalAction(drafts)).toEqual({
      separateCoreDistribution: { reserve: 3 },
      braveInstanceId: "brave-1",
    });
  });

  it("空 (purpose 一致 draft なし) は braveInstanceId null", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "trash", playerId: ALICE },
        amount: 1,
        purpose: "card_cost",
      },
    ];

    expect(recomposeBraveSeparationLegalAction(drafts)).toEqual({
      separateCoreDistribution: {},
      braveInstanceId: null,
    });
  });

  it("複数の brave 宛先で throw (誤入力検出)", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "brave-1" },
        amount: 1,
        purpose: "separation",
      },
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "brave-2" },
        amount: 1,
        purpose: "separation",
      },
    ];
    expect(() => recomposeBraveSeparationLegalAction(drafts)).toThrow(
      /must share one brave instanceId/
    );
  });

  it("to が card 以外で throw", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "trash", playerId: ALICE },
        amount: 1,
        purpose: "separation",
      },
    ];
    expect(() => recomposeBraveSeparationLegalAction(drafts)).toThrow(
      /separation draft must target a card/
    );
  });

  it("複数 soul draft で throw", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "brave-1" },
        purpose: "separation",
      },
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "card", instanceId: "ally-soul" },
        to: { kind: "card", instanceId: "brave-1" },
        purpose: "separation",
      },
    ];
    expect(() => recomposeBraveSeparationLegalAction(drafts)).toThrow(
      /only one soul-core draft is allowed/
    );
  });
});

describe("P3-46 #19: recomposeTrashDistributionLegalAction (トラッシュ→フィールド配分) golden", () => {
  it("単一カードに 1 コア配分 (最小ケース)", () => {
    // BattleScreen.tsx:4545: coreDistributionAllocations: trashDistAllocations
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "trash", playerId: ALICE },
        to: { kind: "card", instanceId: "ally-1" },
        amount: 1,
        purpose: "trash_distribution",
      },
    ];

    expect(recomposeTrashDistributionLegalAction(drafts)).toEqual({
      coreDistributionAllocations: { "ally-1": 1 },
      coreDistributionSourceAllocations: { trash: 1 },
    });
  });

  it("複数カード配分 + ソウルコア配置 (BSTH01-M01 典型ケース)", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "trash", playerId: ALICE },
        to: { kind: "card", instanceId: "ally-1" },
        amount: 2,
        purpose: "trash_distribution",
      },
      {
        kind: "normal",
        from: { kind: "trash", playerId: ALICE },
        to: { kind: "card", instanceId: "ally-2" },
        amount: 1,
        purpose: "trash_distribution",
      },
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "trash", playerId: ALICE },
        to: { kind: "card", instanceId: "ally-1" },
        purpose: "trash_distribution",
      },
    ];

    expect(recomposeTrashDistributionLegalAction(drafts)).toEqual({
      coreDistributionAllocations: { "ally-1": 2, "ally-2": 1 },
      coreDistributionSoulCoreAllocations: { "ally-1": 1 },
      coreDistributionSoulCoreInstanceId: "ally-1",
      coreDistributionSourceAllocations: { trash: 3 },
      coreDistributionSoulCoreSourceAllocations: { trash: 1 },
    });
  });

  it("同一 destination への複数 normal draft が合算される", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "trash", playerId: ALICE },
        to: { kind: "card", instanceId: "ally-1" },
        amount: 1,
        purpose: "trash_distribution",
      },
      {
        kind: "normal",
        from: { kind: "trash", playerId: ALICE },
        to: { kind: "card", instanceId: "ally-1" },
        amount: 1,
        purpose: "trash_distribution",
      },
    ];

    expect(recomposeTrashDistributionLegalAction(drafts)).toEqual({
      coreDistributionAllocations: { "ally-1": 2 },
      coreDistributionSourceAllocations: { trash: 2 },
    });
  });

  it("対象外 purpose (placement 等) は無視 (空 allocations)", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "ally-1" },
        amount: 1,
        purpose: "placement",
      },
    ];

    expect(recomposeTrashDistributionLegalAction(drafts)).toEqual({
      coreDistributionAllocations: {},
    });
  });

  it("P3-47 F-5: from が reserve / life / card でも multi-source として正常 recompose", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "ally-1" },
        amount: 1,
        purpose: "trash_distribution",
      },
      {
        kind: "normal",
        from: { kind: "life", playerId: ALICE },
        to: { kind: "card", instanceId: "ally-1" },
        amount: 1,
        purpose: "trash_distribution",
      },
      {
        kind: "normal",
        from: { kind: "card", instanceId: "host" },
        to: { kind: "card", instanceId: "ally-2" },
        amount: 1,
        purpose: "trash_distribution",
      },
      {
        kind: "normal",
        from: { kind: "trash", playerId: ALICE },
        to: { kind: "card", instanceId: "ally-2" },
        amount: 1,
        purpose: "trash_distribution",
      },
    ];
    const result = recomposeTrashDistributionLegalAction(drafts);
    expect(result.coreDistributionAllocations).toEqual({
      "ally-1": 2,
      "ally-2": 2,
    });
    expect(result.coreDistributionSourceAllocations).toEqual({
      reserve: 1,
      life: 1,
      "field:host": 1,
      trash: 1,
    });
  });

  it("P3-47 F-5: from が trash のみでも sourceAllocations は emit (single-source apply は無視するので安全)", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "trash", playerId: ALICE },
        to: { kind: "card", instanceId: "ally-1" },
        amount: 2,
        purpose: "trash_distribution",
      },
    ];
    const result = recomposeTrashDistributionLegalAction(drafts);
    expect(result.coreDistributionAllocations).toEqual({ "ally-1": 2 });
    expect(result.coreDistributionSourceAllocations).toEqual({ trash: 2 });
  });

  it("P3-47 F-5: from が void の single-source 配分も GUI recompose で throw しない", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "void", playerId: ALICE },
        to: { kind: "card", instanceId: "ally-1" },
        amount: 2,
        purpose: "trash_distribution",
      },
    ];
    const result = recomposeTrashDistributionLegalAction(drafts);
    expect(result.coreDistributionAllocations).toEqual({ "ally-1": 2 });
    expect(result.coreDistributionSourceAllocations).toEqual({ void: 2 });
  });

  it("normal draft 0 件 (soul のみ) なら通常 sourceAllocations は省略し soul source は emit", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "trash", playerId: ALICE },
        to: { kind: "card", instanceId: "ally-1" },
        purpose: "trash_distribution",
      },
    ];
    const result = recomposeTrashDistributionLegalAction(drafts);
    expect(result.coreDistributionAllocations).toEqual({});
    expect(result.coreDistributionSoulCoreAllocations).toEqual({
      "ally-1": 1,
    });
    expect(result.coreDistributionSoulCoreInstanceId).toBe("ally-1");
    expect(result.coreDistributionSourceAllocations).toBeUndefined();
    expect(result.coreDistributionSoulCoreSourceAllocations).toEqual({
      trash: 1,
    });
  });

  it("to が card 以外なら throw", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "normal",
        from: { kind: "trash", playerId: ALICE },
        to: { kind: "reserve", playerId: ALICE },
        amount: 1,
        purpose: "trash_distribution",
      },
    ];
    expect(() => recomposeTrashDistributionLegalAction(drafts)).toThrow(
      /trash_distribution draft must target a card/
    );
  });

  it("複数 soul draft は宛先別 allocations に合算される", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "trash", playerId: ALICE },
        to: { kind: "card", instanceId: "ally-1" },
        purpose: "trash_distribution",
      },
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "trash", playerId: ALICE },
        to: { kind: "card", instanceId: "ally-2" },
        purpose: "trash_distribution",
      },
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "trash", playerId: ALICE },
        to: { kind: "card", instanceId: "ally-2" },
        purpose: "trash_distribution",
      },
    ];
    const result = recomposeTrashDistributionLegalAction(drafts);
    expect(result.coreDistributionAllocations).toEqual({});
    expect(result.coreDistributionSoulCoreAllocations).toEqual({
      "ally-1": 1,
      "ally-2": 2,
    });
    expect(result.coreDistributionSoulCoreSourceAllocations).toEqual({
      trash: 3,
    });
    expect(result.coreDistributionSoulCoreInstanceId).toBeUndefined();
  });

  it("P3-47 F-5: 複数 soul draft は source 別 allocations に合算される", () => {
    const drafts: DraftCoreMove[] = [
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "ally-1" },
        purpose: "trash_distribution",
      },
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "card", instanceId: "source-card" },
        to: { kind: "card", instanceId: "ally-2" },
        purpose: "trash_distribution",
      },
      {
        kind: "soul",
        playerId: ALICE,
        from: { kind: "reserve", playerId: ALICE },
        to: { kind: "card", instanceId: "ally-2" },
        purpose: "trash_distribution",
      },
    ];
    const result = recomposeTrashDistributionLegalAction(drafts);
    expect(result.coreDistributionSoulCoreAllocations).toEqual({
      "ally-1": 1,
      "ally-2": 2,
    });
    expect(result.coreDistributionSoulCoreSourceAllocations).toEqual({
      reserve: 2,
      "field:source-card": 1,
    });
  });
});
