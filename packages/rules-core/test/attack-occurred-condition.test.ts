/**
 * 独自拡張: ConditionClause.attack_occurred 評価テスト。
 *
 * 「自分の系統：○○を持つスピリットがアタックしたとき、下の効果を発揮できる」型
 * (BSSL01-M01 等)、他カードのアタックを発火点にした発揮解禁ゲートを表現する条件句。
 * flash_used (flash-used-condition.test.ts) と対称構造。attackDeclarationLog を SSOT とする。
 */
import { describe, it, expect } from "vitest";
import { createEmptyGameState } from "../src/factories";
import { evaluateCondition } from "../src/effect/structured-effect-interpreter";
import type {
  AttackDeclarationLogEntry,
  CardDefinition,
  ConditionClause,
  GameState,
} from "../src/model";

const ALICE = "player-1";
const BOB = "player-2";

function makeDef(
  cardNo: string,
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    printedColors: ["purple"],
    symbolColors: ["purple"],
    printedCost: 3,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    images: {},
    tribe: "影",
    colors: ["purple"],
    ...overrides,
  } as CardDefinition;
}

const defMap = new Map<string, CardDefinition>();
defMap.set("KAGE-SPIRIT", makeDef("KAGE-SPIRIT", { tribe: "影" }));
defMap.set("PLAYER-SPIRIT", makeDef("PLAYER-SPIRIT", { tribe: "プレイヤー" }));
defMap.set("OTHER-SPIRIT", makeDef("OTHER-SPIRIT", { tribe: "妖精" }));

const getCardDef = (id: string) => defMap.get(id);

function attackEntry(
  overrides: Partial<AttackDeclarationLogEntry>
): AttackDeclarationLogEntry {
  return {
    playerId: ALICE,
    cardInstanceId: "atk-card-1",
    cardDefinitionId: "KAGE-SPIRIT",
    turnNumber: 1,
    step: "attack",
    attackId: null,
    ...overrides,
  };
}

function stateWithLog(opts: {
  log?: AttackDeclarationLogEntry[];
  turnNumber?: number;
  step?: GameState["step"];
  activeAttackId?: string | null;
  extraCardInstances?: GameState["cardInstances"];
}): GameState {
  const base = createEmptyGameState({});
  return {
    ...base,
    turnNumber: opts.turnNumber ?? 1,
    step: opts.step ?? "attack",
    activeAttack: opts.activeAttackId
      ? {
          attackId: opts.activeAttackId,
          primaryEntityId: "e1",
          participantEntityIds: ["e1"],
          groupMode: "single",
          target: { kind: "player", playerId: BOB },
          blockAssignments: [],
          symbolResolutionOrder: [],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        }
      : null,
    attackDeclarationLog: opts.log ?? [],
    cardInstances: opts.extraCardInstances ?? base.cardInstances,
  };
}

describe("ConditionClause.attack_occurred 評価", () => {
  const SRC = "src-1";

  it("空ログ → false（negate=true で true に反転）", () => {
    const state = stateWithLog({ log: [] });
    const positive: ConditionClause = {
      kind: "attack_occurred",
      scope: "game",
      player: "self",
    };
    const negated: ConditionClause = { ...positive, negate: true };
    expect(evaluateCondition(state, [positive], SRC, ALICE, getCardDef)).toBe(
      false
    );
    expect(evaluateCondition(state, [negated], SRC, ALICE, getCardDef)).toBe(
      true
    );
  });

  it("self が game スコープでアタック宣言済み → true", () => {
    const state = stateWithLog({ log: [attackEntry({ playerId: ALICE })] });
    const clause: ConditionClause = {
      kind: "attack_occurred",
      scope: "game",
      player: "self",
    };
    expect(evaluateCondition(state, [clause], SRC, ALICE, getCardDef)).toBe(
      true
    );
  });

  it("scope=turn: 過去ターンの宣言は除外される", () => {
    const state = stateWithLog({
      log: [attackEntry({ turnNumber: 1 })],
      turnNumber: 2,
    });
    const clause: ConditionClause = {
      kind: "attack_occurred",
      scope: "turn",
      player: "self",
    };
    expect(evaluateCondition(state, [clause], SRC, ALICE, getCardDef)).toBe(
      false
    );
  });

  it("scope=step: 同ターンだが別 step の宣言は除外される", () => {
    const state = stateWithLog({
      log: [attackEntry({ turnNumber: 1, step: "attack" })],
      turnNumber: 1,
      step: "main",
    });
    const clause: ConditionClause = {
      kind: "attack_occurred",
      scope: "step",
      player: "self",
    };
    expect(evaluateCondition(state, [clause], SRC, ALICE, getCardDef)).toBe(
      false
    );
  });

  it("scope=step: 同ターン同 step の宣言はマッチする", () => {
    const state = stateWithLog({
      log: [attackEntry({ turnNumber: 1, step: "attack" })],
      turnNumber: 1,
      step: "attack",
    });
    const clause: ConditionClause = {
      kind: "attack_occurred",
      scope: "step",
      player: "self",
    };
    expect(evaluateCondition(state, [clause], SRC, ALICE, getCardDef)).toBe(
      true
    );
  });

  it("scope=battle: 現バトル中 + 同 attackId ならマッチ、バトル外は除外", () => {
    const inBattle = stateWithLog({
      log: [attackEntry({ attackId: "atk-1" })],
      activeAttackId: "atk-1",
    });
    const clause: ConditionClause = {
      kind: "attack_occurred",
      scope: "battle",
      player: "self",
    };
    expect(evaluateCondition(inBattle, [clause], SRC, ALICE, getCardDef)).toBe(
      true
    );

    const outOfBattle = stateWithLog({
      log: [attackEntry({ attackId: null })],
      activeAttackId: null,
    });
    expect(
      evaluateCondition(outOfBattle, [clause], SRC, ALICE, getCardDef)
    ).toBe(false);
  });

  it("player=opponent: 自分の宣言は除外され、相手の宣言のみマッチ", () => {
    const state = stateWithLog({ log: [attackEntry({ playerId: ALICE })] });
    const clause: ConditionClause = {
      kind: "attack_occurred",
      scope: "game",
      player: "opponent",
    };
    expect(evaluateCondition(state, [clause], SRC, ALICE, getCardDef)).toBe(
      false
    );

    const state2 = stateWithLog({ log: [attackEntry({ playerId: BOB })] });
    expect(evaluateCondition(state2, [clause], SRC, ALICE, getCardDef)).toBe(
      true
    );
  });

  it("cardFilter: tribes (OR) でフィルタし、一致する系統のアタック宣言のみ true (BSSL01-M01 型)", () => {
    const cardInstance = (id: string, defId: string) => ({
      instanceId: id,
      definitionId: defId,
      originalDefinitionId: defId,
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field" as const,
      zoneRoleName: "",
      normalCoreCount: 1,
      minimumRequiredCores: 0,
      exhaustState: "recovered" as const,
      pendingLeaveKind: null,
      pendingLeaveCause: null,
      pendingLeaveChainId: null,
      deferZoneMoveUntilChainEnd: false,
      attachedToInstanceId: null,
      attachedChildrenIds: [],
      pendingLeaveLvSnapshot: null,
      underCards: [],
      divineTransformState: null,
      faceDown: false,
    });

    const gateClause: ConditionClause = {
      kind: "attack_occurred",
      scope: "game",
      player: "self",
      cardFilter: { category: ["spirit"], tribes: ["影", "プレイヤー"] },
    };

    // 系統:影 のアタック宣言 → マッチ
    const kageState = stateWithLog({
      log: [
        attackEntry({
          cardInstanceId: "kage-1",
          cardDefinitionId: "KAGE-SPIRIT",
        }),
      ],
      extraCardInstances: [cardInstance("kage-1", "KAGE-SPIRIT")],
    });
    expect(
      evaluateCondition(kageState, [gateClause], SRC, ALICE, getCardDef)
    ).toBe(true);

    // 系統:プレイヤー のアタック宣言 → マッチ (OR)
    const playerState = stateWithLog({
      log: [
        attackEntry({
          cardInstanceId: "player-1",
          cardDefinitionId: "PLAYER-SPIRIT",
        }),
      ],
      extraCardInstances: [cardInstance("player-1", "PLAYER-SPIRIT")],
    });
    expect(
      evaluateCondition(playerState, [gateClause], SRC, ALICE, getCardDef)
    ).toBe(true);

    // 対象外系統 のアタック宣言 → 不一致
    const otherState = stateWithLog({
      log: [
        attackEntry({
          cardInstanceId: "other-1",
          cardDefinitionId: "OTHER-SPIRIT",
        }),
      ],
      extraCardInstances: [cardInstance("other-1", "OTHER-SPIRIT")],
    });
    expect(
      evaluateCondition(otherState, [gateClause], SRC, ALICE, getCardDef)
    ).toBe(false);
  });

  it("targetControllerLifeAtDeclaration: 宣言時点スナップショットで照合し、ログに snapshot が無ければ不一致 (BSAZ02-M01 型)", () => {
    const gateClause: ConditionClause = {
      kind: "attack_occurred",
      scope: "game",
      player: "opponent",
      targetControllerLifeAtDeclaration: { min: 1, max: 1 },
    };

    const matching = stateWithLog({
      log: [
        attackEntry({
          playerId: BOB,
          designatedTargetInstanceId: "target-1",
          designatedTargetDefinitionId: "KAGE-SPIRIT",
          designatedTargetControllerLifeAtDeclaration: 1,
        }),
      ],
    });
    expect(
      evaluateCondition(matching, [gateClause], SRC, ALICE, getCardDef)
    ).toBe(true);

    const outOfRange = stateWithLog({
      log: [
        attackEntry({
          playerId: BOB,
          designatedTargetInstanceId: "target-1",
          designatedTargetDefinitionId: "KAGE-SPIRIT",
          designatedTargetControllerLifeAtDeclaration: 2,
        }),
      ],
    });
    expect(
      evaluateCondition(outOfRange, [gateClause], SRC, ALICE, getCardDef)
    ).toBe(false);

    // snapshot 未設定 (指定アタックでない通常宣言、または旧データ) → 不一致。
    const missingSnapshot = stateWithLog({
      log: [attackEntry({ playerId: BOB })],
    });
    expect(
      evaluateCondition(missingSnapshot, [gateClause], SRC, ALICE, getCardDef)
    ).toBe(false);
  });
});
