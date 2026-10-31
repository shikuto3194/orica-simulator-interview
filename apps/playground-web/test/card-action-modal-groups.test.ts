import { describe, expect, it } from "vitest";
import type { CardDefinition, LegalAction } from "@orica/rules-core";
import { createCardInstance, createEmptyGameState } from "@orica/rules-core";
import {
  getFieldTapTargetIdsForCardClick,
  getSelectableFieldTapIds,
  groupCardActionsForModal,
} from "../src/utils/card-action-modal-groups";

const hostDef: CardDefinition = {
  cardNo: "TEST-HOST",
  name: "Host",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const braveDef: CardDefinition = {
  cardNo: "TEST-BRAVE",
  name: "Brave",
  printedCategory: "brave",
  colors: ["red"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

describe("card action modal groups", () => {
  it("exposes stacked contract effects from their host and combined brave without adding unrelated sources", () => {
    const create = (id: string) =>
      createCardInstance(hostDef, {
        instanceId: id,
        ownerPlayerId: "alice",
        zone: "field",
      });
    const host = create("host");
    host.underCards = [
      { cardInstanceId: "contract", role: "advent_source" },
      { cardInstanceId: "older-source", role: "advent_source" },
      { cardInstanceId: "text-under", role: "text_role", roleTag: "星霊衣" },
    ];
    const brave = createCardInstance(braveDef, {
      instanceId: "brave",
      ownerPlayerId: "alice",
      zone: "field",
      zoneRoleName: "brave",
    });
    brave.attachedToInstanceId = "host";
    host.attachedChildrenIds = ["brave"];
    const state = createEmptyGameState({
      cardInstances: [
        host,
        brave,
        ...["contract", "older-source", "text-under", "unrelated"].map(create),
      ],
    });
    expect(getFieldTapTargetIdsForCardClick(state, "host")).toEqual([
      "host",
      "brave",
      "contract",
      "older-source",
    ]);
    expect(getFieldTapTargetIdsForCardClick(state, "brave")).toEqual([
      "brave",
      "host",
      "contract",
      "older-source",
    ]);
    expect(getSelectableFieldTapIds(state, new Set(["contract"]))).toEqual(
      new Set(["contract", "host", "brave"])
    );
    expect(getSelectableFieldTapIds(state, new Set())).toEqual(new Set());
  });

  it("expands a combined host click to its attached brave source", () => {
    const host = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    host.attachedChildrenIds = ["brave-1"];
    const brave = createCardInstance(braveDef, {
      instanceId: "brave-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
      zoneRoleName: "brave",
    });
    brave.attachedToInstanceId = "host-1";
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, brave],
    });

    expect(getFieldTapTargetIdsForCardClick(state, "host-1")).toEqual([
      "host-1",
      "brave-1",
    ]);
    expect(getFieldTapTargetIdsForCardClick(state, "brave-1")).toEqual([
      "brave-1",
      "host-1",
    ]);
  });

  it("renders field-card effects under their true source card", () => {
    const hostAttack = {
      kind: "attack",
      actionId: "attack-host",
      sourceInstanceId: "host-1",
    } as unknown as LegalAction;
    const braveEffect = {
      kind: "use_field_card_effect",
      actionId: "effect-brave",
      sourceInstanceId: "brave-1",
    } as unknown as LegalAction;

    const groups = groupCardActionsForModal(
      [hostAttack, braveEffect],
      "host-1"
    );

    expect(groups.map((group) => group.instanceId)).toEqual([
      "host-1",
      "brave-1",
    ]);
    expect(groups[1]?.actions).toEqual([braveEffect]);
  });
});
