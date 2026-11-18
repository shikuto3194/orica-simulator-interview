import { expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeAdvent } from "../src/mechanics/advent-system";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import {
  buildBurstEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/runtime";
const m = new Map(ALL_CARDS.map((c) => [c.cardNo, c]));
const getDef = (id: string) => m.get(id);
const A = "player-1",
  B = "player-2";
const lk = {
  getCardDefinitionById: getDef,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredBurstActions: buildBurstEffectLookup(ALL_CARDS),
} as never;
type Act = {
  kind: string;
  choice?: string;
  sourceInstanceId?: string;
  [k: string]: unknown;
};
// 実ログ再現: 攻撃者(疲労)の回復対象が、プール先頭の回復状態スピリットへ自動選択されて不発になる
// (resolveTargets が回復の適格性より前に件数で絞っていた) 退行の防止。
// コア配置先 (card-2: 回復状態) と回復対象 (card-13: 疲労) は別選択で、互いに束縛しない。
it("BSDB01-CX01: コアを回復状態スピリットへ置いても、疲労した別スピリットが回復される", () => {
  const mk = (no: string, id: string, owner: string, extra = {}) =>
    createCardInstance(m.get(no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      controllerPlayerId: owner,
      zone: "field",
      normalCoreCount: 1,
      ...extra,
    } as never);
  const host = mk("BSDB01-CX01", "card-12", A, { normalCoreCount: 3 });
  const adv = mk("BSDB01-C01", "card-13", A, { zone: "hand" });
  const others = [
    mk("BSDB01-C07", "card-2", A),
    mk("BSDB01-C06", "card-3", A),
    mk("BSDB01-C03", "card-11", A, {
      exhaustState: "recovered",
    }),
  ];
  const bobs = [
    mk("BSDB01-C05", "card-41", B, { normalCoreCount: 1 }),
    mk("BSDB01-C05", "card-45", B, { normalCoreCount: 1 }),
  ];
  let st = createEmptyGameState({
    cardInstances: [...others, host, adv, ...bobs],
    playerOverrides: [
      { handCount: 1, deckCount: 5, soulCoreLocation: { kind: "reserve" } },
      {},
    ],
  });
  const c = m.get("BSDB01-C01")!;
  st = executeAdvent(
    st,
    A,
    {
      adventCardInstanceId: "card-13",
      targetInstanceId: "card-12",
      adventData: c.adventData!,
      isContractAdvent: true,
    } as never,
    getDef
  );
  st = {
    ...st,
    activePlayerId: A,
    step: "attack" as never,
    turnNumber: 2,
    window: "none" as never,
  };
  const trace: string[] = [];
  let attacked = false;
  for (let g = 0; g < 80; g++) {
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
    let who = actor;
    if (acts.length === 0 || acts.every((x) => x.kind === "end_attack_step")) {
      who = actor === A ? B : A;
      const o = getLegalActions({
        state: st,
        actingPlayerId: who,
        ...lk,
      } as never) as unknown as Act[];
      if (o.length > 0) acts = o;
      else who = actor;
    }
    const pri = [
      "resolve_pending_core_distribution",
      "resolve_pending_step_optional_target_selection",
      "resolve_pending_step_optional_choice:execute",
      "resolve_pending_effect_target_selection",
      "resolve_pending_triggered_effect",
      "pass_stack",
    ];
    let a: Act | undefined;
    for (const p of pri) {
      const [k, ch] = p.split(":");
      a = acts.find((x) => x.kind === k && (!ch || x.choice === ch));
      if (a) break;
    }
    if (!a && !attacked) {
      a = acts.find(
        (x) => x.kind === "attack" && x.sourceInstanceId === "card-13"
      );
      attacked = !!a;
    }
    if (!a) {
      a =
        acts.find((x) => /^pass/.test(x.kind)) ??
        acts.find((x) =>
          /^(declare_block|no_block|skip_block|confirm)/.test(x.kind)
        ) ??
        acts.find((x) => x.kind !== "end_attack_step");
    }
    trace.push(who + ":" + a?.kind);
    if (!a) break;
    const extra =
      a.kind === "resolve_pending_core_distribution"
        ? {
            coreDistributionAllocations: {
              ["card-2"]: 1,
            },
            coreDistributionSourceAllocations: { void: 1 },
          }
        : a.kind === "resolve_pending_step_optional_target_selection"
          ? {
              targetInstanceIds:
                st.pendingStepOptionalTargetSelection!.candidateInstanceIds.slice(
                  0,
                  1
                ),
            }
          : {};
    st = applyLegalAction({
      state: st,
      action: a,
      ...lk,
      ...extra,
    } as never).state;
    if (st.log.some((l) => l.startsWith("effect:recover"))) break;
  }
  const ex = (id: string) =>
    st.cardInstances.find((x) => x.instanceId === id)!.exhaustState;
  expect(trace.join(" ")).toContain("resolve_pending_core_distribution");
  expect(st.log).toContain("effect:recover:card-13");
  expect(ex("card-13")).toBe("recovered");
  expect(ex("card-11")).toBe("recovered");
});
