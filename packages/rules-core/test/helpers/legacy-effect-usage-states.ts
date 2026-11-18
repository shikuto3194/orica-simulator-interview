/**
 * 旧形式 (P3-170 以前) の使用会計を持つ GameState の fixture 組み立て (P3-170 W5)。
 *
 * 旧 model.ts (`git show HEAD:packages/rules-core/src/model.ts` 相当) の型に従って手で組む。
 * 旧コードで作った実スナップショットは `fixtures/legacy-effect-usage/real-*.json`
 * (旧 HEAD の fixture をそのまま保存したもの)。ここで組む state は、旧フィールドのうち
 * どれが非空かを fixture ごとの意図として明示する。
 *
 * fixtures/legacy-effect-usage/*.json はこの定義から生成して置く
 * (UPDATE_LEGACY_FIXTURES=1 で test/legacy-effect-usage-fixtures.test.ts が書き出す)。
 * 旧形式の入力は新コードでは作れないので、JSON として固定し、定義との一致を検査する。
 */
import { createCardInstance, createEmptyGameState } from "../../src/factories";
import type { CardDefinition, GameState } from "../../src";
import { ALL_CARDS } from "../../../card-data/src/generated-index";
import { expandCardDefinitionsWithBackFaces } from "../../src";

export type Rec = Record<string, unknown>;

const catalog = new Map(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((card) => [
    card.cardNo,
    card,
  ])
);

export const getCatalogDefinition = (id: string): CardDefinition | undefined =>
  catalog.get(id);

export const ALICE = "alice";
export const BOB = "bob";

export interface LegacyCard {
  id: string;
  cardNo: string;
  owner?: string;
  controller?: string;
  zone?: "field" | "hand" | "trash";
}

/** 旧スナップショットが必ず持っていた、今ターン配列・辞書・記録の空の既定値。 */
function emptyLegacyFields(): Rec {
  return {
    effectUsageRecords: [],
    effectOccurrenceRecords: [],
    usedDivineSkillKeysThisTurn: [],
    usedTrashAdventKeysThisTurn: [],
    usedAlternateCostAdventKeysThisTurn: [],
    usedAdventDeclareKeysThisTurn: [],
    countGainModifierConsumedThisTurn: [],
    pendingAdditionalAttackGrants: [],
    usedTaplessBattleDeclareInstanceIdsThisTurn: [],
    mirageSetCountExemptionsUsed: [],
    effectLifeReductionThisTurn: {},
    declarationCountThisTurn: {},
  };
}

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 旧形式の state (JSON)。`effectAccounting` と `stepOrdinalThisTurn` は持たず、旧フィールドを
 * 空の既定値で持つ。`legacy` で非空にするフィールドを上書きする。
 */
export function legacyState(
  cards: readonly LegacyCard[],
  legacy: Rec = {},
  options: { turnNumber?: number; step?: string } = {}
): Rec {
  const instances = cards.map((card) => {
    const def = catalog.get(card.cardNo);
    if (!def) throw new Error(`unknown card ${card.cardNo}`);
    return createCardInstance(def, {
      instanceId: card.id,
      ownerPlayerId: card.owner ?? ALICE,
      ...(card.controller !== undefined
        ? { controllerPlayerId: card.controller }
        : {}),
      zone: card.zone ?? "field",
    });
  });
  const base = deepCopy(
    createEmptyGameState({ playerIds: [ALICE, BOB], cardInstances: instances })
  ) as unknown as Rec;
  delete base.effectAccounting;
  delete base.stepOrdinalThisTurn;
  return {
    ...base,
    turnNumber: options.turnNumber ?? 3,
    activePlayerId: ALICE,
    step: options.step ?? "main",
    ...emptyLegacyFields(),
    ...deepCopy(legacy),
  };
}

/** 現在のターン・ステップで記録された旧 effectUsageRecords の1件。 */
export function oldRecord(fields: {
  sourceInstanceId: string;
  sourceDefinitionId: string;
  effectLabel: string;
  playerId?: string;
  duration?: "turn" | "game" | "step" | "battle";
  count?: number;
  turnNumber?: number;
  step?: string;
  groupId?: string;
  relatedInstanceId?: string;
  triggerEventScopeKey?: string;
  triggerActivationKey?: string;
  attackId?: string | null;
  sourceFieldInstanceGeneration?: number;
}): Rec {
  const { duration, count, turnNumber, step, ...rest } = fields;
  return {
    ...rest,
    turnNumber: turnNumber ?? 3,
    step: step ?? "main",
    duration: duration ?? "turn",
    count: count ?? 1,
  };
}

// ---------------------------------------------------------------
// fixture 定義 (fixtures/legacy-effect-usage/<name>.json)
// ---------------------------------------------------------------

export interface LegacyFixtureDef {
  comment: string;
  build: () => Rec;
}

const STANDARD_CARDS: LegacyCard[] = [
  { id: "komachi-a", cardNo: "BSTH04-X03" },
  { id: "flan-a", cardNo: "BSTH01-X04" },
  { id: "flan-b", cardNo: "BSTH01-X04", owner: BOB },
  { id: "bakebake-a", cardNo: "BSTH002-C01" },
];

const DIVINE_CARDS: LegacyCard[] = [
  { id: "nexus-eiki", cardNo: "BSTH04-XX01" },
  { id: "nexus-miko-a", cardNo: "BSTH08-XX01" },
  { id: "nexus-miko-b", cardNo: "BSTH08-XX01", owner: BOB },
  { id: "nexus-yukari", cardNo: "BSTH01-XX01" },
  { id: "nexus-cardinal", cardNo: "BSSA01-XX01" },
];

export const LEGACY_FIXTURES: Record<string, LegacyFixtureDef> = {
  "records-basic": {
    comment:
      "旧 effectUsageRecords が非空。per_instance(ターン)、per_card_name(ターン)+per_instance(ゲーム)の併記、" +
      "同一 duration の2制限(H3: 1回の使用で count=2)、相手プレイヤーの同名使用、期限切れ(別ターン)の記録を含む。",
    build: () =>
      legacyState(STANDARD_CARDS, {
        effectUsageRecords: [
          oldRecord({
            sourceInstanceId: "komachi-a",
            sourceDefinitionId: "BSTH04-X03",
            effectLabel: "effect:0",
            playerId: ALICE,
          }),
          oldRecord({
            sourceInstanceId: "flan-a",
            sourceDefinitionId: "BSTH01-X04",
            effectLabel: "effect:1",
            playerId: ALICE,
          }),
          oldRecord({
            sourceInstanceId: "flan-a",
            sourceDefinitionId: "BSTH01-X04",
            effectLabel: "effect:1",
            playerId: ALICE,
            duration: "game",
          }),
          oldRecord({
            sourceInstanceId: "bakebake-a",
            sourceDefinitionId: "BSTH002-C01",
            effectLabel: "effect:0",
            playerId: ALICE,
            count: 2,
          }),
          oldRecord({
            sourceInstanceId: "flan-b",
            sourceDefinitionId: "BSTH01-X04",
            effectLabel: "effect:1",
            playerId: BOB,
          }),
          oldRecord({
            sourceInstanceId: "flan-b",
            sourceDefinitionId: "BSTH01-X04",
            effectLabel: "effect:1",
            playerId: BOB,
            duration: "game",
          }),
          oldRecord({
            sourceInstanceId: "komachi-a",
            sourceDefinitionId: "BSTH04-X03",
            effectLabel: "hand_activated:9",
            playerId: ALICE,
            turnNumber: 2,
          }),
        ],
      }),
  },
  "divine-skill-keys": {
    comment:
      "旧 usedDivineSkillKeysThisTurn が非空。once(instance)・once_per_name(player:cardNo)・" +
      "maxUsesPerTurn=2(同一キーが2要素)・制限なしの技(読まれない死に書き)を含む。",
    build: () =>
      legacyState(DIVINE_CARDS, {
        usedDivineSkillKeysThisTurn: [
          "nexus-eiki:0",
          "alice:BSTH08-XX01:0",
          "nexus-yukari:0",
          "nexus-yukari:0",
          "nexus-cardinal:1",
        ],
      }),
  },
  "advent-keys": {
    comment:
      "旧煌臨の使用済み3配列が非空。trashAdventHostGrant の `player:名前`(使用者付き)、" +
      "代替コスト煌臨と declareUsageLimit の `name:名前`(使用者を含まない。所有者が一意)。",
    build: () =>
      legacyState(
        [
          { id: "kg6-c01", cardNo: "BSAZ01-C01" },
          { id: "shadow-x01", cardNo: "BSSL01-X01" },
          { id: "shadow-x02", cardNo: "BSSL01-X02" },
        ],
        {
          usedTrashAdventKeysThisTurn: ["alice:KG-6 スレイプニール"],
          usedAlternateCostAdventKeysThisTurn: ["name:影の君主 水篠 旬"],
          usedAdventDeclareKeysThisTurn: ["name:真なる影の君主 水篠 旬"],
        }
      ),
  },
  "advent-name-key-ambiguous": {
    comment:
      "旧煌臨の `name:` キーは使用者を含まない(H1)。両プレイヤーが同名カードを所有するため使用者が一意に復元できない。",
    build: () =>
      legacyState(
        [
          { id: "shadow-a", cardNo: "BSSL01-X01" },
          { id: "shadow-b", cardNo: "BSSL01-X01", owner: BOB },
        ],
        { usedAlternateCostAdventKeysThisTurn: ["name:影の君主 水篠 旬"] }
      ),
  },
  "dedicated-flags": {
    comment:
      "旧の専用フラグ: countGainModifierConsumedThisTurn(I05)、usedTaplessBattleDeclareInstanceIdsThisTurn(I06)、" +
      "declareGimmickGateUsedThisTurn(I07, CE id キー)、lifeDamageInterceptionUseCostGateUsedThisTurn(I10)、" +
      "mirageSetCountExemptionsUsed(I08)。",
    build: () =>
      legacyState(
        [
          { id: "rigurudo-a", cardNo: "BSTS01-C03" },
          { id: "renki-a", cardNo: "BSTH09-C03" },
          { id: "mishuram-a", cardNo: "BSLH01-C12" },
          { id: "sou-m05", cardNo: "BSLH01-M05", zone: "hand" },
          { id: "bakebake-a", cardNo: "BSTH002-C01" },
        ],
        {
          countGainModifierConsumedThisTurn: ["alice:BSTS01-C03"],
          usedTaplessBattleDeclareInstanceIdsThisTurn: ["renki-a"],
          declareGimmickGateUsedThisTurn: { "alice:dsl-ce-12": true },
          lifeDamageInterceptionUseCostGateUsedThisTurn: {
            "alice:sou-m05": true,
          },
          mirageSetCountExemptionsUsed: [
            { playerId: ALICE, cardNo: "BSTH002-C01" },
          ],
          activeContinuousEffects: [
            {
              effectId: "dsl-ce-12",
              sourceInstanceId: "mishuram-a",
              sourceDefinitionId: "BSLH01-C12",
              provenance: { effectIndex: 2, stepIndex: 0 },
            },
          ],
        }
      ),
  },
  "mirage-player-wide": {
    comment:
      '旧 mirageSetCountExemptionsUsed の cardNo="*"(旧版のプレイヤー単位の免除消費)。' +
      "特定のカード名に捏造しない。最古の版の mirageSetCountExemptionUsedPlayerIds(cardNo を持たない)は mirage-ancient-player-ids が担う。",
    build: () => {
      const state = legacyState([{ id: "bakebake-a", cardNo: "BSTH002-C01" }], {
        mirageSetCountExemptionsUsed: [{ playerId: ALICE, cardNo: "*" }],
      });
      return state;
    },
  },
  "mirage-ancient-player-ids": {
    comment:
      "最古の版: mirageSetCountExemptionsUsed を持たず、プレイヤー単位の mirageSetCountExemptionUsedPlayerIds だけがある。",
    build: () => {
      const state = legacyState([{ id: "bakebake-a", cardNo: "BSTH002-C01" }]);
      delete state.mirageSetCountExemptionsUsed;
      state.mirageSetCountExemptionUsedPlayerIds = [BOB];
      return state;
    },
  },
  quantities: {
    comment:
      "旧の数量・宣言事実: effectLifeReductionThisTurn / lifeReductionCappedThisTurn / " +
      "bpThresholdCappedLifeReductionThisTurn / filteredLifeReductionCappedThisTurn(CE id キー) / " +
      "symbolAdditionRestrictedCountThisTurn(CE id キー) / declarationCountThisTurn、effectOccurrenceRecords(N回目観測)。",
    build: () =>
      legacyState(
        [
          { id: "riguru-a", cardNo: "BSTH03-C04" },
          { id: "noh-a", cardNo: "BSTH08.5-C21", owner: BOB },
        ],
        {
          effectLifeReductionThisTurn: { bob: 2 },
          lifeReductionCappedThisTurn: { bob: 3 },
          bpThresholdCappedLifeReductionThisTurn: { bob: 1 },
          filteredLifeReductionCappedThisTurn: { "bob:dsl-ce-21": 2 },
          symbolAdditionRestrictedCountThisTurn: { "bob:dsl-ce-22": 1 },
          declarationCountThisTurn: { alice: 1 },
          effectOccurrenceRecords: [
            oldRecord({
              sourceInstanceId: "riguru-a",
              sourceDefinitionId: "BSTH03-C04",
              effectLabel: "effect:2",
              playerId: ALICE,
              count: 3,
            }),
          ],
          activeContinuousEffects: [
            {
              effectId: "dsl-ce-21",
              sourceInstanceId: "noh-a",
              sourceDefinitionId: "BSTH08.5-C21",
              provenance: { effectIndex: 0, stepIndex: 0 },
            },
            {
              effectId: "dsl-ce-22",
              sourceInstanceId: "riguru-a",
              sourceDefinitionId: "BSTH03-C04",
              provenance: { effectIndex: 2, stepIndex: 0 },
            },
          ],
        }
      ),
  },
  grants: {
    comment:
      "旧の権利: pendingAdditionalAttackGrants(各要素=1権利)、activeAttack.connectBattleGrant(残量)、" +
      "pendingConnectBattleDecision.remainingUses(開いた時点の残量の複写)。",
    build: () => {
      const state = legacyState(
        [
          { id: "sakuya-a", cardNo: "BSTH01-X05" },
          { id: "yugi-a", cardNo: "BSTH06-X03" },
        ],
        {
          pendingAdditionalAttackGrants: ["sakuya-a", "sakuya-a"],
          activeAttack: {
            attackId: "attack-1",
            target: { kind: "player", playerId: BOB },
            groupMode: "single",
            primaryEntityId: "battle-entity:yugi-a",
            blockAssignments: [],
            flashWindowState: null,
            connectBattleGrant: {
              sourceInstanceId: "yugi-a",
              remainingUses: 2,
            },
          },
          pendingConnectBattleDecision: {
            pendingId: "connect-battle:attack-1:2",
            actingPlayerId: ALICE,
            sourceInstanceId: "yugi-a",
            attackId: "attack-1",
            remainingUses: 2,
            participantInstanceIds: ["yugi-a"],
            blockSideInstanceIds: [],
            participantSnapshots: [],
            appliedLifeDamage: 0,
            participantOwnSymbols: [],
          },
        }
      );
      return state;
    },
  },
  "recorded-usage-stack": {
    comment:
      "取消に使う旧 recordedUsage(effectLabel / usageLimit を持つ払い戻し情報)。" +
      "スタック窓の pendingStackAction と、同じ宣言の effectUsageRecords(現在のターン・ステップ)を持つ。",
    build: () =>
      legacyState(STANDARD_CARDS, {
        effectUsageRecords: [
          oldRecord({
            sourceInstanceId: "komachi-a",
            sourceDefinitionId: "BSTH04-X03",
            effectLabel: "effect:0",
            playerId: ALICE,
          }),
        ],
        stackWindow: {
          priorityPlayerId: BOB,
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: ALICE,
          pendingStackAction: {
            cardInstanceId: "komachi-a",
            recordedUsage: {
              effectLabel: "effect:0",
              usageLimit: { kind: "per_instance", duration: "turn" },
            },
          },
        },
      }),
  },
  "nested-prior-snapshot": {
    comment:
      "入れ子の state: pendingZoneSelection.priorStateSnapshot が旧形式(神技キーと effectUsageRecords を持つ)。" +
      "親の state 本体も旧形式で、それぞれ独立に変換される。",
    build: () => {
      const inner = legacyState(DIVINE_CARDS, {
        usedDivineSkillKeysThisTurn: ["nexus-eiki:0"],
      });
      return legacyState(DIVINE_CARDS, {
        usedDivineSkillKeysThisTurn: ["alice:BSTH08-XX01:0"],
        pendingZoneSelection: {
          pendingId: "zone-1",
          priorStateSnapshot: inner,
        },
      });
    },
  },
  "extra-turn-nested": {
    comment:
      "追加ターンの入れ子: 現在は追加ターン(turnNumber 5, game 記録あり)、returnContext が中断元(turnNumber 3, step main)、" +
      "さらにその中断元(turnNumber 2)。中断元の旧 effectUsageRecords(game 記録は現行 state が正のため無視される) / turnContext の神技キーを持つ。",
    build: () =>
      legacyState(
        [...DIVINE_CARDS, { id: "flan-a", cardNo: "BSTH01-X04" }],
        {
          effectUsageRecords: [
            oldRecord({
              sourceInstanceId: "flan-a",
              sourceDefinitionId: "BSTH01-X04",
              effectLabel: "effect:1",
              playerId: ALICE,
              duration: "game",
              turnNumber: 4,
              step: "main",
            }),
          ],
          extraTurnState: {
            returnContext: {
              turnNumber: 3,
              activePlayerId: ALICE,
              step: "main",
              window: "main",
              activeAttack: null,
              effectUsageRecords: [
                oldRecord({
                  sourceInstanceId: "nexus-eiki",
                  sourceDefinitionId: "BSTH04-XX01",
                  effectLabel: "label-not-needed-for-game",
                  playerId: ALICE,
                  duration: "game",
                  turnNumber: 3,
                }),
              ],
              turnContext: {
                usedDivineSkillKeysThisTurn: ["nexus-eiki:0"],
                usedTrashAdventKeysThisTurn: [],
                usedAlternateCostAdventKeysThisTurn: [],
                usedAdventDeclareKeysThisTurn: [],
                countGainModifierConsumedThisTurn: [],
                pendingAdditionalAttackGrants: [],
                usedTaplessBattleDeclareInstanceIdsThisTurn: [],
                mirageSetCountExemptionsUsed: [],
                effectLifeReductionThisTurn: {},
                declarationCountThisTurn: {},
              },
              extraTurnState: {
                returnContext: {
                  turnNumber: 2,
                  activePlayerId: BOB,
                  step: "attack",
                  window: "main",
                  activeAttack: null,
                  turnContext: {
                    usedDivineSkillKeysThisTurn: ["alice:BSTH08-XX01:0"],
                    usedTrashAdventKeysThisTurn: [],
                    usedAlternateCostAdventKeysThisTurn: [],
                    usedAdventDeclareKeysThisTurn: [],
                    countGainModifierConsumedThisTurn: [],
                    pendingAdditionalAttackGrants: [],
                    usedTaplessBattleDeclareInstanceIdsThisTurn: [],
                    mirageSetCountExemptionsUsed: [],
                    effectLifeReductionThisTurn: {},
                    declarationCountThisTurn: {},
                  },
                },
              },
            },
          },
        },
        { turnNumber: 5 }
      ),
  },
};

/** 各 fixture を JSON ファイルの内容 (`_comment` つき) にする。 */
export function legacyFixtureJson(name: string): Rec {
  const def = LEGACY_FIXTURES[name];
  if (!def) throw new Error(`unknown legacy fixture ${name}`);
  return { _comment: def.comment, ...def.build() };
}

export type { GameState };
