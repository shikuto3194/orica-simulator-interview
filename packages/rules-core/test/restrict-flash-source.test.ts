import { describe, it, expect, beforeEach } from "vitest";
import { executeEffect } from "../src/effect/effect-interpreter";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { isFlashRestricted } from "../src/legal/legal-actions-shared";
import type { CardDefinition, CardInstance, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

// ============================================================
// P3-21: restrict_flash アクションの source ゾーンフィルタ配線
// ============================================================
//
// DSL → v1 変換で source が正しく伝搬され、ContinuousEffect の
// modifierTag (表示カテゴリ) と metadata.restrictedZones (詳細フィルタ) に
// 期待どおり反映されることを検証する。

function makeDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    cardNo: "TEST-RFS-001",
    name: "テストスピリット",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "星竜",
    sourceUrls: [],
    sourceConfidence: "C",
    ...overrides,
  };
}

function makeInstance(
  def: CardDefinition,
  overrides: Partial<CardInstance> = {}
): CardInstance {
  const base = createCardInstance(def, {
    ownerPlayerId: "alice",
    zone: "field",
    cores: 1,
  });
  return { ...base, ...overrides };
}

function makeState(cards: CardInstance[]): GameState {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: cards,
    startingLife: 5,
  });
}

const defRegistry = new Map<string, CardDefinition>();
function getDef(id: string): CardDefinition | undefined {
  return defRegistry.get(id);
}
function registerDef(def: CardDefinition): void {
  defRegistry.set(def.cardNo, def);
}

function runRestrictFlash(source: Effect["steps"][number]["action"]) {
  const sourceDef = makeDef({ cardNo: "RFS-SRC" });
  registerDef(sourceDef);
  const sourceCard = makeInstance(sourceDef, { instanceId: "src-1" });
  const state = makeState([sourceCard]);

  const effect: Effect = {
    timing: { kind: "card_event", event: "attack" },
    steps: [{ action: source }],
  };

  return executeEffect({
    chainId: "test:restrict-flash-source:74",
    state,
    effect,
    sourceInstanceId: "src-1",
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
  });
}

describe("restrict_flash — source ゾーンフィルタ配線", () => {
  beforeEach(() => {
    defRegistry.clear();
  });

  it("source 未指定: 全ゾーン制限として restrict_flash_any タグが登録される", () => {
    const result = runRestrictFlash({
      kind: "restrict_flash",
      player: "opponent",
      duration: { scope: "battle" },
    });

    const ces = result.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "restrict_flash_any"
    );
    expect(ces).toHaveLength(1);
    // metadata.restrictedZones は "any" の場合 undefined
    expect(ces[0]?.metadata).toBeUndefined();
  });

  it('source: "any": 全ゾーン制限', () => {
    const result = runRestrictFlash({
      kind: "restrict_flash",
      player: "opponent",
      source: "any",
      duration: { scope: "battle" },
    });

    const ces = result.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "restrict_flash_any"
    );
    expect(ces).toHaveLength(1);
    expect(ces[0]?.metadata).toBeUndefined();
  });

  it('source: "hand": 手札限定タグ + metadata.restrictedZones=["hand"]', () => {
    const result = runRestrictFlash({
      kind: "restrict_flash",
      player: "opponent",
      source: "hand",
      duration: { scope: "battle" },
    });

    const ces = result.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "restrict_flash_hand"
    );
    expect(ces).toHaveLength(1);
    expect(ces[0]?.metadata).toEqual({ restrictedZones: ["hand"] });
  });

  it('source: "field": 場限定タグ + metadata.restrictedZones=["field"]', () => {
    const result = runRestrictFlash({
      kind: "restrict_flash",
      player: "opponent",
      source: "field",
      duration: { scope: "battle" },
    });

    const ces = result.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "restrict_flash_field"
    );
    expect(ces).toHaveLength(1);
    expect(ces[0]?.metadata).toEqual({ restrictedZones: ["field"] });
  });

  it('source: ["hand", "field"]: 配列指定はタグが any (混合) で metadata に両ゾーン保持', () => {
    const result = runRestrictFlash({
      kind: "restrict_flash",
      player: "opponent",
      source: ["hand", "field"],
      duration: { scope: "battle" },
    });

    const ces = result.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "restrict_flash_any"
    );
    expect(ces).toHaveLength(1);
    expect(ces[0]?.metadata).toEqual({
      restrictedZones: ["hand", "field"],
    });
  });

  it('source: ["hand"]: 単一要素配列は restrict_flash_hand に正規化される', () => {
    const result = runRestrictFlash({
      kind: "restrict_flash",
      player: "opponent",
      source: ["hand"],
      duration: { scope: "battle" },
    });

    const ces = result.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "restrict_flash_hand"
    );
    expect(ces).toHaveLength(1);
    expect(ces[0]?.metadata).toEqual({ restrictedZones: ["hand"] });
  });

  it('source: "trash": hand/field 以外の単一ゾーンは any タグ + metadata に zone 保持', () => {
    const result = runRestrictFlash({
      kind: "restrict_flash",
      player: "opponent",
      source: "trash",
      duration: { scope: "battle" },
    });

    const ces = result.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "restrict_flash_any"
    );
    expect(ces).toHaveLength(1);
    expect(ces[0]?.metadata).toEqual({ restrictedZones: ["trash"] });
  });

  it('source: ["hand", "hand"]: 重複ゾーンは正規化で除去される', () => {
    const result = runRestrictFlash({
      kind: "restrict_flash",
      player: "opponent",
      source: ["hand", "hand"],
      duration: { scope: "battle" },
    });

    const ces = result.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "restrict_flash_hand"
    );
    expect(ces).toHaveLength(1);
    expect(ces[0]?.metadata).toEqual({ restrictedZones: ["hand"] });
  });

  it("対象プレイヤーは player ref を解決して targetInstanceId に格納される", () => {
    const result = runRestrictFlash({
      kind: "restrict_flash",
      player: "opponent",
      source: "hand",
      duration: { scope: "battle" },
    });

    const ce = result.activeContinuousEffects.find(
      (c) => c.modifierTag === "restrict_flash_hand"
    );
    expect(ce?.targetInstanceId).toBe("bob");
  });

  it('source: "hand": 消費側では手札だけを制限し、場や source 未指定 blanket 判定は制限しない', () => {
    const result = runRestrictFlash({
      kind: "restrict_flash",
      player: "opponent",
      source: "hand",
      duration: { scope: "battle" },
    });

    expect(isFlashRestricted(result, "bob", "hand")).toBe(true);
    expect(isFlashRestricted(result, "bob", "field")).toBe(false);
    expect(isFlashRestricted(result, "bob")).toBe(false);
  });
});
