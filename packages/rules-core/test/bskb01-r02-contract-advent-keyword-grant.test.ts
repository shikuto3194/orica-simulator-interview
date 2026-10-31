/**
 * BSKB01-R02 [虚ろなる鏡の騎士]ダークメタナイト effects[0]
 * 「このカード/スピリットは【契約煌臨】を持っているものとして扱う」。
 *
 * R02 は adventData を持たず keywordTags にも "contract" を含まないため、そのままでは
 * 魂状態時の契約煌臨対象資格 (isPlayersContractCard = player.contractCardNo 一致のみ,
 * advent-system.ts getContractAdventTargets) を満たさない。本効果は override_properties CE
 * (properties.grantsContractAdventEligibility:true) を自身へ付与し、
 * hasContractAdventEligibilityGrant との OR 判定で対象資格を拡張する。
 *
 * 実カード: BSKB01-C01 ([メタナイトの逆襲]メタナイト, 契約煌臨/own_turn/C1以上) を
 * 手札から魂状態の R02 へ契約煌臨させる。player.contractCardNo は R02/CX01 いずれとも
 * 一致しない値にして、grant 経路のみで対象資格が成立することを確認する。
 * 比較対照として、grant を持たない魂状態の CX01 (keywordTags:"contract" だが
 * contractCardNo 不一致) は対象に含まれないことも確認する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  recomputeAndRebuildContinuousEffects,
} from "../src";
import type { CardDefinition, GameState, LegalAction } from "../src";

const ALICE = "alice";
const BOB = "bob";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
};

const ADVENT_NO = "BSKB01-C01"; // 契約煌臨カード ([メタナイトの逆襲]メタナイト, cardNames:「メタナイト」)
const GRANTED_NO = "BSKB01-R02"; // [虚ろなる鏡の騎士]ダークメタナイト (grant 対象, adventData 無し)
const CONTRACT_NO = "BSKB01-CX01"; // [仮面の騎士]メタナイト (keywordTags:"contract" だが contractCardNo 不一致にする)
const UNRELATED_CONTRACT_CARD_NO = "BSKB01-C02"; // player.contractCardNo をどちらとも無関係にする placeholder

function buildState(): GameState {
  const granted = createCardInstance(card(GRANTED_NO), {
    instanceId: "granted-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0, // 魂状態 = 上のコアはリザーブへ移動済み
  });
  const contractCard = createCardInstance(card(CONTRACT_NO), {
    instanceId: "contract-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });
  const advent = createCardInstance(card(ADVENT_NO), {
    instanceId: "advent-1",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    playerOverrides: [
      {
        handCount: 1,
        soulCoreLocation: { kind: "reserve" },
        soulStateInstanceIds: ["granted-1", "contract-1"],
        contractCardNo: UNRELATED_CONTRACT_CARD_NO,
        countValue: 1,
      },
      {},
    ],
  });
  const rawState: GameState = {
    ...base,
    activePlayerId: ALICE,
    step: "main",
    window: "none",
    cardInstances: [granted, contractCard, advent],
  };
  // 継続効果 (R02 effects[0] の override_properties CE 登録) は本来 SBA 直後/誘発解決後に
  // 自動再構築される (recomputeAndRebuildContinuousEffects の想定呼び出しタイミング)。
  // hand-built state は applyLegalAction を経由しないため、ここで明示的に走らせる
  // (BSTH05.5-C20 opt-in テスト precedent と同型)。
  return recomputeAndRebuildContinuousEffects(rawState, getCardDefinitionById);
}

function findAdventDeclaration(
  state: GameState
): Extract<LegalAction, { kind: "declare_advent" }> | undefined {
  const actions = getLegalActions({
    state,
    actingPlayerId: ALICE,
    getCardDefinitionById,
    ...effectLookups,
  });
  return actions.find(
    (a): a is Extract<LegalAction, { kind: "declare_advent" }> =>
      a.kind === "declare_advent" && a.sourceInstanceId === "advent-1"
  );
}

describe("BSKB01-R02 effects[0]: 【契約煌臨】キーワード付与", () => {
  it("override_properties CE で grantsContractAdventEligibility:true を自身へ付与する", () => {
    const c = card(GRANTED_NO);
    const grantEffect = (c.effects ?? []).find((e) => e.textRef?.includes(0));
    expect(grantEffect?.stub).toBeUndefined();
    expect(grantEffect?.steps).toEqual([
      {
        action: {
          kind: "override_properties",
          target: { kind: "self" },
          properties: { grantsContractAdventEligibility: true },
          duration: { scope: "while_on_field" },
        },
      },
    ]);
  });

  it("grant を持つ魂状態の R02 は player.contractCardNo と無関係に契約煌臨の対象になる", () => {
    const decl = findAdventDeclaration(buildState());
    expect(decl).toBeDefined();
    expect(decl!.candidateTargetInstanceIds).toContain("granted-1");
  });

  it("grant を持たない魂状態の CX01 (contractCardNo 不一致) は対象に含まれない", () => {
    const decl = findAdventDeclaration(buildState());
    expect(decl).toBeDefined();
    expect(decl!.candidateTargetInstanceIds).not.toContain("contract-1");
  });
});
