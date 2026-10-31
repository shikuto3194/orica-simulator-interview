/**
 * ENGINE-brave-combine-nexus-host: braveCondition.categories が "nexus" を含むブレイヴのみ、
 * 合体先候補にネクサスを含める primitive。
 *
 * 05_brave-and-attack-special-cases.md:33-36「合体条件はカテゴリ/色/系統/コスト/カード名で
 * 指定される」の通りカテゴリは合体条件の正規軸だが、候補ホスト列挙
 * (getAvailableBraveCombineLegalActions / getValidBraveCombineHosts) が
 * zoneRoleName==="spirit"|"ultimate" 固定でネクサスを一切候補に入れなかったため、
 * categories:["nexus"] を指定しても常に不成立だった。
 *
 * categories 未指定/nexus 非含有のブレイヴは既存挙動を変えない（対照テスト）。
 */
import { describe, expect, it } from "vitest";
import {
  getAvailableBraveCombineLegalActions,
  getValidBraveCombineHosts,
} from "../src/legal/legal-actions-availability";
import { executeBraveCombine } from "../src/legal/brave-combine-state-helpers";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import type { CardDefinition, GameState } from "../src/model";

const ALICE = "alice";
const BOB = "bob";

const nexusHostDef: CardDefinition = {
  cardNo: "TEST-NEXUS-HOST",
  name: "テストネクサス",
  printedCategory: "nexus",
  colors: ["white"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "",
  sourceUrls: [],
  sourceConfidence: "C",
};

const spiritHostDef: CardDefinition = {
  cardNo: "TEST-SPIRIT-HOST",
  name: "テストスピリット",
  printedCategory: "spirit",
  colors: ["white"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "",
  sourceUrls: [],
  sourceConfidence: "C",
};

const nexusCombineBraveDef: CardDefinition = {
  cardNo: "TEST-BRAVE-NEXUS-COMBINE",
  name: "テストブレイヴ(ネクサス合体)",
  printedCategory: "brave",
  colors: ["white"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "",
  sourceUrls: [],
  sourceConfidence: "C",
  braveCondition: { categories: ["nexus"] },
};

const spiritOnlyBraveDef: CardDefinition = {
  cardNo: "TEST-BRAVE-SPIRIT-ONLY",
  name: "テストブレイヴ(通常)",
  printedCategory: "brave",
  colors: ["white"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "",
  sourceUrls: [],
  sourceConfidence: "C",
  braveCondition: { categories: ["spirit", "ultimate"] },
};

const defRegistry = new Map<string, CardDefinition>(
  [nexusHostDef, spiritHostDef, nexusCombineBraveDef, spiritOnlyBraveDef].map(
    (d) => [d.cardNo, d]
  )
);
const getDef = (id: string) => defRegistry.get(id);

function buildState(braveDef: CardDefinition): {
  state: GameState;
  brave: string;
  nexus: string;
  spirit: string;
} {
  const brave = createCardInstance(braveDef, {
    instanceId: "brave-1",
    ownerPlayerId: ALICE,
    zone: "field",
    zoneRoleName: "brave",
  });
  const nexus = createCardInstance(nexusHostDef, {
    instanceId: "nexus-1",
    ownerPlayerId: ALICE,
    zone: "field",
    zoneRoleName: "nexus",
  });
  const spirit = createCardInstance(spiritHostDef, {
    instanceId: "spirit-1",
    ownerPlayerId: ALICE,
    zone: "field",
    zoneRoleName: "spirit",
    normalCoreCount: 1,
  });
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [brave, nexus, spirit],
    }),
    activePlayerId: ALICE,
    step: "main",
  };
  return {
    state,
    brave: brave.instanceId,
    nexus: nexus.instanceId,
    spirit: spirit.instanceId,
  };
}

describe("ENGINE-brave-combine-nexus-host", () => {
  it("braveCondition.categories:['nexus'] のブレイヴはネクサスを合体候補に含める", () => {
    const { state, brave, nexus } = buildState(nexusCombineBraveDef);
    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    expect(
      actions.some(
        (a) => a.braveInstanceId === brave && a.targetInstanceId === nexus
      )
    ).toBe(true);
  });

  it("categories が spirit/ultimate のみのブレイヴはネクサスを候補に含めない（既存挙動維持）", () => {
    const { state, brave, nexus, spirit } = buildState(spiritOnlyBraveDef);
    const actions = getAvailableBraveCombineLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
    });
    expect(
      actions.some(
        (a) => a.braveInstanceId === brave && a.targetInstanceId === nexus
      )
    ).toBe(false);
    expect(
      actions.some(
        (a) => a.braveInstanceId === brave && a.targetInstanceId === spirit
      )
    ).toBe(true);
  });

  it("getValidBraveCombineHosts も categories:['nexus'] のときネクサスを含む", () => {
    const { state, nexus } = buildState(nexusCombineBraveDef);
    const hosts = getValidBraveCombineHosts(
      state,
      nexusCombineBraveDef,
      ALICE,
      getDef
    );
    expect(hosts.some((h) => h.instanceId === nexus)).toBe(true);
  });

  it("getValidBraveCombineHosts は categories 非対応ブレイヴに対してネクサスを含めない", () => {
    const { state, nexus, spirit } = buildState(spiritOnlyBraveDef);
    const hosts = getValidBraveCombineHosts(
      state,
      spiritOnlyBraveDef,
      ALICE,
      getDef
    );
    expect(hosts.some((h) => h.instanceId === nexus)).toBe(false);
    expect(hosts.some((h) => h.instanceId === spirit)).toBe(true);
  });

  it("[board] executeBraveCombine でネクサスへ実際に合体し、コアも移動する", () => {
    const { state, brave, nexus } = buildState(nexusCombineBraveDef);
    const withCore: GameState = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === brave ? { ...c, normalCoreCount: 1 } : c
      ),
    };
    const next = executeBraveCombine(withCore, ALICE, brave, nexus, getDef);
    const nexusAfter = next.cardInstances.find((c) => c.instanceId === nexus)!;
    const braveAfter = next.cardInstances.find((c) => c.instanceId === brave)!;
    expect(nexusAfter.attachedChildrenIds).toContain(brave);
    expect(braveAfter.attachedToInstanceId).toBe(nexus);
    expect(nexusAfter.normalCoreCount).toBe(1);
    expect(braveAfter.normalCoreCount).toBe(0);
  });
});
