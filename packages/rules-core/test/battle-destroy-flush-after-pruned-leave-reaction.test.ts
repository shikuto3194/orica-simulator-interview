/**
 * 再現テスト: BP比較で破壊と判定されたブロッカーが、フィールドに「破壊待ち」のまま残る。
 *
 * 元事象 (orica-snapshot-2026-11-03T00-07-35): 契約煌臨元 BSDB01-CX01 の下に並ぶ BSDB01-X02 が
 * 合体済みブレイヴ付きのトークン (BSES01-T01) にブロックされ、21000 対 7000 で
 * `blocker_destroyed` と判定された。しかし CX01 の「サイヤ人によって相手のカードが
 * フィールドを離れるとき」(ターン1回) は同ターンに使用済みで、離脱前反応の誘発が積まれた後に
 * `trigger:pruned-illegal` で取り下げられた。取り下げ後に離脱の flush が再実行されず、
 * ブロッカーが pendingLeaveKind:"destroy" のまま場に残った。
 */
import { expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeAdvent } from "../src/mechanics/advent-system";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import { seedEffectUsage } from "./helpers/effect-usage-fixture";
import { recomputeAndRebuildContinuousEffects } from "../src/effect/continuous-effect-rebuild";
import {
  buildBurstEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/runtime";

const m = new Map(ALL_CARDS.map((c) => [c.cardNo, c]));
const getDef = (id: string) => m.get(id);
const A = "player-1";
const B = "player-2";
const lk = {
  getCardDefinitionById: getDef,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
} as never;
type Act = { kind: string; [k: string]: unknown };

function setup(cx01Used: boolean) {
  const mk = (no: string, id: string, owner: string, extra = {}) =>
    createCardInstance(m.get(no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      controllerPlayerId: owner,
      zone: "field",
      normalCoreCount: 1,
      ...extra,
    } as never);
  const host = mk("BSDB01-CX01", "card-28", A, { normalCoreCount: 3 });
  const attacker = mk("BSDB01-X02", "card-10", A, { zone: "hand" });
  const blocker = mk("BSES01-T01", "bses01-t01-1", B, {
    attachedChildrenIds: ["card-44"],
  });
  const brave = mk("BSES01-C05", "card-44", B, {
    zoneRoleName: "brave",
    normalCoreCount: 0,
    attachedToInstanceId: "bses01-t01-1",
  });
  let st = createEmptyGameState({
    cardInstances: [host, attacker, blocker, brave],
    playerOverrides: [
      {
        soulCoreLocation: { kind: "reserve" },
        contractCardNo: "BSDB01-CX01",
        countValue: 10,
      },
      {},
    ],
  });
  st = executeAdvent(
    st,
    A,
    {
      adventCardInstanceId: "card-10",
      targetInstanceId: "card-28",
      adventData: m.get("BSDB01-X02")!.adventData!,
      isContractAdvent: true,
    } as never,
    getDef
  );
  st = {
    ...st,
    activePlayerId: A,
    step: "attack" as never,
    turnNumber: 3,
    window: "none" as never,
  };
  if (cx01Used) {
    st = seedEffectUsage(st, {
      sourceInstanceId: "card-28",
      effectLabel: "effect:1",
      usageLimit: { kind: "per_card_name", duration: "turn" },
    });
  }
  // 実戦では場に出た時点で常時効果 (prevent_brave_separation) が登録済み。
  return recomputeAndRebuildContinuousEffects(st, getDef);
}

function playBattle(initial: ReturnType<typeof setup>) {
  let st = initial;
  let attacked = false;
  for (let g = 0; g < 60; g++) {
    const pend = [
      st.pendingStepOptionalTargetSelection?.choosingPlayerId,
      st.pendingStepOptionalChoice?.choosingPlayerId,
    ].find(Boolean);
    const actor = pend ?? st.stackWindow?.priorityPlayerId ?? A;
    let acts = getLegalActions({
      state: st,
      actingPlayerId: actor,
      ...lk,
    } as never) as unknown as Act[];
    if (acts.length === 0 || acts.every((x) => x.kind === "end_attack_step")) {
      const other = actor === A ? B : A;
      const o = getLegalActions({
        state: st,
        actingPlayerId: other,
        ...lk,
      } as never) as unknown as Act[];
      if (o.length > 0) acts = o;
    }
    let a: Act | undefined =
      acts.find((x) => x.kind === "block") ??
      acts.find((x) => x.kind === "resolve_pending_triggered_effect") ??
      acts.find(
        (x) =>
          x.kind === "resolve_pending_step_optional_choice" &&
          x.choice === "decline"
      ) ??
      acts.find((x) => x.kind === "resolve_pending_step_optional_choice") ??
      acts.find((x) => x.kind === "pass_stack");
    if (!a && !attacked) {
      a = acts.find(
        (x) => x.kind === "attack" && x.sourceInstanceId === "card-10"
      );
      attacked = !!a;
    }
    const resolved = st.log.some((l) => l.startsWith("battle:resolution:end:"));
    a ??= resolved
      ? acts.find((x) => x.kind === "end_attack_step")
      : (acts.find((x) => /^pass/.test(x.kind)) ??
        acts.find((x) => x.kind !== "end_attack_step"));
    if (!a) break;
    st = applyLegalAction({ state: st, action: a, ...lk } as never).state;
    if (resolved && st.step !== ("attack" as never)) break;
  }
  return st;
}

const zoneOf = (st: ReturnType<typeof setup>, id: string) =>
  st.cardInstances.find((c) => c.instanceId === id)!;

it("CX01 の離脱前反応が使用済みで取り下げられても、BP比較で破壊されたブロッカーはトラッシュへ送られる", () => {
  const st = playBattle(setup(true));
  expect(st.log.some((l) => l.includes(":blocker_destroyed"))).toBe(true);
  // 修正経路を確実に踏む: CX01 の離脱前反応が積まれ、使用済みのため取り下げられた。
  expect(st.log.some((l) => l.startsWith("trigger:queued:"))).toBe(true);
  expect(st.log.some((l) => l.startsWith("trigger:pruned-illegal:"))).toBe(
    true
  );
  const blocker = zoneOf(st, "bses01-t01-1");
  expect(blocker.pendingLeaveKind).toBeNull();
  expect(blocker.zone).not.toBe("field");
  // 合体ブレイヴはホストと一緒に場を離れる (forceBraveSendWithHost)。
  expect(zoneOf(st, "card-44").zone).not.toBe("field");
  expect(st.pendingLeaveEntities).toEqual([]);
});

it("対照: CX01 が未使用なら従来どおり破壊が確定する", () => {
  const st = playBattle(setup(false));
  expect(st.log.some((l) => l.includes(":blocker_destroyed"))).toBe(true);
  // 対照は反応が取り下げられず、通常の宣言・解決を経て確定する。
  expect(st.log.some((l) => l.startsWith("trigger:pruned-illegal:"))).toBe(
    false
  );
  expect(st.pendingLeaveEntities.map((p) => p.instanceId)).not.toContain(
    "bses01-t01-1"
  );
});
