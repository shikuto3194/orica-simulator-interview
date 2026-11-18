import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createActiveAttack,
  createCardInstance,
  createEmptyGameState,
  createGameSnapshot,
  getLegalActions,
  parseGameSnapshot,
  recordEffectUsageIfLimited,
  restoreSnapshot,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "@orica/rules-core";
import { executeGrantExtraTurn } from "../../../packages/rules-core/src/effect/structured-state-grants";
import { consumeMirageSetCountExemption } from "../../../packages/rules-core/src/mechanics/mirage-exemption-usage";

/**
 * P3-170 使用会計 (effectAccounting) の GUI/REST 受入用の盤面。`?case=` で5種類を作る。
 * いずれも実カードだけで構成し、使用枠は実際の宣言/消費の経路 (または公開APIの記録関数) で作る。
 *
 * - divine  : 神技(導技)の同名制限。Alice に同名2体 / Bob に1体 (BSAZ02-X04, 攻撃フラッシュ窓)
 * - advent  : 煌臨の枠は使用者ごと。双方 BSDB01-CX01 + BSDB01-C03 (攻撃フラッシュ窓, Bob は実ソウルコア無し)
 * - cancel  : 効果内の選択待ち (BSTH01-X04 フォーオブアカインドのコア配分)。stage=ready で宣言前、
 *             restored=1 で保存→復元済み
 * - optional: 任意の誘発効果 (BSSL01-C04 配置時, 〔ターンに1回:同名〕) の発揮/辞退待ち。restored=1 で保存→復元済み
 * - extra   : 追加ターン (中断→復帰)。BSTH01-X04 を2体持ち、片方は追加ターン前に使用済み
 * - public  : 公開投影。Bob の私的な枠 (X04 使用済み) と、公開されるミラージュ免除の枠
 */
export function buildEffectUsageAccountingScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const kase = params?.get("case") ?? "divine";
  const ctx = new ScenarioContext(cards);
  switch (kase) {
    case "divine":
      return buildDivine(ctx);
    case "advent":
      return buildAdvent(ctx);
    case "cancel":
      return buildCancel(
        ctx,
        params?.get("stage") ?? "pending",
        params?.get("restored") === "1"
      );
    case "optional":
      return buildOptional(ctx, params?.get("restored") === "1");
    case "extra":
      return buildExtraTurn(ctx);
    case "public":
      return buildPublic(ctx);
    default:
      throw new Error(`unknown effect-usage-accounting case: ${kase}`);
  }
}

class ScenarioContext {
  private readonly definitions: Map<string, CardDefinition>;
  readonly lookups: {
    getCardDefinitionById: (id: string) => CardDefinition | undefined;
    getRegisteredFieldCardEffectActions: ReturnType<
      typeof buildFieldCardEffectLookup
    >;
    getRegisteredTriggeredEffectActions: ReturnType<
      typeof buildTriggeredEffectLookup
    >;
  };
  constructor(readonly cards: CardDefinition[]) {
    this.definitions = new Map(cards.map((card) => [card.cardNo, card]));
    this.lookups = {
      getCardDefinitionById: (id) => this.definitions.get(id),
      getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(cards),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
    };
  }
  def(cardNo: string): CardDefinition {
    const found = this.definitions.get(cardNo);
    if (!found) throw new Error(`card not found: ${cardNo}`);
    return found;
  }
  card(
    cardNo: string,
    instanceId: string,
    ownerPlayerId: string,
    zone: "field" | "hand" | "deck" | "trash" | "mirage",
    extra: { normalCoreCount?: number; exhaustState?: "exhausted" } = {}
  ) {
    return createCardInstance(this.def(cardNo), {
      instanceId,
      ownerPlayerId,
      controllerPlayerId: ownerPlayerId,
      zone,
      ...extra,
    });
  }
  legal(state: GameState, actingPlayerId: string): LegalAction[] {
    return getLegalActions({ state, actingPlayerId, ...this.lookups });
  }
  apply(state: GameState, action: LegalAction): GameState {
    return applyLegalAction({ state, action, ...this.lookups }).state;
  }
  find(
    state: GameState,
    actingPlayerId: string,
    predicate: (action: LegalAction) => boolean,
    what: string
  ): LegalAction {
    const action = this.legal(state, actingPlayerId).find(predicate);
    if (!action)
      throw new Error(`scenario: ${actingPlayerId} の ${what} がありません`);
    return action;
  }
}

/** 攻撃フラッシュ窓 (`before_block`)。attacker は active 側の疲労スピリット。 */
function withAttackFlashWindow(
  state: GameState,
  attackerId: string,
  activePlayerId: string,
  priorityPlayerId: string
): GameState {
  const base: GameState = {
    ...state,
    step: "attack",
    window: "flash_before_block",
    activePlayerId,
    turnNumber: 3,
    battleEntities: [
      {
        entityId: "usage-attack-entity",
        memberInstanceIds: [attackerId],
        resolvedBp: 3000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
    ],
  };
  return {
    ...base,
    activeAttack: {
      ...createActiveAttack(base, "usage-attack-entity", activePlayerId),
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: activePlayerId,
        pendingStackAction: null,
      },
    },
  };
}

function buildDivine(ctx: ScenarioContext): GameState {
  const nexus = (id: string, owner: string) =>
    ctx.card("BSAZ02-X04", id, owner, "field", { normalCoreCount: 4 });
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: ["alice", "bob"].map(() => ({
      reserveNormalCoreCount: 4,
      trashNormalCoreCount: 3,
      lifeNormalCoreCount: 5,
    })),
    cardInstances: [
      ctx.card("BSDB01-C05", "usage-attacker", "alice", "field", {
        normalCoreCount: 1,
        exhaustState: "exhausted",
      }),
      nexus("alice-x04-1", "alice"),
      nexus("alice-x04-2", "alice"),
      nexus("bob-x04-1", "bob"),
    ],
  });
  return withAttackFlashWindow(state, "usage-attacker", "alice", "alice");
}

function buildAdvent(ctx: ScenarioContext): GameState {
  const host = (id: string, owner: string) =>
    ctx.card("BSDB01-CX01", id, owner, "field", { normalCoreCount: 1 });
  const advent = (id: string, owner: string) =>
    ctx.card("BSDB01-C03", id, owner, "hand");
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      ctx.card("BSDB01-C05", "usage-attacker", "alice", "field", {
        normalCoreCount: 1,
        exhaustState: "exhausted",
      }),
      host("alice-host", "alice"),
      host("bob-host", "bob"),
      advent("alice-goku", "alice"),
      advent("bob-goku", "bob"),
    ],
    playerOverrides: [
      {
        handCount: 1,
        soulCoreLocation: { kind: "reserve" },
        reserveNormalCoreCount: 2,
        contractCardNo: "BSDB01-CX01",
        countValue: 0,
      },
      {
        // Bob は実ソウルコアが無く、擬制(許可元の常時効果)だけが宣言手段になる。
        handCount: 1,
        soulCoreLocation: { kind: "trash" },
        reserveNormalCoreCount: 2,
        contractCardNo: "BSDB01-CX01",
        countValue: 0,
      },
    ],
  });
  return withAttackFlashWindow(state, "usage-attacker", "alice", "alice");
}

/** フォーオブアカインド (BSTH01-X04 effects[1]) を宣言する盤面の共通部分。 */
function flandreBoard(
  ctx: ScenarioContext,
  hosts: Array<{ id: string; owner: string }>
): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { reserveNormalCoreCount: 3, deckCount: 6, handCount: 0 },
        { reserveNormalCoreCount: 3, deckCount: 6, handCount: 0 },
      ],
      cardInstances: [
        ...hosts.map((host) =>
          ctx.card("BSTH01-X04", host.id, host.owner, "field", {
            normalCoreCount: 3,
          })
        ),
        ...["alice", "bob"].flatMap((owner) =>
          Array.from({ length: 6 }, (_, i) =>
            ctx.card("BSTH01-C01", `${owner}-deck-${i}`, owner, "deck")
          )
        ),
      ],
    }),
    step: "main",
    turnNumber: 3,
    activePlayerId: "alice",
  };
}

/** BSTH01-X04 のフォーオブアカインド (effects[1])。 */
const FOUR_OF_A_KIND = (action: LegalAction, hostId: string) =>
  action.kind === "use_field_card_effect" &&
  action.sourceInstanceId === hostId &&
  action.registrationIndex === 1;

function buildCancel(
  ctx: ScenarioContext,
  stage: string,
  restored: boolean
): GameState {
  let state = flandreBoard(ctx, [{ id: "flandre", owner: "alice" }]);
  // stage=ready: 宣言前 (GUI/REST で宣言する)。stage=pending(既定): 宣言→Bob のパス後の選択待ち。
  if (stage === "ready") return state;
  // 実際の宣言→Bob のパス→コア配分(player_choice)の選択待ち、までを実エンジンで進める。
  state = ctx.apply(
    state,
    ctx.find(
      state,
      "alice",
      (a) => FOUR_OF_A_KIND(a, "flandre"),
      "フォーオブアカインド"
    )
  );
  state = ctx.apply(
    state,
    ctx.find(state, "bob", (a) => a.kind === "pass_stack", "pass_stack")
  );
  if (!state.pendingCoreDistribution)
    throw new Error("scenario: コア配分の選択待ちに到達していません");
  return restored ? saveAndRestore(ctx, state) : state;
}

/** 実際の保存/読込と同じ snapshot の直列化・parse (版付き migration)・restore を通す。 */
function saveAndRestore(ctx: ScenarioContext, state: GameState): GameState {
  const saved = JSON.parse(JSON.stringify(createGameSnapshot(state)));
  const parsed = parseGameSnapshot(saved, {
    getCardDefinitionById: ctx.lookups.getCardDefinitionById,
  });
  if (!parsed.ok)
    throw new Error(`scenario: snapshot を読めません: ${parsed.error}`);
  return restoreSnapshot(parsed.snapshot, ctx.lookups.getCardDefinitionById, {
    getRegisteredTriggeredEffectActions:
      ctx.lookups.getRegisteredTriggeredEffectActions,
  }).state;
}

function buildOptional(ctx: ScenarioContext, restored: boolean): GameState {
  // 配置時の任意効果: カウント+2 (任意) → 影/プレイヤーの手札1枚を破棄することで2枚ドロー。
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { reserveNormalCoreCount: 8, deckCount: 4, handCount: 3 },
        { reserveNormalCoreCount: 8, deckCount: 4, handCount: 0 },
      ],
      cardInstances: [
        ctx.card("BSSL01-C04", "penalty-area", "alice", "hand"),
        ctx.card("BSSL01-C01", "shadow-1", "alice", "hand"),
        ctx.card("BSSL01-C01", "shadow-2", "alice", "hand"),
        ...Array.from({ length: 4 }, (_, i) =>
          ctx.card("BSSL01-C01", `draw-${i}`, "alice", "deck")
        ),
      ],
    }),
    step: "main",
    turnNumber: 3,
    activePlayerId: "alice",
  };
  const place = ctx.find(
    state,
    "alice",
    (a) => a.kind === "place_nexus",
    "place_nexus"
  );
  state = applyLegalAction({
    state,
    action: place,
    paymentSources: [{ kind: "reserve", amount: 3 }],
    ...ctx.lookups,
  }).state;
  // 配置のスタック窓/コア配置の待ちを閉じ、誘発の発揮/辞退待ちまで進める。
  for (let i = 0; i < 12; i++) {
    const next = (["alice", "bob"] as const)
      .flatMap((id) => ctx.legal(state, id))
      .find(
        (a) =>
          a.kind === "pass_stack" ||
          a.kind === "pass_pre_declaration_stack" ||
          a.kind === "resolve_pending_burst_check" ||
          a.kind === "resolve_pending_enter_field_placement"
      );
    if (!next) break;
    state = applyLegalAction({
      state,
      action: next,
      ...(next.kind === "resolve_pending_enter_field_placement"
        ? { enterFieldCorePlacements: [] }
        : {}),
      ...ctx.lookups,
    }).state;
  }
  if (!state.pendingTriggeredEffects.some((p) => p.actingPlayerId === "alice"))
    throw new Error("scenario: 配置時の誘発待ちに到達していません");
  return restored ? saveAndRestore(ctx, state) : state;
}

function buildExtraTurn(ctx: ScenarioContext): GameState {
  // flandre-1 は追加ターンの前 (元のターン) に使用済み。flandre-2 は未使用。
  let state = flandreBoard(ctx, [
    { id: "flandre-1", owner: "alice" },
    { id: "flandre-2", owner: "alice" },
  ]);
  const flandre = ctx.def("BSTH01-X04");
  const used = flandre.effects![1]!;
  state = recordEffectUsageIfLimited({
    state,
    playerId: "alice",
    sourceInstanceId: "flandre-1",
    sourceDefinitionId: flandre.cardNo,
    getCardDefinitionById: ctx.lookups.getCardDefinitionById,
    effectLabel: "spirit:1",
    usageLimit: used.usageLimit,
  });
  // 攻撃ステップ中に追加ターン(中断→復帰)が付与された直後。元の攻撃ステップへ復帰する。
  state = { ...state, step: "attack", window: "none" };
  return executeGrantExtraTurn(
    state,
    "alice",
    {
      kind: "grant_extra_turn",
      returnPoint: "previous_attack_battle",
      skipSteps: ["core", "attack"],
    },
    ctx.lookups
  );
}

function buildPublic(ctx: ScenarioContext): GameState {
  // Bob が今ターン、裏向きの BSTH01-X04 (相手・観戦者には定義が見えない) の効果を使用済みにしている。
  // この使用枠 (定義ID・カード名を含む) は、相手・観戦者の応答に現れてはならない。
  let state = flandreBoard(ctx, [{ id: "bob-flandre", owner: "bob" }]);
  state = {
    ...state,
    activePlayerId: "bob",
    turnNumber: 4,
    cardInstances: state.cardInstances.map((card) =>
      card.instanceId === "bob-flandre" ? { ...card, faceDown: true } : card
    ),
  };
  const flandre = ctx.def("BSTH01-X04");
  state = recordEffectUsageIfLimited({
    state,
    playerId: "bob",
    sourceInstanceId: "bob-flandre",
    sourceDefinitionId: flandre.cardNo,
    getCardDefinitionById: ctx.lookups.getCardDefinitionById,
    effectLabel: "spirit:1",
    usageLimit: flandre.effects![1]!.usageLimit,
  });
  // ミラージュ免除(BSTH002-C01)は現在の公開情報量を維持する: Bob が今ターン使用済み。
  return consumeMirageSetCountExemption({
    state,
    playerId: "bob",
    cardNo: "BSTH002-C01",
  });
}
