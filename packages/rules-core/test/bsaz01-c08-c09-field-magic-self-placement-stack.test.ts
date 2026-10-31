/**
 * BSAZ01-C08/C09 effects[0] (textRef[2]):
 * 「スタック効果使用後以外でトラッシュに置かれたこのカードはフィールドに置く。」
 *
 * BSAZ01-C04/C07/C10/C11[2] と同型の自己配置トリガー (engine-field-magic-self-placement)。
 * 差分は【タイプ：作戦】がスタック窓を開くカードのため、flash_used 条件句に
 * mode:"stack" を渡す点のみ (ConditionClause.flash_used.mode / FlashCardUsageLogEntry.mode
 * 新設)。dispatch 側の新規コードは無く、既存プリミティブ (findMovedToTrashAutoEffect /
 * processMovedToTrashEffects の "move_to_field" disposition kind) をそのまま再利用する (SSOT)。
 *
 * adversarial verifier round1 指摘反映: 実ゲームプレイの use_magic dispatch
 * (legal-actions-apply.ts の timing:"main"|"flash"|"stack" 分岐) は必ず
 * useMagicCardInFlashContextAsAction 経由で解決され、playMagicCardAsAction は
 * use_magic アクションからは到達しない。flashCardUsageLog の push が
 * useMagicCardInFlashContextAsAction 側に無かったため、本番では
 * 「フラッシュ/スタック効果使用後以外で」判定が常に「未使用」扱いになるバグがあった
 * (pushFlashCardUsageLogIfApplicable ヘルパーへ統合し両経路で共通化して解消)。
 * このファイルの最初の describe は playMagicCardAsAction を直接叩く単体テストとして残しつつ、
 * 2 番目の describe で getLegalActions/applyLegalAction 経由の実ディスパッチ経路を検証する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildMagicLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  playMagicCardAsAction,
  useMagicCardWithoutPayingCostAsAction,
  type ActiveStack,
  type CardDefinition,
  type GameState,
} from "../src";
import {
  findMovedToTrashAutoEffect,
  processMovedToTrashEffects,
} from "../src/effect/structured-effect-interpreter";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string) => cardNoMap.get(id);
const triggeredLookup = buildTriggeredEffectLookup(ALL_CARDS);

describe("BSAZ01-C08 をスタックタイミングで使用すると flashCardUsageLog に mode:stack で push される", () => {
  it("playMagicCardAsAction(chosenTiming: stack) がコスト支払完了時点で mode:stack を記録する", () => {
    const def = cardNoMap.get("BSAZ01-C08")!;
    const magicCard = createCardInstance(def, {
      instanceId: "hand-c08",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [magicCard],
      playerOverrides: [{ reserveNormalCoreCount: 3 }],
    });
    const state: GameState = {
      ...baseState,
      step: "attack",
      activePlayerId: "alice",
    };

    const result = playMagicCardAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "hand-c08",
      paymentSources: [{ kind: "reserve", amount: 3 }],
      chosenTiming: "stack",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
    });

    expect(result.state.flashCardUsageLog).toHaveLength(1);
    expect(result.state.flashCardUsageLog[0]!.mode).toBe("stack");
    expect(result.state.flashCardUsageLog[0]!.cardInstanceId).toBe("hand-c08");
  });
});

describe("実ディスパッチ経路 (getLegalActions → applyLegalAction, use_magic timing:stack) でも mode:stack が記録される", () => {
  // BSAZ01-C09 の現行 card-data は【タイプ：作戦】スタック本体効果がまだ stub
  // (未登録) のため use_magic legal action 自体が出ない (C08 は
  // bsaz01-c08-field-magic-self-placement.test.ts で実装済み検証済み)。この統合テストは
  // 「stack タイミングの activated 効果を持つマジックカードを実ディスパッチ経路で使用したとき
  // flashCardUsageLog に mode:stack で記録される」という基盤機構そのものを、bsaz03-m01 テストと
  // 同型の合成カードで単離検証する (C09 の活性化効果本体が実装され次第、同じ基盤に乗る)。
  const TEST_STACK_MAGIC: CardDefinition = {
    cardNo: "TEST-STACK-SELF-PLACEMENT-MAGIC",
    name: "テストスタック自己配置マジック",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 2,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [
      // BSAZ01-C08[2] と同型: スタック効果使用後以外でトラッシュに置かれたら場に置く。
      {
        timing: { kind: "card_event", event: ["moved_to_trash"] },
        condition: [
          {
            kind: "flash_used",
            target: "card_usage",
            scope: "step",
            player: "self",
            mode: "stack",
            cardFilter: {
              cardName: { exact: "テストスタック自己配置マジック" },
            },
            negate: true,
          },
        ],
        cardEventDisposition: { kind: "move", destination: "field" },
        steps: [{ action: { kind: "move_self", destination: "field" } }],
      },
      // 能動使用可能な最小のスタック効果本体 (draw 1)。
      {
        timing: { kind: "activated", mode: "stack" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  };

  const defMap = new Map<string, CardDefinition>([
    [TEST_STACK_MAGIC.cardNo, TEST_STACK_MAGIC],
  ]);
  const testGetDef = (id: string) => defMap.get(id);
  const magicLookup = buildMagicLookup([TEST_STACK_MAGIC]);

  it("use_magic(timing:stack) を宣言すると flashCardUsageLog に mode:stack で記録される", () => {
    // mode:"stack" の magic は能動使用タイミングを持たず、開いているスタック窓での割り込み
    // 応答時のみ使用可能 (generateMagicRegistrations コメント参照)。bob の別カード使用を
    // pendingStackAction とし、alice がそれに stack 応答する形の窓を構築する
    // (bskb01-cards.test.ts / p3-73-a5-nullify-resolution-and-windows.test.ts と同型)。
    const magicCard = createCardInstance(TEST_STACK_MAGIC, {
      instanceId: "hand-stack-magic",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const bobPendingStack: ActiveStack = {
      stackId: "stack:bob-dummy",
      actionKind: "magic",
      chainId: "chain:bob-dummy",
      actingPlayerId: "bob",
      cardInstanceId: "bob-dummy-magic",
      cardDefinitionId: "BOB-DUMMY-MAGIC",
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [magicCard],
        playerOverrides: [{ reserveNormalCoreCount: 2 }],
      }),
      step: "attack",
      activePlayerId: "alice",
      window: "stack",
      stackWindow: {
        priorityPlayerId: "alice",
        consecutivePassCount: 0,
        actingPlayerId: "bob",
        previousWindow: "attack",
        stackResponseSourcePlayerId: "bob",
        subStackEverOpened: false,
        burstWindowKind: null,
        pendingStackAction: bobPendingStack,
      },
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: testGetDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    });
    const action = actions.find(
      (a) =>
        a.kind === "use_magic" &&
        a.sourceInstanceId === "hand-stack-magic" &&
        a.timing === "stack"
    );
    expect(action).toBeDefined();
    if (!action || action.kind !== "use_magic") return;

    const result = applyLegalAction({
      state,
      action,
      paymentSources: [{ kind: "reserve", amount: 2 }],
      getCardDefinitionById: testGetDef,
      getRegisteredMagicActions: magicLookup,
      getRegisteredFieldCardEffectActions: () => undefined,
      getRegisteredTriggeredEffectActions: () => undefined,
      getRegisteredBurstActions: () => undefined,
    }).state;

    expect(result.flashCardUsageLog).toHaveLength(1);
    expect(result.flashCardUsageLog[0]!.mode).toBe("stack");
    expect(result.flashCardUsageLog[0]!.cardInstanceId).toBe(
      "hand-stack-magic"
    );
  });
});

describe("コスト無し使用経路 (useMagicCardWithoutPayingCostAsAction, magicTiming:flash) でも mode:flash が記録される", () => {
  // adversarial verifier round2 指摘反映: BSAZ02-C15 等の use_magic_without_cost
  // (native-action-registry.ts の同名 step。「コストを支払わずに使用できる」型) 経路は
  // useMagicCardWithoutPayingCostAsAction を直接呼ぶ。この経路にも flashCardUsageLog push が
  // 無かったため、コスト無しフラッシュ使用も「フラッシュ効果使用後以外で」判定から漏れていた。
  it("magicTiming:flash を指定した無償使用でも mode:flash が記録される", () => {
    const def = cardNoMap.get("BSAZ01-C04")!;
    const magicCard = createCardInstance(def, {
      instanceId: "hand-free-c04",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [magicCard],
      }),
      step: "main",
      turnNumber: 1,
      activePlayerId: "alice",
    };

    const result = useMagicCardWithoutPayingCostAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "hand-free-c04",
      magicTiming: "flash",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });

    expect(result.state.flashCardUsageLog).toHaveLength(1);
    expect(result.state.flashCardUsageLog[0]!.mode).toBe("flash");
    expect(result.state.flashCardUsageLog[0]!.cardInstanceId).toBe(
      "hand-free-c04"
    );
  });

  it("magicTiming 省略 (既定 main) は mode:main で記録される", () => {
    const def = cardNoMap.get("BSAZ01-C04")!;
    const magicCard = createCardInstance(def, {
      instanceId: "hand-free-c04-main",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [magicCard],
      }),
      step: "main",
      turnNumber: 1,
      activePlayerId: "alice",
    };

    const result = useMagicCardWithoutPayingCostAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "hand-free-c04-main",
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });

    expect(result.state.flashCardUsageLog).toHaveLength(1);
    expect(result.state.flashCardUsageLog[0]!.mode).toBe("main");
    expect(result.state.flashCardUsageLog[0]!.cardInstanceId).toBe(
      "hand-free-c04-main"
    );
  });

  it("無償使用でも additional_cost CE が残るなら余分コストを支払う", () => {
    const def = cardNoMap.get("BSAZ01-C04")!;
    const magicCard = createCardInstance(def, {
      instanceId: "hand-free-c04-taxed",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [magicCard],
        playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
      }),
      step: "main",
      turnNumber: 1,
      activePlayerId: "alice",
      activeContinuousEffects: [
        {
          effectId: "ce-free-magic-tax",
          sourceInstanceId: "tax-source",
          sourceDefinitionId: "tax-source-def",
          actingPlayerId: "bob",
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "additional_cost",
          modifierAmount: 3,
          targetFilter: {
            player: "opponent",
            category: ["magic"],
            usingEffectMode: ["flash"],
          },
        },
      ],
    };

    const result = useMagicCardWithoutPayingCostAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "hand-free-c04-taxed",
      magicTiming: "flash",
      paymentSources: [{ kind: "reserve", amount: 3 }],
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: triggeredLookup,
      getRegisteredBurstActions: undefined,
    });

    const alice = result.state.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(2);
    expect(alice.trashNormalCoreCount).toBe(3);
    expect(
      result.state.log.some((line) =>
        line.startsWith(`magic:cost-paid:${result.chainId}:alice:3`)
      )
    ).toBe(true);
  });
});

describe.each([["BSAZ01-C08"], ["BSAZ01-C09"]])(
  "%s [2] スタック効果使用後以外でトラッシュに置かれたこのカードはフィールドに置く",
  (cardNo) => {
    const def = cardNoMap.get(cardNo)!;

    it("スタック未使用のトラッシュ行きは move_to_field / mandatory でマッチする", () => {
      const self = createCardInstance(def, {
        instanceId: `${cardNo}-1`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "trash",
      });
      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [self],
      });
      const match = findMovedToTrashAutoEffect(
        state,
        self.instanceId,
        def,
        (id) => cardNoMap.get(id),
        {
          fromZone: "hand",
        }
      );
      expect(match).toBeDefined();
      expect(match!.kind).toBe("move_to_field");
      expect(match!.executionMode).toBe("mandatory");
    });

    it("同ステップで自分のスタック使用が既にログされていればマッチしない", () => {
      const self = createCardInstance(def, {
        instanceId: `${cardNo}-2`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "trash",
      });
      const state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [self],
        }),
        step: "main",
        turnNumber: 1,
        flashCardUsageLog: [
          {
            playerId: "alice",
            cardInstanceId: self.instanceId,
            cardDefinitionId: self.definitionId,
            turnNumber: 1,
            step: "main",
            attackId: null,
            mode: "stack",
          },
        ],
      };
      const match = findMovedToTrashAutoEffect(
        state,
        self.instanceId,
        def,
        (id) => cardNoMap.get(id),
        {
          fromZone: "hand",
        }
      );
      expect(match).toBeUndefined();
    });

    it("同ステップの自分のフラッシュ使用ログ (mode:flash) はマッチに影響しない (mode 別軸)", () => {
      const self = createCardInstance(def, {
        instanceId: `${cardNo}-3`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "trash",
      });
      const state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [self],
        }),
        step: "main",
        turnNumber: 1,
        flashCardUsageLog: [
          {
            playerId: "alice",
            cardInstanceId: self.instanceId,
            cardDefinitionId: self.definitionId,
            turnNumber: 1,
            step: "main",
            attackId: null,
            // mode 省略 = "flash" 扱い。stack 判定には影響しない。
          },
        ],
      };
      const match = findMovedToTrashAutoEffect(
        state,
        self.instanceId,
        def,
        (id) => cardNoMap.get(id),
        {
          fromZone: "hand",
        }
      );
      expect(match).toBeDefined();
      expect(match!.kind).toBe("move_to_field");
    });

    it("[board] スタック未使用でトラッシュに置かれたこのカードはフィールドへ強制移動する", () => {
      const self = createCardInstance(def, {
        instanceId: `${cardNo}-board-1`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "trash",
      });
      const state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [self],
        }),
        step: "main",
        turnNumber: 1,
      };

      const result = processMovedToTrashEffects(
        state,
        [self.instanceId],
        (id) => cardNoMap.get(id),
        {
          fromZone: "hand",
        }
      );

      expect(
        result.cardInstances.find((c) => c.instanceId === self.instanceId)?.zone
      ).toBe("field");
    });

    it("[board] 自分のスタック使用直後のトラッシュ確定はフィールドへ移動しない (通常のトラッシュ据え置き)", () => {
      const self = createCardInstance(def, {
        instanceId: `${cardNo}-board-2`,
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "trash",
      });
      const state: GameState = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [self],
        }),
        step: "main",
        turnNumber: 1,
        flashCardUsageLog: [
          {
            playerId: "alice",
            cardInstanceId: self.instanceId,
            cardDefinitionId: self.definitionId,
            turnNumber: 1,
            step: "main",
            attackId: null,
            mode: "stack",
          },
        ],
      };

      const result = processMovedToTrashEffects(
        state,
        [self.instanceId],
        (id) => cardNoMap.get(id),
        {
          fromZone: "in_use",
        }
      );

      expect(
        result.cardInstances.find((c) => c.instanceId === self.instanceId)?.zone
      ).toBe("trash");
    });
  }
);
