import { recomputeAndRebuildBattleStateContinuousEffects } from "../src/effect/continuous-effect-rebuild";
import { acceptOptionalSteps } from "./crossover-fidelity-test-helpers";
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { buildSelfAttackFlashScenario } from "../../../apps/playground-web/src/scenario-self-attack-flash";
import {
  expandCardDefinitionsWithBackFaces,
  generateFieldCardEffectRegistrations,
  generateTriggeredEffectRegistrations,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  getLegalActions,
  applyLegalAction,
  type GameState,
  type Condition,
} from "../src";
const defs = expandCardDefinitionsWithBackFaces(ALL_CARDS);
// 本文中の引用・付与効果は含めず、本人限定の起動見出しそのものを全カード/裏面から抽出する。
const cases = defs.flatMap((card) =>
  card.textLines.flatMap((line, lineIndex) => {
    const match = line
      .replace(/\s/g, "")
      .match(
        /^[^。、“”「」]*?(フラッシュ|スタック)『この[^』]+の(アタック\/ブロック|アタック|ブロック|バトル)時』$/
      );
    return match
      ? [
          {
            card,
            lineIndex,
            mode: match[1] === "フラッシュ" ? "flash" : "stack",
            phase: match[2],
          },
        ]
      : [];
  })
);
const lookups = {
  getCardDefinitionById: (id: string) => defs.find((d) => d.cardNo === id),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(defs),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(defs),
  getRegisteredBurstActions: buildBurstEffectLookup(defs),
};
function effectIndex(card: (typeof defs)[number], lineIndex: number) {
  return card.effects?.findIndex((e) => e.textRef?.includes(lineIndex)) ?? -1;
}
function matchingActions(
  state: GameState,
  card: (typeof defs)[number],
  index: number,
  owner = "alice"
) {
  const regs = generateFieldCardEffectRegistrations(card);
  return getLegalActions({ state, actingPlayerId: owner, ...lookups }).filter(
    (a) =>
      a.can &&
      a.kind === "use_field_card_effect" &&
      a.sourceInstanceId === "self-flash-host" &&
      a.sourceCardNo === card.cardNo &&
      regs[a.registrationIndex]?.effectIndex === index
  );
}
it("全カードの本人限定フラッシュ/スタック見出しを監査対象にする", () => {
  expect(cases.length).toBeGreaterThanOrEqual(7);
});
for (const { card, lineIndex, mode, phase } of cases)
  describe(`${card.cardNo} 本人限定の${phase}時${mode}`, () => {
    const index = effectIndex(card, lineIndex);
    it("誘発効果ではなく本文の起動タイミングで登録する", () => {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(card.effects![index]!.timing).toEqual({ kind: "activated", mode });
      expect(
        generateTriggeredEffectRegistrations(card).some(
          (r) => r.effectIndex === index
        )
      ).toBe(false);
    });
    for (const owner of ["alice", "bob"])
      for (const window of ["before", "after"])
        it.each(["idle", "attacking", "blocking"])(
          `${owner}/${window}: 参加状態=%s`,
          (role) => {
            const state = buildSelfAttackFlashScenario(
              ALL_CARDS,
              new URLSearchParams({ card: card.cardNo, owner, role, window })
            );
            const expected =
              phase === "アタック"
                ? role === "attacking"
                : phase === "ブロック"
                  ? role === "blocking" && window === "after"
                  : role !== "idle";
            expect(matchingActions(state, card, index, owner).length).toBe(
              expected ? 1 : 0
            );
          }
        );
  });
for (const cardNo of ["BSGE01-TX01(B)", "BSGE01-TX02(B)"])
  it(`${cardNo}: 非参加中の裏返しは使え、攻撃中の効果は合法手から解決できる`, () => {
    const card = defs.find((d) => d.cardNo === cardNo)!;
    const idle = buildSelfAttackFlashScenario(
      ALL_CARDS,
      new URLSearchParams({ card: cardNo })
    );
    expect(matchingActions(idle, card, 1)).toHaveLength(1);
    let state = buildSelfAttackFlashScenario(
      ALL_CARDS,
      new URLSearchParams({ card: cardNo, role: "attacking" })
    );
    const action = matchingActions(state, card, 2)[0];
    expect(action).toBeDefined();
    state = applyLegalAction({ state, action: action!, ...lookups }).state;
    const pass = getLegalActions({
      state,
      actingPlayerId: "bob",
      ...lookups,
    }).find((a) => a.can && a.kind === "pass_battle_flash")!;
    expect(pass).toBeDefined();
    state = applyLegalAction({ state, action: pass, ...lookups }).state;
    if (cardNo === "BSGE01-TX02(B)") {
      state = acceptOptionalSteps(state, lookups.getCardDefinitionById, {
        ...lookups,
        targetInstanceIds: ["self-flash-enemy"],
      });
    } else {
      const select = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...lookups,
      }).find((a) => a.can && a.kind === "resolve_pending_effect_target");
      expect(select).toBeDefined();
      state = applyLegalAction({
        state,
        action: select!,
        targetInstanceIds: ["self-flash-enemy"],
        ...lookups,
      }).state;
    }
    expect(state.players[0]!.countValue).toBe(2);
    if (cardNo === "BSGE01-TX01(B)")
      expect(
        state.cardInstances.find((c) => c.instanceId === "self-flash-enemy")
          ?.zone
      ).toBe("trash");
    else
      expect(
        state.cardInstances.find((c) => c.instanceId === "self-flash-enemy")
          ?.zone
      ).toBe("deck");
  });
for (const cardNo of ["BSSG01-M03", "BSSG01-M04", "BSSG01-X01"]) {
  it(`${cardNo}: アタック時フラッシュを宣言・解決すると回復し、同ターンは再使用できない`, () => {
    const card = defs.find((d) => d.cardNo === cardNo)!;
    let state = buildSelfAttackFlashScenario(
      ALL_CARDS,
      new URLSearchParams({ card: cardNo, role: "attacking" })
    );
    const action = matchingActions(state, card, 2)[0];
    expect(action).toBeDefined();
    state = applyLegalAction({ state, action: action!, ...lookups }).state;
    const pass = getLegalActions({
      state,
      actingPlayerId: "bob",
      ...lookups,
    }).find((a) => a.can && a.kind === "pass_battle_flash")!;
    expect(pass).toBeDefined();
    state = applyLegalAction({ state, action: pass, ...lookups }).state;
    if (cardNo !== "BSSG01-X01") {
      state = acceptOptionalSteps(state, lookups.getCardDefinitionById, {
        targetInstanceIds: [
          cardNo === "BSSG01-M03"
            ? "self-flash-grandwalker"
            : "self-flash-nexus",
        ],
        ...lookups,
      });
    }
    expect(
      state.cardInstances.find((c) => c.instanceId === "self-flash-host")
        ?.exhaustState
    ).toBe("recovered");
    expect(matchingActions(state, card, 2)).toHaveLength(0);
  });
}
it.each(["self_state", "in_battle", "any_of"])(
  "BSTH05.5-M01: 本人限定CEはアタック参加・終了で再評価する (%s)",
  (kind) => {
    const original = ALL_CARDS.find((d) => d.cardNo === "BSTH05.5-M01")!;
    const condition: Condition =
      kind === "in_battle"
        ? [{ kind: "in_battle", state: "attacking" }]
        : kind === "any_of"
          ? [{ kind: "any_of", groups: [original.effects![1]!.condition!] }]
          : original.effects![1]!.condition!;
    const cards = ALL_CARDS.map((d) =>
      d === original
        ? {
            ...d,
            effects: d.effects!.map((e, i) =>
              i === 1 ? { ...e, condition } : e
            ),
          }
        : d
    );
    const definitions = expandCardDefinitionsWithBackFaces(cards);
    const lookup = (id: string) => definitions.find((d) => d.cardNo === id);
    const hasGrant = (state: GameState) =>
      state.activeContinuousEffects.some(
        (ce) => ce.modifierTag === "effect_source_prevention_immunity"
      );
    let state = buildSelfAttackFlashScenario(
      cards,
      new URLSearchParams({ card: "BSTH05.5-M01", role: "idle" })
    );
    state = recomputeAndRebuildBattleStateContinuousEffects(state, lookup);
    expect(hasGrant(state)).toBe(false);
    const attacking = buildSelfAttackFlashScenario(
      cards,
      new URLSearchParams({ card: "BSTH05.5-M01", role: "attacking" })
    );
    state = recomputeAndRebuildBattleStateContinuousEffects(
      { ...attacking, activeContinuousEffects: state.activeContinuousEffects },
      lookup
    );
    expect(hasGrant(state)).toBe(true);
    const next = buildSelfAttackFlashScenario(
      cards,
      new URLSearchParams({ card: "BSTH05.5-M01", role: "idle" })
    );
    state = recomputeAndRebuildBattleStateContinuousEffects(
      { ...next, activeContinuousEffects: state.activeContinuousEffects },
      lookup
    );
    expect(hasGrant(state)).toBe(false);
  }
);
it("本人限定アタック/ブロック見出しの全効果で、カード本人イベントか本人の参加条件を持つ", () => {
  const hasSelfBattle = (condition: Condition): boolean =>
    condition.some(
      (c) =>
        c.kind === "in_battle" ||
        (c.kind === "self_state" && c.battleState !== undefined) ||
        (c.kind === "any_of" && c.groups.every(hasSelfBattle))
    );
  const personal = defs.flatMap((card) =>
    (card.effects ?? []).flatMap((effect, index) => {
      const matches = effect.textRef?.some((n) =>
        /^[^。、“”「」]*『この[^』]+の[^』]*(?:アタック|ブロック|バトル)[^』]*時』$/.test(
          card.textLines[n] ?? ""
        )
      );
      return matches ? [{ card, effect, index }] : [];
    })
  );
  // C01/C02等の同一見出しを複数effectsに分割しない。取得漏れはカード数でも検知する。
  expect(personal.length).toBeGreaterThan(250);
  expect(new Set(personal.map(({ card }) => card.cardNo)).size).toBeGreaterThan(
    200
  );
  expect(
    personal
      .filter(
        ({ effect }) =>
          effect.timing.kind !== "card_event" &&
          !hasSelfBattle(effect.condition ?? [])
      )
      .map(({ card, index }) => `${card.cardNo}[${index}]`)
  ).toEqual([]);
});
