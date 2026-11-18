import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardInstance, GameState, LegalAction } from "../src";
import { getEffectAdventPaymentChoiceOptions } from "../src/mechanics/host-dual-advent";
import {
  listAdventUsage,
  seedAdventUsage,
} from "./helpers/advent-usage-fixture";

// 実プレイ指摘(2026-11-03 snapshot): CX01 が 孫悟空 の煌臨元になっていてスロットが
// 埋まっている盤面で、手札の超サイヤ人3 孫悟空(X01、契約煌臨)を宣言すると、
// 〔ターンに1回:同名〕の「置いたものとして」が未使用なのに実ソウルコアが強制消費された。
// 手札宣言の擬制選択肢が「CX01 自身が煌臨先」の場合にしか出なかったため。
// 正源: 10_rules/08a5_as-if-soul-core-permissions.md

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const getCardDefinitionById = (id: string) => definitions.get(id);
const lookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredBattleImmediateEffectActions: () => [],
};

function instance(
  cardNo: string,
  instanceId: string,
  zone: CardInstance["zone"],
  cores = 0
): CardInstance {
  return createCardInstance(definitions.get(cardNo)!, {
    instanceId,
    ownerPlayerId: "alice",
    zone,
    normalCoreCount: cores,
  });
}
function actions(state: GameState, actingPlayerId = "alice") {
  return getLegalActions({ state, actingPlayerId, ...lookups });
}
function act(
  state: GameState,
  action: LegalAction,
  targetInstanceIds?: string[]
) {
  return applyLegalAction({
    state,
    action,
    ...lookups,
    ...(targetInstanceIds ? { targetInstanceIds } : {}),
  }).state;
}
function passWindow(state: GameState) {
  let current = state;
  for (let i = 0; current.stackWindow && i < 10; i++) {
    const pass = actions(current, current.stackWindow.priorityPlayerId).find(
      (action) => action.kind === "pass_stack"
    );
    expect(pass).toBeDefined();
    current = act(current, pass!);
  }
  expect(current.stackWindow).toBeNull();
  return current;
}
function resolveTarget(state: GameState, targetId: string) {
  const resolve = actions(state).find(
    (action) => action.kind === "resolve_pending_effect_target"
  );
  expect(resolve).toBeDefined();
  return act(state, resolve!, [targetId]);
}

type SoulCore = "reserve" | "none";

/**
 * CX01 が 孫悟空(C01) の煌臨元になっている盤面 + 手札に X01。
 * 孫悟空スロットは C01 で充足済みなので、CX01 自身を煌臨先にする host 指定は成立しない。
 */
function position(soul: SoulCore, permissionUsed = false): GameState {
  const c01: CardInstance = {
    ...instance("BSDB01-C01", "goku", "field", 3),
    underCards: [{ role: "advent_source", cardInstanceId: "cx01" }],
  };
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      instance("BSDB01-CX01", "cx01", "field"),
      c01,
      instance("BSDB01-X01", "x01", "hand"),
    ],
    playerOverrides: [
      {
        handCount: 1,
        countValue: 13,
        reserveNormalCoreCount: 0,
        ...(soul === "reserve"
          ? {
              soulCoreLocation: { kind: "reserve" },
              reserveSoulCoreCount: 1,
              trashSoulCoreCount: 0,
            }
          : {
              soulCoreLocation: { kind: "trash" },
              reserveSoulCoreCount: 0,
              trashSoulCoreCount: 1,
            }),
      },
      {},
    ],
  });
  const ready: GameState = {
    ...state,
    step: "main",
    window: "none",
    activePlayerId: "alice",
  };
  // 許可元(CX01)の〔ターンに1回:同名〕を使用済みにする: 実際に擬制煌臨を成立させた後と同じ枠。
  return permissionUsed
    ? seedAdventUsage(ready, {
        kind: "alternate_cost",
        actingPlayerId: "alice",
        instanceId: "cx01",
        definition: definitions.get("BSDB01-CX01")!,
      })
    : ready;
}

/** CX01(許可元)の擬制枠: 使用者 alice の同名枠 1 件だけが記録されている。 */
function expectPermissionUsedByAlice(state: GameState) {
  expect(listAdventUsage(state)).toEqual([
    expect.objectContaining({
      kind: "alternate_cost",
      share: "card_name",
      period: "turn",
      playerId: "alice",
      nameKey: "孫悟空＆ベジータ",
      amount: 1,
    }),
  ]);
}

function declareX01(state: GameState): GameState {
  const declaration = actions(state).find(
    (action) =>
      action.kind === "declare_advent" && action.sourceInstanceId === "x01"
  );
  expect(declaration).toBeDefined();
  return passWindow(act(state, declaration!));
}

function soulCoreLocation(state: GameState) {
  return state.players.find((p) => p.id === "alice")?.soulCoreLocation;
}

describe("手札の契約煌臨宣言: 常時の擬制許可は対象に関係なく支払いを置換する", () => {
  it("実ソウルコアと未使用のCX01許可が両立するとき、窓後に支払い方法を選ばせる(強制消費しない)", () => {
    const ready = declareX01(position("reserve"));
    expect(ready.pendingAsIfSoulCoreChoice).not.toBeNull();
    expect(
      ready.pendingAsIfSoulCoreChoice!.options.map((option) => ({
        useAlternateCost: option.useAlternateCost,
        paymentOnly: option.paymentOnly === true,
        host: option.proxySourceInstanceId,
      }))
    ).toEqual([
      { useAlternateCost: false, paymentOnly: false, host: undefined },
      { useAlternateCost: true, paymentOnly: true, host: "cx01" },
    ]);
    // 同じ文言の選択肢を重ねない。
    const labels = ready.pendingAsIfSoulCoreChoice!.options.map((o) => o.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("「置いたものとして」を選ぶと、ソウルコアを動かさず、孫悟空へ煌臨し、CX01の回数を記録する", () => {
    const ready = declareX01(position("reserve"));
    const choice = actions(ready).find(
      (action) =>
        action.kind === "resolve_pending_as_if_soul_core_choice" &&
        action.choiceId === "permission:cx01:alternate"
    );
    expect(choice).toBeDefined();
    const targeting = act(ready, choice!);
    expect(
      targeting.pendingEffectTargetSelection?.candidateInstanceIds
    ).toEqual(["goku"]);
    const resolved = resolveTarget(targeting, "goku");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "x01")
    ).toMatchObject({
      zone: "field",
      // 煌臨元スタックはフラットに保持される(goku の下の cx01 も引き継ぐ)。
      underCards: [
        { role: "advent_source", cardInstanceId: "goku" },
        { role: "advent_source", cardInstanceId: "cx01" },
      ],
    });
    expect(soulCoreLocation(resolved)).toEqual({ kind: "reserve" });
    expectPermissionUsedByAlice(resolved);
  });

  it("「ソウルコアを置いて煌臨」を選ぶと従来どおり実消費し、許可の回数は消費しない", () => {
    const ready = declareX01(position("reserve"));
    const choice = actions(ready).find(
      (action) =>
        action.kind === "resolve_pending_as_if_soul_core_choice" &&
        action.choiceId === "normal"
    );
    expect(choice).toBeDefined();
    const resolved = resolveTarget(act(ready, choice!), "goku");
    expect(soulCoreLocation(resolved)).toEqual({ kind: "trash" });
    expect(listAdventUsage(resolved)).toEqual([]);
  });

  it("実ソウルコアが無くても許可だけで宣言でき、選択なしで擬制になる", () => {
    const state = position("none");
    const ready = declareX01(state);
    expect(ready.pendingAsIfSoulCoreChoice).toBeNull();
    const resolved = resolveTarget(ready, "goku");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "x01")?.zone
    ).toBe("field");
    expect(soulCoreLocation(resolved)).toEqual({ kind: "trash" });
    expectPermissionUsedByAlice(resolved);
  });

  it("このターンに許可を使用済みなら、擬制は提示せず従来の実消費だけになる", () => {
    const used = position("reserve", true);
    const ready = declareX01(used);
    expect(ready.pendingAsIfSoulCoreChoice).toBeNull();
    const resolved = resolveTarget(ready, "goku");
    expect(soulCoreLocation(resolved)).toEqual({ kind: "trash" });
    // 使用済みで実ソウルコアも無ければ宣言できない。
    expect(
      actions(position("none", true)).some(
        (action) => action.kind === "declare_advent"
      )
    ).toBe(false);
  });

  it("窓中に許可元が失われたら、擬制は提示されず回数も記録されない", () => {
    const state = position("none");
    const declaration = actions(state).find(
      (action) => action.kind === "declare_advent"
    )!;
    const declared = act(state, declaration);
    const lost: GameState = {
      ...declared,
      cardInstances: declared.cardInstances.map((card) =>
        card.instanceId === "cx01" ? { ...card, zone: "trash" as const } : card
      ),
    };
    const result = passWindow(lost);
    expect(result.pendingEffectTargetSelection).toBeNull();
    expect(result.cardInstances.find((c) => c.instanceId === "x01")?.zone).toBe(
      "hand"
    );
    expect(listAdventUsage(result)).toEqual([]);
  });

  // 名前がスロット(孫悟空)に合う通常煌臨でも、許可は契約煌臨の支払いだけを置換する。
  // 実在の通常煌臨は名前がスロットに合わず契約限定ガードに到達しないため、合成定義で縛る。
  it("孫悟空名の通常煌臨(合成)は、許可元が成立しても実ソウルコア無しでは宣言できない", () => {
    const contract = definitions.get("BSDB01-X01")!;
    const syntheticNo = "TEST-NORMAL-GOKU";
    definitions.set(syntheticNo, {
      ...contract,
      cardNo: syntheticNo,
      adventData: { ...contract.adventData!, adventVariant: "normal" },
    });
    try {
      const withCard = (soul: SoulCore): GameState => {
        const base = position(soul);
        return {
          ...base,
          cardInstances: [
            ...base.cardInstances.filter((c) => c.instanceId !== "x01"),
            instance(syntheticNo, "x01", "hand"),
          ],
        };
      };
      const declares = (state: GameState) =>
        actions(state).some(
          (action) =>
            action.kind === "declare_advent" &&
            action.sourceInstanceId === "x01"
        );
      expect(declares(withCard("reserve"))).toBe(true);
      expect(declares(withCard("none"))).toBe(false);
      const state = withCard("reserve");
      const declaration = actions(state).find(
        (action) =>
          action.kind === "declare_advent" && action.sourceInstanceId === "x01"
      )!;
      const ready = passWindow(act(state, declaration));
      expect(ready.pendingAsIfSoulCoreChoice).toBeNull();
    } finally {
      definitions.delete(syntheticNo);
    }
  });

  // 実在する通常煌臨(契約でない)に、条件を満たす煌臨先を置く。許可元(CX01)は契約煌臨の
  // 支払いだけを置換するので、通常煌臨の宣言可否・選択肢を変えてはならない。
  it.each([["BSTH01-XX02"], ["BSSG01-X04"]])(
    "契約煌臨でない通常煌臨 %s には許可を適用しない",
    (normalNo) => {
      const normal = definitions.get(normalNo)!;
      const condition = normal.adventData!.adventCondition;
      expect(normal.adventData!.adventVariant ?? "normal").toBe("normal");
      const target = ALL_CARDS.find(
        (card) =>
          card.printedCategory === "spirit" &&
          (condition.minCost === undefined || card.cost >= condition.minCost) &&
          (condition.tribes === undefined ||
            condition.tribes.some((tribe) => card.tribe?.includes(tribe))) &&
          (condition.cardNames === undefined ||
            condition.cardNames.every((match) =>
              "contains" in match ? card.name.includes(match.contains) : false
            ))
      );
      expect(target).toBeDefined();
      const build = (soul: SoulCore): GameState => {
        const base = position(soul);
        return {
          ...base,
          cardInstances: [
            instance("BSDB01-CX01", "cx01", "field", 1),
            instance(target!.cardNo, "target", "field", 3),
            instance(normalNo, "normal-advent", "hand"),
          ],
        };
      };
      const declares = (state: GameState) =>
        actions(state).some(
          (action) =>
            action.kind === "declare_advent" &&
            action.sourceInstanceId === "normal-advent"
        );
      // 盤面の妥当性: 実ソウルコアがあれば通常煌臨は宣言できる。
      expect(declares(build("reserve"))).toBe(true);
      // 実ソウルコアが無ければ、許可元が成立していても通常煌臨は宣言できない。
      expect(declares(build("none"))).toBe(false);
      // 実ソウルコアがあるとき、支払い置換の選択肢は出ない(通常支払いのみ)。
      const state = build("reserve");
      const declaration = actions(state).find(
        (action) =>
          action.kind === "declare_advent" &&
          action.sourceInstanceId === "normal-advent"
      )!;
      const ready = passWindow(act(state, declaration));
      expect(ready.pendingAsIfSoulCoreChoice).toBeNull();
      expect(
        ready.pendingEffectTargetSelection?.deferredStack
          ?.adventAsIfPermissionHostInstanceId
      ).toBeUndefined();
      expect(
        ready.pendingEffectTargetSelection?.deferredStack
          ?.adventUseAlternateCost
      ).not.toBe(true);
    }
  );
});

// 再発防止: 常時の擬制許可の適用可否は、効果内煌臨(R02 等)と手札宣言で食い違ってはならない。
// 2026-11-02 は効果内煌臨だけ、2026-11-03 は手札宣言だけが許可を取りこぼしていた。
// 同じ盤面・同じ許可元・実ソウルコアなしで、両経路の「擬制で煌臨できるか」が一致することを縛る。
describe("常時の擬制許可: 効果内煌臨と手札宣言で可否が一致する", () => {
  const variants: Array<[string, () => GameState]> = [
    [
      "CX01が煌臨元でスロット充足済み(2026-11-03 実プレイ盤面)",
      () => position("none"),
    ],
    [
      "CX01が通常フィールド現在面でスロット空き",
      () => {
        const base = position("none");
        return {
          ...base,
          cardInstances: [
            instance("BSDB01-CX01", "cx01", "field", 1),
            instance("BSDB01-X01", "x01", "hand"),
          ],
        };
      },
    ],
    [
      "CX01が魂状態",
      () => {
        const base = position("none");
        return {
          ...base,
          cardInstances: [
            instance("BSDB01-CX01", "cx01", "field"),
            instance("BSDB01-X01", "x01", "hand"),
          ],
          players: base.players.map((player) =>
            player.id === "alice"
              ? { ...player, soulStateInstanceIds: ["cx01"] }
              : player
          ),
        };
      },
    ],
    ["許可を今ターン使用済み", () => position("none", true)],
    [
      "許可元が場にない",
      () => {
        const base = position("none");
        return {
          ...base,
          cardInstances: base.cardInstances.filter(
            (c) => c.instanceId !== "cx01"
          ),
        };
      },
    ],
  ];

  it.each(variants)("%s", (_name, build) => {
    const state = build();
    const effectOffersAlternate = getEffectAdventPaymentChoiceOptions(
      state,
      "alice",
      [definitions.get("BSDB01-X01")!],
      getCardDefinitionById
    ).some((option) => option.useAlternateCost === true);

    const declaration = actions(state).find(
      (action) =>
        action.kind === "declare_advent" && action.sourceInstanceId === "x01"
    );
    let declareOffersAlternate = false;
    if (declaration) {
      const ready = passWindow(act(state, declaration));
      declareOffersAlternate =
        ready.pendingAsIfSoulCoreChoice?.options.some(
          (option) => option.useAlternateCost === true
        ) ??
        ready.pendingEffectTargetSelection?.deferredStack
          ?.adventUseAlternateCost === true;
    }
    expect(declareOffersAlternate).toBe(effectOffersAlternate);
  });
});

// CX01 が通常のフィールド現在面にいて空きスロットがある基本形。
// 以前は擬制が「CX01 自身への煌臨」にしか使えず、場の別の孫悟空へは実ソウルコア強制だった。
describe("CX01が場にいて空きスロットがある基本形でも、別の孫悟空へ擬制で煌臨できる", () => {
  function openSlotPosition(soul: SoulCore): GameState {
    const base = position(soul);
    return {
      ...base,
      cardInstances: [
        instance("BSDB01-CX01", "cx01", "field", 1),
        instance("BSDB01-C01", "goku", "field", 3),
        instance("BSDB01-X01", "x01", "hand"),
      ],
    };
  }

  function chooseAlternate(ready: GameState): GameState {
    const choice = actions(ready).find(
      (action) =>
        action.kind === "resolve_pending_as_if_soul_core_choice" &&
        action.choiceId === "permission:cx01:alternate"
    );
    expect(choice).toBeDefined();
    return act(ready, choice!);
  }

  it("選択肢は通常と置いたものとしての2つで、同文言を重ねない", () => {
    const ready = declareX01(openSlotPosition("reserve"));
    const options = ready.pendingAsIfSoulCoreChoice!.options;
    expect(options.map((option) => option.useAlternateCost)).toEqual([
      false,
      true,
    ]);
    expect(new Set(options.map((o) => o.label)).size).toBe(options.length);
  });

  it("煌臨先候補は別の孫悟空と許可元自身の両方", () => {
    const targeting = chooseAlternate(declareX01(openSlotPosition("reserve")));
    expect(
      [...targeting.pendingEffectTargetSelection!.candidateInstanceIds].sort()
    ).toEqual(["cx01", "goku"]);
  });

  it("別の孫悟空へ擬制で煌臨: ソウルコアを動かさず、CX01の回数を記録する", () => {
    const targeting = chooseAlternate(declareX01(openSlotPosition("reserve")));
    const resolved = resolveTarget(targeting, "goku");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "x01")
    ).toMatchObject({
      zone: "field",
      underCards: [{ role: "advent_source", cardInstanceId: "goku" }],
    });
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "cx01")?.zone
    ).toBe("field");
    expect(soulCoreLocation(resolved)).toEqual({ kind: "reserve" });
    expectPermissionUsedByAlice(resolved);
  });

  it("許可元自身へ擬制で煌臨: 従来どおりCX01を煌臨元に残し、ソウルコアを動かさない", () => {
    const targeting = chooseAlternate(declareX01(openSlotPosition("reserve")));
    const resolved = resolveTarget(targeting, "cx01");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "x01")
    ).toMatchObject({
      zone: "field",
      underCards: [{ role: "advent_source", cardInstanceId: "cx01" }],
    });
    expect(soulCoreLocation(resolved)).toEqual({ kind: "reserve" });
    expectPermissionUsedByAlice(resolved);
  });

  it("実ソウルコアが無くても、別の孫悟空へ擬制で煌臨できる", () => {
    const ready = declareX01(openSlotPosition("none"));
    expect(ready.pendingAsIfSoulCoreChoice).toBeNull();
    const resolved = resolveTarget(ready, "goku");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "x01")?.zone
    ).toBe("field");
    expect(soulCoreLocation(resolved)).toEqual({ kind: "trash" });
  });
});
