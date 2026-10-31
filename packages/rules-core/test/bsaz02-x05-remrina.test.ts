/**
 * BSAZ02-X05「[導界者]レムリナ・ヴァース・エンヴァース」effects 検証。
 *
 * 原文 (textLines[0,2,3,4,6,8,9,10,11]):
 *   このネクサスは導界者ネクサス/創界神ネクサス対象の効果しか受けない…（略）。
 *   【導託：〔火星＆コスト3以上〕〔火星＆アルティメット〕〔火星＆ブレイヴ〕】
 *   ◆対象の自分のスピリット/アルティメット/ブレイヴを召喚/煌臨したとき、ボイドからコア1個。
 *   ◆このネクサスを配置したとき、同名不在ならデッキ上3枚をトラッシュに置き、対象1枚につきコア+1。
 *   Lv1-Lv2 このネクスのシンボルは白/究極としても扱い、導託でトラッシュに置かれた
 *   「アルドノアドライブ」すべてを手札に加える。
 *   【導域】Lv1-Lv2 下の裏向きを「アルドノアドライブ」として扱う。自分が【アルドノアドライブ】を
 *   持つカードを召喚/配置したとき、ただちにトラッシュにある「アルドノアドライブ」を裏向きで下に置く。
 *   【導技：3】Lv2 フラッシュ『お互いのアタックステップ』〔ターンに1回：同名〕コア3個をボイドに
 *   置く→手札の系統：「アルドノア」を持つカード1枚をコストを支払わずに召喚/配置する。
 *
 * BSAZ02-X04 (bsaz02-x04-aselam.test.ts) と同型の構成のため、共通部分 (grandwalkerData 本体・
 * 導託・symbol treat_as・導域の trash_by_card_name 配置) は X04 側で厚く検証済み。本ファイルは
 * X05 固有差分 (導技:3 の本体効果 = 手札のアルドノア系統カード1枚をコスト不要召喚/配置) を中心に検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { rebuildContinuousEffectsFromField } from "../src/effect/continuous-effect-rebuild";
import { getEffectiveSymbolBundles } from "../src/battle/battle-shared";
import { resolvePlacementOracleMechanic } from "../src/mechanics/oracle-system";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string) => cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";
const X05 = card("BSAZ02-X05");
const ALDNOAH_DRIVE = card("BSAZ02-C10");

function runEffect(
  state: GameState,
  effectIndex: number,
  opts: { sourceInstanceId?: string; triggerRelatedInstanceId?: string } = {}
): GameState {
  return executeEffect({
    chainId: "test:bsaz02-x05-remrina:49",
    state,
    effect: X05.effects![effectIndex]!,
    effectIndex,
    sourceInstanceId: opts.sourceInstanceId ?? "src-x05",
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    triggerRelatedInstanceId: opts.triggerRelatedInstanceId,
  });
}

describe("BSAZ02-X05 grandwalkerData 宣言", () => {
  it("kind:guided + oracleConditions 3件（火星のみ、X04と違い地球を含まない）", () => {
    const gw = X05.grandwalkerData!;
    expect(gw.kind).toBe("guided");
    expect(gw.oracleConditions).toEqual([
      { tribes: ["火星"], categories: ["spirit"], minCost: 3 },
      { tribes: ["火星"], categories: ["ultimate"] },
      { tribes: ["火星"], categories: ["brave"] },
    ]);
  });

  it("placementOracleReturnToHand が「アルドノアドライブ」名で宣言される", () => {
    expect(X05.grandwalkerData!.placementOracleReturnToHand).toEqual({
      cardName: { contains: "アルドノアドライブ" },
    });
  });

  it("divineSkills[0] (導技:3) は coreCost:3/timing:attack(both)/minLevel:2/maxLevel:2/turnLimit:once_per_name", () => {
    const skills = X05.grandwalkerData!.divineSkills!;
    expect(skills).toHaveLength(1);
    const skill = skills[0]!;
    expect(skill.label).toBe("guided_skill");
    expect(skill.coreCost).toBe(3);
    expect(skill.timing).toEqual({
      step: "attack",
      whose: "both",
      mode: "flash",
    });
    expect(skill.minLevel).toBe(2);
    expect(skill.maxLevel).toBe(2);
    expect(skill.turnLimit).toBe("once_per_name");
  });
});

describe("BSAZ02-X05 effects[0]（Lv1-2: シンボルは白/究極としても扱う）", () => {
  it("getEffectiveSymbolBundles の既存エントリに white/ultimate_symbol が追加される", () => {
    const src = createCardInstance(X05, {
      instanceId: "src-x05",
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 0,
    });
    const rebuilt = rebuildContinuousEffectsFromField(
      createEmptyGameState({ playerIds: [ALICE, BOB], cardInstances: [src] }),
      getDef
    );
    const bundles = getEffectiveSymbolBundles(rebuilt, src, X05, getDef);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]!.colors).toContain("guide");
    expect(bundles[0]!.colors).toContain("white");
    expect(bundles[0]!.colors).toContain("ultimate_symbol");
  });
});

describe("BSAZ02-X05 effects[1]（導域: トラッシュの「アルドノアドライブ」を裏向きで下に）", () => {
  it("トラッシュに「アルドノアドライブ」があれば、召喚/配置イベント対象の下に裏向きで置かれる", () => {
    const src = createCardInstance(X05, {
      instanceId: "src-x05",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const drive = createCardInstance(ALDNOAH_DRIVE, {
      instanceId: "drive-in-trash",
      ownerPlayerId: ALICE,
      zone: "trash",
    });
    const host = createCardInstance(X05, {
      instanceId: "host-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, drive, host],
    });

    const after = runEffect(state, 1, { triggerRelatedInstanceId: "host-1" });

    const placed = after.cardInstances.find(
      (c) => c.instanceId === "drive-in-trash"
    )!;
    expect(placed.zone).toBe("field");
    expect(placed.attachedToInstanceId).toBe("host-1");
    expect(placed.faceDown).toBe(true);
  });
});

describe("BSAZ02-X05 grandwalkerData.placementOracleReturnToHand（配置時神託）", () => {
  it("トラッシュに置かれた「アルドノアドライブ」だけが手札に戻る", () => {
    const src = createCardInstance(X05, {
      instanceId: "src-x05",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const drive = createCardInstance(ALDNOAH_DRIVE, {
      instanceId: "deck-drive",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, drive],
      playerOverrides: [{ handCount: 0 }, {}],
    });

    const after = resolvePlacementOracleMechanic(
      state,
      { kind: "placement_oracle", grandwalkerInstanceId: "src-x05" },
      getDef
    );

    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-drive")!.zone
    ).toBe("hand");
    expect(after.players.find((p) => p.id === ALICE)!.handCount).toBe(1);
  });
});

describe("BSAZ02-X05 grandwalkerData.divineSkills[0] 本体効果（コア3支払い後: 手札のアルドノア系統1枚をコスト不要召喚）", () => {
  it("手札の「アルドノア」系統カードが場に出る（コスト無視）", () => {
    const src = createCardInstance(X05, {
      instanceId: "src-x05",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const handCard = createCardInstance(ALDNOAH_DRIVE, {
      instanceId: "hand-drive",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, handCard],
      playerOverrides: [{ handCount: 1 }, {}],
    });

    const skillEffect = X05.grandwalkerData!.divineSkills![0]!.effects![0]!;
    const after = executeEffect({
      chainId: "test:bsaz02-x05-remrina:199",
      state,
      effect: skillEffect,
      effectIndex: 0,
      sourceInstanceId: "src-x05",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    const placed = after.cardInstances.find(
      (c) => c.instanceId === "hand-drive"
    )!;
    expect(placed.zone).toBe("field");
  });

  it("手札に「アルドノア」系統カードが無ければ何も起きない", () => {
    const src = createCardInstance(X05, {
      instanceId: "src-x05",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src],
    });

    const skillEffect = X05.grandwalkerData!.divineSkills![0]!.effects![0]!;
    const after = executeEffect({
      chainId: "test:bsaz02-x05-remrina:226",
      state,
      effect: skillEffect,
      effectIndex: 0,
      sourceInstanceId: "src-x05",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });

    expect(after.cardInstances).toHaveLength(1);
  });
});
