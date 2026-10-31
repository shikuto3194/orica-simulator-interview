import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  getEffectiveCategory,
  getLegalActions,
  sanitizeStateForViewer,
} from "@orica/rules-core";
import { fieldCardDisplayKind } from "../src/utils/field-card-display";
import {
  cloneEffects,
  createClonePlacement,
  getCloneDefinition,
  getCloneTriggeredEffects,
} from "./fixtures/clone-placement";

describe("分身効果の表示行", () => {
  it("現在の分身生成4種をすべて検査対象にする", () => {
    expect(cloneEffects.map((e) => e.definition.cardNo).sort()).toEqual([
      "BSAZ01-C12",
      "BSAZ02-C07",
      "BSAZ02-X03",
      "BSTH01-X04",
    ]);
  });

  for (const owner of ["alice", "bob"]) {
    it.each(cloneEffects)(
      "$definition.cardNo: " + owner + " の配置待ちと生成後を同じ列へ置く",
      ({ definition }) => {
        let state = createClonePlacement(definition.cardNo, owner);
        const clones = state.cardInstances.filter(
          (c) => c.faceDown && c.zone === "field"
        );
        expect(clones.length).toBeGreaterThan(0);
        const pending = state.pendingCoreDistribution;
        for (const clone of clones) {
          const view = sanitizeStateForViewer(state, owner);
          expect(fieldCardDisplayKind(view, clone, getCloneDefinition)).toBe(
            "spirit"
          );
          if (pending) {
            expect(
              getEffectiveCategory(
                state,
                clone,
                getCloneDefinition(clone.definitionId)!
              )
            ).toBeUndefined();
            expect(
              fieldCardDisplayKind(
                { ...view, pendingCoreDistribution: null },
                clone,
                getCloneDefinition
              )
            ).toBe("card");
            // 配分候補だけでは分身予定と決めず、再開先の対象も照合する。
            const unrelated = structuredClone(view);
            unrelated.pendingCoreDistribution!.continuation!.stepContext.results =
              {};
            expect(
              fieldCardDisplayKind(unrelated, clone, getCloneDefinition)
            ).toBe("card");
          }
        }
        if (pending) {
          const action = getLegalActions({
            state,
            actingPlayerId: owner,
            getCardDefinitionById: getCloneDefinition,
          }).find((a) => a.kind === "resolve_pending_core_distribution")!;
          state = applyLegalAction({
            state,
            action,
            coreDistributionAllocations: Object.fromEntries(
              clones.map((c) => [c.instanceId, 1])
            ),
            coreDistributionSourceAllocations: { reserve: clones.length },
            getCardDefinitionById: getCloneDefinition,
            getRegisteredTriggeredEffectActions: getCloneTriggeredEffects,
          }).state;
        }
        expect(state.pendingCoreDistribution).toBeNull();
        for (const viewer of ["alice", "bob"]) {
          const view = sanitizeStateForViewer(state, viewer);
          for (const clone of clones) {
            const resolved = view.cardInstances.find(
              (c) => c.instanceId === clone.instanceId
            )!;
            expect(resolved.zone).toBe("field");
            expect(resolved.normalCoreCount).toBe(1);
            expect(
              fieldCardDisplayKind(view, resolved, getCloneDefinition)
            ).toBe("spirit");
          }
        }
      }
    );
  }
});
