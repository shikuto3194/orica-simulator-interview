/**
 * P3-170 V10 (I08): ミラージュ「セット可能枚数に数えない」免除の使用枠。
 *
 * 実カード BSTH002-C01「化け化け」(免除あり) と BSTH002-C04 (免除なしの通常ミラージュ) で、
 *  - 免除の使用枠と通常セットの行動枠 (mirageSetPlayerIdsThisTurn) が独立していること
 *  - 免除の適用 / 辞退(宣言後の不成立) / 再適用
 * を検査する。免除は共通の使用会計 (effectAccounting) に「使用者 × 同名(cardNo) × ターン」で記録され、
 * 判定は宣言時、記録は解決時 (10_rules/08c、2026-10-24 ユーザー訂正)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  getMirageSetBlockReason,
  resolveDeferredSetMirageStack,
  useSetMirageAsAction,
  useSetMirageInStackContextAsAction,
} from "../src";
import type { CardDefinition, GameState } from "../src";
import {
  listMirageSetCountExemptionsUsed,
  seedMirageSetCountExemptionUsed,
} from "./helpers/mirage-exemption-fixture";
import {
  listEffectUsage,
  pruneExpiredEffectUsageForTest,
} from "./helpers/effect-usage-fixture";

const ALICE = "alice";
const BOB = "bob";
const C01 = ALL_CARDS.find((card) => card.cardNo === "BSTH002-C01")!;
const C04 = ALL_CARDS.find((card) => card.cardNo === "BSTH002-C04")!;
const lookup = (id: string): CardDefinition | undefined =>
  ALL_CARDS.find((card) => card.cardNo === id);
const actionLookups = {
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredBurstActions: () => [],
} as const;
const PAY = [{ kind: "reserve" as const, amount: 2 }];
const EXEMPTION_ENTRY = { playerId: ALICE, cardNo: C01.cardNo };

function hand(definition: CardDefinition, instanceId: string, owner = ALICE) {
  return createCardInstance(definition, {
    instanceId,
    ownerPlayerId: owner,
    zone: "hand",
  });
}

function fixture(): GameState {
  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      playerOverrides: [
        { reserveNormalCoreCount: 12 },
        { reserveNormalCoreCount: 12 },
      ],
      cardInstances: [
        hand(C01, "c01-a"),
        hand(C01, "c01-b"),
        hand(C04, "c04-a"),
        hand(C04, "c04-b"),
        hand(C01, "bob-c01", BOB),
      ],
    }),
    activePlayerId: ALICE,
    step: "main",
  };
}

function blockReason(
  state: GameState,
  sourceInstanceId: string,
  player = ALICE
) {
  return getMirageSetBlockReason({
    state,
    actingPlayerId: player,
    sourceInstanceId,
    getCardDefinitionById: lookup,
  });
}

function setMirage(state: GameState, sourceInstanceId: string, player = ALICE) {
  return useSetMirageAsAction({
    state,
    actingPlayerId: player,
    sourceInstanceId,
    paymentSources: PAY,
    getCardDefinitionById: lookup,
    replacedMirageInstanceIds: [],
    ...actionLookups,
  }).state;
}

describe("V10 I08: 免除の使用枠と通常セットの行動枠は独立している", () => {
  it("免除を使ったセットは通常セット枠を消費せず、使用枠だけに記録される", () => {
    const state = setMirage(fixture(), "c01-a");
    expect(state.mirageSetPlayerIdsThisTurn).toEqual([]);
    expect(listMirageSetCountExemptionsUsed(state)).toEqual([EXEMPTION_ENTRY]);
    // 共通会計上の識別: 使用者 × 同名(cardNo) × ターン、回数1。
    expect(
      listEffectUsage(state).filter(
        (entry) => entry.label === "mirageData.exemptSetCountLimits"
      )
    ).toEqual([
      expect.objectContaining({
        share: "card_name",
        period: "turn",
        playerId: ALICE,
        nameKey: C01.cardNo,
        amount: 1,
      }),
    ]);
  });

  it("免除後も通常セット枠は未使用のまま使え、通常セットは免除の使用枠を変えない", () => {
    let state = setMirage(fixture(), "c01-a");
    expect(blockReason(state, "c04-a")).toBeNull();
    const exemptionBefore = listMirageSetCountExemptionsUsed(state);
    state = setMirage(state, "c04-a");
    expect(state.mirageSetPlayerIdsThisTurn).toEqual([ALICE]);
    expect(listMirageSetCountExemptionsUsed(state)).toEqual(exemptionBefore);
  });

  it("通常セットで通常枠を使い切った後でも、未使用の免除は適用できる(逆順)", () => {
    let state = setMirage(fixture(), "c04-a");
    expect(state.mirageSetPlayerIdsThisTurn).toEqual([ALICE]);
    expect(listMirageSetCountExemptionsUsed(state)).toEqual([]);
    // 通常枠は埋まっているが、手札の化け化けは免除でセットできる。
    expect(blockReason(state, "c01-a")).toBeNull();
    state = setMirage(state, "c01-a");
    // 免除の適用は通常枠を増やさない。
    expect(state.mirageSetPlayerIdsThisTurn).toEqual([ALICE]);
    expect(listMirageSetCountExemptionsUsed(state)).toEqual([EXEMPTION_ENTRY]);
  });

  it("免除が使用済みで通常枠も埋まっていれば、同名の化け化けは再適用できない", () => {
    let state = setMirage(fixture(), "c01-a");
    state = setMirage(state, "c04-a");
    expect(state.mirageSetPlayerIdsThisTurn).toEqual([ALICE]);
    expect(blockReason(state, "c01-b")).toBe("already_set_mirage_this_turn");
  });

  it("免除の使用枠は使用者ごとに独立する(相手の化け化けは別枠)", () => {
    const state: GameState = {
      ...seedMirageSetCountExemptionUsed(fixture(), EXEMPTION_ENTRY),
      mirageSetPlayerIdsThisTurn: [ALICE, BOB],
      activePlayerId: BOB,
    };
    // Alice は使用済み、Bob は通常枠のみ使用済みで免除は未使用。
    expect(blockReason({ ...state, activePlayerId: ALICE }, "c01-a")).toBe(
      "already_set_mirage_this_turn"
    );
    expect(blockReason(state, "bob-c01", BOB)).toBeNull();
    const after = setMirage(state, "bob-c01", BOB);
    expect(listMirageSetCountExemptionsUsed(after)).toEqual([
      EXEMPTION_ENTRY,
      { playerId: BOB, cardNo: C01.cardNo },
    ]);
  });

  it("免除の使用枠は時計だけで期限切れになる(次のターンで整理され、再び使える)", () => {
    const used = setMirage(fixture(), "c01-a");
    const nextTurn = pruneExpiredEffectUsageForTest({
      ...used,
      turnNumber: used.turnNumber + 1,
    });
    expect(listMirageSetCountExemptionsUsed(nextTurn)).toEqual([]);
  });
});

describe("V10 I08: 免除の適用・辞退・再適用", () => {
  it("宣言時には記録せず、解決時に記録する(宣言→解決で適用)", () => {
    const declared = useSetMirageInStackContextAsAction({
      state: fixture(),
      actingPlayerId: ALICE,
      sourceInstanceId: "c01-a",
      paymentSources: PAY,
      getCardDefinitionById: lookup,
      replacedMirageInstanceIds: [],
      ...actionLookups,
    });
    // 宣言時: 判定結果を運ぶだけで、使用枠にも通常枠にも書かない。
    expect(declared.activeStack.mirageSetCountExemptionDeclared).toBe(true);
    expect(listMirageSetCountExemptionsUsed(declared.state)).toEqual([]);
    expect(declared.state.mirageSetPlayerIdsThisTurn).toEqual([]);

    const resolved = resolveDeferredSetMirageStack({
      state: declared.state,
      activeStack: declared.activeStack,
      getCardDefinitionById: lookup,
      ...actionLookups,
    });
    expect(listMirageSetCountExemptionsUsed(resolved)).toEqual([
      EXEMPTION_ENTRY,
    ]);
    expect(resolved.mirageSetPlayerIdsThisTurn).toEqual([]);
  });

  it("辞退(宣言後に無効化され不成立)では消費せず、同じ免除を再適用できる", () => {
    const declared = useSetMirageInStackContextAsAction({
      state: fixture(),
      actingPlayerId: ALICE,
      sourceInstanceId: "c01-a",
      paymentSources: PAY,
      getCardDefinitionById: lookup,
      replacedMirageInstanceIds: [],
      ...actionLookups,
    });
    const nullified = resolveDeferredSetMirageStack({
      state: declared.state,
      activeStack: { ...declared.activeStack, isNullified: true },
      getCardDefinitionById: lookup,
      ...actionLookups,
    });
    expect(
      nullified.cardInstances.find((card) => card.instanceId === "c01-a")?.zone
    ).toBe("hand");
    expect(listMirageSetCountExemptionsUsed(nullified)).toEqual([]);
    expect(nullified.mirageSetPlayerIdsThisTurn).toEqual([]);
    // 不成立では使用枠が残らないので、免除はまだ適用できる。
    expect(blockReason(nullified, "c01-a")).toBeNull();

    const reapplied = setMirage(nullified, "c01-a");
    expect(listMirageSetCountExemptionsUsed(reapplied)).toEqual([
      EXEMPTION_ENTRY,
    ]);
    expect(reapplied.mirageSetPlayerIdsThisTurn).toEqual([]);
  });

  it("出所が手札から離れた宣言は不成立で、免除を消費しない", () => {
    const declared = useSetMirageInStackContextAsAction({
      state: fixture(),
      actingPlayerId: ALICE,
      sourceInstanceId: "c01-a",
      paymentSources: PAY,
      getCardDefinitionById: lookup,
      replacedMirageInstanceIds: [],
      ...actionLookups,
    });
    const gone: GameState = {
      ...declared.state,
      cardInstances: declared.state.cardInstances.map((card) =>
        card.instanceId === "c01-a" ? { ...card, zone: "trash" as const } : card
      ),
    };
    const resolved = resolveDeferredSetMirageStack({
      state: gone,
      activeStack: declared.activeStack,
      getCardDefinitionById: lookup,
      ...actionLookups,
    });
    expect(resolved.log.some((line) => line.includes("effect-fizzled"))).toBe(
      true
    );
    expect(listMirageSetCountExemptionsUsed(resolved)).toEqual([]);
  });

  it("同名の免除の再記録は冪等で、台帳は二重に数えない(再適用の拒否は block reason のテストで検査)", () => {
    const used = seedMirageSetCountExemptionUsed(fixture(), EXEMPTION_ENTRY);
    // 免除の再適用(2回目の記録)は状態を変えず、使用量は1のまま。
    const again = seedMirageSetCountExemptionUsed(used, EXEMPTION_ENTRY);
    expect(listEffectUsage(again)).toEqual(listEffectUsage(used));
    expect(listMirageSetCountExemptionsUsed(again)).toEqual([EXEMPTION_ENTRY]);
  });

  it("使用者が決まらない記録は拒否され、使用枠を作らない", () => {
    const state = seedMirageSetCountExemptionUsed(fixture(), {
      playerId: "",
      cardNo: C01.cardNo,
    });
    expect(listMirageSetCountExemptionsUsed(state)).toEqual([]);
  });
});
