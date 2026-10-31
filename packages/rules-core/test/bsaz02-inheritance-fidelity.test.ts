import { getCEsForTarget } from "../src/card/ce-lookup";
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  flushPendingLeaves,
  getEffectiveBp,
  getEffectiveLevel,
  getEffectiveSymbols,
  type GameState,
  type Effect,
} from "../src";
import {
  expandCardDefinitionsWithBackFaces,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import {
  recomputeAndRebuildContinuousEffects,
  recomputeAndRebuildBattleStateContinuousEffects,
} from "../src/effect/continuous-effect-rebuild";
import { countEffectiveUnderCardRole } from "../src/mechanics/under-card-role";
import { getEffectiveUnderCardSlotCap } from "../src/mechanics/star-garment-utils";
import {
  queueGrantedEffectTriggersFromTriggerEvents,
  getGrantedTriggeredUsageOptions,
} from "../src/mechanics/grant-effect-system";
import { recordEffectUsageIfLimited } from "../src/legal/legal-actions-shared";

const defs = new Map(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((d) => [d.cardNo, d])
);
const getDef = (id: string) => defs.get(id);
const role = "アルドノアドライブ";
const inst = (
  no: string,
  id: string,
  zone: "field" | "deck" | "trash" = "field",
  owner = "alice",
  cores = zone === "field" ? 1 : 0
) =>
  createCardInstance(getDef(no)!, {
    instanceId: id,
    ownerPlayerId: owner,
    controllerPlayerId: owner,
    zone,
    normalCoreCount: cores,
  });
const find = (s: GameState, id: string) =>
  s.cardInstances.find((c) => c.instanceId === id)!;
const rebuild = (s: GameState) =>
  recomputeAndRebuildContinuousEffects(s, getDef);
function base(cards: GameState["cardInstances"]): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: cards,
    }),
    activePlayerId: "alice",
    step: "attack",
    turnNumber: 3,
  };
}
function attach(
  s: GameState,
  hostId: string,
  childId: string,
  tag = role,
  faceDown = false,
  advent = false
): GameState {
  return {
    ...s,
    cardInstances: s.cardInstances.map((c) =>
      c.instanceId === hostId
        ? {
            ...c,
            underCards: [
              ...c.underCards,
              {
                cardInstanceId: childId,
                role: advent
                  ? ("advent_source" as const)
                  : ("text_role" as const),
                roleTag: tag,
              },
            ],
          }
        : c.instanceId === childId
          ? { ...c, normalCoreCount: 0, attachedToInstanceId: hostId, faceDown }
          : c
    ),
  };
}
const grants = (s: GameState, id: string) =>
  s.activeContinuousEffects
    .filter(
      (ce) =>
        ce.modifierTag === "granted_effect" &&
        ce.targetInstanceId === id &&
        ce.metadata?.grantedEffect
    )
    .map((ce) => ce.metadata!.grantedEffect as Effect);
const lookups = {
  getCardDefinitionById: getDef,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
    ...defs.values(),
  ]),
  getRegisteredMagicActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredBurstActions: () => [],
};

describe("BSAZ02 ドライブの役割と全効果継承", () => {
  it.each(["BSAZ02-X04", "BSAZ02-X05"])(
    "%s: 由来不問の裏向きアンダーカードを有効化し、導界者離脱で失効する",
    (no) => {
      let s = base([
        inst("BSAZ02-C03", "host"),
        inst(no, "guide"),
        inst("BSAZ02-C01", "under"),
        inst("BSAZ02-C01", "enemy", "field", "bob"),
      ]);
      s = attach(s, "host", "under", "別の役割", true, true);
      s = rebuild(s);
      expect(
        countEffectiveUnderCardRole(s, find(s, "host"), role, getDef)
      ).toBe(1);
      expect(
        s.activeContinuousEffects.some(
          (ce) =>
            ce.sourceInstanceId === "host" &&
            ce.modifierTag.startsWith("prevent_battle_")
        )
      ).toBe(true);
      s = rebuild({
        ...s,
        cardInstances: s.cardInstances.map((c) =>
          c.instanceId === "guide" ? { ...c, zone: "trash" as const } : c
        ),
      });
      expect(
        countEffectiveUnderCardRole(s, find(s, "host"), role, getDef)
      ).toBe(0);
      expect(
        s.activeContinuousEffects.some(
          (ce) =>
            ce.sourceInstanceId === "host" &&
            ce.modifierTag.startsWith("prevent_battle_")
        )
      ).toBe(false);
      expect(find(s, "host").underCards[0]).toMatchObject({
        role: "advent_source",
        roleTag: "別の役割",
      });
    }
  );
  it.each(["オルテュギア", "オルテュギア改"])(
    "X03 %s: 各発揮で1体を生成し、実ドライブを動かさず分身が能力を得て本体離脱後も残る",
    (donorName) => {
      const lookup = (id: string) =>
        id === "BSAZ02-X03" ? { ...getDef(id)!, name: donorName } : getDef(id);
      let s = attach(
        base([
          inst("BSAZ02-X03", "host"),
          inst("BSAZ02-C10", "drive"),
          inst("BSAZ02-C01", "d1", "deck"),
          inst("BSAZ02-C01", "d2", "deck"),
          inst("BSAZ02-C01", "d3", "deck"),
        ]),
        "host",
        "drive"
      );
      for (let i = 0; i < 2; i++)
        s = executeEffect({
          chainId: "test:bsaz02-inheritance-fidelity:170",
          state: s,
          effect: getDef("BSAZ02-X03")!.effects![0]!,
          sourceInstanceId: "host",
          actingPlayerId: "alice",
          firingBattleEndDeferral: true,
          ...lookups,
          getCardDefinitionById: lookup,
        });
      s = recomputeAndRebuildContinuousEffects(s, lookup);
      for (const id of ["d1", "d2"]) {
        expect(find(s, id).zone).toBe("field");
        expect(find(s, id).normalCoreCount).toBe(1);
        expect(countEffectiveUnderCardRole(s, find(s, id), role, getDef)).toBe(
          1
        );
        expect(find(s, id).underCards).toEqual([]);
        expect(
          grants(s, id).some(
            (e) =>
              e.timing.kind === "card_event" &&
              e.steps.some((st) => st.action.kind === "register_act_as_spirit")
          )
        ).toBe(true);
      }
      expect(find(s, "drive").attachedToInstanceId).toBe("host");
      s = executeEffect({
        chainId: "test:bsaz02-inheritance-fidelity:193",
        state: s,
        effect: {
          timing: { kind: "activated", mode: "main" },
          steps: [{ action: { kind: "destroy", target: { kind: "self" } } }],
        },
        sourceInstanceId: "host",
        actingPlayerId: "alice",
        firingBattleEndDeferral: true,
        ...lookups,
        getCardDefinitionById: lookup,
      });
      s = recomputeAndRebuildContinuousEffects(
        flushPendingLeaves(s, lookup),
        lookup
      );
      expect(find(s, "host").zone).toBe("trash");
      expect(find(s, "d1").zone).toBe("field");
      expect(
        getEffectiveBp(
          s,
          find(s, "d1"),
          getDef(find(s, "d1").definitionId)!,
          getDef
        )
      ).toBe(3000);
      expect(grants(s, "d1").length).toBeGreaterThan(0);
    }
  );
  it("TX01(B): Lv4で全ドライブ効果とシンボル/枠を取得し、Lv3で失効する", () => {
    let s = base([
      inst("BSAZ02-TX01(B)", "host", "field", "alice", 3),
      inst("BSAZ02-C10", "drive"),
      inst("BSAZ02-C03", "continuous"),
      inst("BSAZ02-R01", "attack"),
      inst("BSAZ02-C01", "enemy", "field", "bob"),
    ]);
    s = attach(
      attach(attach(s, "host", "drive"), "host", "continuous", "他効果由来"),
      "host",
      "attack",
      "別の役割",
      false,
      true
    );
    s = rebuild(s);
    expect(
      getEffectiveLevel(s, find(s, "host"), getDef("BSAZ02-TX01(B)")!, getDef)
    ).toBe(4);
    expect(
      s.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === "host" &&
          ce.modifierTag.startsWith("prevent_battle_")
      )
    ).toBe(true);
    expect(
      grants(s, "host").some(
        (e) =>
          e.timing.kind === "continuous" &&
          e.steps.some((step) => step.action.kind === "restrict_use")
      )
    ).toBe(true);
    expect(
      getEffectiveSymbols(s, find(s, "host"), getDef("BSAZ02-TX01(B)")!, getDef)
    ).toHaveLength(4);
    expect(
      getEffectiveUnderCardSlotCap(
        s,
        find(s, "host"),
        getDef("BSAZ02-TX01(B)")!,
        role,
        getDef
      )
    ).toBe(5);
    s = rebuild({
      ...s,
      cardInstances: s.cardInstances.map((c) =>
        c.instanceId === "host" ? { ...c, normalCoreCount: 1 } : c
      ),
    });
    expect(grants(s, "host")).toEqual([]);
    expect(
      s.activeContinuousEffects.some(
        (ce) =>
          ce.sourceInstanceId === "host" &&
          ce.modifierTag.startsWith("prevent_battle_")
      )
    ).toBe(false);
  });
  it("TX01(B): Lv5のブロック中にも取得した常時攻撃制限を発揮し、Lv4では失効する", () => {
    let s = attach(
      attach(
        base([
          inst("BSAZ02-TX01(B)", "host", "field", "alice", 5),
          inst("BSAZ02-C10", "drive"),
          inst("BSAZ02-R01", "under"),
        ]),
        "host",
        "drive"
      ),
      "host",
      "under",
      "ＣＦアルティメット"
    );
    s = rebuild(s);
    const ids = s.activeContinuousEffects
      .filter((ce) => ce.modifierTag === "granted_effect")
      .map((ce) => ce.effectId);
    s = rebuild(s);
    expect(
      s.activeContinuousEffects
        .filter((ce) => ce.modifierTag === "granted_effect")
        .map((ce) => ce.effectId)
    ).toEqual(ids);
    s = recomputeAndRebuildBattleStateContinuousEffects(
      {
        ...s,
        battleEntities: [
          {
            entityId: "block-host",
            memberInstanceIds: ["host"],
            attackState: "blocking",
            resolvedBp: 25000,
            resolvedSymbols: ["ultimate_symbol"],
          },
        ],
      },
      getDef
    );
    expect(
      s.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "restrict_use" && ce.sourceInstanceId === "host"
      )
    ).toBe(true);
    s = rebuild({
      ...s,
      cardInstances: s.cardInstances.map((c) =>
        c.instanceId === "host" ? { ...c, normalCoreCount: 3 } : c
      ),
    });
    expect(
      s.activeContinuousEffects.some((ce) => ce.modifierTag === "restrict_use")
    ).toBe(false);
  });
  it("TX01(B): Lv4でも下のX02のLv5スタック制限を取得し、相手ターンと最初のバトル後には失効する", () => {
    const s = rebuild(
      attach(
        attach(
          base([
            inst("BSAZ02-TX01(B)", "host", "field", "alice", 3),
            inst("BSAZ02-C10", "drive"),
            inst("BSAZ02-X02", "under"),
          ]),
          "host",
          "drive"
        ),
        "host",
        "under",
        "任意の由来"
      )
    );
    const active = (state: GameState) =>
      getCEsForTarget(state, "bob").some(
        (ce) =>
          ce.modifierTag === "restrict_stack" && ce.sourceInstanceId === "host"
      );
    expect(active(s)).toBe(true);
    expect(active(rebuild({ ...s, activePlayerId: "bob" }))).toBe(false);
    expect(active(rebuild({ ...s, battlesEndedThisTurn: 1 }))).toBe(false);
  });
  it("取得した任意・多イベント効果の回数制限をCE再構築後も保つ", () => {
    let s = rebuild(
      attach(
        attach(
          base([
            inst("BSAZ02-TX01(B)", "host", "field", "alice", 3),
            inst("BSAZ02-C10", "drive"),
            inst("BSAZ02-R01", "under"),
          ]),
          "host",
          "drive"
        ),
        "host",
        "under"
      )
    );
    const ce = s.activeContinuousEffects.find(
      (entry) =>
        (entry.metadata?.grantedEffect as Effect | undefined)?.executionMode ===
        "optional"
    )!;
    expect(ce).toBeDefined();
    const event = {
      eventKind: "summon",
      relatedInstanceId: "host",
      relatedPlayerId: "alice",
      chainId: "first",
    };
    expect(
      queueGrantedEffectTriggersFromTriggerEvents(s, [event], getDef)
        .pendingTriggeredEffects
    ).toHaveLength(1);
    s = recordEffectUsageIfLimited(
      getGrantedTriggeredUsageOptions(s, ce, find(s, "host"), getDef)
    );
    s = rebuild(s);
    expect(
      queueGrantedEffectTriggersFromTriggerEvents(
        s,
        [{ ...event, chainId: "second" }],
        getDef
      ).pendingTriggeredEffects
    ).toEqual([]);
  });
  it("取得元自身が全効果取得を持つ場合も同一取得元を循環展開しない", () => {
    const s = rebuild(
      attach(
        attach(
          base([
            inst("BSAZ02-TX01(B)", "host", "field", "alice", 3),
            inst("BSAZ02-C10", "drive"),
            inst("BSAZ02-TX01(B)", "under"),
          ]),
          "host",
          "drive"
        ),
        "host",
        "under"
      )
    );
    expect(grants(s, "host")).toHaveLength(4);
    expect(s.activeContinuousEffects.length).toBeLessThan(16);
  });
});
