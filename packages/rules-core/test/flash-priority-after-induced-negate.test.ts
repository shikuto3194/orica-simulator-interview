import { finishCoreChoices } from "./helpers/core-choice-driver";
/**
 * 報告バグ (2026-06-21 GUI 観測): 自分フラッシュタイミングでマジック使用 → 相手の誘発
 * (BSTH01-X05 咲夜) で無効 → 優先権が **使用者へ跳ね返り**、相手のフラッシュタイミングに
 * ならない。
 *
 * ルール正源: 10_rules/02 「両プレイヤーが交互にフラッシュ効果を使用」+「誘発レイヤーと
 * 能動スタックレイヤーは別系統」。誘発 (咲夜) は能動フラッシュ使用ではないので、優先権の交互
 * は能動使用者 (alice) を基準に進み、無効化後は **相手 (bob) のフラッシュタイミング** になる。
 *
 * 盤面: bob がアタック (active)。before_block フラッシュ窓で非アクティブ alice が先優先権。
 *   alice がフラッシュマジック (BSTH05-R02) を使用 → bob 手札の咲夜が誘発 → declare → 応答窓後に維持コアを選び召喚して無効化 → 窓が落ち着いた時点の優先権が bob であることを表明する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { ActiveAttack, CardDefinition, GameState } from "../src";

const 咲夜 = ALL_CARDS.find((c) => c.cardNo === "BSTH01-X05")!;
const aliceFlash = ALL_CARDS.find((c) => c.cardNo === "BSTH05-R02")!;

// bob のアタッカー（素のスピリット）。
const bobAttackerDef: CardDefinition = {
  cardNo: "P3-110-ATTACKER",
  name: "P3-110 アタッカー",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const defs = [咲夜, aliceFlash, bobAttackerDef];
const defMap = new Map(defs.map((d) => [d.cardNo, d]));
const lookups = {
  getCardDefinitionById: (id: string) => defMap.get(id),
  getRegisteredMagicActions: buildMagicLookup(defs),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(defs),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
  getRegisteredBurstActions: buildBurstEffectLookup(defs),
};

/**
 * bob アタックステップ・before_block フラッシュ窓（非アクティブ alice 先優先権）を再現。
 * bob 場にアタッカー1体、alice 手札にフラッシュマジック、bob 手札に咲夜。
 */
function buildState(): GameState {
  const attacker = createCardInstance(bobAttackerDef, {
    instanceId: "bob-attacker",
    ownerPlayerId: "bob",
    zone: "field",
    cores: 1,
    exhaustState: "exhausted",
  });
  const sakuya = createCardInstance(咲夜, {
    instanceId: "sakuya-1",
    ownerPlayerId: "bob",
    zone: "hand",
  });
  const flash = createCardInstance(aliceFlash, {
    instanceId: "alice-flash-1",
    ownerPlayerId: "alice",
    zone: "hand",
  });

  const activeAttack: ActiveAttack = {
    attackId: "atk-1",
    primaryEntityId: "e-attacker",
    participantEntityIds: ["e-attacker"],
    groupMode: "single",
    target: { kind: "player", playerId: "alice" },
    blockAssignments: [],
    symbolResolutionOrder: [],
    flashBeforeBlockCompleted: false,
    flashAfterBlockCompleted: false,
    flashWindowState: {
      kind: "before_block",
      // before_block の先優先権は非アクティブ (alice)。
      priorityPlayerId: "alice",
      consecutivePassCount: 0,
      stackResponseSourcePlayerId: "alice",
      pendingStackAction: null,
    },
  };

  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [attacker, sakuya, flash],
    activeAttack,
    battleEntities: [
      {
        entityId: "e-attacker",
        memberInstanceIds: ["bob-attacker"],
        resolvedBp: 5000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
    ],
    // alice がフラッシュ cost4 を払えるよう、bob は咲夜の維持コアを払えるようリザーブを厚めに。
    playerOverrides: [
      { id: "alice", reserveNormalCoreCount: 8 },
      { id: "bob", reserveNormalCoreCount: 8 },
    ],
  });

  return {
    ...base,
    step: "attack",
    activePlayerId: "bob",
    window: "flash_before_block",
  };
}

describe("フラッシュ優先権: 誘発無効化後は相手のフラッシュタイミングになる", () => {
  it("alice フラッシュ使用 → bob 咲夜で無効 → 優先権は bob (使用者 alice へ跳ね返らない)", () => {
    const state = buildState();

    // 1. alice が before_block 窓でフラッシュマジックを使用。
    const aliceActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    });
    const useFlash = aliceActions.find(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "alice-flash-1"
    );
    expect(useFlash).toBeDefined();

    let cur = applyLegalAction({
      state,
      action: useFlash!,
      paymentSources: [{ kind: "reserve", amount: 4 }],
      ...lookups,
    }).state;

    // 2. bob の咲夜が誘発して非公開キューに乗る。
    expect(cur.pendingPrivateDeclarations).toHaveLength(1);
    expect(cur.pendingPrivateDeclarations[0]).toMatchObject({
      ownerPlayerId: "bob",
      sourceInstanceId: "sakuya-1",
      sourceDefinitionId: "BSTH01-X05",
      eventKind: "flash",
    });

    // 3. 解決ループを回す（declare / 各種 pass を優先権者から順に消化）。咲夜の召喚解決まで進める。
    const passKinds = [
      "declare_private_triggered_effect",
      "resolve_pending_triggered_effect",
      "resolve_pending_effect_target",
      "pass_battle_flash",
      "pass_stack",
      "pass_pre_declaration_stack",
    ];
    const trace: string[] = [];
    for (let i = 0; i < 30; i++) {
      cur = finishCoreChoices(cur, lookups.getCardDefinitionById, lookups);
      // alice フラッシュが無効化されトラッシュ、かつ咲夜が場入り、かつ誘発キュー空＝解決完了。
      const flash = cur.cardInstances.find(
        (c) => c.instanceId === "alice-flash-1"
      );
      const sakuyaInst = cur.cardInstances.find(
        (c) => c.instanceId === "sakuya-1"
      );
      const settled =
        flash?.zone === "trash" &&
        sakuyaInst?.zone === "field" &&
        cur.pendingPrivateDeclarations.length === 0 &&
        cur.pendingTriggeredEffects.length === 0 &&
        (cur.activeAttack?.flashWindowState?.pendingStackAction ?? null) ===
          null;
      if (settled) break;

      let advanced = false;
      for (const pid of ["alice", "bob"]) {
        const acts = getLegalActions({
          state: cur,
          actingPlayerId: pid,
          ...lookups,
        });
        let next = undefined;
        for (const k of passKinds) {
          next = acts.find((a) => a.kind === k);
          if (next) break;
        }
        if (next) {
          trace.push(`${pid}:${next.kind}`);
          cur = applyLegalAction({
            state: cur,
            action: next,
            ...lookups,
          }).state;
          advanced = true;
          break;
        }
      }
      if (!advanced) {
        trace.push(
          `stuck window=${cur.window} prio=${cur.activeAttack?.flashWindowState?.priorityPlayerId}`
        );
        break;
      }
    }

    // 4. 検証: alice フラッシュは無効化されトラッシュ、咲夜は場入り。
    expect(
      cur.cardInstances.find((c) => c.instanceId === "alice-flash-1")?.zone
    ).toBe("trash");
    expect(cur.log.some((l) => l.startsWith("magic:nullified:"))).toBe(true);
    expect(
      cur.cardInstances.find((c) => c.instanceId === "sakuya-1")?.zone
    ).toBe("field");

    // 5. 本丸: 解決が落ち着いた時点で before_block フラッシュ窓はまだ開いており、
    //    優先権は **bob**（使用者 alice へ跳ね返っていない）。
    expect(cur.window).toBe("flash_before_block");
    expect(cur.activeAttack?.flashWindowState?.pendingStackAction).toBeNull();
    expect(cur.activeAttack?.flashWindowState?.priorityPlayerId).toBe("bob");
    // bob は能動フラッシュ使用者として "flash" timing を得る（自分のフラッシュを使える）。
    expect(
      cur.activeAttack?.flashWindowState?.stackResponseSourcePlayerId
    ).toBe("bob");
  });
});
