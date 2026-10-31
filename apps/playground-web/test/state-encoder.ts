/**
 * 状態エンコーダ (DL 対戦 AI 用)。設計: 20_design/14_dl-ai-architecture.md
 *
 * GameState を視点プレイヤー相対の固定長特徴へ符号化する。
 *  - global: ゲーム全体の scalar 特徴 (手番/ステップ/窓/コア/枚数/フラグ)
 *  - tokens: 可視カード 1 枚 = 1 トークン (cardNo 埋め込み index + 数値特徴)
 *
 * カード identity は「埋め込み index + 明示特徴 併用」。隠れカードは UNK(0) + maskIdentity フラグ。
 * 隠れ情報マスクは ISMCTS の determinization 境界と一致させる (同ドキュメント 2b)。
 */
import {
  getEffectiveLevel,
  getEffectiveBp,
  CARD_COLORS,
  type CardColor,
  type CardDefinition,
  type CardInstance,
  type GameState,
  type Zone,
  type Step,
  type Window,
  type ExhaustState,
} from "@orica/rules-core";
import { ALL_CARDS } from "@orica/card-data";

// ---- 列挙の順序定義 (one-hot/ multi-hot のインデックス正源) ----
const ZONES: readonly Zone[] = [
  "deck",
  "hand",
  "revealed",
  "set_aside",
  "burst",
  "field",
  "trash",
  "life",
  "reserve",
  "void",
  "in_use",
  "mirage",
  "count_area",
];
const STEPS: readonly Step[] = [
  "start",
  "core",
  "draw",
  "refresh",
  "main",
  "attack",
  "end",
];
const WINDOWS: readonly Window[] = [
  "none",
  "stack",
  "step_start",
  "declare_attack",
  "pre_declaration_stack",
  "flash_before_block",
  "stack_before_block",
  "declare_block",
  "flash_after_block",
  "stack_after_block",
  "battle_resolution",
  "step_end",
  "end_step_effects",
  "end_step_cleanup",
];
const SYMBOL_COLORS: readonly string[] = [
  ...CARD_COLORS,
  "god",
  "guide",
  "ultimate_symbol",
  "seven",
  "six",
];
const CATEGORIES: readonly string[] = [
  "spirit",
  "brave",
  "ultimate",
  "nexus",
  "magic",
];
const EXHAUST: readonly ExhaustState[] = [
  "recovered",
  "exhausted",
  "heavily_exhausted",
];
const LEAVE_KINDS: readonly string[] = ["destroy", "vanish", "bounce"];

// ---- 語彙 (ALL_CARDS から決定論的に構築) ----
const cards = ALL_CARDS as CardDefinition[];
/** cardNo → 埋め込み index。0 は UNK (隠れ/未知)。 */
export const CARD_VOCAB: ReadonlyMap<string, number> = new Map(
  [...new Set(cards.map((c) => c.cardNo))]
    .sort()
    .map((cardNo, i) => [cardNo, i + 1])
);
export const CARD_VOCAB_SIZE = CARD_VOCAB.size + 1; // +1 = UNK

/** keywordTag → index。明示特徴 multi-hot 用。 */
const TAG_LIST: readonly string[] = [
  ...new Set(cards.flatMap((c) => c.keywordTags ?? [])),
].sort();
const TAG_INDEX = new Map(TAG_LIST.map((t, i) => [t, i]));

// ---- helpers ----
function oneHot(value: unknown, domain: readonly unknown[]): number[] {
  return domain.map((d) => (d === value ? 1 : 0));
}
function multiHot(
  values: readonly unknown[],
  domain: readonly unknown[]
): number[] {
  const set = new Set(values);
  return domain.map((d) => (set.has(d) ? 1 : 0));
}

export interface CardToken {
  /** CARD_VOCAB の index (隠れカードは 0=UNK)。埋め込みテーブル参照用。 */
  embIndex: number;
  /** 数値特徴ベクトル (TOKEN_FEAT_DIM 次元)。 */
  feats: number[];
}
export interface EncodedState {
  global: number[];
  tokens: CardToken[];
  /** tokens と並行する instanceId 列 (行動の source/target をトークン位置へ紐付ける用)。 */
  tokenInstanceIds: string[];
}

/** 視点プレイヤーから見たカードの可視性。 */
function visibility(
  card: CardInstance,
  me: string
): { tokenize: boolean; mask: boolean } {
  const mine = card.ownerPlayerId === me;
  switch (card.zone) {
    case "field":
    case "trash":
      // 公開ゾーン。相手の裏向きフィールドカードのみ identity を隠す。
      return { tokenize: true, mask: !mine && card.faceDown };
    case "revealed":
    case "in_use":
      return { tokenize: true, mask: false };
    case "hand":
    case "set_aside":
    case "count_area":
      // 自分のみ identity 可視。相手のは global count に委ね、トークン化しない。
      return { tokenize: mine, mask: false };
    case "burst":
    case "mirage":
      // 伏せ。自分のは可視、相手のは「存在は既知/中身は隠す」masked token。
      return { tokenize: true, mask: !mine };
    default:
      // deck / life / reserve / void: global count に委ねる。
      return { tokenize: false, mask: false };
  }
}

function encodeCardToken(
  state: GameState,
  card: CardInstance,
  me: string,
  mask: boolean,
  getDef: (id: string) => CardDefinition | undefined
): CardToken {
  const def = getDef(card.definitionId);
  // --- identity / 明示静的特徴 (masked のときは印字情報も隠す) ---
  const embIndex = mask ? 0 : (CARD_VOCAB.get(def?.cardNo ?? "") ?? 0);
  const colors = mask ? [] : (def?.colors ?? []);
  const symbols = mask ? [] : (def?.symbolColors ?? []);
  const category = mask ? "" : (def?.printedCategory ?? "");
  const tags = mask ? [] : (def?.keywordTags ?? []);
  const cost = mask ? 0 : (def?.cost ?? 0);
  const bpByLevel = [0, 0, 0];
  if (!mask && def?.levelDefs) {
    for (const ld of def.levelDefs) {
      if (ld.level >= 1 && ld.level <= 3) bpByLevel[ld.level - 1] = ld.bp ?? 0;
    }
  }

  // --- 動的 instance 特徴 ---
  let effLevel = 0;
  let effBp = 0;
  if (card.zone === "field") {
    try {
      effLevel = getEffectiveLevel(state, card, def, getDef);
      effBp = getEffectiveBp(state, card, def, getDef);
    } catch {
      effLevel = 0;
      effBp = 0;
    }
  }
  const player = state.players.find((p) => p.id === card.ownerPlayerId);
  const hasSoulCore =
    player?.soulCoreLocation?.kind === "card" &&
    player.soulCoreLocation.instanceId === card.instanceId;

  const tagVec = new Array(TAG_LIST.length).fill(0);
  for (const t of tags) {
    const i = TAG_INDEX.get(t);
    if (i !== undefined) tagVec[i] = 1;
  }

  const feats: number[] = [
    // 静的
    cost / 12,
    ...multiHot(colors as CardColor[], CARD_COLORS),
    ...multiHot(symbols, SYMBOL_COLORS),
    ...oneHot(category, CATEGORIES),
    bpByLevel[0]! / 30000,
    bpByLevel[1]! / 30000,
    bpByLevel[2]! / 30000,
    // 動的
    ...oneHot(card.zone, ZONES),
    card.ownerPlayerId === me ? 1 : 0,
    card.controllerPlayerId === me ? 1 : 0,
    (card.normalCoreCount ?? 0) / 10,
    effLevel / 3,
    effBp / 30000,
    ...oneHot(card.exhaustState, EXHAUST),
    card.faceDown ? 1 : 0,
    card.attachedToInstanceId ? 1 : 0,
    (card.attachedChildrenIds?.length ?? 0) > 0 ? 1 : 0,
    (card.adventSourceCardIds?.length ?? 0) / 5,
    ...oneHot(card.pendingLeaveKind, LEAVE_KINDS),
    hasSoulCore ? 1 : 0,
    mask ? 1 : 0,
    // ...tags は末尾に (可変長 vocab)
    ...tagVec,
  ];
  return { embIndex, feats };
}

/** いずれかの pending がアクティブか (micro-state one-hot)。 */
function pendingFlags(state: GameState): number[] {
  return [
    state.pendingEnterFieldPlacement ? 1 : 0,
    state.pendingEffectTargetSelection ? 1 : 0,
    state.pendingDeckReveal ? 1 : 0,
    state.pendingZoneSelection ? 1 : 0,
    state.pendingCoreShootSelection ? 1 : 0,
    state.pendingBraveCombineChoice ? 1 : 0,
    state.pendingTriggeredEffects.length > 0 ? 1 : 0,
    state.pendingBurstChecks.length > 0 ? 1 : 0,
    state.battleImmediateEffects.length > 0 ? 1 : 0,
  ];
}

function playerScalars(state: GameState, id: string): number[] {
  const p = state.players.find((pl) => pl.id === id);
  if (!p) return new Array(8).fill(0);
  const soulLoc =
    p.soulCoreLocation == null
      ? 0
      : p.soulCoreLocation.kind === "card"
        ? 1
        : p.soulCoreLocation.kind === "reserve"
          ? 2
          : 3; // trash 等
  return [
    p.lifeNormalCoreCount / 5,
    p.reserveNormalCoreCount / 15,
    p.trashNormalCoreCount / 15,
    p.voidNormalCoreCount / 15,
    p.deckCount / 40,
    p.handCount / 10,
    soulLoc / 3,
    p.countValue / 10,
  ];
}

export function encodeState(
  state: GameState,
  perspectivePlayerId: string,
  getDef: (id: string) => CardDefinition | undefined
): EncodedState {
  const me = perspectivePlayerId;
  const opp = state.playerOrder.find((p) => p !== me) ?? me;

  const global: number[] = [
    state.turnNumber / 20,
    state.activePlayerId === me ? 1 : 0,
    ...oneHot(state.step, STEPS),
    ...oneHot(state.window, WINDOWS),
    ...playerScalars(state, me),
    ...playerScalars(state, opp),
    state.activeAttack ? 1 : 0,
    state.stackWindow ? 1 : 0,
    state.stackWindow?.priorityPlayerId === me ? 1 : 0,
    state.setBurstStates.filter((b) => b.playerId === me).length / 5,
    state.setBurstStates.filter((b) => b.playerId === opp).length / 5,
    state.mirageSetStates.filter((m) => m.playerId === me).length,
    state.mirageSetStates.filter((m) => m.playerId === opp).length,
    state.burstSetPlayerIdsThisTurn.includes(me) ? 1 : 0,
    state.mirageSetPlayerIdsThisTurn.includes(me) ? 1 : 0,
    state.usedDivineSkillKeysThisTurn.length / 5,
    ...pendingFlags(state),
  ];

  const tokens: CardToken[] = [];
  const tokenInstanceIds: string[] = [];
  for (const card of state.cardInstances) {
    const vis = visibility(card, me);
    if (!vis.tokenize) continue;
    tokens.push(encodeCardToken(state, card, me, vis.mask, getDef));
    tokenInstanceIds.push(card.instanceId);
  }

  return { global, tokens, tokenInstanceIds };
}

// ---- 次元定数 (NN 入力 shape 確認用) ----
export const GLOBAL_DIM =
  1 + // turn
  1 + // is-my-turn
  STEPS.length +
  WINDOWS.length +
  8 + // me scalars
  8 + // opp scalars
  3 + // attack/stack/priority
  2 + // burst counts
  2 + // mirage counts
  2 + // set-this-turn flags
  1 + // divine skill
  9; // pending flags
export const TOKEN_FEAT_DIM =
  1 + // cost
  CARD_COLORS.length +
  SYMBOL_COLORS.length +
  CATEGORIES.length +
  3 + // bp by level
  ZONES.length +
  2 + // owner/controller
  1 + // cores
  1 + // effLevel
  1 + // effBp
  EXHAUST.length +
  1 + // faceDown
  2 + // attached/children
  1 + // advent
  LEAVE_KINDS.length +
  1 + // soul core
  1 + // mask flag
  TAG_LIST.length;
export const TAG_COUNT = TAG_LIST.length;
