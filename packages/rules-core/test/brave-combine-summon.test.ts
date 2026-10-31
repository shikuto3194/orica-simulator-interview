/**
 * ブレイヴ召喚 → スタック窓 → 解決時の「合体する/スピリット状態」選択フローのテスト。
 *
 * 公式ルール:
 * - `10_rules/02_turn-flow-and-timing.md`「コスト支払い完了後に窓が開く」
 * - `10_rules/05_brave-and-attack-special-cases.md`「召喚時にすぐに合体させることもできる」
 *   = 合体は場入り (解決) の一部。
 *
 * 手順: 召喚宣言 → コスト支払い → スタック窓 → (窓クローズ後の解決時に) 合体可否＋
 * 合体先 host を決める。合体可否の選択はスタック窓より後なので、宣言時に host は選ばない。
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition, GameState, LegalAction } from "../src/model";
import { getLegalActions, applyLegalAction } from "../src/index";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { BSAZ02_CARDS } from "../../card-data/src/cards/BSAZ02";
import { BSTH01_CARDS } from "../../card-data/src/cards/BSTH01";
import { getValidBraveCombineHosts } from "../src/legal/legal-actions-shared";
import { resolveDeferredPlayCardWithPlacement } from "../src/play/play-card-resolution";

function makeBrave(
  cardNo: string,
  braveCondition?: CardDefinition["braveCondition"],
  cost = 2,
  requiredCores = 1
): CardDefinition {
  return {
    cardNo,
    name: `Brave ${cardNo}`,
    printedCategory: "brave",
    colors: ["red"],
    cost,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores, bp: 2000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    ...(braveCondition ? { braveCondition } : {}),
  };
}

function makeSpirit(cardNo: string, name: string): CardDefinition {
  return {
    cardNo,
    name,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

function createLookup(defs: CardDefinition[]) {
  const map = new Map(defs.map((d) => [d.cardNo, d]));
  return (id: string) => map.get(id);
}

const noFieldEffects = () => [] as const;

function setup(
  braveDef: CardDefinition,
  hostDef: CardDefinition,
  reserveCores = 5,
  hostCores = 1
) {
  const baseState = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(braveDef, {
        instanceId: "brave-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: hostCores,
      }),
    ],
    playerOverrides: [{ reserveNormalCoreCount: reserveCores }],
  });
  return {
    state: { ...baseState, step: "main" as const, activePlayerId: "alice" },
    lookup: createLookup([braveDef, hostDef]),
    triggeredLookup: buildTriggeredEffectLookup([braveDef, hostDef]),
  };
}

type Lookup = (id: string) => CardDefinition | undefined;
type TriggeredLookup = ReturnType<typeof buildTriggeredEffectLookup>;

function legalActions(state: GameState, lookup: Lookup): LegalAction[] {
  return getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: lookup,
    getRegisteredFieldCardEffectActions: noFieldEffects,
  });
}

/** ブレイヴを通常 summon で宣言する (コスト支払い後にスタック窓が開く)。 */
function declareBraveSummon(
  state: GameState,
  lookup: Lookup,
  triggeredLookup: TriggeredLookup,
  paymentSources: { kind: "reserve"; amount: number }[]
): GameState {
  const summon = legalActions(state, lookup).find(
    (a) => a.kind === "summon" && a.sourceInstanceId === "brave-1"
  );
  expect(summon).toBeDefined();
  return applyLegalAction({
    state,
    action: summon!,
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    paymentSources,
  }).state;
}

/** 相手 (bob) がスタックをパスして窓を閉じる。 */
function passStackAsBob(
  state: GameState,
  lookup: Lookup,
  triggeredLookup: TriggeredLookup
): GameState {
  const pass = getLegalActions({
    state,
    actingPlayerId: "bob",
    getCardDefinitionById: lookup,
    getRegisteredFieldCardEffectActions: noFieldEffects,
  }).find((a) => a.kind === "pass_stack");
  expect(pass).toBeDefined();
  return applyLegalAction({
    state,
    action: pass!,
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
}

function combineChoiceActions(
  state: GameState,
  lookup: Lookup
): Extract<LegalAction, { kind: "resolve_brave_combine_choice" }>[] {
  return legalActions(state, lookup).filter(
    (a): a is Extract<LegalAction, { kind: "resolve_brave_combine_choice" }> =>
      a.kind === "resolve_brave_combine_choice"
  );
}

/** 合体選択を解決する (host 指定 or null=スピリット状態)。 */
function applyCombineChoice(
  state: GameState,
  chosenHostInstanceId: string | null,
  lookup: Lookup,
  triggeredLookup: TriggeredLookup
): GameState {
  const action = combineChoiceActions(state, lookup).find(
    (a) => a.chosenHostInstanceId === chosenHostInstanceId
  );
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).state;
}

/** 場入りコア配置 pending を解決する。 */
function resolvePlacement(
  state: GameState,
  placements: { kind: string; amount: number }[],
  lookup: Lookup,
  triggeredLookup: TriggeredLookup
): GameState {
  const resolve = legalActions(state, lookup).find(
    (a) => a.kind === "resolve_pending_enter_field_placement"
  );
  expect(resolve).toBeDefined();
  return applyLegalAction({
    state,
    action: resolve!,
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: triggeredLookup,
    enterFieldCorePlacements: placements as never,
  }).state;
}

const card = (state: GameState, id: string) =>
  state.cardInstances.find((c) => c.instanceId === id);

describe("ブレイヴ召喚 → スタック窓 → 解決時合体選択", () => {
  const driveDef = BSAZ02_CARDS.find((d) => d.cardNo === "BSAZ02-C10")!;

  it("BSAZ02-C10 は定義だけの直接合体候補でも印字の合体不可を適用する", () => {
    const { state, lookup } = setup(driveDef, makeSpirit("HOST-C10", "ホスト"));
    expect(getValidBraveCombineHosts(state, driveDef, "alice", lookup)).toEqual(
      []
    );
    expect(
      getValidBraveCombineHosts(state, driveDef, "alice", lookup, "brave-1")
    ).toEqual([]);
  });

  it("直接合体候補は incoming instance の合体不可を適用し、無制約の同定義は許可する", () => {
    const braveDef = makeBrave("BRAVE-RESTRICTED");
    const { state, lookup } = setup(
      braveDef,
      makeSpirit("HOST-RESTRICTED", "ホスト")
    );
    state.activeContinuousEffects = [
      {
        effectId: "cannot-combine-incoming",
        sourceInstanceId: "host-1",
        sourceDefinitionId: "HOST-RESTRICTED",
        actingPlayerId: "alice",
        duration: { scope: "permanent" },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "override_properties",
        targetInstanceId: "brave-1",
        metadata: { properties: { keywords: ["cannot_combine"] } },
      },
    ];
    expect(
      getValidBraveCombineHosts(state, braveDef, "alice", lookup, "brave-1")
    ).toEqual([]);
    expect(
      getValidBraveCombineHosts(state, braveDef, "alice", lookup).map(
        (h) => h.instanceId
      )
    ).toEqual(["host-1"]);
  });

  it("BSAZ02-C10 の手札召喚は窓後も合体選択なしでスピリット状態に場入りする", () => {
    const { state, lookup, triggeredLookup } = setup(
      driveDef,
      makeSpirit("HOST-DRIVE", "ホスト")
    );
    const opened = declareBraveSummon(state, lookup, triggeredLookup, [
      { kind: "reserve", amount: 1 },
    ]);
    expect(opened.window).toBe("stack");
    const afterPass = passStackAsBob(opened, lookup, triggeredLookup);
    expect(afterPass.pendingBraveCombineChoice).toBeNull();
    expect(combineChoiceActions(afterPass, lookup)).toEqual([]);
    const resolved = afterPass.pendingEnterFieldPlacement
      ? resolvePlacement(afterPass, [], lookup, triggeredLookup)
      : afterPass;
    expect(resolved.pendingBraveCombineChoice).toBeNull();
    expect(combineChoiceActions(resolved, lookup)).toEqual([]);
    expect(card(resolved, "brave-1")).toMatchObject({
      zone: "field",
      zoneRoleName: "brave",
      attachedToInstanceId: null,
      normalCoreCount: 0,
    });
    expect(card(resolved, "host-1")?.attachedChildrenIds).toEqual([]);
    expect(
      resolved.log.filter((line) =>
        /brave:combine|brave:separate|brave-forced-separation|cannot_combine/.test(
          line
        )
      )
    ).toEqual([]);
  });

  it("BSAZ02-C10 を注入済みの合体先で通常召喚解決しても attach 前に拒否する", () => {
    const { state, lookup, triggeredLookup } = setup(
      driveDef,
      makeSpirit("HOST-STALE", "ホスト")
    );
    const opened = declareBraveSummon(state, lookup, triggeredLookup, [
      { kind: "reserve", amount: 1 },
    ]);
    const stack = opened.stackWindow!.pendingStackAction!;
    expect(() =>
      resolveDeferredPlayCardWithPlacement({
        state: opened,
        activeStack: {
          ...stack,
          combineHostInstanceId: "host-1",
          enterFieldCorePlacements: [],
        },
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggeredLookup,
        getRegisteredBurstActions: () => [],
      })
    ).toThrow(/cannot combine incoming brave/);
    expect(card(opened, "brave-1")?.attachedToInstanceId).toBeNull();
    expect(card(opened, "host-1")?.attachedChildrenIds).toEqual([]);
  });

  it("実C10の配置pendingに別ブレイヴ定義とhostを注入しても attach 前に拒否する", () => {
    const hostDef = BSTH01_CARDS.find((d) => d.cardNo === "BSTH01-X04")!;
    const otherBraveDef = BSAZ02_CARDS.find((d) => d.cardNo === "BSAZ02-C11")!;
    expect(otherBraveDef.keywordTags).not.toContain("cannot_combine");
    const { state } = setup(driveDef, hostDef, 5, 3);
    const defs = [driveDef, hostDef, otherBraveDef];
    const lookup = createLookup(defs);
    const triggeredLookup = buildTriggeredEffectLookup(defs);
    const opened = declareBraveSummon(state, lookup, triggeredLookup, [
      { kind: "reserve", amount: 1 },
    ]);
    const afterPass = passStackAsBob(opened, lookup, triggeredLookup);
    const placement = afterPass.pendingEnterFieldPlacement!;
    expect(placement.deferredStack?.cardDefinitionId).toBe(driveDef.cardNo);
    const injected: GameState = {
      ...afterPass,
      pendingEnterFieldPlacement: {
        ...placement,
        deferredStack: {
          ...placement.deferredStack!,
          cardDefinitionId: otherBraveDef.cardNo,
          combineHostInstanceId: "host-1",
        },
      },
    };
    const before = JSON.stringify(injected);
    expect(() =>
      resolvePlacement(injected, [], lookup, triggeredLookup)
    ).toThrow(/cannot combine incoming brave/);
    expect(JSON.stringify(injected)).toBe(before);
    expect(card(injected, "brave-1")).toMatchObject({
      definitionId: driveDef.cardNo,
      zone: "in_use",
      attachedToInstanceId: null,
    });
    expect(card(injected, "host-1")?.attachedChildrenIds).toEqual([]);
  });

  it("合体選択後に incoming instance が合体不可になった stale pending は attach 前に拒否する", () => {
    const braveDef = makeBrave("BRAVE-STALE-RESTRICTION");
    const { state, lookup, triggeredLookup } = setup(
      braveDef,
      makeSpirit("HOST-STALE-RESTRICTION", "ホスト")
    );
    const opened = declareBraveSummon(state, lookup, triggeredLookup, [
      { kind: "reserve", amount: 2 },
    ]);
    const chosen = applyCombineChoice(
      passStackAsBob(opened, lookup, triggeredLookup),
      "host-1",
      lookup,
      triggeredLookup
    );
    chosen.activeContinuousEffects = [
      {
        effectId: "stale-cannot-combine",
        sourceInstanceId: "host-1",
        sourceDefinitionId: "HOST-STALE-RESTRICTION",
        actingPlayerId: "alice",
        duration: { scope: "permanent" },
        createdAtTurn: 1,
        createdAtAttackId: null,
        modifierTag: "override_properties",
        targetInstanceId: "brave-1",
        metadata: { properties: { keywords: ["cannot_combine"] } },
      },
    ];
    const before = JSON.stringify(chosen);
    expect(() => resolvePlacement(chosen, [], lookup, triggeredLookup)).toThrow(
      /cannot combine incoming brave/
    );
    expect(JSON.stringify(chosen)).toBe(before);
  });

  it("召喚はコスト支払い後にスタック窓を開く (合体可否は窓より後、宣言時に host を選ばない)", () => {
    const braveDef = makeBrave("BRAVE-A");
    const hostDef = makeSpirit("HOST-A", "ホストA");
    const { state, lookup, triggeredLookup } = setup(braveDef, hostDef);

    // 宣言時の合法手に brave_combine_summon は存在せず、通常 summon のみ。
    const acts = legalActions(state, lookup);
    expect(acts.some((a) => a.kind === "summon")).toBe(true);
    expect(
      acts.some((a) => (a as { kind: string }).kind === "brave_combine_summon")
    ).toBe(false);

    const opened = declareBraveSummon(state, lookup, triggeredLookup, [
      { kind: "reserve", amount: 2 },
    ]);
    // コスト支払い後にスタック窓が開く。ブレイヴはまだ場入りしておらず合体選択も未提示。
    expect(opened.window).toBe("stack");
    expect(opened.stackWindow?.priorityPlayerId).toBe("bob");
    expect(card(opened, "brave-1")?.zone).toBe("in_use");
    expect(opened.pendingBraveCombineChoice).toBeNull();
  });

  it("窓クローズ後に合体選択 pending が出る (生存ホスト候補 + スピリット状態)", () => {
    const braveDef = makeBrave("BRAVE-B");
    const hostDef = makeSpirit("HOST-B", "ホストB");
    const { state, lookup, triggeredLookup } = setup(braveDef, hostDef);

    const opened = declareBraveSummon(state, lookup, triggeredLookup, [
      { kind: "reserve", amount: 2 },
    ]);
    const afterPass = passStackAsBob(opened, lookup, triggeredLookup);

    // 窓クローズ後に合体選択 pending。候補は host-1 のみ。
    expect(afterPass.pendingBraveCombineChoice?.braveInstanceId).toBe(
      "brave-1"
    );
    expect(
      afterPass.pendingBraveCombineChoice?.hostCandidateInstanceIds
    ).toEqual(["host-1"]);

    const choices = combineChoiceActions(afterPass, lookup);
    // host-1 への合体 + スピリット状態 (null) の 2 択。
    expect(choices.map((a) => a.chosenHostInstanceId).sort()).toEqual([
      "host-1",
      null,
    ]);
  });

  it("合体選択は現在の pendingId と一致しない古い action を拒否する", () => {
    const braveDef = makeBrave("BRAVE-PENDING-ID");
    const hostDef = makeSpirit("HOST-PENDING-ID", "ホストPending");
    const { state, lookup, triggeredLookup } = setup(braveDef, hostDef);

    const opened = declareBraveSummon(state, lookup, triggeredLookup, [
      { kind: "reserve", amount: 2 },
    ]);
    const afterPass = passStackAsBob(opened, lookup, triggeredLookup);
    const action = combineChoiceActions(afterPass, lookup).find(
      (a) => a.chosenHostInstanceId === "host-1"
    );
    expect(action).toBeDefined();

    expect(() =>
      applyLegalAction({
        state: afterPass,
        action: { ...action!, pendingId: "stale-pending-id" },
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggeredLookup,
      })
    ).toThrow(/pendingId mismatch/);
  });

  it("合体を選ぶとブレイヴがホストへ attach する (コア配置任意 min 0)", () => {
    const braveDef = makeBrave("BRAVE-C");
    const hostDef = makeSpirit("HOST-C", "ホストC");
    const { state, lookup, triggeredLookup } = setup(braveDef, hostDef);
    const hostCoresBefore = card(state, "host-1")!.normalCoreCount;

    const opened = declareBraveSummon(state, lookup, triggeredLookup, [
      { kind: "reserve", amount: 2 },
    ]);
    const afterPass = passStackAsBob(opened, lookup, triggeredLookup);
    const afterChoice = applyCombineChoice(
      afterPass,
      "host-1",
      lookup,
      triggeredLookup
    );

    // 合体を選んだので場入りコアは任意 (min 0)。
    expect(afterChoice.pendingEnterFieldPlacement?.minimumCoreCount).toBe(0);
    const resolved = resolvePlacement(afterChoice, [], lookup, triggeredLookup);

    const brave = card(resolved, "brave-1");
    const host = card(resolved, "host-1");
    expect(brave?.zone).toBe("field");
    expect(brave?.attachedToInstanceId).toBe("host-1");
    expect(host?.attachedChildrenIds).toContain("brave-1");
    // コア配置 0 なので host のコアは増えず、ブレイヴ自身のコアは 0。
    expect(host?.normalCoreCount).toBe(hostCoresBefore);
    expect(brave?.normalCoreCount).toBe(0);
  });

  it("配置したコアは合体先ホストへ移動する", () => {
    const braveDef = makeBrave("BRAVE-D");
    const hostDef = makeSpirit("HOST-D", "ホストD");
    const { state, lookup, triggeredLookup } = setup(braveDef, hostDef);
    const hostCoresBefore = card(state, "host-1")!.normalCoreCount;

    const opened = declareBraveSummon(state, lookup, triggeredLookup, [
      { kind: "reserve", amount: 2 },
    ]);
    const afterPass = passStackAsBob(opened, lookup, triggeredLookup);
    const afterChoice = applyCombineChoice(
      afterPass,
      "host-1",
      lookup,
      triggeredLookup
    );
    const resolved = resolvePlacement(
      afterChoice,
      [{ kind: "reserve_normal", amount: 1 }],
      lookup,
      triggeredLookup
    );

    const brave = card(resolved, "brave-1");
    const host = card(resolved, "host-1");
    expect(brave?.attachedToInstanceId).toBe("host-1");
    expect(brave?.normalCoreCount).toBe(0);
    // 配置した 1 個はホストへ移動。
    expect(host?.normalCoreCount).toBe(hostCoresBefore + 1);
  });

  it("スピリット状態を選ぶと非合体で場入りする (場入りコアは Lv1)", () => {
    const braveDef = makeBrave("BRAVE-E");
    const hostDef = makeSpirit("HOST-E", "ホストE");
    const { state, lookup, triggeredLookup } = setup(braveDef, hostDef);

    const opened = declareBraveSummon(state, lookup, triggeredLookup, [
      { kind: "reserve", amount: 2 },
    ]);
    const afterPass = passStackAsBob(opened, lookup, triggeredLookup);
    const afterChoice = applyCombineChoice(
      afterPass,
      null,
      lookup,
      triggeredLookup
    );

    // スピリット状態は Lv1 必須コア (=1)。
    expect(afterChoice.pendingEnterFieldPlacement?.minimumCoreCount).toBe(1);
    const resolved = resolvePlacement(
      afterChoice,
      [{ kind: "reserve_normal", amount: 1 }],
      lookup,
      triggeredLookup
    );

    const brave = card(resolved, "brave-1");
    expect(brave?.zone).toBe("field");
    expect(brave?.attachedToInstanceId ?? null).toBeNull();
    expect(brave?.normalCoreCount).toBe(1);
  });

  it("合体条件 (cardNames 完全一致) を満たすホストだけが合体候補になる", () => {
    const braveDef = makeBrave("BRAVE-NAMED", { cardNames: ["指定ホスト"] });
    const hostDef = makeSpirit("HOST-NAMED", "指定ホスト");
    const { state, lookup, triggeredLookup } = setup(braveDef, hostDef);

    const opened = declareBraveSummon(state, lookup, triggeredLookup, [
      { kind: "reserve", amount: 2 },
    ]);
    const afterPass = passStackAsBob(opened, lookup, triggeredLookup);
    expect(
      afterPass.pendingBraveCombineChoice?.hostCandidateInstanceIds
    ).toEqual(["host-1"]);
  });

  it("合体条件を満たさないホストしかない場合、合体選択 pending は出ず直接スピリット状態場入りへ", () => {
    const braveDef = makeBrave("BRAVE-NOMATCH", { cardNames: ["別のホスト"] });
    const hostDef = makeSpirit("HOST-OTHER", "ホスト");
    const { state, lookup, triggeredLookup } = setup(braveDef, hostDef);

    const opened = declareBraveSummon(state, lookup, triggeredLookup, [
      { kind: "reserve", amount: 2 },
    ]);
    const afterPass = passStackAsBob(opened, lookup, triggeredLookup);
    // 合体候補なし → 合体選択をスキップして場入りコア配置 (スピリット状態) へ。
    expect(afterPass.pendingBraveCombineChoice).toBeNull();
    expect(afterPass.pendingEnterFieldPlacement?.sourceInstanceId).toBe(
      "brave-1"
    );
    expect(afterPass.pendingEnterFieldPlacement?.minimumCoreCount).toBe(1);
  });

  it("既にブレイヴが合体しているホストは合体候補にならない (1体1ブレイヴ)", () => {
    const braveDef = makeBrave("BRAVE-SECOND");
    const hostDef = makeSpirit("HOST-F", "ホストF");
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(braveDef, {
          instanceId: "brave-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        {
          ...createCardInstance(hostDef, {
            instanceId: "host-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          attachedChildrenIds: ["existing-brave"],
        },
      ],
      playerOverrides: [{ reserveNormalCoreCount: 5 }],
    });
    const state: GameState = {
      ...baseState,
      step: "main",
      activePlayerId: "alice",
    };
    const lookup = createLookup([braveDef, hostDef]);
    const triggeredLookup = buildTriggeredEffectLookup([braveDef, hostDef]);

    const opened = declareBraveSummon(state, lookup, triggeredLookup, [
      { kind: "reserve", amount: 2 },
    ]);
    const afterPass = passStackAsBob(opened, lookup, triggeredLookup);
    // 合体済みホストは候補外 → 合体選択 pending は出ない。
    expect(afterPass.pendingBraveCombineChoice).toBeNull();
    expect(afterPass.pendingEnterFieldPlacement?.sourceInstanceId).toBe(
      "brave-1"
    );
  });

  it("スタック窓中に合体先が離れたら候補から外れる (解決時に再算出、フォールバック不要)", () => {
    const braveDef = makeBrave("BRAVE-HOSTGONE", undefined, 2, 0);
    const hostDef = makeSpirit("HOST-GONE", "消える合体先");
    const { state, lookup, triggeredLookup } = setup(braveDef, hostDef);

    const opened = declareBraveSummon(state, lookup, triggeredLookup, [
      { kind: "reserve", amount: 2 },
    ]);
    // スタック窓中に相手効果で host-1 がフィールドを離れた状況を模す。
    const hostGone: GameState = {
      ...opened,
      cardInstances: opened.cardInstances.map((c) =>
        c.instanceId === "host-1" ? { ...c, zone: "trash" as const } : c
      ),
    };
    const afterPass = passStackAsBob(hostGone, lookup, triggeredLookup);

    // 合体候補が消えたので合体選択 pending は出ず、非合体で場入りへ (Lv1=0 なのでコア 0 で確定可)。
    expect(afterPass.pendingBraveCombineChoice).toBeNull();
    const resolved = resolvePlacement(afterPass, [], lookup, triggeredLookup);
    const brave = card(resolved, "brave-1");
    expect(brave?.zone).toBe("field");
    expect(brave?.attachedToInstanceId ?? null).toBeNull();
  });

  it("合体先があれば コスト+Lv1 を払えなくてもコストのみで召喚でき、合体選択でスピリット状態は出さない", () => {
    // ブレイヴ Lv1 必須コア=2 / cost=2。リザーブ=2 (コストちょうど)、host=1 コア。
    // コスト+Lv1 (=4) は払えないが、合体すれば場入りコアは 0 で足りる。
    const braveDef = makeBrave("BRAVE-AFFORD", undefined, 2, 2);
    const hostDef = makeSpirit("HOST-AFFORD", "ホストAff");
    const { state, lookup, triggeredLookup } = setup(braveDef, hostDef, 2, 1);

    // 合体先があるので summon は提示される (場入り最小コア 0 = 合体前提の affordability)。
    const summon = legalActions(state, lookup).find(
      (a) => a.kind === "summon" && a.sourceInstanceId === "brave-1"
    );
    expect(summon).toBeDefined();
    expect(
      (summon as { minimumEnterFieldCoreCount: number })
        .minimumEnterFieldCoreCount
    ).toBe(0);

    const opened = declareBraveSummon(state, lookup, triggeredLookup, [
      { kind: "reserve", amount: 2 },
    ]);
    const afterPass = passStackAsBob(opened, lookup, triggeredLookup);

    // 支払い後 (リザーブ 0 + host 1 = 1 < Lv1 2) なのでスピリット状態は払えない。
    expect(afterPass.pendingBraveCombineChoice?.spiritStateAffordable).toBe(
      false
    );
    // 合体選択は host への合体のみ (スピリット状態の選択肢は出さない)。
    const choices = combineChoiceActions(afterPass, lookup);
    expect(choices.map((a) => a.chosenHostInstanceId)).toEqual(["host-1"]);

    // 合体は 0 コアで成立。
    const afterChoice = applyCombineChoice(
      afterPass,
      "host-1",
      lookup,
      triggeredLookup
    );
    const resolved = resolvePlacement(afterChoice, [], lookup, triggeredLookup);
    expect(card(resolved, "brave-1")?.attachedToInstanceId).toBe("host-1");
  });

  it("リザーブのソウルコアだけで Lv1 を満たせるなら、スピリット状態を選んで配置できる", () => {
    const braveDef = makeBrave("BRAVE-RESERVE-SOUL", undefined, 0, 1);
    const hostDef: CardDefinition = {
      ...makeSpirit("HOST-RESERVE-SOUL", "ソウル配置ホスト"),
      levelDefs: [{ level: 1, requiredCores: 0, bp: 3000 }],
    };
    const { state, lookup, triggeredLookup } = setup(braveDef, hostDef, 0, 0);
    const soulOnlyState: GameState = {
      ...state,
      players: state.players.map((player) =>
        player.id === "alice"
          ? {
              ...player,
              reserveSoulCoreCount: 1,
              soulCoreLocation: { kind: "reserve" },
            }
          : player
      ),
    };

    const opened = declareBraveSummon(
      soulOnlyState,
      lookup,
      triggeredLookup,
      []
    );
    const afterPass = passStackAsBob(opened, lookup, triggeredLookup);
    expect(afterPass.pendingBraveCombineChoice?.spiritStateAffordable).toBe(
      true
    );
    expect(
      combineChoiceActions(afterPass, lookup).map(
        (action) => action.chosenHostInstanceId
      )
    ).toContain(null);

    const afterChoice = applyCombineChoice(
      afterPass,
      null,
      lookup,
      triggeredLookup
    );
    expect(afterChoice.pendingEnterFieldPlacement?.minimumCoreCount).toBe(1);
    const resolved = resolvePlacement(
      afterChoice,
      [{ kind: "reserve_soul" }],
      lookup,
      triggeredLookup
    );
    expect(card(resolved, "brave-1")?.zone).toBe("field");
    expect(card(resolved, "brave-1")?.soulCoreCount).toBe(1);
    expect(
      resolved.players.find((player) => player.id === "alice")
        ?.reserveSoulCoreCount
    ).toBe(0);
  });

  it("合体先がなく コスト+Lv1 を払えないブレイヴは召喚提示されない", () => {
    // 合体条件を満たすホストがいない (= 合体不可) ＋ コスト+Lv1 不足 → 召喚不可。
    const braveDef = makeBrave(
      "BRAVE-POOR",
      { cardNames: ["存在しない"] },
      2,
      2
    );
    const hostDef = makeSpirit("HOST-NOMATCH", "別物");
    const { state, lookup } = setup(braveDef, hostDef, 2, 1);

    const summon = legalActions(state, lookup).find(
      (a) => a.kind === "summon" && a.sourceInstanceId === "brave-1"
    );
    expect(summon).toBeUndefined();
  });

  it("窓中に合体先が離れ Lv1 を払えない場合は召喚不成立のままトラッシュへ置く", () => {
    // ブレイヴ Lv1=2 / cost=2。リザーブ=2 (コストちょうど)、host=1。合体先があるので召喚可。
    const braveDef = makeBrave("BRAVE-VANISH", undefined, 2, 2);
    const hostDef = makeSpirit("HOST-VANISH", "消える合体先");
    const { state, lookup, triggeredLookup } = setup(braveDef, hostDef, 2, 1);

    const opened = declareBraveSummon(state, lookup, triggeredLookup, [
      { kind: "reserve", amount: 2 },
    ]);
    // スタック窓中に相手効果で host-1 がフィールドを離れた状況を模す。
    const hostGone: GameState = {
      ...opened,
      cardInstances: opened.cardInstances.map((c) =>
        c.instanceId === "host-1" ? { ...c, zone: "trash" as const } : c
      ),
    };
    const afterPass = passStackAsBob(hostGone, lookup, triggeredLookup);

    // Lv1 不足は召喚成立後の SBA ではなく、場入り前の不成立。
    expect(afterPass.pendingBraveCombineChoice).toBeNull();
    expect(afterPass.pendingEnterFieldPlacement).toBeNull();
    expect(card(afterPass, "brave-1")?.zone).toBe("trash");
    expect(
      afterPass.log.some(
        (entry) =>
          entry.includes("not-established") && entry.includes(":brave-1:")
      )
    ).toBe(true);
  });

  it("待機ホストの残存コアは配置に使えるが独立管理・強制ボイドコアは使えない", () => {
    const braveDef = makeBrave(
      "BRAVE-PLACEMENT-SOURCES",
      { cardNames: ["支払いホスト"] },
      3,
      1
    );
    const hostDef = {
      ...makeSpirit("HOST-PLACEMENT-SOURCES", "支払いホスト"),
      levelDefs: [{ level: 1, requiredCores: 2, bp: 3000 }],
    };
    const grandwalkerDef: CardDefinition = {
      cardNo: "GRANDWALKER-PLACEMENT-SOURCES",
      name: "独立管理コア",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: ["grandwalker", "enter_field_core_placement_forbidden"],
      grandwalkerData: {
        kind: "grandwalker",
        oracleTriggerKinds: [
          "summon",
          "advent",
          "place",
          "use_magic",
          "use_accel",
        ] as const,
        oracleConditions: [{ tribes: ["夜錆"] }],
      },
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const forcedVoidSourceDef: CardDefinition = {
      ...makeSpirit("FORCED-VOID-PLACEMENT-SOURCES", "強制ボイド源"),
      tokenIndependentCoreManagement: {
        redirectCoresToVoid: true,
        placementRestrictedToEnterField: true,
      },
    };
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(braveDef, {
          instanceId: "brave-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(hostDef, {
          instanceId: "host-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
        createCardInstance(grandwalkerDef, {
          instanceId: "grandwalker-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
        createCardInstance(forcedVoidSourceDef, {
          instanceId: "forced-void-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 2 }],
    });
    const state: GameState = {
      ...baseState,
      step: "main",
      activePlayerId: "alice",
    };
    const lookup = createLookup([
      braveDef,
      hostDef,
      grandwalkerDef,
      forcedVoidSourceDef,
    ]);
    const triggeredLookup = buildTriggeredEffectLookup([
      braveDef,
      hostDef,
      grandwalkerDef,
      forcedVoidSourceDef,
    ]);
    const summon = legalActions(state, lookup).find(
      (action) =>
        action.kind === "summon" && action.sourceInstanceId === "brave-1"
    );
    expect(summon).toBeDefined();

    const opened = applyLegalAction({
      state,
      action: summon!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      paymentSources: [
        { kind: "reserve", amount: 2 },
        { kind: "card", instanceId: "host-1", amount: 1 },
      ],
    }).state;
    expect(card(opened, "host-1")?.pendingLeaveKind).toBe("vanish");

    const afterPass = passStackAsBob(opened, lookup, triggeredLookup);
    expect(afterPass.pendingBraveCombineChoice).toBeNull();
    expect(afterPass.pendingEnterFieldPlacement?.minimumCoreCount).toBe(1);
    const resolved = resolvePlacement(
      afterPass,
      [{ kind: "card_normal", instanceId: "host-1", amount: 1 }],
      lookup,
      triggeredLookup
    );
    expect(card(resolved, "brave-1")).toMatchObject({
      zone: "field",
      normalCoreCount: 1,
    });
    expect(card(resolved, "host-1")?.zone).toBe("trash");
    expect(card(resolved, "grandwalker-1")?.normalCoreCount).toBe(2);
    expect(card(resolved, "forced-void-1")?.normalCoreCount).toBe(2);
  });

  it("耐性で場に残った pending leave マーカー付き通常コアは場入り配置に使える", () => {
    const braveDef = makeBrave(
      "BRAVE-BLOCKED-LEAVE-PLACEMENT",
      { cardNames: ["支払いホスト"] },
      3,
      1
    );
    const hostDef = makeSpirit("HOST-BLOCKED-LEAVE-PLACEMENT", "支払いホスト");
    const resistantSourceDef = makeSpirit(
      "RESISTANT-PLACEMENT-SOURCE",
      "離脱耐性コア源"
    );
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(braveDef, {
          instanceId: "brave-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(hostDef, {
          instanceId: "host-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(resistantSourceDef, {
          instanceId: "resistant-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 2 }],
    });
    const state: GameState = {
      ...baseState,
      step: "main",
      activePlayerId: "alice",
    };
    const lookup = createLookup([braveDef, hostDef, resistantSourceDef]);
    const triggeredLookup = buildTriggeredEffectLookup([
      braveDef,
      hostDef,
      resistantSourceDef,
    ]);
    const summon = legalActions(state, lookup).find(
      (action) =>
        action.kind === "summon" && action.sourceInstanceId === "brave-1"
    );
    expect(summon).toBeDefined();

    const opened = applyLegalAction({
      state,
      action: summon!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      paymentSources: [
        { kind: "reserve", amount: 2 },
        { kind: "card", instanceId: "host-1", amount: 1 },
      ],
    }).state;
    const withBlockedResistanceMarker: GameState = {
      ...opened,
      pendingLeaveEntities: [
        ...opened.pendingLeaveEntities,
        {
          instanceId: "resistant-1",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "bob",
          chainId: "effect:destroy:bob:resistant-1",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
          blockedByResistance: true,
        },
      ],
    };

    const afterPass = passStackAsBob(
      withBlockedResistanceMarker,
      lookup,
      triggeredLookup
    );
    // 耐性で物理離脱していないカードは、pendingLeaveEntities に判定成立マーカーが
    // あっても、通常コアを場入り配置元にできる。
    expect(afterPass.pendingEnterFieldPlacement?.minimumCoreCount).toBe(1);
  });
});
