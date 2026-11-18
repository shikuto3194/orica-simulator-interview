/**
 * ENGINE-brave-combine-third-party-target: brave_combine_effect の合体元を
 * 発動元カード自身 (sourceInstanceId) 以外の第三者ブレイヴへ拡張する primitive の検証。
 *
 * 設計: `noop` action に `target` を持たせ、対象を解決するだけの選択専用 step として使う
 * (副作用なし、後続 step が {kind:"ref"} で参照する)。`brave_combine_effect.source:
 * {stepId}` がこの選択結果を参照すると、合体元がその動的に選ばれたブレイヴになる
 * (省略時は従来どおり sourceInstanceId 自身)。
 *
 * host 適格性 (braveCondition/多重合体上限) も、動的に選ばれたブレイヴ自身の定義を
 * 基準にする必要がある (isEligibleBraveCombineHost が SSOT)。旧実装は常に
 * 発動元カードの braveCondition を使っていたため、発動元 (例: 作戦カード) に
 * braveCondition が無い場合、本来ブレイヴ自身が課すはずの制約が無視されてしまうバグがあった。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../src/model";
import { executeEffect } from "../src/effect/effect-interpreter";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { getEffectiveBp } from "../src/index";
import type { Effect } from "../src/dsl-types";

function makeCardDef(
  cardNo: string,
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["yellow"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    ...overrides,
  };
}

function createLookup(defs: CardDefinition[]) {
  const map = new Map(defs.map((d) => [d.cardNo, d]));
  return (id: string) => map.get(id);
}

/** 選択専用 step (noop+target) → brave_combine_effect(source:ref) の2段階合体 effect。 */
const thirdPartyCombineEffect: Effect = {
  timing: { kind: "continuous" },
  steps: [
    {
      id: "select_brave",
      action: {
        kind: "noop",
        target: {
          kind: "filter",
          player: "self",
          filter: { category: ["brave"], combined: false },
          count: 1,
        },
      },
    },
    {
      action: {
        kind: "brave_combine_effect",
        source: { stepId: "select_brave" },
        target: {
          kind: "filter",
          player: "self",
          filter: { category: ["spirit"] },
          count: 1,
        },
      },
    },
  ],
};

describe("brave_combine_effect 第三者ブレイヴ合体元 (ENGINE-brave-combine-third-party-target)", () => {
  it("source 指定時は sourceInstanceId ではなく前段 step が選んだブレイヴが合体元になる", () => {
    const sourceMagicDef = makeCardDef("SRC-MAGIC", {
      printedCategory: "magic",
    });
    const braveDef = makeCardDef("BRAVE-A", { printedCategory: "brave" });
    const hostDef = makeCardDef("HOST-SPIRIT");
    const lookup = createLookup([sourceMagicDef, braveDef, hostDef]);

    const sourceCard = createCardInstance(sourceMagicDef, {
      instanceId: "src",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "brave-a",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 2,
    });
    const host = createCardInstance(hostDef, {
      instanceId: "host",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [sourceCard, brave, host],
    });

    const after = executeEffect({
      chainId: "test:brave-combine-effect-third-party-source:114",
      state,
      effect: thirdPartyCombineEffect,
      sourceInstanceId: "src",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const combinedBrave = after.cardInstances.find(
      (c) => c.instanceId === "brave-a"
    )!;
    const hostAfter = after.cardInstances.find((c) => c.instanceId === "host")!;
    const sourceAfter = after.cardInstances.find(
      (c) => c.instanceId === "src"
    )!;

    expect(combinedBrave.attachedToInstanceId).toBe("host");
    expect(hostAfter.attachedChildrenIds).toContain("brave-a");
    // 発動元カード自身 (sourceInstanceId) は合体していない。
    expect(sourceAfter.attachedToInstanceId).toBeNull();
  });

  it("host 適格性は動的に選ばれたブレイヴ自身の braveCondition を基準にする（発動元の定義ではない）", () => {
    const sourceMagicDef = makeCardDef("SRC-MAGIC2", {
      printedCategory: "magic",
      // 発動元カード自身には braveCondition が無い（旧実装ならここが制限無しとして
      // 誤って全ホストを許可してしまう）。
    });
    const braveDef = makeCardDef("BRAVE-B", {
      printedCategory: "brave",
      braveCondition: { tribes: ["地球"] },
    });
    const matchingHostDef = makeCardDef("HOST-EARTH", { tribe: "地球" });
    const nonMatchingHostDef = makeCardDef("HOST-NATURE", {
      tribe: "ネイチャー",
    });
    const lookup = createLookup([
      sourceMagicDef,
      braveDef,
      matchingHostDef,
      nonMatchingHostDef,
    ]);

    const sourceCard = createCardInstance(sourceMagicDef, {
      instanceId: "src2",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "brave-b",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 2,
    });
    const nonMatchingHost = createCardInstance(nonMatchingHostDef, {
      instanceId: "host-nature",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const matchingHost = createCardInstance(matchingHostDef, {
      instanceId: "host-earth",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      // 非適格ホストを候補列挙で先に見せて、フィルタが本当に働くか検証する。
      cardInstances: [sourceCard, brave, nonMatchingHost, matchingHost],
    });

    const after = executeEffect({
      chainId: "test:brave-combine-effect-third-party-source:192",
      state,
      effect: thirdPartyCombineEffect,
      sourceInstanceId: "src2",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const combinedBrave = after.cardInstances.find(
      (c) => c.instanceId === "brave-b"
    )!;
    // tribes:["地球"] 制約により、系統「地球」を持つホストにのみ合体できる。
    expect(combinedBrave.attachedToInstanceId).toBe("host-earth");
    const nonMatchingHostAfter = after.cardInstances.find(
      (c) => c.instanceId === "host-nature"
    )!;
    expect(nonMatchingHostAfter.attachedChildrenIds).not.toContain("brave-b");
  });

  it("source 未指定時は従来どおり sourceInstanceId 自身が合体元になる（後方互換）", () => {
    // 発動元カード自身がブレイヴであるケース (既存 BSFT01 系と同型)。
    const braveSourceDef = makeCardDef("BRAVE-SRC", {
      printedCategory: "brave",
    });
    const hostDef = makeCardDef("HOST-LEGACY");
    const lookup = createLookup([braveSourceDef, hostDef]);

    const braveSource = createCardInstance(braveSourceDef, {
      instanceId: "brave-src",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 2,
    });
    const host = createCardInstance(hostDef, {
      instanceId: "host-legacy",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [braveSource, host],
    });

    const legacyEffect: Effect = {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "brave_combine_effect",
            target: {
              kind: "filter",
              player: "self",
              filter: { category: ["spirit"] },
              count: 1,
            },
          },
        },
      ],
    };

    const after = executeEffect({
      chainId: "test:brave-combine-effect-third-party-source:257",
      state,
      effect: legacyEffect,
      sourceInstanceId: "brave-src",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });

    const combinedBrave = after.cardInstances.find(
      (c) => c.instanceId === "brave-src"
    )!;
    expect(combinedBrave.attachedToInstanceId).toBe("host-legacy");
  });

  it("選択専用 noop step は ref_succeeded/ref_executed が対象解決の成否と一致する（対象0件で誤って true にならない）", () => {
    const sourceMagicDef = makeCardDef("SRC-GATE", {
      printedCategory: "magic",
    });
    const braveDef = makeCardDef("BRAVE-GATE", { printedCategory: "brave" });
    const hostDef = makeCardDef("HOST-GATE");
    const lookup = createLookup([sourceMagicDef, braveDef, hostDef]);

    const gatedEffect: Effect = {
      timing: { kind: "continuous" },
      steps: [
        {
          id: "select_brave",
          action: {
            kind: "noop",
            target: {
              kind: "filter",
              player: "self",
              filter: { category: ["brave"], combined: false },
              count: 1,
            },
          },
        },
        {
          id: "gated_buff",
          stepCondition: { kind: "ref_succeeded", stepId: "select_brave" },
          action: {
            kind: "bp_modify",
            target: {
              kind: "filter",
              player: "self",
              filter: { category: ["spirit"] },
              count: "all",
            },
            amount: 4000,
            duration: { scope: "turn" },
          },
        },
      ],
    };

    const buildState = (includeBrave: boolean) => {
      const sourceCard = createCardInstance(sourceMagicDef, {
        instanceId: "src-gate",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
      });
      const host = createCardInstance(hostDef, {
        instanceId: "host-gate",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      });
      const cardInstances = [sourceCard, host];
      if (includeBrave) {
        cardInstances.push(
          createCardInstance(braveDef, {
            instanceId: "brave-gate",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "field",
            zoneRoleName: "brave",
            normalCoreCount: 2,
          })
        );
      }
      return createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances,
      });
    };

    // ブレイヴが存在する: 選択 step が成功 → ref_succeeded ゲートを通過し BP+4000 が乗る。
    const withBrave = executeEffect({
      chainId: "test:brave-combine-effect-third-party-source:347",
      state: buildState(true),
      effect: gatedEffect,
      sourceInstanceId: "src-gate",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const hostWithBrave = withBrave.cardInstances.find(
      (c) => c.instanceId === "host-gate"
    )!;
    expect(getEffectiveBp(withBrave, hostWithBrave, hostDef, lookup)).toBe(
      3000 + 4000
    );

    // ブレイヴが存在しない: 選択 step は対象0件で不成立 → ref_succeeded ゲートで
    // gated_buff step はスキップされ、BP+4000 は乗らない
    // (対象0件でも noop が無条件成功扱いになる旧実装ならここが誤って通ってしまう)。
    const withoutBrave = executeEffect({
      chainId: "test:brave-combine-effect-third-party-source:365",
      state: buildState(false),
      effect: gatedEffect,
      sourceInstanceId: "src-gate",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });
    const hostWithoutBrave = withoutBrave.cardInstances.find(
      (c) => c.instanceId === "host-gate"
    )!;
    expect(
      getEffectiveBp(withoutBrave, hostWithoutBrave, hostDef, lookup)
    ).toBe(3000);
  });
});
