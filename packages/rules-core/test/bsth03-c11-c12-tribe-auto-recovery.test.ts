/**
 * BSTH03-C11「神宝『ライフスプリングインフィニティ』」effects[1] /
 * BSTH03-C12「神脳『オモイカネブレイン』」effects[0]:
 *
 * 「自分の系統：「蓬莱」/「想獣」/「魔影」を持つ効果でデッキからオープンされたか、トラッシュに
 *  置かれたこのカードは手札に加えられ、トラッシュから手札に加えたとき、ボイドからコア1個を
 *  系統：「蓬莱」を持つ自分の導界者ネクサスに置く。」
 *
 * BSTH02-R11/BSFT01-C02 の trigger_tribes 型 card_event 自動回収と同型（stale stub 解消。
 * trigger_tribes/trigger_source_player/trigger_from_zone はいずれも既存 primitive）。
 *
 * ボーナスステップ（core_move）は engine-trash-optional-bonus-steps で新規配線した
 * `TrashOptionalAddEntry.bonusStepsByInstanceId` / `PendingDeckReveal.bonusStepsByInstanceId`
 * 経由で、実際に手札へ受理された候補にのみ適用される（従来は
 * `moved_to_trash:optional_bonus_unsupported` ログのみで silent drop していた）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type { CardDefinition, GameState } from "../src/index";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { getLegalActions, applyLegalAction } from "../src/index";
import {
  processMovedToTrashEffects,
  materializeDeferredTrashOptionalAdds,
} from "../src/effect/structured-effect-interpreter";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const card = (no: string): CardDefinition => {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
};
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const ALICE = "player-1";

const matchingNexus: CardDefinition = {
  cardNo: "TEST-HOURAI-GUIDE-NEXUS",
  name: "テスト蓬莱導界者ネクサス",
  printedCategory: "nexus",
  colors: ["yellow"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "導界者・蓬莱",
  sourceUrls: [],
  sourceConfidence: "C",
};
const nonMatchingNexus: CardDefinition = {
  cardNo: "TEST-NON-HOURAI-NEXUS",
  name: "テスト無関係ネクサス（蓬莱を持たない）",
  printedCategory: "nexus",
  colors: ["yellow"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "導界者",
  sourceUrls: [],
  sourceConfidence: "C",
};
/** 蓬莱は持つが導界者を持たないネクサス（tribesLogic:"and" の片側欠如ケース）。 */
const houraiOnlyNonGuideNexus: CardDefinition = {
  cardNo: "TEST-HOURAI-ONLY-NON-GUIDE-NEXUS",
  name: "テスト蓬莱ネクサス（導界者ではない）",
  printedCategory: "nexus",
  colors: ["yellow"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 0, bp: 0 }],
  symbolColors: [],
  textLines: [],
  keywordTags: [],
  tribe: "蓬莱",
  sourceUrls: [],
  sourceConfidence: "C",
};

const CASES = [
  { cardNo: "BSTH03-C11", effectIndex: 1 },
  { cardNo: "BSTH03-C12", effectIndex: 0 },
] as const;

describe.each(CASES)(
  "$cardNo trigger_tribes 自動回収 + 導界者ネクサスへのコア配置",
  ({ cardNo, effectIndex }) => {
    const c = card(cardNo);
    const effect = c.effects![effectIndex]!;

    it("DSL 構造: trigger_tribes(蓬莱/想獣/魔影) + trigger_source_player(self) + trigger_from_zone(deck) + move_self→hand + core_move(void→蓬莱&導界者ネクサス)", () => {
      expect(effect.stub).toBeUndefined();
      expect(effect.timing).toMatchObject({
        kind: "card_event",
        event: ["revealed", "moved_to_trash"],
      });
      expect(effect.cardEventDisposition).toEqual({
        kind: "move",
        destination: "hand",
      });
      expect(effect.condition).toEqual([
        { kind: "trigger_source_player", player: "self" },
        { kind: "trigger_tribes", tribes: ["蓬莱", "想獣", "魔影"] },
        { kind: "trigger_from_zone", zones: ["deck"] },
      ]);
      expect(effect.executionMode).toBe("optional");

      const moveSelf = effect.steps[0]!.action;
      expect(moveSelf.kind).toBe("move_self");
      if (moveSelf.kind === "move_self") {
        expect(moveSelf.destination).toBe("hand");
      }

      const coreMove = effect.steps[1]!.action;
      expect(coreMove.kind).toBe("core_move");
      if (coreMove.kind === "core_move") {
        expect(coreMove.from).toMatchObject({ kind: "void", player: "self" });
        expect(coreMove.to).toMatchObject({
          kind: "field_card",
          player: "self",
          filter: {
            category: ["nexus"],
            tribes: ["蓬莱", "導界者"],
            tribesLogic: "and",
          },
        });
        expect(coreMove.amount).toBe(1);
      }
    });

    it("[board] 系統「魔影」効果でトラッシュ行き→任意受理で手札へ移動し、蓬莱+導界者の両系統を持つ自分ネクサスにのみコアが置かれる", () => {
      const src = createCardInstance(c, {
        instanceId: "src-trash",
        ownerPlayerId: ALICE,
        zone: "trash",
      });
      const defs = new Map<string, CardDefinition>([
        [c.cardNo, c],
        [matchingNexus.cardNo, matchingNexus],
        [nonMatchingNexus.cardNo, nonMatchingNexus],
        [houraiOnlyNonGuideNexus.cardNo, houraiOnlyNonGuideNexus],
      ]);
      const lookupDef = (id: string) => defs.get(id) ?? getDef(id);
      const state: GameState = createEmptyGameState({
        cardInstances: [
          src,
          // 非対象ネクサスを先に置く: tribesLogic:"and" が実際に AND として効いて
          // いなければ、OR 退化により配列順で誤って先に見つかったこちらへコアが
          // 置かれてしまう（tribesLogic 無視の array-order 偽陽性を排除する）。
          createCardInstance(nonMatchingNexus, {
            instanceId: "nexus-nomatch",
            ownerPlayerId: ALICE,
            zone: "field",
          }),
          createCardInstance(houraiOnlyNonGuideNexus, {
            instanceId: "nexus-hourai-only",
            ownerPlayerId: ALICE,
            zone: "field",
          }),
          createCardInstance(matchingNexus, {
            instanceId: "nexus-match",
            ownerPlayerId: ALICE,
            zone: "field",
          }),
        ],
      });

      // 系統「魔影」を持つ効果でトラッシュ行きした、というトリガー文脈を再現。
      const deferred = processMovedToTrashEffects(
        state,
        ["src-trash"],
        lookupDef,
        { sourceTribes: ["魔影"], sourcePlayerId: ALICE, fromZone: "deck" }
      );
      expect(
        deferred.cardInstances.find((ci) => ci.instanceId === "src-trash")!.zone
      ).toBe("trash");
      expect(deferred.pendingTrashOptionalAdds).toHaveLength(1);
      expect(
        deferred.pendingTrashOptionalAdds[0]!.bonusStepsByInstanceId?.[
          "src-trash"
        ]
      ).toHaveLength(1);

      const pendingState = materializeDeferredTrashOptionalAdds(deferred);
      expect(pendingState.pendingDeckReveal).not.toBeNull();
      expect(pendingState.pendingDeckReveal!.origin).toBe("trash");
      expect(
        pendingState.pendingDeckReveal!.bonusStepsByInstanceId?.["src-trash"]
      ).toHaveLength(1);

      const action = getLegalActions({
        state: pendingState,
        actingPlayerId: ALICE,
        getCardDefinitionById: lookupDef,
      }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
      const { state: resolved } = applyLegalAction({
        state: pendingState,
        action,
        getCardDefinitionById: lookupDef,
        selectedDeckRevealCardIds: ["src-trash"],
      });

      expect(
        resolved.cardInstances.find((ci) => ci.instanceId === "src-trash")!.zone
      ).toBe("hand");
      expect(
        resolved.cardInstances.find((ci) => ci.instanceId === "nexus-match")!
          .normalCoreCount
      ).toBe(1);
      expect(
        resolved.cardInstances.find((ci) => ci.instanceId === "nexus-nomatch")!
          .normalCoreCount
      ).toBe(0);
      // 蓬莱のみ・導界者を持たない候補にも置かれない（tribesLogic:"and" の片側検証）。
      expect(
        resolved.cardInstances.find(
          (ci) => ci.instanceId === "nexus-hourai-only"
        )!.normalCoreCount
      ).toBe(0);
    });

    it("[board] トラッシュ据え置き（拒否）を選んだ場合はコアが置かれない", () => {
      const src = createCardInstance(c, {
        instanceId: "src-trash-decline",
        ownerPlayerId: ALICE,
        zone: "trash",
      });
      const defs = new Map<string, CardDefinition>([
        [c.cardNo, c],
        [matchingNexus.cardNo, matchingNexus],
      ]);
      const lookupDef = (id: string) => defs.get(id) ?? getDef(id);
      const state: GameState = createEmptyGameState({
        cardInstances: [
          src,
          createCardInstance(matchingNexus, {
            instanceId: "nexus-match",
            ownerPlayerId: ALICE,
            zone: "field",
          }),
        ],
      });

      const deferred = processMovedToTrashEffects(
        state,
        ["src-trash-decline"],
        lookupDef,
        { sourceTribes: ["蓬莱"], sourcePlayerId: ALICE, fromZone: "deck" }
      );
      const pendingState = materializeDeferredTrashOptionalAdds(deferred);

      const action = getLegalActions({
        state: pendingState,
        actingPlayerId: ALICE,
        getCardDefinitionById: lookupDef,
      }).find((a) => a.kind === "resolve_pending_deck_reveal_pick")!;
      const { state: resolved } = applyLegalAction({
        state: pendingState,
        action,
        getCardDefinitionById: lookupDef,
        selectedDeckRevealCardIds: [],
      });

      expect(
        resolved.cardInstances.find(
          (ci) => ci.instanceId === "src-trash-decline"
        )!.zone
      ).toBe("trash");
      expect(
        resolved.cardInstances.find((ci) => ci.instanceId === "nexus-match")!
          .normalCoreCount
      ).toBe(0);
    });
  }
);
