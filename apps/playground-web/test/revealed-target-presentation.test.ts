import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../../packages/card-data/src/generated-index";
import {
  applyLegalAction,
  getLegalActions,
  sanitizeStateForViewer,
  type GameState,
  type LegalAction,
} from "@orica/rules-core";
import { buildRevealedTargetSelectionScenario } from "../src/scenario-revealed-target-selection";
import {
  revealedCandidateCardIds,
  visibleRevealedCardIds,
  confirmedRevealedTargetIds,
} from "../src/utils/revealed-target-presentation";
import {
  isContinuousTargetDisclosure,
  isPublicDisclosureLoggable,
  publicDisclosureEffectText,
} from "../src/components/PublicDisclosurePanel";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const getCardDefinitionById = (id: string) => definitions.get(id);
const actions = (state: GameState, owner = "alice") =>
  getLegalActions({ state, actingPlayerId: owner, getCardDefinitionById });
const apply = (
  state: GameState,
  action: LegalAction,
  targetInstanceIds?: string[]
) =>
  applyLegalAction({
    state,
    action,
    ...(targetInstanceIds ? { targetInstanceIds } : {}),
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
  }).state;
const seed = (candidates = 2, owner = "alice", mode = "keya") =>
  buildRevealedTargetSelectionScenario(
    [...ALL_CARDS],
    new URLSearchParams({ candidates: String(candidates), owner, mode })
  );

describe("公開途中の対象選択と表示データ", () => {
  it("手札からの実BSRK01-M01/C01借用は配置待ちの間も選択済み発揮元だけを公開する", () => {
    const state = seed(2, "alice", "borrow-hand");
    expect(state.pendingMultiPlacement).not.toBeNull();
    expect(
      state.cardInstances.find((card) => card.instanceId === "borrow-donor")
        ?.zone
    ).toBe("hand");
    const observer = sanitizeStateForViewer(state, "bob");
    const event = observer.publicDisclosures.find((disclosure) =>
      disclosure.targets.some(
        (target) =>
          target.kind === "card" && target.definitionIdSnapshot === "BSRK01-C01"
      )
    );
    expect(event?.audience).toBe("both");
    expect(event?.targets).toEqual([
      expect.objectContaining({
        definitionIdSnapshot: "BSRK01-C01",
        actionLabel: "show_cards",
      }),
    ]);
    expect(
      observer.cardInstances.find((card) => card.instanceId === "borrow-donor")
        ?.definitionId
    ).toBe("_hidden_card_");
    expect(JSON.stringify(observer)).not.toContain("BSTH11-X03");
    expect(
      observer.publicDisclosures.flatMap((event) => event.targets)
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ instanceId: "borrow-private-hand" }),
      ])
    );
  });
  for (const owner of ["alice", "bob"])
    for (const candidates of [1, 2]) {
      it(`${owner}/${candidates}候補: 全公開カードを確認し、対象→配置の確定後に残札を戻す`, () => {
        let state = seed(candidates, owner);
        const before = JSON.stringify(state);
        expect(state.pendingStepOptionalTargetSelection).not.toBeNull();
        expect(state.pendingDeckReveal).toBeNull();
        for (const viewer of ["alice", "bob"]) {
          const display = sanitizeStateForViewer(state, viewer);
          expect(visibleRevealedCardIds(display)).toEqual([
            "reveal-card-0",
            "reveal-card-1",
          ]);
          const other = viewer === "alice" ? "bob" : "alice";
          expect(
            display.cardInstances.find(
              (card) => card.instanceId === `${other}-private-hand`
            )?.definitionId
          ).toBe("_hidden_card_");
          const payload = JSON.stringify(display);
          for (const internal of [
            "priorStateSnapshot",
            "stateSnapshot",
            "resolutionSegmentBeforeState",
            "pendingConditionalCostRollback",
          ])
            expect(payload).not.toContain(internal);
          expect(payload).not.toContain(
            other === "alice" ? "BSTH11-X03" : "BSTH11-X04"
          );
          if (viewer !== owner)
            expect(display.pendingStepOptionalTargetSelection).toBeNull();
        }
        expect(JSON.stringify(state)).toBe(before);
        expect(before).toContain("priorStateSnapshot");
        const target = actions(state, owner).find(
          (action) =>
            action.kind === "resolve_pending_step_optional_target_selection"
        )!;
        expect(
          "candidateTargetInstanceIds" in target &&
            revealedCandidateCardIds(
              sanitizeStateForViewer(state, owner),
              target.candidateTargetInstanceIds
            )
        ).toEqual(["reveal-card-0", "reveal-card-1"]);
        expect(state.quartzSetStates).toHaveLength(0);
        expect(
          confirmedRevealedTargetIds(sanitizeStateForViewer(state, owner))
        ).toEqual([]);
        state = apply(state, target, ["reveal-card-0"]);
        expect(state.pendingStepChoice?.continuation.targetInstanceIds).toEqual(
          ["reveal-card-0"]
        );
        expect(state.quartzSetStates).toHaveLength(0);
        const observer = sanitizeStateForViewer(
          state,
          owner === "alice" ? "bob" : "alice"
        );
        expect(confirmedRevealedTargetIds(observer)).toEqual(["reveal-card-0"]);
        const declaration = observer.publicDisclosures.find(
          (entry) => entry.kind === "target_declared"
        )!;
        expect(declaration.source?.definitionPath).toEqual([
          "grandwalkerData",
          "divineSkills",
          0,
          "effects",
        ]);
        expect(
          isContinuousTargetDisclosure(
            declaration,
            observer,
            getCardDefinitionById
          )
        ).toBe(false);
        expect(
          isPublicDisclosureLoggable(
            declaration,
            observer,
            getCardDefinitionById
          )
        ).toBe(true);
        expect(
          publicDisclosureEffectText(
            declaration,
            observer,
            getCardDefinitionById
          )
        ).toContain("クォーツ効果");
        expect(
          JSON.stringify(sanitizeStateForViewer(state, owner))
        ).not.toContain("priorStateSnapshot");
        const placement = actions(state, owner).find(
          (action) =>
            action.kind === "resolve_pending_step_choice" &&
            action.choiceLabel.includes("右")
        )!;
        state = apply(state, placement);
        expect(state.quartzSetStates).toEqual([
          expect.objectContaining({
            quartzInstanceId: "reveal-card-0",
            hostInstanceId: "reveal-host",
            slot: "right",
          }),
        ]);
        expect(
          state.cardInstances.find(
            (card) => card.instanceId === "reveal-card-1"
          )?.zone
        ).toBe("deck");
        expect(visibleRevealedCardIds(state)).toEqual([]);
        expect(state.pendingDeckReveal).toBeNull();
      });
    }

  it("候補なしは不発として残札の順番選択へ進む", () => {
    const state = seed(0);
    expect(state.pendingStepOptionalTargetSelection).toBeNull();
    expect(state.pendingStepChoice).toBeNull();
    expect(state.quartzSetStates).toEqual([]);
    expect(state.pendingDeckReveal?.phase).toBe("ordering_remainder");
    expect(visibleRevealedCardIds(state)).toHaveLength(2);
  });

  it("公開確定印は最新オープン以後の現に見えるカードだけで、履歴・欠落epochから復元しない", () => {
    let state = seed();
    state = apply(
      state,
      actions(state).find(
        (action) =>
          action.kind === "resolve_pending_step_optional_target_selection"
      )!,
      ["reveal-card-0"]
    );
    const visible = sanitizeStateForViewer(state, "bob");
    expect(confirmedRevealedTargetIds(visible)).toEqual(["reveal-card-0"]);
    const open = visible.publicDisclosures.find(
      (entry) => entry.kind === "deck_revealed"
    )!;
    const declaration = visible.publicDisclosures.find(
      (entry) => entry.kind === "target_declared"
    )!;
    expect(
      confirmedRevealedTargetIds({
        ...visible,
        publicDisclosures: [declaration],
      })
    ).toEqual([]);
    expect(
      confirmedRevealedTargetIds({
        ...visible,
        publicDisclosures: [
          ...visible.publicDisclosures,
          { ...open, sequence: declaration.sequence + 1 },
        ],
      })
    ).toEqual([]);
    expect(
      confirmedRevealedTargetIds({
        ...visible,
        publicDisclosures: [open, { ...declaration, sequence: Number.NaN }],
      })
    ).toEqual([]);
    expect(
      confirmedRevealedTargetIds({
        ...visible,
        publicDisclosures: [
          open,
          { ...declaration, sequence: 99 },
          { ...open, sequence: 2, targets: [] },
        ],
      })
    ).toEqual([]);
    expect(
      confirmedRevealedTargetIds({
        ...visible,
        cardInstances: visible.cardInstances.map((card) =>
          card.instanceId === "reveal-card-0"
            ? { ...card, definitionId: "_hidden_card_" }
            : card
        ),
      })
    ).toEqual([]);
    expect(
      confirmedRevealedTargetIds({
        ...visible,
        cardInstances: visible.cardInstances.map((card) =>
          card.instanceId === "reveal-card-0"
            ? { ...card, zone: "deck" as const }
            : card
        ),
      })
    ).toEqual([]);
    expect(
      isContinuousTargetDisclosure(
        {
          ...declaration,
          source: { ...declaration.source, definitionPath: null },
        },
        visible,
        getCardDefinitionById
      )
    ).toBe(false);
    expect(
      isContinuousTargetDisclosure(
        {
          ...declaration,
          source: { ...declaration.source, definitionPath: undefined },
        },
        visible,
        getCardDefinitionById
      )
    ).toBe(true);
  });

  it("混在ゾーン、非公開カード、候補なしは公開カード専用UIに誤配線しない", () => {
    const state = seed(1);
    expect(
      revealedCandidateCardIds(state, ["reveal-card-0", "reveal-host"])
    ).toBeNull();
    expect(revealedCandidateCardIds(state, [])).toBeNull();
    const privateState = {
      ...state,
      cardInstances: state.cardInstances.map((card) =>
        card.zone === "revealed"
          ? { ...card, revealedTo: "self" as const }
          : card
      ),
    };
    expect(
      visibleRevealedCardIds(sanitizeStateForViewer(privateState, "bob"))
    ).toEqual([]);
    expect(
      revealedCandidateCardIds(sanitizeStateForViewer(privateState, "bob"), [
        "reveal-card-0",
      ])
    ).toBeNull();
    expect(
      visibleRevealedCardIds(sanitizeStateForViewer(privateState, "alice"))
    ).toHaveLength(2);
    const completed = {
      ...state,
      cardInstances: state.cardInstances.map((card) =>
        card.zone === "revealed" ? { ...card, zone: "deck" as const } : card
      ),
    };
    expect(
      visibleRevealedCardIds(sanitizeStateForViewer(completed, "bob"))
    ).toEqual([]);
  });

  for (const mode of ["chen", "rinnosuke"]) {
    it(`${mode}: 実カードの公開中の分岐と継続データも安全に表示する`, () => {
      const state = seed(2, "alice", mode);
      expect(visibleRevealedCardIds(state)).toHaveLength(
        mode === "chen" ? 4 : 5
      );
      expect(state.pendingStepChoice).not.toBeNull();
      const display = sanitizeStateForViewer(state, "alice");
      expect(
        display.pendingStepChoice?.continuation.resumeEffectOverride
      ).toBeDefined();
      expect(JSON.stringify(display)).not.toContain("priorStateSnapshot");
      expect(JSON.stringify(display)).not.toContain("BSTH11-X04");
    });
  }
});
