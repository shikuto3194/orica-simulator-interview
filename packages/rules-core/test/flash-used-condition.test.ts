import { describe, it, expect } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { evaluateCondition } from "../src/effect/structured-effect-interpreter";
import { executeEffect } from "../src/effect/effect-interpreter";
import { runActionMainResolution } from "../src/effect/effect-resolution";
import type {
  CardDefinition,
  ConditionClause,
  FlashCardUsageLogEntry,
  FlashEffectActivationLogEntry,
  GameState,
} from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "player-1";
const BOB = "player-2";

function makeDef(
  cardNo: string,
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "magic",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 3,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [],
    textLines: [],
    images: {},
    tribe: "",
    colors: ["red"],
    ...overrides,
  } as CardDefinition;
}

const defMap = new Map<string, CardDefinition>();
defMap.set(
  "MAGIC-R",
  makeDef("MAGIC-R", { colors: ["red"], printedCategory: "magic" })
);
defMap.set(
  "MAGIC-B",
  makeDef("MAGIC-B", { colors: ["blue"], printedCategory: "magic" })
);

const getCardDef = (id: string) => defMap.get(id);

function usageEntry(
  overrides: Partial<FlashCardUsageLogEntry>
): FlashCardUsageLogEntry {
  return {
    playerId: ALICE,
    cardInstanceId: "card-1",
    cardDefinitionId: "MAGIC-R",
    turnNumber: 1,
    step: "main",
    attackId: null,
    ...overrides,
  };
}

function activationEntry(
  overrides: Partial<FlashEffectActivationLogEntry>
): FlashEffectActivationLogEntry {
  return {
    playerId: ALICE,
    sourceInstanceId: "card-1",
    sourceDefinitionId: "MAGIC-R",
    effectIndex: 0,
    turnNumber: 1,
    step: "main",
    attackId: null,
    ...overrides,
  };
}

function stateWithLogs(opts: {
  usage?: FlashCardUsageLogEntry[];
  activation?: FlashEffectActivationLogEntry[];
  turnNumber?: number;
  step?: GameState["step"];
  activeAttackId?: string | null;
}): GameState {
  const base = createEmptyGameState({});
  return {
    ...base,
    turnNumber: opts.turnNumber ?? 1,
    step: opts.step ?? "main",
    activeAttack: opts.activeAttackId
      ? {
          attackId: opts.activeAttackId,
          primaryEntityId: "e1",
          participantEntityIds: ["e1"],
          groupMode: "single",
          target: { kind: "player", playerId: BOB },
          blockAssignments: [],
          symbolResolutionOrder: [],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        }
      : null,
    flashCardUsageLog: opts.usage ?? [],
    flashEffectActivationLog: opts.activation ?? [],
  };
}

describe("P3-14 C-1: ConditionClause.flash_used 評価", () => {
  const SRC = "src-1";

  describe("target: card_usage", () => {
    it("self が game スコープでフラッシュカード使用済み → true", () => {
      const state = stateWithLogs({ usage: [usageEntry({ playerId: ALICE })] });
      const clause: ConditionClause = {
        kind: "flash_used",
        target: "card_usage",
        scope: "game",
        player: "self",
      };
      expect(evaluateCondition(state, [clause], SRC, ALICE, getCardDef)).toBe(
        true
      );
    });

    it("空ログ → false（negate=true で true に反転）", () => {
      const state = stateWithLogs({ usage: [] });
      const positive: ConditionClause = {
        kind: "flash_used",
        target: "card_usage",
        scope: "game",
        player: "self",
      };
      const negated: ConditionClause = { ...positive, negate: true };
      expect(evaluateCondition(state, [positive], SRC, ALICE, getCardDef)).toBe(
        false
      );
      expect(evaluateCondition(state, [negated], SRC, ALICE, getCardDef)).toBe(
        true
      );
    });

    it("scope=turn: 過去ターンの使用は除外される", () => {
      const state = stateWithLogs({
        usage: [usageEntry({ turnNumber: 1 })],
        turnNumber: 2,
      });
      const clause: ConditionClause = {
        kind: "flash_used",
        target: "card_usage",
        scope: "turn",
        player: "self",
      };
      expect(evaluateCondition(state, [clause], SRC, ALICE, getCardDef)).toBe(
        false
      );
    });

    it("scope=step: 同ターンだが別 step の使用は除外される", () => {
      const state = stateWithLogs({
        usage: [usageEntry({ turnNumber: 1, step: "attack" })],
        turnNumber: 1,
        step: "main",
      });
      const clause: ConditionClause = {
        kind: "flash_used",
        target: "card_usage",
        scope: "step",
        player: "self",
      };
      expect(evaluateCondition(state, [clause], SRC, ALICE, getCardDef)).toBe(
        false
      );
    });

    it("scope=latest: 現在 step の直近カード使用だけを参照する", () => {
      const state = stateWithLogs({
        usage: [
          usageEntry({
            cardInstanceId: "card-1",
            cardDefinitionId: "MAGIC-R",
            mode: "main",
          }),
          usageEntry({
            cardInstanceId: "card-2",
            cardDefinitionId: "MAGIC-B",
            mode: "main",
          }),
        ],
      });
      const stateWithCards: GameState = {
        ...state,
        cardInstances: [
          createCardInstance(defMap.get("MAGIC-R")!, {
            instanceId: "card-1",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "trash",
          }),
          createCardInstance(defMap.get("MAGIC-B")!, {
            instanceId: "card-2",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "trash",
          }),
        ],
      };
      const latestRed: ConditionClause = {
        kind: "flash_used",
        target: "card_usage",
        scope: "latest",
        player: "self",
        mode: "any",
        cardFilter: { colors: ["red"] },
      };
      const latestBlue: ConditionClause = {
        ...latestRed,
        cardFilter: { colors: ["blue"] },
      };

      expect(
        evaluateCondition(stateWithCards, [latestRed], SRC, ALICE, getCardDef)
      ).toBe(false);
      expect(
        evaluateCondition(stateWithCards, [latestBlue], SRC, ALICE, getCardDef)
      ).toBe(true);

      const nextStep = { ...stateWithCards, step: "attack" as const };
      expect(
        evaluateCondition(nextStep, [latestBlue], SRC, ALICE, getCardDef)
      ).toBe(false);
    });

    it("scope=battle: 現バトル中 + 同 attackId ならマッチ、バトル外は除外", () => {
      const inBattle = stateWithLogs({
        usage: [usageEntry({ attackId: "atk-1" })],
        activeAttackId: "atk-1",
      });
      const clause: ConditionClause = {
        kind: "flash_used",
        target: "card_usage",
        scope: "battle",
        player: "self",
      };
      expect(
        evaluateCondition(inBattle, [clause], SRC, ALICE, getCardDef)
      ).toBe(true);

      // バトル外 (activeAttack === null) は scope=battle では常に false（null 同士を同一視しない）
      const outOfBattle = stateWithLogs({
        usage: [usageEntry({ attackId: null })],
        activeAttackId: null,
      });
      expect(
        evaluateCondition(outOfBattle, [clause], SRC, ALICE, getCardDef)
      ).toBe(false);
    });

    it("player=opponent: 自分の使用履歴は除外され、相手の使用のみマッチ", () => {
      const state = stateWithLogs({
        usage: [usageEntry({ playerId: ALICE })],
      });
      const clause: ConditionClause = {
        kind: "flash_used",
        target: "card_usage",
        scope: "game",
        player: "opponent",
      };
      expect(evaluateCondition(state, [clause], SRC, ALICE, getCardDef)).toBe(
        false
      );

      const state2 = stateWithLogs({
        usage: [usageEntry({ playerId: BOB })],
      });
      expect(evaluateCondition(state2, [clause], SRC, ALICE, getCardDef)).toBe(
        true
      );
    });

    it("mode=any は main/flash/stack のカード使用をすべて拾う", () => {
      const state = stateWithLogs({
        usage: [
          usageEntry({ mode: "main", cardInstanceId: "main-card" }),
          usageEntry({ mode: "stack", cardInstanceId: "stack-card" }),
        ],
      });
      const anyMode: ConditionClause = {
        kind: "flash_used",
        target: "card_usage",
        scope: "game",
        player: "self",
        mode: "any",
      };
      const flashOnly: ConditionClause = {
        ...anyMode,
        mode: "flash",
      };
      expect(evaluateCondition(state, [anyMode], SRC, ALICE, getCardDef)).toBe(
        true
      );
      expect(
        evaluateCondition(state, [flashOnly], SRC, ALICE, getCardDef)
      ).toBe(false);
    });

    it("cardFilter: colors でフィルタして一致のみ true", () => {
      // 赤マジックの使用履歴に対し、青フィルタ → false、赤フィルタ → true
      const base = stateWithLogs({
        usage: [
          usageEntry({ cardInstanceId: "card-1", cardDefinitionId: "MAGIC-R" }),
        ],
      });
      const stateWithCard: GameState = {
        ...base,
        cardInstances: [
          {
            instanceId: "card-1",
            definitionId: "MAGIC-R",
            originalDefinitionId: "MAGIC-R",
            ownerPlayerId: ALICE,
            controllerPlayerId: ALICE,
            zone: "trash",
            zoneRoleName: "",
            normalCoreCount: 0,
            minimumRequiredCores: 0,
            exhaustState: "recovered",
            pendingLeaveKind: null,
            pendingLeaveCause: null,
            pendingLeaveChainId: null,
            deferZoneMoveUntilChainEnd: false,
            attachedToInstanceId: null,
            attachedChildrenIds: [],
            pendingLeaveLvSnapshot: null,
            underCards: [],
            divineTransformState: null,
            faceDown: false,
          },
        ],
      };
      const blueFilter: ConditionClause = {
        kind: "flash_used",
        target: "card_usage",
        scope: "game",
        player: "self",
        cardFilter: { colors: ["blue"] },
      };
      const redFilter: ConditionClause = {
        kind: "flash_used",
        target: "card_usage",
        scope: "game",
        player: "self",
        cardFilter: { colors: ["red"] },
      };
      expect(
        evaluateCondition(stateWithCard, [blueFilter], SRC, ALICE, getCardDef)
      ).toBe(false);
      expect(
        evaluateCondition(stateWithCard, [redFilter], SRC, ALICE, getCardDef)
      ).toBe(true);
    });
  });

  describe("target: effect_activation", () => {
    it("effect_activation 履歴のみ参照し、card_usage ログとは独立", () => {
      // card_usage にエントリあるが effect_activation は空 → false
      const onlyUsage = stateWithLogs({
        usage: [usageEntry({})],
        activation: [],
      });
      const clause: ConditionClause = {
        kind: "flash_used",
        target: "effect_activation",
        scope: "game",
        player: "self",
      };
      expect(
        evaluateCondition(onlyUsage, [clause], SRC, ALICE, getCardDef)
      ).toBe(false);

      // effect_activation に自分のエントリ → true
      const onlyActivation = stateWithLogs({
        usage: [],
        activation: [activationEntry({ playerId: ALICE })],
      });
      expect(
        evaluateCondition(onlyActivation, [clause], SRC, ALICE, getCardDef)
      ).toBe(true);
    });
  });
});

describe("P3-14 C-1: フラッシュ効果発揮ログ push (effect-resolution 経由)", () => {
  // executeEffect が activated/flash の effect を実行したとき、flashEffectActivationLog に push されることを検証。
  // effect-resolution.ts:tryExecuteEffects を経由する "played magic card" パスのテストは magic-system 経由で複雑のため、
  // ここでは executeEffect の直接呼び出しでは push されないことも確認する（push は tryExecuteEffects でのみ発生）。

  it("executeEffect 直接呼び出しでは push されない（push は tryExecuteEffects 経由でのみ発生）", () => {
    const state = stateWithLogs({});
    const effect: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [{ action: { kind: "draw", count: 1 } }],
    };
    const result = executeEffect({
      chainId: "test:flash-used-condition:407",
      state,
      effect,
      sourceInstanceId: "src",
      actingPlayerId: ALICE,
      getCardDefinitionById: getCardDef,
    });
    // executeEffect は timing フィルタ後の単一 effect を実行するだけなので、log 追加はしない
    expect(result.flashEffectActivationLog.length).toBe(0);
  });

  it("activationLabel=none の activated flash 効果は発揮ログに載らない", () => {
    const def = makeDef("NON-FLASH-ACTIVATED", {
      printedCategory: "spirit",
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          activationLabel: "none",
          steps: [{ action: { kind: "draw", count: 1 } }],
        },
      ],
    });
    defMap.set(def.cardNo, def);
    const source = createCardInstance(def, {
      instanceId: "non-flash-src",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = {
      ...stateWithLogs({}),
      cardInstances: [source],
    };

    const result = runActionMainResolution({
      state,
      chainId: "non-flash-chain",
      startLogs: [],
      endLogs: [],
      context: {
        chainId: "non-flash-chain",
        resolutionKind: "field_card_effect_action",
        actingPlayerId: ALICE,
        sourceKind: "spirit",
        sourceCard: source,
        sourceDefinition: def,
        targetInstanceIds: [],
        getCardDefinitionById: getCardDef,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: undefined,
        effectTimingFilter: "flash",
        targetEffectIndex: 0,
      },
      getHandWrittenEffectResolver: () => undefined,
    });

    expect(result.flashEffectActivationLog).toHaveLength(0);
  });
});
