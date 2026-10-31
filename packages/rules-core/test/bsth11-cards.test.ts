import { buildPayCostRecoverScenario } from "../../../apps/playground-web/src/scenario-pay-cost-recover";
import { finishCoreChoices } from "./helpers/core-choice-driver";
import { executeEffectWithChosenMinimumCores } from "./helpers/core-choice-driver";
/**
 * BSTH11 (東方天空璋) カードデータ取り込みの最小検証テスト。
 *
 * このパックは印字データのみ取り込み・全効果 stub 登録（DSL 未着手）のため、
 * 効果実行を伴う盤面変化テストは書けない。代わりに、印字データがルールエンジンの
 * 実効値解決（getEffectiveLevel/getEffectiveBp、requiredCores によるコア→Lv 判定）と
 * 正しく統合されていることを盤面上で検証する。cards:test-coverage gate 用に全13枚の
 * cardNo 参照も兼ねる。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import {
  applyLegalAction,
  buildHandActivatedEffectLookup,
  buildFieldCardEffectLookup,
  calculateReduction,
  collectTriggerEventsFromStateDelta,
  evaluateCondition,
  findMovedToTrashAutoEffect,
  getEffectiveBp,
  getEffectiveLevel,
  getLegalActions,
  materializeDeferredTrashOptionalAdds,
  processMovedToTrashEffects,
  rebuildContinuousEffectsFromField,
  refreshExhaustStates,
} from "../src";
import { getEffectiveCost } from "../src/legal/legal-actions-shared";
import { getAvailableDivineSkillLegalActions } from "../src/legal/legal-actions-availability";
import type {
  ActiveAttack,
  ActiveStack,
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  GameState,
} from "../src";
import { getEffectiveSymbols } from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";
import { resolvePlacementOracleMechanic } from "../src/mechanics/oracle-system";
import { matchesCardFilter } from "../src/card/card-filter";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import { flushPendingTurnEndExhaustDowngrades } from "../src/effect/structured-state-grants";
import { flushPendingLeaves } from "../src/state-based-actions";

const ALICE = "player-1";
const BOB = "player-2";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const getRegisteredHandActivatedEffectActions =
  buildHandActivatedEffectLookup(ALL_CARDS);

const BSTH11_CARD_NOS = [
  "BSTH11-C01",
  "BSTH11-C02",
  "BSTH11-C03",
  "BSTH11-C04",
  "BSTH11-C05",
  "BSTH11-M01",
  "BSTH11-R01",
  "BSTH11-R02",
  "BSTH11-R03",
  "BSTH11-X01",
  "BSTH11-X02",
  "BSTH11-X03",
  "BSTH11-X04",
];

describe("BSTH11 東方天空璋 card-data 取り込み", () => {
  for (const cardNo of BSTH11_CARD_NOS) {
    it(`${cardNo}: ALL_CARDS にロードされている`, () => {
      const card = cardNoMap.get(cardNo);
      expect(card).toBeDefined();
      expect(card?.pack).toBe("BSTH11 東方天空璋");
    });
  }

  it("BSTH11-C01 [溶けない炎天下の氷精]チルノ: フィールドの normalCoreCount からLv/BPが正しく解決される（Lv1→Lv2）", () => {
    const def = getCardDefinitionById("BSTH11-C01")!;
    // levelDefs: Lv1 requiredCores:1 bp:3000 / Lv2 requiredCores:3 bp:5000
    const atLv1 = createCardInstance(def, {
      instanceId: "c01-1",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const stateAtLv1 = createEmptyGameState({ cardInstances: [atLv1] });
    expect(
      getEffectiveLevel(stateAtLv1, atLv1, def, getCardDefinitionById)
    ).toBe(1);
    expect(getEffectiveBp(stateAtLv1, atLv1, def, getCardDefinitionById)).toBe(
      3000
    );

    const atLv2 = createCardInstance(def, {
      instanceId: "c01-2",
      ownerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const stateAtLv2 = createEmptyGameState({ cardInstances: [atLv2] });
    expect(
      getEffectiveLevel(stateAtLv2, atLv2, def, getCardDefinitionById)
    ).toBe(2);
    expect(getEffectiveBp(stateAtLv2, atLv2, def, getCardDefinitionById)).toBe(
      5000
    );
  });

  it("BSTH11-X01 [創界神]摩多羅 隠岐奈: 複合シンボル「緑神」は symbolColors:[green, god] へ分解される", () => {
    const def = getCardDefinitionById("BSTH11-X01")!;
    expect(def.printedCategory).toBe("nexus");
    expect(def.symbolColors).toEqual(["green", "god"]);
  });

  const HAND_SUMMON_PERMISSION_RESOLVED = new Set([
    "BSTH11-C01",
    "BSTH11-C02",
    "BSTH11-C03",
    "BSTH11-R01",
    "BSTH11-R02",
    "BSTH11-R03",
    "BSTH11-M01",
  ]);

  // M01 effects[3] (末尾追加)「このとき、手札/手元の天璋/秘神カード1枚を除外することで
  // 軽減シンボルすべてを満たす」stub 解消分 (cost_modify+useCostPayment.kind:"exclude"
  // fullReduction:true、下記 describe ブロックで検証、ENGINE-summon-self-exclude-alt-cost-
  // full-reduction)。
  const M01_EXCLUDE_FULL_REDUCTION_RESOLVED_INDEX_3 = new Set(["BSTH11-M01"]);

  // C01/C02/C03 effects[1]『このスピリットの召喚/アタック(or ブロック)時』deck_reveal
  // stub 解消分（BSTH003-C01/C02 precedent 同型、下記 describe ブロックで検証）。
  const DECK_REVEAL_TRIGGER_RESOLVED_INDEX_1 = new Set([
    "BSTH11-C01",
    "BSTH11-C02",
    "BSTH11-C03",
  ]);

  // R01 effects[2]『Lv2-3このスピリットのコストは5として扱う』stub 解消分
  // （override_properties + min_level、下記 describe ブロックで検証）。
  const COST_OVERRIDE_RESOLVED_INDEX_2 = new Set(["BSTH11-R01"]);

  // R01/R02 effects[1]『召喚(/アタック/ブロック)時』void核任意配置 + 条件付き重疲労 stub 解消分
  // （core_move + no_contract_card、下記 describe ブロックで検証）。
  const VOID_CORE_RESOLVED_INDEX_1 = new Set([
    "BSTH11-R01",
    "BSTH11-R02",
    "BSTH11-M01",
  ]);

  // M01 effects[2]『系統天璋のLvを1つ上として扱う』stub 解消分
  // （override_properties level:{delta:1}、下記 describe ブロックで検証）。
  const LEVEL_TREAT_RESOLVED_INDEX_2 = new Set(["BSTH11-M01"]);

  // R02 effects[2]『Lv2-3相手のアタックステップ中、重疲労状態の相手スピリット/アルティメット
  // のシンボルを0固定+この効果以外の効果を受けない』stub 解消分
  // （override_properties.symbols固定 + effect_immunity.sourceScope.restrictedAspects、
  // ENGINE-symbol-lock-self-effect-immunity、下記 describe ブロックで検証）。
  const SYMBOL_LOCK_RESOLVED_INDEX_2 = new Set(["BSTH11-R02"]);

  // C04 effects[0]『スタック効果使用時、軽減シンボル<神>を追加』/ effects[1]『フラッシュで
  // 相手2体重疲労』stub 解消分（treat_as + exhaust、下記 describe ブロックで検証）。
  const C04_TREAT_AS_RESOLVED_INDEX_0 = new Set(["BSTH11-C04"]);
  const C04_FLASH_EXHAUST_RESOLVED_INDEX_1 = new Set(["BSTH11-C04"]);

  // C04 effects[2]『スタック〔相手のターン〕〔ターンに1回：同名〕自分が契約していなければ
  // 相手を重疲労。この効果で疲労した対象は、このターン終了時、疲労状態になる』stub 解消分
  // （mode:stack+timingScope+no_contract_card+exhaust degree:heavy_exhaust+
  // downgradeAtTurnEnd、下記 describe ブロックで検証。
  // ENGINE-delayed-turn-end-captured-target-state-transition 新設primitiveで解消）。
  const C04_STACK_EXHAUST_RESOLVED_INDEX_2 = new Set(["BSTH11-C04"]);

  // R01 effects[3]『Lv3このスピリットのアタック/ブロック時』相手トラッシュ2枚除外+条件付回復 stub 解消分
  // （search_zone+ref_succeeded+no_contract_card+recover、下記 describe ブロックで検証）。
  const TRASH_EXILE_HEAL_RESOLVED_INDEX_3 = new Set(["BSTH11-R01"]);

  // R03 effects[2]『このスピリットのアタック/ブロック時』相手を重疲労できる stub 解消分
  // （filter 拡張の exhaust、下記 describe ブロックで検証。R03 は effects[1]統合により
  // 旧index3からずれて index2 に揃った）。
  const HEAVY_EXHAUST_RESOLVED_INDEX_2 = new Set(["BSTH11-R03"]);

  // X02 effects[3]『このスピリットのアタック/ブロック時』相手を重疲労できる stub 解消分
  // （X02はeffects[1]『現界』/[2]『アタック/ブロック』の2 entry分離挿入によりindexが
  // 1つ後退(旧index2→新index3)。下記 describe ブロックで検証）。
  const HEAVY_EXHAUST_RESOLVED_INDEX_3 = new Set(["BSTH11-X02"]);

  // R03 effects[1]『このスピリットの召喚時』〔ターンに1回：同名〕系統毎void核任意配置(6系統)+
  // 「その後、自分が契約していなければ、自分のトラッシュのコア3個をボイドに置くことで、
  // 自分はデッキの上から2枚ドローする」を単一effectに統合して stub 解消
  // （filterOr(spirit/ultimate + nexus+targetsGrandwalker:"only")×6系統 + trash-to-void
  // (executionMode:"optional")+connector:"conditional_cost"+draw、下記 describe ブロックで検証。
  // ENGINE-per-tribe-core-cap は新規primitive不要と判明し破棄）。
  const R03_TRIBE_CORE_AND_DRAW_RESOLVED_INDEX_1 = new Set(["BSTH11-R03"]);

  // X04 effects[1]『召喚/アタック/ブロック時』強制重疲労+ターンに1回void核配置 stub 解消分
  // （exhaust+core_move、下記 describe ブロックで検証）。
  const X04_EXHAUST_CORE_RESOLVED_INDEX_1 = new Set(["BSTH11-X04"]);

  // X04 effects[2]『フラッシュ』2コスト支払い回復 stub 解消分
  // （pay_cost+conditional_cost+recover、下記 describe ブロックで検証）。
  const X04_PAYCOST_RECOVER_RESOLVED_INDEX_2 = new Set(["BSTH11-X04"]);

  // C01/C02 effects[2]『Lv1-2：フラッシュ』系統幻想コスト3/4以外の自分スピリット1体を
  // 手札/手元に戻せる stub 解消分（bounce+excludeCosts+choice、下記 describe ブロックで検証）。
  const BOUNCE_CHOICE_RESOLVED_INDEX_2 = new Set(["BSTH11-C01", "BSTH11-C02"]);

  // X01 effects[1]『フラッシュ』手札/手元にあるこのカードは配置できる stub 解消分
  // （BSES01[2,3]/BSTH11-C05[0] precedent と同型、下記 describe ブロックで検証）。
  // 【神託：天璋】(旧 effects[0]) は grandwalkerData 化に伴い effects[] から削除済みのため
  // インデックスが1つ前倒しになっている（旧index2→新index1）。
  const X01_FLASH_PLACE_RESOLVED_INDEX_1 = new Set(["BSTH11-X01"]);

  // X01 effects[0]『自分の効果でトラッシュに置かれたこのカードは手元に置ける』stub 解消分
  // （BSES01-C01[0] precedent の行き先 hand→set_aside 汎用化、下記 describe ブロックで検証）。
  // 同上の理由で旧index1→新index0。
  const X01_SELF_TRASH_RECOVERY_RESOLVED_INDEX_0 = new Set(["BSTH11-X01"]);

  // C03 effects[2]『スタック『相手のメインステップ』』相手契約カード以外のネクサス配置無効化
  // stub 解消分（BSTH04-C01 mode:stack+timingScope+negate precedent と同型、下記 describe
  // ブロックで検証）。
  const NEGATE_PLACE_RESOLVED_INDEX_2 = new Set(["BSTH11-C03"]);

  // X01 effects[2]『神域』Lv1-2 前半「自分のフィールドに...ない間、相手のバースト効果を無効に
  // し」stub 解消分（field_all_match(filter:tribes:幻想/秘神のみ。X01原文には「か緑以外の
  // カードが」節が無くX03/X04と条件が異なるため colors 指定はしない、敵対的検証round1 refute
  // 対応)+negate(opponent_burst, duration:while_on_field)常駐無効化、BSTH09.2「転醒R03(B)」
  // precedent と同型、下記 describe ブロックで検証）。後半「重疲労状態の...回復できず、その効果
  // は発揮されない」は effects[3] で解消（下記参照）。
  const X01_DOMAIN_BURST_NEGATE_RESOLVED_INDEX_2 = new Set(["BSTH11-X01"]);

  // X01 effects[3]『神域』Lv1-2 後半「重疲労状態の...カードは回復できず、その効果は発揮され
  // ない」stub 解消分（field_all_match同一条件 + restrict_recovery(player:opponent,
  // filter:category spirit/ultimate/nexus, exclude:isContract または
  // isContractAdventDestination) + duration:while_on_field常駐、下記 describe ブロックで検証。
  // ENGINE-persistent-recovery-block-with-advent-host-exclusion 解消）。
  const X01_RECOVERY_BLOCK_RESOLVED_INDEX_3 = new Set(["BSTH11-X01"]);

  // X03 effects[1]『このスピリットの召喚/アタック時』防止免疫付与+代替コストで相手2つまで
  // 重疲労 stub 解消分（grant_effect_source_prevention_immunity+choice代替コスト+
  // conditional_cost exhaust、下記 describe ブロックで検証）。
  const X03_PREVENTION_IMMUNITY_ALT_COST_EXHAUST_RESOLVED_INDEX_1 = new Set([
    "BSTH11-X03",
  ]);

  // X03/X04 effects[0]『フラッシュ「お互いのアタックステップ」手札/手元にあるこのカードは、
  // 自分が契約しておらず、自分のフィールドに系統：「幻想」/「秘神」を持たないカードか緑以外の
  // カードがなければ、軽減シンボルすべてを満たして召喚できる』stub 解消分（field_all_match
  // primitive 新設 ENGINE-universal-field-condition、下記 describe ブロックで検証）。
  const X03_X04_UNIVERSAL_FIELD_SUMMON_RESOLVED_INDEX_0 = new Set([
    "BSTH11-X03",
    "BSTH11-X04",
  ]);

  // X02 effects[0]『フラッシュ【現界】』ソウルコアをトラッシュに置くことで手札から出す
  // stub 解消分（explicit_soul_core core_move+conditional_cost summon+
  // suppressThirdPartySummonObservation、下記 describe ブロックで検証）。
  const X02_GENKAI_FLASH_SUMMON_RESOLVED_INDEX_0 = new Set(["BSTH11-X02"]);

  // X02 effects[1](現界=card_event:put+effectScope:genkai)/[2](アタック/ブロック)
  // 『Lv1-2-3このスピリットの現界/アタック/ブロック時』コア分配+相手trash除外連動デッキ送り+
  // deck_reveal無償召喚/配置 stub 解消分。第三者混同防止のため2 entryに分離
  // (敵対的検証round1指摘対応、下記 describe ブロックで検証)。
  const X02_GENKAI_TRIGGER_RESOLVED_INDEX_1 = new Set(["BSTH11-X02"]);
  const X02_GENKAI_TRIGGER_RESOLVED_INDEX_2 = new Set(["BSTH11-X02"]);

  it("BSTH11 各カードの effects は steps:[] の stub のみ（DSL 未実装を明示、BSTH11-C05/フラッシュ自己召喚許可解消分/deck_reveal解消分/コスト上書き解消分/void核任意配置解消分/Lv補正解消分/C04解消分/トラッシュ除外回復解消分/重疲労解消分/X04解消分/bounce選択解消分/X01フラッシュ配置解消分/配置無効化解消分/X01自己トラッシュ回収解消分/X03防止免疫代替コスト解消分/X03X04全称量化自己召喚許可解消分/X01神域バースト無効化解消分/X01神域回復禁止解消分/シンボル固定+効果免疫解消分を除く）", () => {
    for (const cardNo of BSTH11_CARD_NOS) {
      if (cardNo === "BSTH11-C05") continue;
      const def = getCardDefinitionById(cardNo)!;
      expect(def.effects.length).toBeGreaterThan(0);
      for (const [index, effect] of def.effects.entries()) {
        expect(
          effect.steps.length,
          `${cardNo} effects[${index}]`
        ).toBeGreaterThan(0);
        if (HAND_SUMMON_PERMISSION_RESOLVED.has(cardNo) && index === 0) {
          continue;
        }
        if (DECK_REVEAL_TRIGGER_RESOLVED_INDEX_1.has(cardNo) && index === 1) {
          continue;
        }
        if (COST_OVERRIDE_RESOLVED_INDEX_2.has(cardNo) && index === 2) {
          continue;
        }
        if (VOID_CORE_RESOLVED_INDEX_1.has(cardNo) && index === 1) {
          continue;
        }
        if (LEVEL_TREAT_RESOLVED_INDEX_2.has(cardNo) && index === 2) {
          continue;
        }
        if (SYMBOL_LOCK_RESOLVED_INDEX_2.has(cardNo) && index === 2) {
          continue;
        }
        if (C04_TREAT_AS_RESOLVED_INDEX_0.has(cardNo) && index === 0) {
          continue;
        }
        if (C04_FLASH_EXHAUST_RESOLVED_INDEX_1.has(cardNo) && index === 1) {
          continue;
        }
        if (C04_STACK_EXHAUST_RESOLVED_INDEX_2.has(cardNo) && index === 2) {
          continue;
        }
        if (TRASH_EXILE_HEAL_RESOLVED_INDEX_3.has(cardNo) && index === 3) {
          continue;
        }
        if (HEAVY_EXHAUST_RESOLVED_INDEX_2.has(cardNo) && index === 2) {
          continue;
        }
        if (HEAVY_EXHAUST_RESOLVED_INDEX_3.has(cardNo) && index === 3) {
          continue;
        }
        if (
          R03_TRIBE_CORE_AND_DRAW_RESOLVED_INDEX_1.has(cardNo) &&
          index === 1
        ) {
          continue;
        }
        if (X04_EXHAUST_CORE_RESOLVED_INDEX_1.has(cardNo) && index === 1) {
          continue;
        }
        if (X04_PAYCOST_RECOVER_RESOLVED_INDEX_2.has(cardNo) && index === 2) {
          continue;
        }
        if (BOUNCE_CHOICE_RESOLVED_INDEX_2.has(cardNo) && index === 2) {
          continue;
        }
        if (X01_FLASH_PLACE_RESOLVED_INDEX_1.has(cardNo) && index === 1) {
          continue;
        }
        if (
          X01_SELF_TRASH_RECOVERY_RESOLVED_INDEX_0.has(cardNo) &&
          index === 0
        ) {
          continue;
        }
        if (NEGATE_PLACE_RESOLVED_INDEX_2.has(cardNo) && index === 2) {
          continue;
        }
        if (
          X01_DOMAIN_BURST_NEGATE_RESOLVED_INDEX_2.has(cardNo) &&
          index === 2
        ) {
          continue;
        }
        if (X01_RECOVERY_BLOCK_RESOLVED_INDEX_3.has(cardNo) && index === 3) {
          continue;
        }
        if (cardNo === "BSTH11-X01" && effect.textRef?.includes(2)) {
          expect(effect.executionMode).toBe("mandatory");
          expect(effect.steps.map((step) => step.action.kind)).toEqual([
            "move_card",
            "core_move",
          ]);
          continue;
        }
        if (
          X03_PREVENTION_IMMUNITY_ALT_COST_EXHAUST_RESOLVED_INDEX_1.has(
            cardNo
          ) &&
          index === 1
        ) {
          continue;
        }
        if (
          X03_X04_UNIVERSAL_FIELD_SUMMON_RESOLVED_INDEX_0.has(cardNo) &&
          index === 0
        ) {
          continue;
        }
        if (
          M01_EXCLUDE_FULL_REDUCTION_RESOLVED_INDEX_3.has(cardNo) &&
          index === 3
        ) {
          continue;
        }
        if (
          X02_GENKAI_FLASH_SUMMON_RESOLVED_INDEX_0.has(cardNo) &&
          index === 0
        ) {
          continue;
        }
        if (X02_GENKAI_TRIGGER_RESOLVED_INDEX_1.has(cardNo) && index === 1) {
          continue;
        }
        if (X02_GENKAI_TRIGGER_RESOLVED_INDEX_2.has(cardNo) && index === 2) {
          continue;
        }
        expect(effect.steps).toEqual([]);
        expect(typeof effect.stub).toBe("string");
      }
    }
  });

  describe("C01/C02/C03/R01/R02/R03/M01 effects[0]: フラッシュ『お互いのアタックステップ』手札/手元にあるこのカードは召喚できる（手札/手元起動効果）", () => {
    it.each(Array.from(HAND_SUMMON_PERMISSION_RESOLVED))(
      "%s: フラッシュ自己召喚起動効果 (timingScope both/attack, zone hand+set_aside)",
      (cardNo) => {
        const def = getCardDefinitionById(cardNo)!;
        const eff = def.effects[0]!;
        expect(eff.stub).toBeUndefined();
        expect(eff.timing).toEqual({ kind: "activated", mode: "flash" });
        expect(eff.timingScope).toEqual({ player: "both", period: "attack" });
        expect(eff.applicability).toEqual({ zone: ["hand", "set_aside"] });
        expect(eff.executionMode).toBe("optional");
        const action = eff.steps[0]!.action;
        expect(action.kind).toBe("summon");
        if (action.kind === "summon") {
          expect(action.target).toEqual({
            kind: "self",
            zone: ["hand", "set_aside"],
          });
        }
      }
    );

    it("BSTH11-R01: お互いのアタックステップ中は手札からの自己召喚起動効果が legal action に現れ、通常のメインステップには現れない", () => {
      const def = getCardDefinitionById("BSTH11-R01")!;
      const inHand = createCardInstance(def, {
        instanceId: "r01-hand",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      });
      const findHandSummonEffects = (state: GameState) =>
        getLegalActions({
          state,
          actingPlayerId: ALICE,
          getCardDefinitionById,
          getRegisteredHandActivatedEffectActions,
        }).filter(
          (a): a is Extract<typeof a, { kind: "use_hand_card_effect" }> =>
            a.kind === "use_hand_card_effect" &&
            a.sourceInstanceId === "r01-hand"
        );

      const duringOpponentAttack: GameState = {
        ...createEmptyGameState({
          playerIds: [ALICE, BOB],
          cardInstances: [inHand],
          playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
        }),
        step: "attack",
        activePlayerId: BOB,
        window: "flash_before_block",
        activeAttack: {
          attackId: "attack-group:1:bob:battle-entity:bob-attacker",
          primaryEntityId: "battle-entity:bob-attacker",
          participantEntityIds: ["battle-entity:bob-attacker"],
          groupMode: "single",
          target: { kind: "player", playerId: ALICE },
          blockAssignments: [],
          symbolResolutionOrder: [],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: {
            kind: "before_block",
            priorityPlayerId: ALICE,
            consecutivePassCount: 0,
            stackResponseSourcePlayerId: ALICE,
            pendingStackAction: null,
          },
        },
      };
      expect(findHandSummonEffects(duringOpponentAttack).length).toBe(1);

      const duringMainStep: GameState = {
        ...createEmptyGameState({
          playerIds: [ALICE, BOB],
          cardInstances: [inHand],
          playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
        }),
        step: "main",
        activePlayerId: ALICE,
        window: null,
      };
      expect(findHandSummonEffects(duringMainStep)).toHaveLength(0);
    });

    it("BSTH11-R01: 起動効果宣言後は in_use へ移るが、通常コストは解決窓後まで支払わない", () => {
      const def = getCardDefinitionById("BSTH11-R01")!;
      const inHand = createCardInstance(def, {
        instanceId: "r01-hand",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      });
      const state: GameState = {
        ...createEmptyGameState({
          playerIds: [ALICE, BOB],
          cardInstances: [inHand],
          playerOverrides: [{ reserveNormalCoreCount: 8 }, {}],
        }),
        step: "attack",
        activePlayerId: BOB,
        window: "flash_before_block",
        activeAttack: {
          attackId: "attack-group:1:bob:battle-entity:bob-attacker",
          primaryEntityId: "battle-entity:bob-attacker",
          participantEntityIds: ["battle-entity:bob-attacker"],
          groupMode: "single",
          target: { kind: "player", playerId: ALICE },
          blockAssignments: [],
          symbolResolutionOrder: [],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: {
            kind: "before_block",
            priorityPlayerId: ALICE,
            consecutivePassCount: 0,
            stackResponseSourcePlayerId: ALICE,
            pendingStackAction: null,
          },
        },
      };
      const action = getLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredHandActivatedEffectActions,
      }).find(
        (a): a is Extract<typeof a, { kind: "use_hand_card_effect" }> =>
          a.kind === "use_hand_card_effect" && a.sourceInstanceId === "r01-hand"
      );

      expect(action).toBeDefined();
      expect(action).toMatchObject({
        effectIndex: 0,
        chosenTiming: "flash",
        sourceActivationZone: "hand",
      });

      const after = applyLegalAction({
        state,
        action: action!,
        getCardDefinitionById,
        getRegisteredHandActivatedEffectActions,
        summonPaymentSources: [{ kind: "reserve", amount: def.cost }],
      }).state;

      expect(
        after.cardInstances.find((c) => c.instanceId === "r01-hand")?.zone
      ).toBe("in_use");
      expect(
        after.players.find((player) => player.id === ALICE)
          ?.reserveNormalCoreCount
      ).toBe(8);
      expect(
        after.activeAttack?.flashWindowState.pendingStackAction
      ).toMatchObject({
        actionKind: "hand_card_effect",
        handActivatedEffectIndex: 0,
        sourceActivationZone: "hand",
        summonPaymentSources: [{ kind: "reserve", amount: def.cost }],
      });
    });
  });

  describe("BSTH11-X03/X04 effects[0]: フラッシュ『お互いのアタックステップ』手札/手元にあるこのカードは、自分が契約しておらず、自分のフィールドに系統：「幻想」/「秘神」を持たないカードか緑以外のカードがなければ、軽減シンボルすべてを満たして召喚できる（stub解消、field_all_match primitive新設 ENGINE-universal-field-condition）", () => {
    it.each(Array.from(X03_X04_UNIVERSAL_FIELD_SUMMON_RESOLVED_INDEX_0))(
      "%s: no_contract_card + field_all_match(tribes:幻想/秘神,colors:green) 条件 + summon(target:self,costModifier:full_reduction)",
      (cardNo) => {
        const def = getCardDefinitionById(cardNo)!;
        const eff = def.effects[0]!;
        expect(eff.stub).toBeUndefined();
        expect(eff.timing).toEqual({ kind: "activated", mode: "flash" });
        expect(eff.timingScope).toEqual({ player: "both", period: "attack" });
        expect(eff.applicability).toEqual({ zone: ["hand", "set_aside"] });
        expect(eff.executionMode).toBe("optional");
        expect(eff.condition).toEqual([
          { kind: "no_contract_card", player: "self" },
          {
            kind: "field_all_match",
            player: "self",
            filter: { tribes: ["幻想", "秘神"], colors: ["green"] },
          },
        ]);
        const action = eff.steps[0]!.action;
        expect(action.kind).toBe("summon");
        if (action.kind === "summon") {
          expect(action.target).toEqual({ kind: "self" });
          expect(action.costModifier).toBe("full_reduction");
        }
      }
    );

    const buildState = (opts: {
      contractCardNo?: string | null;
      fieldCards?: CardDefinition[];
    }): GameState => {
      const x03Def = getCardDefinitionById("BSTH11-X03")!;
      const inHand = createCardInstance(x03Def, {
        instanceId: "x03-hand",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "hand",
      });
      const fieldInstances = (opts.fieldCards ?? []).map((fieldDef, i) =>
        createCardInstance(fieldDef, {
          instanceId: `x03-field-${i}`,
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "field",
        })
      );
      return {
        ...createEmptyGameState({
          playerIds: [ALICE, BOB],
          cardInstances: [inHand, ...fieldInstances],
          playerOverrides: [
            {
              reserveNormalCoreCount: 5,
              contractCardNo: opts.contractCardNo ?? null,
            },
            {},
          ],
        }),
        step: "attack",
        activePlayerId: BOB,
        window: "flash_before_block",
        activeAttack: {
          attackId: "attack-group:1:bob:battle-entity:bob-attacker",
          primaryEntityId: "battle-entity:bob-attacker",
          participantEntityIds: ["battle-entity:bob-attacker"],
          groupMode: "single",
          target: { kind: "player", playerId: ALICE },
          blockAssignments: [],
          symbolResolutionOrder: [],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: {
            kind: "before_block",
            priorityPlayerId: ALICE,
            consecutivePassCount: 0,
            stackResponseSourcePlayerId: ALICE,
            pendingStackAction: null,
          },
        },
      };
    };

    const findHandSummonEffects = (state: GameState) =>
      getLegalActions({
        state,
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: () => undefined,
        getRegisteredHandActivatedEffectActions,
      }).filter(
        (a): a is Extract<typeof a, { kind: "use_hand_card_effect" }> =>
          a.kind === "use_hand_card_effect" && a.sourceInstanceId === "x03-hand"
      );

    it("[board] 契約なし + フィールド全カードが条件(系統幻想/秘神 かつ 緑)を満たすとき、自己召喚起動効果が現れる", () => {
      const c01 = getCardDefinitionById("BSTH11-C01")!; // 緑・系統に幻想を含む
      const state = buildState({ contractCardNo: null, fieldCards: [c01] });
      expect(findHandSummonEffects(state).length).toBe(1);
    });

    it("[board] フィールドに条件を満たさないカード(系統幻想/秘神を持たない・緑以外)があると、自己召喚起動効果が消える", () => {
      const violator = getCardDefinitionById("BSKB01-C01")!; // 紫・系統に幻想/秘神を含まない
      const state = buildState({
        contractCardNo: null,
        fieldCards: [violator],
      });
      expect(findHandSummonEffects(state)).toHaveLength(0);
    });

    it("[board] 自分が契約していると、フィールド条件を満たしていても自己召喚起動効果が消える", () => {
      const c01 = getCardDefinitionById("BSTH11-C01")!;
      const state = buildState({
        contractCardNo: "BSTH11-C01",
        fieldCards: [c01],
      });
      expect(findHandSummonEffects(state)).toHaveLength(0);
    });

    it("[board] フィールドにカードが無いとき（空虚に真）、契約が無ければ自己召喚起動効果が現れる", () => {
      const state = buildState({ contractCardNo: null, fieldCards: [] });
      expect(findHandSummonEffects(state).length).toBe(1);
    });
  });

  describe("BSTH11-X01「[創界神]摩多羅 隠岐奈」effects[2]『神域』Lv1-2 前半: field_all_match条件下でnegate(opponent_burst)常駐無効化(stub解消)", () => {
    const def = getCardDefinitionById("BSTH11-X01")!;

    it("構造 = timing:continuous + condition(field_all_match, tribes:幻想/秘神のみ・colors指定なし) + negate(opponent_burst, duration:while_on_field)", () => {
      const eff = def.effects[2]!;
      expect(eff.stub).toBeUndefined();
      expect(eff.timing).toEqual({ kind: "continuous" });
      expect(eff.condition).toEqual([
        {
          kind: "field_all_match",
          player: "self",
          filter: { tribes: ["幻想", "秘神"] },
        },
      ]);
      const action = eff.steps[0]!.action;
      expect(action.kind).toBe("negate");
      if (action.kind === "negate") {
        expect(action.negateTarget).toBe("opponent_burst");
        expect(action.duration).toEqual({ scope: "while_on_field" });
      }
    });

    const hasOpponentBurstNegateCE = (state: GameState) =>
      state.activeContinuousEffects.some(
        (c) =>
          c.modifierTag === "negate_opponent_burst" &&
          c.actingPlayerId === ALICE
      );

    it("[board] 自分のフィールド全カードが条件(系統幻想/秘神を持つ)を満たすとき、negate(opponent_burst) CE が登録される", () => {
      const okina = createCardInstance(def, {
        instanceId: "okina-x01",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      });
      const c01 = getCardDefinitionById("BSTH11-C01")!; // 緑・系統に幻想を含む
      const ally = createCardInstance(c01, {
        instanceId: "ally-c01",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      });
      const state = rebuildContinuousEffectsFromField(
        createEmptyGameState({ cardInstances: [okina, ally] }),
        getCardDefinitionById
      );
      expect(hasOpponentBurstNegateCE(state)).toBe(true);
    });

    it("[board] 緑以外だが系統「幻想」を持つカードがあっても、CE が登録される(X01原文にはX03/X04と異なり色条件が無い)", () => {
      const okina = createCardInstance(def, {
        instanceId: "okina-x01-c",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      });
      const nonGreenGensou = getCardDefinitionById("BSTH001-C01")!; // 赤・系統に幻想を含む
      const ally = createCardInstance(nonGreenGensou, {
        instanceId: "non-green-gensou",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      });
      const state = rebuildContinuousEffectsFromField(
        createEmptyGameState({ cardInstances: [okina, ally] }),
        getCardDefinitionById
      );
      expect(hasOpponentBurstNegateCE(state)).toBe(true);
    });

    it("[board] フィールドに条件を満たさないカード(系統幻想/秘神を持たない)があると、CE が登録されない", () => {
      const okina = createCardInstance(def, {
        instanceId: "okina-x01-b",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      });
      const violator = getCardDefinitionById("BSKB01-C01")!; // 紫・系統に幻想/秘神を含まない
      const ally = createCardInstance(violator, {
        instanceId: "violator-b",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      });
      const state = rebuildContinuousEffectsFromField(
        createEmptyGameState({ cardInstances: [okina, ally] }),
        getCardDefinitionById
      );
      expect(hasOpponentBurstNegateCE(state)).toBe(false);
    });
  });

  describe("BSTH11-X01「[創界神]摩多羅 隠岐奈」effects[3]『神域』Lv1-2 後半: field_all_match条件下でrestrict_recovery(重疲労回復禁止、契約カード/煌臨先除外)常駐(stub解消)", () => {
    const def = getCardDefinitionById("BSTH11-X01")!;

    it("構造 = timing:continuous + condition(field_all_match, tribes:幻想/秘神のみ) + restrict_recovery(player:opponent, filter:category spirit/ultimate/nexus + exclude:isContract|isContractAdventDestination, duration:while_on_field)", () => {
      const eff = def.effects[3]!;
      expect(eff.stub).toBeUndefined();
      expect(eff.timing).toEqual({ kind: "continuous" });
      expect(eff.condition).toEqual([
        {
          kind: "field_all_match",
          player: "self",
          filter: { tribes: ["幻想", "秘神"] },
        },
      ]);
      const action = eff.steps[0]!.action;
      expect(action.kind).toBe("restrict_recovery");
      if (action.kind === "restrict_recovery") {
        expect(action.player).toBe("opponent");
        expect(action.duration).toEqual({ scope: "while_on_field" });
        expect(action.filter).toEqual({
          category: ["spirit", "ultimate", "nexus"],
          exhaustState: "heavily_exhausted",
          exclude: {
            filterOr: [
              { isContract: true },
              { isContractAdventDestination: true },
            ],
          },
        });
      }
    });

    it("構造 steps[1] = suppress_effect(target:filter/count:all/player:opponent, filter:category spirit/ultimate/nexus + exhaustState:heavily_exhausted + exclude:isContract|isContractAdventDestination, duration:while_on_field) — 「その効果は発揮されない」節(回復禁止とは独立、敵対的検証round1で無関係precedent誤引用+未実装を指摘・訂正)", () => {
      const eff = def.effects[3]!;
      expect(eff.steps).toHaveLength(2);
      const action = eff.steps[1]!.action;
      expect(action.kind).toBe("suppress_effect");
      if (action.kind === "suppress_effect") {
        expect(action.duration).toEqual({ scope: "while_on_field" });
        expect(action.target).toEqual({
          kind: "filter",
          player: "opponent",
          count: "all",
          filter: {
            category: ["spirit", "ultimate", "nexus"],
            exhaustState: "heavily_exhausted",
            exclude: {
              filterOr: [
                { isContract: true },
                { isContractAdventDestination: true },
              ],
            },
          },
        });
      }
    });

    const okinaState = (extraCards: CardInstance[]) =>
      rebuildContinuousEffectsFromField(
        createEmptyGameState({
          cardInstances: [
            createCardInstance(def, {
              instanceId: "okina-x01-recov",
              ownerPlayerId: ALICE,
              controllerPlayerId: ALICE,
              zone: "field",
            }),
            createCardInstance(getCardDefinitionById("BSTH11-C01")!, {
              instanceId: "ally-c01-recov",
              ownerPlayerId: ALICE,
              controllerPlayerId: ALICE,
              zone: "field",
            }),
            ...extraCards,
          ],
        }),
        getCardDefinitionById
      );

    it("[board] 条件成立時、相手の重疲労状態の対象カードはリフレッシュステップで回復しない(重疲労のまま)", () => {
      const opponent = createCardInstance(
        getCardDefinitionById("BSTH11-C01")!,
        {
          instanceId: "opp-heavy",
          ownerPlayerId: BOB,
          controllerPlayerId: BOB,
          zone: "field",
          exhaustState: "heavily_exhausted",
        }
      );
      const state = okinaState([opponent]);
      const afterRefresh = refreshExhaustStates(
        state,
        BOB,
        getCardDefinitionById
      );
      expect(
        afterRefresh.cardInstances.find((c) => c.instanceId === "opp-heavy")
          ?.exhaustState
      ).toBe("heavily_exhausted");
    });

    it("[board] 相手の創界神ネクサス(grandwalker)は無印「ネクサス」の既定除外により対象外のため重疲労から通常通り回復する(10_rules/07裁定、BSTH02-C21 precedent、敵対的検証round2でround1のtargetsGrandwalker:true追加を反証・訂正)", () => {
      const opponentGrandwalker = createCardInstance(
        getCardDefinitionById("BSTH11-X01")!,
        {
          instanceId: "opp-grandwalker-heavy",
          ownerPlayerId: BOB,
          controllerPlayerId: BOB,
          zone: "field",
          exhaustState: "heavily_exhausted",
        }
      );
      const state = okinaState([opponentGrandwalker]);
      const afterRefresh = refreshExhaustStates(
        state,
        BOB,
        getCardDefinitionById
      );
      expect(
        afterRefresh.cardInstances.find(
          (c) => c.instanceId === "opp-grandwalker-heavy"
        )?.exhaustState
      ).toBe("exhausted");
    });

    it("[board] 契約カード(isContract)は除外対象のため重疲労から通常通り回復する", () => {
      const opponent = createCardInstance(
        getCardDefinitionById("BSDB01-CX01")!,
        {
          instanceId: "opp-contract",
          ownerPlayerId: BOB,
          controllerPlayerId: BOB,
          zone: "field",
          exhaustState: "heavily_exhausted",
        }
      );
      const state = okinaState([opponent]);
      const afterRefresh = refreshExhaustStates(
        state,
        BOB,
        getCardDefinitionById
      );
      expect(
        afterRefresh.cardInstances.find((c) => c.instanceId === "opp-contract")
          ?.exhaustState
      ).toBe("exhausted");
    });

    it("[board] 契約カードの煌臨先(host, isContractAdventDestination)も除外対象のため通常通り回復する", () => {
      const contractUnder = createCardInstance(
        getCardDefinitionById("BSDB01-CX01")!,
        {
          instanceId: "opp-contract-under",
          ownerPlayerId: BOB,
          controllerPlayerId: BOB,
          zone: "field",
        }
      );
      const host = {
        ...createCardInstance(getCardDefinitionById("BSTH11-C01")!, {
          instanceId: "opp-host",
          ownerPlayerId: BOB,
          controllerPlayerId: BOB,
          zone: "field",
          exhaustState: "heavily_exhausted" as const,
        }),
        underCards: [
          {
            cardInstanceId: "opp-contract-under",
            role: "advent_source" as const,
          },
        ],
      };
      const state = okinaState([contractUnder, host]);
      const afterRefresh = refreshExhaustStates(
        state,
        BOB,
        getCardDefinitionById
      );
      expect(
        afterRefresh.cardInstances.find((c) => c.instanceId === "opp-host")
          ?.exhaustState
      ).toBe("exhausted");
    });

    it("[board] 煌臨元アンダーカード自身(host本体ではない、契約カードでもない)は underCardIds により無印スコープから除外され、restrict_recovery の対象にならず通常通り回復する(field_all_matchと同一スコープ規約、敵対的検証round2指摘で追加)", () => {
      const nestedUnder = createCardInstance(
        getCardDefinitionById("BSTH11-C01")!,
        {
          instanceId: "opp-nested-under",
          ownerPlayerId: BOB,
          controllerPlayerId: BOB,
          zone: "field",
          exhaustState: "heavily_exhausted",
        }
      );
      const host = {
        ...createCardInstance(getCardDefinitionById("BSTH11-C02")!, {
          instanceId: "opp-host-nested",
          ownerPlayerId: BOB,
          controllerPlayerId: BOB,
          zone: "field",
        }),
        underCards: [
          {
            cardInstanceId: "opp-nested-under",
            role: "advent_source" as const,
          },
        ],
      };
      const state = okinaState([nestedUnder, host]);
      const afterRefresh = refreshExhaustStates(
        state,
        BOB,
        getCardDefinitionById
      );
      expect(
        afterRefresh.cardInstances.find(
          (c) => c.instanceId === "opp-nested-under"
        )?.exhaustState
      ).toBe("exhausted");
    });

    it("[board] getCardDefinitionById 未指定なら CE を無視して従来通り回復する(既存呼び出し元との後方互換)", () => {
      const opponent = createCardInstance(
        getCardDefinitionById("BSTH11-C01")!,
        {
          instanceId: "opp-legacy",
          ownerPlayerId: BOB,
          controllerPlayerId: BOB,
          zone: "field",
          exhaustState: "heavily_exhausted",
        }
      );
      const state = okinaState([opponent]);
      const afterRefresh = refreshExhaustStates(state, BOB);
      expect(
        afterRefresh.cardInstances.find((c) => c.instanceId === "opp-legacy")
          ?.exhaustState
      ).toBe("exhausted");
    });

    it("[board] 条件成立時、steps[1] の suppress_effect が動的フィルタ CE(effect_suppression, suppressTargetPlayer:opponent, suppressTargetFilter.exhaustState:heavily_exhausted)として1件登録される", () => {
      const state = okinaState([]);
      const suppressions = state.activeContinuousEffects.filter(
        (ce) =>
          ce.modifierTag === "effect_suppression" &&
          ce.sourceInstanceId === "okina-x01-recov"
      );
      expect(suppressions).toHaveLength(1);
      const ce = suppressions[0]!;
      expect(ce.targetInstanceId).toBeUndefined();
      expect(ce.metadata?.suppressTargetPlayer).toBe("opponent");
      expect(
        (ce.metadata?.suppressTargetFilter as { exhaustState?: string })
          ?.exhaustState
      ).toBe("heavily_exhausted");
    });

    it("[board] 条件不成立時(自分の場に系統幻想/秘神を持たないカードがある)、restrict_recovery/suppress_effect CE のいずれも登録されない(effects[2]の対称テストと同型、敵対的検証round2指摘でカバレッジ追加)", () => {
      const okina = createCardInstance(def, {
        instanceId: "okina-x01-recov-violated",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      });
      const violator = getCardDefinitionById("BSKB01-C01")!; // 紫・系統に幻想/秘神を含まない
      const ally = createCardInstance(violator, {
        instanceId: "violator-recov",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
      });
      const state = rebuildContinuousEffectsFromField(
        createEmptyGameState({ cardInstances: [okina, ally] }),
        getCardDefinitionById
      );
      const sourcedCEs = state.activeContinuousEffects.filter(
        (ce) => ce.sourceInstanceId === "okina-x01-recov-violated"
      );
      expect(
        sourcedCEs.filter((ce) => ce.modifierTag === "prevent_recovery")
      ).toHaveLength(0);
      expect(
        sourcedCEs.filter((ce) => ce.modifierTag === "effect_suppression")
      ).toHaveLength(0);
    });

    it("[filter] CardFilter.exhaustState:'heavily_exhausted' は重疲労状態のカードのみに一致し、通常疲労状態には一致しない(既存'exhausted'は両方に一致する広義フィルタと区別)", () => {
      const heavy = createCardInstance(getCardDefinitionById("BSTH11-C01")!, {
        instanceId: "filter-check-heavy",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        exhaustState: "heavily_exhausted",
      });
      const light = createCardInstance(getCardDefinitionById("BSTH11-C01")!, {
        instanceId: "filter-check-light",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        exhaustState: "exhausted",
      });
      const def01 = getCardDefinitionById("BSTH11-C01")!;
      expect(
        matchesCardFilter(heavy, def01, { exhaustState: "heavily_exhausted" })
      ).toBe(true);
      expect(
        matchesCardFilter(light, def01, { exhaustState: "heavily_exhausted" })
      ).toBe(false);
      expect(
        matchesCardFilter(heavy, def01, { exhaustState: "exhausted" })
      ).toBe(true);
      expect(
        matchesCardFilter(light, def01, { exhaustState: "exhausted" })
      ).toBe(true);
    });
  });

  describe("BSTH11-C05「バックドア」: フラッシュ/スタック自己配置許可 + 系統「幻想」BP付与(stub解消)", () => {
    const def = getCardDefinitionById("BSTH11-C05")!;

    it("effects[0]=フラッシュ自己配置許可 / effects[1]=スタック自己配置許可 / effects[2,3]=BP付与(すべて実装済)", () => {
      expect(def.effects).toHaveLength(4);
      expect(def.effects[0]!.stub).toBeUndefined();
      expect(def.effects[0]!.timing).toEqual({
        kind: "activated",
        mode: "flash",
      });
      expect(def.effects[1]!.stub).toBeUndefined();
      expect(def.effects[1]!.timing).toEqual({
        kind: "activated",
        mode: "stack",
      });
      expect(def.effects[1]!.applicability).toEqual({
        zone: ["hand", "set_aside"],
      });
      expect(def.effects[2]!.stub).toBeUndefined();
      expect(def.effects[3]!.stub).toBeUndefined();
    });

    it("[board] Lv1: 系統「幻想」の自分のスピリットは BP+3000 のみ(Lv2 加算分は乗らない)", () => {
      const backdoor = createCardInstance(def, {
        instanceId: "backdoor-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 0,
      });
      const targetDef = getCardDefinitionById("BSTH11-C01")!; // 系統: 幻想・天璋・妖精, Lv1 BP3000
      const target = createCardInstance(targetDef, {
        instanceId: "target-1",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      const state = rebuildContinuousEffectsFromField(
        createEmptyGameState({ cardInstances: [backdoor, target] }),
        getCardDefinitionById
      );
      expect(
        getEffectiveLevel(state, backdoor, def, getCardDefinitionById)
      ).toBe(1);
      expect(
        getEffectiveBp(state, target, targetDef, getCardDefinitionById)
      ).toBe(3000 + 3000);
    });

    it("[board] Lv2: 系統「幻想」の自分のスピリットは BP+3000 と BP+4000 が重層して+7000される", () => {
      const backdoor = createCardInstance(def, {
        instanceId: "backdoor-2",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      });
      const targetDef = getCardDefinitionById("BSTH11-C01")!;
      const target = createCardInstance(targetDef, {
        instanceId: "target-2",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      const state = rebuildContinuousEffectsFromField(
        createEmptyGameState({ cardInstances: [backdoor, target] }),
        getCardDefinitionById
      );
      expect(
        getEffectiveLevel(state, backdoor, def, getCardDefinitionById)
      ).toBe(2);
      expect(
        getEffectiveBp(state, target, targetDef, getCardDefinitionById)
      ).toBe(3000 + 3000 + 4000);
    });

    it("[board] 系統「幻想」を持たない自分のスピリットにはBPが乗らない", () => {
      const backdoor = createCardInstance(def, {
        instanceId: "backdoor-3",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      });
      // BSKB01-C01: 系統「鋼騎士・剣使」で「幻想」を含まないスピリット。
      const targetDef = getCardDefinitionById("BSKB01-C01")!;
      const target = createCardInstance(targetDef, {
        instanceId: "target-3",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      const state = rebuildContinuousEffectsFromField(
        createEmptyGameState({ cardInstances: [backdoor, target] }),
        getCardDefinitionById
      );
      const baseBp = getEffectiveBp(
        state,
        target,
        targetDef,
        getCardDefinitionById
      );
      expect(baseBp).toBe(targetDef.levelDefs[0]!.bp);
    });

    describe('effects[1] mode:"stack" legal-action 可視性 (手札起動効果 stack-mode gating)', () => {
      function dummyBobStack(): ActiveStack {
        return {
          stackId: "stack:bob-dummy",
          actionKind: "magic",
          chainId: "chain:bob-dummy",
          actingPlayerId: BOB,
          cardInstanceId: "bob-dummy-magic",
          cardDefinitionId: "BOB-DUMMY-MAGIC",
          targetInstanceIds: [],
          targetEffectFilterTags: ["general"],
          previousResponseSourcePlayerId: null,
          previousPendingStackAction: null,
        };
      }

      function findBackdoorHandEffects(state: GameState, playerId: string) {
        return getLegalActions({
          state,
          actingPlayerId: playerId,
          getCardDefinitionById,
          getRegisteredHandActivatedEffectActions,
        }).filter(
          (a): a is Extract<typeof a, { kind: "use_hand_card_effect" }> =>
            a.kind === "use_hand_card_effect" &&
            a.sourceInstanceId === "backdoor-hand"
        );
      }

      function baseStateWithBackdoorInHand(): GameState {
        const backdoor = createCardInstance(def, {
          instanceId: "backdoor-hand",
          ownerPlayerId: ALICE,
          controllerPlayerId: ALICE,
          zone: "hand",
        });
        return createEmptyGameState({
          playerIds: [ALICE, BOB],
          cardInstances: [backdoor],
          playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
        });
      }

      it("トップレベル stackWindow 応答窓 (優先権あり): mode:stack の手札起動効果が出る", () => {
        const state: GameState = {
          ...baseStateWithBackdoorInHand(),
          step: "main",
          activePlayerId: BOB,
          window: "stack",
          stackWindow: {
            priorityPlayerId: ALICE,
            consecutivePassCount: 0,
            actingPlayerId: BOB,
            previousWindow: "main",
            stackResponseSourcePlayerId: BOB,
            subStackEverOpened: false,
            burstWindowKind: null,
            pendingStackAction: dummyBobStack(),
          },
        };
        const actions = findBackdoorHandEffects(state, ALICE);
        expect(actions.length).toBe(1);
        expect(actions[0]?.effectIndex).toBe(1);
        expect(actions[0]?.chosenTiming).toBe("stack");
      });

      it("トップレベル stackWindow 応答窓だが優先権が無いプレイヤーには出ない", () => {
        const state: GameState = {
          ...baseStateWithBackdoorInHand(),
          step: "main",
          activePlayerId: BOB,
          window: "stack",
          stackWindow: {
            priorityPlayerId: BOB,
            consecutivePassCount: 0,
            actingPlayerId: BOB,
            previousWindow: "main",
            stackResponseSourcePlayerId: BOB,
            subStackEverOpened: false,
            burstWindowKind: null,
            pendingStackAction: dummyBobStack(),
          },
        };
        expect(findBackdoorHandEffects(state, ALICE)).toHaveLength(0);
      });

      it("バトルフラッシュ sub-stack 窓 (activeAttack.flashWindowState.pendingStackAction) でも出る", () => {
        const state: GameState = {
          ...baseStateWithBackdoorInHand(),
          step: "attack",
          activePlayerId: BOB,
          window: "stack_before_block",
          activeAttack: {
            attackId: "attack-group:1:bob:battle-entity:bob-attacker",
            primaryEntityId: "battle-entity:bob-attacker",
            participantEntityIds: ["battle-entity:bob-attacker"],
            groupMode: "single",
            target: { kind: "player", playerId: ALICE },
            blockAssignments: [],
            symbolResolutionOrder: [],
            flashBeforeBlockCompleted: false,
            flashAfterBlockCompleted: false,
            flashWindowState: {
              kind: "before_block",
              priorityPlayerId: ALICE,
              consecutivePassCount: 0,
              stackResponseSourcePlayerId: BOB,
              pendingStackAction: dummyBobStack(),
            },
          },
        };
        const actions = findBackdoorHandEffects(state, ALICE);
        expect(actions.length).toBe(1);
        expect(actions[0]?.effectIndex).toBe(1);
        expect(actions[0]?.chosenTiming).toBe("stack");
      });

      it("preDeclarationStackWindow 応答窓 (宣言前スタック) でも出る", () => {
        const state: GameState = {
          ...baseStateWithBackdoorInHand(),
          step: "attack",
          activePlayerId: BOB,
          window: "pre_declaration_stack",
          preDeclarationStackWindow: {
            kind: "attack",
            actingPlayerId: BOB,
            sourceInstanceId: "bob-attacker",
            previousWindow: "attack",
            priorityPlayerId: ALICE,
            consecutivePassCount: 0,
            stackResponseSourcePlayerId: BOB,
            pendingStackAction: dummyBobStack(),
          },
        };
        const actions = findBackdoorHandEffects(state, ALICE);
        expect(actions.length).toBe(1);
        expect(actions[0]?.effectIndex).toBe(1);
        expect(actions[0]?.chosenTiming).toBe("stack");
      });

      it("通常の自分のメインステップ (スタック/フラッシュ窓なし) では mode:flash(effects[0]) のみ出て mode:stack(effects[1]) は出ない (誤配線防止の回帰確認)", () => {
        // 自分のメインステップは canEnumerateMainHandCardActions=true により
        // raw=["main","flash"] となり、mode:"flash" の effects[0] は既存挙動として
        // ここでも提示される (pre-existing)。今回の修正対象は mode:"stack" が
        // ここに誤って漏れ出さないことの確認。
        const state: GameState = {
          ...baseStateWithBackdoorInHand(),
          step: "main",
          activePlayerId: ALICE,
          window: null,
        };
        const actions = findBackdoorHandEffects(state, ALICE);
        expect(actions.length).toBe(1);
        expect(actions[0]?.effectIndex).toBe(0);
        expect(actions[0]?.chosenTiming).toBe("flash");
      });

      it("フラッシュ窓で自分が flash 役 (stackResponseSourcePlayerId=自分) のときは mode:flash(effects[0]) のみ出て mode:stack(effects[1]) は出ない (誤配線防止の回帰確認)", () => {
        const state: GameState = {
          ...baseStateWithBackdoorInHand(),
          step: "attack",
          activePlayerId: ALICE,
          window: "flash_before_block",
          activeAttack: {
            attackId: "attack-group:1:alice:battle-entity:alice-attacker",
            primaryEntityId: "battle-entity:alice-attacker",
            participantEntityIds: ["battle-entity:alice-attacker"],
            groupMode: "single",
            target: { kind: "player", playerId: BOB },
            blockAssignments: [],
            symbolResolutionOrder: [],
            flashBeforeBlockCompleted: false,
            flashAfterBlockCompleted: false,
            flashWindowState: {
              kind: "before_block",
              priorityPlayerId: ALICE,
              consecutivePassCount: 0,
              stackResponseSourcePlayerId: ALICE,
              pendingStackAction: null,
            },
          },
        };
        // stackResponseSourcePlayerId=ALICE (自分がこのフラッシュ窓の flash 役) のとき
        // raw=["flash"] となり、effects[0] (mode:flash) の place_nexus 許可のみが出る。
        // mode:stack の許可はここには混ざらない（誤配線が起きればここで2件になる）。
        const actions = findBackdoorHandEffects(state, ALICE);
        expect(actions.length).toBe(1);
        expect(actions[0]?.effectIndex).toBe(0);
        expect(actions[0]?.chosenTiming).toBe("flash");
      });
    });
  });
});

// BSTH08.5-X03: tribe「創界神・面霊・秘神」+ grandwalkerData.kind:"grandwalker" 既存フィクスチャ
// (=「系統：「秘神」を持つ創界神ネクサスカード」pick 用)。
const GRANDWALKER_HIMEGAMI_NEXUS = cardNoMap.get("BSTH08.5-X03")!;
const noTriggerLookup = () => [];

describe("BSTH11-C01/C02 effects[1]『このスピリットの召喚/アタック(ブロック)時』ゲームに1回 コア任意配置+deck_reveal(秘神創界神ネクサス1/天璋1, remainder:bottom)", () => {
  it.each([
    ["BSTH11-C01", ["summon", "attack"]],
    ["BSTH11-C02", ["summon", "block"]],
  ] as const)(
    "%s: 構造 = card_event(%s) + usageLimit(per_instance/game) + 2 steps(void核任意配置/deck_reveal)",
    (cardNo, events) => {
      const def = getCardDefinitionById(cardNo)!;
      const effect = def.effects[1]!;
      expect(effect.stub).toBeUndefined();
      expect(effect.timing).toEqual({ kind: "card_event", event: [...events] });
      expect(effect.usageLimit).toEqual({
        kind: "per_instance",
        duration: "game",
      });
      expect(effect.steps).toHaveLength(2);
      const reveal = effect.steps[1]!.action;
      expect(reveal.kind).toBe("deck_reveal");
      if (reveal.kind === "deck_reveal") {
        expect(reveal.revealCount).toBe(3);
        expect(reveal.remainder).toBe("bottom");
        expect(reveal.picks).toEqual([
          {
            count: 1,
            mandatory: true,
            filter: {
              category: ["nexus"],
              tribes: ["秘神"],
              targetsGrandwalker: true,
              hasMechanic: ["grandwalker"],
            },
          },
          { count: 1, mandatory: true, filter: { tribes: ["天璋"] } },
        ]);
      }
    }
  );

  it("BSTH11-C01 実行: デッキ上3枚中、秘神創界神ネクサス1枚+天璋カード1枚が手札へ、残り1枚はデッキの下へ（zone維持）", () => {
    const def = getCardDefinitionById("BSTH11-C01")!;
    const src = createCardInstance(def, {
      instanceId: "c01-src",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const nexusPick = createCardInstance(GRANDWALKER_HIMEGAMI_NEXUS, {
      instanceId: "deck-nexus",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const tenshoPick = createCardInstance(
      getCardDefinitionById("BSTH11-R01")!,
      {
        instanceId: "deck-tensho",
        ownerPlayerId: ALICE,
        zone: "deck",
      }
    );
    const filler = createCardInstance(getCardDefinitionById("BSTH11-C04")!, {
      instanceId: "deck-filler",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, nexusPick, tenshoPick, filler],
    });
    const effect = def.effects[1]!;
    const afterTrigger = executeEffect({
      chainId: "test:bsth11-cards:1468",
      state,
      effect,
      sourceInstanceId: "c01-src",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    // 先頭 step (void核任意配置) は executionMode:"optional" のため resolve_pending_step_optional_choice
    // で execute/decline を選ぶ pending が先に立つ (BSDB01 系 precedent と同じ2 step 構成の挙動)。
    // ここでは decline し、deck_reveal 側の検証に専念する。
    const declineVoidCore = getLegalActions({
      state: afterTrigger,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "decline"
    );
    expect(declineVoidCore).toBeDefined();
    let afterDecline = applyLegalAction({
      state: afterTrigger,
      action: declineVoidCore!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    const openDeck = getLegalActions({
      state: afterDecline,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    )!;
    afterDecline = applyLegalAction({
      state: afterDecline,
      action: openDeck,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(afterDecline.pendingDeckReveal).not.toBeNull();

    // picks は2グループ独立 (各 count:1) のため resolve_pending_deck_reveal_pick を
    // pick グループ毎に順番に解決する (BSTH003-C01 型 picks[2件] precedent と同じ挙動)。
    const pick1Action = getLegalActions({
      state: afterDecline,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
    expect(pick1Action).toBeDefined();
    const afterPick1 = applyLegalAction({
      state: afterDecline,
      action: pick1Action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      selectedDeckRevealCardIds: ["deck-nexus"],
    }).state;

    const pick2Action = getLegalActions({
      state: afterPick1,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
    expect(pick2Action).toBeDefined();
    const after = applyLegalAction({
      state: afterPick1,
      action: pick2Action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      selectedDeckRevealCardIds: ["deck-tensho"],
    }).state;

    expect(after.pendingDeckReveal).toBeNull();
    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-nexus")!.zone
    ).toBe("hand");
    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-tensho")!.zone
    ).toBe("hand");
    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-filler")!.zone
    ).toBe("deck");
  });
});

describe.each(["BSTH11-C01", "BSTH11-C02"])(
  "%s effects[2] Lv1-2：フラッシュ〔ターンに1回：同名〕系統「幻想」コスト3/4以外の自分のスピリット1体を手札/手元に戻せる(stub解消)",
  (cardNo) => {
    it("構造 = activated/flash + usageLimit(per_card_name/turn) + bounce(filter:tribes幻想+excludeCosts[3,4]) + choice(destination:set_aside)", () => {
      const def = getCardDefinitionById(cardNo)!;
      const effect = def.effects[2]!;
      expect(effect.stub).toBeUndefined();
      expect(effect.timing).toEqual({ kind: "activated", mode: "flash" });
      expect(effect.executionMode).toBe("optional");
      expect(effect.usageLimit).toEqual({
        kind: "per_card_name",
        duration: "turn",
      });
      const step = effect.steps[0]!;
      const action = step.action;
      expect(action.kind).toBe("bounce");
      if (action.kind === "bounce" && action.target.kind === "filter") {
        expect(action.target.player).toBe("self");
        expect(action.target.filter).toEqual({
          category: ["spirit"],
          tribes: ["幻想"],
          excludeCosts: [3, 4],
        });
        expect(action.target.count).toBe(1);
        expect(action.destination).toBe("hand");
      }
      const altAction = step.choice?.[0]?.action;
      expect(altAction?.kind).toBe("bounce");
      if (altAction?.kind === "bounce") {
        expect(altAction.destination).toBe("set_aside");
      }
    });

    it("[board] 実行(既定 destination:hand): コスト3/4以外の系統「幻想」自分スピリット1体が手札へ戻る(このカード自身はコスト3で自動除外)", () => {
      const def = getCardDefinitionById(cardNo)!;
      const source = createCardInstance(def, {
        instanceId: "bounce-source",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      const targetDef = getCardDefinitionById("BSTH11-R02")!; // 系統:幻想・天璋・山姥, cost5
      const target = createCardInstance(targetDef, {
        instanceId: "bounce-target",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      const state = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [source, target],
      });
      const afterEffect = executeEffect({
        chainId: "test:bsth11-cards:1609",
        state,
        effect: def.effects[2]!,
        sourceInstanceId: "bounce-source",
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      });
      const after = flushPendingLeaves(afterEffect, getCardDefinitionById);
      expect(
        after.cardInstances.find((c) => c.instanceId === "bounce-target")!.zone
      ).toBe("hand");
      // 発動元自身(コスト3)は excludeCosts:[3,4] で対象から除外され場に残る。
      expect(
        after.cardInstances.find((c) => c.instanceId === "bounce-source")!.zone
      ).toBe("field");
    });
  }
);

describe("BSTH11-C03 effects[1]『このスピリットの召喚時』コア任意配置(系統幻想の自分スピリット)+〔ターンに1回:同名〕自分が契約していなければdeck_reveal(幻想/秘神の緑2枚, remainder:bottom)", () => {
  it("構造 = card_event(summon) + steps[1]がcondition:no_contract_card + usageLimit(per_card_name/turn)", () => {
    const def = getCardDefinitionById("BSTH11-C03")!;
    const effect = def.effects[1]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(effect.steps).toHaveLength(2);
    const revealStep = effect.steps[1]!;
    expect(revealStep.condition).toEqual([{ kind: "no_contract_card" }]);
    expect(revealStep.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 1,
    });
    const reveal = revealStep.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind === "deck_reveal") {
      expect(reveal.revealCount).toBe(4);
      expect(reveal.remainder).toBe("bottom");
      expect(reveal.picks).toEqual([
        {
          count: 2,
          mandatory: true,
          filter: { tribes: ["幻想", "秘神"], colors: ["green"] },
        },
      ]);
    }
  });

  it("実行(自分が未契約): デッキ上4枚中、緑/幻想系統2枚が手札へ、残り2枚はデッキの下へ（zone維持）", () => {
    const def = getCardDefinitionById("BSTH11-C03")!;
    const src = createCardInstance(def, {
      instanceId: "c03-src",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    // BSTH11-C01/C02: colors:["green"], tribe に「幻想」を含む pick 対象フィクスチャ。
    const pickA = createCardInstance(getCardDefinitionById("BSTH11-C01")!, {
      instanceId: "deck-pick-a",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const pickB = createCardInstance(getCardDefinitionById("BSTH11-C02")!, {
      instanceId: "deck-pick-b",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const fillerA = createCardInstance(getCardDefinitionById("BSTH11-C04")!, {
      instanceId: "deck-filler-a",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const fillerB = createCardInstance(getCardDefinitionById("BSTH11-C04")!, {
      instanceId: "deck-filler-b",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [src, pickA, pickB, fillerA, fillerB],
    });
    const effect = def.effects[1]!;
    const afterTrigger = executeEffect({
      chainId: "test:bsth11-cards:1692",
      state,
      effect,
      sourceInstanceId: "c03-src",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    // 先頭 step (void核任意配置) は executionMode:"optional" のため resolve_pending_step_optional_choice
    // で execute/decline を選ぶ pending が先に立つ (BSDB01 系 precedent と同じ2 step 構成の挙動)。
    // ここでは decline し、deck_reveal 側の検証に専念する。
    const declineVoidCore = getLegalActions({
      state: afterTrigger,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "decline"
    );
    expect(declineVoidCore).toBeDefined();
    const afterDeclineVoidCore = applyLegalAction({
      state: afterTrigger,
      action: declineVoidCore!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;

    // deck_reveal 側 step も executionMode:"optional" (「自分が契約していなければ〜できる」)
    // のため、こちらは execute を選んでデッキオープンへ進む。
    const executeReveal = getLegalActions({
      state: afterDeclineVoidCore,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    expect(executeReveal).toBeDefined();
    const afterDecline = applyLegalAction({
      state: afterDeclineVoidCore,
      action: executeReveal!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(afterDecline.pendingDeckReveal).not.toBeNull();

    const pick1Action = getLegalActions({
      state: afterDecline,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
    expect(pick1Action).toBeDefined();
    const afterPick1 = applyLegalAction({
      state: afterDecline,
      action: pick1Action!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      selectedDeckRevealCardIds: ["deck-pick-a", "deck-pick-b"],
    }).state;

    // remainder:"bottom" かつ残りカード2枚以上のため、デッキの下へ戻す順番指定 pending が
    // 別途立つ（残り1枚のみだった C01 テストでは順序が一意なため発生しない）。
    const orderAction = getLegalActions({
      state: afterPick1,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_order");
    expect(orderAction).toBeDefined();
    const after = applyLegalAction({
      state: afterPick1,
      action: orderAction!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      selectedDeckRevealCardIds: ["deck-filler-a", "deck-filler-b"],
    }).state;

    expect(after.pendingDeckReveal).toBeNull();
    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-pick-a")!.zone
    ).toBe("hand");
    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-pick-b")!.zone
    ).toBe("hand");
    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-filler-a")!.zone
    ).toBe("deck");
    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-filler-b")!.zone
    ).toBe("deck");
  });
});

describe("BSTH11-R01「エタニティ・ラルバ」effects[2] Lv2-3「このスピリットのコストは5として扱う」(stub解消)", () => {
  const def = getCardDefinitionById("BSTH11-R01")!;

  it("effects[2] は override_properties + min_level 継続ゲートで実装済(stubではない)", () => {
    expect(def.effects[2]!.stub).toBeUndefined();
    expect(def.effects[2]!.condition).toEqual([
      { kind: "min_level", value: 2 },
    ]);
  });

  it("[board] Lv1(コア1個): 印字コスト4のまま", () => {
    const card = createCardInstance(def, {
      instanceId: "ralva-lv1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({ cardInstances: [card] }),
      getCardDefinitionById
    );
    expect(getEffectiveLevel(state, card, def, getCardDefinitionById)).toBe(1);
    expect(getEffectiveCost(state, card, def, getCardDefinitionById)).toBe(4);
  });

  it("[board] Lv2(コア3個): コストは5として扱われる", () => {
    const card = createCardInstance(def, {
      instanceId: "ralva-lv2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({ cardInstances: [card] }),
      getCardDefinitionById
    );
    expect(getEffectiveLevel(state, card, def, getCardDefinitionById)).toBe(2);
    expect(getEffectiveCost(state, card, def, getCardDefinitionById)).toBe(5);
  });

  it("[board] Lv3(コア4個): コストは5として扱われる(Lv2-3の範囲内)", () => {
    const card = createCardInstance(def, {
      instanceId: "ralva-lv3",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 4,
    });
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({ cardInstances: [card] }),
      getCardDefinitionById
    );
    expect(getEffectiveLevel(state, card, def, getCardDefinitionById)).toBe(3);
    expect(getEffectiveCost(state, card, def, getCardDefinitionById)).toBe(5);
  });
});

describe("BSTH11-R02「坂田 ネムノ」effects[2] Lv2-3『相手のアタックステップ』重疲労状態の相手のスピリット/アルティメットのシンボルを0に固定し、対象のシンボルはこの効果以外の効果を受けない(stub解消、ENGINE-symbol-lock-self-effect-immunity)", () => {
  const def = getCardDefinitionById("BSTH11-R02")!;

  it("effects[2] は override_properties(symbols固定) + effect_immunity(restrictedAspects:['symbols']) で実装済(stubではない)", () => {
    expect(def.effects[2]!.stub).toBeUndefined();
    expect(def.effects[2]!.condition).toEqual([
      { kind: "min_level", value: 2 },
      { kind: "no_contract_card" },
    ]);
  });

  function setUp() {
    const nemuno = createCardInstance(def, {
      instanceId: "nemuno-lv2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3, // Lv2
    });
    const bobExhausted = createCardInstance(
      getCardDefinitionById("BSSL01-M01")!,
      {
        instanceId: "bob-heavily-exhausted",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "heavily_exhausted",
      }
    );
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [nemuno, bobExhausted],
      }),
      step: "attack",
      activePlayerId: BOB,
    };
    return rebuildContinuousEffectsFromField(state, getCardDefinitionById);
  }

  it("[board] 相手のアタックステップ中、重疲労状態の相手スピリットのシンボルが0個に固定される", () => {
    const state = setUp();
    const target = state.cardInstances.find(
      (c) => c.instanceId === "bob-heavily-exhausted"
    )!;
    expect(
      getEffectiveSymbols(
        state,
        target,
        getCardDefinitionById("BSSL01-M01"),
        getCardDefinitionById
      )
    ).toEqual([]);
  });

  it("[board] 相手のターン(アタックステップ以外)や自分のアタックステップ中は固定されない(timingScope player:opponent,period:attack)", () => {
    const nemuno = createCardInstance(def, {
      instanceId: "nemuno-lv2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const bobExhausted = createCardInstance(
      getCardDefinitionById("BSSL01-M01")!,
      {
        instanceId: "bob-heavily-exhausted",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "heavily_exhausted",
      }
    );
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [nemuno, bobExhausted],
      }),
      step: "attack",
      activePlayerId: ALICE, // 自分のアタックステップ = timingScope不成立
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const target = rebuilt.cardInstances.find(
      (c) => c.instanceId === "bob-heavily-exhausted"
    )!;
    expect(
      getEffectiveSymbols(
        rebuilt,
        target,
        getCardDefinitionById("BSSL01-M01"),
        getCardDefinitionById
      )
    ).toEqual(["purple"]);
  });

  it("固定されたシンボルは他の効果(aspect:'symbols')を受けないが、他アスペクト(aspect未指定)には免疫が成立しない", () => {
    const state = setUp();
    const target = state.cardInstances.find(
      (c) => c.instanceId === "bob-heavily-exhausted"
    )!;
    const otherSource: CardDefinition = getCardDefinitionById("BSDB01-C05")!;
    // 発生源が相手(BOB, target所有者と同じ)/自分(ALICE)いずれでも、aspect:"symbols"
    // 指定時は immune (sourcePlayerScope:"any")。
    expect(
      isCardImmuneToOpponentEffect(
        state,
        target,
        ALICE,
        "none",
        { definition: otherSource },
        undefined,
        undefined,
        "symbols"
      )
    ).toBe(true);
    expect(
      isCardImmuneToOpponentEffect(
        state,
        target,
        BOB,
        "none",
        { definition: otherSource },
        undefined,
        undefined,
        "symbols"
      )
    ).toBe(true);
    // aspect 未指定(=symbols以外を書き換える効果、例: BP変更)は restrictedAspects 不一致で
    // このCEをスキップするため immune ではない。
    expect(
      isCardImmuneToOpponentEffect(state, target, ALICE, "none", {
        definition: otherSource,
      })
    ).toBe(false);
  });
});

describe('ENGINE-effect-immunity-global-ce-fast-path-bypass: count:"all" filter-target dynamic global override_properties CE の restrictedAspects 免疫伝播', () => {
  // BSTH11-R02 effects[2] の symbols 固定 (count:"all" filter target, while_on_field
  // dynamic global CE) を「相手の効果」として使い、対象カード (bob) 自身に
  // defense_immune(restrictedAspects) を直接付与して、globalOverridePropertiesCanAffectCard
  // (legal-actions-shared.ts) が effectAspect を正しく伝播するかを検証する。
  // 修正前は effectAspect 未伝播のため restrictedAspects 付き CE が常にスキップされ、
  // 部分免疫のカードでもシンボルが素通りで固定されていた。
  const nemunoDef = getCardDefinitionById("BSTH11-R02")!;
  const bobDef = getCardDefinitionById("BSSL01-M01")!;

  function setUpWithBobImmunity(restrictedAspects: string[] | undefined) {
    const nemuno = createCardInstance(nemunoDef, {
      instanceId: "nemuno-lv2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3, // Lv2
    });
    const bobExhausted = createCardInstance(bobDef, {
      instanceId: "bob-heavily-exhausted",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
      exhaustState: "heavily_exhausted",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [nemuno, bobExhausted],
      }),
      step: "attack",
      activePlayerId: BOB,
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    if (!restrictedAspects) return rebuilt;
    const immunityCe: ContinuousEffect = {
      effectId: "test-defense-immune-1",
      sourceInstanceId: bobExhausted.instanceId,
      sourceDefinitionId: bobDef.cardNo,
      actingPlayerId: BOB,
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "defense_immune",
      targetInstanceId: bobExhausted.instanceId,
      immunitySourceScope: { restrictedAspects },
      immunityPlayerScope: "any",
    };
    return {
      ...rebuilt,
      activeContinuousEffects: [...rebuilt.activeContinuousEffects, immunityCe],
    };
  }

  it("restrictedAspects:['symbols'] の免疫を持つ対象は相手のシンボル固定 dynamic global CE を受けない(修正前は effectAspect 未伝播で素通りしていたギャップ)", () => {
    const state = setUpWithBobImmunity(["symbols"]);
    const target = state.cardInstances.find(
      (c) => c.instanceId === "bob-heavily-exhausted"
    )!;
    expect(
      getEffectiveSymbols(state, target, bobDef, getCardDefinitionById)
    ).toEqual(["purple"]);
  });

  it("restrictedAspects が別アスペクト(['bp'])だと不一致でスキップされ、シンボル固定は従来通り適用される(aspect照合が機能している対照実験)", () => {
    const state = setUpWithBobImmunity(["bp"]);
    const target = state.cardInstances.find(
      (c) => c.instanceId === "bob-heavily-exhausted"
    )!;
    expect(
      getEffectiveSymbols(state, target, bobDef, getCardDefinitionById)
    ).toEqual([]);
  });

  it("免疫が無ければ従来通りシンボル固定される(回帰確認)", () => {
    const state = setUpWithBobImmunity(undefined);
    const target = state.cardInstances.find(
      (c) => c.instanceId === "bob-heavily-exhausted"
    )!;
    expect(
      getEffectiveSymbols(state, target, bobDef, getCardDefinitionById)
    ).toEqual([]);
  });
});

describe("BSTH11-R01/R02 effects[1]『召喚(/アタック/ブロック)時』void核任意配置 + 条件付き重疲労(stub解消)", () => {
  it("BSTH11-R01: card_event(summon,attack,block) + 2 steps(void核任意配置/no_contract_card重疲労)", () => {
    const def = getCardDefinitionById("BSTH11-R01")!;
    const effect = def.effects[1]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({
      kind: "card_event",
      event: ["summon", "attack", "block"],
    });
    expect(effect.steps).toHaveLength(2);
    const coreMove = effect.steps[0]!.action;
    expect(coreMove.kind).toBe("core_move");
    const exhaust = effect.steps[1]!.action;
    expect(exhaust.kind).toBe("exhaust");
    if (exhaust.kind === "exhaust") {
      expect(exhaust.degree).toBe("heavy_exhaust");
    }
    expect(effect.steps[1]!.condition).toEqual([{ kind: "no_contract_card" }]);
  });

  it("BSTH11-R02: card_event(summon) + condition:no_contract_card + core_move(void→天璋系統2個)", () => {
    const def = getCardDefinitionById("BSTH11-R02")!;
    const effect = def.effects[1]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(effect.condition).toEqual([{ kind: "no_contract_card" }]);
    expect(effect.steps).toHaveLength(1);
    const coreMove = effect.steps[0]!.action;
    expect(coreMove.kind).toBe("core_move");
    if (coreMove.kind === "core_move") {
      expect(coreMove.amount).toBe(2);
      expect(coreMove.to).toMatchObject({
        kind: "field_card",
        player: "self",
        filter: { category: ["spirit"], tribes: ["天璋"] },
      });
    }
  });

  it("[board] BSTH11-R01実行: 未契約時、void核任意配置を諾→自分のスピリットにコア+1、続けて相手1体を重疲労", () => {
    const def = getCardDefinitionById("BSTH11-R01")!;
    const self = createCardInstance(def, {
      instanceId: "r01-self",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy = createCardInstance(getCardDefinitionById("BSTH11-C01")!, {
      instanceId: "r01-enemy",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [self, enemy],
      playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
    });
    const afterTrigger = executeEffect({
      chainId: "test:bsth11-cards:2136",
      state,
      effect: def.effects[1]!,
      sourceInstanceId: "r01-self",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const acceptVoidCore = getLegalActions({
      state: afterTrigger,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    expect(acceptVoidCore).toBeDefined();
    const afterCore = applyLegalAction({
      state: afterTrigger,
      action: acceptVoidCore!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(
      afterCore.cardInstances.find((c) => c.instanceId === "r01-self")!
        .normalCoreCount
    ).toBe(2);

    const acceptExhaust = getLegalActions({
      state: afterCore,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    expect(acceptExhaust).toBeDefined();
    const afterExhaust = applyLegalAction({
      state: afterCore,
      action: acceptExhaust!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(
      afterExhaust.cardInstances.find((c) => c.instanceId === "r01-enemy")!
        .exhaustState
    ).toBe("heavily_exhausted");
  });

  it("[board] BSTH11-R02実行: 契約カードがある場合、no_contract_card条件が成立せず何も起きない", () => {
    const def = getCardDefinitionById("BSTH11-R02")!;
    const self = createCardInstance(def, {
      instanceId: "r02-self",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // 契約状態は GameState.players[].contractCardNo (playerOverrides 経由) が SSOT。
    // カードインスタンス側に契約フラグは存在しない (BSRK01 precedent と同型)。
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [self],
      playerOverrides: [
        { reserveNormalCoreCount: 5, contractCardNo: "BSTH11-C01" },
        {},
      ],
    });
    const after = executeEffect({
      chainId: "test:bsth11-cards:2206",
      state,
      effect: def.effects[1]!,
      sourceInstanceId: "r02-self",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(after.pendingCoreDistribution).toBeNull();
    expect(
      after.cardInstances.find((c) => c.instanceId === "r02-self")!
        .normalCoreCount
    ).toBe(1);
  });
});

describe("BSTH11-M01 effects[1]『このスピリットの召喚時』void核任意配置(天璋2個) + 〔ターンに1回:同名〕1コスト固定召喚(stub解消)", () => {
  it("card_event(summon) + 2 steps(void核2個配置/turn限定fixedPayment:1召喚)", () => {
    const def = getCardDefinitionById("BSTH11-M01")!;
    const effect = def.effects[1]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "card_event", event: ["summon"] });
    expect(effect.steps).toHaveLength(2);
    const coreMove = effect.steps[0]!.action;
    expect(coreMove.kind).toBe("core_move");
    if (coreMove.kind === "core_move") {
      expect(coreMove.amount).toBe(2);
      expect(coreMove.to).toMatchObject({
        kind: "field_card",
        player: "self",
        filter: { category: ["spirit"], tribes: ["天璋"] },
      });
    }
    expect(effect.steps[1]!.connector).toBe("sequential");
    expect(effect.steps[1]!.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    const summon = effect.steps[1]!.action;
    expect(summon.kind).toBe("summon");
    if (summon.kind === "summon") {
      expect(summon.costModifier).toEqual({ fixedPayment: 1 });
      expect(summon.target).toMatchObject({
        kind: "from_zone",
        zone: ["hand", "set_aside"],
        filter: {
          category: ["spirit", "ultimate", "brave"],
          tribes: ["天璋"],
          maxCost: 7,
        },
      });
    }
  });

  it("[board] BSTH11-M01実行: void核任意配置を諾→自分の天璋スピリットにコア+2、続けて手札の天璋スピリットを1コストで召喚", () => {
    const def = getCardDefinitionById("BSTH11-M01")!;
    const self = createCardInstance(def, {
      instanceId: "m01-self",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const coreTarget = createCardInstance(
      getCardDefinitionById("BSTH11-C01")!,
      {
        instanceId: "m01-core-target",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      }
    );
    const handCard = createCardInstance(getCardDefinitionById("BSTH11-C01")!, {
      instanceId: "m01-hand-card",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [self, coreTarget, handCard],
      playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
    });
    const afterTrigger = executeEffectWithChosenMinimumCores({
      chainId: "test:bsth11-cards:2290",
      state,
      effect: def.effects[1]!,
      sourceInstanceId: "m01-self",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const acceptVoidCore = getLegalActions({
      state: afterTrigger,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    expect(acceptVoidCore).toBeDefined();
    const afterAccept = applyLegalAction({
      state: afterTrigger,
      action: acceptVoidCore!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    // 2個の配置先候補 (m01-self / m01-core-target、いずれも系統天璋) があるため
    // pendingCoreDistribution が開く。coreTarget へ2個とも配分する。
    expect(afterAccept.pendingCoreDistribution).not.toBeNull();
    const distributeAction = getLegalActions({
      state: afterAccept,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_core_distribution");
    expect(distributeAction).toBeDefined();
    const afterCore = applyLegalAction({
      state: afterAccept,
      action: distributeAction!,
      coreDistributionAllocations: { "m01-core-target": 2 },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(afterCore.pendingCoreDistribution).toBeNull();
    expect(
      afterCore.cardInstances.find((c) => c.instanceId === "m01-core-target")!
        .normalCoreCount
    ).toBe(3);

    const acceptSummon = getLegalActions({
      state: afterCore,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    expect(acceptSummon).toBeDefined();
    const afterSummonAccept = applyLegalAction({
      state: afterCore,
      action: acceptSummon!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    // 候補が1枚のみのため対象選択は自動確定、コスト支払い(fixedPayment:1)の
    // pending が残る場合は reserve から支払う legal action を確認する。
    const finalState = finishCoreChoices(
      afterSummonAccept,
      getCardDefinitionById
    );
    expect(
      finalState.cardInstances.find((c) => c.instanceId === "m01-hand-card")!
        .zone
    ).toBe("field");
  });
});

describe("BSTH11-M01 effects[2]『系統天璋のLvを1つ上として扱う』(stub解消)", () => {
  const def = getCardDefinitionById("BSTH11-M01")!;

  it("継続効果 = override_properties level:{delta:1} + tribes:天璋フィルタ", () => {
    const effect = def.effects[2]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "continuous" });
    expect(effect.steps[0]!.action).toEqual({
      kind: "override_properties",
      target: {
        kind: "filter",
        player: "self",
        filter: { category: ["spirit"], tribes: ["天璋"] },
        count: "all",
      },
      properties: { level: { delta: 1 } },
      duration: { scope: "while_on_field" },
    });
  });

  it("[board] 系統「天璋」を持つ自分のスピリット(BSTH11-C01, コア3個=Lv2)は、コア数を変えずLv3として解決される", () => {
    const yatadera = createCardInstance(def, {
      instanceId: "m01-1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const targetDef = getCardDefinitionById("BSTH11-C01")!; // 系統: 幻想・天璋・妖精, Lv2 requiredCores:3
    const target = createCardInstance(targetDef, {
      instanceId: "m01-target",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 3,
    });
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({ cardInstances: [yatadera, target] }),
      getCardDefinitionById
    );
    // 補正なしのLvはrequiredCores:3でLv2 (levelDefs上限もLv2なのでLv3自体は存在しないが、
    // 「1つ上のものとして扱う」は override_properties level:{delta:1} が既存の
    // getEffectiveLevel 加算経路にそのまま乗ることを検証する。
    expect(
      getEffectiveLevel(state, target, targetDef, getCardDefinitionById)
    ).toBe(3);
  });

  it("[board] 系統「天璋」を持たない自分のスピリット(BSKB01-C01)にはLv補正が乗らない", () => {
    const yatadera = createCardInstance(def, {
      instanceId: "m01-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const targetDef = getCardDefinitionById("BSKB01-C01")!;
    const target = createCardInstance(targetDef, {
      instanceId: "m01-target-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = rebuildContinuousEffectsFromField(
      createEmptyGameState({ cardInstances: [yatadera, target] }),
      getCardDefinitionById
    );
    expect(
      getEffectiveLevel(state, target, targetDef, getCardDefinitionById)
    ).toBe(1);
  });
});

describe("BSTH11-C04「後符「絶対秘神の後光」」effects[0-2]（スタック軽減シンボル<神>追加/フラッシュ2体重疲労/スタック1体重疲労+ターン終了時downgrade、stub解消）", () => {
  const def = getCardDefinitionById("BSTH11-C04")!;

  it("effects[0]: treat_as + whenUsingEffectMode:stack + addsReductionSymbol(asColor:god)", () => {
    const effect = def.effects[0]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.steps[0]!.action).toEqual({
      kind: "treat_as",
      appliesToCard: true,
      aspects: ["reduction_symbol"],
      asColor: "god",
      whenUsingEffectMode: "stack",
      addsReductionSymbol: true,
      cardStateOnly: true,
    });
  });

  it("[board] スタック支払い時だけ軽減シンボル<神>1つが追加される(メイン/フラッシュには乗らない)", () => {
    const magic = createCardInstance(def, {
      instanceId: "c04-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [magic],
    });
    const base = {
      state,
      actingPlayerId: ALICE,
      card: def,
      sourceInstanceId: magic.instanceId,
      getCardDefinitionById,
    };
    const stackReduction = calculateReduction({ ...base, effectMode: "stack" });
    // reductionSymbols:["green"] (印字1枠) + 追加された神シンボル1枠 = required 2、
    // 供給なしのため satisfied は印字分のみ判定対象外（totalReduction は供給側の色一致数）。
    expect(stackReduction.requiredReductionSymbolCount).toBe(2);
    const flashReduction = calculateReduction({ ...base, effectMode: "flash" });
    expect(flashReduction.requiredReductionSymbolCount).toBe(1);
  });

  it("effects[1]: フラッシュ(own printed effect, applicability無し) + exhaust degree:heavy_exhaust count:2 相手spirit/ultimate", () => {
    const effect = def.effects[1]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(effect.applicability).toBeUndefined();
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("exhaust");
    if (action.kind === "exhaust") {
      expect(action.degree).toBe("heavy_exhaust");
      expect(action.target).toMatchObject({
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
        count: 2,
      });
    }
  });

  it("[board] effects[1]実行(fixed count:1変種): 相手のスピリットが重疲労する", () => {
    // count:2 は非対話 executeEffect では多体選択が自動解決されないため、盤面変化は
    // fixed count:1 変種で検証する（BSTS01-X03 board test と同方針）。
    const enemy = createCardInstance(getCardDefinitionById("BSTH11-C01")!, {
      instanceId: "c04-enemy",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [enemy],
    });
    const fixed: NonNullable<CardDefinition["effects"]>[number] = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "exhaust",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit", "ultimate"] },
              count: 1,
            },
            degree: "heavy_exhaust",
          },
        },
      ],
    };
    const after = executeEffect({
      chainId: "test:bsth11-cards:2545",
      state,
      effect: fixed,
      sourceInstanceId: "c04-enemy",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "c04-enemy")!
        .exhaustState
    ).toBe("heavily_exhausted");
  });

  it("effects[2]: スタック〔相手のターン〕〔ターンに1回：同名〕no_contract_card+重疲労1体+downgradeAtTurnEnd(stub解消)", () => {
    const effect = def.effects[2]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(effect.timingScope).toEqual({ player: "opponent", period: "turn" });
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(effect.condition).toEqual([{ kind: "no_contract_card" }]);
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("exhaust");
    if (action.kind === "exhaust") {
      expect(action.degree).toBe("heavy_exhaust");
      expect(action.downgradeAtTurnEnd).toBe(true);
      expect(action.target).toMatchObject({
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate", "nexus"] },
        count: 1,
      });
    }
  });

  it("[board] effects[2]実行: 相手のネクサスが重疲労する", () => {
    const magic = createCardInstance(def, {
      instanceId: "c04-source",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const enemyNexus = createCardInstance(
      getCardDefinitionById("BSTH11-C05")!,
      {
        instanceId: "c04-enemy-nexus",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 0,
      }
    );
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [magic, enemyNexus],
    });
    const after = executeEffect({
      chainId: "test:bsth11-cards:2604",
      state,
      effect: def.effects[2]!,
      sourceInstanceId: "c04-source",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "c04-enemy-nexus")!
        .exhaustState
    ).toBe("heavily_exhausted");
    // 「この効果で疲労した対象は、このターン終了時、疲労状態になる」:
    // downgradeAtTurnEnd により pendingTurnEndExhaustDowngrades へ捕捉対象が予約される。
    expect(after.pendingTurnEndExhaustDowngrades).toEqual([
      expect.objectContaining({ cardInstanceId: "c04-enemy-nexus" }),
    ]);
  });

  it("[board] effects[2]実行後、ターン終了時(flushPendingTurnEndExhaustDowngrades)で対象が疲労状態へ引き下げられる", () => {
    const magic = createCardInstance(def, {
      instanceId: "c04-source-2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const enemyNexus = createCardInstance(
      getCardDefinitionById("BSTH11-C05")!,
      {
        instanceId: "c04-enemy-nexus-2",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "field",
        normalCoreCount: 0,
      }
    );
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [magic, enemyNexus],
    });
    const afterEffect = executeEffect({
      chainId: "test:bsth11-cards:2644",
      state,
      effect: def.effects[2]!,
      sourceInstanceId: "c04-source-2",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(
      afterEffect.cardInstances.find(
        (c) => c.instanceId === "c04-enemy-nexus-2"
      )!.exhaustState
    ).toBe("heavily_exhausted");
    const afterTurnEnd = flushPendingTurnEndExhaustDowngrades(afterEffect);
    expect(
      afterTurnEnd.cardInstances.find(
        (c) => c.instanceId === "c04-enemy-nexus-2"
      )!.exhaustState
    ).toBe("exhausted");
    expect(afterTurnEnd.pendingTurnEndExhaustDowngrades).toEqual([]);
  });
});

describe("BSTH11-R01 effects[3]『Lv3このスピリットのアタック/ブロック時』相手トラッシュ2枚除外+条件付回復(stub解消)", () => {
  const def = getCardDefinitionById("BSTH11-R01")!;

  it("構造 = card_event(attack,block) + min_level:3 + search_zone(opponent,trash→removed_from_game) + ref_succeeded+no_contract_card回復", () => {
    const effect = def.effects[3]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({
      kind: "card_event",
      event: ["attack", "block"],
    });
    expect(effect.condition).toEqual([{ kind: "min_level", value: 3 }]);
    expect(effect.steps).toHaveLength(2);
    const exile = effect.steps[0]!.action;
    expect(exile.kind).toBe("search_zone");
    if (exile.kind === "search_zone") {
      expect(exile.zone).toBe("trash");
      expect(exile.player).toBe("opponent");
      expect(exile.count).toBe(2);
      expect(exile.destination).toBe("removed_from_game");
      // mandatory:true必須(BSTH08 precedent同型)。省略すると候補>2枚のとき
      // pendingZoneSelection.canSkipが既定trueになり0..2枚の任意選択に緩んでしまう
      // (「2枚を除外できる」は発動したら必ず2枚のはず、adversarial verifier指摘)。
      expect(exile.mandatory).toBe(true);
    }
    expect(effect.steps[1]!.stepCondition).toEqual({
      kind: "ref_count",
      stepId: "r01-exile-opponent-trash",
      min: 2,
    });
    expect(effect.steps[1]!.condition).toEqual([{ kind: "no_contract_card" }]);
    expect(effect.steps[1]!.action).toEqual({
      kind: "recover",
      target: { kind: "self" },
    });
  });

  it("[board] 未契約時、相手トラッシュ2枚を除外→除外に成功したので自身を回復できる", () => {
    const self = createCardInstance(def, {
      instanceId: "r01x-self",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 4, // Lv3 (requiredCores:4)
      exhaustState: "exhausted",
    });
    const enemyTrash1 = createCardInstance(
      getCardDefinitionById("BSTH11-C01")!,
      {
        instanceId: "r01x-trash1",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "trash",
      }
    );
    const enemyTrash2 = createCardInstance(
      getCardDefinitionById("BSTH11-C02")!,
      {
        instanceId: "r01x-trash2",
        ownerPlayerId: BOB,
        controllerPlayerId: BOB,
        zone: "trash",
      }
    );
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [self, enemyTrash1, enemyTrash2],
    });
    const after = executeEffect({
      chainId: "test:bsth11-cards:2734",
      state,
      effect: def.effects[3]!,
      sourceInstanceId: "r01x-self",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(
      after.cardInstances.filter((c) => c.zone === "removed_from_game")
    ).toHaveLength(2);

    const acceptRecover = getLegalActions({
      state: after,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    expect(acceptRecover).toBeDefined();
    const afterRecover = applyLegalAction({
      state: after,
      action: acceptRecover!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(
      afterRecover.cardInstances.find((c) => c.instanceId === "r01x-self")!
        .exhaustState
    ).toBe("recovered");
  });

  it("[board] 相手トラッシュに3枚以上あるとき、mandatory:trueにより0..2枚ではなく必ず2枚を選ばせる(canSkip:false)", () => {
    const self = createCardInstance(def, {
      instanceId: "r01ov-self",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 4,
    });
    const trashCards = ["BSTH11-C01", "BSTH11-C02", "BSTH11-C03"].map(
      (cardNo, i) =>
        createCardInstance(getCardDefinitionById(cardNo)!, {
          instanceId: `r01ov-trash${i}`,
          ownerPlayerId: BOB,
          controllerPlayerId: BOB,
          zone: "trash",
        })
    );
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [self, ...trashCards],
    });
    const after = executeEffect({
      chainId: "test:bsth11-cards:2789",
      state,
      effect: def.effects[3]!,
      sourceInstanceId: "r01ov-self",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(after.pendingZoneSelection).toMatchObject({
      actionKind: "return_from_trash",
      maxCount: 2,
      canSkip: false,
    });
    expect(after.pendingZoneSelection!.candidateCardInstanceIds.sort()).toEqual(
      ["r01ov-trash0", "r01ov-trash1", "r01ov-trash2"]
    );

    const afterSelection = applyLegalAction({
      state: after,
      action: { kind: "resolve_pending_zone_selection" },
      selectedZoneCardIds: ["r01ov-trash0", "r01ov-trash1"],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(
      afterSelection.cardInstances.filter((c) => c.zone === "removed_from_game")
    ).toHaveLength(2);
    expect(
      afterSelection.cardInstances.find((c) => c.instanceId === "r01ov-trash2")!
        .zone
    ).toBe("trash");
  });
});

describe("BSTH11-R03 effects[1]『このスピリットの召喚時』〔ターンに1回：同名〕系統毎void核任意配置(6系統)+その後、自分が契約していなければ自分のトラッシュのコア3個をボイドに置くことで、デッキの上から2枚ドロー(stub解消)", () => {
  function declineNextOptionalStep(state: GameState): GameState {
    const pending = state.pendingStepOptionalChoice;
    expect(pending).not.toBeNull();
    return applyLegalAction({
      state,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending!.pendingId}:decline`,
        can: true,
        reason: "test",
        actingPlayerId: pending!.choosingPlayerId,
        pendingId: pending!.pendingId,
        sourceInstanceId: pending!.sourceInstanceId,
        effectIndex: pending!.effectIndex,
        stepIndex: pending!.stepIndex,
        choice: "decline",
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
  }

  function executeNextOptionalStep(state: GameState): GameState {
    const pending = state.pendingStepOptionalChoice;
    expect(pending).not.toBeNull();
    expect(pending!.canExecute).toBe(true);
    return applyLegalAction({
      state,
      action: {
        kind: "resolve_pending_step_optional_choice",
        actionId: `pso-${pending!.pendingId}:execute`,
        can: true,
        reason: "test",
        actingPlayerId: pending!.choosingPlayerId,
        pendingId: pending!.pendingId,
        sourceInstanceId: pending!.sourceInstanceId,
        effectIndex: pending!.effectIndex,
        stepIndex: pending!.stepIndex,
        choice: "execute",
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
  }

  /** 配置だけ辞退し、後段の支払い付きドローへ進める。 */
  function declineAllTribeCoreSteps(state: GameState): GameState {
    let current = state;
    while (
      current.pendingStepOptionalChoice !== null &&
      current.pendingStepOptionalChoice.stepIndex < 1
    ) {
      current = declineNextOptionalStep(current);
    }
    return current;
  }

  it("系統共有の配置1回と後段の支払い付きドローを同名ターン制限で共有する", () => {
    const def = getCardDefinitionById("BSTH11-R03")!;
    const effect = def.effects[1]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "card_event", event: "summon" });
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(effect.steps).toHaveLength(3);

    const tribes = ["幻想", "秘神", "博麗", "風神", "アシハラ", "神渡"];
    const placement = effect.steps[0]!;
    expect(placement.executionMode).toBe("optional");
    expect(placement.action.kind).toBe("core_distribute");
    if (placement.action.kind !== "core_distribute")
      throw new Error("placement");
    expect(placement.action.mode).toBe("player_choice");
    expect(placement.action.maxPerCandidate).toBe(1);
    expect(placement.action.allocationGroups).toEqual(
      tribes.map((tribe) => ({
        filter: { tribes: [tribe], targetsGrandwalker: true },
        maxCount: 1,
      }))
    );

    const costStep = effect.steps[1]!;
    expect(costStep.executionMode).toBe("optional");
    expect(costStep.connector).toBe("sequential");
    expect(costStep.condition).toEqual([{ kind: "no_contract_card" }]);
    const costAction = costStep.action;
    expect(costAction.kind).toBe("core_move");
    if (costAction.kind === "core_move") {
      expect(costAction.from).toEqual({ kind: "trash", player: "self" });
      expect(costAction.to).toEqual({ kind: "void", player: "self" });
      expect(costAction.amount).toBe(3);
      expect(costAction.requireFullCount).toBe(true);
    }

    const payoffStep = effect.steps[2]!;
    expect(payoffStep.connector).toBe("conditional_cost");
    const payoffAction = payoffStep.action;
    expect(payoffAction.kind).toBe("draw");
    if (payoffAction.kind === "draw") {
      expect(payoffAction.count).toBe(2);
    }
  });

  it("[board] 系統「幻想」を持つ自分のスピリット(このカード自身)に、宣言した1系統分だけvoid核を配置できる", () => {
    const def = getCardDefinitionById("BSTH11-R03")!;
    const self = createCardInstance(def, {
      instanceId: "r03g-self",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [self],
      playerOverrides: [
        { voidNormalCoreCount: 1, contractCardNo: "BSTH11-C01" },
        {},
      ],
    });
    const afterTrigger = executeEffect({
      chainId: "test:bsth11-cards:2959",
      state,
      effect: def.effects[1]!,
      sourceInstanceId: "r03g-self",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    // steps[0] (系統「幻想」) はこのカード自身 (tribe:幻想・天璋・剣獣) が唯一の候補として
    // 実行できる。実行して void 核が1個 self に配置されることを確認する。
    const choosing = executeNextOptionalStep(afterTrigger);
    expect(choosing.pendingCoreDistribution).not.toBeNull();
    const action = getLegalActions({
      state: choosing,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_core_distribution")!;
    const afterGensou = applyLegalAction({
      state: choosing,
      action,
      coreDistributionAllocations: { "r03g-self": 1 },
      getCardDefinitionById,
    }).state;
    const self1 = afterGensou.cardInstances.find(
      (c) => c.instanceId === "r03g-self"
    )!;
    expect(self1.normalCoreCount).toBe(2);
    expect(
      afterGensou.players.find((p) => p.id === ALICE)!.voidNormalCoreCount
    ).toBe(0);
    // 契約カードがあるため steps[1] (trash-to-void) の条件は不成立で自動的に飛ばされる。
    let after = afterGensou;
    while (after.pendingStepOptionalChoice !== null) {
      after = declineNextOptionalStep(after);
    }
    expect(after.pendingStepOptionalChoice).toBeNull();
  });

  it("[board] 未契約+トラッシュに通常コア3個あるとき: 配置を辞退しても、その後トラッシュのコア3個がボイドへ移動し2枚ドローする", () => {
    const def = getCardDefinitionById("BSTH11-R03")!;
    const self = createCardInstance(def, {
      instanceId: "r03d-self",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const deck = Array.from({ length: 2 }, (_, i) =>
      createCardInstance(getCardDefinitionById("BSTH11-C04")!, {
        instanceId: `r03d-deck-${i}`,
        ownerPlayerId: ALICE,
        zone: "deck",
      })
    );
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [self, ...deck],
      playerOverrides: [
        {
          trashNormalCoreCount: 3,
          voidNormalCoreCount: 0,
          handCount: 0,
          deckCount: 2,
        },
        {},
      ],
    });
    const afterTrigger = executeEffect({
      chainId: "test:bsth11-cards:3015",
      state,
      effect: def.effects[1]!,
      sourceInstanceId: "r03d-self",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    const beforeCost = declineAllTribeCoreSteps(afterTrigger);
    const after = executeNextOptionalStep(beforeCost);
    expect(after.pendingStepOptionalChoice).toBeNull();
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.trashNormalCoreCount).toBe(0);
    expect(alice.voidNormalCoreCount).toBe(3);
    expect(alice.handCount).toBe(2);
    expect(alice.deckCount).toBe(0);
  });

  it.each([0, 1, 2])(
    "[board] 未契約だがトラッシュの通常コアが%i個(3個未満)のとき: requireFullCountにより1個も移動せずドローもしない(部分支払い防止)",
    (trashCoreCount) => {
      const def = getCardDefinitionById("BSTH11-R03")!;
      const self = createCardInstance(def, {
        instanceId: "r03f-self",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 1,
      });
      const deck = Array.from({ length: 2 }, (_, i) =>
        createCardInstance(getCardDefinitionById("BSTH11-C04")!, {
          instanceId: `r03f-deck-${i}`,
          ownerPlayerId: ALICE,
          zone: "deck",
        })
      );
      const state = createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [self, ...deck],
        playerOverrides: [
          {
            trashNormalCoreCount: trashCoreCount,
            voidNormalCoreCount: 0,
            handCount: 0,
            deckCount: 2,
          },
          {},
        ],
      });
      const afterTrigger = executeEffect({
        chainId: "test:bsth11-cards:3064",
        state,
        effect: def.effects[1]!,
        sourceInstanceId: "r03f-self",
        actingPlayerId: ALICE,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      });
      const beforeCost = declineAllTribeCoreSteps(afterTrigger);
      // 支払不能な「ことで」の選択肢は提示せず、独立した前段の解決は保持する。
      const after = beforeCost;
      expect(after.pendingStepOptionalChoice).toBeNull();
      const alice = after.players.find((p) => p.id === ALICE)!;
      expect(alice.trashNormalCoreCount).toBe(trashCoreCount);
      expect(alice.voidNormalCoreCount).toBe(0);
      expect(alice.handCount).toBe(0);
      expect(alice.deckCount).toBe(2);
    }
  );

  it("[board] 契約カードがある場合、no_contract_card条件が成立せずコア移動もドローもしない", () => {
    const def = getCardDefinitionById("BSTH11-R03")!;
    const self = createCardInstance(def, {
      instanceId: "r03e-self",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [self],
      playerOverrides: [
        {
          trashNormalCoreCount: 3,
          voidNormalCoreCount: 0,
          handCount: 0,
          contractCardNo: "BSTH11-C01",
        },
        {},
      ],
    });
    const afterTrigger = executeEffect({
      chainId: "test:bsth11-cards:3105",
      state,
      effect: def.effects[1]!,
      sourceInstanceId: "r03e-self",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    // 未契約条件が不成立なら、配置辞退だけで終了する。
    const after = declineAllTribeCoreSteps(afterTrigger);
    expect(after.pendingStepOptionalChoice).toBeNull();
    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.trashNormalCoreCount).toBe(3);
    expect(alice.voidNormalCoreCount).toBe(0);
    expect(alice.handCount).toBe(0);
  });
});

describe("BSTH11-R03(effects[2])/X02(effects[2])『このスピリットのアタック/ブロック時』相手を重疲労できる(stub解消)", () => {
  it("BSTH11-R03: card_event(attack,block) + min_level:2 + no_contract_card + exhaust(spirit/ultimate, count:1)", () => {
    const def = getCardDefinitionById("BSTH11-R03")!;
    const effect = def.effects[2]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({
      kind: "card_event",
      event: ["attack", "block"],
    });
    expect(effect.condition).toEqual([
      { kind: "min_level", value: 2 },
      { kind: "no_contract_card" },
    ]);
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("exhaust");
    if (action.kind === "exhaust") {
      expect(action.degree).toBe("heavy_exhaust");
      expect(action.target).toMatchObject({
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
        count: 1,
      });
    }
  });

  it("BSTH11-X02: card_event(attack,block) + min_level:2 + exhaust(spirit/ultimate/nexus+grandwalker/guided, count:2)", () => {
    const def = getCardDefinitionById("BSTH11-X02")!;
    // effects[1](現界)/[2](アタック/ブロック共有steps)の分離挿入によりindexが1つ後退
    // (旧effects[2]→新effects[3])。
    const effect = def.effects[3]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({
      kind: "card_event",
      event: ["attack", "block"],
    });
    expect(effect.condition).toEqual([{ kind: "min_level", value: 2 }]);
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("exhaust");
    if (action.kind === "exhaust") {
      expect(action.degree).toBe("heavy_exhaust");
      // P3-134: grandwalkerKind:"grandwalker" 除去済み(死んだ絞り込みだったが誤解を招くため)。
      // targetsGrandwalker:true のみで創界神/導界者ネクサス両方を含める(作用系のため受ける)。
      expect(action.target).toMatchObject({
        kind: "filter",
        player: "opponent",
        filter: {
          category: ["spirit", "ultimate", "nexus"],
          targetsGrandwalker: true,
        },
        count: 2,
      });
      expect(
        (action.target as { filter?: Record<string, unknown> }).filter
      ).not.toHaveProperty("grandwalkerKind");
    }
  });

  it("[board] P3-134: 導界者ネクサス(BSTH02-X01「西行妖」)もLv2-3重疲労効果の対象filterに一致する(重疲労=作用系のため受ける、10_rules/07:62-67)", () => {
    const guidedNexusDef = getCardDefinitionById("BSTH02-X01")!;
    const guidedNexus = createCardInstance(guidedNexusDef, {
      instanceId: "x02-guided-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const def = getCardDefinitionById("BSTH11-X02")!;
    const action = def.effects[3]!.steps[0]!.action;
    if (action.kind !== "exhaust" || action.target.kind !== "filter") {
      throw new Error("expected exhaust filter target");
    }
    expect(
      matchesCardFilter(guidedNexus, guidedNexusDef, action.target.filter)
    ).toBe(true);
  });

  it("[board] BSTH11-R03実行: 未契約時、相手スピリットが重疲労する", () => {
    const def = getCardDefinitionById("BSTH11-R03")!;
    const self = createCardInstance(def, {
      instanceId: "r03x-self",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2, // Lv2 (requiredCores:2)
    });
    const enemy = createCardInstance(getCardDefinitionById("BSTH11-C01")!, {
      instanceId: "r03x-enemy",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [self, enemy],
    });
    const after = executeEffect({
      chainId: "test:bsth11-cards:3220",
      state,
      effect: def.effects[2]!,
      sourceInstanceId: "r03x-self",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "r03x-enemy")!
        .exhaustState
    ).toBe("heavily_exhausted");
  });

  it("[board] BSTH11-R03実行: 契約カードがある場合、no_contract_card条件が成立せず重疲労しない", () => {
    const def = getCardDefinitionById("BSTH11-R03")!;
    const self = createCardInstance(def, {
      instanceId: "r03y-self",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const enemy = createCardInstance(getCardDefinitionById("BSTH11-C01")!, {
      instanceId: "r03y-enemy",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [self, enemy],
      playerOverrides: [{ contractCardNo: "BSTH11-C01" }, {}],
    });
    const after = executeEffect({
      chainId: "test:bsth11-cards:3255",
      state,
      effect: def.effects[2]!,
      sourceInstanceId: "r03y-self",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "r03y-enemy")!
        .exhaustState
    ).toBe("recovered");
  });
});

describe("BSTH11-X03「丁礼田 舞」effects[1]『このスピリットの召喚/アタック時』防止免疫付与+代替コストで相手2つまで重疲労(stub解消)", () => {
  const def = getCardDefinitionById("BSTH11-X03")!;

  it("effect定義: grant_effect_source_prevention_immunity(tribes:天璋/秘神,duration:battle) → choice代替コスト(手札/手元2枚デッキ下 or 「隠岐奈」コア-4) → conditional_cost exhaust(2つまで)", () => {
    const effect = def.effects[1]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({
      kind: "card_event",
      event: ["summon", "attack"],
    });
    expect(effect.steps).toHaveLength(3);
    expect(effect.steps[0]!.action).toEqual({
      kind: "grant_effect_source_prevention_immunity",
      player: "self",
      sourceScope: { tribes: ["天璋", "秘神"] },
      duration: { scope: "battle" },
    });
    const costStep = effect.steps[1]!;
    expect(costStep.connector).toBe("sequential");
    expect(costStep.executionMode).toBe("optional");
    expect(costStep.action).toMatchObject({
      kind: "move_card",
      from: {
        zone: ["hand", "set_aside"],
        filter: { tribes: ["天璋", "秘神"] },
      },
      to: { zone: "deck", position: "bottom" },
      count: 2,
      requireFullCount: true,
    });
    expect(costStep.choice).toHaveLength(1);
    // P3-134: "創界神ネクサスの「隠岐奈」" excludes ordinary nexus, so use
    // targetsGrandwalker:"only"; grandwalkerKind remains absent because the
    // cardName already narrows to 隠岐奈 and no guided 隠岐奈 exists.
    expect(costStep.choice![0]!.action).toEqual({
      kind: "core_move",
      from: {
        kind: "field_card",
        player: "self",
        filter: {
          category: ["nexus"],
          cardName: { contains: "隠岐奈" },
          targetsGrandwalker: "only",
        },
      },
      to: { kind: "void", player: "self" },
      amount: 4,
      requireFullCount: true,
    });
    expect(
      (
        costStep.choice![0]!.action as {
          from?: { filter?: Record<string, unknown> };
        }
      ).from?.filter
    ).not.toHaveProperty("grandwalkerKind");
    const exhaustStep = effect.steps[2]!;
    expect(exhaustStep.connector).toBe("conditional_cost");
    if (exhaustStep.action.kind === "exhaust") {
      expect(exhaustStep.action.degree).toBe("heavy_exhaust");
      // P3-134: grandwalkerKind:"grandwalker" 除去済み(死んだ絞り込みだったが誤解を招くため)。
      expect(exhaustStep.action.target).toMatchObject({
        kind: "filter",
        player: "opponent",
        filter: {
          category: ["spirit", "ultimate", "nexus"],
          targetsGrandwalker: true,
        },
        count: { min: 0, max: 2 },
      });
      expect(
        (exhaustStep.action.target as { filter?: Record<string, unknown> })
          .filter
      ).not.toHaveProperty("grandwalkerKind");
    } else {
      throw new Error("expected exhaust action");
    }
  });

  it("[board] P3-134: 導界者ネクサス(BSTH02-X01「西行妖」)もconditional_cost重疲労の対象filterに一致する(重疲労=作用系のため受ける)", () => {
    const guidedNexusDef = getCardDefinitionById("BSTH02-X01")!;
    const guidedNexus = createCardInstance(guidedNexusDef, {
      instanceId: "x03-guided-target",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
    });
    const exhaustStep = def.effects[1]!.steps[2]!;
    if (
      exhaustStep.action.kind !== "exhaust" ||
      exhaustStep.action.target.kind !== "filter"
    ) {
      throw new Error("expected exhaust filter target");
    }
    expect(
      matchesCardFilter(
        guidedNexus,
        guidedNexusDef,
        exhaustStep.action.target.filter
      )
    ).toBe(true);
  });

  it("[board] choiceIndex:0 天璋/秘神カード2枚を手札からデッキの下へ戻し、相手2体を重疲労させる", () => {
    const self = createCardInstance(def, {
      instanceId: "x03-self-a",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const handA = createCardInstance(getCardDefinitionById("BSTH11-C01")!, {
      instanceId: "x03-hand-a",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const handB = createCardInstance(getCardDefinitionById("BSTH11-C01")!, {
      instanceId: "x03-hand-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const enemy1 = createCardInstance(getCardDefinitionById("BSTH11-C01")!, {
      instanceId: "x03-enemy-1",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy2 = createCardInstance(getCardDefinitionById("BSTH11-C01")!, {
      instanceId: "x03-enemy-2",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [self, handA, handB, enemy1, enemy2],
    });
    const after = executeEffect({
      chainId: "test:bsth11-cards:3411",
      state,
      effect: def.effects[1]!,
      sourceInstanceId: "x03-self-a",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      choiceIndex: 0,
      optionalExecuteResumeStepIndex: 1,
      targetInstanceIds: ["x03-enemy-1", "x03-enemy-2"],
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "x03-hand-a")!.zone
    ).toBe("deck");
    expect(
      after.cardInstances.find((c) => c.instanceId === "x03-hand-b")!.zone
    ).toBe("deck");
    expect(
      after.cardInstances.find((c) => c.instanceId === "x03-enemy-1")!
        .exhaustState
    ).toBe("heavily_exhausted");
    expect(
      after.cardInstances.find((c) => c.instanceId === "x03-enemy-2")!
        .exhaustState
    ).toBe("heavily_exhausted");
  });

  it("[board] choiceIndex:1 自分の創界神ネクサス「隠岐奈」のコアを4個減らし、相手2体を重疲労させる", () => {
    const self = createCardInstance(def, {
      instanceId: "x03-self-b",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const okina = createCardInstance(getCardDefinitionById("BSTH11-X01")!, {
      instanceId: "x03-okina",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 4,
    });
    const enemy1 = createCardInstance(getCardDefinitionById("BSTH11-C01")!, {
      instanceId: "x03-enemy-3",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy2 = createCardInstance(getCardDefinitionById("BSTH11-C01")!, {
      instanceId: "x03-enemy-4",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [self, okina, enemy1, enemy2],
    });
    const after = executeEffect({
      chainId: "test:bsth11-cards:3471",
      state,
      effect: def.effects[1]!,
      sourceInstanceId: "x03-self-b",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      choiceIndex: 1,
      optionalExecuteResumeStepIndex: 1,
      targetInstanceIds: ["x03-enemy-3", "x03-enemy-4"],
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "x03-okina")!
        .normalCoreCount
    ).toBe(0);
    expect(
      after.cardInstances.find((c) => c.instanceId === "x03-enemy-3")!
        .exhaustState
    ).toBe("heavily_exhausted");
    expect(
      after.cardInstances.find((c) => c.instanceId === "x03-enemy-4")!
        .exhaustState
    ).toBe("heavily_exhausted");
  });

  it("[board] コスト支払い候補が無い（手札/手元に対象カードなし、「隠岐奈」も未着地）ときは重疲労しない", () => {
    const self = createCardInstance(def, {
      instanceId: "x03-self-c",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const enemy1 = createCardInstance(getCardDefinitionById("BSTH11-C01")!, {
      instanceId: "x03-enemy-5",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [self, enemy1],
    });
    const after = executeEffect({
      chainId: "test:bsth11-cards:3515",
      state,
      effect: def.effects[1]!,
      sourceInstanceId: "x03-self-c",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      choiceIndex: 0,
      optionalExecuteResumeStepIndex: 1,
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "x03-enemy-5")!
        .exhaustState
    ).toBe("recovered");
  });
});

describe("BSTH11-X04「爾子田 里乃」effects[1,2]（強制重疲労+ターンに1回void核配置/フラッシュ2コスト回復、stub解消）", () => {
  const def = getCardDefinitionById("BSTH11-X04")!;

  it("effects[1]: card_event(summon,attack,block) + 強制exhaust(spirit/ultimate/nexus,count:1) + 任意core_move(per_card_name/turn)", () => {
    const effect = def.effects[1]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({
      kind: "card_event",
      event: ["summon", "attack", "block"],
    });
    expect(effect.steps).toHaveLength(2);
    const exhaust = effect.steps[0]!.action;
    expect(exhaust.kind).toBe("exhaust");
    if (exhaust.kind === "exhaust") {
      expect(exhaust.degree).toBe("heavy_exhaust");
      expect(exhaust.target).toMatchObject({
        filter: { category: ["spirit", "ultimate", "nexus"] },
        count: 1,
      });
    }
    expect(effect.steps[0]!.executionMode).toBeUndefined();
    expect(effect.steps[1]!.executionMode).toBe("optional");
    expect(effect.steps[1]!.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    const coreMove = effect.steps[1]!.action;
    expect(coreMove.kind).toBe("core_move");
    if (coreMove.kind === "core_move") {
      expect(coreMove.amount).toBe(3);
    }
  });

  it("effects[2]: activated/flash(お互いのアタックステップ) + min_level:2 + pay_cost(2)+conditional_cost+recover(天璋/秘神のspirit/創界神ネクサス)", () => {
    const effect = def.effects[2]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(effect.timingScope).toEqual({ player: "both", period: "attack" });
    expect(effect.condition).toEqual([{ kind: "min_level", value: 2 }]);
    expect(effect.steps[0]!.action).toEqual({ kind: "pay_cost", amount: 2 });
    expect(effect.steps[1]!.connector).toBe("conditional_cost");
    const recover = effect.steps[1]!.action;
    expect(recover.kind).toBe("recover");
    // P3-134: filterOr のネクサス枝は targetsGrandwalker:true のみ(grandwalkerKind:"grandwalker"
    // は除去済み。回復=作用系のため導界者ネクサスも除外しない)。
    if (recover.kind === "recover" && recover.target.kind === "filter") {
      const nexusBranch = (
        recover.target.filter as { filterOr?: Record<string, unknown>[] }
      ).filterOr?.find(
        (b) => Array.isArray(b.category) && b.category.includes("nexus")
      );
      expect(nexusBranch).toBeDefined();
      expect(nexusBranch).not.toHaveProperty("grandwalkerKind");
    }
  });

  it("[board] P3-134: 系統「秘神」を持つ導界者ネクサスもフラッシュ回復効果のfilterOrネクサス枝に一致する(回復=作用系のため受ける)", () => {
    // BSTH02-X01「西行妖」(grandwalkerData.kind:"guided")をベースに、tribe だけ「秘神」へ
    // 差し替えた合成フィクスチャ(実在の「秘神」系統の導界者ネクサスが無いため、
    // bslh01-m01-graduated-payment.test.ts 等と同型のフィールド上書きパターンで
    // grandwalkerKind narrowing 除去の効果を tribes 条件と独立に検証する)。
    const baseGuidedNexusDef = getCardDefinitionById("BSTH02-X01")!;
    expect(baseGuidedNexusDef.grandwalkerData?.kind).toBe("guided");
    const guidedNexusDef: CardDefinition = {
      ...baseGuidedNexusDef,
      tribe: "秘神",
    };
    const guidedNexus = createCardInstance(guidedNexusDef, {
      instanceId: "x04-guided-recover-target",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      exhaustState: "heavily_exhausted",
    });
    const recover = def.effects[2]!.steps[1]!.action;
    if (recover.kind !== "recover" || recover.target.kind !== "filter") {
      throw new Error("expected recover filter target");
    }
    expect(
      matchesCardFilter(guidedNexus, guidedNexusDef, recover.target.filter)
    ).toBe(true);
  });

  it("[board] effects[1]実行: 相手が強制的に重疲労する（fixed count:1で盤面変化確認）", () => {
    const enemy = createCardInstance(getCardDefinitionById("BSTH11-C01")!, {
      instanceId: "x04-enemy",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [enemy],
    });
    const after = executeEffect({
      chainId: "test:bsth11-cards:3627",
      state,
      effect: def.effects[1]!,
      sourceInstanceId: "x04-enemy",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "x04-enemy")!
        .exhaustState
    ).toBe("heavily_exhausted");
  });

  it("[board] effects[2]実行: リザーブから2コスト支払い、天璋を持つ自身を回復する", () => {
    const self = createCardInstance(def, {
      instanceId: "x04-self",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2, // Lv2 (requiredCores:2, min_level:2 条件を満たす)
      exhaustState: "exhausted",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [self],
      playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
    });
    const after = executeEffect({
      chainId: "test:bsth11-cards:3655",
      state,
      effect: def.effects[2]!,
      sourceInstanceId: "x04-self",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "x04-self")!.exhaustState
    ).toBe("recovered");
    expect(
      after.players.find((p) => p.id === ALICE)!.reserveNormalCoreCount
    ).toBe(3);
  });
});

describe("BSTH11-X01「[創界神]摩多羅 隠岐奈」effects[1] フラッシュ 手札/手元にあるこのカードは配置できる(stub解消、BSES01[2,3]/BSTH11-C05[0] precedent と同型)", () => {
  const def = getCardDefinitionById("BSTH11-X01")!;

  it("構造 = activated/flash + applicability(zone:hand/set_aside) + timingScopeなし(印字通り制限無し) + summon(target:self)", () => {
    const effect = def.effects[1]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(effect.timingScope).toBeUndefined();
    expect(effect.applicability).toEqual({ zone: ["hand", "set_aside"] });
    expect(effect.executionMode).toBe("optional");
    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("summon");
    if (action.kind === "summon") {
      expect(action.target).toEqual({ kind: "self" });
    }
  });

  it("[board] 手札にあるとき、通常メインステップ中でも自己配置の手札起動効果 legal action が現れる", () => {
    const inHand = createCardInstance(def, {
      instanceId: "x01-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: [inHand],
        playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
      }),
      step: "main",
      activePlayerId: ALICE,
      window: null,
    };
    const placePermission = getLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredHandActivatedEffectActions,
    }).find(
      (a): a is Extract<typeof a, { kind: "use_hand_card_effect" }> =>
        a.kind === "use_hand_card_effect" && a.sourceInstanceId === "x01-hand"
    );
    expect(placePermission).toBeDefined();
    expect(placePermission).toMatchObject({
      effectIndex: 1,
      chosenTiming: "flash",
      sourceActivationZone: "hand",
    });
    // 起動効果宣言時点で対象ネクサスは in_use へ移る。コスト支払いと field 配置は、
    // スタック窓後の効果解決で行われる。
    const after = applyLegalAction({
      state,
      action: placePermission!,
      getCardDefinitionById,
      getRegisteredHandActivatedEffectActions,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      summonPaymentSources: [{ kind: "reserve", amount: def.cost }],
    }).state;
    expect(
      after.cardInstances.find((c) => c.instanceId === "x01-hand")!.zone
    ).toBe("in_use");
    expect(
      after.players.find((player) => player.id === ALICE)
        ?.reserveNormalCoreCount
    ).toBe(5);
    expect(after.stackWindow?.pendingStackAction).toMatchObject({
      actionKind: "hand_card_effect",
      handActivatedEffectIndex: 1,
      sourceActivationZone: "hand",
      summonPaymentSources: [{ kind: "reserve", amount: def.cost }],
    });
  });
});

describe("BSTH11-X01「[創界神]摩多羅 隠岐奈」effects[0]『自分の効果でトラッシュに置かれたこのカードは手元に置ける』(stub解消、BSES01-C01[0] precedent の行き先を hand→set_aside へ汎用化)", () => {
  const def = getCardDefinitionById("BSTH11-X01")!;

  it("構造 = card_event(moved_to_trash) + cardEventDisposition(move/set_aside) + condition(trigger_source_player:self) + move_self(set_aside)", () => {
    const effect = def.effects[0]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({
      kind: "card_event",
      event: ["moved_to_trash"],
    });
    expect(effect.cardEventDisposition).toEqual({
      kind: "move",
      destination: "set_aside",
    });
    expect(effect.condition).toEqual([
      { kind: "trigger_source_player", player: "self" },
    ]);
    expect(effect.executionMode).toBe("optional");
  });

  it("自分の効果でトラッシュへ移動: findMovedToTrashAutoEffect が move_to_set_aside でマッチする", () => {
    const inTrash = createCardInstance(def, {
      instanceId: "x01-trash",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [inTrash],
    });
    const match = findMovedToTrashAutoEffect(
      state,
      "x01-trash",
      def,
      getCardDefinitionById,
      { sourcePlayerId: ALICE }
    );
    expect(match).toBeDefined();
    expect(match!.kind).toBe("move_to_set_aside");
    expect(match!.executionMode).toBe("optional");
  });

  it("相手の効果でトラッシュへ移動したときはマッチしない (trigger_source_player:self)", () => {
    const inTrash = createCardInstance(def, {
      instanceId: "x01-trash",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [inTrash],
    });
    const match = findMovedToTrashAutoEffect(
      state,
      "x01-trash",
      def,
      getCardDefinitionById,
      { sourcePlayerId: BOB }
    );
    expect(match).toBeUndefined();
  });

  it("[board] processMovedToTrashEffects → materializeDeferredTrashOptionalAdds → resolve_pending_deck_reveal_pick で trash→set_aside に移動する", () => {
    const inTrash = createCardInstance(def, {
      instanceId: "x01-trash",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "trash",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [inTrash],
    });
    const afterMove = processMovedToTrashEffects(
      state,
      ["x01-trash"],
      getCardDefinitionById,
      { sourcePlayerId: ALICE }
    );
    expect(afterMove.pendingTrashOptionalAdds).toHaveLength(1);
    expect(
      afterMove.pendingTrashOptionalAdds[0]!.dispositionByInstanceId?.[
        "x01-trash"
      ]
    ).toEqual({ kind: "move", destination: "set_aside" });

    const materialized = materializeDeferredTrashOptionalAdds(afterMove);
    const pending = materialized.pendingDeckReveal;
    expect(pending?.phase).toBe("revealed_choice");

    const resolved = applyLegalAction({
      state: materialized,
      action: {
        kind: "resolve_pending_deck_reveal_pick",
        actionId: "dr-x01-set-aside",
        can: true,
        reason: "deck_reveal_revealed_choice",
        actingPlayerId: ALICE,
        pendingId: pending!.pendingId,
        pickIndex: -1,
        candidateCardInstanceIds: ["x01-trash"],
        maxPickCount: 1,
        canSkip: true,
      },
      selectedDeckRevealCardIds: ["x01-trash"],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(
      resolved.state.cardInstances.find((c) => c.instanceId === "x01-trash")
        ?.zone
    ).toBe("set_aside");
  });
});

describe("BSTH11-X01「[創界神]摩多羅 隠岐奈」【神託：天璋】(stub解消、BSTH05-X01/BSLH01-X01 precedent と同型でgrandwalkerData化、effects[]は不要)", () => {
  const def = getCardDefinitionById("BSTH11-X01")!;

  it("grandwalkerData: kind:grandwalker + oracleConditions=[{tribes:[天璋],categories:[spirit]}] (bullet1「対象の自分のスピリット」に対応)、keywordTagsにenter_field_core_placement_forbidden", () => {
    const gw = def.grandwalkerData!;
    expect(gw.kind).toBe("grandwalker");
    expect(gw.oracleConditions).toEqual([
      { tribes: ["天璋"], categories: ["spirit"] },
    ]);
    expect(def.keywordTags).toContain("enter_field_core_placement_forbidden");
  });

  it("[board] 配置時神託(resolvePlacementOracleMechanic): デッキ上3枚中、天璋スピリット(BSTH11-C01)1枚がマッチしトラッシュ後にボイドからコア+1。非マッチの2枚(系統違い/カテゴリ違い)はコア加算なしでトラッシュへ", () => {
    const src = createCardInstance(def, {
      instanceId: "src-x01",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
    });
    const matchingSpirit = createCardInstance(
      getCardDefinitionById("BSTH11-C01")!,
      { instanceId: "deck-match", ownerPlayerId: ALICE, zone: "deck" }
    );
    const nonMatchingTribe = createCardInstance(
      getCardDefinitionById("BSKB01-C01")!,
      { instanceId: "deck-non-match-tribe", ownerPlayerId: ALICE, zone: "deck" }
    );
    const nonMatchingCategory = createCardInstance(
      getCardDefinitionById("BSTH11-C05")!,
      // BSTH11-C05 は tribe:"幻想・天璋"(天璋タグを持つ)だが printedCategory:"nexus"。
      // tribes:["天璋"] は一致するが categories:["spirit"] 制限だけで非マッチになる、
      // categories 軸を tribe 軸と独立に検証できる反例。
      {
        instanceId: "deck-non-match-category",
        ownerPlayerId: ALICE,
        zone: "deck",
      }
    );
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [
        src,
        matchingSpirit,
        nonMatchingTribe,
        nonMatchingCategory,
      ],
      playerOverrides: [{ voidNormalCoreCount: 5 }, {}],
    });

    const after = resolvePlacementOracleMechanic(
      state,
      { kind: "placement_oracle", grandwalkerInstanceId: "src-x01" },
      getCardDefinitionById
    );

    for (const id of [
      "deck-match",
      "deck-non-match-tribe",
      "deck-non-match-category",
    ]) {
      expect(after.cardInstances.find((c) => c.instanceId === id)!.zone).toBe(
        "trash"
      );
    }
    expect(
      after.cardInstances.find((c) => c.instanceId === "src-x01")!
        .normalCoreCount
    ).toBe(1);
  });
});

describe("BSTH11-C03 effects[2]『スタック『相手のメインステップ』』相手契約カード以外のネクサス配置無効化(stub解消)", () => {
  it("構造 = activated/stack + timingScope(opponent/main) + usageLimit(per_card_name/turn) + condition(no_contract_card, player:opponent, negate:true) + negate(place, isContract:false)", () => {
    const def = getCardDefinitionById("BSTH11-C03")!;
    const effect = def.effects[2]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(effect.timingScope).toEqual({ player: "opponent", period: "main" });
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "turn",
    });
    expect(effect.condition).toEqual([
      { kind: "no_contract_card", player: "opponent", negate: true },
    ]);
    const negate = effect.steps[0]!.action;
    expect(negate.kind).toBe("negate");
    if (negate.kind === "negate") {
      expect(negate.negateTarget).toBe("place");
      expect(negate.targetFilter).toEqual({
        category: ["nexus"],
        isContract: false,
      });
    }
  });

  // ConditionClause "no_contract_card" の player/negate 一般化 (ENGINE-no-contract-card-opponent-scope)
  // のユニット検証。従来は自分限定 (player 省略=自分) だったが、BSTH11-C03「相手が契約していれば」を
  // 表現するため player:"opponent" + negate:true の組み合わせを新規サポートした。
  describe("ConditionClause no_contract_card の player/negate 一般化", () => {
    const noopDefs = new Map<string, CardDefinition>();
    const getNoopDef = (id: string) => noopDefs.get(id);

    it("相手が契約カード未提示 → player:opponent,negate:true で false (「相手が契約していれば」不成立)", () => {
      const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
      expect(
        evaluateCondition(
          state,
          [{ kind: "no_contract_card", player: "opponent", negate: true }],
          "n/a",
          ALICE,
          getNoopDef
        )
      ).toBe(false);
    });

    it("相手が契約カードを提示済み → player:opponent,negate:true で true (「相手が契約していれば」成立)", () => {
      const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
      const bob = state.players.find((p) => p.id === BOB)!;
      bob.contractCardNo = "BSTH11-C03";
      expect(
        evaluateCondition(
          state,
          [{ kind: "no_contract_card", player: "opponent", negate: true }],
          "n/a",
          ALICE,
          getNoopDef
        )
      ).toBe(true);
    });

    it("自分(actingPlayerId)が契約カードを提示済みでも、相手が未提示なら player:opponent,negate:true は false (自分/相手を混同しない)", () => {
      const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
      const alice = state.players.find((p) => p.id === ALICE)!;
      alice.contractCardNo = "BSTH11-C03";
      expect(
        evaluateCondition(
          state,
          [{ kind: "no_contract_card", player: "opponent", negate: true }],
          "n/a",
          ALICE,
          getNoopDef
        )
      ).toBe(false);
    });

    it("player 省略時は従来通り自分限定 (負の互換確認): 自分が契約カード未提示 → true", () => {
      const state = createEmptyGameState({ playerIds: [ALICE, BOB] });
      expect(
        evaluateCondition(
          state,
          [{ kind: "no_contract_card" }],
          "n/a",
          ALICE,
          getNoopDef
        )
      ).toBe(true);
    });
  });
});

describe("BSTH11-X02「摩多羅 隠岐奈」effects[0] フラッシュ【現界】: 自分の≪ソウルコア≫をトラッシュに置くことで手札から出す", () => {
  const def = getCardDefinitionById("BSTH11-X02")!;
  const effect = def.effects[0]!;
  const noLookup = () => [];

  it("DSL構造: activated/flash + timingScope(both,attack) + field_has(nexus,grandwalker,秘神) + core_move(reserve→trash,explicit_soul_core,requireFullCount) → conditional_cost put(self,effectScope:genkai)", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(effect.timingScope).toEqual({ player: "both", period: "attack" });
    expect(effect.applicability).toEqual({ zone: "hand" });
    expect(effect.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        category: ["nexus"],
        grandwalkerKind: "grandwalker",
        tribes: ["秘神"],
      },
    ]);
    const cost = effect.steps[0]!.action;
    expect(cost.kind).toBe("core_move");
    if (cost.kind === "core_move") {
      expect(cost.from).toEqual({
        kind: "union",
        sources: [
          { kind: "field", player: "self", includeReserve: true },
          { kind: "life", player: "self" },
        ],
      });
      expect(cost.to).toEqual({ kind: "trash", player: "self" });
      expect(cost.effectKind).toBe("explicit_soul_core");
      expect(cost.requireFullCount).toBe(true);
    }
    expect(effect.steps[1]!.connector).toBe("conditional_cost");
    const put = effect.steps[1]!.action;
    expect(put.kind).toBe("put");
    if (put.kind === "put") {
      expect(put.target).toEqual({ kind: "self" });
      expect(put.costModifier).toBe("free");
      expect(put.effectScope).toBe("genkai");
    }
  });

  function buildState(includeOkina: boolean): GameState {
    const x02 = createCardInstance(def, {
      instanceId: "x02-hand",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "hand",
    });
    const okina = createCardInstance(getCardDefinitionById("BSTH11-X01")!, {
      instanceId: "x02-okina",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 2,
    });
    const attacker = createCardInstance(getCardDefinitionById("BSTH11-C01")!, {
      instanceId: "x02-opponent-attacker",
      ownerPlayerId: BOB,
      controllerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1,
    });
    return {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: includeOkina ? [x02, okina, attacker] : [x02, attacker],
        playerOverrides: [
          {
            soulCoreLocation: { kind: "reserve" },
            reserveNormalCoreCount: 1,
          },
          {},
        ],
      }),
      step: "attack",
      activePlayerId: BOB,
      window: "flash_before_block",
      activeAttack: {
        attackId: "x02-regression-attack",
        primaryEntityId: "x02-regression-attacker-entity",
        participantEntityIds: ["x02-regression-attacker-entity"],
        groupMode: "single",
        target: { kind: "player", playerId: ALICE },
        blockAssignments: [],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: ALICE,
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: ALICE,
          pendingStackAction: null,
        },
      },
      battleEntities: [
        {
          entityId: "x02-regression-attacker-entity",
          memberInstanceIds: ["x02-opponent-attacker"],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
    };
  }

  function closeHandEffectStack(state: GameState): GameState {
    let current = state;
    for (let guard = 0; guard < 10; guard += 1) {
      const passer = [ALICE, BOB].find((playerId) =>
        getLegalActions({
          state: current,
          actingPlayerId: playerId,
          getCardDefinitionById,
          getRegisteredHandActivatedEffectActions,
          getRegisteredFieldCardEffectActions: noLookup,
        }).some(
          (a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash"
        )
      );
      if (!passer) return current;
      const pass = getLegalActions({
        state: current,
        actingPlayerId: passer,
        getCardDefinitionById,
        getRegisteredHandActivatedEffectActions,
        getRegisteredFieldCardEffectActions: noLookup,
      }).find(
        (a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash"
      )!;
      current = applyLegalAction({
        state: current,
        action: pass,
        getCardDefinitionById,
        getRegisteredHandActivatedEffectActions,
        getRegisteredFieldCardEffectActions: noLookup,
        getRegisteredTriggeredEffectActions: noLookup,
      }).state;
    }
    throw new Error("BSTH11-X02 hand effect stack did not close");
  }

  it("[board] 秘神系統の創界神ネクサス「隠岐奈」があるとき、ソウルコアをトラッシュに置いて手札から出し、維持コア配置 pending を経る。この場入りは summon ではなく put", () => {
    const before = buildState(true);
    const declarationActions = getLegalActions({
      state: before,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredHandActivatedEffectActions,
      getRegisteredFieldCardEffectActions: noLookup,
    });
    const declaration = declarationActions.find(
      (a) =>
        a.kind === "use_hand_card_effect" &&
        a.sourceInstanceId === "x02-hand" &&
        a.effectIndex === 0
    );
    expect(declaration).toBeDefined();
    const declared = applyLegalAction({
      state: before,
      action: declaration!,
      getCardDefinitionById,
      getRegisteredHandActivatedEffectActions,
      getRegisteredFieldCardEffectActions: noLookup,
      getRegisteredTriggeredEffectActions: noLookup,
    }).state;
    expect(
      declared.cardInstances.find((c) => c.instanceId === "x02-hand")?.zone
    ).toBe("in_use");
    expect(
      declared.players.find((p) => p.id === ALICE)?.soulCoreLocation
    ).toEqual({ kind: "reserve" });
    const after = closeHandEffectStack(declared);
    expect(after.pendingStepChoice).toBeNull();

    const alice = after.players.find((p) => p.id === ALICE)!;
    expect(alice.soulCoreLocation).toEqual({ kind: "trash" });
    const x02After = after.cardInstances.find(
      (c) => c.instanceId === "x02-hand"
    )!;
    expect(x02After.zone).toBe("field");
    expect(after.pendingMultiPlacement).toBeTruthy();
    expect(after.pendingMultiPlacement?.targets).toEqual([
      expect.objectContaining({
        instanceId: "x02-hand",
        minimumCoreCount: 1,
        enterFieldEventKind: "put",
        effectScope: "genkai",
      }),
    ]);

    const placed = applyLegalAction({
      state: after,
      action: {
        kind: "resolve_pending_multi_placement",
        actionId: "mp-test",
        can: true,
        reason: "test",
        actingPlayerId: ALICE,
        pendingId: after.pendingMultiPlacement!.pendingId,
        targets: [],
      },
      multiPlacementAllocations: [
        {
          destinationInstanceId: "x02-hand",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noLookup,
    }).state;

    const events = collectTriggerEventsFromStateDelta({
      beforeState: before,
      afterState: placed,
      source: "action_resolution",
    });
    const putEvent = events.find(
      (e) => e.relatedInstanceId === "x02-hand" && e.eventKind === "put"
    );
    const summonEvent = events.find(
      (e) => e.relatedInstanceId === "x02-hand" && e.eventKind === "summon"
    );
    expect(putEvent).toBeDefined();
    expect(putEvent!.effectScope).toBe("genkai");
    expect(summonEvent).toBeUndefined();
  });

  it("[board] 秘神系統の創界神ネクサスが無ければ条件不成立で発揮されない(ソウルコアも消費されない)", () => {
    const before = buildState(false);
    const declaration = getLegalActions({
      state: before,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredHandActivatedEffectActions,
      getRegisteredFieldCardEffectActions: noLookup,
    }).find(
      (a) =>
        a.kind === "use_hand_card_effect" &&
        a.sourceInstanceId === "x02-hand" &&
        a.effectIndex === 0
    );
    expect(declaration).toBeUndefined();
    expect(
      before.players.find((p) => p.id === ALICE)?.soulCoreLocation
    ).toEqual({ kind: "reserve" });
  });
});

describe("BSTH11-X02「摩多羅 隠岐奈」effects[1,2] Lv1-2-3『現界/アタック/ブロック時』: コア分配+相手trash除外連動デッキ送り+deck_reveal無償召喚/配置(stub解消)", () => {
  const def = getCardDefinitionById("BSTH11-X02")!;
  const effect = def.effects[1]!;
  const noLookup = () => [];

  it("effects[2]: card_event(attack,block)、effects[1]と同一stepsを共有(敵対的検証round1指摘対応の分離、第三者混同防止のためsummonをこのeventリストに含めない)", () => {
    const attackBlockEffect = def.effects[2]!;
    expect(attackBlockEffect.stub).toBeUndefined();
    expect(attackBlockEffect.timing).toEqual({
      kind: "card_event",
      event: ["attack", "block"],
    });
    expect(attackBlockEffect.steps).toBe(effect.steps);
  });

  it("DSL構造: card_event(put)+effectScope:genkai(=【現界】で出したときのみ、第三者/将来の真の「召喚時」効果とは非混同) + [1]core_distribute(void→green grandwalker/guided nexus,amount:2,player_choice) + [2]search_zone(opponent trash→removed_from_game,count:{min:0}) + [3]search_zone(自分trash→deck bottom,count:cards_from_ref([2])) + [4]deck_reveal(2枚,天璋/秘神,maxCost:7,destination:field,remainder:bottom)", () => {
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({
      kind: "card_event",
      event: "put",
      effectScope: "genkai",
    });
    expect(effect.steps).toHaveLength(4);

    const distribute = effect.steps[0]!.action;
    expect(distribute.kind).toBe("core_distribute");
    if (distribute.kind === "core_distribute") {
      expect(distribute.from).toEqual({ kind: "void", player: "self" });
      expect(distribute.amount).toBe(2);
      expect(distribute.mode).toBe("player_choice");
      expect(distribute.to).toEqual({
        kind: "filter",
        player: "self",
        filter: {
          category: ["nexus"],
          colors: ["green"],
          targetsGrandwalker: "only",
          grandwalkerKind: "any",
        },
        count: "all",
      });
    }

    const exile = effect.steps[1]!.action;
    expect(effect.steps[1]!.id).toBe("x02-exile-opponent-trash");
    expect(exile.kind).toBe("search_zone");
    if (exile.kind === "search_zone") {
      expect(exile.player).toBe("opponent");
      expect(exile.zone).toBe("trash");
      expect(exile.count).toEqual({
        min: 0,
        max: {
          source: { kind: "cards_in_zone", zone: "trash", player: "opponent" },
        },
      });
      expect(exile.destination).toBe("removed_from_game");
    }

    const trashToDeck = effect.steps[2]!.action;
    expect(trashToDeck.kind).toBe("search_zone");
    if (trashToDeck.kind === "search_zone") {
      expect(trashToDeck.player).toBe("self");
      expect(trashToDeck.zone).toBe("trash");
      expect(trashToDeck.count).toEqual({
        source: {
          kind: "cards_from_ref",
          stepId: "x02-exile-opponent-trash",
        },
      });
      expect(trashToDeck.destination).toBe("deck");
      expect(trashToDeck.destinationPosition).toBe("bottom");
    }

    const reveal = effect.steps[3]!.action;
    expect(reveal.kind).toBe("deck_reveal");
    if (reveal.kind === "deck_reveal") {
      expect(reveal.revealCount).toBe(2);
      expect(reveal.remainder).toBe("bottom");
      expect(reveal.picks).toEqual([
        {
          count: 1,
          filter: {
            category: ["spirit", "ultimate", "brave", "nexus"],
            tribes: ["天璋", "秘神"],
            maxCost: 7,
          },
          destination: "field",
        },
      ]);
    }
  });

  it("[board] 分配先ネクサス無し・相手トラッシュ空でも、デッキ上2枚から系統一致コスト7以下のカードを無償で場に出せる。残りはデッキ下へ", () => {
    const x02 = createCardInstance(def, {
      instanceId: "x02-field",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const pick = getCardDefinitionById("BSTH11-C01")!; // 系統: 幻想・天璋・妖精, cost 1
    const filler = getCardDefinitionById("BSKB01-C01")!; // 系統に天璋/秘神を含まない
    const pickInstance = createCardInstance(pick, {
      instanceId: "x02-deck-top",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const fillerInstance = createCardInstance(filler, {
      instanceId: "x02-deck-second",
      ownerPlayerId: ALICE,
      zone: "deck",
    });
    const state = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: [x02, pickInstance, fillerInstance],
      playerOverrides: [{ deckCount: 2 }, {}],
    });

    let after = executeEffect({
      chainId: "test:bsth11-cards:4395",
      state,
      effect,
      sourceInstanceId: "x02-field",
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noLookup,
    });

    // steps[0](core_distribute)を辞退し、steps[1,2](exile/デッキ送り)は候補0件で自然にno-op、
    // steps[3](deck_reveal)は実行を選び resolve_pending_deck_reveal_pick へ進める。
    while (after.pendingStepOptionalChoice !== null) {
      const pending = after.pendingStepOptionalChoice;
      const choice = pending.stepIndex === 3 ? "execute" : "decline";
      after = applyLegalAction({
        state: after,
        action: {
          kind: "resolve_pending_step_optional_choice",
          actionId: `pso-${pending.pendingId}:${choice}`,
          can: true,
          reason: "test",
          actingPlayerId: pending.choosingPlayerId,
          pendingId: pending.pendingId,
          sourceInstanceId: pending.sourceInstanceId,
          effectIndex: pending.effectIndex,
          stepIndex: pending.stepIndex,
          choice,
        },
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: noLookup,
      }).state;
    }

    // 候補は x02-deck-top(系統一致・コスト1)の1枚のみ。
    const revealAction = getLegalActions({
      state: after,
      actingPlayerId: ALICE,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => undefined,
    }).find((a) => a.kind === "resolve_pending_deck_reveal_pick");
    expect(revealAction).toBeDefined();
    if (revealAction?.kind === "resolve_pending_deck_reveal_pick") {
      expect(revealAction.candidateCardInstanceIds).toEqual(["x02-deck-top"]);
    }
    after = applyLegalAction({
      state: after,
      action: revealAction!,
      selectedDeckRevealCardIds: ["x02-deck-top"],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noLookup,
    }).state;
    after = finishCoreChoices(after, getCardDefinitionById);

    expect(after.pendingDeckReveal).toBeNull();
    const pickAfter = after.cardInstances.find(
      (c) => c.instanceId === "x02-deck-top"
    )!;
    expect(pickAfter.zone).toBe("field");
    const fillerAfter = after.cardInstances.find(
      (c) => c.instanceId === "x02-deck-second"
    )!;
    expect(fillerAfter.zone).toBe("deck");
  });
});

describe("BSTH11-X01「[創界神]摩多羅 隠岐奈」divineSkills[0]『神技：2～6』Lv2：フラッシュ/スタック(stub解消、coreCost範囲選択+flash_or_stackタイミング+動的max対象数、engine-bsth11-x01-divine-skill-wiring)", () => {
  const def = getCardDefinitionById("BSTH11-X01")!;

  function dummyBobStack(): ActiveStack {
    return {
      stackId: "stack:bob-dummy-shingi",
      actionKind: "magic",
      chainId: "chain:bob-dummy-shingi",
      actingPlayerId: BOB,
      cardInstanceId: "bob-dummy-magic-shingi",
      cardDefinitionId: "BOB-DUMMY-MAGIC",
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };
  }

  function fieldCardInstances() {
    const okina = createCardInstance(def, {
      instanceId: "shingi-okina",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 8,
    });
    // 系統「天璋」を持ちコスト3/4以外の候補2体 (BSTH11-M01 cost6 / BSTH11-R03 cost5)。
    // Lv1 requiredCores 分のコアを置く(コア不足消滅を避ける、M01/R03とも requiredCores:1)。
    const cand1 = createCardInstance(getCardDefinitionById("BSTH11-M01")!, {
      instanceId: "shingi-cand1",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    const cand2 = createCardInstance(getCardDefinitionById("BSTH11-R03")!, {
      instanceId: "shingi-cand2",
      ownerPlayerId: ALICE,
      controllerPlayerId: ALICE,
      zone: "field",
      normalCoreCount: 1,
    });
    // 系統「天璋」を持つがコスト4のため除外される候補 (BSTH11-C03、Lv1 requiredCores:1)。
    const excludedByCost = createCardInstance(
      getCardDefinitionById("BSTH11-C03")!,
      {
        instanceId: "shingi-excluded-cost",
        ownerPlayerId: ALICE,
        controllerPlayerId: ALICE,
        zone: "field",
        normalCoreCount: 2,
      }
    );
    return [okina, cand1, cand2, excludedByCost];
  }

  /** スタック応答窓中(応答優先権あり)。宣言 legal 判定のみに使う(cascade解決には使わない、
   * dummyBobStack は実カードを持たないため resolveDeferredMagicStack がクラッシュする)。 */
  function stackResponseState(): GameState {
    return {
      ...createEmptyGameState({
        playerIds: [ALICE, BOB],
        cardInstances: fieldCardInstances(),
      }),
      step: "main",
      activePlayerId: BOB,
      window: "stack",
      stackWindow: {
        priorityPlayerId: ALICE,
        consecutivePassCount: 0,
        actingPlayerId: BOB,
        previousWindow: "main",
        stackResponseSourcePlayerId: BOB,
        subStackEverOpened: false,
        burstWindowKind: null,
        pendingStackAction: dummyBobStack(),
      },
    };
  }

  /** フラッシュ本体ループ中(応答優先権あり)。宣言→解決まで完結させる[board]テスト用
   * (engine-divine-skill-stack-timing-variant.test.ts buildFlashBodyState precedentと同型)。 */
  function flashBodyState(): GameState {
    const activeAttack: ActiveAttack = {
      attackId: "atk-shingi-1",
      primaryEntityId: "e-shingi-attacker",
      participantEntityIds: ["e-shingi-attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: ALICE },
      blockAssignments: [],
      symbolResolutionOrder: [],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: ALICE,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: ALICE,
        pendingStackAction: null,
      },
    };
    const base = createEmptyGameState({
      playerIds: [ALICE, BOB],
      cardInstances: fieldCardInstances(),
      activeAttack,
      battleEntities: [
        {
          entityId: "e-shingi-attacker",
          memberInstanceIds: ["shingi-bob-attacker"],
          resolvedBp: 5000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
    });
    return {
      ...base,
      step: "attack",
      activePlayerId: BOB,
      window: "flash_before_block",
    };
  }

  /**
   * 開いたスタック窓 (トップレベル stackWindow / バトルフラッシュ内サブ窓の
   * いずれも) を responder のパスで閉じ、deferred 解決まで進める。優先権保持者を
   * 内部 state 形状 (stackWindow vs activeAttack.flashWindowState) で判別せず、
   * ALICE/BOB いずれかに pass_stack/pass_battle_flash が legal な限りパスし続ける
   * (両者とも無ければ窓は閉じている)。
   */
  function passStackUntilClosed(state: GameState): GameState {
    const isPassKind = (kind: string) =>
      kind === "pass_stack" || kind === "pass_battle_flash";
    let current = state;
    let guard = 0;
    while (guard++ < 10) {
      const passer = [ALICE, BOB].find((playerId) =>
        getLegalActions({
          state: current,
          actingPlayerId: playerId,
          getCardDefinitionById,
          getRegisteredFieldCardEffectActions: () => [],
        }).some((a) => isPassKind(a.kind))
      );
      if (!passer) return current;
      const actions = getLegalActions({
        state: current,
        actingPlayerId: passer,
        getCardDefinitionById,
        getRegisteredFieldCardEffectActions: () => [],
      });
      const pass = actions.find((a) => isPassKind(a.kind))!;
      current = applyLegalAction({
        state: current,
        action: pass,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: noTriggerLookup,
      }).state;
    }
    return current;
  }

  it("スタック応答窓中(応答優先権あり)でも神技:2～6の宣言が legal になる(flash_or_stack)", () => {
    const state = stackResponseState();
    const actions = getAvailableDivineSkillLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    // 発揮宣言は1件。コア数・対象は窓後に順番に選ぶ。
    expect(actions).toHaveLength(1);
  });

  it("[board] コア4個支払い(2個につき1体、最大2体)で天璋の候補2体を手札へ戻し、コスト4の候補は候補外(excludeCosts)", () => {
    const state = flashBodyState();
    const actions = getAvailableDivineSkillLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    const declare = actions[0];
    expect(
      declare,
      "coreCost=4 declare action (destination:hand)"
    ).toBeDefined();

    const declared = applyLegalAction({
      state,
      action: declare!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;

    const paymentState = passStackUntilClosed(declared.state);
    expect(paymentState.pendingStepOptionalTargetSelection).toBeNull();
    const payment = getLegalActions({
      state: paymentState,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_core_source_allocation")!;
    const current = applyLegalAction({
      state: paymentState,
      action: payment,
      getCardDefinitionById,
      coreSourceAllocations: { "shingi-okina": 4 },
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(
      current.cardInstances.find((c) => c.instanceId === "shingi-okina")!
        .normalCoreCount
    ).toBe(4);
    expect(current.pendingStepOptionalTargetSelection).toBeTruthy();
    const pending = current.pendingStepOptionalTargetSelection!;
    // excludeCosts:[3,4] によりコスト4の候補は候補一覧から除外される。
    expect(pending.candidateInstanceIds).not.toContain("shingi-excluded-cost");
    expect(pending.candidateInstanceIds).toContain("shingi-cand1");
    expect(pending.candidateInstanceIds).toContain("shingi-cand2");
    // 「自分のスピリット/創界神ネクサス」には発揮元自身も含む。
    expect(pending.candidateInstanceIds).toContain("shingi-okina");

    const targetActions = getLegalActions({
      state: current,
      actingPlayerId: pending.actingPlayerId,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => [],
    });
    const chosen = targetActions.find(
      (a) => a.kind === "resolve_pending_step_optional_target_selection"
    );
    expect(
      chosen,
      "resolve_pending_step_optional_target_selection action"
    ).toBeDefined();
    expect(
      (chosen as { maxTargetCount?: number }).maxTargetCount,
      "maxTargetCount = floor(4/2)"
    ).toBe(2);

    const selected = applyLegalAction({
      state: current,
      action: chosen!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: ["shingi-cand1", "shingi-cand2"],
    }).state;
    const destination = getLegalActions({
      state: selected,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_zone_selection")!;
    const resolved = applyLegalAction({
      state: selected,
      action: destination,
      selectedZoneCardIds: ["shingi-cand1", "shingi-cand2"],
      zoneSelectionDestinationByCardId: {
        "shingi-cand1": "hand",
        "shingi-cand2": "set_aside",
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;

    expect(
      resolved.cardInstances.find((c) => c.instanceId === "shingi-cand1")!.zone
    ).toBe("hand");
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "shingi-cand2")!.zone
    ).toBe("set_aside");
    expect(
      resolved.cardInstances.find(
        (c) => c.instanceId === "shingi-excluded-cost"
      )!.zone
    ).toBe("field");
    // コアはネクサス自身から支払われる(-4)。
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "shingi-okina")!
        .normalCoreCount
    ).toBe(4);
  });

  it("[board] コア3個支払い時、端数切り捨てで最大1体まで(裁定2026-08-03案B: 減らしたコア2個につき、余りは寄与しない)", () => {
    const state = flashBodyState();
    const actions = getAvailableDivineSkillLegalActions({
      state,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    });
    const declare = actions[0];
    expect(declare, "coreCost=3 declare action").toBeDefined();

    const declared = applyLegalAction({
      state,
      action: declare!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    });
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;

    const paymentState = passStackUntilClosed(declared.state);
    const payment = getLegalActions({
      state: paymentState,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_core_source_allocation")!;
    const current = applyLegalAction({
      state: paymentState,
      action: payment,
      getCardDefinitionById,
      coreSourceAllocations: { "shingi-okina": 3 },
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(current.pendingStepOptionalTargetSelection).toBeTruthy();
    const pending = current.pendingStepOptionalTargetSelection!;
    const targetActions = getLegalActions({
      state: current,
      actingPlayerId: pending.actingPlayerId,
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions: () => [],
    });
    const chosen = targetActions.find(
      (a) => a.kind === "resolve_pending_step_optional_target_selection"
    );
    expect(
      (chosen as { maxTargetCount?: number } | undefined)?.maxTargetCount,
      "maxTargetCount = floor(3/2) = 1"
    ).toBe(1);

    const selected = applyLegalAction({
      state: current,
      action: chosen!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
      targetInstanceIds: ["shingi-cand1"],
    }).state;
    const destination = getLegalActions({
      state: selected,
      actingPlayerId: ALICE,
      getCardDefinitionById,
    }).find((a) => a.kind === "resolve_pending_zone_selection")!;
    const resolved = applyLegalAction({
      state: selected,
      action: destination,
      selectedZoneCardIds: ["shingi-cand1"],
      zoneSelectionDestinationByCardId: { "shingi-cand1": "set_aside" },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "shingi-cand1")!.zone
    ).toBe("set_aside");
  });
});

describe("Telegram 629905094: BSTH11-X04 通常pay_costの窓後支払い", () => {
  const lookups = {
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
    getRegisteredTriggeredEffectActions: () => [],
  };
  function setup(owner = "alice") {
    let state = buildPayCostRecoverScenario(
      ALL_CARDS,
      new URLSearchParams({ owner })
    );
    const actions = (playerId = owner) =>
      getLegalActions({ state, actingPlayerId: playerId, ...lookups });
    const apply = (action: import("../src").LegalAction, input = {}) => {
      state = applyLegalAction({ state, action, ...lookups, ...input }).state;
    };
    return {
      get state() {
        return state;
      },
      actions,
      apply,
    };
  }

  it.each(["alice", "bob"])(
    "%s: 対象選択後に2コアHUDを出し、自身から払って回復する",
    (owner) => {
      const game = setup(owner);
      const action = game
        .actions()
        .find(
          (a) =>
            a.kind === "use_field_card_effect" &&
            a.sourceInstanceId === "card-3"
        )!;
      expect(action).toMatchObject({ requiredPayCostAmount: 2 });
      game.apply(action);
      expect(game.state.pendingCoreSourceAllocation).toBeNull();
      expect(game.state.pendingEffectTargetSelection).toBeNull();
      const opponent = owner === "alice" ? "bob" : "alice";
      game.apply(
        game.actions(opponent).find((a) => a.kind === "pass_battle_flash")!
      );
      expect(game.state.pendingEffectTargetSelection).not.toBeNull();
      expect(game.state.pendingCoreSourceAllocation).toBeNull();
      game.apply(
        game.actions().find((a) => a.kind === "resolve_pending_effect_target")!,
        {
          targetInstanceIds: ["card-3"],
        }
      );
      expect(game.state.pendingCoreSourceAllocation).toMatchObject({
        requiredTotal: 2,
        actingPlayerId: owner,
        candidates: [
          {
            instanceId: "card-3",
            available: 4,
            normalAvailable: 4,
            hasSoulCore: false,
          },
        ],
      });
      expect(
        game.state.cardInstances.find((c) => c.instanceId === "card-3")
      ).toMatchObject({
        normalCoreCount: 4,
        exhaustState: "exhausted",
      });
      game.apply(
        game
          .actions()
          .find((a) => a.kind === "resolve_core_source_allocation")!,
        {
          coreSourceAllocations: { "card-3": 2 },
        }
      );
      expect(game.state.pendingCoreSourceAllocation).toBeNull();
      expect(game.state.pendingEffectTargetSelection).toBeNull();
      expect(
        game.state.cardInstances.find((c) => c.instanceId === "card-3")
      ).toMatchObject({
        normalCoreCount: 2,
        exhaustState: "recovered",
        zone: "field",
      });
      expect(
        game.state.cardInstances.find((c) => c.instanceId === "card-13")
          ?.normalCoreCount
      ).toBe(4);
      expect(game.state.players.find((p) => p.id === owner)).toMatchObject({
        reserveNormalCoreCount: 0,
        trashNormalCoreCount: 2,
      });
      expect(
        game.state.log.filter((line) => line.startsWith("effect:pay_cost:"))
      ).toHaveLength(1);
    }
  );

  it("里乃がLv2でも可動コアが2未満なら候補に出さない（創界神コアも除外）", () => {
    const initial = buildPayCostRecoverScenario(ALL_CARDS);
    const state = {
      ...initial,
      activeContinuousEffects: [
        ...initial.activeContinuousEffects,
        {
          effectId: "keep-one-core",
          sourceDefinitionId: "BSTH11-X04",
          actingPlayerId: "alice",
          duration: { scope: "permanent" },
          createdAtTurn: 3,
          createdAtAttackId: null,
          sourceInstanceId: "card-3",
          targetInstanceId: "card-3",
          modifierTag: "prevent_normal_core_move",
          metadata: {},
        } as ContinuousEffect,
      ],
    };
    state.players[0]!.reserveNormalCoreCount = 1;
    // Lv条件は2コアで成立させ、支払い元からは通常コア移動禁止により除外する。
    state.cardInstances.find(
      (c) => c.instanceId === "card-3"
    )!.normalCoreCount = 2;
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookups,
    });
    expect(
      actions.some(
        (a) =>
          a.kind === "use_field_card_effect" && a.sourceInstanceId === "card-3"
      )
    ).toBe(false);
  });
});
