import { finishCoreChoices } from "./helpers/core-choice-driver";
/**
 * P3-73 X05 咲夜: 実フラッシュ窓を通したフル e2e（窓クローズで効果スキップ）。
 *
 * 既存テストのカバー範囲:
 * - `p3-73-x05-sakuya-flash-trigger.test.ts`: `queueFlashUsedTriggers` 直呼びで誘発→
 *   非公開キュー、declare で isNullified（手組み stackWindow）。
 * - `p3-73-a5-nullify-resolution-and-windows.test.ts`: `resolveDeferredMagicStack` 直呼びで
 *   スキップ＋trash、印付けの 3 窓カバレッジ（いずれも窓・解決を手動で繋ぐ）。
 *
 * 本テストが埋めるギャップ（A5 NOTE が「setup が膨らむため省略」とした実窓フル駆動）:
 *   bob が**実 `use_magic`（フラッシュ）**を公開 API で使用
 *   → magic-system が `queueFlashUsedTriggers` を発火（A1 配線）
 *   → 咲夜が alice の非公開キューに乗る
 *   → alice が declare → bob フラッシュ ActiveStack に isNullified
 *   → **窓を pass で自然クローズ** → resolveDeferredMagicStack がスキップ
 *   → bob フラッシュは効果不発でトラッシュ、alice アタッカーは重疲労しない、usageLimit 消費。
 *
 * 観測対象は実カード BSTH05-R02「豊符オヲトシハーベスター」(フラッシュ: 相手スピリット1体を重疲労)。
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
const bobFlash = ALL_CARDS.find((c) => c.cardNo === "BSTH05-R02")!;
const adoptedContract = ALL_CARDS.find((c) => c.cardNo === "BSRK01-CX01")!;

// alice のアタッカー（重疲労の対象になる素のスピリット）。
const aliceAttackerDef: CardDefinition = {
  cardNo: "P3-73-E2E-ATTACKER",
  name: "P3-73 e2e アタッカー",
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

const defs = [咲夜, bobFlash, aliceAttackerDef, adoptedContract];
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
 * alice アタックステップ・before_block フラッシュ窓（bob 優先権）を再現。
 * alice 場にアタッカー1体、alice 手札に咲夜、bob 手札に BSTH05-R02、bob リザーブ十分。
 */
function buildState(adopted = false, presented = false): GameState {
  const attacker = createCardInstance(aliceAttackerDef, {
    instanceId: "alice-attacker",
    ownerPlayerId: "alice",
    zone: "field",
    cores: 1,
    exhaustState: "recovered",
  });
  const sakuya = createCardInstance(咲夜, {
    instanceId: "sakuya-1",
    ownerPlayerId: "alice",
    zone: "hand",
  });
  const flash = createCardInstance(bobFlash, {
    instanceId: "bob-flash-1",
    ownerPlayerId: "bob",
    zone: "hand",
  });

  const activeAttack: ActiveAttack = {
    attackId: "atk-1",
    primaryEntityId: "e-attacker",
    participantEntityIds: ["e-attacker"],
    groupMode: "single",
    target: { kind: "player", playerId: "bob" },
    blockAssignments: [],
    symbolResolutionOrder: [],
    flashBeforeBlockCompleted: false,
    flashAfterBlockCompleted: false,
    flashWindowState: {
      kind: "before_block",
      priorityPlayerId: "bob",
      consecutivePassCount: 0,
      // 実 openBattleFlash と同じく source=優先権者。これで bob は timings=["flash"] を得て
      // フラッシュ効果 (BSTH05-R02) を本体ループで使用できる (旧 null はフラッシュ効果を
      // stack 派生 reg 経由でしか使えない不正確な再現だった。flash→stack 派生は廃止)。
      stackResponseSourcePlayerId: "bob",
      pendingStackAction: null,
    },
  };

  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      attacker,
      sakuya,
      flash,
      ...(adopted
        ? [
            createCardInstance(adoptedContract, {
              instanceId: "adopted-contract",
              ownerPlayerId: "alice",
              zone: "deck",
            }),
          ]
        : []),
    ],
    activeAttack,
    battleEntities: [
      {
        entityId: "e-attacker",
        memberInstanceIds: ["alice-attacker"],
        resolvedBp: 5000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
    ],
    // bob がフラッシュ cost4 を払えるようリザーブを厚めに。
    playerOverrides: [
      {
        id: "alice",
        contractCardNo: presented ? adoptedContract.cardNo : null,
      },
      { id: "bob", reserveNormalCoreCount: 8 },
    ],
  });

  return {
    ...base,
    step: "attack",
    activePlayerId: "alice",
    window: "flash_before_block",
  };
}

describe("P3-73 X05 咲夜: 実フラッシュ窓フル e2e", () => {
  it("bob が実 use_magic で BSTH05-R02 を使用 → 咲夜が非公開キューに乗る → declare → 窓クローズで効果スキップ＋trash、アタッカーは重疲労しない", () => {
    const state = buildState();

    // 1. bob が before_block 窓で BSTH05-R02 を使用（対象は窓クローズ後なので未指定）。
    const bobActions = getLegalActions({
      state,
      actingPlayerId: "bob",
      ...lookups,
    });
    const useFlash = bobActions.find(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "bob-flash-1"
    );
    expect(useFlash).toBeDefined();

    // bob は緑/神シンボル不在のため finalCost=4。リザーブから 4 コア支払い。
    const afterUse = applyLegalAction({
      state,
      action: useFlash!,
      paymentSources: [{ kind: "reserve", amount: 4 }],
      ...lookups,
    }).state;

    // 2. magic-system の queueFlashUsedTriggers 配線で咲夜が alice 非公開キューへ。
    expect(afterUse.pendingPrivateDeclarations).toHaveLength(1);
    expect(afterUse.pendingPrivateDeclarations[0]).toMatchObject({
      ownerPlayerId: "alice",
      sourceInstanceId: "sakuya-1",
      sourceDefinitionId: "BSTH01-X05",
      eventKind: "flash",
    });

    // 3. 案X: 咲夜は「使用したとき」誘発でスタック効果でないため、相手フラッシュが応答窓に
    //    いる間は declare できない (deferred)。alice はまず自分のスタックタイミングをパスする。
    const aliceDuringWindow = getLegalActions({
      state: afterUse,
      actingPlayerId: "alice",
      ...lookups,
    });
    expect(
      aliceDuringWindow.find(
        (a) => a.kind === "declare_private_triggered_effect"
      )
    ).toBeUndefined();
    expect(
      aliceDuringWindow.find((a) => a.kind === "pass_battle_flash")
    ).toBeDefined();

    // 4. alice がパス → 窓クローズ後の発揮前チェックポイントで咲夜を declare 可能になる。
    //    宣言後の応答窓を閉じ、維持コアを置いて召喚に成功したときだけ無効化する。
    //    以降はループで declare/pass を消化して窓クローズまで進める。
    let cur = afterUse;
    // P3-75 修正後: 無効化スタックは resolveDeferredStackAction の対象選択ガードで素通りし
    // (03b「効果無効化は『効果の発揮』を止める」=対象選択も発揮の一部)、対象選択 pending を
    // 立てずに resolveDeferredMagicStack の isNullified スキップへ直行する。resolve_pending_effect_target
    // は本来出ないはずだが、回帰検知のため passKinds には残し、後段で「出現しなかったこと」を表明する。
    const passKinds = [
      // 案X: 発揮前チェックポイントで surface する咲夜の declare を最優先で消化する。
      "declare_private_triggered_effect",
      "resolve_pending_triggered_effect",
      "resolve_pending_effect_target",
      "pass_battle_flash",
      "pass_stack",
      "pass_pre_declaration_stack",
    ];
    const trace: string[] = [];
    for (let i = 0; i < 20; i++) {
      cur = finishCoreChoices(cur, lookups.getCardDefinitionById, lookups);
      const flash = cur.cardInstances.find(
        (c) => c.instanceId === "bob-flash-1"
      );
      if (flash?.zone === "trash") break;

      // 優先権を持つプレイヤーの解決/パスアクションを順に進める。
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
          // 回帰安全のため候補を渡せるようにしておく (P3-75 修正後は本来到達しない経路)。
          const targetInstanceIds =
            next.kind === "resolve_pending_effect_target"
              ? [
                  ...(cur.pendingEffectTargetSelection?.candidateInstanceIds ??
                    []),
                ].slice(
                  0,
                  cur.pendingEffectTargetSelection?.requiredTargetCount ?? 1
                )
              : undefined;
          cur = applyLegalAction({
            state: cur,
            action: next,
            ...(targetInstanceIds ? { targetInstanceIds } : {}),
            ...lookups,
          }).state;
          advanced = true;
          break;
        }
      }
      if (!advanced) {
        const aliceKinds = getLegalActions({
          state: cur,
          actingPlayerId: "alice",
          ...lookups,
        }).map((a) => a.kind);
        const bobKinds = getLegalActions({
          state: cur,
          actingPlayerId: "bob",
          ...lookups,
        }).map((a) => a.kind);
        trace.push(
          `stuck flash.zone=${cur.cardInstances.find((c) => c.instanceId === "bob-flash-1")?.zone} window=${cur.window} alice=[${aliceKinds}] bob=[${bobKinds}]`
        );
        break;
      }
    }
    if (
      cur.cardInstances.find((c) => c.instanceId === "bob-flash-1")?.zone !==
      "trash"
    ) {
      // 失敗時の診断: 進行トレースを出す。
      throw new Error(`window-close trace: ${trace.join(" -> ")}`);
    }

    // P3-75 回帰ガード: 無効化フラッシュは対象選択を一切要求しない
    // (コントローラへの無駄な選択操作・盤面情報リークを防ぐ)。
    expect(trace.some((t) => t.includes("resolve_pending_effect_target"))).toBe(
      false
    );
    expect(cur.pendingEffectTargetSelection).toBeNull();

    // 5. bob フラッシュは効果不発でトラッシュ（usageLimit 消費は refund 無しで自動的に満たされる）。
    const flashAfter = cur.cardInstances.find(
      (c) => c.instanceId === "bob-flash-1"
    );
    expect(flashAfter?.zone).toBe("trash");

    // 6. 効果スキップの証跡: magic:nullified ログがあり、重疲労ログ/状態が無い。
    expect(cur.log.some((l) => l.startsWith("magic:nullified:"))).toBe(true);

    // 7. alice アタッカーは重疲労していない（recovered のまま）。
    const attackerAfter = cur.cardInstances.find(
      (c) => c.instanceId === "alice-attacker"
    );
    expect(attackerAfter?.exhaustState).toBe("recovered");
  });

  it.each([false, true])(
    "咲夜を『コストを支払わずに』召喚: 未提示の契約採用=%sでも、窓後の維持コアと無効化を完走する",
    (adopted) => {
      // P3-110 裁定 (2026-06-21): 内包召喚(維持コア含む)は「解決中」に属し発揮応答窓の後。
      // GUI 修正後、resolve_pending_triggered_effect（発揮宣言＝窓オープン）には
      // summonPaymentSources のみ渡し、summonEnterFieldCorePlacements は渡さない。
      // 維持コアは窓クローズ後に pendingMultiPlacement として要求される
      // (旧バグ回帰ガード: 維持コアが窓より前に前倒し要求されていた)。
      const ALICE_RESERVE_BEFORE = 4;
      const base = buildState(adopted);
      const state: GameState = {
        ...base,
        players: base.players.map((p) =>
          p.id === "alice"
            ? { ...p, reserveNormalCoreCount: ALICE_RESERVE_BEFORE }
            : p
        ),
      };

      // bob がフラッシュ使用 → 咲夜が alice 非公開キューへ。
      const useFlash = getLegalActions({
        state,
        actingPlayerId: "bob",
        ...lookups,
      }).find(
        (a) => a.kind === "use_magic" && a.sourceInstanceId === "bob-flash-1"
      );
      expect(useFlash).toBeDefined();
      const afterUse = applyLegalAction({
        state,
        action: useFlash!,
        paymentSources: [{ kind: "reserve", amount: 4 }],
        ...lookups,
      }).state;
      expect(afterUse.pendingPrivateDeclarations).toHaveLength(1);

      // 案X: 咲夜は相手フラッシュが応答窓にいる間は deferred。alice がパス → 発揮前
      // チェックポイントで declare 可能になる。窓クローズまでループで進める。咲夜の
      // resolve_pending_triggered_effect には GUI 修正後と同じ「無コスト召喚・維持コア未供給」
      // ペイロードを渡し、維持コアは窓クローズ後の pendingMultiPlacement で解決する。
      let cur = afterUse;
      const passKinds = [
        "declare_private_triggered_effect",
        "resolve_pending_triggered_effect",
        "pass_battle_flash",
        "pass_stack",
        "pass_pre_declaration_stack",
      ];
      let sawWindowBeforePlacement = false;
      let placementPendingSeen = false;
      for (let i = 0; i < 30; i++) {
        const sakuya = cur.cardInstances.find(
          (c) => c.instanceId === "sakuya-1"
        );
        if (
          sakuya?.zone === "field" &&
          cur.pendingMultiPlacement === null &&
          cur.cardInstances.find((c) => c.instanceId === "bob-flash-1")
            ?.zone === "trash"
        )
          break;

        // 維持コア要求 (pendingMultiPlacement) が立ったら配置する。
        if (cur.pendingMultiPlacement !== null) {
          placementPendingSeen = true;
          // 旧バグ回帰ガード: 維持コアが要求される時点でフラッシュ応答スタック窓は既に閉じている。
          expect(cur.stackWindow).toBeNull();
          const resolveMp = getLegalActions({
            state: cur,
            actingPlayerId: "alice",
            ...lookups,
          }).find((a) => a.kind === "resolve_pending_multi_placement");
          expect(resolveMp).toBeDefined();
          cur = applyLegalAction({
            state: cur,
            action: resolveMp!,
            multiPlacementAllocations: [
              {
                destinationInstanceId: "sakuya-1",
                placements: [{ kind: "reserve_normal", amount: 1 }],
              },
            ],
            ...lookups,
          }).state;
          continue;
        }

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
            const freePayload =
              next.kind === "resolve_pending_triggered_effect"
                ? { summonPaymentSources: [] }
                : {};
            if (next.kind === "declare_private_triggered_effect") {
              sawWindowBeforePlacement = cur.pendingMultiPlacement === null;
            }
            cur = applyLegalAction({
              state: cur,
              action: next,
              ...freePayload,
              ...lookups,
            }).state;
            advanced = true;
            break;
          }
        }
        if (!advanced) break;
      }

      // 維持コアが pendingMultiPlacement 経由で（窓後に）要求されたこと。
      expect(sawWindowBeforePlacement).toBe(true);
      expect(placementPendingSeen).toBe(true);

      // 咲夜は場入り、Lv1 最低コア=1 が乗っている。
      const sakuyaAfter = cur.cardInstances.find(
        (c) => c.instanceId === "sakuya-1"
      );
      expect(sakuyaAfter?.zone).toBe("field");
      expect(sakuyaAfter?.normalCoreCount).toBe(1);

      // 無コスト召喚: alice リザーブは配置 1 コア分のみ減少（コスト支払い分はゼロ）。
      const aliceAfter = cur.players.find((p) => p.id === "alice")!;
      expect(aliceAfter.reserveNormalCoreCount).toBe(ALICE_RESERVE_BEFORE - 1);
      expect(
        cur.cardInstances.find((c) => c.instanceId === "bob-flash-1")?.zone
      ).toBe("trash");
      expect(
        cur.log.some((entry) => entry.startsWith("magic:nullified:"))
      ).toBe(true);
      expect(
        cur.cardInstances.find((c) => c.instanceId === "alice-attacker")
          ?.exhaustState
      ).toBe("recovered");
      expect(cur.pendingPrivateDeclarations).toEqual([]);
      expect(cur.pendingTriggeredEffects).toEqual([]);
      expect(cur.pendingMultiPlacement).toBeNull();
    }
  );

  it("ゲーム開始時に契約カードを提示済みなら、咲夜は実フラッシュ使用後も宣言を作らない", () => {
    const state = buildState(true, true);
    const useFlash = getLegalActions({
      state,
      actingPlayerId: "bob",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "use_magic" && action.sourceInstanceId === "bob-flash-1"
    );
    expect(useFlash).toBeDefined();
    const afterUse = applyLegalAction({
      state,
      action: useFlash!,
      paymentSources: [{ kind: "reserve", amount: 4 }],
      ...lookups,
    }).state;
    expect(afterUse.pendingPrivateDeclarations).toEqual([]);
    expect(
      afterUse.cardInstances.find((c) => c.instanceId === "sakuya-1")?.zone
    ).toBe("hand");
  });
});
