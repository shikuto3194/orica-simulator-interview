import { ALL_CARDS } from "../../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../../src/factories";
import {
  buildTriggeredEffectLookup,
  expandCardDefinitionsWithBackFaces,
} from "../../src/effect/structured-effect-registrations";
import { collectAndQueueTriggerReactions } from "../../src/effect/trigger-system";
import type { GameState } from "../../src/model";

export const dioscuriaDefinitions =
  expandCardDefinitionsWithBackFaces(ALL_CARDS);
const definitions = new Map(dioscuriaDefinitions.map((d) => [d.cardNo, d]));
export const dioscuriaLookup = (id: string) => definitions.get(id);
export const dioscuriaTriggers =
  buildTriggeredEffectLookup(dioscuriaDefinitions);

/** 報告snapshotの転醒時効果直前。下へ加える3枚と、誤反応した導界者/手札3枚。 */
export function dioscuriaUnderCardState(owner = "alice"): GameState {
  const card = (
    no: string,
    id: string,
    zone: "field" | "hand" | "trash",
    cores = 0
  ) =>
    createCardInstance(definitions.get(no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      zone,
      normalCoreCount: cores,
    });
  const host = card("BSAZ02-TX01(B)", "dioscuria", "field", 5);
  const drives = [0, 1, 2].map((n) => ({
    ...card("BSAZ02-C10", `drive-${n}`, "field"),
    attachedToInstanceId: host.instanceId,
  }));
  host.underCards = drives.map((c) => ({
    cardInstanceId: c.instanceId,
    role: "text_role",
    roleTag: "アルドノアドライブ",
  }));
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        host,
        ...drives,
        card("BSAZ02-X05", "remrina", "field", 1),
        card("BSAZ02-TR01(A)", "heras", "hand"),
        card("BSAZ02-R01", "electris", "hand"),
        card("BSAZ02-C03", "siren", "trash"),
        ...[0, 1, 2].map((n) => card("BSAZ02-C10", `hand-drive-${n}`, "hand")),
      ],
    }),
    activePlayerId: owner,
    step: "main",
    turnNumber: 9,
  };
  const queued = collectAndQueueTriggerReactions({
    beforeState: {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === host.instanceId
          ? { ...c, definitionId: "BSAZ02-TX01(A)" }
          : c
      ),
    },
    afterState: state,
    source: "action_resolution",
    chainId: "dioscuria-rebirth",
    getCardDefinitionById: dioscuriaLookup,
    getRegisteredTriggeredEffectActions: dioscuriaTriggers,
    getRegisteredBurstActions: undefined,
  });
  // 転醒そのものへの手札ドライブの宣言は辞退済み。検証対象はその後の下カード追加。
  return { ...queued, pendingPrivateDeclarations: [] };
}
