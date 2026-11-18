import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import {
  getEffectiveLevel,
  getEffectiveSymbols,
} from "../src/battle/battle-shared";
import { recomputeAndRebuildContinuousEffects } from "../src/effect/continuous-effect-rebuild";
import {
  buildTriggeredEffectLookup,
  generateFieldCardEffectRegistrations,
} from "../src/effect/structured-effect-registrations";
import { queueBattleEndTriggers } from "../src/effect/trigger-system";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import type { CardDefinition, GameState } from "../src/model";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const getDef = (id: string) => definitions.get(id);
const lookup = buildTriggeredEffectLookup(ALL_CARDS);
const options = {
  getCardDefinitionById: getDef,
  getRegisteredTriggeredEffectActions: lookup,
  getRegisteredFieldCardEffectActions: (id: string) =>
    getDef(id) ? generateFieldCardEffectRegistrations(getDef(id)!) : [],
  getRegisteredBurstActions: () => [],
};

function instance(
  cardNo: string,
  instanceId: string,
  cores = 0,
  owner = "alice"
) {
  return createCardInstance(getDef(cardNo)!, {
    instanceId,
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: cores,
  });
}
function stateWith(cardNo: string, cores: number): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: 4 }, {}],
      cardInstances: [instance(cardNo, "domain", cores)],
    }),
    step: "attack",
    activePlayerId: "alice",
    turnNumber: 3,
  };
}
function rebuild(state: GameState) {
  return recomputeAndRebuildContinuousEffects(state, getDef);
}

// 印字Lv2条件を持つ全領域。BSTH08の2枚はJSONミラーにLv欄がなく、画像を正源にする。
const thresholds = [
  ["BSAZ02-X04", 2],
  ["BSAZ02-X05", 3],
  ["BSTH003-X01", 1],
  ["BSTH003-X03", 1],
  ["BSTH03-X02", 5],
  ["BSTH04-X01", 4],
  ["BSTH04-XX01", 4],
  ["BSTH05-X01", 4],
  ["BSTH05-X02", 4],
  ["BSTH05.5-X02", 5],
  ["BSTH05.5-XX01", 8],
  ["BSTH06-X01", 3],
  ["BSTH07.8-XX01", 1],
  ["BSTH08-X01", 4],
  ["BSTH08-XX01", 4],
  ["BSTH08.5-X03", 1],
  ["BSTH09.2-X01", 4],
  ["BSTH09.2-XX01", 4],
  ["BSTH10-X01", 3],
  ["BSTH10-X03", 5],
  ["BSTH10-X04", 3],
  ["BSTH10.5-X01", 3],
  ["BSTH11-X01", 2],
] as const;

describe("神域・契約域・導域 原文監査", () => {
  it("見出しがある全カードを監査表がカバーする（諏訪子の画像上の神域も含む）", () => {
    const actual = ALL_CARDS.filter((c) =>
      c.textLines.some((line) => /【(?:神域|契約域|導域)/.test(line))
    )
      .map((c) => c.cardNo)
      .sort();
    expect(actual).toEqual(
      [
        ...thresholds.map(([no]) => no),
        "BSTH02.7-CX01",
        "BSES01-CX01",
        "BSTH02-X01",
        "BSTH05-M11",
      ].sort()
    );
  });
  it.each(thresholds)("%s はコア%dでLv2、直前はLv1", (cardNo, threshold) => {
    const low = stateWith(cardNo, threshold - 1);
    const high = stateWith(cardNo, threshold);
    expect(
      getEffectiveLevel(low, low.cardInstances[0]!, getDef(cardNo)!, getDef)
    ).toBe(1);
    expect(
      getEffectiveLevel(high, high.cardInstances[0]!, getDef(cardNo)!, getDef)
    ).toBe(2);
  });

  it.each([
    ["BSTH02.7-CX01", 1],
    ["BSES01-CX01", 4],
  ] as const)(
    "%s のC%dは自分のカウントを参照し、上のコア数と相手カウントを参照しない",
    (cardNo, threshold) => {
      const check = (
        cores: number,
        ownCount: number,
        opponentCount: number
      ) => {
        const state = stateWith(cardNo, cores);
        state.players[0]!.countValue = ownCount;
        state.players[1]!.countValue = opponentCount;
        return getEffectiveLevel(
          state,
          state.cardInstances[0]!,
          getDef(cardNo)!,
          getDef
        );
      };
      expect(check(10, threshold - 1, 10)).toBe(1);
      expect(check(0, threshold, 0)).toBe(2);
      expect(check(10, threshold, 0)).toBe(2);
      expect(check(0, threshold - 1, 10)).toBe(1);
    }
  );

  it("アリスの契約域はC1成立・低下を追従し、コア支払い後も自分のターン中は導域のLv2コストを3にする", () => {
    const state = stateWith("BSTH02.7-CX01", 0);
    state.players[0]!.countValue = 0;
    state.cardInstances.push(instance("BSTH04-XX01", "guided", 3));
    const targetLevel = (s: GameState) => {
      const rebuilt = rebuild(s);
      return getEffectiveLevel(
        rebuilt,
        rebuilt.cardInstances.find((c) => c.instanceId === "guided")!,
        getDef("BSTH04-XX01")!,
        getDef
      );
    };
    expect(targetLevel(state)).toBe(1);
    state.players[0]!.countValue = 1;
    expect(targetLevel(state)).toBe(2);
    expect(targetLevel({ ...state, activePlayerId: "bob" })).toBe(1);
    state.players[0]!.countValue = 0;
    expect(targetLevel(state)).toBe(1);
  });

  it("Lv2契約技の候補も実効Lvを使い、C4未満ならコアが多くても宣言できない", () => {
    // C4のLv定義を使う基盤回帰。現行レーナの契約技自体はLv1-Lv2。
    const definition: CardDefinition = {
      ...getDef("BSES01-CX01")!,
      cardNo: "DOMAIN-AUDIT-LV2-SKILL",
      effects: [],
      grandwalkerData: {
        ...getDef("BSES01-CX01")!.grandwalkerData!,
        divineSkills: [
          {
            label: "contract_skill",
            coreCost: 0,
            timing: "main",
            minLevel: 2,
            effects: [
              {
                timing: { kind: "activated", mode: "main" },
                steps: [
                  {
                    action: {
                      kind: "count_increase",
                      player: "self",
                      amount: 1,
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    definitions.set(definition.cardNo, definition);
    const state: GameState = {
      ...stateWith(definition.cardNo, 10),
      step: "main",
      window: "none",
    };
    state.players[0]!.countValue = 3;
    const skills = (s: GameState) =>
      getLegalActions({ state: s, actingPlayerId: "alice", ...options }).filter(
        (a) => a.kind === "use_divine_skill"
      );
    expect(skills(state)).toHaveLength(0);
    const high: GameState = {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice" ? { ...p, countValue: 4 } : p
      ),
      cardInstances: state.cardInstances.map((c) => ({
        ...c,
        normalCoreCount: 0,
      })),
    };
    expect(skills(high)).toHaveLength(1);
  });

  it("神子: コア3→4→3、対象の後入り、ステップ・ターン・発揮元離脱で三シンボルを再評価する", () => {
    const target = instance("BSTH08-M01", "target", 1);
    let state = stateWith("BSTH08-XX01", 3);
    state.cardInstances.push(target);
    state = rebuild(state);
    const symbols = (s: GameState) =>
      getEffectiveSymbols(
        s,
        s.cardInstances.find((c) => c.instanceId === "target")!,
        getDef(target.definitionId)!,
        getDef
      );
    expect(symbols(state)).toEqual(["white"]);
    const setCores = (s: GameState, cores: number) =>
      rebuild({
        ...s,
        cardInstances: s.cardInstances.map((c) =>
          c.instanceId === "domain" ? { ...c, normalCoreCount: cores } : c
        ),
      });
    state = setCores(state, 4);
    expect(symbols(state)).toEqual(["white", "white", "white"]);
    expect(symbols(setCores(state, 3))).toEqual(["white"]);
    expect(symbols(rebuild({ ...state, activePlayerId: "bob" }))).toEqual([
      "white",
    ]);
    expect(symbols(rebuild({ ...state, step: "main" }))).toEqual(["white"]);
    expect(
      symbols(
        rebuild({
          ...state,
          cardInstances: state.cardInstances.map((c) =>
            c.instanceId === "domain"
              ? { ...c, zone: "trash" as const, normalCoreCount: 0 }
              : c
          ),
        })
      )
    ).toEqual(["white"]);
    const absent = rebuild({
      ...state,
      cardInstances: state.cardInstances.filter(
        (c) => c.instanceId !== "target"
      ),
    });
    expect(
      symbols(
        rebuild({ ...absent, cardInstances: [...absent.cardInstances, target] })
      )
    ).toEqual(["white", "white", "white"]);
  });

  it.each([
    ["BSAZ02-X04", 2, "attack"],
    ["BSAZ02-X05", 2, "attack"],
    ["BSTH003-X03", 1, "attack"],
    ["BSTH02.7-CX01", 1, "main"],
    ["BSTH04-XX01", 1, "attack"],
    ["BSTH05-X01", 2, "attack"],
    ["BSTH05.5-X02", 1, "attack"],
    ["BSTH07.8-XX01", 1, "attack"],
    ["BSTH08-X01", 1, "attack"],
    ["BSTH08-XX01", 2, "attack"],
    ["BSTH08.5-X03", 1, "attack"],
    ["BSTH09.2-XX01", 1, "attack"],
    ["BSTH11-X01", 2, "attack"],
    ["BSTH11-X01", 3, "attack"],
  ] as const)(
    "%s effects[%d] 常時領域は登録・Lv低下・再成立・離脱を追従する",
    (cardNo, effectIndex, step) => {
      const targetDef: CardDefinition = {
        ...getDef("BSTH08-M01")!,
        cardNo: "DOMAIN-AUDIT-CONTINUOUS-TARGET",
        effects: [],
        colors: ["red", "purple", "green", "white", "yellow", "blue"],
        tribe: "幻想・秘神・起幻・風神・アシハラ・妖精",
        cost: 7,
      };
      definitions.set(targetDef.cardNo, targetDef);
      let state = { ...stateWith(cardNo, 10), step };
      state.cardInstances.push(
        instance(targetDef.cardNo, "target", 1),
        instance(targetDef.cardNo, "opponent", 1, "bob"),
        instance("BSTH04-X01", "guided", 3),
        { ...instance("BSTH08.5-R11", "aside"), zone: "set_aside" },
        ...[0, 1, 2].map((i) => ({
          ...instance("BSTH08-C01", `trash-${i}`),
          zone: "trash" as const,
        }))
      );
      state.cardInstances.find(
        (c) => c.instanceId === "opponent"
      )!.exhaustState = "heavily_exhausted";
      // 隠岐奈の全フィールド系統条件は自身も含めて判定する。
      if (cardNo === "BSTH11-X01")
        state.cardInstances = state.cardInstances.filter(
          (c) => c.instanceId !== "guided"
        );
      const ces = (s: GameState) =>
        s.activeContinuousEffects.filter(
          (ce) =>
            ce.sourceInstanceId === "domain" &&
            ce.provenance?.effectIndex === effectIndex
        );
      state = rebuild(state);
      expect(ces(state).length).toBeGreaterThan(0);
      const effect = getDef(cardNo)!.effects![effectIndex]!;
      if (
        effect.condition?.some((c) => c.kind === "min_level") ||
        effect.applicability?.level
      ) {
        const low = rebuild({
          ...state,
          players: state.players.map((p) => ({ ...p, countValue: 0 })),
          cardInstances: state.cardInstances.map((c) =>
            c.instanceId === "domain" ? { ...c, normalCoreCount: 0 } : c
          ),
        });
        expect(ces(low)).toHaveLength(0);
        expect(
          ces(
            rebuild({
              ...low,
              players: state.players,
              cardInstances: low.cardInstances.map((c) =>
                c.instanceId === "domain" ? { ...c, normalCoreCount: 10 } : c
              ),
            })
          )
        ).not.toHaveLength(0);
      }
      const departed = rebuild({
        ...state,
        cardInstances: state.cardInstances.map((c) =>
          c.instanceId === "domain"
            ? { ...c, zone: "trash" as const, normalCoreCount: 0 }
            : c
        ),
      });
      expect(ces(departed)).toHaveLength(0);
    }
  );

  it.each(["BSTH05-X02", "BSTH09.2-X01"])(
    "%s のバトル終了時領域は自分アタックステップに限定する",
    (cardNo) => {
      const targetDef: CardDefinition = {
        ...getDef("BSTH01-C01")!,
        cardNo: "DOMAIN-AUDIT-TARGET",
        name: "監査用対象",
        tribe: "起幻・風神",
        cost: 5,
        colors: ["red"],
        effects: [],
      };
      definitions.set(targetDef.cardNo, targetDef);
      const target = instance(targetDef.cardNo, "target", 1);
      target.exhaustState = "exhausted";
      const queue = (
        step: GameState["step"],
        activePlayerId: string,
        actionKind: "attack" | "block" = "attack"
      ) => {
        const state = { ...stateWith(cardNo, 4), step, activePlayerId };
        state.cardInstances.push(target, {
          ...instance("BSTH01-C01", "opponent", 1, "bob"),
          exhaustState: "exhausted",
        });
        return queueBattleEndTriggers({
          state,
          participantInstanceIds: ["target", "opponent"],
          blockSideInstanceIds:
            actionKind === "attack" ? ["opponent"] : ["target"],
          attackId: "domain-audit-battle",
          ...options,
        });
      };
      for (const state of [queue("main", "alice"), queue("attack", "bob")]) {
        expect(
          getLegalActions({
            state,
            actingPlayerId: "alice",
            ...options,
          }).filter(
            (a) =>
              a.kind === "resolve_pending_triggered_effect" &&
              a.sourceInstanceId === "domain" &&
              !a.skipOnly
          )
        ).toHaveLength(0);
      }
      // 「自分のアタックステップ」は期間指定であり、参加側をアタッカーに限定しない。
      expect(
        getLegalActions({
          state: queue("attack", "alice", "block"),
          actingPlayerId: "alice",
          ...options,
        }).some(
          (a) =>
            a.kind === "resolve_pending_triggered_effect" &&
            a.sourceInstanceId === "domain" &&
            !a.skipOnly
        )
      ).toBe(true);
      let state = queue("attack", "alice");
      const before = state.players.find(
        (p) => p.id === "bob"
      )!.lifeNormalCoreCount;
      const action = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...options,
      }).find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === "domain" &&
          !a.skipOnly
      );
      expect(action).toBeDefined();
      state = applyLegalAction({
        state,
        action: action!,
        skipOptionalEffect: false,
        ...options,
      }).state;
      for (
        let i = 0;
        i < 10 && (state.stackWindow || state.preDeclarationStackWindow);
        i++
      ) {
        const pass = state.players
          .flatMap((p) =>
            getLegalActions({ state, actingPlayerId: p.id, ...options })
          )
          .find((a) => a.kind === "pass_stack");
        expect(pass).toBeDefined();
        state = applyLegalAction({ state, action: pass!, ...options }).state;
      }
      expect(
        state.cardInstances.find((c) => c.instanceId === "opponent")!
          .exhaustState
      ).toBe("exhausted");
      if (cardNo === "BSTH05-X02")
        expect(
          state.cardInstances.find((c) => c.instanceId === "target")!
            .exhaustState
        ).toBe("recovered");
      else
        expect(
          state.players.find((p) => p.id === "bob")!.lifeNormalCoreCount
        ).toBe(before - 1);
    }
  );

  it("契約域はブロックされたジャガーノートを戻し、相手ブロッカーを戻さない", () => {
    let state = stateWith("BSES01-CX01", 4);
    state.cardInstances.push(
      instance("BSES01-T01", "juggernaut", 1),
      instance("BSTH01-C01", "blocker", 1, "bob")
    );
    state = queueBattleEndTriggers({
      state,
      participantInstanceIds: ["juggernaut", "blocker"],
      blockSideInstanceIds: ["blocker"],
      attackId: "domain-contract-battle",
      ...options,
    });
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...options,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.sourceInstanceId === "domain" &&
        !a.skipOnly
    );
    expect(action).toBeDefined();
    state = applyLegalAction({
      state,
      action: action!,
      skipOptionalEffect: false,
      ...options,
    }).state;
    const pass = getLegalActions({
      state,
      actingPlayerId: "bob",
      ...options,
    }).find((a) => a.kind === "pass_stack");
    expect(pass).toBeDefined();
    state = applyLegalAction({ state, action: pass!, ...options }).state;
    expect(
      state.cardInstances.find((c) => c.instanceId === "domain")!
        .normalCoreCount
    ).toBe(2);
    expect(
      getEffectiveLevel(
        state,
        state.cardInstances.find((c) => c.instanceId === "domain")!,
        getDef("BSES01-CX01")!,
        getDef
      )
    ).toBe(2);
    expect(
      state.cardInstances.find((c) => c.instanceId === "juggernaut")!.zone
    ).toBe("removed_from_game");
    expect(
      state.cardInstances.find((c) => c.instanceId === "blocker")!.zone
    ).toBe("field");
  });
});
