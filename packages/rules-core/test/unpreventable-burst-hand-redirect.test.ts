/**
 * 「防げない」バースト効果 × 手札割込の対象変更 (BSDB01-M02 ピッコロ)。
 * 公式 Q1482 / Q8140: 「防げない」効果も【影武者】等で対象変更できる。
 * 変更後の対象は元効果を（防げない効果として）受ける。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBurstEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, GameState, LegalAction } from "../src";

const defs = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const real = defs.get("BSTH05-M02")!;
const plain: CardDefinition = {
  ...real,
  cardNo: "TEST-BSTH05-M02-PLAIN",
  effects: real.effects!.map((e) => {
    const { preventionRestriction: _r, ...rest } = e as typeof e & {
      preventionRestriction?: unknown;
    };
    return rest as typeof e;
  }),
};

defs.set(plain.cardNo, plain);
const allDefs = [...ALL_CARDS, plain];
const getDef = (id: string) => defs.get(id);
const lookups = {
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(allDefs),
  getRegisteredBurstActions: buildBurstEffectLookup(allDefs),
  getRegisteredFieldCardEffectActions: () => [],
};
const ALICE = "alice";
const BOB = "bob";

const vanilla: CardDefinition = {
  ...defs.get("BSTH05-M02")!,
  cardNo: "TEST-VANILLA",
  name: "vanilla",
  effects: [],
  keywordTags: [],
  textLines: [],
};
defs.set("TEST-VANILLA", vanilla);

function build(burstNo: string): GameState {
  const burst = defs.get(burstNo)!;
  const piccolo = defs.get("BSDB01-M02")!;
  const goku = defs.get("BSDB01-C01")!;
  const mk = (
    def: CardDefinition,
    instanceId: string,
    owner: string,
    zone: "hand" | "field" | "burst" | "trash",
    extra: object = {}
  ) =>
    createCardInstance(def, {
      instanceId,
      ownerPlayerId: owner,
      controllerPlayerId: owner,
      zone,
      ...extra,
    });
  return {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        mk(burst, "burst", ALICE, "burst"),
        mk(vanilla, "left-spirit", ALICE, "trash"),
        mk(piccolo, "piccolo", BOB, "hand"),
        mk(goku, "goku", BOB, "field", { normalCoreCount: 1 }),
        mk(vanilla, "other", BOB, "field", { normalCoreCount: 1 }),
        mk(vanilla, "deck-existing", BOB, "deck"),
      ],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 6 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 6 },
      ],
    }),
    turnNumber: 4,
    activePlayerId: BOB,
    step: "main",
    window: "none",
    setBurstStates: [{ playerId: ALICE, cardInstanceId: "burst" }],
    pendingBurstChecks: [
      {
        checkId: "leave-1",
        actingPlayerId: ALICE,
        eventKind: "leave_field",
        source: "action_resolution",
        chainId: "test:unprev",
        attackId: null,
        relatedPlayerId: ALICE,
        relatedInstanceId: "left-spirit",
        amount: 1,
        step: "main",
        window: "none",
        resolvedBurstCardInstanceIds: [],
        event: {
          family: "leave_field",
          validationMode: "snapshot_only",
          cause: "opponent_effect",
        },
      } as never,
    ],
  };
}

function all(state: GameState): LegalAction[] {
  return [BOB, ALICE].flatMap((who) =>
    getLegalActions({
      state,
      actingPlayerId: who,
      getCardDefinitionById: getDef,
      ...lookups,
    })
  );
}
function step(state: GameState, a: LegalAction, extra: object = {}): GameState {
  return applyLegalAction({
    state,
    action: a,
    getCardDefinitionById: getDef,
    ...lookups,
    ...extra,
  }).state;
}

function runScenario(burstDef: CardDefinition) {
  defs.set(burstDef.cardNo, burstDef);
  let s = build(burstDef.cardNo);
  s = step(
    s,
    all(s).find(
      (a) =>
        a.kind === "resolve_pending_burst_check" &&
        a.sourceInstanceId === "burst"
    )!
  );
  for (let i = 0; i < 6 && !s.pendingEffectTargetSelection; i++) {
    const a = all(s).find(
      (x) =>
        x.kind === "pass_stack" ||
        (x.kind === "resolve_pending_burst_check" &&
          x.sourceInstanceId === undefined)
    );
    if (!a) break;
    s = step(s, a);
  }
  expect(s.pendingEffectTargetSelection).not.toBeNull();
  const sel = all(s).find((a) => a.kind === "resolve_pending_effect_target")!;
  s = step(s, sel, { targetInstanceIds: ["goku", "other"] });
  for (let i = 0; i < 40; i++) {
    const acts = all(s);
    const pick =
      acts.find((a) => a.kind === "declare_private_triggered_effect") ??
      acts.find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          (a as { sourceInstanceId?: string }).sourceInstanceId === "piccolo"
      ) ??
      acts.find((a) => a.kind === "pass_stack") ??
      acts.find(
        (a) =>
          a.kind === "resolve_pending_step_choice" &&
          (a as { choiceIndex?: number }).choiceIndex === 0
      ) ??
      acts.find((a) => a.kind === "resolve_pending_multi_placement");
    if (!pick) break;
    s = step(
      s,
      pick,
      pick.kind === "resolve_pending_multi_placement" && s.pendingMultiPlacement
        ? {
            multiPlacementAllocations: s.pendingMultiPlacement.targets.map(
              (t) => ({
                destinationInstanceId: t.instanceId,
                placements: [
                  {
                    kind: "reserve_normal" as const,
                    amount: t.minimumCoreCount,
                  },
                ],
              })
            ),
          }
        : {}
    );
  }
  return s;
}

const zoneOf = (s: GameState, id: string) =>
  s.cardInstances.find((c) => c.instanceId === id)?.zone;

describe("防げないバースト × ピッコロ対象変更 (公式 Q1482/Q8140/Q14170)", () => {
  it.each([
    ["「超重装甲以外では防げない」(BSTH05-M02 実物)", real],
    ["防げない指定なし (対照)", plain],
  ] as const)("%s: 孫悟空は除去されず、対象はピッコロのみになる", (_l, def) => {
    const s = runScenario(def);
    // 対象変更が起きた (防げない効果でも対象変更は防がれない)
    expect(
      s.log.some((l) =>
        l.includes(
          "effect:redirect_target:targeted-disclosure:goku,other->piccolo"
        )
      )
    ).toBe(true);
    // 変更前の対象 (孫悟空 / 同時指定の他スピリット) は効果を受けない
    expect(zoneOf(s, "goku")).toBe("field");
    expect(zoneOf(s, "other")).toBe("field");
    // 変更後の対象ピッコロは「防げない」ため効果を受ける (手札へ戻る)
    expect(zoneOf(s, "piccolo")).toBe("hand");
    expect(s.log.some((l) => l.startsWith("effect:send_to_deck:goku"))).toBe(
      false
    );
  });
});
