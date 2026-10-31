/**
 * BSES01-T01「M1A4 ジャガーノート」textLines[2] のタイミング忠実度テスト (P3-138)。
 *
 * 印字「〔重複不可〕トークンデッキにあるこのカードは、自分が系統：「８６」を持つブレイヴを
 * 召喚するとき、召喚コスト支払い前に出し、対象はこのスピリットに直接合体しなければ
 * ならない」を、summon legal action 宣言時点 (コスト支払い前・スタック窓が開く前) の
 * 同期的な副作用として表現する (`legal/token-pool-pre-cost-forced-combine.ts`)。
 * 場入りと同時に確定するホストは宣言時に `combineHostInstanceId` へ乗せ、
 * `stack-resolution-core.ts` の合体選択 pending 生成箇所はホストが窓を跨いで生存していれば
 * 任意選択 (`pendingBraveCombineChoice`) を提示せずそのまま採用する。
 *
 * 旧実装 (各系統「８６」ブレイヴ側 card_event:summon による post-hoc 近似、印字を持たない
 * 10 枚への mandatory 効果複製) は廃止した — 効果は印字どおり BSES01-T01 側
 * (`effects` の支払い前 put) へ帰属する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState, LegalAction } from "../src/model";
import { executeEffect } from "../src/effect/effect-interpreter";
import { getLegalActions, applyLegalAction } from "../src/index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { createCardInstance, createEmptyGameState } from "../src/factories";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

const ALICE = "alice";
const BOB = "bob";
const r03 = card("BSES01-R03");
const t01 = card("BSES01-T01");
const lookup = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const triggeredLookup = buildTriggeredEffectLookup([r03, t01]);
const noFieldEffects = () => [] as const;

function legalActions(state: GameState, playerId: string): LegalAction[] {
  return getLegalActions({
    state,
    actingPlayerId: playerId,
    getCardDefinitionById: lookup,
    getRegisteredFieldCardEffectActions: noFieldEffects,
  });
}

function baseState(cardInstances: GameState["cardInstances"]): GameState {
  const state = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances,
    playerOverrides: [{ reserveNormalCoreCount: 10 }, {}],
  });
  return { ...state, step: "main" as const, activePlayerId: ALICE };
}

function declareSummon(
  state: GameState,
  sourceInstanceId: string,
  reserveAmount: number
): GameState {
  const action = legalActions(state, ALICE).find(
    (a) => a.kind === "summon" && a.sourceInstanceId === sourceInstanceId
  );
  expect(action).toBeDefined();
  const declared = applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    paymentSources: [{ kind: "reserve", amount: reserveAmount }],
  }).state;
  const placement = declared.pendingMultiPlacement;
  if (!placement) return declared;
  expect(declared.players[0]!.reserveNormalCoreCount).toBe(
    state.players[0]!.reserveNormalCoreCount
  );
  expect(declared.window).toBe("none");
  return applyLegalAction({
    state: declared,
    action: legalActions(declared, ALICE).find(
      (a) => a.kind === "resolve_pending_multi_placement"
    )!,
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    multiPlacementAllocations: [
      {
        destinationInstanceId: placement.targets[0]!.instanceId,
        placements: [{ kind: "reserve_normal", amount: 1 }],
      },
    ],
  }).state;
}

function passStackAsBob(state: GameState): GameState {
  const pass = legalActions(state, BOB).find((a) => a.kind === "pass_stack");
  expect(pass).toBeDefined();
  return applyLegalAction({
    state,
    action: pass!,
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
}

/** 場入りコア配置 pending が残っていれば解決する (0 コアで自動確定済みなら no-op)。 */
function resolveEnterFieldPlacementIfPending(state: GameState): GameState {
  const resolve = legalActions(state, ALICE).find(
    (a) => a.kind === "resolve_pending_enter_field_placement"
  );
  if (!resolve) return state;
  return applyLegalAction({
    state,
    action: resolve,
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    enterFieldCorePlacements: [],
  }).state;
}

const findCard = (state: GameState, id: string) =>
  state.cardInstances.find((c) => c.instanceId === id);

describe("BSES01-T01 token-pool-pre-cost-forced-combine (P3-138 timing/attribution)", () => {
  it("[board] effect 内召喚でも系統不一致ブレイヴにはM1A4を出さず、無関係な強制合体を起こさない", () => {
    const unrelatedBrave: CardDefinition = {
      ...r03,
      cardNo: "TEST-BSES01-NON86-BRAVE",
      tribe: "別系統",
      relatedTokenCardNos: [t01.cardNo],
    };
    const unrelatedInHand = createCardInstance(unrelatedBrave, {
      instanceId: "unrelated-brave-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const effect = {
      timing: { kind: "activated" as const },
      steps: [
        {
          action: {
            kind: "summon" as const,
            target: { kind: "self" as const },
            costModifier: "free" as const,
          },
        },
      ],
    };
    const after = executeEffect({
      chainId: "test:bses01-t01:effect-summon-source-condition",
      state: baseState([unrelatedInHand]),
      effect,
      sourceInstanceId: unrelatedInHand.instanceId,
      actingPlayerId: ALICE,
      getCardDefinitionById: (id) =>
        id === unrelatedBrave.cardNo ? unrelatedBrave : lookup(id),
      getRegisteredTriggeredEffectActions: triggeredLookup,
      summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    });

    expect(
      after.cardInstances.some(
        (instance) => instance.definitionId === t01.cardNo
      )
    ).toBe(false);
    expect(
      after.log.some((entry) =>
        entry.includes("token-pool-pre-cost-forced-combine")
      )
    ).toBe(false);
    expect(findCard(after, unrelatedInHand.instanceId)?.zone).toBe("field");
  });

  it("[board] 系統「８６」ブレイヴの召喚コスト支払い前にM1A4トークンが場に出て、窓クローズ後は合体選択が提示されず強制合体する", () => {
    const braveInst = createCardInstance(r03, {
      instanceId: "r03-1",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = baseState([braveInst]);

    const declared = declareSummon(state, "r03-1", 3);
    // コスト支払い + スタック窓オープンは declareSummon 内で完結済み。この時点で
    // トークンが既に場に出ていれば「召喚コスト支払い前に出し」を満たしている
    // (intercept は useSummonInStackContextAsAction 呼び出し前、コスト計算前に実行される)。
    expect(declared.window).toBe("stack");
    const token = declared.cardInstances.find(
      (c) => c.definitionId === t01.cardNo
    );
    expect(token).toBeDefined();
    expect(token!.zone).toBe("field");
    expect(declared.log).toContain(
      `effect:field_put:token:${ALICE}:${token!.instanceId}:cost=0:pending-placement`
    );
    expect(
      declared.log.some((entry) =>
        entry.startsWith(`effect:summon:${token!.instanceId}:`)
      )
    ).toBe(false);

    const afterPass = passStackAsBob(declared);
    // 強制合体: 任意選択 (pendingBraveCombineChoice) を提示しない。
    expect(afterPass.pendingBraveCombineChoice).toBeNull();

    const after = resolveEnterFieldPlacementIfPending(afterPass);
    const brave = findCard(after, "r03-1")!;
    const placedToken = after.cardInstances.find(
      (c) => c.definitionId === t01.cardNo
    )!;
    expect(brave.attachedToInstanceId).toBe(placedToken.instanceId);
    expect(placedToken.attachedChildrenIds).toContain("r03-1");
  });

  it("[board][P3-138] 場にM1A4が既に合体済みの状態で2体目の系統「８６」ブレイヴを召喚しても、既存M1A4への任意合体は提示されず新トークンへ強制合体する (タイミング差が盤面に出る)", () => {
    const existingToken = createCardInstance(t01, {
      instanceId: "t01-existing",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
      attachedChildrenIds: ["r03-existing"],
    });
    const existingBrave = createCardInstance(r03, {
      instanceId: "r03-existing",
      ownerPlayerId: ALICE,
      zone: "field",
      zoneRoleName: "brave",
      normalCoreCount: 0,
      attachedToInstanceId: "t01-existing",
    });
    const secondBraveInHand = createCardInstance(r03, {
      instanceId: "r03-2",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = baseState([existingToken, existingBrave, secondBraveInHand]);

    const declared = declareSummon(state, "r03-2", 3);
    const newToken = declared.cardInstances.find(
      (c) => c.definitionId === t01.cardNo && c.instanceId !== "t01-existing"
    );
    expect(newToken).toBeDefined();
    expect(newToken!.zone).toBe("field");

    const afterPass = passStackAsBob(declared);
    // タイミング差の核心: 印字どおりなら新ブレイヴは新トークンへ強制合体するのみで、
    // 既存M1A4への任意合体という選択肢は一切提示されない
    // (post-hoc 近似実装ではここで pendingBraveCombineChoice が既存M1A4を候補として
    // 提示し、任意合体 → 別トークンでの強制再合体、という二段階の経路が実在した)。
    expect(afterPass.pendingBraveCombineChoice).toBeNull();

    const after = resolveEnterFieldPlacementIfPending(afterPass);
    const brave2 = findCard(after, "r03-2")!;
    expect(brave2.attachedToInstanceId).toBe(newToken!.instanceId);
    // 既存ホストの合体は無傷 (r03-existing のまま、r03-2 は混入しない)。
    const oldHost = findCard(after, "t01-existing")!;
    expect(oldHost.attachedChildrenIds).toEqual(["r03-existing"]);
    const newHost = findCard(after, newToken!.instanceId)!;
    expect(newHost.attachedChildrenIds).toContain("r03-2");
  });

  it("[board] トークン枯渇時(maxTokenDeckCount到達)は intercept が不発になり、既存トークンへの通常の任意合体選択が提示される", () => {
    const existingTokens = Array.from(
      { length: t01.maxTokenDeckCount! },
      (_, i) =>
        createCardInstance(t01, {
          instanceId: `t01-existing-${i}`,
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        })
    );
    const braveInHand = createCardInstance(r03, {
      instanceId: "r03-3",
      ownerPlayerId: ALICE,
      zone: "hand",
    });
    const state = baseState([...existingTokens, braveInHand]);

    const declared = declareSummon(state, "r03-3", 3);
    const tokenCount = declared.cardInstances.filter(
      (c) => c.definitionId === t01.cardNo
    ).length;
    // トークンが出せないので intercept は不発 (新トークンは追加されない)。
    expect(tokenCount).toBe(t01.maxTokenDeckCount);

    const afterPass = passStackAsBob(declared);
    // 通常の任意合体選択が提示される (既存 M1A4 群が候補)。
    expect(afterPass.pendingBraveCombineChoice?.braveInstanceId).toBe("r03-3");
    expect(
      afterPass.pendingBraveCombineChoice?.hostCandidateInstanceIds?.length
    ).toBeGreaterThan(0);
  });
});
