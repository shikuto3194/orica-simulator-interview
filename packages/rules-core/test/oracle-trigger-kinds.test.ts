import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildOracleTriggerKindsScenario } from "../../../apps/playground-web/src/scenario-oracle-trigger-kinds";
import {
  applyLegalAction,
  getLegalActions,
  type CardDefinition,
  type GameState,
  type LegalAction,
  type OracleTriggerKind,
} from "../src";
import {
  checkAndQueueOracleChoices,
  wouldQueueOracleChoices,
} from "../src/mechanics/oracle-system";

const lookup = (id: string) => ALL_CARDS.find((card) => card.cardNo === id);
const actions = (state: GameState, player = state.activePlayerId) =>
  getLegalActions({
    state,
    actingPlayerId: player,
    getCardDefinitionById: lookup,
    getRegisteredFieldCardEffectActions: () => [],
    getRegisteredTriggeredEffectActions: () => [],
  });
const apply = (state: GameState, action: LegalAction, extra = {}) =>
  applyLegalAction({
    state,
    action,
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: () => [],
    ...extra,
  }).state;
function passStack(state: GameState) {
  for (let i = 0; state.stackWindow && i < 12; i++) {
    const pass = actions(state, state.stackWindow.priorityPlayerId).find(
      (a) => a.kind === "pass_stack"
    );
    expect(pass).toBeDefined();
    state = apply(state, pass!);
  }
  expect(state.stackWindow).toBeNull();
  return state;
}
const oracles = (state: GameState) =>
  state.pendingTriggeredEffects.filter((p) => p.mechanic?.kind === "oracle");
const seed = (mode = "implicit-accel") =>
  buildOracleTriggerKindsScenario(
    [...ALL_CARDS],
    new URLSearchParams({ mode })
  );

describe("Telegram 629905090: 神託は本文イベントの必須列挙だけに反応する", () => {
  for (const mode of ["implicit-accel", "explicit-accel"]) {
    it(`${mode}: 実カードの手札アクセルを完走し、永琳は0件・隠岐奈は1件`, () => {
      const before = seed(mode);
      const action = actions(before).find(
        (a) => a.kind === "use_accel" && a.sourceInstanceId === "oracle-target"
      );
      expect(action).toBeDefined();
      let after = apply(before, action!, {
        paymentSources: [{ kind: "reserve", amount: 2 }],
      });
      after = passStack(after);
      expect(oracles(after)).toHaveLength(mode === "explicit-accel" ? 1 : 0);
      expect(
        after.cardInstances.find((c) => c.instanceId === "oracle-target")!.zone
      ).toBe(mode === "explicit-accel" ? "in_use" : "set_aside");
      expect(
        after.cardInstances.find((c) => c.instanceId === "oracle-source")!
          .normalCoreCount
      ).toBe(0);
      expect(after.players[0]!.reserveNormalCoreCount).toBe(10);
      if (mode === "explicit-accel") {
        expect(oracles(after)[0]!.mechanic).toMatchObject({
          triggerKind: "use_accel",
          triggerCardInstanceId: "oracle-target",
        });
        const resolve = actions(after).find(
          (a) => a.kind === "resolve_pending_triggered_effect"
        );
        expect(resolve).toBeDefined();
        after = passStack(apply(after, resolve!));
        expect(oracles(after)).toHaveLength(0);
        expect(
          after.cardInstances.find((c) => c.instanceId === "oracle-source")!
            .normalCoreCount
        ).toBe(1);
        expect(after.players[0]!.voidNormalCoreCount).toBe(19);
        expect(
          after.cardInstances.find((c) => c.instanceId === "oracle-target")!
            .zone
        ).toBe("set_aside");
      }
    });
  }
  for (const event of ["summon", "advent"] as const) {
    it(`BSTH03-X02: 同じBSTH03-C03の${event}では導託pendingを生成する`, () => {
      const before = seed();
      const after = checkAndQueueOracleChoices(
        before,
        "oracle-target",
        event,
        lookup,
        `test:eirin:${event}`
      );
      expect(oracles(after)).toHaveLength(1);
      expect(oracles(after)[0]!.mechanic).toMatchObject({
        grandwalkerInstanceId: "oracle-source",
        triggerCardInstanceId: "oracle-target",
        triggerKind: event,
      });
    });
  }
  it("BSTH03-C03の通常召喚経路は導託を生成する", () => {
    const before = seed();
    const action = actions(before).find(
      (a) => a.kind === "summon" && a.sourceInstanceId === "oracle-target"
    );
    expect(action).toBeDefined();
    let after = passStack(
      apply(before, action!, {
        paymentSources: [{ kind: "reserve", amount: 3 }],
      })
    );
    const placement = actions(after).find(
      (a) => a.kind === "resolve_pending_enter_field_placement"
    );
    expect(placement).toBeDefined();
    after = apply(after, placement!, {
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    });
    expect(oracles(after)).toHaveLength(1);
    expect(oracles(after)[0]!.mechanic).toMatchObject({
      triggerKind: "summon",
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "oracle-target")!.zone
    ).toBe("field");
  });
  for (const invalid of [undefined, [], null, "summon"]) {
    it(`旧/不正入力 ${JSON.stringify(invalid)} は全イベントでfail-closed`, () => {
      const before = seed();
      const broken = {
        ...lookup("BSTH03-X02")!,
        grandwalkerData: {
          ...lookup("BSTH03-X02")!.grandwalkerData!,
          oracleTriggerKinds: invalid,
        },
      } as unknown as CardDefinition;
      const definitions = (id: string) =>
        id === broken.cardNo ? broken : lookup(id);
      for (const event of [
        "summon",
        "advent",
        "place",
        "use_magic",
        "use_accel",
      ] as OracleTriggerKind[]) {
        expect(
          wouldQueueOracleChoices(before, "oracle-target", event, definitions)
        ).toBe(false);
        expect(
          oracles(
            checkAndQueueOracleChoices(
              before,
              "oracle-target",
              event,
              definitions,
              "test:missing"
            )
          )
        ).toHaveLength(0);
      }
    });
  }
});
