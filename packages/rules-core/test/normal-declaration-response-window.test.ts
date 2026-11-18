import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildHandActivatedEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  rebuildContinuousEffectsFromField,
} from "../src";
import type { ActiveStack, CardInstance, GameState, LegalAction } from "../src";
import { openBurstActivationStackWindow } from "../src/legal/stack-window-openers";
import { adventFlashPosition } from "./advent-flash-position";

const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const byId = new Map(
  definitions.map((definition) => [definition.cardNo, definition])
);
const getDef = (id: string) => byId.get(id);
const lookups = {
  getCardDefinitionById: getDef,
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(definitions),
  getRegisteredBurstActions: buildBurstEffectLookup(definitions),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(definitions),
  getRegisteredHandActivatedEffectActions:
    buildHandActivatedEffectLookup(definitions),
  getRegisteredMagicActions: buildMagicLookup(definitions),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(definitions),
};

function card(no: string, id: string, zone: CardInstance["zone"], cores = 0) {
  return createCardInstance(getDef(no)!, {
    instanceId: id,
    ownerPlayerId: "alice",
    zone,
    normalCoreCount: cores,
  });
}

const burst = createCardInstance(getDef("BSTS01-R02")!, {
  instanceId: "burst",
  ownerPlayerId: "bob",
  zone: "burst",
});
const burstActivation: ActiveStack = {
  stackId: "stack:timing-test",
  chainId: "timing-test",
  actionKind: "burst_activation",
  actingPlayerId: "bob",
  cardInstanceId: burst.instanceId,
  cardDefinitionId: burst.definitionId,
  burstSourceKind: "spirit",
  targetInstanceIds: [],
  targetEffectFilterTags: [],
  previousPendingStackAction: null,
  previousResponseSourcePlayerId: null,
};

function setup(
  cards: CardInstance[],
  step: GameState["step"] = "main"
): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [...cards, burst],
      playerOverrides: [
        {
          countValue: 5,
          reserveNormalCoreCount: 20,
          reserveSoulCoreCount: 1,
          soulCoreLocation: { kind: "reserve" },
        },
        {},
      ],
    }),
    step,
    window: step === "start" ? "step_start" : "none",
  };
}

function burstResponse(state: GameState): GameState {
  return openBurstActivationStackWindow(state, burstActivation, "bob");
}

function battleResponse(
  state: GameState,
  kind: "before_block" | "after_block"
): GameState {
  const activeAttack = state.activeAttack!;
  return {
    ...state,
    window:
      kind === "before_block" ? "stack_before_block" : "stack_after_block",
    activeAttack: {
      ...activeAttack,
      flashWindowState: {
        ...activeAttack.flashWindowState!,
        kind,
        stackResponseSourcePlayerId: "bob",
        pendingStackAction: burstActivation,
      },
    },
  };
}

function actions(state: GameState, actingPlayerId = "alice") {
  return getLegalActions({ ...lookups, state, actingPlayerId });
}

function apply(state: GameState, action: LegalAction) {
  return applyLegalAction({ ...lookups, state, action }).state;
}

describe("通常宣言とスタック応答の窓", () => {
  it("自分のメイン中、相手のバーストへの応答に真バディの契約煌臨を出さない", () => {
    const main = setup([
      card("BSDB01-CX01", "host", "field", 1),
      card("BSDB01-C01", "goku", "hand"),
      card("BSDB01-C02", "vegeta", "hand"),
    ]);
    expect(
      actions(main).filter((action) => action.kind === "declare_advent")
    ).toEqual([
      expect.objectContaining({ sourceInstanceId: "goku" }),
      expect.objectContaining({ sourceInstanceId: "vegeta" }),
    ]);
    expect(actions(burstResponse(main)).map((action) => action.kind)).toEqual([
      "pass_stack",
    ]);
  });

  it.each([
    ["BSDB01-CX01", "BSDB01-X02"],
    ["BSSG01-M01", "BSSG01-M03"],
    ["BSSG01-M02", "BSSG01-M04"],
  ])("%s → %s は通常フラッシュでのみ煌臨できる", (host, incoming) => {
    const flash = adventFlashPosition(
      setup([
        card(host, "host", "field", 6),
        card(incoming, "incoming", "hand"),
      ])
    );
    expect(actions(flash)).toContainEqual(
      expect.objectContaining({
        kind: "declare_advent",
        sourceInstanceId: "incoming",
        candidateTargetInstanceIds: ["host"],
      })
    );
    for (const kind of ["before_block", "after_block"] as const) {
      expect(
        actions(battleResponse(flash, kind)).some(
          (action) => action.kind === "declare_advent"
        )
      ).toBe(false);
    }
  });

  it.each([
    ["BSSL01-M01", "hand", "main", "summon"],
    ["BSSG01-C08", "trash", "main", "place_nexus"],
    ["BSTH01-M01", "hand", "start", "summon"],
  ] as const)(
    "%s は指定ステップの通常行動としてだけ宣言できる",
    (no, zone, step, kind) => {
      const normal = setup([card(no, "source", zone)], step);
      const reason =
        kind === "summon"
          ? "legal_summon_by_hand_permission"
          : "legal_place_nexus_by_hand_permission";
      const matches = (action: LegalAction) =>
        action.kind === kind && action.reason === reason;
      expect(actions(normal).some(matches)).toBe(true);
      expect(actions(burstResponse(normal)).some(matches)).toBe(false);
    }
  );

  it("月面基地の召喚コスト置換は通常フラッシュで選べ、戦闘中と宣言前の応答には出ない", () => {
    const base = rebuildContinuousEffectsFromField(
      setup([
        card("BSAZ02-C08", "base", "field", 2),
        card("BSAZ02-C01", "breaker", "field", 1),
        card("BSAZ02-TX01(A)", "ultimate", "hand"),
      ]),
      getDef
    );
    const flash = adventFlashPosition(base);
    const preDeclaration: GameState = {
      ...flash,
      window: "pre_declaration_stack",
      activeAttack: null,
      preDeclarationStackWindow: {
        kind: "attack",
        actingPlayerId: "bob",
        priorityPlayerId: "alice",
        stackResponseSourcePlayerId: "bob",
        sourceInstanceId: "audit-attacker",
        previousWindow: "declare_attack",
        consecutivePassCount: 0,
        pendingStackAction: null,
      },
    };
    const summons = (state: GameState) =>
      actions(state).filter(
        (action) =>
          action.kind === "summon" && action.sourceInstanceId === "ultimate"
      );
    expect(summons(flash)).toHaveLength(1);
    expect(summons(battleResponse(flash, "before_block"))).toHaveLength(0);
    expect(summons(preDeclaration)).toHaveLength(0);
  });

  it("本文でスタックタイミングを指定された転醒を宣言して解決できる", () => {
    const drive = {
      ...card("BSAZ02-M01", "drive", "field"),
      attachedToInstanceId: "dioscuria",
    };
    const front: CardInstance = {
      ...card("BSAZ02-TX01(A)", "dioscuria", "field", 3),
      underCards: [
        {
          cardInstanceId: drive.instanceId,
          role: "text_role",
          roleTag: "アルドノアドライブ",
        },
      ],
    };
    const state = burstResponse(setup([front, drive]));
    const rebirth = actions(state).find(
      (action) =>
        action.kind === "use_field_card_effect" &&
        action.sourceInstanceId === front.instanceId &&
        action.timing === "stack"
    );
    expect(rebirth).toBeDefined();
    const declared = apply(state, rebirth!);
    expect(declared.stackWindow?.priorityPlayerId).toBe("bob");
    const pass = actions(declared, "bob").find(
      (action) => action.kind === "pass_stack"
    );
    const resolved = apply(declared, pass!);
    expect(
      resolved.cardInstances.find((c) => c.instanceId === front.instanceId)
        ?.definitionId
    ).toBe("BSAZ02-TX01(B)");
  });
});
