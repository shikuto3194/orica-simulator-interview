/** 2026-09-13裁定: レキュリアは通常フラッシュ。対象化した未解決効果には自動応答しない。 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { ActiveStack, CardDefinition, GameState } from "../src";

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

const T14 = card("BSLH01-T14");

/** T14 対象化の系統「CB」自分スピリット。フィールド以外 (手札) で「発揮中」を表す合成フィクスチャ。 */
const CB_SPIRIT_DEF: CardDefinition = {
  cardNo: "TEST-T14PIPE-CB-SPIRIT",
  name: "テストCBスピリット(パイプライン)",
  printedCategory: "spirit",
  colors: ["green"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["green"],
  textLines: [],
  keywordTags: [],
  tribe: "CB",
  sourceUrls: [],
  sourceConfidence: "C",
};

/**
 * BOB が使う、CB スピリットを対象化するフラッシュマジック。対象選択ステップの後段に
 * 「対象化が無効化されたか」を観測可能にする count_increase (BOB 視点) を置く。
 * negate されれば以後の steps は一切実行されないため、BOB の countValue が動くかどうかで
 * 判定できる。0 コストの合成カードで、コスト支払いの複雑さを迂回する
 * (実質は use_magic legal action を経由するため「本物のパイプライン」の要件は満たす)。
 */
const ATTACKER_MAGIC_DEF: CardDefinition = {
  cardNo: "TEST-T14PIPE-ATTACKER-MAGIC",
  name: "TEST 対象化マジック(パイプライン)",
  printedCategory: "magic",
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "地球人",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      // ALICE 側の off-field CB スピリット活性化 (offFieldActivation) が既に
      // stackWindow.pendingStackAction を占有した応答窓を BOB が使う想定のため、
      // getResponseWindowActionTimings は pendingStackAction!==null 時に
      // ["stack"] のみを返す (mode:"flash" は stackResponseSourcePlayerId===self の
      // 純粋な新規フラッシュ窓でのみ許可される)。
      timing: { kind: "activated", mode: "stack" },
      steps: [
        {
          // 選択専用 noop は target metadata に載るが、この合成マジックでは
          // 効果実行の可視動作も残すため exhaust を使う。疲労状態は対象の
          // CB スピリットが手札にいるため実害の無い副作用として扱える。
          id: "target-select",
          action: {
            kind: "exhaust",
            target: {
              kind: "filter",
              player: "opponent",
              // target.zone 未指定の既定は ["field"] (extractFieldTargetingFromAction)。
              // off-field (手札) の CB スピリットを候補に含めるため明示指定する。
              zone: ["hand"],
              filter: { cardName: { exact: CB_SPIRIT_DEF.name } },
              count: 1,
            },
          },
        },
        {
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    },
  ],
};

const combinedDefs = new Map<string, CardDefinition>(cardNoMap);
combinedDefs.set(CB_SPIRIT_DEF.cardNo, CB_SPIRIT_DEF);
combinedDefs.set(ATTACKER_MAGIC_DEF.cardNo, ATTACKER_MAGIC_DEF);
const getDef = (id: string): CardDefinition | undefined => combinedDefs.get(id);

const triggeredLookup = buildTriggeredEffectLookup([T14]);
const realMagicLookup = buildMagicLookup(ALL_CARDS);
const syntheticMagicLookup = buildMagicLookup([ATTACKER_MAGIC_DEF]);
const magicLookup = (cardNo: string) =>
  syntheticMagicLookup(cardNo) ?? realMagicLookup(cardNo);

const legalActionCommonOptions = {
  getCardDefinitionById: getDef,
  getRegisteredTriggeredEffectActions: triggeredLookup,
  getRegisteredMagicActions: magicLookup,
  getRegisteredBurstActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredHandCardEffectActions: () => [],
  getRegisteredBattleImmediateEffectActions: () => [],
};

/**
 * off-field-cb 自身の効果が現在応答窓で発揮中 (= 宣言済み・未解決) であることを表す
 * 保留 ActiveStack。BOB の対象化マジックとは別の ActiveStack
 * (engine-targeted-disclosure-offfield-source.test.ts offFieldActivation と同型)。
 */
function buildOffFieldActivation(cbInstanceId: string): ActiveStack {
  return {
    stackId: "stack:t14pipe-off-field-cb-activation",
    actionKind: "hand_card_effect",
    chainId: "chain:t14pipe-off-field-cb-activation",
    actingPlayerId: ALICE,
    cardInstanceId: cbInstanceId,
    cardDefinitionId: CB_SPIRIT_DEF.cardNo,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    chosenTiming: "flash",
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
}

/**
 * T14 をフィールドに直接配置し、自分の CB スピリットが手札で「発揮中」の応答窓を開き、
 * BOB に対象化マジックを持たせた初期状態を構築する。
 * bslh01-arts-tribe-immunity.test.ts の srcT07 パターン (createCardInstance で直接
 * フィールド配置、Arts summonCondition は召喚 legal action のみをゲートし、直接配置には
 * 影響しない) に準拠。
 */
function buildInitialState(): GameState {
  const t14 = createCardInstance(T14, {
    instanceId: "t14",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 0,
  });
  const cbSpirit = createCardInstance(CB_SPIRIT_DEF, {
    instanceId: "off-field-cb",
    ownerPlayerId: ALICE,
    controllerPlayerId: ALICE,
    zone: "hand",
  });
  const attackerMagic = createCardInstance(ATTACKER_MAGIC_DEF, {
    instanceId: "attacker-magic",
    ownerPlayerId: BOB,
    controllerPlayerId: BOB,
    zone: "hand",
  });
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [t14, cbSpirit, attackerMagic],
    playerOverrides: [{ handCount: 1 }, { handCount: 1 }],
  });
  return {
    ...base,
    activePlayerId: BOB,
    step: "attack",
    window: "stack",
    stackWindow: {
      actingPlayerId: ALICE,
      previousWindow: "main",
      priorityPlayerId: BOB,
      consecutivePassCount: 0,
      stackResponseSourcePlayerId: ALICE,
      subStackEverOpened: false,
      burstWindowKind: null,
      pendingStackAction: buildOffFieldActivation("off-field-cb"),
    },
  };
}

/** BOB の対象化マジックを use_magic legal action で見つけて宣言し、解決後の state を返す。 */
function declareAttackerMagic(state: GameState): GameState {
  const actions = getLegalActions({
    state,
    actingPlayerId: BOB,
    ...legalActionCommonOptions,
  });
  const useAction = actions.find(
    (a) =>
      a.kind === "use_magic" &&
      a.sourceInstanceId === "attacker-magic" &&
      a.candidateTargetInstanceIds.includes("off-field-cb")
  );
  expect(useAction).toBeDefined();
  const applied = applyLegalAction({
    state,
    action: useAction!,
    targetInstanceIds: ["off-field-cb"],
    ...legalActionCommonOptions,
  });
  // 「スタック」効果 (mode:"stack") は use_magic 宣言時点では即解決されず、新規
  // ActiveStack (BOB の対象化マジック自身) が応答窓を占有するだけ。両者が pass する
  // ことで実際に対象化ステップ (target-select) まで解決が進み、disclosure が queue される
  // ……はずだったが、下記 KNOWN GAP により実際には queue されない。
  return drainToDisclosureQueue(applied.state);
}

/**
 * 応答窓を pass_stack で機械的にドレインするが、途中で
 * pendingTargetedDisclosureContinuation が立った時点で停止する
 * (T14 の disclosure 応答自体は別途 declare させるため、それより先には進めない)。
 */
function drainToDisclosureQueue(state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (
    current.pendingTargetedDisclosureContinuation === null &&
    current.window === "stack" &&
    current.stackWindow &&
    guard++ < 20
  ) {
    const responderId = current.stackWindow.priorityPlayerId;
    const actions = getLegalActions({
      state: current,
      actingPlayerId: responderId,
      ...legalActionCommonOptions,
    });
    const pass = actions.find((a) => a.kind === "pass_stack");
    if (!pass) break;
    current = applyLegalAction({
      state: current,
      action: pass,
      ...legalActionCommonOptions,
    }).state;
  }
  return current;
}

/** 開いているスタック窓を、両者 pass_stack で機械的にドレインする。 */
function drainStackWindow(state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (current.window === "stack" && current.stackWindow && guard++ < 20) {
    const responderId = current.stackWindow.priorityPlayerId;
    const actions = getLegalActions({
      state: current,
      actingPlayerId: responderId,
      ...legalActionCommonOptions,
    });
    const pass = actions.find((a) => a.kind === "pass_stack");
    expect(pass).toBeDefined();
    current = applyLegalAction({
      state: current,
      action: pass!,
      ...legalActionCommonOptions,
    }).state;
  }
  return current;
}

describe("BSLH01-T14: 未解決効果へ自動応答しない", () => {
  it("合法なスタック借用で先にレキュリアを発揮しても、後から解決する元効果は残る", () => {
    const timedMagic: CardDefinition = {
      ...ATTACKER_MAGIC_DEF,
      cardNo: "TEST-T14PIPE-TIMED-MAGIC",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          steps: [
            {
              action: {
                kind: "prevent_battle",
                target: {
                  kind: "filter",
                  player: "opponent",
                  filter: { tribes: ["CB"], category: ["spirit"] },
                  count: "all",
                },
                restriction: ["attack"],
                duration: { scope: "turn" },
              },
            },
          ],
        },
      ],
    };
    const borrower: CardDefinition = {
      ...ATTACKER_MAGIC_DEF,
      cardNo: "TEST-T14PIPE-STACK-BORROW",
      tribe: "CB",
      effects: [
        {
          timing: { kind: "activated", mode: "stack" },
          steps: [
            {
              action: {
                kind: "borrow_magic_effect",
                target: {
                  kind: "filter",
                  player: "self",
                  zone: "field",
                  filter: { cardName: { exact: T14.name } },
                  count: 1,
                },
                borrowModes: ["flash"],
              },
            },
          ],
        },
      ],
    };
    const definitions = [T14, CB_SPIRIT_DEF, timedMagic, borrower];
    const options = {
      ...legalActionCommonOptions,
      getCardDefinitionById: (id: string) =>
        definitions.find((c) => c.cardNo === id),
      getRegisteredMagicActions: buildMagicLookup(definitions),
    };
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        createCardInstance(T14, {
          instanceId: "t14",
          ownerPlayerId: ALICE,
          zone: "field",
        }),
        createCardInstance(CB_SPIRIT_DEF, {
          instanceId: "cb",
          ownerPlayerId: ALICE,
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(timedMagic, {
          instanceId: "timed",
          ownerPlayerId: BOB,
          zone: "hand",
        }),
        createCardInstance(borrower, {
          instanceId: "borrower",
          ownerPlayerId: ALICE,
          zone: "hand",
        }),
      ],
    });
    let state: GameState = {
      ...base,
      activePlayerId: BOB,
      step: "attack",
      window: "stack",
      stackWindow: {
        actingPlayerId: BOB,
        previousWindow: "main",
        priorityPlayerId: BOB,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: BOB,
        subStackEverOpened: false,
        burstWindowKind: null,
        pendingStackAction: null,
      },
    };
    const timed = getLegalActions({
      state,
      actingPlayerId: BOB,
      ...options,
    }).find((a) => a.kind === "use_magic" && a.sourceInstanceId === "timed");
    expect(timed).toBeDefined();
    state = applyLegalAction({ state, action: timed!, ...options }).state;
    expect(
      state.activeContinuousEffects.some(
        (ce) => ce.sourceInstanceId === "timed"
      )
    ).toBe(false);
    const responseActions = getLegalActions({
      state,
      actingPlayerId: ALICE,
      ...options,
    });
    expect(
      responseActions.some(
        (a) => a.kind === "use_magic" && a.sourceInstanceId === "t14"
      )
    ).toBe(false);
    const response = responseActions.find(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "borrower"
    );
    expect(response).toBeDefined();
    state = applyLegalAction({
      state,
      action: response!,
      targetInstanceIds: ["t14"],
      ...options,
    }).state;
    for (let guard = 0; guard < 20 && state.stackWindow; guard++) {
      const pass = getLegalActions({
        state,
        actingPlayerId: state.stackWindow.priorityPlayerId,
        ...options,
      }).find((a) => a.kind === "pass_stack");
      expect(pass).toBeDefined();
      state = applyLegalAction({ state, action: pass!, ...options }).state;
    }
    const borrowedAt = state.log.indexOf(
      "borrow_magic_effect:executed:BSLH01-T14"
    );
    const originalResolvedAt = state.log.findIndex(
      (line) =>
        line.startsWith("magic:resolve-main:start:") && line.endsWith(":timed")
    );
    expect(borrowedAt).toBeGreaterThan(-1);
    expect(originalResolvedAt).toBeGreaterThan(borrowedAt);
    expect(state.activeContinuousEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceInstanceId: "timed",
          targetInstanceId: "cb",
          duration: { scope: "turn" },
        }),
      ])
    );
    expect(
      state.cardInstances.find((c) => c.instanceId === "timed")?.zone
    ).toBe("trash");
  });
  it("相手マジックが場外CBを対象にしてもレキュリアは誘発せず、そのマジックを通常解決する", () => {
    const afterUse = drainStackWindow(
      declareAttackerMagic(buildInitialState())
    );
    expect(afterUse.pendingTargetedDisclosureContinuation).toBeNull();
    expect(
      afterUse.pendingTriggeredEffects.some((p) => p.eventKind === "targeted")
    ).toBe(false);
    expect(afterUse.players.find((p) => p.id === BOB)!.countValue).toBe(1);
    expect(
      afterUse.cardInstances.find((c) => c.instanceId === "attacker-magic")
        ?.zone
    ).toBe("trash");
  });
});
