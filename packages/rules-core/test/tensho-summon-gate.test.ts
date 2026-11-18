/**
 * 転召（召喚手順内ステップ）の適法性ゲート + 強制コア消費フローのテスト。
 *
 * ルール正源: `10_rules/07b_card-observed-mechanics.md` 転召節 + `10_rules/02`:188。
 * - 転召は召喚時効果ではなく**召喚手順内のステップ**。順序＝コスト支払い → スタックタイミング →
 *   転召 → 維持コア配置。この転召ステップ専用のスタック窓は開かない。
 * - 対象（〔系統＆コスト条件〕＋最低Nコアの自分のスピリット）が居なければ**召喚宣言自体が不可**。
 * - 実行時は対象1体の上のコアすべてが送り先（ボイド）へ移る（強制）。
 *
 * 旧実装（card_event:summon の強制誘発, 場入り後発火＋対象不在 no-op）は両方とも誤り
 * （needs-dsl ENGINE-tensho-summon-gate, 裁定 2026-06-14）。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState, LegalAction } from "../src/model";
import { getLegalActions, applyLegalAction } from "../src/index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { createActionInputDecisionNode } from "../src/training-decision-surface";

/** 転召【転召：1／幻想＆コスト3以上／ボイド】を持つテスト用スピリット。 */
function makeTenshoSpirit(
  cardNo: string,
  options: { cost?: number; minCores?: number } = {}
): CardDefinition {
  return {
    cardNo,
    name: `転召 ${cardNo}`,
    printedCategory: "spirit",
    colors: ["purple"],
    cost: options.cost ?? 4,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
    symbolColors: ["purple"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    tribe: "幻想",
    tenshoSummon: {
      targetFilter: {
        category: ["spirit"],
        tribesRequired: ["幻想"],
        minCost: 3,
      },
      minCores: options.minCores ?? 1,
      destination: "void",
    },
  };
}

/** 対象になりうる/ならない場のスピリット。 */
function makeFieldSpirit(
  cardNo: string,
  opts: { tribe?: string; cost?: number } = {}
): CardDefinition {
  return {
    cardNo,
    name: `場 ${cardNo}`,
    printedCategory: "spirit",
    colors: ["purple"],
    cost: opts.cost ?? 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["purple"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    tribe: opts.tribe ?? "幻想",
  };
}

function createLookup(defs: CardDefinition[]) {
  const map = new Map(defs.map((d) => [d.cardNo, d]));
  return (id: string) => map.get(id);
}

const noFieldEffects = () => [] as const;
type Lookup = (id: string) => CardDefinition | undefined;
type TriggeredLookup = ReturnType<typeof buildTriggeredEffectLookup>;

function setup(
  targetDef: CardDefinition | null,
  targetCores = 3,
  reserveCores = 8,
  tenshoOptions: { cost?: number; minCores?: number } = {},
  targetHasSoulCore = false
) {
  const tenshoDef = makeTenshoSpirit("TENSHO-A", tenshoOptions);
  const defs: CardDefinition[] = [tenshoDef];
  const cardInstances = [
    createCardInstance(tenshoDef, {
      instanceId: "tensho-1",
      ownerPlayerId: "alice",
      zone: "hand",
    }),
  ];
  if (targetDef) {
    defs.push(targetDef);
    cardInstances.push(
      createCardInstance(targetDef, {
        instanceId: "target-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: targetCores,
      })
    );
  }
  const baseState = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances,
    playerOverrides: [
      {
        reserveNormalCoreCount: reserveCores,
        ...(targetHasSoulCore && targetDef
          ? {
              soulCoreLocation: {
                kind: "card" as const,
                instanceId: "target-1",
              },
            }
          : {}),
      },
    ],
  });
  return {
    state: { ...baseState, step: "main" as const, activePlayerId: "alice" },
    lookup: createLookup(defs),
    triggeredLookup: buildTriggeredEffectLookup(defs),
  };
}

function legalActions(
  state: GameState,
  lookup: Lookup,
  playerId = "alice"
): LegalAction[] {
  return getLegalActions({
    state,
    actingPlayerId: playerId,
    getCardDefinitionById: lookup,
    getRegisteredFieldCardEffectActions: noFieldEffects,
  });
}

function declareSummon(
  state: GameState,
  lookup: Lookup,
  triggeredLookup: TriggeredLookup
): GameState {
  const summon = legalActions(state, lookup).find(
    (a) => a.kind === "summon" && a.sourceInstanceId === "tensho-1"
  );
  expect(summon).toBeDefined();
  return applyLegalAction({
    state,
    action: summon!,
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    paymentSources: [{ kind: "reserve", amount: 4 }],
  }).state;
}

function passStackAsBob(
  state: GameState,
  lookup: Lookup,
  triggeredLookup: TriggeredLookup
): GameState {
  const pass = legalActions(state, lookup, "bob").find(
    (a) => a.kind === "pass_stack"
  );
  expect(pass).toBeDefined();
  return applyLegalAction({
    state,
    action: pass!,
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
}

const card = (state: GameState, id: string) =>
  state.cardInstances.find((c) => c.instanceId === id);

describe("転召：召喚手順内ステップ（適法性ゲート + 強制コア消費）", () => {
  it("対象（幻想＆コスト3以上＆コア1個以上の自分スピリット）が居なければ召喚を提示しない", () => {
    const { state, lookup } = setup(null);
    const acts = legalActions(state, lookup);
    expect(acts.some((a) => a.kind === "summon")).toBe(false);
  });

  it("系統が違う場のスピリットは対象にならない（召喚不可）", () => {
    const { state, lookup } = setup(
      makeFieldSpirit("OTHER", { tribe: "機獣" })
    );
    const acts = legalActions(state, lookup);
    expect(acts.some((a) => a.kind === "summon")).toBe(false);
  });

  it("コア0の幻想スピリットは対象にならない（召喚不可）", () => {
    const { state, lookup } = setup(makeFieldSpirit("EMPTY"), 0);
    const acts = legalActions(state, lookup);
    expect(acts.some((a) => a.kind === "summon")).toBe(false);
  });

  it("転召で対象の残コアを全てボイドに送ると維持コアを置けない場合は召喚を提示しない", () => {
    // target の 5 コアだけで cost 4 + Lv1 配置 1 を満たして見えても、順序は
    // cost → 転召（残り 1 をボイド）→ 維持コア配置なので、最後の 1 を二重利用できない。
    const { state, lookup } = setup(makeFieldSpirit("NO-PLACEMENT"), 5, 0);
    const acts = legalActions(state, lookup);
    expect(
      acts.some((a) => a.kind === "summon" && a.sourceInstanceId === "tensho-1")
    ).toBe(false);
  });

  it("最低3コアを要求する転召対象の維持コアをコストへ再利用しない", () => {
    // reserve 3 + target 3 は cost 3 + Lv1 配置 1 を満たして見える。しかし target
    // の 3 コアは転召条件を満たすために残す必要があり、転召後には全てボイドへ行く。
    const { state, lookup } = setup(
      makeFieldSpirit("MIN-THREE-TARGET", { cost: 6 }),
      3,
      3,
      { cost: 3, minCores: 3 }
    );
    const acts = legalActions(state, lookup);
    expect(
      acts.some((a) => a.kind === "summon" && a.sourceInstanceId === "tensho-1")
    ).toBe(false);
  });

  it("転召対象のソウルコアを支払い、維持コアの入力を失う組合せを拒否する", () => {
    // generic の総コア数では cost 3 + Lv1 配置 1 を満たす。target のソウルコアを
    // 支払いに使うと、転召後に残る配置元は無いため、この paymentSources は不適法。
    const { state, lookup, triggeredLookup } = setup(
      makeFieldSpirit("SOUL-PAYMENT-TARGET"),
      4,
      0,
      { cost: 3, minCores: 1 },
      true
    );
    const summon = legalActions(state, lookup).find(
      (action) =>
        action.kind === "summon" && action.sourceInstanceId === "tensho-1"
    );
    expect(summon).toBeDefined();

    // training の支払い入力 surface からも、例外を投げるだけの unsafe な選択を除外する。
    const inputNode = createActionInputDecisionNode(state, summon!, {
      getCardDefinitionById: lookup,
      maxGeneratedChoices: 32,
    });
    expect(inputNode).not.toBeNull();
    expect(
      inputNode!.choices.some((choice) =>
        choice.applyOptions?.paymentSources?.some(
          (source) => source.kind === "card" && source.includeSoulCore
        )
      )
    ).toBe(false);

    expect(() =>
      applyLegalAction({
        state,
        action: summon!,
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        paymentSources: [
          {
            kind: "card",
            instanceId: "target-1",
            amount: 3,
            includeSoulCore: true,
          },
        ],
      })
    ).toThrow(
      "Tensho summon payment leaves no legal enter-field core placement"
    );
  });

  it("条件を満たす対象が居れば召喚を提示する", () => {
    const { state, lookup } = setup(makeFieldSpirit("VALID"));
    const acts = legalActions(state, lookup);
    expect(
      acts.some((a) => a.kind === "summon" && a.sourceInstanceId === "tensho-1")
    ).toBe(true);
  });

  it("コスト支払い→スタック窓→転召（場入り前）→維持コア配置 の順で解決する", () => {
    const { state, lookup, triggeredLookup } = setup(makeFieldSpirit("VALID"));
    const voidBefore = state.players.find(
      (p) => p.id === "alice"
    )!.voidNormalCoreCount;

    // 召喚宣言：コスト支払い後にスタック窓が開く（転召はまだ）。
    const opened = declareSummon(state, lookup, triggeredLookup);
    expect(opened.window).toBe("stack");
    expect(opened.pendingTenshoSummon).toBeNull();

    // 相手パスで窓クローズ → 転召の対象選択 pending（維持コア配置はまだ）。
    const afterPass = passStackAsBob(opened, lookup, triggeredLookup);
    expect(afterPass.pendingTenshoSummon?.summoningInstanceId).toBe("tensho-1");
    expect(afterPass.pendingTenshoSummon?.targetCandidateInstanceIds).toEqual([
      "target-1",
    ]);
    expect(afterPass.pendingEnterFieldPlacement).toBeNull();
    // 転召はこのプレイヤー本人だけが解決できる。
    const tenshoActs = legalActions(afterPass, lookup).filter(
      (a) => a.kind === "resolve_tensho_summon"
    );
    expect(tenshoActs).toHaveLength(1);

    // 転召を解決：対象のコア（3個）すべてがボイドへ移り、その後で維持コア配置 pending。
    const afterTensho = applyLegalAction({
      state: afterPass,
      action: tenshoActs[0]!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    }).state;
    expect(afterTensho.pendingTenshoSummon).toBeNull();
    expect(card(afterTensho, "target-1")?.normalCoreCount).toBe(0);
    expect(
      afterTensho.players.find((p) => p.id === "alice")!.voidNormalCoreCount
    ).toBe(voidBefore + 3);
    expect(afterTensho.pendingEnterFieldPlacement).not.toBeNull();
    expect(afterTensho.pendingEnterFieldPlacement?.sourceInstanceId).toBe(
      "tensho-1"
    );

    // 維持コア配置を解決して場入り完了。
    const placement = legalActions(afterTensho, lookup).find(
      (a) => a.kind === "resolve_pending_enter_field_placement"
    );
    expect(placement).toBeDefined();
    const resolved = applyLegalAction({
      state: afterTensho,
      action: placement!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      enterFieldCorePlacements: [
        { kind: "reserve_normal", amount: 1 },
      ] as never,
    }).state;
    expect(card(resolved, "tensho-1")?.zone).toBe("field");
    expect(card(resolved, "tensho-1")?.normalCoreCount).toBe(1);
  });
});
