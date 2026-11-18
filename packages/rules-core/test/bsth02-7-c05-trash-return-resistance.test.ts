/**
 * needs-dsl: ENGINE-effect-resistance-return-from-trash-gate (2026-07-03 着地)
 *
 * BSTH02.7-C05「戦符「リトルレギオン」」effects[0] 前段:
 * 「トラッシュにあるこのカードは手札/デッキに戻らない」の検証。
 *
 * effect_immunity (一切の効果を受けない、BSTH002-M01 等) より狭い「戻る」限定の
 * effect_resistance(resistsOutcome:["bounce","send_to_deck"], source:"all") で表現。
 * 既存の return-from-trash-immunity.test.ts と同じ構図 (search_zone(trash) →
 * executeReturnFromTrash) だが、gate される CE 種別が defense_immune ではなく
 * cannot_be_bounced/cannot_be_sent_to_deck である点が異なる。
 *
 * source:"all" のため、相手 acting だけでなく自分 acting の return_from_trash でも
 * 阻止される (effect-resistance-check.ts 冒頭コメント裁定「『防げない』破壊効果は…
 * 『手札/デッキに戻らない』…を無視する」参照)。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  rebuildContinuousEffectsFromField,
} from "../src/index";
import type { CardDefinition, GameState } from "../src/index";

const ALL_CARDS_MAP = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const card = (cardNo: string): CardDefinition => {
  const def = ALL_CARDS_MAP.get(cardNo);
  if (!def) throw new Error(`card not found: ${cardNo}`);
  return def;
};
const getCardDefinitionById = (id: string) => ALL_CARDS_MAP.get(id);
const emptyLookup = () => undefined;

function makeTrashSource(
  player: "self" | "opponent",
  destination: "hand" | "deck" | "field"
): CardDefinition {
  return {
    cardNo: `SRC-${player}-${destination}`,
    name: "トラッシュ操作源",
    printedCategory: "magic",
    colors: ["yellow"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [],
    symbolColors: [],
    textLines: [],
    keywordTags: [],
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: "trash",
              player,
              count: 5,
              destination,
            },
          },
        ],
      },
    ],
    sourceUrls: [],
    sourceConfidence: "C",
  };
}

function makeBaseState(
  cardInstances: GameState["cardInstances"],
  activePlayerId: string
): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const seeded = { ...base, activePlayerId, cardInstances };
  return rebuildContinuousEffectsFromField(seeded, getCardDefinitionById);
}

describe("BSTH02.7-C05 effects[0]: トラッシュ束縛 effect_resistance (cannot_be_bounced/cannot_be_sent_to_deck)", () => {
  const c05 = card("BSTH02.7-C05");
  const trashRestriction = c05.effects![0]!;

  it("DSL 構造: applicability.zone=trash + effect_resistance(resistsOutcome:[bounce,send_to_deck], source:all)", () => {
    expect(trashRestriction.applicability).toEqual({ zone: "trash" });
    expect(trashRestriction.steps[0]!.action).toMatchObject({
      kind: "effect_resistance",
      target: { kind: "self" },
      resistsOutcome: ["bounce", "send_to_deck"],
      source: "all",
      duration: { scope: "while_in_trash" },
    });
  });

  it("[board] 相手の search_zone(trash→hand) では手札に戻らずトラッシュ滞在", () => {
    const src = makeTrashSource("opponent", "hand");
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [c05.cardNo, c05],
    ]);
    const state = makeBaseState(
      [
        createCardInstance(src, {
          instanceId: "src-bob",
          ownerPlayerId: "bob",
          zone: "field",
        }),
        createCardInstance(c05, {
          instanceId: "alice-c05",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
      ],
      "bob"
    );

    const result = executeEffect({
      chainId: "test:bsth02-7-c05-trash-return-resistance:120",
      state,
      effect: src.effects![0]!,
      sourceInstanceId: "src-bob",
      actingPlayerId: "bob",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-c05"
    )!;
    expect(after.zone).toBe("trash");
    expect(result.pendingZoneSelection).toBeNull();
  });

  it("[board] 自分の search_zone(trash→hand) でも source:all のため手札に戻らずトラッシュ滞在", () => {
    const src = makeTrashSource("self", "hand");
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [c05.cardNo, c05],
    ]);
    const state = makeBaseState(
      [
        createCardInstance(src, {
          instanceId: "src-alice",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(c05, {
          instanceId: "alice-c05",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
      ],
      "alice"
    );

    const result = executeEffect({
      chainId: "test:bsth02-7-c05-trash-return-resistance:158",
      state,
      effect: src.effects![0]!,
      sourceInstanceId: "src-alice",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-c05"
    )!;
    expect(after.zone).toBe("trash");
  });

  it("[board] search_zone(trash→deck) でもデッキに戻らずトラッシュ滞在 (cannot_be_sent_to_deck)", () => {
    const src = makeTrashSource("opponent", "deck");
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [c05.cardNo, c05],
    ]);
    const state = makeBaseState(
      [
        createCardInstance(src, {
          instanceId: "src-bob",
          ownerPlayerId: "bob",
          zone: "field",
        }),
        createCardInstance(c05, {
          instanceId: "alice-c05",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
      ],
      "bob"
    );

    const result = executeEffect({
      chainId: "test:bsth02-7-c05-trash-return-resistance:195",
      state,
      effect: src.effects![0]!,
      sourceInstanceId: "src-bob",
      actingPlayerId: "bob",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-c05"
    )!;
    expect(after.zone).toBe("trash");
  });

  it("[board] search_zone(trash→field) は「手札/デッキに戻らない」の対象外のため場に戻る", () => {
    // BounceAction.destination は "hand"|"set_aside" のみで "field" を含まない
    // (model.ts BounceAction) ため、トラッシュ→場復帰 (再召喚系) は本耐性の対象外。
    const src = makeTrashSource("opponent", "field");
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [c05.cardNo, c05],
    ]);
    const state = makeBaseState(
      [
        createCardInstance(src, {
          instanceId: "src-bob",
          ownerPlayerId: "bob",
          zone: "field",
        }),
        createCardInstance(c05, {
          instanceId: "alice-c05",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
      ],
      "bob"
    );

    const result = executeEffect({
      chainId: "test:bsth02-7-c05-trash-return-resistance:234",
      state,
      effect: src.effects![0]!,
      sourceInstanceId: "src-bob",
      actingPlayerId: "bob",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const after = result.cardInstances.find(
      (c) => c.instanceId === "alice-c05"
    )!;
    expect(after.zone).toBe("field");
  });

  it("[board] 耐性なしカードと混在: 非耐性カードのみ手札へ戻る", () => {
    const src = makeTrashSource("opponent", "hand");
    const normal: CardDefinition = {
      cardNo: "NORMAL-TRASH-CARD-C05",
      name: "通常トラッシュカード",
      printedCategory: "nexus",
      colors: ["yellow"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
      symbolColors: ["yellow"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
    const defs = new Map<string, CardDefinition>([
      [src.cardNo, src],
      [c05.cardNo, c05],
      [normal.cardNo, normal],
    ]);
    const state = makeBaseState(
      [
        createCardInstance(src, {
          instanceId: "src-bob",
          ownerPlayerId: "bob",
          zone: "field",
        }),
        createCardInstance(c05, {
          instanceId: "alice-c05",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
        createCardInstance(normal, {
          instanceId: "alice-normal",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
      ],
      "bob"
    );

    const result = executeEffect({
      chainId: "test:bsth02-7-c05-trash-return-resistance:291",
      state,
      effect: src.effects![0]!,
      sourceInstanceId: "src-bob",
      actingPlayerId: "bob",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: emptyLookup,
    });

    const c05After = result.cardInstances.find(
      (c) => c.instanceId === "alice-c05"
    )!;
    const normalAfter = result.cardInstances.find(
      (c) => c.instanceId === "alice-normal"
    )!;
    expect(c05After.zone).toBe("trash");
    expect(normalAfter.zone).toBe("hand");
  });
});
