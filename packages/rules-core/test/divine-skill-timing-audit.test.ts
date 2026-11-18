import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { getAvailableDivineSkillLegalActions } from "../src/legal/legal-actions-availability";
import { deriveDivineSkillSuppressionEffectDescriptor } from "../src/legal/divine-skill-usage";
import { getLegalActions } from "../src/legal/legal-actions";
import {
  buildHandActivatedEffectLookup,
  buildFieldCardEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { createCardInstance } from "../src/factories";
import type { GameState } from "../src/model";
import {
  divineTimingCard,
  divineSkillTimingPosition,
  divineSkillFlashPosition,
} from "./divine-skill-timing-position";

// 原文の神技/導技/界放/契約技/転神/転者見出しから期待値を作る。
// 定義のtiming値を期待値に流用しない。契約技3/4は同じ見出しの2エントリ。
const skills = ALL_CARDS.flatMap((card) => {
  const headers = card.textLines.filter((line) =>
    /【(?:神技|導技|界放|契約技|転神|転者)[：:】]/u.test(line)
  );
  return (card.grandwalkerData?.divineSkills ?? []).map((skill, index) => ({
    card,
    skill,
    index,
    header: headers.length === 1 ? headers[0]! : headers[index]!,
  }));
});

const available = (state: GameState, index: number) =>
  getAvailableDivineSkillLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: divineTimingCard,
  }).some((action) => action.skillIndex === index);

describe("神技系全件: 印字タイミングと窓・優先権を独立に検査", () => {
  it("監査対象に全28エントリを含む", () => {
    expect(skills).toHaveLength(28);
    expect(skills.every(({ header }) => !!header)).toBe(true);
  });

  it("神技系のフラッシュ見出しを全カードから逆引きし、別経路の界放も列挙する", () => {
    expect(
      ALL_CARDS.filter(
        (card) =>
          card.textLines.some(
            (line) =>
              /【(?:神技|導技|界放|契約技|転神|転者)[：:】]/u.test(line) &&
              line.includes("フラッシュ")
          ) && !card.grandwalkerData?.divineSkills?.length
      ).map((card) => card.cardNo)
    ).toEqual(["BSTH07.8-X01"]);
  });

  it("手札の界放もアタック未宣言・優先権なしでは候補外、前後半フラッシュで使用可", () => {
    const state = divineSkillTimingPosition();
    state.cardInstances.push(
      createCardInstance(divineTimingCard("BSTH07.8-X01"), {
        instanceId: "hand-release",
        ownerPlayerId: "alice",
        zone: "hand",
      })
    );
    state.players[0]!.reserveNormalCoreCount = 10;
    state.players[0]!.handCount = 1;
    const lookup = buildHandActivatedEffectLookup(ALL_CARDS);
    const fieldLookup = buildFieldCardEffectLookup(ALL_CARDS);
    const canRelease = (position: GameState) =>
      getLegalActions({
        state: position,
        actingPlayerId: "alice",
        getCardDefinitionById: divineTimingCard,
        getRegisteredHandActivatedEffectActions: lookup,
        getRegisteredFieldCardEffectActions: fieldLookup,
      }).some(
        (action) =>
          action.kind === "use_hand_card_effect" &&
          action.sourceInstanceId === "hand-release"
      );
    expect(canRelease(state)).toBe(false);
    for (const after of [false, true]) {
      const flash = divineSkillFlashPosition(state, "alice", after);
      expect(canRelease(flash)).toBe(true);
      flash.activeAttack!.flashWindowState!.priorityPlayerId = "bob";
      expect(canRelease(flash)).toBe(false);
    }
    state.step = "main";
    state.window = "main";
    expect(canRelease(state)).toBe(false);
  });

  for (const { card, skill, index, header } of skills) {
    describe(`${card.cardNo}[${index}] ${header}`, () => {
      for (const active of ["alice", "bob"]) {
        const own = active === "alice";
        const flash = header.includes("フラッシュ");
        const attackOnly = header.includes("アタックステップ");
        const end = header.includes("終了時");
        const ownerMatches = header.includes("自分の")
          ? own
          : header.includes("相手の")
            ? !own
            : true;

        const seed = () => {
          const state = divineSkillTimingPosition(card.cardNo);
          state.activePlayerId = active;
          state.cardInstances[0]!.normalCoreCount = 20;
          return state;
        };

        it(`${active}のメイン/アタック未宣言/終了時`, () => {
          const state = seed();
          expect(available(state, index)).toBe(false);
          state.window = "step_end";
          expect(available(state, index)).toBe(end && ownerMatches);
          state.step = "main";
          state.window = "main";
          expect(available(state, index)).toBe(own && !attackOnly);
        });

        for (const after of [false, true]) {
          it(`${active}の${after ? "後半" : "前半"}フラッシュ: 優先権と期間`, () => {
            const state = divineSkillFlashPosition(seed(), "alice", after);
            expect(available(state, index)).toBe(flash && ownerMatches);
            state.activeAttack!.flashWindowState!.priorityPlayerId = "bob";
            expect(available(state, index)).toBe(false);
          });
        }
      }

      it("通常/宣言前/バトル内スタックは明記された技だけ", () => {
        const state = divineSkillTimingPosition(card.cardNo);
        state.cardInstances[0]!.normalCoreCount = 20;
        state.activePlayerId = "bob";
        const response = {
          priorityPlayerId: "alice",
          consecutivePassCount: 0,
          actingPlayerId: "bob",
          stackResponseSourcePlayerId: "bob",
          pendingStackAction: {
            stackId: "test-stack",
            chainId: "test-chain",
            actionKind: "magic" as const,
            actingPlayerId: "bob",
            cardInstanceId: "timing-target",
            cardDefinitionId: "BSDB01-C05",
            targetInstanceIds: [],
            targetEffectFilterTags: [],
            previousResponseSourcePlayerId: null,
            previousPendingStackAction: null,
          },
        };
        state.window = "stack";
        state.stackWindow = {
          ...response,
          previousWindow: "none",
          subStackEverOpened: false,
          burstWindowKind: null,
        };
        expect(available(state, index)).toBe(header.includes("スタック"));
        state.stackWindow.priorityPlayerId = "bob";
        expect(available(state, index)).toBe(false);
        state.stackWindow = null;
        const battle = divineSkillFlashPosition(state, "alice");
        battle.window = "stack_before_block";
        Object.assign(battle.activeAttack!.flashWindowState!, response);
        expect(available(battle, index)).toBe(header.includes("スタック"));
        state.window = "pre_declaration_stack";
        state.preDeclarationStackWindow = {
          ...response,
          kind: "attack",
          sourceInstanceId: "timing-target",
          previousWindow: "declare_attack",
        };
        expect(available(state, index)).toBe(header.includes("スタック"));
      });

      if (header.includes("フラッシュ") && !header.includes("スタック")) {
        it("抑止・宣言時の効果記述もフラッシュとして扱う", () => {
          expect(
            deriveDivineSkillSuppressionEffectDescriptor({
              sourceDefinitionId: card.cardNo,
              sourceKind: "nexus",
              effectIndex: index,
              label: skill.label,
              timing: skill.timing,
              effects: skill.effects,
            }).activatedMode
          ).toBe("flash");
        });
      }
    });
  }

  it("添付再現: bobのアタック未宣言ではBSTH04-X01の公開アクションが出ない", () => {
    const state = divineSkillTimingPosition("BSTH04-X01", "bob");
    expect(
      getLegalActions({
        state,
        actingPlayerId: "bob",
        getCardDefinitionById: divineTimingCard,
      }).filter((action) => action.kind === "use_divine_skill")
    ).toEqual([]);
  });
});
