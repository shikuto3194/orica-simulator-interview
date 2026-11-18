/**
 * コアシュート（相手フィールドのコアをリザーブに置く）でソウルコアを掴めることの検証。
 *
 * 回帰: BSTH01-C22「相手のフィールドのコア2個を相手のリザーブに置く」で、相手の
 * ソウルコア1個のみが乗ったスピリットを対象にとれない不具合 (snapshot
 * 2026-05-31T07-13-51)。原因は:
 *  1. analyzeCoreShootCandidates が `normalCoreCount > 0` で候補をフィルタし、
 *     ソウルコアのみのスピリットを候補から除外していた。
 *  2. ソウルコアを totalAvailable / totalAmount に数えていなかった
 *     (= ソウルコアシュートが事実上機能していなかった)。
 *  3. 解決時 from===to のとき `p.id === fromPlayerId` 分岐が先に当たり
 *     soulCoreLocation を null にしてソウルコアを消失させていた。
 *
 * ルール: 10_rules/06 §41-42・§54・§71 (2026-06-09 検証で旧「ライフ generic 不可」を撤回):
 *   generic な soul の行き先は ライフ / リザーブ / トラッシュ 全て可。
 *   ボイドのみ硬制約 (禁止)。創界神 / 創界石は explicit 指定でのみ可で coreshoot 経路には到達しない。
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  executeEffect,
  withSoulCoreLocation,
} from "../src/index";
import type { CardDefinition, GameState } from "../src/index";

const shooter: CardDefinition = {
  cardNo: "TEST-CORESHOOT-2",
  name: "コアシュート発生源",
  printedCategory: "spirit",
  colors: ["purple"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: [],
  effects: [
    {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "field", player: "opponent" },
            to: { kind: "reserve", player: "opponent" },
            amount: 2,
          },
        },
      ],
    },
  ],
  sourceUrls: [],
  sourceConfidence: "C",
};

const oppSp: CardDefinition = {
  cardNo: "TEST-OPP-SPIRIT",
  name: "相手スピリット",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const localDefs = new Map<string, CardDefinition>([
  [shooter.cardNo, shooter],
  [oppSp.cardNo, oppSp],
]);

function baseState(): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const stateWithoutSoul: GameState = {
    ...base,
    activePlayerId: "alice",
    cardInstances: [
      createCardInstance(shooter, {
        instanceId: "shooter-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 2,
      }),
      // opp-a: 通常コア2個
      createCardInstance(oppSp, {
        instanceId: "opp-a",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 2,
      }),
      // opp-b: 通常コア0個。bob のソウルコアのみが乗っている
      createCardInstance(oppSp, {
        instanceId: "opp-b",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 0,
      }),
    ],
  };
  return withSoulCoreLocation(stateWithoutSoul, "bob", {
    kind: "card",
    instanceId: "opp-b",
  });
}

describe("コアシュート: ソウルコアのみのスピリットを対象にとれる", () => {
  it("ソウルコアのみのスピリットが候補に含まれ、ソウルコアが totalAmount に数えられる", () => {
    const state = baseState();
    const pendingResult = executeEffect({
      chainId: "test:coreshoot-soul-core:116",
      state,
      effect: shooter.effects![0],
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
    });

    // opp-a(通常2) + opp-b(ソウル1) = 計3 > amount2 かつ候補2 → 選択 pending
    expect(pendingResult.pendingCoreShootSelection).not.toBeNull();
    const pending = pendingResult.pendingCoreShootSelection!;
    expect(pending.totalAmount).toBe(2);
    // ソウルコアのみの opp-b が候補に含まれる (これがバグの本丸)
    const oppB = pending.candidates.find((c) => c.instanceId === "opp-b");
    expect(oppB).toBeDefined();
    expect(oppB!.availableCores).toBe(1); // 通常0 + ソウル1
    const oppA = pending.candidates.find((c) => c.instanceId === "opp-a");
    expect(oppA!.availableCores).toBe(2);
  });

  it("ソウルコア1個 + opp-a の通常コア1個を掴むと、ソウルコアが相手リザーブへ移動する", () => {
    const state = baseState();
    const pendingResult = executeEffect({
      chainId: "test:coreshoot-soul-core:138",
      state,
      effect: shooter.effects![0],
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
    });
    const actions = getLegalActions({
      state: pendingResult,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    const csAction = actions.find(
      (a) => a.kind === "resolve_pending_core_shoot"
    );
    expect(csAction).toBeDefined();

    const baseBob = state.players.find((p) => p.id === "bob")!;
    const resolved = applyLegalAction({
      state: pendingResult,
      action: csAction!,
      getCardDefinitionById: (id) => localDefs.get(id),
      getRegisteredTriggeredEffectActions: () => [],
      coreShootDistribution: { "opp-a": 1 },
      coreShootSoulCoreInstanceId: "opp-b",
    });
    const result = resolved.state;
    const bob = result.players.find((p) => p.id === "bob")!;

    // ソウルコアは消失 (null) せず、相手リザーブへ移動している
    expect(bob.soulCoreLocation).toEqual({ kind: "reserve" });
    // 通常コア1個 (opp-a 由来) が相手リザーブへ加算される (ソウルは通常コア数に含めない)
    expect(bob.reserveNormalCoreCount).toBe(baseBob.reserveNormalCoreCount + 1);
    // opp-a は 2 - 1 = 1
    const oppA = result.cardInstances.find((c) => c.instanceId === "opp-a")!;
    expect(oppA.normalCoreCount).toBe(1);
  });

  it("行き先=ライフでも soul を掴める (ENGINE-coreshoot-soul-destination-include-life 回帰)", () => {
    // 10_rules/06 §41-42・§54・§71: generic な soul の行き先は life も可。
    // 以前は coreShootSoulDestinationAllowed が life を false 扱いし、ソウルのみの
    // スピリットが候補から消えていた (silent disable)。
    const shooterToLife: CardDefinition = {
      ...shooter,
      cardNo: "TEST-CORESHOOT-LIFE",
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "core_move",
                from: { kind: "field", player: "opponent" },
                to: { kind: "life", player: "opponent" },
                amount: 1,
              },
            },
          ],
        },
      ],
    };
    const lifeDefs = new Map<string, CardDefinition>([
      [shooterToLife.cardNo, shooterToLife],
      [oppSp.cardNo, oppSp],
    ]);
    const single: GameState = {
      ...baseState(),
      cardInstances: [
        createCardInstance(shooterToLife, {
          instanceId: "shooter-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
        // ソウルコアのみのスピリット 1 体
        createCardInstance(oppSp, {
          instanceId: "opp-b",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 0,
        }),
      ],
    };
    const result = executeEffect({
      chainId: "test:coreshoot-soul-core:222",
      state: single,
      effect: shooterToLife.effects![0],
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => lifeDefs.get(id),
    });
    // 候補1 → auto-resolve。soul は相手ライフへ移動する。
    expect(result.pendingCoreShootSelection).toBeNull();
    const bob = result.players.find((p) => p.id === "bob")!;
    expect(bob.soulCoreLocation).toEqual({ kind: "life" });
  });

  it("候補が1つ(ソウルコアのみのスピリット)の auto-resolve でもソウルコアを掴む", () => {
    // bob のフィールドは opp-b (ソウルのみ) だけ。amount を 1 にして自動解決経路を通す。
    const single: GameState = {
      ...baseState(),
      cardInstances: [
        createCardInstance(shooter, {
          instanceId: "shooter-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
        createCardInstance(oppSp, {
          instanceId: "opp-b",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 0,
        }),
      ],
    };
    const effectAmount1: CardDefinition["effects"] = [
      {
        timing: { kind: "card_event", event: "attack" },
        steps: [
          {
            action: {
              kind: "core_move",
              from: { kind: "field", player: "opponent" },
              to: { kind: "reserve", player: "opponent" },
              amount: 1,
            },
          },
        ],
      },
    ];
    const result = executeEffect({
      chainId: "test:coreshoot-soul-core:269",
      state: single,
      effect: effectAmount1![0],
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => localDefs.get(id),
    });
    // 選択不要 (候補1) → auto-resolve。ソウルコアが相手リザーブへ移動する
    expect(result.pendingCoreShootSelection).toBeNull();
    const bob = result.players.find((p) => p.id === "bob")!;
    expect(bob.soulCoreLocation).toEqual({ kind: "reserve" });
  });
});
