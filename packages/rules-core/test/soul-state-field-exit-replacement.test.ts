/**
 * 契約カードの魂状態置換: legal-actions 配線 — engine batch2-4。
 *
 * 検証対象: `pendingSoulStateReplacement` の本番解決経路。
 *   「契約カードが**相手によって**フィールドを離れるとき、魂状態で残す**選択**ができる
 *    (**ルールであり効果ではない**)」(08a_advent-rebirth-contract.md L126)。
 *   「魂状態化時、上のコアは全て**リザーブへ**移動」(同 L127)。
 *
 * gap: checkSoulStateReplacement (flushPendingLeaves 内) が pendingSoulStateReplacement を
 *   立て当該カードの離脱を保留するが、batch2-4 以前は getLegalActions が何も列挙せず
 *   legal-actions-apply に dispatch も無かったため、コントローラーに合法手が無く deadlock した
 *   (resolveSoulStateReplacement は export 済みだが本番経路から未配線 = silently unreachable)。
 *   これを煌臨元置換 (advent_source, 66bbc10) と同形に配線する。
 *
 * 機構: pending が立つ → 選択プレイヤー (controller) のみに
 *   resolve_soul_state_replacement が二択 (keep / decline) で提示される。
 *   keep → 魂状態化 (コア→リザーブ, soulStateInstanceIds に追加, フィールド残留)。
 *   decline → applyLegalAction の安定点 flush で通常通りトラッシュ等へ。
 *   全ケースで pending を本番経路 (getLegalActions / applyLegalAction) で最終盤面まで解決する。
 */
import { describe, it, expect } from "vitest";
import {
  createEmptyGameState,
  createCardInstance,
  flushPendingLeaves,
  getLegalActions,
} from "../src";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import type {
  CardDefinition,
  CardInstance,
  GameState,
  PendingLeaveEntity,
} from "../src";

const ALICE = "player-1";
const BOB = "player-2";
const CONTRACT_NO = "TEST-CONTRACT";

// ── 定義ヘルパー ─────────────────────────────────────────

function contractDef(): CardDefinition {
  return {
    cardNo: CONTRACT_NO,
    name: "契約スピリット",
    printedCategory: "spirit",
    printedColors: ["purple"],
    symbolColors: ["purple"],
    printedCost: 3,
    reductionSymbols: [],
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 3000 },
      { level: 2, requiredCores: 3, bp: 5000 },
    ],
    textLines: [],
    images: {},
    tribe: "影",
    keywordTags: ["contract"],
  } as CardDefinition;
}

const CONTRACT_DEF = contractDef();
const defMap = new Map<string, CardDefinition>([[CONTRACT_NO, CONTRACT_DEF]]);
const getDef = (id: string): CardDefinition | undefined => defMap.get(id);

// ── インスタンス / pending ヘルパー ──────────────────────

function contractCard(
  instanceId: string,
  cores = 3,
  opts: Partial<CardInstance> = {}
): CardInstance {
  return createCardInstance(CONTRACT_DEF, {
    instanceId,
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: cores,
    pendingLeaveKind: "destroy",
    pendingLeaveCause: "effect_resolution",
    pendingLeaveChainId: `chain-${instanceId}`,
    ...opts,
  });
}

function pendingDestroy(
  instanceId: string,
  causePlayerId: string | null = BOB
): PendingLeaveEntity {
  return {
    instanceId,
    kind: "destroy",
    cause: "effect_resolution",
    causePlayerId,
    chainId: `chain-${instanceId}`,
    deferZoneMoveUntilChainEnd: false,
    leaveFieldCoreDestinationOverride: null,
  };
}

const getCard = (s: GameState, id: string): CardInstance =>
  s.cardInstances.find((c) => c.instanceId === id)!;
const alice = (s: GameState) => s.players.find((p) => p.id === ALICE)!;

const noLookups = { getCardDefinitionById: getDef } as const;

/** flushPendingLeaves で pendingSoulStateReplacement を立てた state を返す共通 setup。 */
function withContractPending(
  cores = 3,
  opts: Partial<CardInstance> = {}
): GameState {
  const card = contractCard("contract", cores, opts);
  const state = createEmptyGameState({
    cardInstances: [card],
    playerOverrides: [
      { contractCardNo: CONTRACT_NO, reserveNormalCoreCount: 0 },
      {},
    ],
  });
  state.pendingLeaveEntities = [pendingDestroy("contract", BOB)];
  const afterFlush = flushPendingLeaves(state, getDef, ["purple"]);
  expect(afterFlush.pendingSoulStateReplacement).not.toBeNull();
  return afterFlush;
}

// ════════════════════════════════════════════════════════════════
// legal-actions 配線 (engine batch2-4): pendingSoulStateReplacement を
// 本番経路 getLegalActions / applyLegalAction で最終盤面まで解決する。
// これがないとコントローラーに合法手が無く deadlock する (未配線 gap)。
// ════════════════════════════════════════════════════════════════

describe("魂状態置換: legal-actions 配線で解決 (deadlock 解消)", () => {
  it("(1) 相手起因離脱で pending を立て、選択プレイヤーに keep / decline が提示される", () => {
    const state = withContractPending(3);
    // pending を立てた時点でカードはまだフィールド (フラッシュ保留)。
    expect(getCard(state, "contract").zone).toBe("field");
    expect(state.pendingSoulStateReplacement!.cardInstanceId).toBe("contract");
    expect(state.pendingSoulStateReplacement!.choosingPlayerId).toBe(ALICE);

    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...noLookups,
    });
    const resolveActions = actions.filter(
      (a) => a.kind === "resolve_soul_state_replacement"
    );
    // keep + decline = 2 アクション。pending がある限り常に解決手が存在する (= no deadlock)。
    expect(resolveActions).toHaveLength(2);
    expect(resolveActions.length).toBeGreaterThan(0);

    const keepAction = resolveActions.find(
      (a) => (a as { choice?: string }).choice === "keep"
    );
    expect(keepAction).toMatchObject({
      kind: "resolve_soul_state_replacement",
      actingPlayerId: ALICE,
      cardInstanceId: "contract",
      choice: "keep",
    });

    const declineAction = resolveActions.find(
      (a) => (a as { choice?: string }).choice === "decline"
    );
    expect(declineAction).toMatchObject({
      kind: "resolve_soul_state_replacement",
      actingPlayerId: ALICE,
      cardInstanceId: "contract",
      choice: "decline",
    });
  });

  it("(2) choice=keep を適用すると魂状態化し (コア→リザーブ)、フィールドに残り pending が解消する", () => {
    const state = withContractPending(3, { exhaustState: "exhausted" });
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...noLookups,
    });
    const keepAction = actions.find(
      (a) =>
        a.kind === "resolve_soul_state_replacement" &&
        (a as { choice?: string }).choice === "keep"
    )!;
    const applied = applyLegalAction({
      state,
      action: keepAction,
      ...noLookups,
    });

    // pending は解消。
    expect(applied.state.pendingSoulStateReplacement).toBeNull();

    const cardAfter = getCard(applied.state, "contract");
    // 魂状態としてフィールドに残留 (トラッシュへ行かない)。
    expect(cardAfter.zone).toBe("field");
    expect(cardAfter.zone).not.toBe("trash");
    // 08a L127: 上のコアは全てリザーブへ → カード上 0 個 / リザーブ +3。
    expect(cardAfter.normalCoreCount).toBe(0);
    expect(alice(applied.state).reserveNormalCoreCount).toBe(3);
    // 魂状態に疲労状態は存在しないため、復帰時に引き継がない中立値にする。
    expect(cardAfter.exhaustState).toBe("recovered");
    // 魂状態リストに登録。
    expect(alice(applied.state).soulStateInstanceIds).toContain("contract");
    // pendingLeave は除去済み (= もうフィールドを離れない)。
    expect(cardAfter.pendingLeaveKind).toBeNull();
    expect(
      applied.state.pendingLeaveEntities.find(
        (pl) => pl.instanceId === "contract"
      )
    ).toBeUndefined();
  });

  it("(3) choice=decline を適用するとカードは通常通り離脱し pending が解消する", () => {
    const state = withContractPending(3);
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...noLookups,
    });
    const declineAction = actions.find(
      (a) =>
        a.kind === "resolve_soul_state_replacement" &&
        (a as { choice?: string }).choice === "decline"
    )!;
    const applied = applyLegalAction({
      state,
      action: declineAction,
      ...noLookups,
    });

    // pending は解消し、applyLegalAction の安定点 flush で通常離脱まで進む。
    expect(applied.state.pendingSoulStateReplacement).toBeNull();
    expect(
      applied.state.pendingLeaveEntities.find(
        (pl) => pl.instanceId === "contract"
      )
    ).toBeUndefined();
    // 魂状態にはならない。
    expect(alice(applied.state).soulStateInstanceIds).not.toContain("contract");

    const cardAfter = getCard(applied.state, "contract");
    expect(cardAfter.zone).toBe("trash");
    expect(cardAfter.pendingLeaveKind).toBeNull();
  });

  it("(4) 選択プレイヤーでない相手には resolve_soul_state_replacement が出ない", () => {
    const state = withContractPending(3);
    const bobActions = getLegalActions({
      state,
      actingPlayerId: BOB,
      ...noLookups,
    });
    expect(
      bobActions.filter((a) => a.kind === "resolve_soul_state_replacement")
    ).toHaveLength(0);
    // prompt resolver gate により相手には一切のアクションが返らない。
    expect(bobActions).toHaveLength(0);
  });

  it("(5) 回帰: pending が立つと choosing player には必ず合法手があり deadlock しない (旧: 未配線で 0 手)", () => {
    const state = withContractPending(2);
    const actions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...noLookups,
    });
    // 旧挙動ではここが 0 件 → current-actor は ALICE を指すのに合法手ゼロで deadlock。
    // 配線後は keep / decline が必ず存在する。
    expect(actions.length).toBeGreaterThan(0);
    expect(
      actions.every((a) => a.kind === "resolve_soul_state_replacement")
    ).toBe(true);

    // どちらの選択でも pending は解消する (= 必ず前進できる)。
    for (const choice of ["keep", "decline"] as const) {
      const action = actions.find(
        (a) =>
          a.kind === "resolve_soul_state_replacement" &&
          (a as { choice?: string }).choice === choice
      )!;
      const applied = applyLegalAction({ state, action, ...noLookups });
      expect(applied.state.pendingSoulStateReplacement).toBeNull();
    }
  });
});
