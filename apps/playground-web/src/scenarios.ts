import { buildR12AccelContinuationScenario } from "./scenario-r12-accel-continuation";
import { buildMirageEffectSwapScenario } from "./scenario-mirage-effect-swap";
import { buildMakaiConditionalCostScenario } from "./scenario-makai-conditional-cost";
import { buildR21ConditionalCostScenario } from "./scenario-r21-conditional-cost";
import { buildSelfMagicReductionScenario } from "./scenario-self-magic-reduction";
import { buildMirageIndividualSwapScenario } from "./scenario-mirage-individual-swap";
import { buildKoishiDiscardScenario } from "./scenario-koishi-discard";
import { buildSeirensenDrawTriggerScenario } from "./scenario-seirensen-draw-trigger";
import { buildKanameRemovalScenario } from "./scenario-kaname-removal";
import { buildDeckExclusionScenario } from "./scenario-deck-exclusion";
import { buildDeadProofCompoundTimingScenario } from "./scenario-dead-proof-compound-timing";
import { buildPayCostRecoverScenario } from "./scenario-pay-cost-recover";
import { buildBraveSemanticEventsScenario } from "./scenario-brave-semantic-events";
import { buildFieldSymbolExtensionScenario } from "./scenario-field-symbol-extension";
import { buildMarisaBraveRewriteScenario } from "./scenario-marisa-brave-rewrite";
import { buildInahoCombineTriggerScenario } from "./scenario-inaho-combine-trigger";
import { buildRevealedTargetSelectionScenario } from "./scenario-revealed-target-selection";
import { buildSnapshotProgressScenario } from "./scenario-snapshot-progress";
import { buildFairyUseOriginScenario } from "./scenario-fairy-use-origin";
import { buildCirnoDivineReleasePaymentScenario } from "./scenario-cirno-divine-release-payment";
import { buildQuartzReplacement } from "./scenario-quartz-replacement";
import { buildCombinedSymbolsScenario } from "./scenario-combined-symbols";
import { buildBslh01X03SymbolScenario } from "./scenario-bslh01-x03-symbol";
import {
  buildBsaz02FidelityScenario,
  buildAldnoahNoCombineScenario,
} from "./scenario-bsaz02-fidelity";
import { buildCardDetailZonesScenario } from "./scenario-card-detail-zones";
import { buildEmptyTargetSelectionScenario } from "./scenario-empty-target-selection";
import { buildEffectBraveChoiceScenario } from "./scenario-effect-brave-choice";
import { buildStackOperationScenario } from "./scenario-stack-operation";
import { buildCardSelectionScenario } from "./scenario-card-selection";
import { buildChoiceContractScenario } from "./scenario-choice-contract";
import { buildPregameOrderScenario } from "./scenario-pregame-order";
import { buildKenshinLevelBpScenario } from "./scenario-kenshin-level-bp";
import { buildKenshinInheritedSymbolScenario } from "./scenario-kenshin-inherited-symbol";
import { buildRecoveryDegreeScenario } from "./scenario-recovery-degree";
import { buildTriggeredSourceDepartureScenario } from "./scenario-triggered-source-departure";
import { buildMainStepEndScenario } from "./scenario-main-step-end";
import { buildCostLeaveCompletionScenario } from "./scenario-cost-leave-completion";
import { buildBattleEndSelectionChainScenario } from "./scenario-battle-end-selection-chain";
import { buildSequentialOrderScenario } from "./scenario-sequential-order";
import { buildHandGainCostScenario } from "./scenario-hand-gain-cost";
import { buildCardTimingScenario } from "./scenario-card-timing";
import { buildRebirthSimultaneousLeaveScenario } from "./scenario-rebirth-simultaneous-leave";
import { buildReactCardCorrectionsScenario } from "./scenario-react-card-corrections";
import { buildNestedAdventTriggersScenario } from "./scenario-nested-advent-triggers";
import { buildFieldCardStateScenario } from "./scenario-field-card-state";
import { buildEffectImmunityScenario } from "./scenario-effect-immunity";
import { buildStarKingPaymentScenario } from "./scenario-star-king-payment";
import { buildBssl01FidelityScenario } from "./scenario-bssl01-fidelity";
import { buildStaleBurstCheckScenario } from "./scenario-stale-burst-check";
import { buildBurstConfirmationScenario } from "./scenario-burst-confirmation";
import { buildM06SummonLifeScenario } from "./scenario-m06-summon-life";
import { buildC23ExclusiveRevealScenario } from "./scenario-c23-exclusive-reveal";
import { buildCombinedEffectStackScenario } from "./scenario-combined-effect-stack";
import { buildBurstEffectTreeScenario } from "./scenario-burst-effect-tree";
import { buildHandIncreaseBurstScenario } from "./scenario-hand-increase-burst";
import { buildNestedGrandstoneTriggersScenario } from "./scenario-nested-grandstone-triggers";
import { buildContractCountRebirthScenario } from "./scenario-contract-count-rebirth";
import { buildBraveBattleContinuationScenario } from "./scenario-brave-battle-continuation";
import { buildSoulStateBraveBattleScenario } from "./scenario-soul-state-brave-battle";
import { buildBraveBpZeroScenario } from "./scenario-brave-bp-zero";
import { buildMutualSoulStateScenario } from "./scenario-mutual-soul-state";
import { buildSelfAttackFlashScenario } from "./scenario-self-attack-flash";
import { buildCountLeaveOrderScenario } from "./scenario-count-leave-order";
import { buildSpecialNexusReferenceScenario } from "./scenario-special-nexus-reference";
import { buildFlashEffectCategoryScenario } from "./scenario-flash-effect-category";
import { buildDivineSkillPaymentScenario } from "./scenario-divine-skill-payment";
import { buildNightSwordScenario } from "./scenario-night-sword";
import { buildBssa01EffectTextScenario } from "./scenario-bssa01-effect-text";
import {
  buildNoDuplicateScenario,
  buildRimuruPendingLeaveScenario,
} from "./scenario-no-duplicate";
import { buildQueueFrontUsageScenario } from "./scenario-queue-front-usage";
import { buildMarsEffectsScenario } from "./scenario-mars-effects";
import { buildBlazingStarOracleScenario } from "./scenario-blazing-star-oracle";
import { buildPlacementOracleTrashScenario } from "./scenario-placement-oracle-trash";
import { buildTrashEntryImmunityScenario } from "./scenario-trash-entry-immunity";
import { buildHiddenProtectionScenario } from "./scenario-hidden-protection";
import { buildOracleContinuationScenario } from "./scenario-oracle-continuation";
import { buildRebirthCombinedLayoutScenario } from "./scenario-rebirth-combined-layout";
import { buildCombinedNexusLayoutScenario } from "./scenario-combined-nexus-layout";
import { buildQuartzLayoutScenario } from "./scenario-quartz-layout";
import { buildGrandwalkerSuppressionScenario } from "./scenario-grandwalker-suppression";
import { buildDomainAuditScenario } from "./scenario-domain-audit";
import { buildKanjudenScenario } from "./scenario-kanjuden";
import { buildKnownDeckScenario } from "./scenario-known-deck";
import {
  buildHiddenCardReturnScenario,
  buildBraveConditionScenario,
} from "./scenario-hidden-return-and-brave";
import { buildContractLeaveChoiceScenario } from "./scenario-contract-leave-choice";
import { buildContractAdventLeaveScenario } from "./scenario-contract-advent-leave";
import { buildContractAdventChargeScenario } from "./scenario-contract-advent-charge";
import { buildOracleTriggerKindsScenario } from "./scenario-oracle-trigger-kinds";
import { buildRevealedBurstSlotScenario } from "./scenario-revealed-burst-slot";
import { buildSimultaneousTriggerLevelScenario } from "./scenario-simultaneous-trigger-level";
import { buildDormantTriggerActorScenario } from "./scenario-dormant-trigger-actor";
import { buildEugeoSummonTimingScenario } from "./scenario-eugeo-summon-timing";
import { buildSummonCategoryScenario } from "./scenario-summon-category";
import { buildSummonSourceUnionScenario } from "./scenario-summon-source-union";
import { buildCoreSourceUnionScenario } from "./scenario-core-source-union";
import { buildGenkaiCostScenario } from "./scenario-genkai-cost";
import { buildManifestScenario } from "./scenario-manifest";
import { buildCoreHudAuditScenario } from "./scenario-core-hud-audit";
import { buildEffectEntryCoreChoiceScenario } from "./scenario-effect-entry-core-choice";
import { buildCoreShootTargetsScenario } from "./scenario-core-shoot-targets";
import { buildPhaseOwnerScenario } from "./scenario-phase-owner";
import { buildCoreDistributionGroupsScenario } from "./scenario-core-distribution-groups";
import { buildCrossoverFidelityScenario } from "./scenario-crossover-fidelity";
import { buildEffectSourceDisplayScenario } from "./scenario-effect-source-display";
import { buildJapaneseEffectChoiceScenario } from "./scenario-japanese-effect-choice";
import { buildStepPromptPerspectiveScenario } from "./scenario-step-prompt-perspective";
import { buildMandatoryFollowupScenario } from "./scenario-mandatory-followup";
import { buildShotRebirthBattleScenario } from "./scenario-shot-rebirth-battle";
import { buildRebirthSameCauseScenario } from "./scenario-rebirth-same-cause";
import { buildTx01AttackStartScenario } from "./scenario-tx01-attack-start";
import { buildSakuyaUnpreventableScenario } from "./scenario-sakuya-unpreventable";
/**
 * UIテスト用シチュエーション定義。
 * URL パラメータ ?scenario=<name> でバトル画面を特定の盤面から開始できる。
 */
import type {
  CardDefinition,
  CardInstance,
  GameState,
} from "@orica/rules-core";
import {
  createEmptyGameState,
  createCardInstance,
  recomputeAndRebuildContinuousEffects,
  queuePendingLeave,
  flushPendingLeaves,
  createMechanicPendingTriggeredEffect,
  buildTriggeredEffectLookup,
  queuePendingReactionsFromTriggerEvents,
  queueFlashUsedTriggers,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
  initializeGame,
  CORES_PER_PLAYER,
  STARTING_LIFE_CORES,
} from "@orica/rules-core";

import { buildEugeoRebirthScenario } from "./scenario-eugeo-rebirth";
import { buildTx01RebirthScenario } from "./scenario-tx01-rebirth";
import { buildC06StackScenario } from "./scenario-bsrk01-c06";
import { buildC07UpToScenario } from "./scenario-bsrk01-c07";

export interface Scenario {
  name: string;
  description: string;
  build: (allCards: CardDefinition[], params?: URLSearchParams) => GameState;
}

function findCards(
  allCards: CardDefinition[],
  category: string,
  count: number,
  startIndex = 0
): CardDefinition[] {
  const candidates = allCards.filter((d) => {
    if (category === "spirit")
      return d.printedCategory === "spirit" && d.levelDefs.length > 0;
    return d.printedCategory === category;
  });
  const result: CardDefinition[] = [];
  for (let i = 0; i < count; i++) {
    const card = candidates[(startIndex + i) % candidates.length];
    if (card) result.push(card);
  }
  return result;
}

let instanceSeq = 0;
function inst(
  def: CardDefinition,
  owner: string,
  zone: "field" | "hand" | "deck" | "revealed" | "set_aside",
  cores = 0
) {
  return createCardInstance(def, {
    instanceId: `sc-${++instanceSeq}`,
    ownerPlayerId: owner,
    zone,
    cores,
  });
}

function makeBaseState(options?: {
  step?: GameState["step"];
  turn?: number;
  active?: string;
  aliceReserve?: number;
  bobReserve?: number;
}): GameState {
  const step = options?.step ?? "main";
  const turn = options?.turn ?? 3;
  const active = options?.active ?? "alice";
  const voidTotal = CORES_PER_PLAYER * 2;
  const aliceReserve = options?.aliceReserve ?? 6;
  const bobReserve = options?.bobReserve ?? 6;
  const usedCores = STARTING_LIFE_CORES * 2 + aliceReserve + bobReserve;

  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: aliceReserve - 1,
          soulCoreLocation: { kind: "reserve" },
        },
        {
          reserveNormalCoreCount: bobReserve - 1,
          soulCoreLocation: { kind: "reserve" },
        },
      ],
      startingVoidNormalCoreCount: voidTotal - usedCores,
    }),
    turnNumber: turn,
    activePlayerId: active,
    step,
  };
}

function requireScenarioCard(
  allCards: CardDefinition[],
  cardNo: string
): CardDefinition {
  const card = allCards.find((d) => d.cardNo === cardNo);
  if (!card) throw new Error(`Scenario card not found: ${cardNo}`);
  return card;
}

/**
 * BSTH01-X03（レミリア）召喚時の誘発と BSTH01-R21（紅魔館 Lv2）responder が
 * 1 個の summon pending を 2 source で共有する盤面（関数宣言は巻き上げられる）。
 *
 * - bob (active / main step) 場: レミリア (4 コア = Lv3) ＋ 紅魔館 (1 コア = Lv2)
 * - bob に創界神/導界者ネクサスなし → X03『召喚時』(相手創界神破壊) の condition 成立
 * - summon イベントを queue 済 → X03 と R21 が同一 pending の 2 source として並ぶ
 *
 * 検証: 前面 (X03) で「発揮しない」を選んでも R21 の誘発がキューに残ること
 * (pendingId 単位の巻き添え削除バグの回帰防止)。
 */
function buildBSTH01X03SummonSharedPending(
  allCards: CardDefinition[]
): GameState {
  instanceSeq = 0;
  const remilia = requireScenarioCard(allCards, "BSTH01-X03");
  const koumakan = requireScenarioCard(allCards, "BSTH01-R21");
  const base = makeBaseState({
    step: "main",
    turn: 5,
    active: "bob",
    aliceReserve: 6,
    bobReserve: 6,
  });

  const remiliaId = "sc-x03-remilia-summon";
  const koumakanId = "sc-r21-koumakan";

  const board: GameState = {
    ...base,
    players: base.players.map((p) => ({ ...p, deckCount: 30, handCount: 0 })),
    cardInstances: [
      createCardInstance(remilia, {
        instanceId: remiliaId,
        ownerPlayerId: "bob",
        zone: "field",
        cores: 4,
      }),
      createCardInstance(koumakan, {
        instanceId: koumakanId,
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
    ],
  };

  const cardNoMap = new Map(allCards.map((c) => [c.cardNo, c]));
  return queuePendingReactionsFromTriggerEvents(
    board,
    [
      {
        actingPlayerId: "bob",
        eventKind: "summon",
        source: "action_resolution",
        chainId: "scenario:scenarios.ts:226",
        attackId: null,
        relatedPlayerId: "bob",
        relatedInstanceId: remiliaId,
        amount: 1,
      },
    ],
    undefined,
    {
      getCardDefinitionById: (id) => cardNoMap.get(id),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(allCards),
      getRegisteredBurstActions: () => undefined,
    }
  );
}

/** 中盤: 両者フィールドにスピリット2体ずつ、手札2枚、メインステップ */
function buildMidBattle(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const aliceSpirits = findCards(allCards, "spirit", 2, 0);
  const bobSpirits = findCards(allCards, "spirit", 2, 10);
  const aliceHand = findCards(allCards, "spirit", 2, 20);
  const bobHand = findCards(allCards, "spirit", 2, 30);

  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 6,
    bobReserve: 6,
  });

  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: p.id === "alice" ? aliceHand.length : bobHand.length,
    })),
    cardInstances: [
      ...aliceSpirits.map((d) => inst(d, "alice", "field", 2)),
      ...aliceHand.map((d) => inst(d, "alice", "hand")),
      ...bobSpirits.map((d) => inst(d, "bob", "field", 2)),
      ...bobHand.map((d) => inst(d, "bob", "hand")),
    ],
  };
}

/** アタックステップ: alice のターン、フィールドにスピリット3体、bob にブロッカー2体 */
function buildAttackPhase(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const aliceSpirits = findCards(allCards, "spirit", 3, 0);
  const bobSpirits = findCards(allCards, "spirit", 2, 15);

  const base = makeBaseState({
    step: "attack",
    turn: 3,
    active: "alice",
    aliceReserve: 4,
    bobReserve: 4,
  });

  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: 0,
    })),
    cardInstances: [
      ...aliceSpirits.map((d) => inst(d, "alice", "field", 2)),
      ...bobSpirits.map((d) => inst(d, "bob", "field", 2)),
    ],
  };
}

/**
 * 致死アタック: alice のターン、alice 攻撃スピリット1体 vs bob (ライフ1, ブロッカー無)。
 * 「ブロックしない」→ ライフダメージ解決でライフ 0 → 敗北確定 (life_zero) を確認する。
 */
function buildLethalAttack(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const aliceSpirits = findCards(allCards, "spirit", 1, 0);

  const base = makeBaseState({
    step: "attack",
    turn: 3,
    active: "alice",
    aliceReserve: 4,
    bobReserve: 4,
  });

  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: 0,
      lifeNormalCoreCount: p.id === "bob" ? 1 : 5,
    })),
    cardInstances: [...aliceSpirits.map((d) => inst(d, "alice", "field", 2))],
  };
}

/**
 * BSLH01-C12【ミシュラムワンダーランド】declareGimmickGate 確認: bob (auto操作) 攻撃スピリット1体
 * vs alice (人間操作, ライフ2, ブロッカー無) + BSLH01-C12 (Lv2)。bob は宣言済み(自身のアタック
 * ゲートを解除済み)で開始し、攻撃→alice ブロックせず解決すると alice (decidingPlayerId) の
 * ライフが減る直前に「宣言して軽減」/「何もしない」の pending choice が alice の画面に立つ
 * (bob が deciding 側だと autoPlayerController が既定 decline で即決するため、alice を
 * deciding 側にして人間操作で pay/decline を検証できるようにする)。
 */
function buildDeclareGimmickGateScenario(
  allCards: CardDefinition[]
): GameState {
  instanceSeq = 0;
  const bobSpirits = findCards(allCards, "spirit", 1, 0);
  const c12 = allCards.find((d) => d.cardNo === "BSLH01-C12")!;

  const base = makeBaseState({
    step: "attack",
    turn: 3,
    active: "bob",
    aliceReserve: 4,
    bobReserve: 4,
  });

  return {
    ...base,
    declarationCountThisTurn: { ...base.declarationCountThisTurn, bob: 1 },
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: 0,
      lifeNormalCoreCount: p.id === "alice" ? 2 : 5,
    })),
    cardInstances: [
      ...bobSpirits.map((d) => inst(d, "bob", "field", 2)),
      inst(c12, "alice", "field", 1), // Lv2 (requiredCores:1)
    ],
  };
}

/** bob のアタック: bob のターン、bob にスピリット2体、alice にブロッカー1体 */
function buildDefensePhase(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const bobSpirits = findCards(allCards, "spirit", 2, 5);
  const aliceSpirits = findCards(allCards, "spirit", 1, 25);
  const aliceHand = [allCards.find((d) => d.cardNo === "BSTH01-C22")!];

  const base = makeBaseState({
    step: "attack",
    turn: 4,
    active: "bob",
    aliceReserve: 5,
    bobReserve: 5,
  });

  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: 28,
      handCount: p.id === "alice" ? aliceHand.length : 0,
    })),
    cardInstances: [
      ...aliceSpirits.map((d) => inst(d, "alice", "field", 2)),
      ...aliceHand.map((d) => inst(d, "alice", "hand")),
      ...bobSpirits.map((d) => inst(d, "bob", "field", 2)),
    ],
  };
}

/** bob の合体スピリットがアタック済みで、alice 優先の前半フラッシュ中。 */
function buildOpponentCombinedFlash(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const hostDef = requireScenarioCard(allCards, "BSTH01-X04");
  const braveDef = requireScenarioCard(allCards, "BSTH01-X09");
  const underDef = requireScenarioCard(allCards, "BSSL01-C05");
  const aliceBlockerDef = findCards(allCards, "spirit", 1, 25)[0] ?? hostDef;
  const bobSupportDef = findCards(allCards, "spirit", 1, 8)[0] ?? hostDef;
  const bobNexusDef = findCards(allCards, "nexus", 1, 0)[0];

  const base = makeBaseState({
    step: "attack",
    turn: 4,
    active: "bob",
    aliceReserve: 5,
    bobReserve: 5,
  });

  const makeCombined = (
    hostId: string,
    braveId: string,
    exhausted: boolean
  ) => {
    const host = createCardInstance(hostDef, {
      instanceId: hostId,
      ownerPlayerId: "bob",
      zone: "field",
      cores: 3,
      exhaustState: exhausted ? "exhausted" : "recovered",
    });
    host.attachedChildrenIds = [braveId];

    const brave = createCardInstance(braveDef, {
      instanceId: braveId,
      ownerPlayerId: "bob",
      zone: "field",
      cores: 0,
    });
    brave.attachedToInstanceId = hostId;
    brave.zoneRoleName = "brave";

    return [host, brave] as const;
  };

  const attackerHostId = "sc-opp-combined-flash-host";
  const attackerBraveId = "sc-opp-combined-flash-brave";
  const supportHostId = "sc-opp-combined-support-host";
  const supportBraveId = "sc-opp-combined-support-brave";
  const rearHostId = "sc-opp-combined-rear-host";
  const rearBraveId = "sc-opp-combined-rear-brave";
  const attackerUnderId = "sc-opp-combined-flash-under";
  const [attackerHost, attackerBrave] = makeCombined(
    attackerHostId,
    attackerBraveId,
    true
  );
  const [supportHost, supportBrave] = makeCombined(
    supportHostId,
    supportBraveId,
    false
  );
  const [rearHost, rearBrave] = makeCombined(rearHostId, rearBraveId, false);
  attackerHost.underCards = [
    {
      cardInstanceId: attackerUnderId,
      role: "text_role",
      roleTag: "バレットエディット",
    },
  ];
  const attackerUnder = createCardInstance(underDef, {
    instanceId: attackerUnderId,
    ownerPlayerId: "bob",
    zone: "field",
    cores: 0,
  });
  attackerUnder.attachedToInstanceId = attackerHostId;
  attackerUnder.zoneRoleName = "bullet-edit";

  return {
    ...base,
    window: "flash_before_block",
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: 0,
    })),
    cardInstances: [
      createCardInstance(aliceBlockerDef, {
        instanceId: "sc-opp-combined-alice-blocker",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 2,
      }),
      supportHost,
      supportBrave,
      attackerHost,
      attackerBrave,
      attackerUnder,
      rearHost,
      rearBrave,
      createCardInstance(bobSupportDef, {
        instanceId: "sc-opp-combined-bob-support",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
      ...(bobNexusDef
        ? [
            createCardInstance(bobNexusDef, {
              instanceId: "sc-opp-combined-bob-nexus",
              ownerPlayerId: "bob",
              zone: "field",
              cores: 1,
            }),
          ]
        : []),
    ],
    battleEntities: [
      {
        entityId: `battle-entity:${attackerHostId}`,
        memberInstanceIds: [attackerHostId, attackerBraveId],
        resolvedBp: 18000,
        resolvedSymbols: ["red", "red"],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: `attack-group:4:bob:battle-entity:${attackerHostId}`,
      primaryEntityId: `battle-entity:${attackerHostId}`,
      participantEntityIds: [`battle-entity:${attackerHostId}`],
      groupMode: "single",
      target: { kind: "player", playerId: "alice" },
      blockAssignments: [
        {
          participantEntityId: `battle-entity:${attackerHostId}`,
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: [`battle-entity:${attackerHostId}`],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: "alice",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "alice",
        pendingStackAction: null,
      },
    },
  };
}

/** 召喚テスト: メインステップ、手札に低コストスピリット3枚+バースト持ち1枚+マジック、リザーブ豊富 */
function buildSummonTest(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const normalSpirits = allCards
    .filter(
      (d) =>
        d.printedCategory === "spirit" &&
        d.levelDefs.length > 0 &&
        d.cost <= 4 &&
        !d.keywordTags.includes("burst")
    )
    .slice(0, 3);
  const burstSpirit = allCards.find(
    (d) =>
      d.printedCategory === "spirit" &&
      d.levelDefs.length > 0 &&
      d.cost <= 5 &&
      d.keywordTags.includes("burst")
  );
  const spirits = burstSpirit
    ? [...normalSpirits, burstSpirit]
    : [
        ...normalSpirits,
        ...allCards
          .filter(
            (d) =>
              d.printedCategory === "spirit" &&
              d.levelDefs.length > 0 &&
              d.cost <= 4
          )
          .slice(3, 4),
      ];
  const magic = findCards(allCards, "magic", 1, 0);

  const base = makeBaseState({
    step: "main",
    turn: 2,
    active: "alice",
    aliceReserve: 10,
    bobReserve: 6,
  });

  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: p.id === "alice" ? spirits.length + magic.length : 2,
    })),
    cardInstances: [
      ...spirits.map((d) => inst(d, "alice", "hand")),
      ...magic.map((d) => inst(d, "alice", "hand")),
      ...findCards(allCards, "spirit", 2, 40).map((d) =>
        inst(d, "bob", "hand")
      ),
    ],
  };
}

/** ブレイヴ合体テスト: フィールドにスピリット2体+ブレイヴ1体（スピリット状態）、メインステップ */
function buildBraveCombine(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const spirits = findCards(allCards, "spirit", 2, 0);
  const brave = allCards.find(
    (d) => d.printedCategory === "brave" && d.levelDefs.length > 0
  );
  const aliceHand = findCards(allCards, "spirit", 1, 5);

  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 8,
    bobReserve: 6,
  });

  const cards: ReturnType<typeof inst>[] = [];
  for (const s of spirits) cards.push(inst(s, "alice", "field", 2));
  if (brave) cards.push(inst(brave, "alice", "field", 1));
  cards.push(...aliceHand.map((d) => inst(d, "alice", "hand")));
  cards.push(
    ...findCards(allCards, "spirit", 2, 10).map((d) =>
      inst(d, "bob", "field", 2)
    )
  );

  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: p.id === "alice" ? aliceHand.length : 0,
    })),
    cardInstances: cards,
  };
}

/**
 * 直接合体召喚 (brave_combine_summon) のスタック窓検証用。
 * - alice 手札: レーヴァテイン (X09 ブレイヴ)
 * - alice 場: フランドール (X04, 3 コア) ＝ X09 の合体先候補
 * - alice main step / リザーブ豊富
 *
 * 検証フロー: 手札の X09 を直接合体召喚で宣言 → コスト支払い後にスタック窓が開き、
 * bob にパスボタンが出る → bob パスで合体が確定し、X09 が X04 へ attach される。
 * (修正前は窓が開かず即合体していた。)
 */
function buildBraveCombineSummonFromHand(
  allCards: CardDefinition[]
): GameState {
  instanceSeq = 0;
  const brave = requireScenarioCard(allCards, "BSTH01-X09");
  const host = requireScenarioCard(allCards, "BSTH01-X04");

  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 10,
    bobReserve: 6,
  });

  const cards = [
    inst(host, "alice", "field", 3),
    inst(brave, "alice", "hand"),
    ...findCards(allCards, "spirit", 1, 10).map((d) =>
      inst(d, "bob", "field", 2)
    ),
  ];

  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: p.id === "alice" ? 1 : 0,
    })),
    cardInstances: cards,
  };
}

/**
 * 合体条件 (cardNameContains) 検証用。
 * alice 場に レーヴァテイン (X09 ブレイヴ・スピリット状態) + レミリア (X03) + フランドール (X04)。
 * X09 の合体条件は「フランドール・スカーレット」(部分一致)。
 * 期待: 合体候補は フランドール のみ。レミリア は候補に出ない。
 */
function buildBSTH01X09CombineCondition(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const levatein = requireScenarioCard(allCards, "BSTH01-X09");
  const remilia = requireScenarioCard(allCards, "BSTH01-X03");
  const flandre = requireScenarioCard(allCards, "BSTH01-X04");

  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 8,
    bobReserve: 6,
  });

  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: 0,
    })),
    cardInstances: [
      createCardInstance(levatein, {
        instanceId: "sc-x09-brave",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(remilia, {
        instanceId: "sc-x09-remilia",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(flandre, {
        instanceId: "sc-x09-flandre",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
    ],
  };
}

/**
 * 効果発揮の効果選択 (2 効果) 検証用。
 * - alice 場: フォーオブアカインド (X04, 3 コア = Lv2)。アタックステップ・activeAttack なし。
 * - X04 は activated/flash 効果を 2 つ持つ:
 *     effect[0] 1コスト払い BP10000以下破壊 (timingScope 両者/アタック)
 *     effect[1] フォーオブアカインド本体 (Lv2-3, ターン1回:同名 + ゲーム1回)
 * - alice 創界神/導界者ネクサスなし + deck ≥ 3 → effect[1] 条件成立。
 * - bob 場に BP10000 以下スピリット (effect[0] の対象)。
 * 期待: X04 タップ → 「効果発揮」1 ボタン → 押下で効果選択モーダル (2 択)。
 */
function buildFourOfAKindMultiEffect(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const flandre = requireScenarioCard(allCards, "BSTH01-X04");
  const attacker = findCards(allCards, "spirit", 1, 5)[0]!;
  const bobSpirit = findCards(allCards, "spirit", 1, 20)[0]!;

  const base = makeBaseState({
    step: "attack",
    turn: 6,
    active: "alice",
    aliceReserve: 8,
    bobReserve: 6,
  });

  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: 0,
    })),
    cardInstances: [
      // フォーオブアカインド本体 (非攻撃)。タップ → 効果発揮 → 効果選択モーダル検証用。
      createCardInstance(flandre, {
        instanceId: "sc-x04-flandre",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 3, // Lv2 (effect[1] applicability 成立)
      }),
      // 別の攻撃役。これでアタック宣言 → フラッシュ窓を開き、その窓で X04 の flash を撃つ。
      createCardInstance(attacker, {
        instanceId: "sc-x04-attacker",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(bobSpirit, {
        instanceId: "sc-x04-bob-target",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1, // Lv1 (低 BP = effect[0] 破壊対象)
      }),
    ],
  };
}

/** ネクサス配置テスト: 手札にネクサス2枚+スピリット1枚、フィールドにスピリット1体、リザーブ豊富 */
function buildNexusPlace(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const nexuses = findCards(allCards, "nexus", 2, 0);
  const handSpirit = findCards(allCards, "spirit", 1, 0);
  const fieldSpirit = findCards(allCards, "spirit", 1, 5);
  const bobSpirits = findCards(allCards, "spirit", 1, 10);

  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 10,
    bobReserve: 6,
  });

  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: p.id === "alice" ? nexuses.length + handSpirit.length : 0,
    })),
    cardInstances: [
      ...nexuses.map((d) => inst(d, "alice", "hand")),
      ...handSpirit.map((d) => inst(d, "alice", "hand")),
      ...fieldSpirit.map((d) => inst(d, "alice", "field", 2)),
      ...bobSpirits.map((d) => inst(d, "bob", "field", 2)),
    ],
  };
}

/** 通常配置の維持コア配置: 導界者ネクサス上のコアを配置元候補に出さない回帰テスト用。 */
function buildGrandwalkerEnterFieldPlacementSource(
  allCards: CardDefinition[]
): GameState {
  instanceSeq = 0;
  const guidedKeya = requireScenarioCard(allCards, "BSLH01-X01");
  const placeTarget = requireScenarioCard(allCards, "BSTH01-C12");
  const normalSource =
    allCards.find(
      (d) =>
        d.printedCategory === "spirit" &&
        d.levelDefs.length > 0 &&
        !d.grandwalkerData &&
        !d.grandstoneData
    ) ?? requireScenarioCard(allCards, "BSTH01-C01");

  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 3,
    bobReserve: 6,
  });

  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: 0,
    })),
    pendingEnterFieldPlacement: {
      pendingId: "sc-gw-placement-pending",
      actingPlayerId: "alice",
      sourceInstanceId: "sc-gw-placement-target",
      sourceDefinitionId: placeTarget.cardNo,
      remainingStacks: [],
      minimumCoreCount: 1,
      maximumCoreCount: null,
    },
    cardInstances: [
      createCardInstance(guidedKeya, {
        instanceId: "sc-gw-placement-guided",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        zoneRoleName: "nexus",
        normalCoreCount: 8,
      }),
      createCardInstance(normalSource, {
        instanceId: "sc-gw-placement-normal-source",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 2,
      }),
      createCardInstance(placeTarget, {
        instanceId: "sc-gw-placement-target",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "in_use",
      }),
    ],
  };
}

/** REST 検証用: 通常ネクサス配置を宣言して実スタック由来の維持コア配置 pending を作る。 */
function buildGrandwalkerNexusPlacementDeclaration(
  allCards: CardDefinition[]
): GameState {
  instanceSeq = 0;
  const guidedKeya = requireScenarioCard(allCards, "BSLH01-X01");
  const placeTarget = requireScenarioCard(allCards, "BSTH01-C12");
  const normalSource =
    allCards.find(
      (d) =>
        d.printedCategory === "spirit" &&
        d.levelDefs.length > 0 &&
        !d.grandwalkerData &&
        !d.grandstoneData
    ) ?? requireScenarioCard(allCards, "BSTH01-C01");

  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 12,
    bobReserve: 6,
  });

  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: p.id === "alice" ? 1 : 0,
    })),
    cardInstances: [
      createCardInstance(guidedKeya, {
        instanceId: "sc-gw-decl-guided",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        zoneRoleName: "nexus",
        normalCoreCount: 8,
      }),
      createCardInstance(normalSource, {
        instanceId: "sc-gw-decl-normal-source",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 2,
      }),
      createCardInstance(placeTarget, {
        instanceId: "sc-gw-decl-target",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "hand",
      }),
    ],
  };
}

/** ネクサス両 player 配置済み: 横画面 4 行 (両 player スピリット 1 + ネクサス 1) のレイアウト計測用。
 *  P2-08 タスク 11: ネクサス行込みの縦領域確保 検証シナリオ。
 *  bob 手札 5 枚を持たせて opponent-hand-area の表示込みで縦領域を検証する。 */
function buildNexusFieldTest(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const aliceSpirits = findCards(allCards, "spirit", 1, 0);
  const aliceNexuses = findCards(allCards, "nexus", 1, 0);
  const bobSpirits = findCards(allCards, "spirit", 1, 10);
  const bobNexuses = findCards(allCards, "nexus", 1, 1);
  const aliceHand = findCards(allCards, "spirit", 2, 20);
  const bobHand = findCards(allCards, "spirit", 5, 30);

  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 6,
    bobReserve: 6,
  });

  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: p.id === "alice" ? aliceHand.length : bobHand.length,
    })),
    cardInstances: [
      ...aliceSpirits.map((d) => inst(d, "alice", "field", 2)),
      ...aliceNexuses.map((d) => inst(d, "alice", "field", 1)),
      ...aliceHand.map((d) => inst(d, "alice", "hand")),
      ...bobSpirits.map((d) => inst(d, "bob", "field", 2)),
      ...bobNexuses.map((d) => inst(d, "bob", "field", 1)),
      ...bobHand.map((d) => inst(d, "bob", "hand")),
    ],
  };
}

/** choice ステップテスト: BSTH01-C05（チルノ）を手札に、相手フィールドにスピリット、メインステップ */
function buildChoiceTest(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const chirno = allCards.find((d) => d.cardNo === "BSTH01-C05");
  const handSpirits = allCards
    .filter(
      (d) =>
        d.printedCategory === "spirit" &&
        d.levelDefs.length > 0 &&
        d.cost <= 3 &&
        d.cardNo !== "BSTH01-C05"
    )
    .slice(0, 2);
  const hand = chirno ? [chirno, ...handSpirits] : handSpirits;
  const bobSpirits = findCards(allCards, "spirit", 2, 15);
  // デッキにカードを入れる（ドロー選択肢のテスト用）
  const usedCardNos = new Set([
    ...hand.map((h) => h.cardNo),
    ...bobSpirits.map((b) => b.cardNo),
  ]);
  const deckCards = allCards
    .filter(
      (d) =>
        d.printedCategory === "spirit" &&
        d.levelDefs.length > 0 &&
        !usedCardNos.has(d.cardNo)
    )
    .slice(0, 10);

  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 10,
    bobReserve: 6,
  });
  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: p.id === "alice" ? deckCards.length : 30,
      handCount: p.id === "alice" ? hand.length : 0,
    })),
    cardInstances: [
      ...hand.map((d) => inst(d, "alice", "hand")),
      ...deckCards.map((d) => inst(d, "alice", "deck")),
      ...bobSpirits.map((d) => inst(d, "bob", "field", 2)),
    ],
  };
}

/**
 * BSGE01-C01: 原文1効果内の draw / trash回収 choice は、マジック使用宣言を
 * 分岐別に分けず、スタック窓が閉じた後に選ぶ。
 */
function buildPostStackStepChoiceBSGE01C01(
  allCards: CardDefinition[]
): GameState {
  instanceSeq = 0;
  const tearstone = requireScenarioCard(allCards, "BSGE01-C01");
  const contract = requireScenarioCard(allCards, "BSGE01-CX01");
  const excluded = new Set([tearstone.cardNo, contract.cardNo]);
  const deckCards = allCards
    .filter((def) => !excluded.has(def.cardNo))
    .slice(0, 4);
  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 10,
    bobReserve: 6,
  });

  return {
    ...base,
    players: base.players.map((player) => ({
      ...player,
      deckCount: player.id === "alice" ? deckCards.length : 30,
      handCount: player.id === "alice" ? 1 : 0,
    })),
    cardInstances: [
      createCardInstance(tearstone, {
        instanceId: "sc-bsge01-c01-tearstone",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(contract, {
        instanceId: "sc-bsge01-c01-contract",
        ownerPlayerId: "alice",
        zone: "trash",
      }),
      ...deckCards.map((def) => inst(def, "alice", "deck")),
    ],
  };
}

/** BSAZ02-C14: トラッシュのCFアルティメット2枚をデッキ上下へ戻す zone_discount 使用。 */
function buildBSAZ02C14ZoneDiscount(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const heavensFall = requireScenarioCard(allCards, "BSAZ02-C14");
  const cfUltimate = requireScenarioCard(allCards, "BSAZ02-C01");
  const bobSpirit = findCards(allCards, "spirit", 1, 10)[0]!;
  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 7,
    bobReserve: 6,
  });

  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: p.id === "alice" ? 1 : 0,
    })),
    cardInstances: [
      createCardInstance(heavensFall, {
        instanceId: "sc-bsaz02-c14-hand",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(cfUltimate, {
        instanceId: "sc-bsaz02-c14-field-cf",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(cfUltimate, {
        instanceId: "sc-bsaz02-c14-trash-top",
        ownerPlayerId: "alice",
        zone: "trash",
      }),
      createCardInstance(cfUltimate, {
        instanceId: "sc-bsaz02-c14-trash-bottom",
        ownerPlayerId: "alice",
        zone: "trash",
      }),
      createCardInstance(bobSpirit, {
        instanceId: "sc-bsaz02-c14-bob-spirit",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
    ],
  };
}

/**
 * P3-63: BSTH02-M01 追加ターン中の状態を直接 inject。
 * burst flow を再現せず、`extraTurnState` をそのまま set した状態でバトル画面を開く。
 * HUD の「＋追加ターン」バッジ表示確認用。
 */
function buildP363ExtraTurnActive(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  // alice 側に何かしらの手札 + フィールドを置いて視覚的に分かりやすくする。
  const aliceSpirit = findCards(allCards, "spirit", 1, 0)[0]!;
  const base = makeBaseState({
    step: "main",
    turn: 6, // 追加ターンなので元 turn (5) + 1
    active: "alice",
    aliceReserve: 4,
    bobReserve: 4,
  });

  return {
    ...base,
    cardInstances: [
      createCardInstance(aliceSpirit, {
        instanceId: "sc-p363-alice-source",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
    ],
    extraTurnState: {
      ownerPlayerId: "alice",
      skipSteps: ["core", "attack"],
      returnContext: {
        turnNumber: 5,
        activePlayerId: "bob",
        step: "attack",
        window: "none",
        activeAttack: null,
      },
    },
  };
}

function buildP362KoumakanMidStack(allCards: CardDefinition[]): GameState {
  // P3-62 ケース 4 (▶コスト 双方向 atomic) のマニュアル検証用シナリオ。
  //
  // 想定操作フロー:
  //   1. alice (active) の紅魔館 (Lv2) で Lv1-Lv2 フラッシュを起動。
  //      cost = set_exhaust_state self (タップ)、effect = 相手 BP5000 以下スピリット
  //      1体 destroy (conditional_cost)。
  //   2. target に bob の BP5000 以下スピリットを指定して宣言。
  //   3. bob は stack で別のフラッシュ (例: バウンス/移動効果) を起動して target を
  //      フィールド外へ。
  //   4. 戻ってきた alice 側 resolve では target 不在 → destroy 0 件 →
  //      conditional_cost 失敗 → cost (exhaust) rollback + usageLimit 1 回分 refund。
  //
  // GUI で 紅魔館 が tap されたまま残らないこと、ターン 1 回制限が再使用可能に
  // 戻ることを目視確認する。
  instanceSeq = 0;
  const koumakan = requireScenarioCard(allCards, "BSTH01-R21");
  // bob 側の BP5000 以下スピリット (target candidate)。 BP 制約で適当なものを選ぶ。
  const bobLowBpSpirit = allCards.find(
    (c) =>
      c.printedCategory === "spirit" &&
      (c.levelDefs?.[0]?.bp ?? 0) > 0 &&
      (c.levelDefs?.[0]?.bp ?? 0) <= 5000 &&
      c.cardNo !== koumakan.cardNo
  );
  if (!bobLowBpSpirit) {
    throw new Error(
      "P3-62 シナリオ前提: BP5000 以下スピリットが card-data に必要"
    );
  }
  const base = makeBaseState({
    step: "attack",
    turn: 3,
    active: "bob",
    aliceReserve: 4,
    bobReserve: 4,
  });

  return {
    ...base,
    cardInstances: [
      createCardInstance(koumakan, {
        instanceId: "sc-p362-koumakan",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1, // Lv2 維持
      }),
      createCardInstance(bobLowBpSpirit, {
        instanceId: "sc-p362-bob-target",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
    ],
  };
}

function buildP329TriggeredStack(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const sourceDef = requireScenarioCard(allCards, "BSTH05.5-C04");
  // フラッシュ/スタック両対応のマジック (BSTH04-C11「審判「ラストジャッジメント」」) を使う。
  // BSTH02.7-TX01(A) は「フラッシュ」のみで「フラッシュ/スタック」ではないため、スタック応答窓
  // (pendingStackAction!==null) では use_magic として提示されない
  // (legal-actions-availability.ts:5092-5117 の timingAllowsFlash/timingAllowsStack ゲート)。
  const stackMagicDef = requireScenarioCard(allCards, "BSTH04-C11");
  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 6,
    bobReserve: 6,
  });

  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: p.id === "alice" ? 8 : 30,
      handCount: p.id === "bob" ? 1 : 0,
    })),
    cardInstances: [
      createCardInstance(sourceDef, {
        instanceId: "sc-p329-trigger-source",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(stackMagicDef, {
        instanceId: "sc-p329-bob-stack-magic",
        ownerPlayerId: "bob",
        zone: "hand",
      }),
    ],
    pendingTriggeredEffects: [
      {
        pendingId: "sc-p329-triggered-pending",
        eventKind: "summon",
        actingPlayerId: "alice",
        source: "action_resolution",
        chainId: "scenario:scenarios.ts:1279",
        attackId: null,
        relatedPlayerId: null,
        relatedInstanceId: "sc-p329-trigger-source",
        amount: null,
        step: "main",
        window: "none",
        resolvedSourceInstanceIds: [],
      },
    ],
  };
}

/**
 * P3-36 Phase C: 混在オーナー pending 公開キュー。
 * BSTH05.5-C04（[緋想天]アリス・マーガトロイド、召喚時 optional）を両 player の場に置き、
 * `pendingTriggeredEffects` に alice / bob 両方の direct-path optional pending を直接注入する。
 *
 * 期待動作:
 *   - alice (ターンプレイヤー) → EffectQueueOverlay でタップ選択 + 「解決」ボタンが表示され、
 *     「次に解決する効果を選択してください（ターンプレイヤーが順番を決める）」のヒント。
 *   - bob (非ターン) → legal action なし（観戦のみ）。
 *   - alice が bob の pending を選択 → bob owner に resolve_pending_triggered_effect が legal に。
 */
function buildP336MixedOwnerPending(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const sourceDef = requireScenarioCard(allCards, "BSTH05.5-C04");
  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 6,
    bobReserve: 6,
  });

  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: 0,
    })),
    cardInstances: [
      createCardInstance(sourceDef, {
        instanceId: "sc-p336-alice-source",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(sourceDef, {
        instanceId: "sc-p336-bob-source",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
    ],
    pendingTriggeredEffects: [
      {
        pendingId: "sc-p336-alice-pending",
        eventKind: "summon",
        actingPlayerId: "alice",
        source: "action_resolution",
        chainId: "scenario:scenarios.ts:1341",
        attackId: null,
        relatedPlayerId: null,
        relatedInstanceId: "sc-p336-alice-source",
        amount: null,
        step: "main",
        window: "none",
        resolvedSourceInstanceIds: [],
      },
      {
        pendingId: "sc-p336-bob-pending",
        eventKind: "summon",
        actingPlayerId: "bob",
        source: "action_resolution",
        chainId: "scenario:scenarios.ts:1355",
        attackId: null,
        relatedPlayerId: null,
        relatedInstanceId: "sc-p336-bob-source",
        amount: null,
        step: "main",
        window: "none",
        resolvedSourceInstanceIds: [],
      },
    ],
  };
}

/**
 * P3-36 残留懸念 B: 同一 owner = turn player の連鎖 pending。
 * BSTH05.5-C04 を alice 場に 2 体置き、両方 alice owner の direct-path optional pending を
 * `pendingTriggeredEffects` に注入する。
 *
 * 期待動作:
 *   - alice (ターンプレイヤー) → 複数 pending のため select 操作で解決順を確定する。
 *   - GUI は前面の任意効果に対する「発揮する / 発揮しない」を ActionBar に表示する。
 */
function buildP336SameOwnerChain(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const sourceDef = requireScenarioCard(allCards, "BSTH05.5-C04");
  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 6,
    bobReserve: 6,
  });

  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: 0,
    })),
    cardInstances: [
      createCardInstance(sourceDef, {
        instanceId: "sc-p336so-alice-source-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(sourceDef, {
        instanceId: "sc-p336so-alice-source-2",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
    ],
    pendingTriggeredEffects: [
      {
        pendingId: "sc-p336so-alice-pending-1",
        eventKind: "summon",
        actingPlayerId: "alice",
        source: "action_resolution",
        chainId: "scenario:scenarios.ts:1415",
        attackId: null,
        relatedPlayerId: null,
        relatedInstanceId: "sc-p336so-alice-source-1",
        amount: null,
        step: "main",
        window: "none",
        resolvedSourceInstanceIds: [],
      },
      {
        pendingId: "sc-p336so-alice-pending-2",
        eventKind: "summon",
        actingPlayerId: "alice",
        source: "action_resolution",
        chainId: "scenario:scenarios.ts:1429",
        attackId: null,
        relatedPlayerId: null,
        relatedInstanceId: "sc-p336so-alice-source-2",
        amount: null,
        step: "main",
        window: "none",
        resolvedSourceInstanceIds: [],
      },
    ],
  };
}

/**
 * P3-30: pay_cost 効果コストの支払いソース選択。
 * BSTH01-X04 [緋想天]フランドール (Lv1 フラッシュ「1 コスト支払って BP10000 以下相手スピ破壊」) を
 * alice 場に置き、リザーブ 0 / フィールドネクサスに 2 コアを置いた状態。
 * フラッシュ起動時に支払いソース選択モーダルが表示されることを確認する用途。
 */
function buildP330PayCostSourceSelection(
  allCards: CardDefinition[]
): GameState {
  instanceSeq = 0;
  const flandre = requireScenarioCard(allCards, "BSTH01-X04");
  // ネクサス代わりに別カード (コアを保持できる任意のカード)
  const nexusDef =
    allCards.find((d) => d.printedCategory === "nexus") ?? flandre;
  const enemyDef = findCards(allCards, "spirit", 1, 15)[0] ?? flandre;
  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 1, // soulCoreLocation: reserve があるので reserveNormalCoreCount = 0
    bobReserve: 4,
  });
  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: 0,
    })),
    cardInstances: [
      createCardInstance(flandre, {
        instanceId: "sc-p330-flandre",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(nexusDef, {
        instanceId: "sc-p330-nexus",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 2,
      }),
      createCardInstance(enemyDef, {
        instanceId: "sc-p330-enemy",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
    ],
  };
}

/**
 * P3-14 A-7: effect_param_modify (BSTH01-X09 レーヴァテイン) 検証用。
 *
 * alice 場にフランドール (BSTH01-X04) + レーヴァテイン (BSTH01-X09 ブレイヴ) 合体スピリットを置き、
 * bob 場に「BP 11000-15000 のアルティメット 1 体」「BP 11000-15000 のスピリット 1 体」
 * 「BP ≤ 10000 のスピリット 1 体」を配置する。
 *
 * フランドール本体の Lv1 フラッシュ destroy は本来 maxBp 10000 / spirit のみだが、
 * effect_param_override CE により maxBp 15000 / spirit+ultimate に拡張される。
 *
 * 確認ポイント:
 * - 11000-15000 アルティメットが destroy 候補に出る (拡張無しなら無効)
 * - 11000-15000 スピリットが destroy 候補に出る (上限拡張で対象化)
 * - ≤10000 のスピリットは常に候補 (基本フィルタで通過)
 * - レーヴァテイン取り外し / 合体解除すると元の filter (maxBp 10000 / spirit) に戻り、
 *   ≤10000 スピリットのみが残る
 *
 * 注: 実カードに Lv1 BP > 15000 のスピリットは存在しないため、上限超え除外の検証は
 * unit test (effect-param-override.test.ts) で合成カードを使って行う。
 */
function buildA7ParamModifyCombined(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const flandre = requireScenarioCard(allCards, "BSTH01-X04");
  const levatein = requireScenarioCard(allCards, "BSTH01-X09");

  // bob 側ターゲット候補: アルティメット (BP 13000) / スピリット (BP 12000) / スピリット (BP 18000)
  const ultimate13k =
    allCards.find(
      (d) =>
        d.printedCategory === "ultimate" &&
        d.levelDefs.length > 0 &&
        (d.levelDefs[0]?.bp ?? 0) >= 11000 &&
        (d.levelDefs[0]?.bp ?? 0) <= 15000
    ) ??
    allCards.find((d) => d.printedCategory === "ultimate") ??
    flandre;
  const spirit12k =
    allCards.find(
      (d) =>
        d.printedCategory === "spirit" &&
        d.levelDefs.length > 0 &&
        (d.levelDefs[0]?.bp ?? 0) >= 11000 &&
        (d.levelDefs[0]?.bp ?? 0) <= 15000
    ) ?? flandre;
  // Lv1 BP > 15000 の実スピリットは存在しないため、scenario 表示用に合成しない。
  // 代わりに BP 8000 (10000以下=ベース filter で常時破壊可) のスピリットを置き、
  // 「合体時に追加で出る ultimate / 14k spirit」と「常時破壊可の 8k spirit」の差を見る。
  const spirit8k =
    allCards.find(
      (d) =>
        d.printedCategory === "spirit" &&
        d.levelDefs.length > 0 &&
        (d.levelDefs[0]?.bp ?? 0) <= 10000 &&
        d.cardNo !== flandre.cardNo
    ) ?? flandre;

  const base = makeBaseState({
    step: "attack",
    turn: 3,
    active: "alice",
    aliceReserve: 4, // フランドール flash の 1 コスト払えるよう余裕
    bobReserve: 4,
  });

  const hostId = "sc-a7-host";
  const braveId = "sc-a7-brave";

  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: 0,
    })),
    cardInstances: [
      {
        ...createCardInstance(flandre, {
          instanceId: hostId,
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        attachedChildrenIds: [braveId],
      },
      {
        ...createCardInstance(levatein, {
          instanceId: braveId,
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        attachedToInstanceId: hostId,
      },
      createCardInstance(ultimate13k, {
        instanceId: "sc-a7-bob-ult",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(spirit12k, {
        instanceId: "sc-a7-bob-spirit-12k",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(spirit8k, {
        instanceId: "sc-a7-bob-spirit-8k",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
    ],
  };
}

function buildP329BattleImmediateStack(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  // BSTH05-M02「鍵山雛」effects[2] (Lv2『このスピリットのアタック時』ターンに1回、
  // このスピリットは回復できる。target:self) を使う。BSTH05-M01 の即時効果は
  // 相手1体を対象選択する型で target 選択を挟むため自動宣言されず、テストが宣言操作
  // なしで直接スタックラベルを確認する経路と噛み合わない。self 対象なら宣言後
  // 即座にスタックへ乗る。
  const attackerDef = requireScenarioCard(allCards, "BSTH05-M02");
  const blockerDef = findCards(allCards, "spirit", 1, 15)[0];
  const base = makeBaseState({
    step: "attack",
    turn: 3,
    active: "alice",
    aliceReserve: 6,
    bobReserve: 6,
  });

  const cardInstances = [
    createCardInstance(attackerDef, {
      instanceId: "sc-p329-bi-attacker",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 3,
      exhaustState: "exhausted",
    }),
    ...(blockerDef
      ? [
          createCardInstance(blockerDef, {
            instanceId: "sc-p329-bi-bob-field",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ]
      : []),
  ];

  return {
    ...base,
    window: "flash_before_block",
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: 0,
    })),
    cardInstances,
    battleEntities: [
      {
        entityId: "battle-entity:sc-p329-bi-attacker",
        memberInstanceIds: ["sc-p329-bi-attacker"],
        resolvedBp: 10000,
        resolvedSymbols: ["green"],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: "attack-group:3:alice:battle-entity:sc-p329-bi-attacker",
      primaryEntityId: "battle-entity:sc-p329-bi-attacker",
      participantEntityIds: ["battle-entity:sc-p329-bi-attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: "battle-entity:sc-p329-bi-attacker",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["battle-entity:sc-p329-bi-attacker"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: "alice",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "alice",
        pendingStackAction: null,
      },
    },
    battleImmediateEffects: [
      {
        promptId: "sc-p329-bi-prompt",
        attackId: "attack-group:3:alice:battle-entity:sc-p329-bi-attacker",
        timing: "attack",
        sourceKind: "spirit",
        sourceInstanceId: "sc-p329-bi-attacker",
        sourceDefinitionId: attackerDef.cardNo,
        sourceCardNo: attackerDef.cardNo,
        actingPlayerId: "alice",
        participantEntityId: "battle-entity:sc-p329-bi-attacker",
        // registrationIndex は effects[] の生配列インデックスではなく、
        // generateBattleImmediateEffectRegistrations が battle timing を持つ効果だけを
        // フィルタした後のサブセット内インデックス (structured-effect-registrations.ts:3420-3423)。
        // BSTH05-M02 は effects[0]=continuous / effects[1]=burst のいずれも battle timing を
        // 持たずスキップされるため、effects[2] (card_event/attack) が唯一の登録 = index 0。
        registrationIndex: 0,
      },
    ],
  };
}

/**
 * P3-50/51/52/53 統合検証: BSTH01-X03 レミリア・スカーレットのアタック宣言後、
 * battle-immediate prompt 2 件 (effects[1] grandwalker destroy / effects[2] BP destroy + recover)
 * が queue される盤面。alice 視点で「発揮」ボタン → target 選択 → resolve の経路を確認する。
 *
 * - alice 場: レミリア 1 体 (4 コア = Lv3、exhausted)
 * - bob 場: 創界神ネクサス (BSTH05-X01 八坂 神奈子) + 低 BP スピリット (≤20000)
 * - step: attack / flash_before_block
 * - battleImmediateEffects: registrationIndex 0 (effects[1] = nexus destroy) と 1 (effects[2] = BP destroy + recover)
 *
 * 期待される挙動:
 * - P3-50: bob の創界神ネクサスが `field-nexus-row` 内で `ac-selectable` になる
 * - P3-51: registrationIndex=1 (BP destroy) を resolve しても registrationIndex=0 (nexus destroy) の効果は走らない
 * - P3-52: registrationIndex=0 の候補は grandwalker のみ、registrationIndex=1 の候補は BP≤20000 spirit のみ
 * - P3-53: EffectQueue 前面カードに「発揮」ボタンが出る (target 選択を伴うため auto-exec されない)
 */
/**
 * 創界石（grandstone）基盤の GUI 検証: 解封コア+1 → コア閾値転醒 → 転醒後ブレイヴ合体。
 *
 * - alice 場: 陰陽玉 (BSTH001-転醒R01(A), コア2) + ユウゲンマガン (BSTH001-転醒R02(A), 系統 靈異)
 * - pendingTriggeredEffects に解封 mechanic を 1 件注入済（ユウゲンマガン召喚トリガー想定, P3-92）
 *
 * 期待される挙動:
 * - EffectQueue 前面カードに「発揮する」「発揮しない」が出る（誘発キュー UI）
 * - 受諾でボイド→陰陽玉にコア+1（計3個 = 閾値到達）→ 転醒 mechanic の「発揮する」「発揮しない」が出る
 * - 転醒すると玄爺(B面ブレイヴ)へ裏返り、全コアがボイドへ + カウント+1
 * - 合体選択（resolve_brave_combine_choice）でユウゲンマガン（靈異 = 合体条件成立）への
 *   合体 / 合体しない が選べる
 */
function buildGrandstoneUnsealRebirth(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const stone = requireScenarioCard(allCards, "BSTH001-転醒R01(A)");
  const spirit = requireScenarioCard(allCards, "BSTH001-転醒R02(A)");
  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 6,
    bobReserve: 6,
  });

  const stoneId = "sc-grandstone-1";
  const spiritId = "sc-grandstone-spirit";

  return {
    ...base,
    cardInstances: [
      createCardInstance(stone, {
        instanceId: stoneId,
        ownerPlayerId: "alice",
        zone: "field",
        cores: 2,
      }),
      createCardInstance(spirit, {
        instanceId: spiritId,
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
    ],
    pendingTriggeredEffects: [
      createMechanicPendingTriggeredEffect({
        chainId: "scenario:scenarios.ts:1775",
        state: { step: base.step, window: base.window },
        pendingId: "sc-unseal-1",
        actingPlayerId: "alice",
        relatedInstanceId: stoneId,
        mechanic: {
          kind: "unseal",
          grandstoneInstanceId: stoneId,
          triggerEvent: "summon",
          triggerCardInstanceId: spiritId,
        },
      }),
    ],
  };
}

function buildBSTH01X03AttackGrandwalker(
  allCards: CardDefinition[]
): GameState {
  instanceSeq = 0;
  const remilia = requireScenarioCard(allCards, "BSTH01-X03");
  const grandwalker = requireScenarioCard(allCards, "BSTH05-X01");
  const lowBpSpirit = findCards(allCards, "spirit", 1, 12)[0] ?? remilia;
  const base = makeBaseState({
    step: "attack",
    turn: 3,
    active: "alice",
    aliceReserve: 6,
    bobReserve: 6,
  });

  const remiliaId = "sc-x03-remilia";
  const grandwalkerId = "sc-x03-bob-grandwalker";
  const bobSpiritId = "sc-x03-bob-spirit";

  return {
    ...base,
    window: "flash_before_block",
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: 0,
    })),
    cardInstances: [
      createCardInstance(remilia, {
        instanceId: remiliaId,
        ownerPlayerId: "alice",
        zone: "field",
        cores: 4,
        exhaustState: "exhausted",
      }),
      createCardInstance(grandwalker, {
        instanceId: grandwalkerId,
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(lowBpSpirit, {
        instanceId: bobSpiritId,
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
    ],
    battleEntities: [
      {
        entityId: `battle-entity:${remiliaId}`,
        memberInstanceIds: [remiliaId],
        resolvedBp: 16000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: `attack-group:3:alice:battle-entity:${remiliaId}`,
      primaryEntityId: `battle-entity:${remiliaId}`,
      participantEntityIds: [`battle-entity:${remiliaId}`],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: `battle-entity:${remiliaId}`,
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: [`battle-entity:${remiliaId}`],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: "alice",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "alice",
        pendingStackAction: null,
      },
    },
    battleImmediateEffects: [
      {
        promptId: "sc-x03-prompt-0",
        attackId: `attack-group:3:alice:battle-entity:${remiliaId}`,
        timing: "attack",
        sourceKind: "spirit",
        sourceInstanceId: remiliaId,
        sourceDefinitionId: remilia.cardNo,
        sourceCardNo: remilia.cardNo,
        actingPlayerId: "alice",
        participantEntityId: `battle-entity:${remiliaId}`,
        registrationIndex: 0,
      },
      {
        promptId: "sc-x03-prompt-1",
        attackId: `attack-group:3:alice:battle-entity:${remiliaId}`,
        timing: "attack",
        sourceKind: "spirit",
        sourceInstanceId: remiliaId,
        sourceDefinitionId: remilia.cardNo,
        sourceCardNo: remilia.cardNo,
        actingPlayerId: "alice",
        participantEntityId: `battle-entity:${remiliaId}`,
        registrationIndex: 1,
      },
    ],
  };
}

/**
 * battle_immediate「アタック時」の同期解決経路 (flash 窓前) での対象選択検証シナリオ。
 *
 * 実スナップショット (2026-06-02) 再現: レミリア X03 のアタック時 BP 破壊が flash 窓の
 * 前に解決するため canDeferBattleImmediate=false の同期経路を通る。複数候補があるとき
 * 対象選択 UI を経由せず先頭候補が機械破壊されるバグの回帰防止用。
 *
 * - alice 場: レミリア 1 体 (4 コア = Lv3, exhausted)
 * - bob 場: BP≤20000 スピリット 2 体 (両方が破壊候補)
 * - step: attack / window: declare_attack / activeAttack.flashWindowState = null
 * - battleImmediateEffects: registrationIndex 1 (effects[2] = BP destroy + recover) のみ
 *
 * 期待挙動: 「発揮」→ 対象選択 (候補 2 体) → 選んだ 1 体のみ破壊 + レミリア回復。
 */
function buildBSTH01X03AttackSyncTarget(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const remilia = requireScenarioCard(allCards, "BSTH01-X03");
  const bobSpirits = findCards(allCards, "spirit", 2, 12);
  const bobSpirit1 = bobSpirits[0] ?? remilia;
  const bobSpirit2 = bobSpirits[1] ?? bobSpirit1;
  const base = makeBaseState({
    step: "attack",
    turn: 3,
    active: "alice",
    aliceReserve: 6,
    bobReserve: 6,
  });

  const remiliaId = "sc-x03sync-remilia";
  const bobSpirit1Id = "sc-x03sync-bob-1";
  const bobSpirit2Id = "sc-x03sync-bob-2";

  return {
    ...base,
    window: "declare_attack",
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: 0,
    })),
    cardInstances: [
      createCardInstance(remilia, {
        instanceId: remiliaId,
        ownerPlayerId: "alice",
        zone: "field",
        cores: 4,
        exhaustState: "exhausted",
      }),
      createCardInstance(bobSpirit1, {
        instanceId: bobSpirit1Id,
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(bobSpirit2, {
        instanceId: bobSpirit2Id,
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
    ],
    battleEntities: [
      {
        entityId: `battle-entity:${remiliaId}`,
        memberInstanceIds: [remiliaId],
        resolvedBp: 16000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: `attack-group:3:alice:battle-entity:${remiliaId}`,
      primaryEntityId: `battle-entity:${remiliaId}`,
      participantEntityIds: [`battle-entity:${remiliaId}`],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: `battle-entity:${remiliaId}`,
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: [`battle-entity:${remiliaId}`],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    },
    battleImmediateEffects: [
      {
        promptId: "sc-x03sync-prompt-1",
        attackId: `attack-group:3:alice:battle-entity:${remiliaId}`,
        timing: "attack",
        sourceKind: "spirit",
        sourceInstanceId: remiliaId,
        sourceDefinitionId: remilia.cardNo,
        sourceCardNo: remilia.cardNo,
        actingPlayerId: "alice",
        participantEntityId: `battle-entity:${remiliaId}`,
        registrationIndex: 1,
      },
    ],
  };
}

/**
 * P3-47 F-4 Step 6: 効果対象リダイレクト prompt 用シナリオ。
 *
 * pendingTargetRedirects[0] に 1 件の prompt を直接 push して overlay 表示・操作を確認する。
 * - alice 場: 本体 (フランドール想定) + token 候補 2 体
 * - bob 場: 効果発動元 (相手スピリット 1 体)
 * - prompt: alice (本体 owner) に表示。confirm で token 1 体に差し替え、decline で元のまま。
 *
 * 注: 本シナリオは overlay UI の表示・ボタン操作のみを検証する目的。
 * continuation を伴う実効果再起動はカードレベル統合 (フランドール effects 追加) 時に検証する。
 */
function buildP347RedirectPrompt(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const flandre = requireScenarioCard(allCards, "BSTH01-X04");
  const tokenDefs = findCards(allCards, "spirit", 2, 8);
  const enemyDef = findCards(allCards, "spirit", 1, 20)[0] ?? flandre;
  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "bob",
    aliceReserve: 6,
    bobReserve: 6,
  });

  const protectedId = "sc-p347-flandre";
  const tokenAId = "sc-p347-token-a";
  const tokenBId = "sc-p347-token-b";
  const enemyId = "sc-p347-enemy";

  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: 0,
    })),
    cardInstances: [
      createCardInstance(flandre, {
        instanceId: protectedId,
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(tokenDefs[0] ?? flandre, {
        instanceId: tokenAId,
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(tokenDefs[1] ?? flandre, {
        instanceId: tokenBId,
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(enemyDef, {
        instanceId: enemyId,
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
    ],
    pendingTargetRedirects: [
      {
        pendingId: "sc-p347-redirect-1",
        redirectEffectId: "sc-p347-ce-1",
        promptedPlayerId: "alice",
        sourceEffectInstanceId: enemyId,
        sourceEffectDefinitionId: enemyDef.cardNo,
        originalResolvedInstanceIds: [protectedId],
        redirectableInstanceId: protectedId,
        candidateTokenInstanceIds: [tokenAId, tokenBId],
      },
    ],
  };
}

/**
 * P3-76: 効果対象リダイレクトの「変更先分身を field-tap で選択」検証用シナリオ。
 *
 * buildP347RedirectPrompt と同型だが、token 2 体を**異なる疲労状態**にする
 * (1 体 recovered / 1 体 heavily_exhausted)。これにより「疲労済み分身を犠牲にし、
 * 回復分身をアタック要因として温存する」運用が GUI で選別可能かを確認する。
 * pendingTargetRedirects を直接注入し、field-tap で候補分身を選ぶ UX を検証する。
 */
function buildP376RedirectChooseToken(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const flandre = requireScenarioCard(allCards, "BSTH01-X04");
  const tokenDefs = findCards(allCards, "spirit", 2, 8);
  const enemyDef = findCards(allCards, "spirit", 1, 20)[0] ?? flandre;
  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "bob",
    aliceReserve: 6,
    bobReserve: 6,
  });

  const protectedId = "sc-rct-flandre";
  const tokenRecoveredId = "sc-rct-token-recovered";
  const tokenExhaustedId = "sc-rct-token-exhausted";
  const enemyId = "sc-rct-enemy";

  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: 0,
    })),
    cardInstances: [
      createCardInstance(flandre, {
        instanceId: protectedId,
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      // 回復状態の分身 = 次のアタック要因として温存したい。
      createCardInstance(tokenDefs[0] ?? flandre, {
        instanceId: tokenRecoveredId,
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
        exhaustState: "recovered",
      }),
      // 重疲労の分身 = 犠牲にしたい (こちらへリダイレクトするのが定石運用)。
      createCardInstance(tokenDefs[1] ?? flandre, {
        instanceId: tokenExhaustedId,
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
        exhaustState: "heavily_exhausted",
      }),
      createCardInstance(enemyDef, {
        instanceId: enemyId,
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
    ],
    pendingTargetRedirects: [
      {
        pendingId: "sc-rct-redirect-1",
        redirectEffectId: "sc-rct-ce-1",
        promptedPlayerId: "alice",
        sourceEffectInstanceId: enemyId,
        sourceEffectDefinitionId: enemyDef.cardNo,
        originalResolvedInstanceIds: [protectedId],
        redirectableInstanceId: protectedId,
        candidateTokenInstanceIds: [tokenRecoveredId, tokenExhaustedId],
      },
    ],
  };
}

/** P3-56: 多数フィールド配置シナリオ共通ビルダー (横スクロール検証用)。
 * spirit / nexus / combined-brave / set-aside を任意枚数で配置する。
 * combined N + solo M + nexus K の構造は alice 側のフィールドに、bob は別途指定。 */
function buildFieldOverflow(
  allCards: CardDefinition[],
  config: {
    aliceSpirits?: number;
    aliceNexuses?: number;
    aliceCombined?: number;
    aliceSetAside?: number;
    bobSpirits?: number;
    bobNexuses?: number;
    bobCombined?: number;
    bobSetAside?: number;
  }
): GameState {
  instanceSeq = 0;
  const cfg = {
    aliceSpirits: 0,
    aliceNexuses: 0,
    aliceCombined: 0,
    aliceSetAside: 0,
    bobSpirits: 0,
    bobNexuses: 0,
    bobCombined: 0,
    bobSetAside: 0,
    ...config,
  };

  const allSpiritDefs = allCards.filter(
    (d) =>
      d.printedCategory === "spirit" &&
      d.levelDefs.length > 0 &&
      !d.grandwalkerData
  );
  const allBraveDefs = allCards.filter(
    (d) => d.printedCategory === "brave" && d.levelDefs.length > 0
  );
  const allNexusDefs = allCards.filter((d) => d.printedCategory === "nexus");

  let spiritIdx = 0;
  let braveIdx = 0;
  let nexusIdx = 0;
  const pickSpirit = () =>
    allSpiritDefs[spiritIdx++ % Math.max(allSpiritDefs.length, 1)];
  const pickBrave = () =>
    allBraveDefs[braveIdx++ % Math.max(allBraveDefs.length, 1)];
  const pickNexus = () =>
    allNexusDefs[nexusIdx++ % Math.max(allNexusDefs.length, 1)];

  const cards: ReturnType<typeof inst>[] = [];

  function addPlayer(
    playerId: string,
    spirits: number,
    combined: number,
    nexuses: number,
    setAside: number
  ) {
    // 合体スピリット (host + brave)
    for (let i = 0; i < combined; i++) {
      const hostDef = pickSpirit();
      const braveDef = pickBrave();
      if (!hostDef || !braveDef) continue;
      const hostId = `sc-p356-${playerId}-c${i}-host`;
      const braveId = `sc-p356-${playerId}-c${i}-brave`;
      const hostInst = createCardInstance(hostDef, {
        instanceId: hostId,
        ownerPlayerId: playerId,
        zone: "field",
        cores: 2,
      });
      hostInst.attachedChildrenIds = [braveId];
      const braveInst = createCardInstance(braveDef, {
        instanceId: braveId,
        ownerPlayerId: playerId,
        zone: "field",
        cores: 0,
      });
      braveInst.attachedToInstanceId = hostId;
      braveInst.zoneRoleName = "brave";
      cards.push(hostInst, braveInst);
    }
    // 単体スピリット
    for (let i = 0; i < spirits; i++) {
      const def = pickSpirit();
      if (!def) continue;
      cards.push(
        createCardInstance(def, {
          instanceId: `sc-p356-${playerId}-s${i}`,
          ownerPlayerId: playerId,
          zone: "field",
          cores: 1,
        })
      );
    }
    // ネクサス
    for (let i = 0; i < nexuses; i++) {
      const def = pickNexus();
      if (!def) continue;
      cards.push(
        createCardInstance(def, {
          instanceId: `sc-p356-${playerId}-n${i}`,
          ownerPlayerId: playerId,
          zone: "field",
          cores: 1,
        })
      );
    }
    // 手元 (set_aside)
    for (let i = 0; i < setAside; i++) {
      const def = pickSpirit();
      if (!def) continue;
      cards.push(
        createCardInstance(def, {
          instanceId: `sc-p356-${playerId}-sa${i}`,
          ownerPlayerId: playerId,
          zone: "set_aside",
          cores: 0,
        })
      );
    }
  }

  addPlayer(
    "alice",
    cfg.aliceSpirits,
    cfg.aliceCombined,
    cfg.aliceNexuses,
    cfg.aliceSetAside
  );
  addPlayer(
    "bob",
    cfg.bobSpirits,
    cfg.bobCombined,
    cfg.bobNexuses,
    cfg.bobSetAside
  );

  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 6,
    bobReserve: 6,
  });

  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: 0,
    })),
    cardInstances: cards,
  };
}

/** 手元シナリオ共通ベース: alice / bob にそれぞれ任意枚数の set_aside カードを置く */
function buildSetAside(
  allCards: CardDefinition[],
  aliceCount: number,
  bobCount: number,
  withNexus = false
): GameState {
  instanceSeq = 0;
  const aliceSetAside = findCards(allCards, "spirit", aliceCount, 0);
  const bobSetAside = findCards(allCards, "spirit", bobCount, 10);
  const aliceNexuses = withNexus ? findCards(allCards, "nexus", 5, 0) : [];

  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 6,
    bobReserve: 6,
  });

  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: 0,
    })),
    cardInstances: [
      ...aliceSetAside.map((d) => inst(d, "alice", "set_aside")),
      ...bobSetAside.map((d) => inst(d, "bob", "set_aside")),
      ...aliceNexuses.map((d) => inst(d, "alice", "field", 1)),
    ],
  };
}

/**
 * バースト発動（任意）: alice が BSTH01-X07 をバーストセットし、
 * 「自分のライフ減少後」の pendingBurstCheck を積んだアタックステップ。
 * 発動から維持コアHUDまで確認する。owner=bob で反転、card= でライフ減少バーストを変更。
 */
function buildBurstActivation(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  instanceSeq = 0;
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const x07 = requireScenarioCard(
    allCards,
    params?.get("card") ?? "BSTH01-X07"
  );
  const bobSpirit = findCards(allCards, "spirit", 1, 5)[0]!;
  const base = makeBaseState({ step: "attack", turn: 4, active: opponent });
  const burstInst = createCardInstance(x07, {
    instanceId: "sc-burst-x07",
    ownerPlayerId: owner,
    zone: "burst",
  });

  return {
    ...base,
    cardInstances: [
      burstInst,
      ...(params?.get("response")
        ? [
            createCardInstance(
              requireScenarioCard(allCards, params.get("response")!),
              {
                instanceId: "sc-burst-response",
                ownerPlayerId: opponent,
                zone: "hand",
              }
            ),
          ]
        : []),
      inst(bobSpirit, opponent, "field", 2),
      createCardInstance(requireScenarioCard(allCards, "BSTH01-C01"), {
        instanceId: "sc-burst-core-source",
        ownerPlayerId: owner,
        zone: "field",
        normalCoreCount: 3,
      }),
    ],
    setBurstStates: [{ playerId: owner, cardInstanceId: "sc-burst-x07" }],
    pendingBurstChecks: [
      {
        checkId: "sc-burst-check-1",
        actingPlayerId: owner,
        eventKind: "reduce_life",
        event: { family: "life", validationMode: "snapshot_only" },
        source: "action_resolution",
        chainId: "scenario:scenarios.ts:2402",
        attackId: null,
        relatedPlayerId: owner,
        relatedInstanceId: null,
        amount: 1,
        step: "attack",
        window: "flash_before_block",
        resolvedBurstCardInstanceIds: [],
      },
    ],
  };
}

/**
 * ゾーンブラウズ (バースト/ミラージュ) 検証用。
 * alice / bob 双方の場にバースト1枚 + ミラージュ1枚をセットした状態。
 * - 自分のバーストエリアクリック → 自分のバーストは表向き / ミラージュは表向き
 * - 相手のバーストエリアクリック → 相手のバーストは裏向き（未公開）/ ミラージュは表向き
 */
function buildBurstMirageZoneBrowse(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const [aliceBurstDef, aliceMirageDef, bobBurstDef, bobMirageDef] = findCards(
    allCards,
    "spirit",
    4
  );
  const base = makeBaseState({ step: "main", turn: 3, active: "alice" });

  return {
    ...base,
    cardInstances: [
      createCardInstance(aliceBurstDef!, {
        instanceId: "sc-zb-alice-burst",
        ownerPlayerId: "alice",
        zone: "burst",
      }),
      createCardInstance(aliceMirageDef!, {
        instanceId: "sc-zb-alice-mirage",
        ownerPlayerId: "alice",
        zone: "mirage",
      }),
      createCardInstance(bobBurstDef!, {
        instanceId: "sc-zb-bob-burst",
        ownerPlayerId: "bob",
        zone: "burst",
      }),
      createCardInstance(bobMirageDef!, {
        instanceId: "sc-zb-bob-mirage",
        ownerPlayerId: "bob",
        zone: "mirage",
      }),
    ],
    setBurstStates: [
      { playerId: "alice", cardInstanceId: "sc-zb-alice-burst" },
      { playerId: "bob", cardInstanceId: "sc-zb-bob-burst" },
    ],
  };
}

function buildDirectZoneBrowseTargetSelection(
  allCards: CardDefinition[]
): GameState {
  instanceSeq = 0;
  const source = requireScenarioCard(allCards, "BSTH06-C03");
  const fieldTargetA = requireScenarioCard(allCards, "BSTH06-C01");
  const fieldTargetB = requireScenarioCard(allCards, "BSTH06-C02");
  const trashTarget = requireScenarioCard(allCards, "BSTH06-C01");
  const trashOther = findCards(allCards, "magic", 1)[0] ?? trashTarget;
  const handTarget = requireScenarioCard(allCards, "BSTH06-C02");
  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 6,
    bobReserve: 6,
  });

  const sourceId = "sc-direct-zone-target-source";
  const fieldAId = "sc-direct-zone-target-field-a";
  const fieldBId = "sc-direct-zone-target-field-b";
  const trashTargetId = "sc-direct-zone-target-trash-candidate";
  const trashOtherId = "sc-direct-zone-target-trash-other";
  const handTargetId = "sc-direct-zone-target-hand-candidate";
  const fieldCandidateIds = [fieldAId, fieldBId];
  const zoneCandidateIds = [trashTargetId, handTargetId];

  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      deckCount: 30,
      handCount: p.id === "alice" ? 1 : 0,
    })),
    cardInstances: [
      createCardInstance(source, {
        instanceId: sourceId,
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(fieldTargetA, {
        instanceId: fieldAId,
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(fieldTargetB, {
        instanceId: fieldBId,
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(trashTarget, {
        instanceId: trashTargetId,
        ownerPlayerId: "alice",
        zone: "trash",
      }),
      createCardInstance(trashOther, {
        instanceId: trashOtherId,
        ownerPlayerId: "alice",
        zone: "trash",
      }),
      createCardInstance(handTarget, {
        instanceId: handTargetId,
        ownerPlayerId: "alice",
        zone: "hand",
      }),
    ],
    pendingEffectTargetSelection: {
      pendingId: "sc-direct-zone-target-pending",
      actingPlayerId: "alice",
      sourceInstanceId: sourceId,
      sourceDefinitionId: source.cardNo,
      deferredStack: {
        stackId: "sc-direct-zone-target-stack",
        actionKind: "triggered_effect",
        chainId: "sc-direct-zone-target-chain",
        actingPlayerId: "alice",
        cardInstanceId: sourceId,
        cardDefinitionId: source.cardNo,
        targetInstanceIds: [],
        targetEffectFilterTags: ["general"],
        previousResponseSourcePlayerId: null,
        previousPendingStackAction: null,
        targetGroups: [
          {
            requiredTargetCount: fieldCandidateIds.length,
            candidateTargetZones: ["field"],
            candidateTargetInstanceIds: fieldCandidateIds,
          },
          {
            requiredTargetCount: 1,
            candidateTargetZones: ["trash"],
            candidateTargetInstanceIds: [trashTargetId],
          },
          {
            requiredTargetCount: 1,
            candidateTargetZones: ["hand"],
            candidateTargetInstanceIds: [handTargetId],
          },
        ],
      },
      remainingStacks: [],
      requiredTargetCount: fieldCandidateIds.length + zoneCandidateIds.length,
      maxTargetCount: fieldCandidateIds.length + zoneCandidateIds.length,
      candidateInstanceIds: [...fieldCandidateIds, ...zoneCandidateIds],
      targetGroups: [
        {
          requiredTargetCount: fieldCandidateIds.length,
          candidateTargetZones: ["field"],
          candidateTargetInstanceIds: fieldCandidateIds,
        },
        {
          requiredTargetCount: 1,
          candidateTargetZones: ["trash"],
          candidateTargetInstanceIds: [trashTargetId],
        },
        {
          requiredTargetCount: 1,
          candidateTargetZones: ["hand"],
          candidateTargetInstanceIds: [handTargetId],
        },
      ],
      targetEffectFilterTags: ["general"],
    },
  };
}

/**
 * バッジ整理 + コア数バッジ折り返しの GUI 検証用 (転醒/煌臨バッジ廃止 + コア 2 行化)。
 * alice 場:
 * - bigCore: 通常コア 11 + ソウルコア (soulCoreLocation=card) → コア数バッジが 2 行に折り返す
 * - adventHost: 煌臨元 2 枚 (advent-source) を従え、金グロー + 下端の重なり peek。
 *   長押し/右クリックで煌臨スタックモーダル (ZoneBrowseModal 流用) が開く。左クリックは効果発揮。
 * - rebirthed: originalDefinitionId が印字面と異なる → 転醒 (シアングロー、テキストバッジ無し)。
 * - pending: 待機状態 (破壊待機) → カード画像のみ微透明、待機バッジ無し、Lv/BP/コアバッジは維持。
 */
function buildBadgeCoreDisplay(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const spirits = findCards(allCards, "spirit", 8, 0);
  const bigDef = spirits[0]!;
  const adventDef = spirits[1]!;
  const src1Def = spirits[2]!;
  const src2Def = spirits[3]!;
  const rebirthDef = spirits[4]!;
  const bobDef = spirits[5]!;
  const pendingDef = spirits[6]!;
  const vanishDef = spirits[7]!;

  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 6,
    bobReserve: 6,
  });

  const bigCore = inst(bigDef, "alice", "field", 11);
  const src1: CardInstance = {
    ...inst(src1Def, "alice", "field", 0),
    zoneRoleName: "advent-source",
  };
  const src2: CardInstance = {
    ...inst(src2Def, "alice", "field", 0),
    zoneRoleName: "advent-source",
  };
  const adventHost: CardInstance = {
    ...inst(adventDef, "alice", "field", 4),
    underCards: [
      { cardInstanceId: src1.instanceId, role: "advent_source" },
      { cardInstanceId: src2.instanceId, role: "advent_source" },
    ],
  };
  const rebirthed: CardInstance = {
    ...inst(rebirthDef, "alice", "field", 3),
    // 印字面 (originalDefinitionId) と現在面 (definitionId) が異なる = 転醒扱い。
    originalDefinitionId: bigDef.cardNo,
  };
  const pending: CardInstance = {
    // 待機状態 (破壊待機)。コアは残したまま (Lv/BP バッジ表示確認用)。
    ...inst(pendingDef, "alice", "field", 3),
    pendingLeaveKind: "destroy",
    pendingLeaveCause: "state_based_action",
    pendingLeaveChainId: "scenario-pending",
  };
  // P3-83: 消滅 (コア欠損) 待機。コアは全移動して 0 だが、消滅時 Lv (snapshot) で
  // Lv/BP バッジを表示する確認用。現在コア由来だと Lv0/BP0 になるところを snapshot で上書き。
  const vanishLvSnapshot = vanishDef.levelDefs.reduce(
    (max, ld) => Math.max(max, ld.level),
    1
  );
  const vanishing: CardInstance = {
    ...inst(vanishDef, "alice", "field", 0),
    pendingLeaveKind: "vanish",
    pendingLeaveCause: "state_based_action",
    pendingLeaveChainId: "scenario-vanish",
    pendingLeaveLvSnapshot: vanishLvSnapshot,
  };

  return {
    ...base,
    players: base.players.map((p) =>
      p.id === "alice"
        ? {
            ...p,
            deckCount: 30,
            handCount: 0,
            soulCoreLocation: {
              kind: "card" as const,
              instanceId: bigCore.instanceId,
            },
          }
        : { ...p, deckCount: 30, handCount: 0 }
    ),
    cardInstances: [
      bigCore,
      adventHost,
      src1,
      src2,
      rebirthed,
      pending,
      vanishing,
      inst(bobDef, "bob", "field", 2),
    ],
  };
}

/** フィールド重なり表示の検証用: 煌臨 / 星霊衣 / ネクサス下カード / 真・バディ。 */
function buildFieldUnderCardLayout(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  instanceSeq = 0;
  const spirits = findCards(allCards, "spirit", 8, 0);
  const adventTopDef = spirits[1]!;
  const adventSrc1Def = spirits[2]!;
  const adventSrc2Def = spirits[3]!;
  const starHostDef = requireScenarioCard(allCards, "BSFT01-CX01");
  const starUnder1Def = requireScenarioCard(allCards, "BSFT01-TR01(A)");
  const starUnder2Def = requireScenarioCard(allCards, "BSFT01-TR03(A)");
  const keyBraveDefs = [
    requireScenarioCard(allCards, "BSFT01-TR02(A)"),
    requireScenarioCard(allCards, "BSFT01-TR04(A)"),
    requireScenarioCard(allCards, "BSFT01-TR05(A)"),
  ];
  const aldnoahNexusDef = requireScenarioCard(allCards, "BSAZ02-M01");
  const aldnoahDriveDef = requireScenarioCard(allCards, "BSAZ02-C10");
  const buddyHostDef = requireScenarioCard(allCards, "BSDB01-CX01");
  const gokuDef = requireScenarioCard(allCards, "BSDB01-C01");
  const vegetaDef = requireScenarioCard(allCards, "BSDB01-C02");
  const bobDef = spirits[6]!;
  const imaginFrontDef = requireScenarioCard(allCards, "BSTH001-転醒R01(A)");

  const adventSrc1: CardInstance = {
    ...inst(adventSrc1Def, "alice", "field", 0),
    zoneRoleName: "advent-source",
  };
  const adventSrc2: CardInstance = {
    ...inst(adventSrc2Def, "alice", "field", 0),
    zoneRoleName: "advent-source",
  };
  const adventTop: CardInstance = {
    ...inst(adventTopDef, "alice", "field", 3),
    underCards: [
      { cardInstanceId: adventSrc1.instanceId, role: "advent_source" },
      { cardInstanceId: adventSrc2.instanceId, role: "advent_source" },
    ],
  };

  const starUnder1: CardInstance = {
    ...inst(starUnder1Def, "alice", "field", 0),
    definitionId: "BSFT01-TR01(B)",
    originalDefinitionId: starUnder1Def.cardNo,
    attachedToInstanceId: "sc-under-star-host",
    zoneRoleName: "star-garment",
  };
  const starUnder2: CardInstance = {
    ...inst(starUnder2Def, "alice", "field", 0),
    definitionId: "BSFT01-TR03(B)",
    originalDefinitionId: starUnder2Def.cardNo,
    attachedToInstanceId: "sc-under-star-host",
    zoneRoleName: "star-garment",
  };
  const starHost: CardInstance = {
    ...createCardInstance(starHostDef, {
      instanceId: "sc-under-star-host",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 2,
    }),
    underCards: [
      {
        cardInstanceId: starUnder1.instanceId,
        role: "text_role",
        roleTag: "星霊衣",
      },
      {
        cardInstanceId: starUnder2.instanceId,
        role: "text_role",
        roleTag: "星霊衣",
      },
    ],
    attachedChildrenIds: keyBraveDefs.map(
      (_, index) => `sc-under-key-${index + 1}`
    ),
  };
  const keyBraves = keyBraveDefs.map(
    (definition, index): CardInstance => ({
      ...createCardInstance(definition, {
        instanceId: `sc-under-key-${index + 1}`,
        ownerPlayerId: "alice",
        zone: "field",
        cores: 0,
      }),
      attachedToInstanceId: starHost.instanceId,
      zoneRoleName: "brave",
    })
  );

  const driveUnder: CardInstance = {
    ...createCardInstance(aldnoahDriveDef, {
      instanceId: "sc-under-aldnoah-drive",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    }),
    attachedToInstanceId: "sc-under-aldnoah-nexus",
    zoneRoleName: "aldnoah-drive",
  };
  const aldnoahNexus: CardInstance = {
    ...createCardInstance(aldnoahNexusDef, {
      instanceId: "sc-under-aldnoah-nexus",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    }),
    underCards: [
      {
        cardInstanceId: driveUnder.instanceId,
        role: "text_role",
        roleTag: "アルドノアドライブ",
      },
    ],
  };

  const buddyHost: CardInstance = {
    ...createCardInstance(buddyHostDef, {
      instanceId: "sc-under-buddy-host",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    }),
    zoneRoleName: "advent-source",
  };
  const goku: CardInstance = {
    ...createCardInstance(gokuDef, {
      instanceId: "sc-under-buddy-goku",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 2,
    }),
    underCards: [
      { cardInstanceId: buddyHost.instanceId, role: "advent_source" },
    ],
  };
  const vegeta: CardInstance = {
    ...createCardInstance(vegetaDef, {
      instanceId: "sc-under-buddy-vegeta",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 2,
    }),
    underCards: [
      { cardInstanceId: buddyHost.instanceId, role: "advent_source" },
    ],
  };

  const imaginLeft: CardInstance = {
    ...inst(spirits[4]!, "alice", "field", 2),
    instanceId: "sc-imagin-left",
    exhaustState: "exhausted",
    attachedChildrenIds: ["sc-imagin-brave"],
  };
  const imaginRight: CardInstance = {
    ...inst(spirits[5]!, "alice", "field", 2),
    instanceId: "sc-imagin-right",
    exhaustState: "exhausted",
  };
  const imaginBrave: CardInstance = {
    ...createCardInstance(imaginFrontDef, {
      instanceId: "sc-imagin-brave",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    }),
    definitionId: "BSTH001-転醒R01(B)",
    originalDefinitionId: imaginFrontDef.cardNo,
    zoneRoleName: "brave",
    attachedToInstanceId: imaginLeft.instanceId,
    imaginRightCombinedWith: imaginRight.instanceId,
    exhaustState: "recovered",
  };

  const actionMode = params?.get("actionMode") === "attack";
  const soulStateMode = params?.get("soulState") === "1";
  const base = makeBaseState({
    step: actionMode ? "attack" : "main",
    turn: 3,
    active: "alice",
    aliceReserve: 6,
    bobReserve: 6,
  });

  return {
    ...base,
    players: base.players.map((p) =>
      p.id === "alice" && soulStateMode
        ? {
            ...p,
            deckCount: 30,
            handCount: 0,
            soulStateInstanceIds: [adventTop.instanceId, starHost.instanceId],
          }
        : { ...p, deckCount: 30, handCount: 0 }
    ),
    cardInstances: [
      adventTop,
      adventSrc1,
      adventSrc2,
      starHost,
      starUnder1,
      starUnder2,
      ...keyBraves,
      aldnoahNexus,
      driveUnder,
      buddyHost,
      goku,
      vegeta,
      imaginLeft,
      imaginRight,
      imaginBrave,
      inst(bobDef, "bob", "field", 2),
    ],
  };
}

/**
 * P2-09: 合体スピリット破壊時のブレイヴ選択モーダル検証用。
 * alice 場に host(X04) + 合体中の brave(X09)。`pendingBraveLeaveChoice` を立てた
 * 状態で開始するため、ロード直後に「フィールドに残す / 一緒に移動」モーダルが出る。
 */
function buildBraveLeaveChoice(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  instanceSeq = 0;
  const host = requireScenarioCard(allCards, "BSTH01-X04");
  const brave = requireScenarioCard(allCards, "BSTH01-X09");
  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 8,
    bobReserve: 6,
  });
  const hostId = "sc-leave-host";
  const braveId = "sc-leave-brave";

  if (params?.get("hosts") === "2") {
    const owner = params.get("owner") === "bob" ? "bob" : "alice";
    let state: GameState = {
      ...base,
      activePlayerId: owner,
      cardInstances: ["", "-2"].flatMap((suffix) => [
        createCardInstance(host, {
          instanceId: hostId + suffix,
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 3,
          attachedChildrenIds: [braveId + suffix],
        }),
        createCardInstance(brave, {
          instanceId: braveId + suffix,
          ownerPlayerId: owner,
          zone: "field",
          attachedToInstanceId: hostId + suffix,
        }),
      ]),
    };
    for (const suffix of ["", "-2"])
      state = queuePendingLeave({
        state,
        instanceId: hostId + suffix,
        kind: "destroy",
        cause: "effect_resolution",
        chainId: "scenario-two-braves",
      });
    return flushPendingLeaves(state, (id) =>
      allCards.find((card) => card.cardNo === id)
    );
  }

  return {
    ...base,
    players: base.players.map((p) => ({ ...p, deckCount: 30, handCount: 0 })),
    cardInstances: [
      {
        ...createCardInstance(host, {
          instanceId: hostId,
          ownerPlayerId: "alice",
          zone: "field",
          cores: 3,
        }),
        attachedChildrenIds: [braveId],
      },
      {
        ...createCardInstance(brave, {
          instanceId: braveId,
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
          zoneRoleName: "brave",
        }),
        attachedToInstanceId: hostId,
      },
    ],
    pendingBraveLeaveChoice: {
      choosingPlayerId: "alice",
      hostInstanceId: hostId,
      braveInstanceIds: [braveId],
      leaveKind: "destroy",
      leaveCause: "effect_resolution",
    },
  };
}

/**
 * P3-88: 「コアN個まで」のコア数選択モーダル検証用。
 * BSTH01-X08「相手のライフのコア2個までをボイドに置く」相当の
 * `pendingCoreCountSelection` (min0/max2, 相手ライフ→相手ボイド) を立てた状態で開始。
 * ロード直後に コア数HUD が表示され、0〜2 を選んで決定できる。
 */
function buildCoreCountSelect(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const lethal = params?.get("lethal") === "1";
  instanceSeq = 0;
  const src = requireScenarioCard(allCards, "BSTH01-X08");
  const base = makeBaseState({
    step: "attack",
    turn: 3,
    active: owner,
    aliceReserve: 6,
    bobReserve: 6,
  });
  const srcId = "sc-ccs-src";
  return {
    ...base,
    ...(lethal ? { window: "flash_before_block" as const } : {}),
    players: base.players.map((p) =>
      p.id === opponent
        ? { ...p, lifeNormalCoreCount: lethal ? 1 : 5, voidNormalCoreCount: 0 }
        : p
    ),
    cardInstances: [
      createCardInstance(src, {
        instanceId: srcId,
        ownerPlayerId: owner,
        zone: "field",
        cores: 1,
      }),
    ],
    pendingCoreCountSelection: {
      pendingId: "ccs-scenario",
      actingPlayerId: owner,
      sourceInstanceId: srcId,
      sourceDefinitionId: src.cardNo,
      fromLocation: { kind: "life", player: "opponent" },
      toLocation: { kind: "void", player: "opponent" },
      min: 0,
      max: lethal ? 1 : 2,
      effectTiming: { kind: "continuous" },
    },
  };
}

/**
 * コスト先払い型ドロー枚数修正（model A, 裁定 2026-06-15）のモーダル検証用。
 * BSSL01-C03 カルテノン神殿 Lv2『自分のドローステップ』〔重複不可〕
 *   「手札の系統:「影」/「プレイヤー」カード1枚を破棄するとドロー枚数 +1」相当の
 * `pendingDrawStepCostChoice` を立てた状態で開始する。ロード直後に
 * 手札を展開し、候補カードと「支払わない」/「破棄して支払う」を表示する。
 * 検証観点: 候補が手札の系統:「影」/「プレイヤー」カードだけに絞られていること、
 * 候補未選択では「破棄して支払う」が disabled なこと。
 */
function buildDrawStepCostChoice(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const src = requireScenarioCard(allCards, "BSSL01-C03"); // tribe 影 / 源
  // 破棄候補（系統:影/プレイヤー）。BSSL01-C01 は tribe プレイヤー/影。
  const candidate = requireScenarioCard(allCards, "BSSL01-C01");
  // 非対象（系統不一致）— 候補に含まれないことを確認するため手札に置く。
  const nonCandidate = requireScenarioCard(allCards, "BSTH01-C12");
  const base = makeBaseState({
    step: "draw",
    turn: 3,
    active: "alice",
    aliceReserve: 6,
    bobReserve: 6,
  });
  const srcId = "sc-dscc-src";
  const candId = "sc-dscc-cand";
  const nonCandId = "sc-dscc-noncand";
  return {
    ...base,
    cardInstances: [
      createCardInstance(src, {
        instanceId: srcId,
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(candidate, {
        instanceId: candId,
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(nonCandidate, {
        instanceId: nonCandId,
        ownerPlayerId: "alice",
        zone: "hand",
      }),
    ],
    pendingDrawStepCostChoice: {
      pendingId: "dscc-scenario",
      actingPlayerId: "alice",
      resolvedBonus: 0,
      entries: [
        {
          sourceInstanceId: srcId,
          sourceDefinitionId: src.cardNo,
          effectIndex: 3,
          candidateCardInstanceIds: [candId],
          cardFilter: { tribes: ["影", "プレイヤー"] },
          bonus: 1,
        },
      ],
    },
  };
}

function buildStepOptionalPromptBSSA01C02(
  allCards: CardDefinition[]
): GameState {
  instanceSeq = 0;
  const source = requireScenarioCard(allCards, "BSSA01-C02");
  const cardNoMap = new Map(allCards.map((card) => [card.cardNo, card]));
  const getDefinition = (id: string) => cardNoMap.get(id);
  const sourceId = "sc-step-prompt-eugeo";
  const base = makeBaseState({
    step: "main",
    turn: 2,
    active: "alice",
    aliceReserve: 4,
    bobReserve: 4,
  });
  const before: GameState = {
    ...base,
    players: base.players.map((player) =>
      player.id === "alice"
        ? {
            ...player,
            deckCount: 30,
            handCount: 0,
            reserveNormalCoreCount: 0,
            voidNormalCoreCount: player.voidNormalCoreCount + 3,
          }
        : { ...player, deckCount: 30, handCount: 0 }
    ),
    cardInstances: [
      createCardInstance(source, {
        instanceId: sourceId,
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
    ],
  };
  return executeEffect({
    chainId: "scenario:scenarios.ts:3158",
    state: before,
    effect: source.effects![0]!,
    sourceInstanceId: sourceId,
    actingPlayerId: "alice",
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

function buildStepChoicePromptBSLH01R03(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const source = requireScenarioCard(allCards, "BSLH01-R03");
  const cardNoMap = new Map(allCards.map((card) => [card.cardNo, card]));
  const getDefinition = (id: string) => cardNoMap.get(id);
  const sourceId = "sc-step-choice-randy";
  const base = makeBaseState({
    step: "main",
    turn: 2,
    active: "alice",
    aliceReserve: 5,
    bobReserve: 5,
  });
  const before: GameState = {
    ...base,
    players: base.players.map((player) => ({
      ...player,
      deckCount: 30,
      handCount: 0,
    })),
    cardInstances: [
      createCardInstance(source, {
        instanceId: sourceId,
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
    ],
  };
  return executeEffect({
    chainId: "scenario:scenarios.ts:3197",
    state: before,
    effect: source.effects![0]!,
    sourceInstanceId: sourceId,
    actingPlayerId: "alice",
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions: () => [],
    promptUnresolvedChoice: true,
  });
}

/**
 * ENGINE-sequential-slot-choice (BSSL01-X01[5,6]): split_field_entry_choice の分配選択
 * (トークンを出す or ゾーンからの通常召喚を対象ごとに独立して選べる) 検証用。
 * `pendingSplitSummonChoice` を立てた状態で開始する。ロード直後に
 * 共通HUDのトークン体数 +/- と展開手札の候補を表示する。
 */
function buildBSSL01X01SplitSummonChoice(
  allCards: CardDefinition[]
): GameState {
  instanceSeq = 0;
  const src = requireScenarioCard(allCards, "BSSL01-X01");
  const zoneCandidate = requireScenarioCard(allCards, "BSSL01-C02"); // tribe 影・甲獣
  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 6,
    bobReserve: 6,
  });
  const srcId = "sc-sscm-src";
  const candId = "sc-sscm-cand";
  return {
    ...base,
    cardInstances: [
      createCardInstance(src, {
        instanceId: srcId,
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(zoneCandidate, {
        instanceId: candId,
        ownerPlayerId: "alice",
        zone: "hand",
      }),
    ],
    pendingSplitSummonChoice: {
      pendingId: "sscm-scenario",
      chainId: "scenario:split-summon-cost-modifier",
      actingPlayerId: "alice",
      sourceInstanceId: srcId,
      sourceDefinitionId: src.cardNo,
      totalCount: 2,
      tokenAction: {
        kind: "put",
        target: { kind: "from_token_pool", count: 1 },
        voidCoreMaxPerCard: 1,
      },
      maxTokenCount: 2,
      zoneAction: {
        kind: "summon",
        target: {
          kind: "from_zone",
          zone: ["hand", "trash"],
          includeAdventSource: true,
          filter: { category: ["spirit"], tribes: ["影"] },
          count: 1,
        },
        costModifier: "free",
      },
      zoneCandidateInstanceIds: [candId],
      effectTiming: { kind: "card_event", event: "advent" },
    },
  };
}

/**
 * P3-88 (field 源): 「相手のフィールドのコアN個まで」の under-selection 検証用。
 * `pendingCoreShootSelection` を minTotal0/totalAmount2 で立てた状態で開始。
 * bob のスピリット(3 コア)から 0〜2 個をプレイヤーが選んでトラッシュへ置ける
 * （0 個でも決定可能）。
 */
function buildCoreShootUpTo(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const src = requireScenarioCard(allCards, "BSLH01-X09");
  const tgt = requireScenarioCard(allCards, "BSTH01-C01");
  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 6,
    bobReserve: 6,
  });
  const srcId = "sc-csu-src";
  const tgtId = "sc-csu-tgt";
  return {
    ...base,
    cardInstances: [
      createCardInstance(src, {
        instanceId: srcId,
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
      createCardInstance(tgt, {
        instanceId: tgtId,
        ownerPlayerId: "bob",
        zone: "field",
        cores: 3,
      }),
    ],
    pendingCoreShootSelection: {
      pendingId: "csu-scenario",
      actingPlayerId: "alice",
      sourceInstanceId: srcId,
      sourceDefinitionId: src.cardNo,
      candidates: [
        { instanceId: tgtId, definitionId: tgt.cardNo, availableCores: 3 },
      ],
      totalAmount: 2,
      minTotal: 0,
      toKind: "trash",
      toPlayerId: "bob",
      fromPlayerId: "bob",
      remainingActions: [],
      effectTiming: { kind: "activated", mode: "main" },
    },
  };
}

/**
 * P3-58: ブレイヴ分離のタップ経由コア選択 UI 検証用。
 * alice 場に合体スピリット (host X04 + 合体中 brave X09) を静止状態で配置し、main step。
 * ホスト/ブレイヴをタップ →「分離」ボタン → コア選択 HUD (grab→place) が起動することを確認する。
 * (D&D 無効化後はこのタップ経路が唯一の分離 UI 入口。)
 */
function buildBraveSeparate(allCards: CardDefinition[]): GameState {
  instanceSeq = 0;
  const host = requireScenarioCard(allCards, "BSTH01-X04");
  const brave = requireScenarioCard(allCards, "BSTH01-X09");
  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 8,
    bobReserve: 6,
  });
  const hostId = "sc-sep-host";
  const braveId = "sc-sep-brave";

  return {
    ...base,
    players: base.players.map((p) => ({ ...p, deckCount: 30, handCount: 0 })),
    cardInstances: [
      {
        ...createCardInstance(host, {
          instanceId: hostId,
          ownerPlayerId: "alice",
          zone: "field",
          cores: 4,
        }),
        attachedChildrenIds: [braveId],
      },
      {
        ...createCardInstance(brave, {
          instanceId: braveId,
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
          zoneRoleName: "brave",
        }),
        attachedToInstanceId: hostId,
      },
      ...findCards(allCards, "spirit", 1, 10).map((d) =>
        inst(d, "bob", "field", 2)
      ),
    ],
  };
}

/**
 * BSGE01-TX01(A): 合体中ブレイヴ自身のフラッシュ起動効果 UI 検証用。
 * alice の合体ユニットをクリックすると、CX01 / TX01(A) それぞれの画像の下に「効果発揮」が出る。
 */
function buildBSGE01TX01CombinedBraveFlash(
  allCards: CardDefinition[]
): GameState {
  instanceSeq = 0;
  const host = requireScenarioCard(allCards, "BSGE01-CX01");
  const brave = requireScenarioCard(allCards, "BSGE01-TX01(A)");
  const under = requireScenarioCard(allCards, "BSSL01-C05");
  const hand = requireScenarioCard(allCards, "BSSL01-C02");
  const attacker = requireScenarioCard(allCards, "BSTH01-C01");
  const base = makeBaseState({
    step: "attack",
    turn: 3,
    active: "bob",
    aliceReserve: 6,
    bobReserve: 6,
  });
  const hostId = "sc-tx01-host";
  const braveId = "sc-tx01-brave";
  const underId = "sc-tx01-under";
  const handId = "sc-tx01-hand";
  const attackerId = "sc-tx01-attacker";
  const attackerEntityId = `battle-entity:${attackerId}`;
  const hostCard = createCardInstance(host, {
    instanceId: hostId,
    ownerPlayerId: "alice",
    zone: "field",
    cores: 3,
  });
  hostCard.attachedChildrenIds = [braveId];
  hostCard.underCards = [
    {
      cardInstanceId: underId,
      role: "text_role",
      roleTag: "バレットエディット",
    },
  ];
  const braveCard = createCardInstance(brave, {
    instanceId: braveId,
    ownerPlayerId: "alice",
    zone: "field",
    cores: 0,
    zoneRoleName: "brave",
  });
  braveCard.attachedToInstanceId = hostId;
  const underCard = createCardInstance(under, {
    instanceId: underId,
    ownerPlayerId: "alice",
    zone: "field",
    cores: 0,
  });
  underCard.attachedToInstanceId = hostId;
  underCard.zoneRoleName = "bullet-edit";
  const handCard = createCardInstance(hand, {
    instanceId: handId,
    ownerPlayerId: "alice",
    zone: "hand",
  });
  const attackerCard = createCardInstance(attacker, {
    instanceId: attackerId,
    ownerPlayerId: "bob",
    zone: "field",
    cores: 1,
  });
  attackerCard.exhaustState = "exhausted";

  return {
    ...base,
    window: "flash_before_block",
    players: base.players.map((player) =>
      player.id === "alice" ? { ...player, handCount: 1 } : player
    ),
    cardInstances: [hostCard, braveCard, underCard, handCard, attackerCard],
    battleEntities: [
      {
        entityId: attackerEntityId,
        memberInstanceIds: [attackerId],
        resolvedBp: 1000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: `attack-group:3:bob:${attackerEntityId}`,
      primaryEntityId: attackerEntityId,
      participantEntityIds: [attackerEntityId],
      groupMode: "single",
      target: { kind: "player", playerId: "alice" },
      blockAssignments: [
        {
          participantEntityId: attackerEntityId,
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: [attackerEntityId],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: "alice",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "alice",
        pendingStackAction: null,
      },
    },
  };
}

/**
 * F2.4b クォーツ: 魂状態化 + クォーツセットの GUI 検証用。
 * alice 手札に ENIGMA(CX01) + クォーツ3枚、カウント5・メインステップ。
 * 手順: ENIGMA をタップ →「魂状態化」で field の魂状態へ → クォーツをタップ → host にセット。
 */
function buildQuartzActivation(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  instanceSeq = 0;
  const enigma = requireScenarioCard(allCards, "BSLH01-CX01");
  const q1 = requireScenarioCard(allCards, "BSLH01-C01"); // 双魚珠 C2
  const q2 = requireScenarioCard(allCards, "BSLH01-R01"); // 駆動 C1
  const q3 = requireScenarioCard(allCards, "BSLH01-C04"); // 処女珠 C2
  const base = makeBaseState({
    step: "main",
    turn: 3,
    active: "alice",
    aliceReserve: 6,
    bobReserve: 6,
  });
  if (params?.get("multiSoul") === "1") {
    const [soulA, soulB] = findCards(allCards, "spirit", 2, 24);
    if (!soulA || !soulB) {
      throw new Error("quartz-activation multiSoul requires two spirits");
    }
    return {
      ...base,
      cardInstances: [
        createCardInstance(soulA, {
          instanceId: "sc-soul-1",
          ownerPlayerId: "alice",
          zone: "field",
        }),
        createCardInstance(soulB, {
          instanceId: "sc-soul-2",
          ownerPlayerId: "alice",
          zone: "field",
        }),
      ],
      players: base.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              handCount: 0,
              countValue: 5,
              soulStateInstanceIds: ["sc-soul-1", "sc-soul-2"],
            }
          : p
      ),
    };
  }
  return {
    ...base,
    cardInstances: [
      createCardInstance(enigma, {
        instanceId: "sc-q-enigma",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(q1, {
        instanceId: "sc-q-1",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(q2, {
        instanceId: "sc-q-2",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      createCardInstance(q3, {
        instanceId: "sc-q-3",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
    ],
    players: base.players.map((p) =>
      p.id === "alice" ? { ...p, handCount: 4, countValue: 5 } : p
    ),
  };
}

/**
 * P3-152: 全弾双方向 e2e (set-review) 用の動的シナリオ。
 * `?scenario=set-review&set=<SET>` の `set` パラメータで対象弾を切り替える。
 * 対象弾の cardNo (「<SET>-」前方一致) を全部使ってデッキを構築し、40枚に満たない
 * 場合のみ他弾のカードで埋める。デッキは「40枚以上」が公式ルール
 * (`10_rules/02_turn-flow-and-timing.md:32`「各プレイヤーのデッキ（40枚以上）を
 * シャッフルする」、逐語）なので、対象弾のカード種が40を超える弾はそのまま超過枚数の
 * デッキになる（truncate しない）。`initializeGame` で通常のゲーム開始経路
 * (シャッフル/ドロー/契約カード処理等) を通す — 個別カード配置の他シナリオと異なり、
 * set-review は「GUI/API 配線が壊れていないこと」の検証が目的のため実デッキ相当の
 * 初期化を使う。
 *
 * マッチは「<SET>-」までを含めた前方一致にする (adversarial verifier round1 refute)。
 * `startsWith(setCode)` だけだと "BSTH02" が "BSTH02.5"/"BSTH02.7" 等の別弾も
 * 誤って巻き込む (card-data に同型の prefix 衝突が複数実在: BSTH02/02.5/02.7、
 * BSTH04/04.5、BSTH05/05.5、BSTH07/07.8、BSTH08/08.5、BSTH09/09.2)。
 */
function buildDeckForSet(
  allCards: CardDefinition[],
  setCode: string,
  seedOffset: number
): CardDefinition[] {
  const prefix = `${setCode}-`;
  const setCards = allCards.filter((c) => c.cardNo.startsWith(prefix));
  const fillerCards = allCards.filter((c) => !c.cardNo.startsWith(prefix));
  const deck: CardDefinition[] = [...setCards];
  for (let i = 0; deck.length < 40 && fillerCards.length > 0; i++) {
    deck.push(fillerCards[(i + seedOffset) % fillerCards.length]!);
  }
  return deck;
}

function buildSetReview(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const setCode = params?.get("set") ?? "";
  if (!setCode) throw new Error("set-review scenario requires ?set=<SET>");
  const aliceDeck = buildDeckForSet(allCards, setCode, 0);
  const bobDeck = buildDeckForSet(allCards, setCode, aliceDeck.length);
  return initializeGame({
    decks: [aliceDeck, bobDeck],
    skipPreGame: true,
    allowUnavailableDeckCards: true,
  });
}

/** 公開情報通知・ログの viewer 別表示とフィールド対象アンカー確認用。 */
function buildPublicDisclosure(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  instanceSeq = 0;
  const [aliceSource, bobTarget, bobSecondTarget, revealedPick] = findCards(
    allCards,
    "spirit",
    4,
    12
  );
  if (!aliceSource || !bobTarget || !bobSecondTarget || !revealedPick) {
    throw new Error("public-disclosure scenario requires four spirit cards");
  }
  const base = makeBaseState({
    step: "main",
    turn: 4,
    active: params?.get("noViewerActions") === "1" ? "bob" : "alice",
    aliceReserve: 6,
    bobReserve: 6,
  });
  const source = createCardInstance(aliceSource, {
    instanceId: "sc-public-source",
    ownerPlayerId: "alice",
    zone: "field",
    cores: 2,
  });
  const target = createCardInstance(bobTarget, {
    instanceId: "sc-public-target",
    ownerPlayerId: "bob",
    zone: "field",
    cores: 2,
  });
  const secondTarget = createCardInstance(bobSecondTarget, {
    instanceId: "sc-public-target-second",
    ownerPlayerId: "bob",
    zone: "field",
    cores: 2,
  });
  const picked = createCardInstance(revealedPick, {
    instanceId: "sc-public-picked",
    ownerPlayerId: "alice",
    zone: "hand",
  });
  const state: GameState = {
    ...base,
    cardInstances: [source, target, secondTarget, picked],
    players: base.players.map((player) => ({
      ...player,
      deckCount: 30,
      handCount: player.id === "alice" ? 1 : 0,
    })),
    publicDisclosures: [
      {
        id: "public-disclosure:4:1",
        sequence: 1,
        turnNumber: 4,
        step: "main",
        actorPlayerId: "alice",
        audience: "actor_only",
        kind: "deck_revealed",
        targets: [],
        results: [],
      },
      {
        id: "public-disclosure:4:2",
        sequence: 2,
        turnNumber: 4,
        step: "main",
        actorPlayerId: "alice",
        audience: "both",
        kind: "picked",
        targets: [],
        results: [
          {
            kind: "card_move",
            instanceId: picked.instanceId,
            definitionIdSnapshot: picked.definitionId,
            from: "revealed",
            to: "hand",
            actionLabel: "add_to_hand",
          },
        ],
      },
      {
        id: "public-disclosure:4:3",
        sequence: 3,
        turnNumber: 4,
        step: "main",
        actorPlayerId: "alice",
        audience: "both",
        source: {
          instanceId: source.instanceId,
          definitionIdSnapshot: source.definitionId,
          effectIndex: 0,
        },
        kind: "target_declared",
        targets: [
          {
            kind: "card",
            instanceId: target.instanceId,
            definitionIdSnapshot: target.definitionId,
            actionLabel: "destroy",
          },
          {
            kind: "card",
            instanceId: secondTarget.instanceId,
            definitionIdSnapshot: secondTarget.definitionId,
            actionLabel: "move_to_bottom",
          },
        ],
        results: [],
      },
      {
        id: "public-disclosure:4:4",
        sequence: 4,
        turnNumber: 4,
        step: "main",
        actorPlayerId: "bob",
        audience: "both",
        kind: "zone_moved",
        targets: [],
        results: [
          {
            kind: "card_move",
            definitionIdSnapshot: secondTarget.definitionId,
            from: "revealed",
            to: "deck",
            actionLabel: "move_to_bottom",
            deckPositionSnapshot: "bottom",
            deckIndexFromBottomSnapshot: 0,
            deckCountSnapshot: 31,
          },
          {
            kind: "card_move",
            definitionIdSnapshot: picked.definitionId,
            from: "revealed",
            to: "deck",
            actionLabel: "move_to_top",
            deckPositionSnapshot: "top",
            deckIndexFromBottomSnapshot: 30,
            deckCountSnapshot: 31,
          },
        ],
      },
    ],
  };
  const presentationState: GameState =
    params?.get("targetOnly") === "1"
      ? {
          ...state,
          publicDisclosures: (state.publicDisclosures ?? []).filter(
            (entry) => entry.kind === "target_declared"
          ),
        }
      : state;
  if (params?.get("noViewerActions") !== "1") return presentationState;
  return {
    ...presentationState,
    pendingZoneSelection: {
      pendingId: "sc-public-no-viewer-actions",
      actingPlayerId: "alice",
      sourceInstanceId: source.instanceId,
      sourceDefinitionId: source.definitionId,
      actionKind: "discard_hand",
      sourceZone: "hand",
      candidateCardInstanceIds: [picked.instanceId],
      maxCount: 1,
      destination: "trash",
      remainingActions: [],
      effectTiming: { kind: "activated", mode: "main" },
      canSkip: true,
    },
  };
}

/** デッキ破棄からトラッシュ回収まで、実 DSL と選択操作で通知を確認する。 */
function buildPublicDisclosureZoneMoves(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const getDefinition = (id: string) =>
    allCards.find((card) => card.cardNo === id);
  const source = createCardInstance(
    requireScenarioCard(allCards, "BSTH01-X04"),
    {
      instanceId: "sc-public-move-source",
      ownerPlayerId: owner,
      zone: "field",
      cores: 1,
    }
  );
  const cards = ["BSSA01-C02", "BSGE01-R01", "BSTH02-R11"].map((id, index) =>
    createCardInstance(requireScenarioCard(allCards, id), {
      instanceId: `sc-public-move-${index}`,
      ownerPlayerId: owner,
      zone: "deck",
    })
  );
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [source, ...cards],
    playerOverrides: ["alice", "bob"].map((id) => ({
      deckCount: id === owner ? cards.length : 0,
      handCount: 0,
      lifeNormalCoreCount: 5,
    })),
  });
  const result = executeEffect({
    chainId: "scenario:scenarios.ts:3827",
    state: { ...base, step: "main", turnNumber: 3, activePlayerId: owner },
    effect: {
      timing: { kind: "activated", mode: "main" },
      executionMode: "mandatory",
      steps: [
        {
          action: {
            kind: "discard",
            fromZone: "deck",
            player: "self",
            count: 2,
          },
        },
        {
          action:
            params?.get("targeted") === "1"
              ? {
                  kind: "move_card",
                  target: {
                    kind: "filter",
                    player: "self",
                    zone: "trash",
                    filter: {},
                    count: 1,
                  },
                  from: { zone: "trash", player: "self" },
                  to: { zone: "hand", player: "self" },
                  count: 1,
                }
              : {
                  kind: "search_zone",
                  zone: "trash",
                  destination: "hand",
                  count: 1,
                  mandatory: true,
                },
        },
      ],
    },
    sourceInstanceId: source.instanceId,
    actingPlayerId: owner,
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions: () => [],
  });
  // 解決済み経路は閲覧側のメインで止め、相手の自動進行から独立して通知を確認する。
  return params?.get("targeted") === "1"
    ? { ...result, activePlayerId: owner === "alice" ? "bob" : "alice" }
    : result;
}

/** unseen:true の実 DSL 解決結果を、カード参照なしの通知として確認する。 */
function buildPublicDisclosureHiddenDiscard(
  allCards: CardDefinition[]
): GameState {
  instanceSeq = 0;
  const sourceDef = requireScenarioCard(allCards, "BSTH01-X04");
  const restActionDef = requireScenarioCard(allCards, "BSTH01-X09");
  const [hiddenDef] = findCards(allCards, "spirit", 1, 24);
  if (!hiddenDef)
    throw new Error("public-disclosure-hidden-discard requires a hand card");
  const base = makeBaseState({
    step: "main",
    turn: 4,
    active: "bob",
    aliceReserve: 6,
    bobReserve: 10,
  });
  const source = createCardInstance(sourceDef, {
    instanceId: "sc-hidden-discard-source",
    ownerPlayerId: "bob",
    zone: "field",
    cores: 1,
  });
  const hiddenHand = createCardInstance(hiddenDef, {
    instanceId: "sc-hidden-discard-hand",
    ownerPlayerId: "alice",
    zone: "hand",
  });
  const restActionCard = createCardInstance(restActionDef, {
    instanceId: "sc-hidden-discard-rest-action",
    ownerPlayerId: "bob",
    zone: "hand",
  });
  const state: GameState = {
    ...base,
    cardInstances: [source, hiddenHand, restActionCard],
    players: base.players.map((player) => ({
      ...player,
      deckCount: 30,
      handCount: 1,
    })),
  };
  const getDefinition = (definitionId: string) =>
    allCards.find((definition) => definition.cardNo === definitionId);
  return executeEffect({
    chainId: "scenario:scenarios.ts:3922",
    state,
    effect: {
      timing: { kind: "activated", mode: "main" },
      executionMode: "mandatory",
      steps: [
        {
          action: {
            kind: "discard",
            player: "opponent",
            count: 1,
            unseen: true,
          },
        },
      ],
    },
    sourceInstanceId: source.instanceId,
    actingPlayerId: "bob",
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

export const SCENARIOS: Record<string, Scenario> = {
  "card-detail-zones": {
    name: "トークン詳細と除外ゾーン",
    description:
      "両者の除外閲覧とトークン切替。empty=1で空。mode=searchでC09の召喚時、owner=bobでREST、noMatch=1で対象なし。",
    build: buildCardDetailZonesScenario,
  },
  "bslh01-x03-symbol": {
    name: "ロイドのアタック/ブロック中シンボル",
    description:
      "連続アタックで2シンボルを維持。owner=bobでREST、role=blockでブロック。",
    build: buildBslh01X03SymbolScenario,
  },
  "bsaz02-fidelity": {
    name: "火星カードの継続制限",
    description:
      "エレクトリスの攻撃中制限。mode=solisで最初のバトルまでの制限、owner=bobでREST確認。",
    build: buildBsaz02FidelityScenario,
  },
  "card-selection": {
    name: "共通カード選択",
    description:
      "mode=exclude/mixed/grouped/draw/battle。手札展開・ゾーン候補・複数支払いの回帰。owner=bobでREST確認。",
    build: buildCardSelectionScenario,
  },
  "revealed-target-selection": {
    name: "オープン中の対象選択",
    description:
      "キーア導技2の公開からセット。candidates=0/1/2、owner=bobで相手選択。",
    build: buildRevealedTargetSelectionScenario,
  },
  "choice-contract": {
    name: "対象選択と入れ替えの原文監査",
    description:
      "C16の手札限定交換。mode=tensho/adventで転召・煌臨元追加先、owner=bobでREST側。",
    build: buildChoiceContractScenario,
  },
  "pregame-order": {
    name: "パチュリー手札時の先後選択",
    description:
      "相手手札にパチュリー。先後選択とマリガンを確認。owner=aliceで反転。",
    build: buildPregameOrderScenario,
  },
  "rebirth-simultaneous-leave": {
    name: "同時破壊と彼岸の転醒時",
    description: "同時破壊した他の対象を転醒時・召喚時まで待機させる",
    build: buildRebirthSimultaneousLeaveScenario,
  },
  "card-timing": {
    name: "カードのタイミングとデッキ戻し",
    description:
      "手札のデッキ下戻し。mode=stackは太陽の畑の宣言時制限と本文タイミング転醒。owner=bobで反転。",
    build: buildCardTimingScenario,
  },
  "react-card-corrections": {
    name: "金龍・サグメ・ドレミー原文訂正",
    description:
      "金龍の任意回復。mode=sagume/doremyでLv2神域、low=1でLv1、owner=bobで反転。",
    build: buildReactCardCorrectionsScenario,
  },
  "sequential-order": {
    name: "その後の選択順",
    description: "3枚ドローした後に破棄方法を選ぶ。owner=bobでREST側を確認。",
    build: buildSequentialOrderScenario,
  },
  "kenshin-level-bp": {
    name: "剣心のLv低下とBP補正",
    description:
      "BP-5000とOC2+の剣心へ小町のLvコスト+2を解決する。owner=bobでREST確認。",
    build: buildKenshinLevelBpScenario,
  },
  "kenshin-inherited-symbol": {
    name: "剣心の契約煌臨元シンボル",
    description:
      "CX01を煌臨元に持つC04の白扱いで、弥彦を1コスト配置。owner=bobでREST確認。",
    build: buildKenshinInheritedSymbolScenario,
  },
  "effect-immunity": {
    name: "効果耐性と対象選択",
    description:
      "最古の金木犀の配置時。回復パチュリーは選択不可、疲労パチュリーはBP0破壊。owner=bobで反転。",
    build: buildEffectImmunityScenario,
  },
  "star-king-payment": {
    name: "星霊王の召喚コスト全額支払い",
    description:
      "コスト+20が発揮中。鍵を必ず1枚除外し、コスト全額支払い済みとして召喚する。owner=bob でREST。",
    build: buildStarKingPaymentScenario,
  },
  "main-step-end": {
    name: "メインステップ終了時の自動進行",
    description:
      "水兵ワドルディの手札破棄とお互いの任意デッキ破棄を解決後、アタックステップへ進む。owner=bob でREST、magic=1 で終了時マジックの使用機会を確認。",
    build: buildMainStepEndScenario,
  },
  "stale-burst-check": {
    name: "古い配置ログと空バースト回帰",
    description:
      "レムリナの過去の配置ログを保持。stage=burstは正規バーストの対照。owner=bobで左右反転。",
    build: buildStaleBurstCheckScenario,
  },
  "burst-confirmation": {
    name: "バースト効果抑止中の発動確認",
    description:
      "アリスに対するソウエイの最終確認。mode=immune/bypass/forbidden/continuousで耐性・発動禁止・常時無効、owner=bobで反転。",
    build: buildBurstConfirmationScenario,
  },
  "m06-summon-life": {
    name: "アリスの召喚時ライフ増加",
    description:
      "M06の正規バーストからLv3召喚と任意効果。mode=normalで通常召喚、owner=bobでREST側。",
    build: buildM06SummonLifeScenario,
  },
  "c23-exclusive-reveal": {
    name: "火男の無償／有償回収分岐",
    description:
      "C23の実DSLで5枚公開済み。創界神すべてか1コストで3枚、場にソウルコア。owner=bobでREST、short=1で候補不足。",
    build: buildC23ExclusiveRevealScenario,
  },
  "hand-increase-burst": {
    name: "手札増加バースト：ソウエイとユウ",
    description:
      "ユウの初回バレットエディットでソウエイ発動。stage=hand-burst はランガの公開対象確認。",
    build: buildHandIncreaseBurstScenario,
  },
  "nested-grandstone-triggers": {
    name: "解封から派生した転醒の優先解決",
    description:
      "2体の解封のうち片方が転醒条件を達成。残りの解封より転醒を先に処理する。owner=bobで反転、stage=unsealで解封前。",
    build: buildNestedGrandstoneTriggersScenario,
  },
  "burst-effect-tree": {
    name: "バースト効果発揮の待機",
    description:
      "反逆者アリスの同時召喚・コア配置・残り誘発の後にヨハネスのバースト効果を発揮",
    build: buildBurstEffectTreeScenario,
  },
  "brave-bp-zero": {
    name: "合体BP0破壊",
    description: "モルター＋BP-80000で合体3体と非合体1体を破壊",
    build: buildBraveBpZeroScenario,
  },
  "host-advent-soul-only": {
    name: "真バディ ソウルコア単独への擬制煌臨",
    description:
      "ソウルコアだけの孫悟空＆ベジータに、置いたものとして契約煌臨する。owner=bobでREST確認。",
    build: (allCards, params) => {
      const owner = params?.get("owner") === "bob" ? "bob" : "alice";
      const base = makeBaseState({ active: owner });
      const host = createCardInstance(
        requireScenarioCard(allCards, "BSDB01-CX01"),
        {
          instanceId: "buddy-host",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 0,
          soulCoreCount: 1,
        }
      );
      const occupant = createCardInstance(
        requireScenarioCard(allCards, "BSDB01-C02"),
        {
          instanceId: "buddy-vegeta",
          ownerPlayerId: owner,
          zone: "hand",
        }
      );
      return {
        ...base,
        players: base.players.map((p) =>
          p.id === owner
            ? {
                ...p,
                handCount: 1,
                reserveNormalCoreCount: 0,
                contractCardNo: "BSDB01-CX01",
                reserveSoulCoreCount: 0,
                soulCoreLocation: { kind: "card", instanceId: host.instanceId },
              }
            : p
        ),
        cardInstances: [host, occupant],
      };
    },
  },
  "known-deck-bottom-draw": {
    name: "デッキ既知位置",
    description:
      "アリスの下ドロー後も上4枚の既知位置を保つ。owner=bobでREST確認。",
    build: buildKnownDeckScenario,
  },
  "summon-category": {
    name: "召喚のみの対象種別",
    description:
      "BSSA01-X02召喚時。夜錆の手札/手元にスピリット・ブレイヴ・ネクサス・マジック。actor=bobで相手操作検証。",
    build: buildSummonCategoryScenario,
  },
  "summon-source-union": {
    name: "トラッシュと魂状態の召喚",
    description: "同じ召喚の候補を統合。owner=bob / card=BSGE01-C16 で切替",
    build: buildSummonSourceUnionScenario,
  },
  "core-source-union": {
    name: "移動元を統合したコア選択",
    description:
      "西行妖・上海人形・隠岐奈。card=カード番号、owner=bobで相手視点。",
    build: buildCoreSourceUnionScenario,
  },
  "genkai-cost": {
    name: "現界のことで支払いと維持コア",
    description:
      "soul=trash/reserve、cores=0/1、owner=bob、card=BSTH10-X05で切替。",
    build: buildGenkaiCostScenario,
  },
  "manifest-count-payment": {
    name: "顕現のカウントとコア支払い",
    description:
      "蓬莱人形の顕現。count=1/2、owner=bobで反転。対象1コアとソウルコアはトラッシュへ。",
    build: buildManifestScenario,
  },
  "koishi-discard": {
    name: "こいしの相手手元破棄と回復",
    description:
      "Lv2の通常アタックから発揮側が相手手元を選ぶ。owner=bobでREST反転。",
    build: buildKoishiDiscardScenario,
  },
  "pay-cost-recover": {
    name: "里乃の通常コスト支払いと回復",
    description:
      "リザーブ0。窓後に自身を選び、通常フィールドコア2個を支払って回復。owner=bobでREST反転。",
    build: buildPayCostRecoverScenario,
  },
  "seirensen-draw-trigger": {
    name: "聖蓮船の起幻ドロー転醒",
    description:
      "card-9、card-10を順に配置。card-10の配置時2ドローと破棄後、card-9だけ転醒。owner=bobでREST反転。",
    build: buildSeirensenDrawTriggerScenario,
  },
  "dead-proof-compound-timing": {
    name: "デッド・プルーフと複合タイミング",
    description:
      "てゐの通常召喚・召喚時宣言にスタック応答し、無効化・破壊を確認。owner=bobでREST反転。",
    build: buildDeadProofCompoundTimingScenario,
  },
  "kaname-removal": {
    name: "要石のデッキ除外",
    description:
      "要石を通常召喚し、相手デッキ上2枚を除外。mode=attackは緋想のアタック、owner=bobはREST反転。",
    build: buildKanameRemovalScenario,
  },
  "deck-exclusion": {
    name: "デッキ破棄の除外書換えと直接除外",
    description:
      "X02 Lv2下のM02の実アタックで相手デッキ7枚を除外。mode=directはX02 Lv1下のM04の直接4枚除外。owner=bobでREST反転。",
    build: buildDeckExclusionScenario,
  },
  "flash-effect-category": {
    name: "フラッシュ効果種別と発揮前提",
    description:
      "R01召喚とバレットエディット入替。BSSA01-X01/BSTS01-M03の発揮前提。owner=bob、gate=hand/core/both、host=BSGE01-CX01〜CX04。",
    build: buildFlashEffectCategoryScenario,
  },
  "divine-skill-payment": {
    name: "神技の範囲支払いとバウンス対象",
    description: "隠岐奈の宣言1件→応答→コアHUD→対象HUD。owner=bobでREST検証。",
    build: buildDivineSkillPaymentScenario,
  },
  "core-shoot-targets": {
    name: "コア除去の特殊ネクサス対象除外",
    description: "BSTH01-C22の支払い→スタック→選択。owner=bobでREST検証。",
    build: buildCoreShootTargetsScenario,
  },
  "phase-owner": {
    name: "自分・相手のステップ誘発",
    description: "パチュリーと鈴仙の開始時誘発。active=bobで自分開始時。",
    build: buildPhaseOwnerScenario,
  },
  "core-hud-audit": {
    name: "コアHUD再監査",
    description:
      "リンクエイド支払い・BSGE01-R01単体効果召喚。kind=flash、stage=cost、owner=bob。",
    build: buildCoreHudAuditScenario,
  },
  "effect-entry-core-choice": {
    name: "効果召喚・配置の維持コア選択",
    description:
      "BSTH09-TR01(B)のカウント2で公開→召喚→コア選択→残札を2巡。owner=bobでREST検証。",
    build: buildEffectEntryCoreChoiceScenario,
  },
  "effect-brave-choice": {
    name: "公開からのブレイヴ召喚・合体選択",
    description:
      "メタナイトの公開から宝剣ギャラクシアを召喚。合体/スピリット状態と残札処理。owner=bobでREST。",
    build: buildEffectBraveChoiceScenario,
  },
  "empty-target-selection": {
    name: "対象不在の効果対象選択",
    description:
      "ワジの候補0件。target=presentで同一対象2回、owner=bobでREST。",
    build: buildEmptyTargetSelectionScenario,
  },
  "core-distribution-groups": {
    name: "系統共有のコア配分",
    description:
      "BSTH11-R03の種類横断配置と後段ドロー。kind=cbでBSLH01-X04、owner=bobでREST検証。",
    build: buildCoreDistributionGroupsScenario,
  },
  "crossover-fidelity": {
    name: "公開残りと枚数の選択",
    description:
      "BSES01-C02の公開残りを下/破棄。kind=countで戦力投入の0〜3枚選択、owner=bobでREST確認。",
    build: buildCrossoverFidelityScenario,
  },
  "japanese-effect-choice": {
    name: "効果選択の日本語表示",
    description:
      "BSTH01-C21の選択肢。legacy=1で旧英語ラベル、owner=bobでREST確認。",
    build: buildJapaneseEffectChoiceScenario,
  },
  "step-prompt-perspective": {
    name: "選択者視点の確認文",
    description:
      "BSGE01-C13のカウント支払い。kind=deckで水兵ワドルディ、chooser=bobでBob REST。",
    build: buildStepPromptPerspectiveScenario,
  },
  "mandatory-followup": {
    name: "任意の前段と強制の後段",
    description:
      "BSLH01-C05の破壊後コア回収・カウント増加。owner=bobでBob REST確認。",
    build: buildMandatoryFollowupScenario,
  },
  "stack-operation": {
    name: "作戦の通常使用とスタック解決順",
    description:
      "ユージオへの天翔龍閃に、場の間隙強襲を使用。九頭龍閃の転醒・カウント処理を下段スタックより先に解決する。",
    build: buildStackOperationScenario,
  },
  "rebirth-same-cause": {
    name: "同じ召喚による転醒の排他",
    description:
      "X04の転醒コア配置を確定し、同じ召喚によるX01の転醒がキューから消えることを確認。owner=bobでBob REST確認。",
    build: buildRebirthSameCauseScenario,
  },
  "tx01-opponent-attack-start": {
    name: "TX01 相手アタック開始時",
    description:
      "Lv2の怪人グラン・ギニョール、手札/手元にバースト。相手メインから開始。owner=bobでBob REST確認。",
    build: buildTx01AttackStartScenario,
  },
  "bsrk01-c06-stack": {
    name: "BSRK01-C06 スタック効果選択",
    description:
      "発動宣言中のバーストへ手札/手元からスタック。source/step/active/stage/burstSourceで境界を変更。",
    build: buildC06StackScenario,
  },
  "bsrk01-c07-up-to": {
    name: "弥彦のトラッシュコア上限配分",
    description: "通常コア2個から配分し、任意ドロー後に手札5枚へ戻す。",
    build: buildC07UpToScenario,
  },
  "shot-rebirth-battle": {
    name: "雷鎚ショットとグランギニョル転醒",
    description:
      "Bobのユウでアタックし、ショットのライフ減少にAliceが手札効果を発揮。ユウ離脱後も前半フラッシュを行い、バトル終了時にステップを終了する。",
    build: buildShotRebirthBattleScenario,
  },
  "tx01-rebirth-core-placement": {
    name: "TX01 転醒コア配置",
    description:
      "バトルでライフ減少→手札効果で戻して3コスト支払い済み。転醒コア配置を完了すると相手エンドステップへ進む。?fixed=4 は保存済み総数指定、?owner=bob はBobの操作。",
    build: buildTx01RebirthScenario,
  },
  "edh-0041-waiting-cores": {
    name: "EDH-0041 待機残存コアの場入り配置",
    description:
      "マミゾウ召喚をリザーブ2 + リリーホワイト1で支払い、消滅待機の残存1コアを配置する。actor=bob でREST相手側確認。",
    build: (allCards, params) => {
      const actor = params?.get("actor") === "bob" ? "bob" : "alice";
      const target = requireScenarioCard(allCards, "BSTH09.2-転醒R01(A)");
      const source = requireScenarioCard(allCards, "BSTH11-C03");
      return {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          playerOverrides: ["alice", "bob"].map((id) => ({
            reserveNormalCoreCount: id === actor ? 2 : 0,
            soulCoreLocation: null,
            countValue: 9,
          })),
          cardInstances: [
            createCardInstance(target, {
              instanceId: "sc-edh-target",
              ownerPlayerId: actor,
              zone: "hand",
            }),
            createCardInstance(source, {
              instanceId: "sc-edh-source",
              ownerPlayerId: actor,
              zone: "field",
              normalCoreCount: 2,
            }),
          ],
        }),
        turnNumber: 8,
        step: "main",
        activePlayerId: actor,
      };
    },
  },
  "set-review": {
    name: "P3-152 弾別双方向 e2e レビュー",
    description:
      "?set=<SET> で対象弾の cardNo (前方一致) を集めた40枚デッキ2組から通常のゲーム開始経路" +
      " (initializeGame) で開始する。GUI/API 双方向 e2e (set-review.spec.ts) 専用、GUI 単体では" +
      " set 未指定だとエラーになる。",
    build: buildSetReview,
  },
  "badge-core-display": {
    name: "バッジ整理 + コア数バッジ折り返し",
    description:
      "alice 場に コア11+ソウル (2行折り返し) / 煌臨中 (重なりpeek+スタックモーダル) / 転醒 (シアングロー)。転醒・煌臨テキストバッジ廃止の確認用",
    build: buildBadgeCoreDisplay,
  },
  "field-under-card-layout": {
    name: "フィールド重なりカード表示",
    description:
      "alice 場に 煌臨縦2px / 星霊衣△4px / ネクサス下カード / 真・バディ▽。重なり表示とブラウズ確認用。?actionMode=attack で真・バディ左右の field-tap 個別反応も確認",
    build: buildFieldUnderCardLayout,
  },
  "snapshot-progress": {
    name: "オンラインの選択解決と連続ドライブ",
    description: "ブレイヴ分離と先行する宣言済み効果の継続",
    build: buildSnapshotProgressScenario,
  },
  "mid-battle": {
    name: "中盤戦",
    description: "両者フィールドにスピリット2体、手札2枚、T3メイン",
    build: buildMidBattle,
  },
  "public-disclosure": {
    name: "公開情報盤面演出・ログ",
    description:
      "公開済みの手札追加、対象宣言、actor_only のデッキ確認を注入。通知HUDを出さず、?targetOnly=1 で対象矢印、?viewer=bob で identity snapshot を保持した右下ログを確認する。",
    build: buildPublicDisclosure,
  },
  "public-disclosure-hidden-discard": {
    name: "公開情報ログ・内容を見ない破棄",
    description:
      "bob の unseen:true 手札破棄を実 DSL で解決済み。通知HUDは出さず、alice 視点ログにはカード名と instanceId を出さず枚数と移動先だけを表示する。",
    build: buildPublicDisclosureHiddenDiscard,
  },
  "public-disclosure-zone-moves": {
    name: "公開カードの破棄・回収通知",
    description:
      "デッキ2枚破棄後、トラッシュから1枚を手札へ回収。owner=bob でREST側、viewerで通知受信側を切替。",
    build: buildPublicDisclosureZoneMoves,
  },
  "hidden-card-return": {
    name: "非公開の手札戻しと本人の既知位置",
    description:
      "BSRK01-C03の実効果による3枚ドロー後、手札2枚をデッキ下へ戻す。owner=bobでREST側。",
    build: buildHiddenCardReturnScenario,
  },
  "brave-condition": {
    name: "逆刃刀の合体条件",
    description:
      "BSRK01-X01は剣心だけと合体可能。BSTS01-R02への違法合体を検証。owner=bob対応。",
    build: buildBraveConditionScenario,
  },
  "quartz-activation": {
    name: "クォーツ: 魂状態化+セット",
    description:
      "alice 手札に ENIGMA + クォーツ3枚、カウント5。ENIGMA を魂状態化 → クォーツを host にセット。",
    build: buildQuartzActivation,
  },
  "quartz-replacement": {
    name: "クォーツ入れ替え",
    description:
      "中央に双魚珠、手札に処女珠。単一ボタンからHUDで位置・交換先を選ぶ。owner=bob対応。",
    build: buildQuartzReplacement,
  },
  attack: {
    name: "アタック",
    description: "alice 3体 vs bob 2体、アタックステップ",
    build: buildAttackPhase,
  },
  defense: {
    name: "防御側",
    description: "bob がアタック、alice にブロッカー1体+マジック",
    build: buildDefensePhase,
  },
  "opponent-combined-flash": {
    name: "相手合体スピリット フラッシュ中",
    description:
      "bob の合体スピリット3体の中央がアンダーカード付きで疲労アタック済み、alice 優先の flash_before_block 中。wrapper 中心回転と隣接侵食を確認する。",
    build: buildOpponentCombinedFlash,
  },
  "triggered-source-departure": {
    name: "召喚時の発揮元をスタックで離脱",
    description:
      "召喚時へのスタックで発揮元を手札に戻す。owner=bobでREST操作。",
    build: buildTriggeredSourceDepartureScenario,
  },
  "recovery-degree": {
    name: "重疲労からの一段階回復",
    description:
      "重疲労のユージオと青薔薇の剣を回復して疲労にする。owner=bobでREST操作。",
    build: buildRecoveryDegreeScenario,
  },
  "lethal-attack": {
    name: "致死アタック",
    description:
      "alice 攻撃スピリット1体 vs bob (ライフ1, ブロッカー無)。ブロックしない→ライフ0→敗北 (life_zero) 確認",
    build: buildLethalAttack,
  },
  "declare-gimmick-gate": {
    name: "BSLH01-C12 宣言コストゲート (declareGimmickGate)",
    description:
      "bob 攻撃スピリット1体 vs alice (ライフ2, BSLH01-C12(Lv2), ブロッカー無)。attack解決でaliceのライフ減少直前に宣言(軽減)/何もしない選択が立つ",
    build: buildDeclareGimmickGateScenario,
  },
  summon: {
    name: "召喚テスト",
    description: "低コストスピリット4枚+マジック、リザーブ豊富",
    build: buildSummonTest,
  },
  "burst-activation": {
    name: "バースト発動（任意）",
    description:
      "alice が X07 をバーストセット、ライフ減少後の発動チェック。発動/発動しない を選択。",
    build: buildBurstActivation,
  },
  "burst-mirage-zone-browse": {
    name: "ゾーンブラウズ バースト/ミラージュ",
    description:
      "alice/bob 双方にバースト1枚+ミラージュ1枚をセット。バーストエリアクリックで、自分側は表向き/相手側は裏向き(バースト)+双方表向き(ミラージュ)のゾーンブラウズを確認する。",
    build: buildBurstMirageZoneBrowse,
  },
  "eugeo-advent-source-rebirth": {
    name: "ユージオの煌臨元転醒",
    description:
      "相手の破壊に対して煌臨元の青薔薇の剣を選択し、赤薔薇の剣へ転醒。owner=bobで相手側のREST操作も確認できる。",
    build: buildEugeoRebirthScenario,
  },
  "direct-zone-browse-target-selection": {
    name: "直接ゾーンブラウズ対象選択",
    description:
      "pendingEffectTargetSelection で field 2枚 + trash 1枚 + hand 1枚を候補化。ゾーン候補HUDと通常トラッシュブラウズの両方から対象選択でき、候補は所有者+ゾーン見出しで分かれる。",
    build: buildDirectZoneBrowseTargetSelection,
  },
  brave: {
    name: "ブレイヴ合体",
    description: "スピリット1体+ブレイヴ1体（スピリット状態）、T3メイン",
    build: buildBraveCombine,
  },
  "brave-combine-summon": {
    name: "直接合体召喚（スタック窓）",
    description:
      "alice 手札に X09(ブレイヴ) + 場に X04(合体先)。直接合体召喚でコスト支払い後にスタック窓が開くことを検証。",
    build: buildBraveCombineSummonFromHand,
  },
  "aldnoah-no-combine": {
    name: "アルドノアドライブの合体不可召喚",
    description:
      "適格ホストがいてもC10は直接合体選択なしで場入り。owner=bobでREST反転。",
    build: buildAldnoahNoCombineScenario,
  },
  "field-symbol-extension": {
    name: "手元シンボルのフィールド参照",
    description:
      "snapshot=1で実盤面、owner=bob・duplicate=1で相手表示と重複を検証",
    build: buildFieldSymbolExtensionScenario,
  },
  "combined-symbols": {
    name: "合体ブレイヴのシンボル",
    description:
      "kind=spirit/ultimate/nexus、owner=bob、combined=1で表示と合体操作を確認",
    build: buildCombinedSymbolsScenario,
  },
  "self-attack-flash": {
    name: "本人限定アタック時フラッシュ",
    description: "非参加ブレイヴの発揮除外。card / role=attacking / owner=bob",
    build: buildSelfAttackFlashScenario,
  },
  "mutual-soul-state": {
    name: "相打ち後の両者の魂状態選択",
    description:
      "アリサ同士のBP比較後、両者の選択を順に処理する。owner=bob で攻守反転、contract=1 で契約カード。",
    build: buildMutualSoulStateScenario,
  },
  "contract-count-rebirth": {
    name: "契約合体のカウント・転醒同時誘発",
    description:
      "アヴェンジャー契約合体からカウント+2と裏返し。owner=bob / flash=after_block対応。",
    build: buildContractCountRebirthScenario,
  },
  "nested-advent-triggers": {
    name: "煌臨から派生したカウント増加誘発の優先解決",
    description:
      "BSTS01-C01 / CX01: 内側のドロー誘発を解決してから外側の煌臨時へ戻る",
    build: buildNestedAdventTriggersScenario,
  },
  "combined-effect-stack": {
    name: "合体中効果へのスタックと離脱確定",
    description:
      "TR01(B)転醒時にBSTH08-C01で合体先を戻す。残留/同行と魂状態を選び、合体中効果の不発を確認。owner=bob 対応。",
    build: buildCombinedEffectStackScenario,
  },
  "count-leave-order": {
    name: "カウント誘発と契約カードの離脱順序",
    description:
      "サイレントクライのカウント減少・破壊から、ティアーストーン解決後に魂状態を選ぶ。owner=bob でREST側を検証。",
    build: buildCountLeaveOrderScenario,
  },
  "special-nexus-reference": {
    name: "創界神の離脱をネクサスとして参照",
    description:
      "リムルの創界神破壊からベニマルのライフ減少を発揮する。owner=bob でREST側を検証。",
    build: buildSpecialNexusReferenceScenario,
  },
  "contract-advent-leave": {
    name: "煌臨中のリムルの魂状態選択",
    description:
      "煌臨中のリムルの破壊後、煌臨元の契約リムルを魂状態で残すか選択する。owner=bob でREST側を検証。",
    build: buildContractAdventLeaveScenario,
  },
  "contract-advent-charge": {
    name: "魂状態への契約煌臨・フィールドからコア配置",
    description:
      "BSDB01-CX01魂状態へR01を契約煌臨し、リザーブ0でC08の4コアから配置。owner=bobでREST側を検証。",
    build: buildContractAdventChargeScenario,
  },
  "revealed-burst-slot": {
    name: "オープンされたM01のバースト枠",
    description:
      "M01が2枚あってもセットは1枚。C21回収は独立。owner=bob&foreign=1は相手効果で開いたBob自身の効果選択とAliceへの復帰。",
    build: buildRevealedBurstSlotScenario,
  },
  "oracle-trigger-kinds": {
    name: "神託の本文イベント列挙",
    description:
      "永琳のミスティアアクセルは導託しない。mode=explicit-accelでは隠岐奈のアクセル神託を発揮。owner=bobでRESTを比較。",
    build: buildOracleTriggerKindsScenario,
  },
  "simultaneous-trigger-level": {
    name: "同時誘発中のLv上昇と転醒",
    description:
      "Lv1マミゾウのアタック時コア+1後に同じ疲労でLv2転醒。owner=bobでREST側を比較。",
    build: buildSimultaneousTriggerLevelScenario,
  },
  "dormant-trigger-actor": {
    name: "休眠観測中の相手誘発解決",
    description:
      "ヴァルドの休眠観測を保持し、非ターン側の切歌の残置反応を操作。owner=bobでREST側を比較。",
    build: buildDormantTriggerActorScenario,
  },
  "brave-semantic-events": {
    name: "合体と召喚の意味イベント",
    description:
      "629905088: こころの手元合体は神託を発生しない。mode=direct-summon/summon、owner=bobで比較。",
    build: buildBraveSemanticEventsScenario,
  },
  "marisa-brave-rewrite": {
    name: "魔理沙の必須ブレイヴ読み替え",
    description:
      "M05とミニ八卦炉を任意合体し、アタック時効果で相手を破壊。owner=bobでREST側を確認。",
    build: buildMarisaBraveRewriteScenario,
  },
  "inaho-combine-trigger": {
    name: "通常合体からアナリティカルエンジン",
    description:
      "界塚伊奈帆の通常合体で手札/トラッシュのC18を直接合体召喚。owner=bob、zone=trashでREST側も確認。",
    build: buildInahoCombineTriggerScenario,
  },
  "contract-leave-choice": {
    name: "契約カードと同行ブレイヴの離脱",
    description:
      "ユウとクレメンサーの実際の破壊待機から、ブレイヴ残留・魂状態を選択する。owner=bob で相手側を検証。",
    build: buildContractLeaveChoiceScenario,
  },
  "brave-leave-choice": {
    name: "ブレイヴ離脱選択 (P2-09)",
    description:
      "合体スピリット破壊時、ブレイヴを「フィールドに残す / 一緒に移動」の2択モーダル。ロード直後に表示。",
    build: buildBraveLeaveChoice,
  },
  "brave-attack-continuation": {
    name: "残留ブレイヴの自動継続",
    description:
      "ブレイヴを残すと自動継続。role=block で防御、restricted=1 で攻防不可、owner=bob でREST側。",
    build: buildBraveBattleContinuationScenario,
  },
  "soul-state-brave-battle": {
    name: "R13破壊から魂状態後の無ダメージ",
    description:
      "ユウ+TX01(A)の実アクセル破壊後。残留選択→魂状態→バトル終了。owner=bobでREST反転。",
    build: buildSoulStateBraveBattleScenario,
  },
  "r12-accel-continuation": {
    name: "R12のターン中継続無料アクセル",
    description:
      "R12の手元配置→面霊アクセル2枚を無料解決。owner=bobでREST反転。",
    build: buildR12AccelContinuationScenario,
  },
  "makai-conditional-cost": {
    name: "魔界配置時のことで対価",
    description:
      "実配置→実行/辞退。mode=empty-hand/empty-deckでは辞退のみ。owner=bobでREST反転。",
    build: buildMakaiConditionalCostScenario,
  },
  "r21-conditional-cost": {
    name: "紅魔館の所有者無指定の破壊対象",
    description:
      "相手はBP超過・自分だけに適格対象。実フラッシュの発揮/辞退。owner=bobでREST反転。",
    build: buildR21ConditionalCostScenario,
  },
  "brave-separate": {
    name: "ブレイヴ分離 (P3-58)",
    description:
      "合体スピリット静止状態 (main step)。ホスト/ブレイヴをタップ→「分離」→コア選択 HUD 起動を確認。",
    build: buildBraveSeparate,
  },
  "night-sword": {
    name: "夜空の剣の追加コア分配",
    description: "TX01(A/B)の実効果。mode=b / owner=bob / soul=reserve対応。",
    build: buildNightSwordScenario,
  },
  "bssa01-effect-text": {
    name: "反逆者アリスの効果本文",
    description:
      "メインで召喚効果を使用済み。アタック時の第2効果を宣言し、同じ本文とライフ回復を確認。owner=bob / stage=queued対応。",
    build: buildBssa01EffectTextScenario,
  },
  "no-duplicate": {
    name: "リムルの重複不可と発揮元の状態",
    description:
      "魂状態とスピリット状態の2体が誘発。どちらかを発揮すると他方は消える。",
    build: buildNoDuplicateScenario,
  },
  "rimuru-pending-leave": {
    name: "離脱待機中のリムルの旧スタック",
    description:
      "消滅待機中のcard-1がcard-6の召喚を誤観測した保存状態。パス後もカウントは増えない。",
    build: (cards) => buildRimuruPendingLeaveScenario(cards),
  },
  "no-duplicate-opponent": {
    name: "相手ターンの重複不可スキップ",
    description:
      "Bobが魂状態リムルを選び、Aliceがスキップしてスピリット側を発揮する。",
    build: (cards) => ({
      ...buildNoDuplicateScenario(cards),
      activePlayerId: "bob",
    }),
  },
  "queue-front-usage": {
    name: "使用済み効果と神託の前面操作",
    description:
      "提供snapshotの縮小再現。神託を前面にすると、その発揮・辞退だけを表示する。viewer=bob。",
    build: buildQueueFrontUsageScenario,
  },
  "mars-effects": {
    name: "火星デッキの効果回帰",
    description:
      "スレインの配置。mode=dioscuriaでヘラス取得、mode=queueで18件の導託、mode=moon-girlで配置後の任意コア移動。owner=bobで反転。",
    build: buildMarsEffectsScenario,
  },
  "hand-gain-cost": {
    name: "神谷薫の手札増加コスト",
    description:
      "チルノの2枠回収を1コストで許可または拒否。mode=drawで宵越しの銭の2枚ドロー、owner=bobでREST側。",
    build: buildHandGainCostScenario,
  },
  "battle-end-selection-chain": {
    name: "バトル終了時の数選択と効果発揮後",
    description:
      "合成効果の回帰検証。カウント減少→派生ドロー/カウント+3→後段ドロー。selection=burstは破棄枚数選択。owner=bobでREST側。",
    build: buildBattleEndSelectionChainScenario,
  },
  "cost-leave-completion": {
    name: "チルノのコスト消滅と鏡の効果完了",
    description:
      "配置時効果の回収・辞退後に消滅待機を解除する。owner=bobでREST側。",
    build: buildCostLeaveCompletionScenario,
  },
  "blazing-star-oracle": {
    name: "ヤマザナドゥの導託とブレイジングスター回収",
    description:
      "小町で導託1個、ブレイジングスターのトラッシュ回収でさらに1個。owner=bobでREST側。",
    build: buildBlazingStarOracleScenario,
  },
  "placement-oracle-trash-immunity": {
    name: "トラッシュ耐性下の配置時神託",
    description:
      "カーディナルの神託待ち。相手にジュラ・テンペスト連邦国。3枚を置き、対象2枚でコア2個。",
    build: buildPlacementOracleTrashScenario,
  },
  "trash-entry-immunity": {
    name: "浄玻璃の鏡とトラッシュ到着時の耐性",
    description:
      "配置時効果で咲夜と通常札をトラッシュへ置いた直後。回収できるのは通常札だけ。owner=bobでREST側。",
    build: buildTrashEntryImmunityScenario,
  },
  "rebirth-combined-layout": {
    name: "転醒合体と魂状態の配置",
    description:
      "通信をまたぐ柱斧の転醒合体とクォーツ横の占有幅。owner=bobで相手側を確認。",
    build: buildRebirthCombinedLayoutScenario,
  },
  "quartz-layout": {
    name: "クォーツの高さ制約",
    description:
      "魂状態ENIGMA＋中央クォーツと通常2行。full=1で左右各3枚も配置。",
    build: buildQuartzLayoutScenario,
  },
  "combined-nexus-layout": {
    name: "合体ネクサスの外側整列",
    description:
      "両者の合体魅魔を2行占有してネクサス行へ整列。mode=divine/spirit/ultimate、pose、braves=2、under=1、soul=1で表示状態を切替。",
    build: buildCombinedNexusLayoutScenario,
  },
  "hidden-protection": {
    name: "針妙丸の一括選択と耐性の証明",
    description:
      "ネクサス・ミラージュ・バーストから合計3つまで。バースト自身の耐性を公開してセットを維持する。owner=bobでREST確認。",
    build: buildHiddenProtectionScenario,
  },
  "oracle-continuation": {
    name: "柱斧の反復配置と導託",
    description:
      "導界者1枚と通常ネクサス2枚を3巡で配置し、配置時導託と対象配置の導託を各1回に保つ。owner=bobでREST確認。",
    build: buildOracleContinuationScenario,
  },
  "grandwalker-suppression": {
    name: "浄玻璃の鏡による創界神の効果抑止",
    description:
      "トラッシュ起幻と鏡がある間、両者のカーディナルの神技・神託を発揮できない。",
    build: buildGrandwalkerSuppressionScenario,
  },
  "domain-audit": {
    name: "神域・契約域・導域監査",
    description:
      "神子4コアで布都が白3シンボル。レーナ契約域でブロック後のジャガーノートだけを戻す。low=1は神子3コア。owner=bobでREST確認。",
    build: buildDomainAuditScenario,
  },
  kanjuden: {
    name: "紺珠伝・純化と神域",
    description:
      "mode=pure/deck/r03/look/swap。owner=bobでREST側の同等盤面を確認する。",
    build: buildKanjudenScenario,
  },
  "effect-source-display": {
    name: "合体中ブレイヴの効果元画像",
    description:
      "TR01(A) アタック時効果の応答待ち。キューから相手パス、任意裏返しへ進み、同じブレイヴ画像を表示。",
    build: buildEffectSourceDisplayScenario,
  },
  "bsge01-tx01-combined-brave-flash": {
    name: "BSGE01-TX01(A) 合体中ブレイヴ起動",
    description:
      "alice 場に CX01 + TX01(A) の合体ユニット。bob 攻撃中の前半フラッシュで、合体ユニットタップ→CX01 / TX01(A) 画像の下に「効果発揮」表示を確認。",
    build: buildBSGE01TX01CombinedBraveFlash,
  },
  "core-count-select": {
    name: "コア数選択「N個まで」(P3-88)",
    description:
      "BSTH01-X08 相当: 相手ライフのコア2個までをボイドに置く pendingCoreCountSelection。ロード直後に 0〜2 のコア数選択モーダルが出る。",
    build: buildCoreCountSelect,
  },
  "core-shoot-up-to": {
    name: "コアシュート「N個まで」under-selection (P3-88)",
    description:
      "BSLH01-X09 相当: 相手フィールドのコア2個まで(minTotal0)をトラッシュへ。0〜2 個を選んで決定でき、0 個でも決定可能。",
    build: buildCoreShootUpTo,
  },
  "draw-step-cost-choice": {
    name: "コスト先払い型ドロー枚数修正 (BSSL01-C03)",
    description:
      "カルテノン神殿 Lv2: 手札の系統:影/プレイヤーカード1枚を破棄してドロー+1。展開手札で対象系統のみ選択可能。未選択では支払い不可。",
    build: buildDrawStepCostChoice,
  },
  "step-optional-prompt-bssa01-c02": {
    name: "効果内任意 step prompt (BSSA01-C02)",
    description:
      "ユージオ召喚時の先頭任意 step。ロード直後に『ボイドからコア1個を自分のリザーブに置きますか？』overlay が出る。",
    build: buildStepOptionalPromptBSSA01C02,
  },
  "step-choice-prompt-bslh01-r03": {
    name: "効果内 choice prompt (BSLH01-R03)",
    description:
      "ランディ・オルランド(碧) 召喚/アタック時の3択。ロード直後に効果選択 overlay が出て、各ボタンが具体的な処理名になる。",
    build: buildStepChoicePromptBSLH01R03,
  },
  "bssl01-x01-split-summon-choice": {
    name: "場入り分配選択 (BSSL01-X01[5,6], ENGINE-sequential-slot-choice)",
    description:
      "影の君主 水篠 旬: 合計2体まで、トークンを出すことと系統影スピリットの召喚を分配。共通HUDでトークン体数を指定し、展開手札から召喚対象を選ぶ。",
    build: buildBSSL01X01SplitSummonChoice,
  },
  "bssl01-fidelity": {
    name: "水篠旬の魂状態・スピリット・契約煌臨元フラッシュ",
    description:
      "owner=alice/bob、role=soul/spirit/advent。魂状態ではカウント+2のみ、スピリットなら任意破棄から2枚ドロー。",
    build: buildBssl01FidelityScenario,
  },
  "x09-combine-condition": {
    name: "合体条件 (X09 レーヴァテイン)",
    description:
      "alice 場に レーヴァテイン(X09)+レミリア(X03)+フランドール(X04)。合体候補はフランドールのみ。",
    build: buildBSTH01X09CombineCondition,
  },
  "four-of-a-kind-multi-effect": {
    name: "効果発揮の効果選択 (X04 フォーオブアカインド)",
    description:
      "alice 場に X04 (Lv2, アタックステップ)。効果が 2 つ → 「効果発揮」押下で効果選択モーダル。",
    build: buildFourOfAKindMultiEffect,
  },
  nexus: {
    name: "ネクサス配置",
    description:
      "ネクサス2枚+スピリット1枚手札、フィールドにスピリット1体、T3メイン",
    build: buildNexusPlace,
  },
  "grandwalker-enter-field-placement-source": {
    name: "導界者コア 通常配置元除外",
    description:
      "通常ネクサス配置の維持コア配置 pending。導界者キーア上のコアは配置元候補にならず、通常スピリット/リザーブだけを選べる。",
    build: buildGrandwalkerEnterFieldPlacementSource,
  },
  "grandwalker-nexus-placement-declaration": {
    name: "導界者コア 通常配置宣言",
    description:
      "通常ネクサスを手札から配置宣言する盤面。維持コア配置時に導界者キーア上のコアを通常配置元へ指定できないことをRESTで検証する。",
    build: buildGrandwalkerNexusPlacementDeclaration,
  },
  "nexus-field": {
    name: "ネクサス両 player 配置",
    description:
      "両 player にスピリット 1 + ネクサス 1 配置済み（横画面 4 行レイアウト計測用）、T3メイン",
    build: buildNexusFieldTest,
  },
  choice: {
    name: "choice ステップ",
    description:
      "BSTH01-C05（チルノ）手札、相手スピリット2体、デッキ付き、T3メイン",
    build: buildChoiceTest,
  },
  "post-stack-step-choice-bsge01-c01": {
    name: "BSGE01-C01 窓後 choice",
    description:
      "ティアーストーンの使用宣言は1つ。相手のスタック応答窓が閉じた後に、2枚ドロー / トラッシュの契約カード回収を選ぶ。",
    build: buildPostStackStepChoiceBSGE01C01,
  },
  "bsaz02-c14-zone-discount": {
    name: "BSAZ02-C14 ヘブンズフォール zone_discount",
    description:
      "ヘブンズフォール手札、CFアルティメット場/トラッシュ2枚。追加コスト適用で3コスト使用。",
    build: buildBSAZ02C14ZoneDiscount,
  },
  "p3-29-triggered-stack": {
    name: "P3-29 誘発スタック",
    description:
      "alice の召喚時誘発 pending と bob のフラッシュマジック。発揮宣言後に main stack window を確認する。",
    build: buildP329TriggeredStack,
  },
  "p3-63-extra-turn": {
    name: "P3-63 追加ターン中",
    description:
      "BSTH02-M01 等で取得した追加ターン中の状態を direct inject。HUD の「＋追加ターン」バッジ表示確認 + advanceStep が core / attack をスキップする挙動を視覚的に確認する。",
    build: buildP363ExtraTurnActive,
  },
  "p3-62-koumakan-mid-stack": {
    name: "P3-62 紅魔館 mid-stack target 消失",
    description:
      "alice 紅魔館 (Lv2) + bob BP5000 以下スピリット。bob のアタックステップ中。紅魔館フラッシュ起動→stack で bob が target を移動・破壊→ resolve で target 不在 → cost rollback + usageLimit refund を視覚確認する。",
    build: buildP362KoumakanMidStack,
  },
  "p3-29-battle-immediate-stack": {
    name: "P3-29 バトル即時スタック",
    description:
      "alice のアタック時即時効果 prompt。自動発揮宣言後に battle flash sub-stack window を確認する。",
    build: buildP329BattleImmediateStack,
  },
  "grandstone-unseal-rebirth": {
    name: "創界石 解封→転醒→転醒後ブレイヴ合体",
    description:
      "alice 場に陰陽玉(コア2) + ユウゲンマガン(靈異)。解封選択を注入済。「解封コア+1」受諾でコア3到達→「転醒する」で玄爺へ裏返り(全コアボイド+カウント+1)→合体選択(ユウゲンマガンへ合体/しない)までを GUI で確認する。",
    build: buildGrandstoneUnsealRebirth,
  },
  "bsth01-x03-attack-grandwalker": {
    name: "BSTH01-X03 レミリア アタック (P3-50/51/52/53 検証)",
    description:
      "レミリア・スカーレットのアタック時 effects[1] (相手創界神ネクサス破壊) + effects[2] (BP20000 以下破壊 + recover) の 2 prompt が queue された状態。GUI で「発揮」ボタン表示と target 候補絞り込みを確認する。",
    build: buildBSTH01X03AttackGrandwalker,
  },
  "bsth01-x03-attack-sync-target": {
    name: "BSTH01-X03 レミリア アタック時 同期対象選択 (flash 窓前)",
    description:
      "レミリアのアタック時 BP20000 以下破壊が flash 窓前の同期経路を通る盤面。bob に BP≤20000 スピリット 2 体。発揮で対象選択 UI (候補 2 体) が出て、選んだ 1 体のみ破壊 + 回復することを確認する (先頭固定 auto-pick 回帰防止)。",
    build: buildBSTH01X03AttackSyncTarget,
  },
  "bsth01-x03-summon-shared-pending": {
    name: "BSTH01-X03 召喚時 + R21 共有 pending (発揮しない巻き添え回帰)",
    description:
      "bob 場にレミリア (Lv3) + 紅魔館 (Lv2)。レミリア召喚の summon pending を X03『召喚時』と R21 responder が共有。前面 (X03) で「発揮しない」を選んでも R21 の誘発が残ることを確認する (?viewer=bob)。",
    build: buildBSTH01X03SummonSharedPending,
  },
  "p3-30-pay-cost-sources": {
    name: "P3-30 pay_cost ソース選択",
    description:
      "BSTH01-X04 フランドールの Lv1 フラッシュ (1 コスト支払って相手破壊)。リザーブ 0、ネクサスに 2 コア。フラッシュ起動でモーダル表示。",
    build: buildP330PayCostSourceSelection,
  },
  "a7-effect-param-modify-combined": {
    name: "A-7 効果パラメータ修飾 (レーヴァテイン合体)",
    description:
      "BSTH01-X04 フランドール + BSTH01-X09 レーヴァテイン合体。bob 場に BP11000-15000 アルティメット / BP11000-15000 スピリット / BP≤10000 スピリット配置。フランドール Lv1 フラッシュ起動で maxBp 10000→15000 + spirit+ultimate に拡張されることを確認。",
    build: buildA7ParamModifyCombined,
  },
  "p3-47-redirect-prompt": {
    name: "P3-47 効果対象リダイレクト prompt",
    description:
      "alice 場の本体 + token 2 体に対し、bob の効果対象を本体に取った状態。pendingTargetRedirects に prompt を 1 件 push 済。overlay 表示・confirm/decline 操作の確認用。",
    build: buildP347RedirectPrompt,
  },
  "p3-47-redirect-choose-token": {
    name: "P3-76 効果対象リダイレクト 分身選択 (field-tap)",
    description:
      "alice 場の本体 + token 2 体 (1 体 recovered / 1 体 heavily_exhausted) に bob 効果対象を本体に取った状態。pendingTargetRedirects 注入済。field-tap で疲労分身を選んで犠牲にし回復分身を温存する運用 / 「変更しない」中央ボタンを確認する。",
    build: buildP376RedirectChooseToken,
  },
  "p3-36-mixed-owner-pending": {
    name: "P3-36 混在オーナー pending",
    description:
      "BSTH05.5-C04 を alice / bob 両 player の場に配置 + 公開キューに 2 件の direct-path optional pending を注入。ターン player の選択モードと「解決」ボタンを確認する。",
    build: buildP336MixedOwnerPending,
  },
  "p3-36-same-owner-chain": {
    name: "P3-36 同一オーナー連鎖 (順序選択)",
    description:
      "BSTH05.5-C04 を alice 場に 2 体配置 + 公開キューに 2 件の alice owner direct-path optional pending を注入。複数 pending の解決順を選び、前面の任意効果を ActionBar から発揮/辞退できることを確認する。",
    build: buildP336SameOwnerChain,
  },
  "eugeo-summon-timing": {
    name: "ユージオ召喚確定タイミング",
    description:
      "反逆者アリスの効果召喚。維持コアHUD中は誘発なし、確定後に召喚時と神託を各1回。actor=bob対応。",
    build: buildEugeoSummonTimingScenario,
  },
  dsl: {
    name: "DSL 効果テスト",
    description:
      "DSL化カード(effects定義あり)を手札に含む、デッキ付き、T3メイン",
    build: (allCards, params) => {
      instanceSeq = 0;
      // hand= パラメータでカード番号を指定可能（カンマ区切り）
      const handParam = params?.get("hand");
      const requestedCards = handParam
        ? (handParam
            .split(",")
            .map((no) => allCards.find((d) => d.cardNo === no.trim()))
            .filter(Boolean) as CardDefinition[])
        : [];
      // 指定カードがあればそれを優先、なければデフォルト
      let hand: CardDefinition[];
      if (requestedCards.length > 0) {
        hand = requestedCards;
      } else {
        // effects 定義があるカードを優先的に手札に入れる
        const dslCards = allCards
          .filter((d) => d.effects && d.effects.length > 0)
          .slice(0, 4);
        const filler = allCards
          .filter(
            (d) =>
              d.printedCategory === "spirit" &&
              d.levelDefs.length > 0 &&
              !d.effects
          )
          .slice(0, 1);
        hand = [...dslCards, ...filler];
      }
      const bobSpirits = findCards(allCards, "spirit", 2, 20);
      // デッキにカードを入れる（deck_reveal 等の効果が動作するように）
      // 紅魔/夜族/幻想 等の系統カードを優先してデッキに入れる
      const usedCardNos = new Set([
        ...hand.map((h) => h.cardNo),
        ...bobSpirits.map((b) => b.cardNo),
      ]);
      // deckTop= パラメータでデッキ上から N 枚を指定可能（カンマ区切り）。
      // テスト/手動検証で「特定カードがデッキトップにいる状況」を再現するために使用。
      const deckTopParam = params?.get("deckTop");
      const deckTopCards = deckTopParam
        ? (deckTopParam
            .split(",")
            .map((no) => allCards.find((d) => d.cardNo === no.trim()))
            .filter(Boolean) as CardDefinition[])
        : [];
      for (const c of deckTopCards) usedCardNos.add(c.cardNo);
      const tribeCards = allCards.filter(
        (d) =>
          d.levelDefs.length > 0 &&
          !usedCardNos.has(d.cardNo) &&
          d.tribe &&
          /紅魔|夜族|幻想|導界者|起幻/.test(d.tribe)
      );
      const otherCards = allCards.filter(
        (d) =>
          d.printedCategory === "spirit" &&
          d.levelDefs.length > 0 &&
          !usedCardNos.has(d.cardNo) &&
          !tribeCards.some((t) => t.cardNo === d.cardNo)
      );
      // deckTopCards を必ず最初（=デッキトップ）に置く
      const deckCards = [
        ...deckTopCards,
        ...tribeCards.slice(0, Math.max(0, 6 - deckTopCards.length)),
        ...otherCards.slice(0, 4),
      ];

      const base = makeBaseState({
        step: "main",
        turn: 3,
        active: "alice",
        aliceReserve: 10,
        bobReserve: 6,
      });
      return {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: p.id === "alice" ? deckCards.length : 30,
          handCount: p.id === "alice" ? hand.length : 0,
        })),
        cardInstances: [
          ...hand.map((d) => inst(d, "alice", "hand")),
          ...deckCards.map((d) => inst(d, "alice", "deck")),
          ...bobSpirits.map((d) => inst(d, "bob", "field", 2)),
        ],
      };
    },
  },
  "set-aside-1": {
    name: "手元 1 枚",
    description: "alice の手元に 1 枚配置（基本表示確認）",
    build: (allCards) => buildSetAside(allCards, 1, 0),
  },
  "set-aside-3": {
    name: "手元 3 枚",
    description: "alice の手元に 3 枚配置（重なり確認）",
    build: (allCards) => buildSetAside(allCards, 3, 0),
  },
  "set-aside-5": {
    name: "手元 5 枚",
    description: "alice の手元に 5 枚配置（密度高確認）",
    build: (allCards) => buildSetAside(allCards, 5, 0),
  },
  "set-aside-vs": {
    name: "手元 対称",
    description:
      "alice 3 枚 + bob 3 枚（自分=右端最前 / 相手=左端最前 の対称性確認）",
    build: (allCards) => buildSetAside(allCards, 3, 3),
  },
  "set-aside-with-nexus": {
    name: "手元+ネクサス",
    description:
      "alice にネクサス 5 枚 + 手元 3 枚（侵食防止: ネクサス行が手元領域に被らないこと）",
    build: (allCards) => buildSetAside(allCards, 3, 0, true),
  },
  "rumia-lv2-symbol-add": {
    name: "ルーミア Lv2 シンボル追加",
    description:
      "alice フィールドに ルーミア(BSTH01-C04) Lv2 (2 コア) 配置。" +
      "Lv2-Lv3『自分のメインステップ』効果で創界神/導界者ネクサスがないとき赤シンボル+2 を追加する継続効果が機能していることを確認する。" +
      "期待値: 詳細モーダルの「シンボル: 赤3」表示。",
    build: (allCards) => {
      instanceSeq = 0;
      const rumia = allCards.find((d) => d.cardNo === "BSTH01-C04");

      const base = makeBaseState({
        step: "main",
        turn: 3,
        active: "alice",
        aliceReserve: 6,
        bobReserve: 6,
      });
      const cards: ReturnType<typeof inst>[] = [];
      if (rumia) {
        cards.push(
          createCardInstance(rumia, {
            instanceId: "sc-rumia",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 2, // Lv2 (BSTH01-C04 levelDefs[1].requiredCores = 2)
          })
        );
      }

      return {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: 30,
          handCount: 0,
        })),
        cardInstances: cards,
      };
    },
  },

  "patchouli-free-magic": {
    name: "パチュリー無料マジック",
    description:
      "alice フィールドに パチュリー(BSTH01-M01) Lv2 配置 + 手札に BSTH01-C22 (紅魔・導魔 マジック)。" +
      "メイン/フラッシュタイミング選択後に「コスト支払わず」/「通常コスト」モーダルが出ることを確認する。",
    build: (allCards) => {
      instanceSeq = 0;
      const patchouli = allCards.find((d) => d.cardNo === "BSTH01-M01");
      const koumaMagic = allCards.find((d) => d.cardNo === "BSTH01-C22");
      const filler = findCards(allCards, "spirit", 1, 30);
      const bobSpirits = findCards(allCards, "spirit", 1, 20);

      const base = makeBaseState({
        step: "main",
        turn: 3,
        active: "alice",
        aliceReserve: 8,
        bobReserve: 4,
      });
      const cards: ReturnType<typeof inst>[] = [];
      const patchouliInstanceId = `sc-patchouli`;
      if (patchouli) {
        // Lv2 (requiredCores=2 per BSTH01-M01.levelDefs[1]) になるよう 2 コア載せる
        cards.push(
          createCardInstance(patchouli, {
            instanceId: patchouliInstanceId,
            ownerPlayerId: "alice",
            zone: "field",
            cores: 2,
          })
        );
      }
      if (koumaMagic) {
        cards.push(inst(koumaMagic, "alice", "hand"));
      }
      cards.push(...filler.map((d) => inst(d, "alice", "hand")));
      cards.push(...bobSpirits.map((d) => inst(d, "bob", "field", 2)));

      // パチュリーの「系統:紅魔/導魔のマジックをコストを支払わずに使える」継続効果は
      // 通常 summon/place で発火するが、シナリオで直接 field 配置するため発火しない。
      // 補正は App.tsx の rebuildContinuousEffectsFromField に委ねる (Option C)。

      return {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: 30,
          handCount:
            p.id === "alice" ? (koumaMagic ? 1 : 0) + filler.length : 0,
        })),
        cardInstances: cards,
      };
    },
  },

  "cirno-divine-release-payment": {
    name: "チルノの界放と別払いコスト",
    description:
      "妖精2体の攻撃中、導界者の3コアを維持し、通常スピリットの1コアで召喚コストを払う。owner=bobでREST側。",
    build: buildCirnoDivineReleasePaymentScenario,
  },
  "fairy-use-origin": {
    name: "妖精の手札召喚・界放コスト",
    description: "手札からの召喚元と同時アタック中のコスト減少",
    build: buildFairyUseOriginScenario,
  },
  "xx01-simul-attack": {
    name: "XX01 複数体同時アタック",
    description:
      "alice 場に [導界者]リリーブラック(BSTH07.8-XX01) + 妖精(BSTH07.8-C01)×3 + 非妖精1体。" +
      "bob 場にブロッカー2体 + 手札にマジック。アタックステップ開始済み。" +
      "妖精タップ→「複数でアタック」→追加参加体選択→確定で同時アタック宣言 (P2-05)。" +
      "ブロック側は同時アタック数までブロック可 (qa-022)。bob のマジックは XX01 効果で" +
      "「1コストで使用」モードが出る (P2-05 Phase 4a)。" +
      "ターン最初のバトル終了でアタックステップが強制終了する (Phase 4b)。",
    build: (allCards) => {
      instanceSeq = 0;
      const xx01 = allCards.find((d) => d.cardNo === "BSTH07.8-XX01");
      const fairy = allCards.find((d) => d.cardNo === "BSTH07.8-C01");
      // 妖精以外のスピリットを 3 体確保 (filter 同時アタック対象外の確認用 + bob ブロッカー)
      const nonFairy = findCards(allCards, "spirit", 10, 20)
        .filter((d) => !(d.tribe ?? "").includes("妖精"))
        .slice(0, 3);
      const bobMagic = allCards.find((d) => d.cardNo === "BSTH01-C22");

      const base = makeBaseState({
        step: "attack",
        turn: 3,
        active: "alice",
        aliceReserve: 6,
        bobReserve: 5,
      });
      const cards: ReturnType<typeof inst>[] = [];
      if (xx01) {
        cards.push(
          createCardInstance(xx01, {
            instanceId: "sc-xx01",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          })
        );
      }
      if (fairy) {
        for (let i = 1; i <= 3; i++) {
          cards.push(
            createCardInstance(fairy, {
              instanceId: `sc-fairy-${i}`,
              ownerPlayerId: "alice",
              zone: "field",
              cores: 1,
            })
          );
        }
      }
      const aliceNonFairy = nonFairy[0];
      if (aliceNonFairy) {
        cards.push(inst(aliceNonFairy, "alice", "field", 1));
      }
      for (const d of nonFairy.slice(1, 3)) {
        cards.push(inst(d, "bob", "field", 1));
      }
      if (bobMagic) cards.push(inst(bobMagic, "bob", "hand"));

      // XX01 の【導域】CE (同時アタック許可 / 相手マジック1コスト / ステップ強制終了)
      // は直接 field 配置のため発火しない。補正は App.tsx の
      // rebuildContinuousEffectsFromField に委ねる (patchouli-free-magic と同じ Option C)。

      return {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: 30,
          handCount: p.id === "bob" && bobMagic ? 1 : 0,
        })),
        cardInstances: cards,
      };
    },
  },

  "bsft01-tr06b-multi-blocker": {
    name: "BSFT01-TR06(B) 複数体ブロック強制 (P2-05 Phase 5)",
    description:
      "alice 場に キャンサー(BSFT01-TR06(B)) Lv2 (コア2)。bob 場に汎用ブロッカー3体。" +
      "アタックステップ開始済み。TR06(B) でアタック宣言→confirm→before_block flash を閉じると、" +
      "bob は「スピリット2体でないとブロックできず」(require_multi_block CE) により、" +
      "1体目の block 宣言後も 2体目の block 宣言が legal のまま残る (canDeclareMoreBlocks)。" +
      "2体宣言後に after_block flash を閉じると、各ブロッカーと個別に BP 比較して同時解決する " +
      "(10_rules/05b §複数体ブロック強制)。",
    build: (allCards) => {
      instanceSeq = 0;
      const tr06b = requireScenarioCard(
        expandCardDefinitionsWithBackFaces(allCards),
        "BSFT01-TR06(B)"
      );
      const blockerDefs = findCards(allCards, "spirit", 1, 20).slice(0, 3);

      const base = makeBaseState({
        step: "attack",
        turn: 3,
        active: "alice",
        aliceReserve: 6,
        bobReserve: 5,
      });
      const cards: ReturnType<typeof inst>[] = [
        createCardInstance(tr06b, {
          instanceId: "sc-tr06b",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
        ...blockerDefs.map((d) => inst(d, "bob", "field", 0)),
      ];

      return {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: 30,
          handCount: 0,
        })),
        cardInstances: cards,
      };
    },
  },

  "xx01-mid-battle-join": {
    name: "XX01 途中合流アタック (P3-115 窓確認)",
    description:
      "alice 場に [導界者]リリーブラック(BSTH07.8-XX01) + 妖精(BSTH07.8-C01) が既にアタック宣言済み" +
      "(window: declare_attack)。もう1体の妖精は『自分のアタックステップ中に召喚した』ものとして" +
      "既に場におり join_active_attack が legal。bob 場にブロッカー1体。" +
      "join_active_attack を適用すると preDeclarationStackWindow (kind: join_active_attack) が開き、" +
      "bob のパスで合流が確定する (P3-115: 窓欠落修正の確認用)。",
    build: (allCards) => {
      instanceSeq = 0;
      const xx01 = requireScenarioCard(allCards, "BSTH07.8-XX01");
      const fairy = requireScenarioCard(allCards, "BSTH07.8-C01");
      const blockerDef = findCards(allCards, "spirit", 1, 15)[0];

      const base = makeBaseState({
        step: "attack",
        turn: 3,
        active: "alice",
        aliceReserve: 6,
        bobReserve: 5,
      });

      const cardInstances = [
        createCardInstance(xx01, {
          instanceId: "sc-xx01-mbj",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(fairy, {
          instanceId: "sc-xx01-mbj-attacker",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
          exhaustState: "exhausted",
        }),
        createCardInstance(fairy, {
          instanceId: "sc-xx01-mbj-joiner",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        ...(blockerDef
          ? [
              createCardInstance(blockerDef, {
                instanceId: "sc-xx01-mbj-blocker",
                ownerPlayerId: "bob",
                zone: "field",
                cores: 1,
              }),
            ]
          : []),
      ];

      const preBattleState: GameState = {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: 30,
          handCount: 0,
        })),
        cardInstances,
      };

      // XX01 の【導域】CE (allow_mid_battle_join 含む) を明示的に発火する。
      // activeAttack != null なシナリオは App.tsx の rebuildContinuousEffectsFromField
      // (直接配置カードの CE 自動補正) がスキップされるため、ここで直接 executeEffect する
      // 必要がある (p2-05-mid-battle-join.test.ts の createJoinTestState と同型)。
      const cardNoMap = new Map(allCards.map((c) => [c.cardNo, c]));
      const stateWithCE = executeEffect({
        chainId: "scenario:scenarios.ts:5083",
        state: preBattleState,
        effect: xx01.effects![1]!,
        sourceInstanceId: "sc-xx01-mbj",
        actingPlayerId: "alice",
        getCardDefinitionById: (id) => cardNoMap.get(id),
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(allCards),
      });

      return {
        ...stateWithCE,
        window: "declare_attack",
        battleEntities: [
          {
            entityId: "battle-entity:sc-xx01-mbj-attacker",
            memberInstanceIds: ["sc-xx01-mbj-attacker"],
            resolvedBp: 1000,
            resolvedSymbols: ["green"],
            attackState: "attacking",
          },
        ],
        activeAttack: {
          attackId: "attack-group:3:alice:battle-entity:sc-xx01-mbj-attacker",
          primaryEntityId: "battle-entity:sc-xx01-mbj-attacker",
          participantEntityIds: ["battle-entity:sc-xx01-mbj-attacker"],
          groupMode: "single",
          target: { kind: "player", playerId: "bob" },
          blockAssignments: [
            {
              participantEntityId: "battle-entity:sc-xx01-mbj-attacker",
              blockedByEntityIds: [],
            },
          ],
          symbolResolutionOrder: ["battle-entity:sc-xx01-mbj-attacker"],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        },
        summonedDuringAttackStepInstanceIds: ["sc-xx01-mbj-joiner"],
        pendingImmediateAttackJoins: [
          {
            attackId: "attack-group:3:alice:battle-entity:sc-xx01-mbj-attacker",
            sourceInstanceId: "sc-xx01-mbj-joiner",
          },
        ],
      };
    },
  },

  "magic-target-after-stack": {
    name: "マジック対象選択はスタック窓の後",
    description:
      "alice 手札に BSTH05-R02 (豊符: フラッシュ 相手スピリット1体を重疲労)。bob 場にスピリット2体。" +
      "フラッシュ使用 → コスト支払い → スタック窓 → bob パス後に対象選択 (対象選択前にスタック窓が開く)。",
    build: (allCards) => {
      instanceSeq = 0;
      const magic = allCards.find((d) => d.cardNo === "BSTH05-R02");
      const bobSpirits = findCards(allCards, "spirit", 2, 10);
      const base = makeBaseState({
        step: "main",
        turn: 3,
        active: "alice",
        aliceReserve: 10,
        bobReserve: 4,
      });
      const cards: ReturnType<typeof inst>[] = [];
      if (magic) cards.push(inst(magic, "alice", "hand"));
      cards.push(...bobSpirits.map((d) => inst(d, "bob", "field", 2)));
      return {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: 30,
          handCount: p.id === "alice" ? (magic ? 1 : 0) : 0,
        })),
        cardInstances: cards,
      };
    },
  },

  "p3-160-magic-pre-cost-use": {
    name: "P3-160 戦力投入の支払い前使用",
    description:
      "alice の場に戦力投入と支払い元スピリット、手札に地球マジック C04、デッキに3枚。" +
      "C04 の使用前に戦力投入を通常マジックとして支払い、相手のスタック応答後に分身コア配分を行い、" +
      "元マジックを再提示する GUI/REST 双方向確認用。",
    build: (allCards) => {
      const c12 = requireScenarioCard(allCards, "BSAZ01-C12");
      const earthMagic = requireScenarioCard(allCards, "BSAZ01-C04");
      const paymentSpirit = requireScenarioCard(allCards, "BSAZ01-C01");
      const base = makeBaseState({
        step: "main",
        turn: 3,
        active: "alice",
        aliceReserve: 10,
        bobReserve: 6,
      });
      const deckCards = Array.from({ length: 3 }, (_, index) =>
        createCardInstance(paymentSpirit, {
          instanceId: `sc-p3160-deck-${index + 1}`,
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "deck",
        })
      );
      return {
        ...base,
        players: base.players.map((player) => ({
          ...player,
          handCount: player.id === "alice" ? 1 : 0,
          deckCount: player.id === "alice" ? deckCards.length : 0,
        })),
        cardInstances: [
          createCardInstance(c12, {
            instanceId: "sc-p3160-c12",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "field",
          }),
          createCardInstance(paymentSpirit, {
            instanceId: "sc-p3160-payment-spirit",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 2,
          }),
          createCardInstance(earthMagic, {
            instanceId: "sc-p3160-earth-magic",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "hand",
          }),
          ...deckCards,
        ],
      };
    },
  },

  "bsaz01-c05-c08-partial-resolution": {
    name: "BSAZ01-C05/C08 耐性後の部分解決",
    description:
      "ブロック後フラッシュ。alice の C05 がバトル中2体を指定し、bob のフィールド C08 が合体ブロッカーへ効果耐性を付与する。" +
      "解決後は耐性のない攻撃側だけ破壊し、C05の「そうしたとき」手札破棄は行わない。",
    build: (allCards) => {
      const c05 = requireScenarioCard(allCards, "BSAZ01-C05");
      const c08 = requireScenarioCard(allCards, "BSAZ01-C08");
      const spirit = requireScenarioCard(allCards, "BSAZ01-C01");
      const brave = requireScenarioCard(allCards, "BSES01-C02");
      const base = makeBaseState({
        step: "attack",
        turn: 3,
        active: "alice",
        aliceReserve: 5,
        bobReserve: 4,
      });
      const attacker = createCardInstance(spirit, {
        instanceId: "sc-c05-attacker",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "exhausted",
      });
      const blocker = {
        ...createCardInstance(spirit, {
          instanceId: "sc-c05-immune-blocker",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
        attachedChildrenIds: ["sc-c05-immune-brave"],
      };
      const blockerBrave = {
        ...createCardInstance(brave, {
          instanceId: "sc-c05-immune-brave",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          zoneRoleName: "brave",
        }),
        attachedToInstanceId: "sc-c05-immune-blocker",
      };
      const cardInstances = [
        createCardInstance(c05, {
          instanceId: "sc-c05-magic",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(c08, {
          instanceId: "sc-c08-operation",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
        }),
        attacker,
        blocker,
        blockerBrave,
        createCardInstance(spirit, {
          instanceId: "sc-c05-alice-hand",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(spirit, {
          instanceId: "sc-c05-bob-hand",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "hand",
        }),
      ];
      return recomputeAndRebuildContinuousEffects(
        {
          ...base,
          window: "flash_after_block",
          players: base.players.map((player) => ({
            ...player,
            handCount: player.id === "alice" ? 2 : 1,
          })),
          cardInstances,
          activeAttack: {
            attackId: "attack-group:scenario:c05-c08",
            primaryEntityId: "battle-entity:sc-c05-attacker",
            participantEntityIds: ["battle-entity:sc-c05-attacker"],
            groupMode: "single",
            target: { kind: "player", playerId: "bob" },
            blockAssignments: [
              {
                participantEntityId: "battle-entity:sc-c05-attacker",
                blockedByEntityIds: ["battle-entity:sc-c05-immune-blocker"],
              },
            ],
            symbolResolutionOrder: ["battle-entity:sc-c05-attacker"],
            flashBeforeBlockCompleted: false,
            flashAfterBlockCompleted: false,
            flashWindowState: {
              kind: "after_block",
              priorityPlayerId: "alice",
              consecutivePassCount: 0,
              stackResponseSourcePlayerId: "alice",
              pendingStackAction: null,
            },
          },
          battleEntities: [
            {
              entityId: "battle-entity:sc-c05-attacker",
              memberInstanceIds: ["sc-c05-attacker"],
              resolvedBp: 3000,
              resolvedSymbols: ["yellow"],
              attackState: "attacking",
            },
            {
              entityId: "battle-entity:sc-c05-immune-blocker",
              memberInstanceIds: [
                "sc-c05-immune-blocker",
                "sc-c05-immune-brave",
              ],
              resolvedBp: 3000,
              resolvedSymbols: ["yellow"],
              attackState: "blocking",
            },
          ],
        },
        (id) => allCards.find((card) => card.cardNo === id)
      );
    },
  },

  "sakuya-unpreventable": {
    name: "咲夜: 防げない効果の発揮前無効化",
    description:
      "カウント2のラストジャッジメントに咲夜で応答する。owner=bobでREST側を反転。",
    build: buildSakuyaUnpreventableScenario,
  },
  "p3-73-sakuya-flash-negate": {
    name: "P3-73 咲夜 フラッシュ無効化 (BSTH01-X05)",
    description:
      "alice 手札に 十六夜 咲夜 (BSTH01-X05) + フィールドにアタッカーのスピリット 1 体。" +
      "bob 手札に BSTH05-R02 (フラッシュ豊符) + リザーブ 5 コア。" +
      "alice アタックステップから開始。アタック宣言→フラッシュ窓 (before_block)→bob がフラッシュ使用→" +
      "alice の非公開キューに咲夜が乗り、declare で対象フラッシュに isNullified が立つ。" +
      "窓クローズ後の解決で bob マジックは効果スキップしトラッシュ (usageLimit 消費)。",
    build: (allCards) => {
      instanceSeq = 0;
      const sakuya = allCards.find((d) => d.cardNo === "BSTH01-X05");
      const bobFlash = allCards.find((d) => d.cardNo === "BSTH05-R02");
      const aliceAttacker = findCards(allCards, "spirit", 1, 0)[0];
      const base = makeBaseState({
        step: "attack",
        turn: 3,
        active: "alice",
        aliceReserve: 4,
        bobReserve: 5,
      });
      const cards: ReturnType<typeof inst>[] = [];
      if (sakuya) cards.push(inst(sakuya, "alice", "hand"));
      if (aliceAttacker) cards.push(inst(aliceAttacker, "alice", "field", 2));
      if (bobFlash) cards.push(inst(bobFlash, "bob", "hand"));
      return {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: 30,
          handCount: p.id === "alice" ? (sakuya ? 1 : 0) : bobFlash ? 1 : 0,
        })),
        cardInstances: cards,
      };
    },
  },

  "p3-86-sakuya-double-flash-negate": {
    name: "P3-86 咲夜 2 枚 フラッシュ無効化 (案X + Q3 fizzle)",
    description:
      "alice 手札に 十六夜 咲夜 (BSTH01-X05) 2 枚 + フィールドにアタッカー 1 体。" +
      "bob 手札に BSTH05-R02 (フラッシュ豊符) + リザーブ 5 コア。" +
      "alice アタックステップ→bob フラッシュ使用で咲夜 2 枚誘発。" +
      "案X: 窓中は declare 不可→スタックパス→発揮前チェックポイントで 1 枚 declare→" +
      "2 枚目はことで双方向で不発 (fizzle)。重複プロンプトが出ない/ボタンが咲夜カードに対応することを確認。",
    build: (allCards) => {
      instanceSeq = 0;
      const sakuya = allCards.find((d) => d.cardNo === "BSTH01-X05");
      const bobFlash = allCards.find((d) => d.cardNo === "BSTH05-R02");
      const aliceAttacker = findCards(allCards, "spirit", 1, 0)[0];
      const base = makeBaseState({
        step: "attack",
        turn: 3,
        active: "alice",
        aliceReserve: 4,
        bobReserve: 5,
      });
      const cards: ReturnType<typeof inst>[] = [];
      if (sakuya) {
        cards.push(inst(sakuya, "alice", "hand"));
        cards.push(inst(sakuya, "alice", "hand"));
      }
      if (aliceAttacker) cards.push(inst(aliceAttacker, "alice", "field", 2));
      if (bobFlash) cards.push(inst(bobFlash, "bob", "hand"));
      return {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: 30,
          handCount: p.id === "alice" ? (sakuya ? 2 : 0) : bobFlash ? 1 : 0,
        })),
        cardInstances: cards,
      };
    },
  },

  "p3-86-sakuya-checkpoint": {
    name: "P3-86 咲夜 2 枚 発揮前チェックポイント (bob フラッシュ済み)",
    description:
      "bob が BSTH05-R02 を使用済み (スタックに保留) + alice 咲夜 2 枚が誘発済み (非公開キュー)。" +
      "alice 視点で『窓中は X05 declare 不可 → スタックパス → 発揮前チェックポイントで X05 1 枚 declare → " +
      "2 枚目はことで双方向で fizzle (重複プロンプト無し) → bob マジック無効化トラッシュ』を完走できる。",
    build: (allCards) => {
      instanceSeq = 0;
      const sakuya = allCards.find((d) => d.cardNo === "BSTH01-X05");
      const bobFlash = allCards.find((d) => d.cardNo === "BSTH05-R02");
      const aliceAttacker = findCards(allCards, "spirit", 1, 0)[0];
      const base = makeBaseState({
        step: "attack",
        turn: 3,
        active: "alice",
        aliceReserve: 4,
        bobReserve: 5,
      });
      const cards: ReturnType<typeof inst>[] = [];
      if (sakuya) {
        cards.push(inst(sakuya, "alice", "hand"));
        cards.push(inst(sakuya, "alice", "hand"));
      }
      if (aliceAttacker) cards.push(inst(aliceAttacker, "alice", "field", 2));
      const bobFlashInst = bobFlash
        ? createCardInstance(bobFlash, {
            instanceId: "sc-bobflash",
            ownerPlayerId: "bob",
            zone: "in_use",
          })
        : null;
      if (bobFlashInst) cards.push(bobFlashInst);
      let state: GameState = {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: 30,
          handCount: p.id === "alice" ? (sakuya ? 2 : 0) : 0,
        })),
        cardInstances: cards,
      };
      if (bobFlashInst && bobFlash) {
        // bob のフラッシュをスタックに保留 (使用済み・発揮前)。
        state = {
          ...state,
          window: "stack",
          stackWindow: {
            priorityPlayerId: "alice",
            consecutivePassCount: 0,
            actingPlayerId: "bob",
            previousWindow: "none",
            stackResponseSourcePlayerId: "bob",
            subStackEverOpened: false,
            burstWindowKind: null,
            pendingStackAction: {
              stackId: "stack:bob-magic",
              actionKind: "magic",
              chainId: "chain:bob-magic",
              actingPlayerId: "bob",
              cardInstanceId: bobFlashInst.instanceId,
              cardDefinitionId: bobFlash.cardNo,
              targetInstanceIds: [],
              targetEffectFilterTags: ["general"],
              previousResponseSourcePlayerId: null,
              previousPendingStackAction: null,
            },
          },
        };
        // 咲夜 2 枚を誘発させ非公開キューへ (relatedInstanceId = bob フラッシュ)。
        state = queueFlashUsedTriggers({
          chainId: "scenario:scenarios.ts:5490",
          state,
          flashSourceInstanceId: bobFlashInst.instanceId,
          userPlayerId: "bob",
          getCardDefinitionById: (id) => allCards.find((c) => c.cardNo === id),
          getRegisteredTriggeredEffectActions:
            buildTriggeredEffectLookup(allCards),
          getRegisteredBurstActions: () => undefined,
        });
      }
      return state;
    },
  },

  "coreshoot-soul-only-target": {
    name: "コアシュート: ソウルコアのみのスピリット",
    description:
      "alice 手札に BSTH01-C22 (土符「レイジィトリリトン」フラッシュ: 相手フィールドのコア2個を相手リザーブに置く)。" +
      "bob フィールドに スピリットA (通常コア2) と スピリットB (通常コア0 + bob のソウルコアのみ)。" +
      "フラッシュ使用 → コアシュートでソウルコアのみの スピリットB も対象に選べることを確認する。",
    build: (allCards) => {
      instanceSeq = 0;
      const koumaMagic = allCards.find((d) => d.cardNo === "BSTH01-C22");
      const bobSpirits = findCards(allCards, "spirit", 2, 10);
      const base = makeBaseState({
        step: "main",
        turn: 3,
        active: "alice",
        aliceReserve: 10,
        bobReserve: 4,
      });
      const cards: ReturnType<typeof inst>[] = [];
      if (koumaMagic) cards.push(inst(koumaMagic, "alice", "hand"));
      // スピリットA: 通常コア2
      const spiritA = bobSpirits[0]
        ? inst(bobSpirits[0], "bob", "field", 2)
        : undefined;
      // スピリットB: 通常コア0。bob のソウルコアのみが乗る
      const spiritB = bobSpirits[1]
        ? inst(bobSpirits[1], "bob", "field", 0)
        : undefined;
      if (spiritA) cards.push(spiritA);
      if (spiritB) cards.push(spiritB);

      return {
        ...base,
        players: base.players.map((p) =>
          p.id === "bob" && spiritB
            ? {
                ...p,
                deckCount: 30,
                handCount: 0,
                soulCoreLocation: {
                  kind: "card" as const,
                  instanceId: spiritB.instanceId,
                },
              }
            : {
                ...p,
                deckCount: 30,
                handCount: p.id === "alice" ? (koumaMagic ? 1 : 0) : 0,
              }
        ),
        cardInstances: cards,
      };
    },
  },

  "vwal-library-lv2-main": {
    name: "ヴワル魔法図書館 Lv2 メイン",
    description:
      "alice フィールドに ヴワル魔法図書館 (BSTH01-C12) Lv2 (1 コア) 配置。" +
      "alice ライフ 4、手札 5 枚 (識別用)、メインステップ。" +
      "Lv2『自分のメインステップ』効果発揮で「ライフ→トラッシュ」コスト後、" +
      "「赤/紫として扱うシンボル2つ」が dual-color として追加される (詳細モーダル: 赤/紫 ×2)。" +
      "誤発動防止: メイン効果発揮で effects[0] (inline draw step discard) が走らない (手札維持)。",
    build: (allCards) => {
      instanceSeq = 0;
      const vwal = allCards.find((d) => d.cardNo === "BSTH01-C12");
      const fillerHand = findCards(allCards, "spirit", 1, 5);
      const base = makeBaseState({
        step: "main",
        turn: 3,
        active: "alice",
        aliceReserve: 6,
        bobReserve: 6,
      });
      const cards: ReturnType<typeof inst>[] = [];
      if (vwal) {
        cards.push(
          createCardInstance(vwal, {
            instanceId: "sc-vwal",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1, // Lv2 (BSTH01-C12 levelDefs[1].requiredCores = 1)
          })
        );
      }
      cards.push(...fillerHand.map((d) => inst(d, "alice", "hand")));

      return {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: 30,
          handCount: p.id === "alice" ? fillerHand.length : 0,
          lifeNormalCoreCount: p.id === "alice" ? 4 : 5,
        })),
        cardInstances: cards,
      };
    },
  },

  "vwal-library-draw-step-inline": {
    name: "ヴワル魔法図書館 ドローステップ inline",
    description:
      "alice フィールドに ヴワル魔法図書館 (BSTH01-C12) を配置 (Lv1)。" +
      "alice ターン・コアステップから開始。「次のステップ」1 回でドローステップへ。" +
      "inline 効果でドロー +2 (合計 3 枚) → そのまま破棄選択モーダル (手札3枚 or 紅魔1枚) が開く。" +
      "手札に 紅魔 spirit (チルノ) を 1 枚混ぜているので、alt 条件 (紅魔1枚) も検証可能。" +
      "誘発キューを経由しないこと、キュー解決の中間ステップが無いことを確認する。",
    build: (allCards) => {
      instanceSeq = 0;
      const vwal = allCards.find((d) => d.cardNo === "BSTH01-C12");
      const cirno = allCards.find((d) => d.cardNo === "BSTH01-C05");
      const fillerHand = findCards(allCards, "spirit", 4, 5);
      const base = makeBaseState({
        step: "core",
        turn: 2,
        active: "alice",
        aliceReserve: 4,
        bobReserve: 4,
      });
      const cards: ReturnType<typeof inst>[] = [];
      if (vwal) {
        cards.push(
          createCardInstance(vwal, {
            instanceId: "sc-vwal-draw",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 0,
          })
        );
      }
      // 紅魔 spirit を 1 枚と非紅魔 filler を 4 枚で計 5 枚
      const handDefs = cirno ? [cirno, ...fillerHand] : fillerHand;
      cards.push(...handDefs.map((d) => inst(d, "alice", "hand")));
      return {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: 30,
          handCount: p.id === "alice" ? handDefs.length : 0,
          lifeNormalCoreCount: p.id === "alice" ? 4 : 5,
        })),
        cardInstances: cards,
      };
    },
  },

  "patchouli-trash-distribute": {
    name: "パチュリー トラッシュ→紅魔配分",
    description:
      "alice のフィールドに パチュリー(BSTH01-M01) Lv2 + 紅魔スピリット 1 体（[紅魔郷]チルノ）を配置し、" +
      "トラッシュに通常コア 3 個とソウルコアを置く。alice のメインステップから開始するので、" +
      "「次のステップ」を 1 回押すとアタックステップ開始時の triggered effect で" +
      "「系統:紅魔のスピリットすべて回復 + トラッシュコアを配置」効果が発揮され、" +
      "コア配分 UI（フィールドカード直接タップ）でプレイヤーに配分先を選ばせる。",
    build: (allCards) => {
      instanceSeq = 0;
      const patchouli = allCards.find((d) => d.cardNo === "BSTH01-M01");
      const cirno = allCards.find((d) => d.cardNo === "BSTH01-C05");
      const filler = findCards(allCards, "spirit", 1, 5);

      const base = makeBaseState({
        step: "main",
        turn: 3,
        active: "alice",
        aliceReserve: 4,
        bobReserve: 4,
      });
      const cards: ReturnType<typeof inst>[] = [];
      if (patchouli) {
        cards.push(
          createCardInstance(patchouli, {
            instanceId: "sc-patchouli",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 2, // Lv2
          })
        );
      }
      if (cirno) {
        // [紅魔郷]チルノ は Lv1 で 1 コア（系統「紅魔」を持つ）
        cards.push(
          createCardInstance(cirno, {
            instanceId: "sc-cirno",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          })
        );
      }
      cards.push(...filler.map((d) => inst(d, "alice", "hand")));

      return {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: 30,
          handCount: p.id === "alice" ? filler.length : 0,
          ...(p.id === "alice"
            ? {
                trashNormalCoreCount: 3,
                soulCoreLocation: { kind: "trash" as const },
              }
            : {}),
        })),
        cardInstances: cards,
      };
    },
  },

  "trash-selection": {
    name: "トラッシュ選択モーダル表示",
    description:
      "alice のトラッシュにスピリット 4 枚 + マジック 1 枚を置き、return_from_trash の pendingZoneSelection を直接注入。" +
      "ZoneSelectionModal が画像付きカードグリッドで表示されることを確認するための GUI 検証用シナリオ。",
    build: (allCards) => {
      instanceSeq = 0;
      const trashCards = findCards(allCards, "spirit", 4, 0);
      const magic = findCards(allCards, "magic", 1, 0);
      const candidates = [...trashCards, ...magic];

      const base = makeBaseState({
        step: "main",
        turn: 3,
        active: "alice",
        aliceReserve: 4,
        bobReserve: 4,
      });
      const cards = candidates.map((d) => inst(d, "alice", "deck"));
      // deck から trash へ書き換え
      for (const c of cards) {
        c.zone = "trash";
      }
      const candidateIds = cards.map((c) => c.instanceId);

      return {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: 30,
        })),
        cardInstances: cards,
        pendingZoneSelection: {
          pendingId: "test-pending-trash",
          actingPlayerId: "alice",
          sourceInstanceId: candidateIds[0] ?? "noop",
          sourceDefinitionId: candidates[0]?.cardNo ?? "",
          actionKind: "return_from_trash",
          sourceZone: "trash",
          candidateCardInstanceIds: candidateIds,
          maxCount: 1,
          destination: "hand",
          remainingActions: [],
          effectTiming: { kind: "activated", mode: "main" },
          canSkip: true,
        },
      };
    },
  },

  "set-aside-selection": {
    name: "手元(set_aside)選択モーダル表示 (BSTH08.5-X01)",
    description:
      "alice の手元(set_aside)に面霊ブレイヴ3枚を置き、search_zone(zone:set_aside)由来の " +
      "pendingZoneSelection (destination:removed_from_game) を直接注入。ZoneSelectionModal が " +
      "set_aside 候補でも表示・解決できることを確認する GUI 検証用シナリオ " +
      "(BSTH08.5-X01「相手によってフィールドを離れるとき、手元の面霊ブレイヴ1枚を除外することで残る」)。",
    build: (allCards) => {
      instanceSeq = 0;
      const braveCards = ["BSTH08.5-C20", "BSTH08.5-C21", "BSTH08.5-C22"]
        .map((cardNo) => allCards.find((d) => d.cardNo === cardNo))
        .filter((d): d is CardDefinition => d !== undefined);

      const base = makeBaseState({
        step: "main",
        turn: 3,
        active: "alice",
        aliceReserve: 4,
        bobReserve: 4,
      });
      const cards = braveCards.map((d) => inst(d, "alice", "set_aside"));
      const candidateIds = cards.map((c) => c.instanceId);

      return {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: 30,
        })),
        cardInstances: cards,
        pendingZoneSelection: {
          pendingId: "test-pending-set-aside",
          actingPlayerId: "alice",
          sourceInstanceId: candidateIds[0] ?? "noop",
          sourceDefinitionId: braveCards[0]?.cardNo ?? "",
          actionKind: "return_from_trash",
          sourceZone: "set_aside",
          candidateCardInstanceIds: candidateIds,
          maxCount: 1,
          destination: "removed_from_game",
          remainingActions: [],
          effectTiming: {
            kind: "card_event",
            event: "leave_field",
            cause: "opponent_effect",
          },
          canSkip: false,
        },
      };
    },
  },

  "room-deck-reveal-queue": {
    name: "ルーム DeckReveal 連続送信",
    description:
      "room dispatch E2E 用。pick 確定直後の ordering を、先行応答待ちのまま確定する。",
    build: (allCards) => {
      instanceSeq = 0;
      const definitions = findCards(allCards, "spirit", 3, 12);
      const base = makeBaseState({
        step: "main",
        turn: 3,
        active: "alice",
      });
      const cards = definitions.map((definition) =>
        inst(definition, "alice", "revealed")
      );
      const revealedIds = cards.map((card) => card.instanceId);
      const source = cards[0];
      if (!source || revealedIds.length < 3) {
        throw new Error("room-deck-reveal-queue requires three spirit cards");
      }
      return {
        ...base,
        players: base.players.map((player) => ({
          ...player,
          deckCount: player.id === "alice" ? 27 : 30,
        })),
        cardInstances: cards,
        pendingDeckReveal: {
          pendingId: "room-deck-reveal-queue",
          actingPlayerId: "alice",
          sourceInstanceId: source.instanceId,
          sourceDefinitionId: source.definitionId,
          revealedCardInstanceIds: revealedIds,
          originalRevealedCardInstanceIds: revealedIds,
          revealTo: "both" as const,
          picks: [
            {
              count: 1,
              filter: { category: ["spirit" as const] },
              mandatory: true,
              destination: "hand" as const,
            },
          ],
          remainder: "bottom" as const,
          phase: "picking" as const,
          currentPickIndex: 0,
          pickedCardInstanceIds: [],
          origin: "deck" as const,
        },
      };
    },
  },

  "moved-to-trash-optional-choice": {
    name: "トラッシュからの任意手札追加 (R12)",
    description:
      'alice のトラッシュに BSTH01-R12 幻象「ルナクロック」を置き、origin="trash" の ' +
      "pendingDeckReveal (revealed_choice) を直接注入。テキスト「手札に加えられる」= 任意効果のため、" +
      "「トラッシュからの手札追加」モーダルが表示され、選択すれば手札へ、スキップすればトラッシュ据え置きになることを確認する。",
    build: (allCards) => {
      instanceSeq = 0;
      const luna = allCards.find((d) => d.cardNo === "BSTH01-R12");
      const base = makeBaseState({
        step: "main",
        turn: 3,
        active: "alice",
        aliceReserve: 4,
        bobReserve: 4,
      });
      const cards: ReturnType<typeof inst>[] = [];
      if (luna) {
        const c = inst(luna, "alice", "deck");
        c.zone = "trash";
        cards.push(c);
      }
      const candidateIds = cards.map((c) => c.instanceId);
      return {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: 30,
        })),
        cardInstances: cards,
        pendingDeckReveal: {
          pendingId: "test-pending-trash-optional",
          actingPlayerId: "alice",
          sourceInstanceId: "dsl-trash-optional",
          sourceDefinitionId: "dsl-trash-optional",
          revealedCardInstanceIds: candidateIds,
          originalRevealedCardInstanceIds: candidateIds,
          picks: [],
          remainder: "trash" as const,
          phase: "revealed_choice" as const,
          currentPickIndex: 0,
          pickedCardInstanceIds: [],
          revealedAutoAddCandidateIds: candidateIds,
          revealedDispositionMap: Object.fromEntries(
            candidateIds.map((id) => [
              id,
              { kind: "move" as const, destination: "hand" as const },
            ])
          ),
          origin: "trash" as const,
        },
      };
    },
  },

  "patchouli-start-summon": {
    name: "パチュリー スタートステップ召喚",
    description:
      "alice 手札に パチュリー(BSTH01-M01)。bob のエンドステップから開始。" +
      "「次のステップ」を押すと alice のスタートステップに入り、同名スピリットが自場にいなければ" +
      "通常召喚許可の summon action から1コスト支払って召喚できる。" +
      "alice の場には別名スピリット（同名比較が効いていれば条件成立、効いていなければ条件不成立）。",
    build: (allCards) => {
      instanceSeq = 0;
      const patchouli = allCards.find((d) => d.cardNo === "BSTH01-M01");
      const filler = findCards(allCards, "spirit", 1, 5);
      const otherSpirit = findCards(allCards, "spirit", 1, 25)[0];

      const base = makeBaseState({
        step: "end",
        turn: 1,
        active: "bob",
        aliceReserve: 5,
        bobReserve: 5,
      });
      const cards: ReturnType<typeof inst>[] = [];
      if (patchouli) {
        cards.push(inst(patchouli, "alice", "hand"));
      }
      if (otherSpirit) {
        // 自場には別名のスピリットだけ → cardName="self" なら条件成立
        cards.push(inst(otherSpirit, "alice", "field", 1));
      }
      cards.push(...filler.map((d) => inst(d, "alice", "hand")));

      return {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: 30,
          handCount: p.id === "alice" ? (patchouli ? 1 : 0) + filler.length : 0,
        })),
        cardInstances: cards,
      };
    },
  },
  "q54-keya-place": {
    name: "Q54 キーア宣言コスト配置",
    description:
      "alice の手札に BSLH01-X02、フィールドにコア8個の導界者キーア(BSLH01-X01)。" +
      "X01を宣言時に破壊してからスタックタイミングを開き、窓後にX02を無償配置する。",
    build: (allCards) => {
      instanceSeq = 0;
      const guidedKeya = requireScenarioCard(allCards, "BSLH01-X01");
      const grandwalkerKeya = requireScenarioCard(allCards, "BSLH01-X02");
      const base = makeBaseState({
        step: "main",
        turn: 3,
        active: "alice",
        aliceReserve: 2,
        bobReserve: 6,
      });

      return {
        ...base,
        players: base.players.map((player) => ({
          ...player,
          deckCount: 30,
          handCount: player.id === "alice" ? 1 : 0,
        })),
        cardInstances: [
          createCardInstance(guidedKeya, {
            instanceId: "sc-q54-guided-keya",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "field",
            zoneRoleName: "nexus",
            normalCoreCount: 8,
          }),
          createCardInstance(grandwalkerKeya, {
            instanceId: "sc-q54-grandwalker-keya",
            ownerPlayerId: "alice",
            controllerPlayerId: "alice",
            zone: "hand",
          }),
        ],
      };
    },
  },
  "patchouli-start-summon-blocked": {
    name: "P3-57 パチュリー 同名スピリット存在で召喚抑止",
    description:
      "alice 場と手札の両方に パチュリー(BSTH01-M01)。bob のエンドステップから開始。" +
      "「次のステップ」で alice スタートステップに入っても、condition.field_lacks cardName=self が" +
      "false (同名スピリットが自場に存在) なので通常召喚許可の summon action は出現しない。",
    build: (allCards) => {
      instanceSeq = 0;
      const patchouli = allCards.find((d) => d.cardNo === "BSTH01-M01");
      const filler = findCards(allCards, "spirit", 1, 5);

      const base = makeBaseState({
        step: "end",
        turn: 1,
        active: "bob",
        aliceReserve: 5,
        bobReserve: 5,
      });
      const cards: ReturnType<typeof inst>[] = [];
      if (patchouli) {
        // 場に Lv1 パチュリー (1 コア)、手札にもパチュリー
        cards.push(inst(patchouli, "alice", "field", 1));
        cards.push(inst(patchouli, "alice", "hand"));
      }
      cards.push(...filler.map((d) => inst(d, "alice", "hand")));

      return {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: 30,
          handCount: p.id === "alice" ? (patchouli ? 1 : 0) + filler.length : 0,
        })),
        cardInstances: cards,
      };
    },
  },
  "p3-47-act-as-spirit-token": {
    name: "P3-47 F-2 act_as_spirit token (フランドール)",
    description:
      "alice 場: フランドール・スカーレット (BSTH01-X04, 3コア=Lv2 BP13000) + " +
      "裏向き token 3 体 (各 1 コア) に act_as_spirit CE を直接注入。" +
      "host 追従で token も Lv2 / BP13000 表示・cannot_combine マーカー表示。" +
      "host のコア数を変えると token の表示も追従する (live_copy)。",
    build: (allCards) => {
      instanceSeq = 0;
      const flandre = requireScenarioCard(allCards, "BSTH01-X04");
      // token として裏向き配置するカードは何でもよい。表示確認のため
      // levelDefs を持たない非スピリット (magic) を選ぶ — 元定義に levelDefs が
      // 無くても act_as_spirit CE 経由で BP/Lv が出ることを確認するため。
      const tokenSourceDef =
        allCards.find(
          (d) => d.printedCategory === "magic" && d.cardNo !== flandre.cardNo
        ) ?? flandre;
      const enemyDef = findCards(allCards, "spirit", 1, 20)[0] ?? flandre;

      const base = makeBaseState({
        step: "main",
        turn: 3,
        active: "alice",
        aliceReserve: 4,
        bobReserve: 6,
      });

      const hostId = "sc-p347-flandre-host";
      const tokenIds = [
        "sc-p347-token-a",
        "sc-p347-token-b",
        "sc-p347-token-c",
      ];
      const enemyId = "sc-p347-enemy";

      const cardInstances = [
        createCardInstance(flandre, {
          instanceId: hostId,
          ownerPlayerId: "alice",
          zone: "field",
          cores: 3, // Lv2
        }),
        ...tokenIds.map((id) =>
          createCardInstance(tokenSourceDef, {
            instanceId: id,
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
            faceDown: true,
          })
        ),
        createCardInstance(enemyDef, {
          instanceId: enemyId,
          ownerPlayerId: "bob",
          zone: "field",
          cores: 2,
        }),
      ];

      // act_as_spirit CE を 3 token に注入。lifecycle: while_on_field、
      // sourceInstanceId=host (フランドール本体)、targetInstanceId=token。
      const activeContinuousEffects = tokenIds.map((tokenId, i) => ({
        effectId: `sc-p347-act-as-spirit-${i + 1}`,
        sourceInstanceId: hostId,
        sourceDefinitionId: flandre.cardNo,
        actingPlayerId: "alice",
        duration: { scope: "while_on_field" as const },
        createdAtTurn: 3,
        createdAtAttackId: null,
        modifierTag: "act_as_spirit" as const,
        targetInstanceId: tokenId,
        metadata: {
          statBlueprint: {
            kind: "live_copy_from",
            sourceInstanceId: hostId,
            // フランドール本文「同じコスト、シンボル、系統、Lv、BPを持つ」に従い
            // 軽減は付与しない (reductionSymbols は aspects に含めない)。
            aspects: [
              "cost",
              "symbolColors",
              "tribes",
              "levelDefs",
              "currentLv",
            ],
          },
          overrides: {
            cardName: "フランドール・スカーレット",
            levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
            keywords: ["cannot_combine"],
          },
        },
      }));

      return {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: 30,
          handCount: 0,
        })),
        cardInstances,
        activeContinuousEffects,
      };
    },
  },
  "p3-47-bunshin-opponent-view": {
    name: "P3-47 F-2 分身 (相手視点)",
    description:
      "alice 場: フランドール本体 + 裏向き分身 token 3 体 (各 1 コア)。" +
      "bob 視点として alice の分身 token を sanitizer 相当に mask " +
      "(definitionId=_hidden_card_)。act_as_spirit CE は state に残るため、" +
      "分身カードを long-press すると元カードの正体を伏せたまま" +
      "「裏向きスピリット（分身）」モーダルが Lv/BP/コア数を表示することを確認できる。" +
      "?viewer=alice|bob (省略時 bob) で視点を切替可能。",
    build: (allCards, params) => {
      instanceSeq = 0;
      const viewer = params?.get("viewer") ?? "bob";
      const flandre = requireScenarioCard(allCards, "BSTH01-X04");
      const tokenSourceDef =
        allCards.find(
          (d) => d.printedCategory === "magic" && d.cardNo !== flandre.cardNo
        ) ?? flandre;

      const base = makeBaseState({
        step: "main",
        turn: 3,
        active: "alice",
        aliceReserve: 4,
        bobReserve: 6,
      });

      const hostId = "sc-p347ov-flandre-host";
      const tokenIds = [
        "sc-p347ov-token-a",
        "sc-p347ov-token-b",
        "sc-p347ov-token-c",
      ];

      const maskIfOpponent = (ci: CardInstance): CardInstance => {
        if (ci.ownerPlayerId !== viewer && ci.faceDown && ci.zone === "field") {
          return {
            ...ci,
            definitionId: "_hidden_card_",
            originalDefinitionId: "_hidden_card_",
          };
        }
        return ci;
      };

      const cardInstances: CardInstance[] = [
        createCardInstance(flandre, {
          instanceId: hostId,
          ownerPlayerId: "alice",
          zone: "field",
          cores: 3,
        }),
        ...tokenIds.map((id) =>
          maskIfOpponent(
            createCardInstance(tokenSourceDef, {
              instanceId: id,
              ownerPlayerId: "alice",
              zone: "field",
              cores: 1,
              faceDown: true,
            })
          )
        ),
      ];

      const activeContinuousEffects = tokenIds.map((tokenId, i) => ({
        effectId: `sc-p347ov-act-as-spirit-${i + 1}`,
        sourceInstanceId: hostId,
        sourceDefinitionId: flandre.cardNo,
        actingPlayerId: "alice",
        duration: { scope: "while_on_field" as const },
        createdAtTurn: 3,
        createdAtAttackId: null,
        modifierTag: "act_as_spirit" as const,
        targetInstanceId: tokenId,
        metadata: {
          statBlueprint: {
            kind: "live_copy_from",
            sourceInstanceId: hostId,
            aspects: [
              "cost",
              "symbolColors",
              "tribes",
              "levelDefs",
              "currentLv",
            ],
          },
          overrides: {
            cardName: "フランドール・スカーレット",
            levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
            keywords: ["cannot_combine"],
          },
        },
      }));

      // この盤面は「alice が前ターンに【フォーオブアカインド】を発揮済みで、
      // 裏向き分身 token 3 体を生成した直後」の状態を再現する。
      // 整合性のため:
      // - deckCount を 27 (= 30 - 3) に減らす
      // - effectUsageRecords にフォーオブアカインド使用済みエントリを追加
      //   (per_instance/game + per_card_name/turn 双方をマーク)
      // これにより condition (field_has zone:deck minCount:3) + usageLimit の
      // 両方が「再発揮不可」を保証する。
      const flandreEffectIndex = 1;
      const flandreEffectLabel = `spirit:${flandreEffectIndex}`;
      const effectUsageRecords = [
        {
          sourceInstanceId: hostId,
          sourceDefinitionId: flandre.cardNo,
          effectLabel: flandreEffectLabel,
          turnNumber: 2,
          step: "main" as const,
          duration: "game" as const,
          count: 1,
        },
        {
          sourceInstanceId: hostId,
          sourceDefinitionId: flandre.cardNo,
          effectLabel: flandreEffectLabel,
          turnNumber: 2,
          step: "main" as const,
          duration: "turn" as const,
          count: 1,
        },
      ];

      return {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: p.id === "alice" ? 27 : 30,
          handCount: 0,
        })),
        cardInstances,
        activeContinuousEffects,
        effectUsageRecords,
      };
    },
  },
  "p3-47-frandolle-activatable": {
    name: "P3-47 Phase 3 フランドール【フォーオブアカインド】 起動可能",
    description:
      "alice 場: フランドール (BSTH01-X04, 3コア=Lv2) のみ。alice デッキ 5 枚 / リザーブ 3 コア / 創界神・導界者ネクサスなし。" +
      "bob 場: 効果対象になりうるスピリット 1 体。" +
      "Lv2 フラッシュ【フォーオブアカインド】を GUI から起動 → 裏向き 3 枚配置 → コア分配 → " +
      "act_as_spirit + redirect_effect_target CE 登録の end-to-end 検証用。",
    build: (allCards) => {
      instanceSeq = 0;
      const flandre = requireScenarioCard(allCards, "BSTH01-X04");
      // デッキに入れるカードは何でもよい。effects[1] step1 で deck top 3 枚を裏向きで field に置く。
      const deckCards = allCards
        .filter(
          (d) =>
            d.printedCategory === "spirit" &&
            d.levelDefs.length > 0 &&
            d.cardNo !== flandre.cardNo
        )
        .slice(0, 5);
      const enemyDef = findCards(allCards, "spirit", 1, 20)[0] ?? flandre;

      const base = makeBaseState({
        step: "main",
        turn: 3,
        active: "alice",
        aliceReserve: 4, // soulCoreLocation: reserve があるので reserveNormalCoreCount = 3
        bobReserve: 4,
      });

      const hostId = "sc-p347-act-flandre";
      const enemyId = "sc-p347-act-enemy";

      return {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: p.id === "alice" ? deckCards.length : 30,
          handCount: 0,
        })),
        cardInstances: [
          createCardInstance(flandre, {
            instanceId: hostId,
            ownerPlayerId: "alice",
            zone: "field",
            cores: 3, // Lv2: フラッシュ【フォーオブアカインド】の applicability 成立
          }),
          ...deckCards.map((d, i) =>
            createCardInstance(d, {
              instanceId: `sc-p347-act-deck-${i}`,
              ownerPlayerId: "alice",
              zone: "deck",
              cores: 0,
            })
          ),
          createCardInstance(enemyDef, {
            instanceId: enemyId,
            ownerPlayerId: "bob",
            zone: "field",
            cores: 2,
          }),
        ],
      };
    },
  },
  "p3-47-frandolle-multi-source": {
    name: "P3-47 F-5 フランドール multi-source 配分テスト",
    description:
      "alice 場: フランドール (Lv2, 3 コア) + 補助スピリット (4 コア)。alice デッキ 5 枚 / " +
      "リザーブ 4 コア / トラッシュ 2 コア / ライフ 5 コア。bob 場: 1 体。" +
      "Lv2 フラッシュ【フォーオブアカインド】起動 → any_movable_self による複数ソース配分 GUI 検証用 (ライフ・トラッシュからも明示選択可能)。" +
      "?soul=trash|life でソウルコアの所在を切替 (既定 reserve)。トラッシュ/ライフのソウルを掴むと表示が消えるか検証用。",
    build: (allCards, params) => {
      instanceSeq = 0;
      const flandre = requireScenarioCard(allCards, "BSTH01-X04");
      // ?soul=trash|life でソウルコアの所在ゾーンを切替。reserve から移すだけ
      // (通常コア数は据え置き) なので総コア数は保存される。
      const soulZone: "reserve" | "trash" | "life" = (() => {
        const v = params?.get("soul");
        return v === "trash" || v === "life" ? v : "reserve";
      })();
      const supportDef = allCards.find(
        (d) =>
          d.printedCategory === "spirit" &&
          d.levelDefs.length > 0 &&
          d.cardNo !== flandre.cardNo &&
          !d.grandwalkerData
      )!;
      const deckCards = allCards
        .filter(
          (d) =>
            d.printedCategory === "spirit" &&
            d.levelDefs.length > 0 &&
            d.cardNo !== flandre.cardNo &&
            d.cardNo !== supportDef.cardNo
        )
        .slice(0, 5);
      const enemyDef = findCards(allCards, "spirit", 1, 20)[0] ?? flandre;

      const base = makeBaseState({
        step: "main",
        turn: 3,
        active: "alice",
        aliceReserve: 5, // soulCoreLocation: reserve なので reserveNormalCoreCount = 4
        bobReserve: 4,
      });

      const hostId = "sc-p347-ms-flandre";
      const supportId = "sc-p347-ms-support";
      const enemyId = "sc-p347-ms-enemy";

      return {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: p.id === "alice" ? deckCards.length : 30,
          handCount: 0,
          // alice トラッシュ 2 コア + ?soul= でソウル所在を切替
          ...(p.id === "alice"
            ? {
                trashNormalCoreCount: 2,
                ...(soulZone !== "reserve"
                  ? { soulCoreLocation: { kind: soulZone } }
                  : {}),
              }
            : {}),
        })),
        cardInstances: [
          createCardInstance(flandre, {
            instanceId: hostId,
            ownerPlayerId: "alice",
            zone: "field",
            cores: 3, // Lv2
          }),
          createCardInstance(supportDef, {
            instanceId: supportId,
            ownerPlayerId: "alice",
            zone: "field",
            cores: 4,
          }),
          ...deckCards.map((d, i) =>
            createCardInstance(d, {
              instanceId: `sc-p347-ms-deck-${i}`,
              ownerPlayerId: "alice",
              zone: "deck",
              cores: 0,
            })
          ),
          createCardInstance(enemyDef, {
            instanceId: enemyId,
            ownerPlayerId: "bob",
            zone: "field",
            cores: 2,
          }),
        ],
      };
    },
  },
  "face-down-field": {
    name: "P3-47 F-1 裏向きフィールド",
    description:
      "alice / bob の場にそれぞれ裏向きスピリット 2 枚 (コア 1 個ずつ) + 通常スピリット 1 体。" +
      "?viewer=alice|bob (省略時 alice) で対戦相手側の裏向きカードを sanitizer 相当に" +
      "masked (definitionId=_hidden_card_) として配置し、card-back 画像表示を確認できる。",
    build: (allCards, params) => {
      instanceSeq = 0;
      const viewer = params?.get("viewer") ?? "alice";
      const aliceFaceDown = findCards(allCards, "spirit", 2, 0);
      const bobFaceDown = findCards(allCards, "spirit", 2, 10);
      const aliceFaceUp = findCards(allCards, "spirit", 1, 5);
      const bobFaceUp = findCards(allCards, "spirit", 1, 15);

      const base = makeBaseState({
        step: "main",
        turn: 3,
        active: viewer === "bob" ? "bob" : "alice",
        aliceReserve: 6,
        bobReserve: 6,
      });

      const makeFaceDown = (
        def: CardDefinition,
        owner: string,
        cores: number
      ) => {
        const ci = createCardInstance(def, {
          instanceId: `sc-${++instanceSeq}`,
          ownerPlayerId: owner,
          zone: "field",
          cores,
          faceDown: true,
        });
        // viewer 以外の owner の裏向きカードは sanitizer 相当に mask
        if (owner !== viewer) {
          return {
            ...ci,
            definitionId: "_hidden_card_",
            originalDefinitionId: "_hidden_card_",
          };
        }
        return ci;
      };

      return {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: 30,
          handCount: 0,
        })),
        cardInstances: [
          ...aliceFaceDown.map((d) => makeFaceDown(d, "alice", 1)),
          ...bobFaceDown.map((d) => makeFaceDown(d, "bob", 1)),
          ...aliceFaceUp.map((d) => inst(d, "alice", "field", 2)),
          ...bobFaceUp.map((d) => inst(d, "bob", "field", 2)),
        ],
      };
    },
  },

  /**
   * P3-46 G6: コアシュート選択 UI の手動検証用シナリオ。
   * `pendingCoreShootSelection` を直接注入し、alice が bob のフィールドから
   * 計 2 個のコアを (`reserve` へ) シュートする選択画面を表示する。
   * 配分先候補は bob のスピリット 2 体 (各 2 コア)。
   * 期待動作:
   *   - 各候補カードをタップで分配数増減 (preview に反映)。
   *   - 「決定」で `coreShootDistribution` が recompose され applyLegalAction
   *     `resolve_pending_core_shoot` を発火、bob のコアが reserve に移動。
   *   - facade `coreSelection` の `purpose: "shoot"` draft 経由で動作。
   */
  "p3-46-core-shoot": {
    name: "P3-46 G6 コアシュート選択 UI",
    description:
      "alice 場にパチュリー (BSTH01-M01)、bob 場にスピリット 2 体 (各 2 コア)。" +
      "`pendingCoreShootSelection` を直接注入し、alice が bob のフィールドから" +
      "コア合計 2 個を選んで `reserve` に移動する選択画面が表示される。",
    build: (allCards) => {
      instanceSeq = 0;
      const sourceDef = requireScenarioCard(allCards, "BSTH01-M01");
      const bobSpirits = findCards(allCards, "spirit", 2, 10);

      const base = makeBaseState({
        step: "main",
        turn: 3,
        active: "alice",
        aliceReserve: 4,
        bobReserve: 4,
      });

      const aliceSource = createCardInstance(sourceDef, {
        instanceId: "sc-p346-source",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 2,
      });
      const bobInstances = bobSpirits.map((d, i) =>
        createCardInstance(d, {
          instanceId: `sc-p346-bob-${i + 1}`,
          ownerPlayerId: "bob",
          zone: "field",
          cores: 2,
        })
      );

      return {
        ...base,
        players: base.players.map((p) => ({
          ...p,
          deckCount: 30,
          handCount: 0,
        })),
        cardInstances: [aliceSource, ...bobInstances],
        pendingCoreShootSelection: {
          pendingId: "sc-p346-shoot-pending",
          actingPlayerId: "alice",
          sourceInstanceId: "sc-p346-source",
          sourceDefinitionId: sourceDef.cardNo,
          candidates: bobInstances.map((c) => ({
            instanceId: c.instanceId,
            definitionId: c.definitionId,
            availableCores: c.normalCoreCount,
          })),
          totalAmount: 2,
          toKind: "reserve",
          toPlayerId: "alice",
          fromPlayerId: "bob",
          remainingActions: [],
          effectTiming: { kind: "activated", mode: "main" },
        },
      };
    },
  },

  // ── P3-56: field-center 横スクロール検証シナリオ ──
  "field-overflow-self": {
    name: "P3-56 自分側オーバーフロー",
    description:
      "alice spirit 12 + nexus 6 / bob 標準。 自分側の横スクロール起動 / combined-first sort で先頭が左端可視を確認。",
    build: (allCards) =>
      buildFieldOverflow(allCards, {
        aliceSpirits: 12,
        aliceNexuses: 6,
        aliceCombined: 0,
        bobSpirits: 2,
      }),
  },
  "field-overflow-opp": {
    name: "P3-56 相手側オーバーフロー",
    description:
      "bob spirit 12 + nexus 6 / alice 標準。 相手側 rtl 横スクロール / combined 右端固定確認。",
    build: (allCards) =>
      buildFieldOverflow(allCards, {
        aliceSpirits: 2,
        bobSpirits: 12,
        bobNexuses: 6,
      }),
  },
  "field-overflow-both": {
    name: "P3-56 両者オーバーフロー",
    description: "両者 spirit 10 + nexus 4。 自分↔相手 scroll 独立性確認。",
    build: (allCards) =>
      buildFieldOverflow(allCards, {
        aliceSpirits: 10,
        aliceNexuses: 4,
        bobSpirits: 10,
        bobNexuses: 4,
      }),
  },
  "field-overflow-with-setaside": {
    name: "P3-56 オーバーフロー+手元",
    description:
      "alice spirit 8 + nexus 6 + 手元 3。 手元有時のネクサス行早期 scroll 起動 / phantom 機能確認。",
    build: (allCards) =>
      buildFieldOverflow(allCards, {
        aliceSpirits: 8,
        aliceNexuses: 6,
        aliceSetAside: 3,
        bobSpirits: 2,
      }),
  },
  "self-magic-reduction": {
    name: "C04自己軽減の支払い",
    description:
      "手札/場からの使用と同名非重複。useFrom=field / owner=bob対応。",
    build: buildSelfMagicReductionScenario,
  },
  "mirage-effect-swap": {
    name: "ミラージュ効果セットの個別交換",
    description:
      "里香(EX)/竹田ヒバリ/スカベンジャー・ファイドの効果解決中に追加または1枚交換を選ぶ",
    build: buildMirageEffectSwapScenario,
  },
  "mirage-individual-swap": {
    name: "化け化けの個別交換",
    description:
      "0枠・追加・交換先1枚と支払いHUD。multiple=1 / incoming=exempt / owner=bob。",
    build: buildMirageIndividualSwapScenario,
  },
  "field-card-state": {
    name: "フィールドのカード状態",
    description:
      "BSAZ03-C01の使用後配置とBSAZ01-C04の自己配置。owner=bob / layout=1 / noSetAside=1対応。",
    build: buildFieldCardStateScenario,
  },
  "field-overflow-with-combined": {
    name: "P3-56 オーバーフロー+合体",
    description:
      "alice 合体 2 + solo 6 + nexus 4。 combined 端固定 / 隣接 sibling shift / nexus 行 selector 非マッチ確認。",
    build: (allCards) =>
      buildFieldOverflow(allCards, {
        aliceCombined: 2,
        aliceSpirits: 6,
        aliceNexuses: 4,
        bobSpirits: 2,
      }),
  },
  "field-overflow-combined-only": {
    name: "P3-56 合体のみオーバーフロー",
    description:
      "alice 合体 5 体 (solo / nexus 無)。 合体連続 shift / combined-only overflow 時の自然 scroll 挙動確認。",
    build: (allCards) =>
      buildFieldOverflow(allCards, {
        aliceCombined: 5,
        bobSpirits: 2,
      }),
  },
  "soul-core-multi-count-display": {
    name: "P3-101 S4 ソウルコア複数個表示",
    description:
      "alice のリザーブに<ソウルコア>2個 (例: BSLH01-X05 の generateSoulCoreOutsideGame で" +
      "2個目を生成した後の状態を再現)。旧実装は boolean 表示のため2個目が不可視だった" +
      "バグの回帰確認用。`?zone=trash|life` でトラッシュ/ライフに2個配置。",
    build: (allCards, params) => {
      instanceSeq = 0;
      const zone =
        params?.get("zone") === "trash" || params?.get("zone") === "life"
          ? (params.get("zone") as "trash" | "life")
          : "reserve";
      const base = makeBaseState({ step: "main", turn: 3, active: "alice" });
      return {
        ...base,
        players: base.players.map((p) =>
          p.id === "alice"
            ? {
                ...p,
                soulCoreLocation: { kind: zone },
                reserveSoulCoreCount: zone === "reserve" ? 2 : 0,
                trashSoulCoreCount: zone === "trash" ? 2 : 0,
                lifeSoulCoreCount: zone === "life" ? 2 : 0,
              }
            : p
        ),
      };
    },
  },
  "soul-core-multi-count-display-card": {
    name: "P3-101 S4 カード添着ソウルコア複数個表示",
    description:
      "alice 場の BSTH03-転醒X01(A)（上白沢慧音）に<ソウルコア>3個を添着した状態を再現" +
      "（『転醒：カウント5以下』でフィールド/リザーブ/トラッシュ/ライフの全ソウルを" +
      "1枚へ集約する挙動、bsth03-tensei-x01b-rebirth-attack.test.ts で soulCoreCount=9 まで" +
      "到達確認済み）。旧実装は添着を boolean 表示のため常に「1」固定だった回帰確認用。",
    build: (allCards) => {
      instanceSeq = 0;
      const keine = requireScenarioCard(allCards, "BSTH03-転醒X01(A)");
      const base = makeBaseState({ step: "main", turn: 5, active: "alice" });
      const instanceId = "sc-keine-multi-soul";
      return {
        ...base,
        // 実際の集約効果（【転醒：カウント5以下】）後の到達可能な状態を再現する
        // (bsth03-tensei-x01b-rebirth-attack.test.ts 同型)。reserve 側に幽霊ソウルを
        // 残す boolean 誤解釈の回帰を避けるため、primary pointer をカードへ寄せ、
        // reserve/trash/life のソウルカウントを 0 に揃える。
        players: base.players.map((p) =>
          p.id === "alice"
            ? {
                ...p,
                soulCoreLocation: { kind: "card", instanceId },
                reserveSoulCoreCount: 0,
                trashSoulCoreCount: 0,
                lifeSoulCoreCount: 0,
              }
            : p
        ),
        cardInstances: [
          createCardInstance(keine, {
            instanceId,
            ownerPlayerId: "alice",
            zone: "field",
            cores: 3,
            soulCoreCount: 3,
          }),
        ],
      };
    },
  },
};
