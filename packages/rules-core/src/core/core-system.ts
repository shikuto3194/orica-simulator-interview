import { replaceCardInstances } from "../zone/card-instance-state";
import { recordHandEntries } from "../zone/hand-increase";
import { resetCardBattleStatus } from "../card/card-state-reset";
import { advanceDepartedFieldInstanceGeneration } from "../effect/effect-usage-lifecycle";
import { isCardRecoveryRestricted } from "../effect/recovery-restriction";
import { synchronizeBraveExhaustion } from "../mechanics/brave-spirit-state-recovery";
import type { CardFilter } from "../dsl-types";
import type {
  CardDefinition,
  CardInstance,
  CardZone,
  GameState,
  LifeCoreDestination,
  LifeCoreKind,
  LifeCoreMoveEffectKind,
  LeaveFieldCoreDestinationOverride,
  LeaveFieldNormalCoreDestination,
  LeaveFieldSoulCoreDestination,
  EffectPreventionLevel,
  NormalCoreContainer,
  PendingLifeDamageDiscardChoice,
  PendingLifeDamageDiscardEntry,
  PendingLifeDamageTurnCapConsumption,
  PlayerScopedSoulCoreLocation,
  PlayerState,
  SoulCoreContainer,
  Zone,
} from "../model";
import {
  isCardTextCardState,
  requireCardZone,
  hasForcedCoreVoidRedirect,
  hasEnterFieldOnlyCorePlacementRestriction,
} from "../model";
import { getCEsForTarget, isTimingScopeActive } from "../card/ce-lookup";
import { canUseEffectByUsageLimit } from "../legal/legal-actions-shared";

function isSameNormalCoreContainer(
  a: NormalCoreContainer,
  b: NormalCoreContainer
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "card") {
    return (
      a.instanceId ===
      (b as Extract<NormalCoreContainer, { kind: "card" }>).instanceId
    );
  }
  return (
    (a as Exclude<NormalCoreContainer, { kind: "card" }>).playerId ===
    (b as Exclude<NormalCoreContainer, { kind: "card" }>).playerId
  );
}

function isSameSoulCoreContainer(
  a: SoulCoreContainer,
  b: SoulCoreContainer
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "card") {
    return (
      a.instanceId ===
      (b as Extract<SoulCoreContainer, { kind: "card" }>).instanceId
    );
  }
  if (a.kind === "removed_from_game") return true;
  return (
    (a as Extract<SoulCoreContainer, { playerId: string }>).playerId ===
    (b as Extract<SoulCoreContainer, { playerId: string }>).playerId
  );
}

function assertPositiveCoreAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`Core amount must be a positive integer: ${amount}`);
  }
}

function getPlayerIndexOrThrow(state: GameState, playerId: string): number {
  const playerIndex = state.players.findIndex(
    (player) => player.id === playerId
  );

  if (playerIndex === -1) {
    throw new Error(`Unknown player: ${playerId}`);
  }

  return playerIndex;
}

function getCardIndexOrThrow(state: GameState, instanceId: string): number {
  const cardIndex = state.cardInstances.findIndex(
    (cardInstance) => cardInstance.instanceId === instanceId
  );

  if (cardIndex === -1) {
    throw new Error(`Unknown card instance: ${instanceId}`);
  }

  return cardIndex;
}

function updatePlayerAtIndex(
  state: GameState,
  playerIndex: number,
  update: (player: PlayerState) => PlayerState
): GameState {
  const player = state.players[playerIndex];

  if (!player) {
    throw new Error(`Unknown player index: ${playerIndex}`);
  }

  const players = [...state.players];
  players[playerIndex] = update(player);

  return {
    ...state,
    players,
  };
}

function updateCardAtIndex(
  state: GameState,
  cardIndex: number,
  update: (card: CardInstance) => CardInstance
): GameState {
  const card = state.cardInstances[cardIndex];

  if (!card) {
    throw new Error(`Unknown card index: ${cardIndex}`);
  }

  const cardInstances = [...state.cardInstances];
  cardInstances[cardIndex] = update(card);

  return replaceCardInstances(
    {
      ...state,
    },
    cardInstances
  );
}

function normalizeSoulCoreLocation(
  playerId: string,
  location: SoulCoreContainer
): PlayerScopedSoulCoreLocation {
  switch (location.kind) {
    case "card":
      return {
        kind: "card",
        instanceId: location.instanceId,
      };
    case "reserve":
    case "trash":
    case "life":
      if (location.playerId !== playerId) {
        throw new Error(
          `Soul core location belongs to a different player: owner=${playerId} locationPlayer=${location.playerId}`
        );
      }

      return {
        kind: location.kind,
      };
    case "void":
      throw new Error("Soul core cannot be placed in void");
    case "removed_from_game":
      return {
        kind: location.kind,
      };
  }
}

function resolveLeaveFieldSoulCoreDestinationForPlayer(
  destination: LeaveFieldSoulCoreDestination,
  playerId: string
): SoulCoreContainer {
  switch (destination.kind) {
    case "reserve":
      return { kind: "reserve", playerId };
    case "trash":
      return { kind: "trash", playerId };
    case "void":
      return { kind: "void", playerId };
    case "removed_from_game":
      return destination;
  }
}

/**
 * playerId 本人のソウルコアが location にあるか。P3-101 S2: reserve/trash/life は
 * 本人スコープの player.*SoulCoreCount (S1 新設フィールド) を SSOT として判定する。
 * card はカードが両プレイヤーから共有され得るため (soulCoreCount は player 非帰属の
 * 合算値)、本人所有かどうかを一意に判定できるのは player.soulCoreLocation のみ
 * (ownership は依然こちらが正源)。void は硬制約で常に false、removed_from_game は
 * S1 で専用カウントフィールドを新設していない (実カード0件の未使用経路) ため
 * player.soulCoreLocation を fallback として使う。
 */
function soulCoreLocationMatches(
  playerId: string,
  player: PlayerState,
  location: SoulCoreContainer
): boolean {
  switch (location.kind) {
    case "card":
      return (
        player.soulCoreLocation?.kind === "card" &&
        player.soulCoreLocation.instanceId === location.instanceId
      );
    case "reserve":
      return location.playerId === playerId && player.reserveSoulCoreCount > 0;
    case "trash":
      return location.playerId === playerId && player.trashSoulCoreCount > 0;
    case "life":
      return location.playerId === playerId && player.lifeSoulCoreCount > 0;
    case "void":
      return false;
    case "removed_from_game":
      return player.soulCoreLocation?.kind === "removed_from_game";
  }
}

function canMoveSoulCoreFrom(
  state: GameState,
  playerId: string,
  player: PlayerState,
  location: SoulCoreContainer
): boolean {
  if (soulCoreLocationMatches(playerId, player, location)) return true;

  if (location.kind === "card") {
    const card = state.cardInstances.find(
      (c) => c.instanceId === location.instanceId
    );
    return (
      card !== undefined &&
      card.controllerPlayerId === playerId &&
      card.soulCoreCount > 0
    );
  }

  return false;
}

/**
 * P3-101 S2: ロケーション別ソウルコア数の読み取り (playerScope は container 側に
 * 内包)。card は player 非帰属の合算値 (通常は 0/1、同一カードへの複数ソウル参照は
 * invariant で禁止されている)。removed_from_game は S1 でカウントフィールド未新設の
 * ため player.soulCoreLocation から導出する (実カード0件、dual-write の対象外)。
 */
function getSoulCoreCountAtLocation(
  state: GameState,
  location: SoulCoreContainer
): number {
  switch (location.kind) {
    case "card": {
      const card = state.cardInstances.find(
        (c) => c.instanceId === location.instanceId
      );
      return card?.soulCoreCount ?? 0;
    }
    case "reserve": {
      const playerIndex = getPlayerIndexOrThrow(state, location.playerId);
      return state.players[playerIndex]?.reserveSoulCoreCount ?? 0;
    }
    case "trash": {
      const playerIndex = getPlayerIndexOrThrow(state, location.playerId);
      return state.players[playerIndex]?.trashSoulCoreCount ?? 0;
    }
    case "life": {
      const playerIndex = getPlayerIndexOrThrow(state, location.playerId);
      return state.players[playerIndex]?.lifeSoulCoreCount ?? 0;
    }
    case "void":
      return 0;
    case "removed_from_game":
      return state.players.some(
        (p) => p.soulCoreLocation?.kind === "removed_from_game"
      )
        ? 1
        : 0;
  }
}

/**
 * P3-101 S2: ロケーション別ソウルコア数の書き込み。moveSoulCore の dual-write
 * (旧 soulCoreLocation 単一フィールド + 新カウントフィールド) の新側担当。
 * removed_from_game は S1 でカウントフィールド未新設のため no-op
 * (旧 soulCoreLocation の書き込みのみで表現される)。
 */
function updateSoulCoreCountAtLocation(
  state: GameState,
  location: SoulCoreContainer,
  nextAmount: number
): GameState {
  if (!Number.isInteger(nextAmount) || nextAmount < 0) {
    throw new Error(`Soul core count cannot be negative: ${nextAmount}`);
  }

  switch (location.kind) {
    case "card": {
      const cardIndex = getCardIndexOrThrow(state, location.instanceId);

      return updateCardAtIndex(state, cardIndex, (card) => ({
        ...card,
        soulCoreCount: nextAmount,
        // 一方向ラッチ (engine-bsth02-c21-cumulative-core-cost-fix)。normalCoreCount 側と同型。
        everHadCorePlaced:
          card.everHadCorePlaced || nextAmount > card.soulCoreCount,
      }));
    }
    case "reserve": {
      const playerIndex = getPlayerIndexOrThrow(state, location.playerId);

      return updatePlayerAtIndex(state, playerIndex, (player) => ({
        ...player,
        reserveSoulCoreCount: nextAmount,
      }));
    }
    case "trash": {
      const playerIndex = getPlayerIndexOrThrow(state, location.playerId);

      return updatePlayerAtIndex(state, playerIndex, (player) => ({
        ...player,
        trashSoulCoreCount: nextAmount,
      }));
    }
    case "life": {
      const playerIndex = getPlayerIndexOrThrow(state, location.playerId);

      return updatePlayerAtIndex(state, playerIndex, (player) => ({
        ...player,
        lifeSoulCoreCount: nextAmount,
      }));
    }
    case "void":
      throw new Error("Soul core count cannot be tracked at void");
    case "removed_from_game":
      return state;
  }
}

export function getNormalCoreCountAtLocation(
  state: GameState,
  location: NormalCoreContainer
): number {
  switch (location.kind) {
    case "card": {
      const cardIndex = getCardIndexOrThrow(state, location.instanceId);
      const card = state.cardInstances[cardIndex];

      if (!card) {
        throw new Error(`Unknown card instance: ${location.instanceId}`);
      }

      return card.normalCoreCount;
    }
    case "reserve": {
      const playerIndex = getPlayerIndexOrThrow(state, location.playerId);
      const player = state.players[playerIndex];

      if (!player) {
        throw new Error(`Unknown player: ${location.playerId}`);
      }

      return player.reserveNormalCoreCount;
    }
    case "trash": {
      const playerIndex = getPlayerIndexOrThrow(state, location.playerId);
      const player = state.players[playerIndex];

      if (!player) {
        throw new Error(`Unknown player: ${location.playerId}`);
      }

      return player.trashNormalCoreCount;
    }
    case "life": {
      const playerIndex = getPlayerIndexOrThrow(state, location.playerId);
      const player = state.players[playerIndex];

      if (!player) {
        throw new Error(`Unknown player: ${location.playerId}`);
      }

      return player.lifeNormalCoreCount;
    }
    case "void": {
      const playerIndex = getPlayerIndexOrThrow(state, location.playerId);
      const player = state.players[playerIndex];
      if (!player) {
        throw new Error(`Unknown player: ${location.playerId}`);
      }
      return player.voidNormalCoreCount;
    }
  }
}

export function updateNormalCoreCountAtLocation(
  state: GameState,
  location: NormalCoreContainer,
  nextAmount: number
): GameState {
  if (!Number.isInteger(nextAmount) || nextAmount < 0) {
    throw new Error(`Normal core count cannot be negative: ${nextAmount}`);
  }

  switch (location.kind) {
    case "card": {
      const cardIndex = getCardIndexOrThrow(state, location.instanceId);

      return updateCardAtIndex(state, cardIndex, (card) => ({
        ...card,
        normalCoreCount: nextAmount,
        // 一方向ラッチ (engine-bsth02-c21-cumulative-core-cost-fix)。増加時のみ立て、
        // 減少/0でも false へは戻さない。
        everHadCorePlaced:
          card.everHadCorePlaced || nextAmount > card.normalCoreCount,
      }));
    }
    case "reserve": {
      const playerIndex = getPlayerIndexOrThrow(state, location.playerId);

      return updatePlayerAtIndex(state, playerIndex, (player) => ({
        ...player,
        reserveNormalCoreCount: nextAmount,
      }));
    }
    case "trash": {
      const playerIndex = getPlayerIndexOrThrow(state, location.playerId);

      return updatePlayerAtIndex(state, playerIndex, (player) => ({
        ...player,
        trashNormalCoreCount: nextAmount,
      }));
    }
    case "life": {
      const playerIndex = getPlayerIndexOrThrow(state, location.playerId);

      return updatePlayerAtIndex(state, playerIndex, (player) => ({
        ...player,
        lifeNormalCoreCount: nextAmount,
      }));
    }
    case "void": {
      const playerIndex = getPlayerIndexOrThrow(state, location.playerId);
      return updatePlayerAtIndex(state, playerIndex, (player) => ({
        ...player,
        voidNormalCoreCount: nextAmount,
      }));
    }
  }
}

/**
 * state ベースで card 上の合計コア数を返す。
 *
 * P3-101 S3 (SSOT切替): `CardInstance.soulCoreCount` (moveSoulCore /
 * withSoulCoreLocation が dual-write する新カウントフィールド) を SSOT とする。
 * S2 時点では既存テストの hand-built state 構築パターン (44件規模) が dual-write を
 * 迂回しており見送っていたが、S3-prep (2026-07-14) で全書き込み経路を
 * `withSoulCoreLocation` 経由へ統一し実測 8 件のみに縮小・是正済み。
 */
export function getTotalCoresOnCardById(
  state: GameState,
  instanceId: string
): number {
  const card = state.cardInstances.find((c) => c.instanceId === instanceId);
  if (!card) return 0;
  return card.normalCoreCount + card.soulCoreCount;
}

/** カードにソウルコアが乗っているか (CardInstance.soulCoreCount を SSOT とする)。 */
export function isSoulCoreOn(state: GameState, instanceId: string): boolean {
  const card = state.cardInstances.find((c) => c.instanceId === instanceId);
  return (card?.soulCoreCount ?? 0) > 0;
}

/**
 * 「《ソウルコア》以外のコアを取り除けない」により、対象カード上の通常コアを
 * 任意の効果・支払いの移動元として使えないかを判定する。
 *
 * フィールド離脱時にルール上強制されるコア退避は `moveNormalCores` の
 * `ignoreNormalCoreMoveRestriction` を明示して、この制限を通過させる。
 */
export function isNormalCoreMovePrevented(
  state: GameState,
  instanceId: string
): boolean {
  return getCEsForTarget(state, instanceId).some(
    (effect) => effect.modifierTag === "prevent_normal_core_move"
  );
}

/** カードに乗っているソウルコアの所有プレイヤー ID。なければ undefined。 */
export function findSoulCoreOwnerId(
  state: GameState,
  instanceId: string
): string | undefined {
  return state.players.find(
    (p) =>
      p.soulCoreLocation?.kind === "card" &&
      p.soulCoreLocation.instanceId === instanceId
  )?.id;
}

export function getPlayerLifeCoreCount(player: PlayerState): number {
  return player.lifeNormalCoreCount + player.lifeSoulCoreCount;
}

/** ライフ0・デッキ0の敗北判定で共用する、現在有効な敗北防止効果。 */
export function isPlayerImmuneToGameLoss(
  state: GameState,
  playerId: string
): boolean {
  return getCEsForTarget(state, playerId).some(
    (ce) => ce.modifierTag === "immune_to_game_loss"
  );
}

/** ライフ0はコア移動直後に確定する。誘発・バースト・フラッシュの終了を待たない。 */
export function applyLifeZeroDefeat(state: GameState): GameState {
  if (state.gameResult !== null) return state;
  const defeatedPlayerIds = state.players
    .filter((player) => getPlayerLifeCoreCount(player) === 0)
    .map((player) => player.id)
    .filter((playerId) => !isPlayerImmuneToGameLoss(state, playerId));
  if (defeatedPlayerIds.length === 0) return state;
  if (defeatedPlayerIds.length >= state.players.length) {
    return {
      ...state,
      gameResult: { kind: "draw", reason: "life_zero" },
      log: [...state.log, "game:life-zero:draw:" + defeatedPlayerIds.join(",")],
    };
  }
  const losingPlayerId = defeatedPlayerIds[0]!;
  return {
    ...state,
    gameResult: { kind: "player_loss", losingPlayerId, reason: "life_zero" },
    log: [...state.log, "game:life-zero:" + losingPlayerId],
  };
}

export function getPlayerReserveCoreCount(player: PlayerState): number {
  return player.reserveNormalCoreCount + player.reserveSoulCoreCount;
}

export function getPlayerTrashCoreCount(player: PlayerState): number {
  return player.trashNormalCoreCount + player.trashSoulCoreCount;
}

function normalizeLifeCoreChoice(
  chosenCoreKind: LifeCoreKind | null | undefined
): LifeCoreKind | null {
  return chosenCoreKind ?? null;
}

function canNormalLifeCoreMoveToDestination(
  destination: LifeCoreDestination
): boolean {
  return destination.kind !== "removed_from_game";
}

function canGenericLifeMoveUseSoulCore(
  destination: LifeCoreDestination
): boolean {
  return (
    destination.kind === "card" ||
    destination.kind === "reserve" ||
    destination.kind === "trash"
  );
}

function toNormalContainerFromLifeDestination(
  destination: LifeCoreDestination
): NormalCoreContainer {
  switch (destination.kind) {
    case "card":
      return {
        kind: "card",
        instanceId: destination.instanceId,
      };
    case "reserve":
    case "trash":
      return destination;
    case "void":
      return destination;
    case "removed_from_game":
      throw new Error("Normal cores cannot move to removed_from_game");
  }
}

function toSoulContainerFromLifeDestination(
  destination: LifeCoreDestination
): SoulCoreContainer {
  switch (destination.kind) {
    case "card":
      return {
        kind: "card",
        instanceId: destination.instanceId,
      };
    case "reserve":
    case "trash":
      return destination;
    case "void":
    case "removed_from_game":
      return destination;
  }
}

function isLifeCoreDestinationBlockedByEnterFieldOnlyPlacement(
  state: GameState,
  destination: LifeCoreDestination,
  getCardDefinitionById?:
    | ((id: string) => CardDefinition | undefined)
    | undefined
): boolean {
  if (destination.kind !== "card" || !getCardDefinitionById) return false;
  const card = state.cardInstances.find(
    (c) => c.instanceId === destination.instanceId
  );
  if (!card) return false;
  const def = getCardDefinitionById(card.definitionId);
  return !!def && hasEnterFieldOnlyCorePlacementRestriction(def);
}

export interface AvailableLifeCoreMoveChoice {
  coreKind: LifeCoreKind;
  destination: LifeCoreDestination;
}

export function getAvailableLifeCoreMoveChoices(options: {
  state: GameState;
  playerId: string;
  destination: LifeCoreDestination;
  effectKind?: LifeCoreMoveEffectKind;
  getCardDefinitionById?:
    | ((id: string) => CardDefinition | undefined)
    | undefined;
}): AvailableLifeCoreMoveChoice[] {
  const effectKind = options.effectKind ?? "generic";
  const playerIndex = getPlayerIndexOrThrow(options.state, options.playerId);
  const player = options.state.players[playerIndex];

  if (!player) {
    throw new Error(`Unknown player: ${options.playerId}`);
  }

  const choices: AvailableLifeCoreMoveChoice[] = [];
  const destinationBlockedByPlacementRestriction =
    isLifeCoreDestinationBlockedByEnterFieldOnlyPlacement(
      options.state,
      options.destination,
      options.getCardDefinitionById
    );

  if (destinationBlockedByPlacementRestriction) {
    return choices;
  }

  if (
    effectKind !== "explicit_soul_core" &&
    player.lifeNormalCoreCount > 0 &&
    canNormalLifeCoreMoveToDestination(options.destination)
  ) {
    choices.push({
      coreKind: "normal",
      destination: options.destination,
    });
  }

  if (player.soulCoreLocation?.kind !== "life") {
    return choices;
  }

  if (effectKind === "normal_only") {
    return choices;
  }

  if (
    effectKind === "explicit_soul_core" ||
    canGenericLifeMoveUseSoulCore(options.destination)
  ) {
    choices.push({
      coreKind: "soul",
      destination: options.destination,
    });
  }

  return choices;
}

export function moveLifeCoreByEffect(options: {
  state: GameState;
  playerId: string;
  destination: LifeCoreDestination;
  effectKind?: LifeCoreMoveEffectKind;
  chosenCoreKind?: LifeCoreKind | null;
  getCardDefinitionById?:
    | ((id: string) => CardDefinition | undefined)
    | undefined;
}): GameState {
  const effectKind = options.effectKind ?? "generic";
  const availableChoices = getAvailableLifeCoreMoveChoices({
    state: options.state,
    playerId: options.playerId,
    destination: options.destination,
    effectKind,
    getCardDefinitionById: options.getCardDefinitionById,
  });

  if (availableChoices.length === 0) {
    throw new Error(
      `No life core can move with this effect: player=${options.playerId} effectKind=${effectKind} destination=${JSON.stringify(
        options.destination
      )}`
    );
  }

  const normalizedChosenCoreKind = normalizeLifeCoreChoice(
    options.chosenCoreKind
  );
  const selectedChoice: AvailableLifeCoreMoveChoice | null =
    normalizedChosenCoreKind === null
      ? availableChoices.length === 1
        ? (availableChoices[0] ?? null)
        : null
      : (availableChoices.find(
          (availableChoice) =>
            availableChoice.coreKind === normalizedChosenCoreKind
        ) ?? null);

  if (selectedChoice === null) {
    throw new Error(
      `Life core choice is ambiguous or invalid: player=${options.playerId} effectKind=${effectKind} chosenCoreKind=${normalizedChosenCoreKind ?? "none"}`
    );
  }

  if (selectedChoice.coreKind === "normal") {
    return moveNormalCores(
      options.state,
      {
        kind: "life",
        playerId: options.playerId,
      },
      toNormalContainerFromLifeDestination(selectedChoice.destination),
      1,
      options.getCardDefinitionById
    );
  }

  return moveSoulCore(
    options.state,
    options.playerId,
    {
      kind: "life",
      playerId: options.playerId,
    },
    toSoulContainerFromLifeDestination(selectedChoice.destination),
    1,
    options.getCardDefinitionById
  );
}

/**
 * BSKB01-T01 等「移動するとき、ボイドに置かなければならない」トークン固有ルール
 * (`hasForcedCoreVoidRedirect`)。from が独立コア管理カードで to がまだ void でなければ、
 * そのカードの持ち主の void へ強制上書きする。`moveNormalCores` 経由の呼び出し元では
 * この choke point 1 箇所で効くため、22 箇所超ある呼び出し元ごとの重複判定は不要
 * （getCardDefinitionById 未指定の呼び出し元は従来どおり no-op、後方互換）。
 * field コアシュート (`handleFieldCoreShoot`, structured-core-move.ts) も通常コア移動は
 * moveNormalCores へ委譲するため、この choke point で同じ判定を共有する。
 */
function resolveForcedCoreVoidRedirectDestination(
  state: GameState,
  from: NormalCoreContainer,
  to: NormalCoreContainer,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): NormalCoreContainer {
  if (from.kind !== "card" || to.kind === "void" || !getCardDefinitionById) {
    return to;
  }
  const card = state.cardInstances.find(
    (c) => c.instanceId === from.instanceId
  );
  if (!card) return to;
  const def = getCardDefinitionById(card.definitionId);
  if (!def || !hasForcedCoreVoidRedirect(def)) return to;
  return { kind: "void", playerId: card.controllerPlayerId };
}

/**
 * BSKB01-T01 等「コアを、出すとき以外で置けず」トークン固有ルール
 * (`hasEnterFieldOnlyCorePlacementRestriction`)。`moveNormalCores` 経由の呼び出し元では
 * この choke point の to 側で効く。enter-field 配置経路は
 * `allowEnterFieldOnlyPlacementDestination` を opt-in して destination 制限だけを外し、
 * from 側の forced-void redirect は同じ lookup で維持する。
 * throw ではなく no-op (state 不変で呼び出し元へ返す) にする: このカードへの通常
 * コア配置は他カードの汎用 core_move 効果 (enter-field 経路以外) からも到達し得るため、
 * 「置けない」を例外でエンジンクラッシュさせず、単に効果不発 (state 不変) として扱う。
 * `didNonCardActionChangeState`("core_move", native-effect-front-helpers.ts) は pre/post の
 * players/cardInstances 差分のみを見るため、no-op で state が完全に不変なら
 * stepSucceeded=false が正しく導出され、後続 conditional_result 連鎖も誤発火しない。
 * field コアシュート (`handleFieldCoreShoot`, structured-core-move.ts) も通常コア移動は
 * moveNormalCores へ委譲するため、この to 側 choke point を共有する。
 */
function isEnterFieldOnlyPlacementBlocked(
  state: GameState,
  to: NormalCoreContainer | SoulCoreContainer,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  options: CorePlacementDestinationOptions = {}
): boolean {
  if (options.allowEnterFieldOnlyPlacementDestination === true) return false;
  if (to.kind !== "card" || !getCardDefinitionById) return false;
  const card = state.cardInstances.find((c) => c.instanceId === to.instanceId);
  if (!card) return false;
  const def = getCardDefinitionById(card.definitionId);
  return !!def && hasEnterFieldOnlyCorePlacementRestriction(def);
}

export interface CorePlacementDestinationOptions {
  /**
   * Enter-field placement is the one context where token-managed cards may
   * receive cores despite their normal destination restriction. Source-side
   * forced-void redirects still use getCardDefinitionById.
   */
  allowEnterFieldOnlyPlacementDestination?: boolean;
  /**
   * フィールド離脱時のルール上の強制コア退避だけが指定する bypass。
   * 通常の効果・コスト支払いでは指定してはならない。
   */
  ignoreNormalCoreMoveRestriction?: boolean;
}

export type MoveNormalCoresOptions = CorePlacementDestinationOptions;

export type MoveSoulCoreOptions = CorePlacementDestinationOptions;

export type GenerateSoulCoreOutsideGameOptions =
  CorePlacementDestinationOptions;

export function moveNormalCores(
  state: GameState,
  from: NormalCoreContainer,
  to: NormalCoreContainer,
  amount: number,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  options: MoveNormalCoresOptions = {}
): GameState {
  if (state.gameResult !== null) return state;
  assertPositiveCoreAmount(amount);

  if (isSameNormalCoreContainer(from, to)) {
    return state;
  }

  if (
    from.kind === "card" &&
    options.ignoreNormalCoreMoveRestriction !== true &&
    isNormalCoreMovePrevented(state, from.instanceId)
  ) {
    return state;
  }

  const resolvedTo = resolveForcedCoreVoidRedirectDestination(
    state,
    from,
    to,
    getCardDefinitionById
  );

  if (isSameNormalCoreContainer(from, resolvedTo)) {
    return state;
  }

  if (
    isEnterFieldOnlyPlacementBlocked(
      state,
      resolvedTo,
      getCardDefinitionById,
      options
    )
  ) {
    return state;
  }

  const fromAmount = getNormalCoreCountAtLocation(state, from);

  if (fromAmount < amount) {
    throw new Error(
      `Not enough normal cores at source: from=${JSON.stringify(from)} amount=${amount}`
    );
  }

  const toAmount = getNormalCoreCountAtLocation(state, resolvedTo);
  const currentState = updateNormalCoreCountAtLocation(
    state,
    from,
    fromAmount - amount
  );

  const nextState = updateNormalCoreCountAtLocation(
    currentState,
    resolvedTo,
    toAmount + amount
  );
  return from.kind === "life" ? applyLifeZeroDefeat(nextState) : nextState;
}

/**
 * P3-101 S2: 個数指定のソウルコア移動へ一般化 (moveNormalCores と対称な
 * from/to/amount 形)。既存呼び出し元は amount 省略でこれまでと同じ挙動
 * (単一ソウルコアの移動) を維持する。
 *
 * 本人所有判定は、player zone は player.*SoulCoreCount、card は primary pointer
 * (`player.soulCoreLocation`) または field controller を用いる。card 上の追加ソウルは
 * count-only で保持され得るため、primary pointer が別ロケーションを追跡していても
 * controller がそのカード上 count を移動できる。移動確定後、primary pointer が source を
 * 追跡している場合、または primary pointer が未設定の場合のみ pointer も destination へ
 * 更新し、既存 primary が別ロケーションを追跡している追加ソウル移動では pointer を温存する。
 *
 * amount>1 では新カウントフィールド側 (`fromCount`) の在庫を厳密に検証する。
 * 例外は旧テスト/保存データ互換の amount=1 かつ player.soulCoreLocation だけが source を
 * 追跡する card 状態で、この場合だけ dual-write の自己修復として 1 個移動を許す。
 */
/**
 * player.soulCoreLocation (旧 SSOT, 単一ポインタ) が指す物理ソウルが location にあるか。
 * ソウルコア複数個 (追加生成分、[[project_soul_core_future_multiple]] 裁定 2026-06-14) が
 * reserve/trash/life に同時存在し得るため、moveSoulCore はこの判定で「今動かすのが
 * ポインタの追跡対象か、それとも追加ソウルか」を区別する。追跡対象でなければポインタは
 * 書き換えない — 書き換えると card/removed_from_game 等ポインタ依存の消費箇所 (14ファイル超)
 * が誤って「元の場所からソウルが居なくなった」と誤認する (特に card 上のソウルは
 * カウントフィールドが player 非帰属の合算値のため、ポインタ以外に ownership を復元する
 * 手段が無い)。単一ソウルしか存在しない既存経路では、ownership 済みの from は常にポインタの
 * 指す場所と一致するため、本判定追加による既存挙動の変化はない。
 */
function primaryTracksSoulCoreLocation(
  playerId: string,
  soulCoreLocation: PlayerScopedSoulCoreLocation | null,
  location: SoulCoreContainer
): boolean {
  if (!soulCoreLocation) return false;

  switch (location.kind) {
    case "card":
      return (
        soulCoreLocation.kind === "card" &&
        soulCoreLocation.instanceId === location.instanceId
      );
    case "reserve":
    case "trash":
    case "life":
      return (
        soulCoreLocation.kind === location.kind &&
        location.playerId === playerId
      );
    case "void":
      return false;
    case "removed_from_game":
      return soulCoreLocation.kind === "removed_from_game";
  }
}

export function moveSoulCore(
  state: GameState,
  playerId: string,
  from: SoulCoreContainer,
  to: SoulCoreContainer,
  amount = 1,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  options: MoveSoulCoreOptions = {}
): GameState {
  if (state.gameResult !== null) return state;
  assertPositiveCoreAmount(amount);

  if (isSameSoulCoreContainer(from, to)) {
    return state;
  }

  const playerIndex = getPlayerIndexOrThrow(state, playerId);
  const player = state.players[playerIndex];

  if (!player) {
    throw new Error(`Unknown player: ${playerId}`);
  }

  if (
    isEnterFieldOnlyPlacementBlocked(state, to, getCardDefinitionById, options)
  ) {
    return state;
  }

  const primaryTracksSource = primaryTracksSoulCoreLocation(
    playerId,
    player.soulCoreLocation,
    from
  );
  const fromCount = getSoulCoreCountAtLocation(state, from);
  const canRepairLegacySinglePointerMove =
    amount === 1 && fromCount === 0 && primaryTracksSource;

  if (
    !canMoveSoulCoreFrom(state, playerId, player, from) &&
    !canRepairLegacySinglePointerMove
  ) {
    throw new Error(
      `Soul core is not at the expected source: player=${playerId} from=${JSON.stringify(
        from
      )}`
    );
  }

  if (fromCount < amount && !canRepairLegacySinglePointerMove) {
    throw new Error(
      `Not enough soul cores at source: from=${JSON.stringify(from)} amount=${amount}`
    );
  }

  const normalizedDestination = normalizeSoulCoreLocation(playerId, to);

  let nextState = state;
  if (player.soulCoreLocation === null || primaryTracksSource) {
    nextState = updatePlayerAtIndex(state, playerIndex, (currentPlayer) => ({
      ...currentPlayer,
      soulCoreLocation: normalizedDestination,
    }));
  }

  nextState = updateSoulCoreCountAtLocation(
    nextState,
    from,
    Math.max(0, fromCount - amount)
  );

  const toCount = getSoulCoreCountAtLocation(nextState, to);
  nextState = updateSoulCoreCountAtLocation(nextState, to, toCount + amount);

  return from.kind === "life" ? applyLifeZeroDefeat(nextState) : nextState;
}

/**
 * ゲーム外から新規ソウルコアを生成し reserve/trash/life/field カードに置く primitive
 * (「ゲーム外から<ソウルコア>1個を自分のリザーブに置ける」BSLH01-C05/R03、
 * 「自分のスピリット/リザーブに置く」BSLH01-X10 等)。既存ゾーンからの移動ではないため
 * moveSoulCore (from 側 ownership 検証必須) は使えず、独立の生成専用プリミティブとして
 * 新設する ([[project_soul_core_future_multiple]])。
 *
 * player.soulCoreLocation (旧 SSOT) が null (実カード0件、テスト専用の初期状態) の
 * ときのみ新規ソウルをポインタの追跡対象にする。既に別ロケーションを指している通常の
 * ゲーム中は、生成したソウルはポインタを書き換えない「追加ソウル」としてロケーション別
 * カウントのみに計上する (個体識別不要・互いに交換可能、裁定 2026-06-14)。
 *
 * `to.kind === "card"` (フィールドカード上への直接生成) は playerId 所有権チェックを
 * 行わない。`moveSoulCore` の `to` 側と同様、候補カードは呼び出し元 (
 * `collectFieldCardDestinationCandidates` 等) が既に controller/filter で絞り込んでいる
 * 前提のため (SoulCoreContainer の "card" variant は instanceId のみで playerId を持たない)。
 */
export function generateSoulCoreOutsideGame(
  state: GameState,
  playerId: string,
  to: Extract<
    SoulCoreContainer,
    { kind: "reserve" | "trash" | "life" | "card" }
  >,
  amount = 1,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  options: GenerateSoulCoreOutsideGameOptions = {}
): GameState {
  assertPositiveCoreAmount(amount);

  const playerIndex = getPlayerIndexOrThrow(state, playerId);
  const player = state.players[playerIndex];

  if (!player) {
    throw new Error(`Unknown player: ${playerId}`);
  }

  if (to.kind !== "card" && to.playerId !== playerId) {
    throw new Error(
      `Soul core generation target belongs to a different player: owner=${playerId} locationPlayer=${to.playerId}`
    );
  }

  if (
    isEnterFieldOnlyPlacementBlocked(state, to, getCardDefinitionById, options)
  ) {
    return state;
  }

  let nextState = state;

  if (player.soulCoreLocation === null) {
    nextState = updatePlayerAtIndex(nextState, playerIndex, (p) => ({
      ...p,
      soulCoreLocation: normalizeSoulCoreLocation(playerId, to),
    }));
  }

  const currentCount = getSoulCoreCountAtLocation(nextState, to);
  return updateSoulCoreCountAtLocation(nextState, to, currentCount + amount);
}

/**
 * `player.soulCoreLocation` (primary ソウルの単一ポインタ) を設定/変更する共通プリミティブ。
 * 対応するロケーション別カウントフィールド (reserveSoulCoreCount/trashSoulCoreCount/
 * lifeSoulCoreCount/CardInstance.soulCoreCount) を同時に同期する。
 *
 * 名称は P3-101 S3-prep 時点の「テスト構築補助」由来だが、実際は structured-core-move.ts /
 * structured-soul-state.ts / state-based-actions.ts / advent-system.ts / pending-action-handlers.ts /
 * effect-target-handlers.ts (14 箇所超) が primary ソウル移動の本体として使う本番経路の
 * SSOT でもある (moveSoulCore と並ぶ二重 writer。moveSoulCore は from 側 ownership 検証必須の
 * 汎用移動、こちらは検証なしの直接設定)。generateSoulCoreOutsideGame が作る「追加ソウル」
 * (primary ポインタが指さないぶんのカウント) を破壊しないよう、カウント更新は絶対値の
 * 0/1 上書きではなく旧ロケーション-1/新ロケーション+1の差分更新にする
 * (adversarial verifier round1 指摘、[[project_soul_core_future_multiple]])。
 *
 * `createEmptyGameState({ playerOverrides: [{ soulCoreLocation: ... }] })` は construction
 * 時点でこの同期を行う (factories.ts) が、`{...state, players: state.players.map(...)}` の
 * ような post-construction spread で `soulCoreLocation` だけを書き換えるとその同期の対象外
 * になる。post-construction で場所を変える既存テストはこの関数を経由すること。
 */
export function withSoulCoreLocation(
  state: GameState,
  playerId: string,
  location: PlayerScopedSoulCoreLocation | null
): GameState {
  const playerIndex = getPlayerIndexOrThrow(state, playerId);
  const player = state.players[playerIndex];

  if (!player) {
    throw new Error(`Unknown player: ${playerId}`);
  }

  const previousLocation = player.soulCoreLocation;

  // 差分更新 (adversarial verifier round1 指摘で修正): 旧ロケーションのカウントから1減算、
  // 新ロケーションのカウントに1加算。以前は絶対値0/1で無条件上書きしており、
  // generateSoulCoreOutsideGame が作った「追加ソウル」(primary ポインタが指さないぶんの
  // カウント) を、このプライマリソウル移動関数が呼ばれるたびに静かに消失させていた
  // (14箇所超の呼び出し元は全て primary ソウルの移動用だが、カウントフィールドは
  // primary+追加ソウルの合算値のため上書きではなく差分更新が必要)。
  let nextState = updatePlayerAtIndex(state, playerIndex, (current) => {
    let reserve = current.reserveSoulCoreCount;
    let trash = current.trashSoulCoreCount;
    let life = current.lifeSoulCoreCount;

    if (previousLocation?.kind === "reserve")
      reserve = Math.max(0, reserve - 1);
    if (previousLocation?.kind === "trash") trash = Math.max(0, trash - 1);
    if (previousLocation?.kind === "life") life = Math.max(0, life - 1);

    if (location?.kind === "reserve") reserve += 1;
    if (location?.kind === "trash") trash += 1;
    if (location?.kind === "life") life += 1;

    return {
      ...current,
      soulCoreLocation: location,
      reserveSoulCoreCount: reserve,
      trashSoulCoreCount: trash,
      lifeSoulCoreCount: life,
    };
  });

  const previousCardId =
    previousLocation?.kind === "card" ? previousLocation.instanceId : null;
  const nextCardId = location?.kind === "card" ? location.instanceId : null;

  if (previousCardId !== null && previousCardId !== nextCardId) {
    const prevCardIndex = nextState.cardInstances.findIndex(
      (card) => card.instanceId === previousCardId
    );
    if (prevCardIndex !== -1) {
      nextState = updateCardAtIndex(nextState, prevCardIndex, (card) => ({
        ...card,
        soulCoreCount: Math.max(0, card.soulCoreCount - 1),
      }));
    }
  }

  if (nextCardId !== null && previousCardId !== nextCardId) {
    const cardIndex = getCardIndexOrThrow(nextState, nextCardId);
    nextState = updateCardAtIndex(nextState, cardIndex, (card) => ({
      ...card,
      soulCoreCount: card.soulCoreCount + 1,
    }));
  }

  return nextState;
}

export function refreshTrashCoresToReserve(
  state: GameState,
  playerId: string
): GameState {
  const playerIndex = getPlayerIndexOrThrow(state, playerId);
  const player = state.players[playerIndex];

  if (!player) {
    throw new Error(`Unknown player: ${playerId}`);
  }

  let currentState = state;

  if (player.trashNormalCoreCount > 0) {
    currentState = moveNormalCores(
      currentState,
      {
        kind: "trash",
        playerId,
      },
      {
        kind: "reserve",
        playerId,
      },
      player.trashNormalCoreCount
    );
  }

  if (player.soulCoreLocation?.kind === "trash") {
    currentState = moveSoulCore(
      currentState,
      playerId,
      {
        kind: "trash",
        playerId,
      },
      {
        kind: "reserve",
        playerId,
      }
    );
  }

  return currentState;
}

/** 「回復する」は重疲労→疲労→回復の一段階だけ進める。 */
export function recoverExhaustState(
  state: CardInstance["exhaustState"]
): CardInstance["exhaustState"] {
  return state === "heavily_exhausted" ? "exhausted" : "recovered";
}

/** リフレッシュステップでは対象プレイヤーのカードを一段階回復する。 */
export function refreshExhaustStates(
  state: GameState,
  playerId: string,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): GameState {
  return synchronizeBraveExhaustion(
    replaceCardInstances(
      {
        ...state,
      },
      state.cardInstances.map((card) => {
        if (card.zone !== "field") return card;
        if (card.controllerPlayerId !== playerId) return card;
        // 「次のリフレッシュでは回復できない」は重疲労の一段階回復も禁止する。
        // 回復状態で迎えた場合も、このリフレッシュで期限が切れる。
        if (card.skipNextRefreshRecovery === true) {
          return { ...card, skipNextRefreshRecovery: false };
        }
        if (card.exhaustState === "recovered") return card;

        if (
          getCardDefinitionById &&
          isCardRecoveryRestricted(state, card, getCardDefinitionById)
        ) {
          return card;
        }

        const nextState = recoverExhaustState(card.exhaustState);
        return {
          ...card,
          exhaustState: nextState,
          ...(nextState === "recovered"
            ? { exhaustedByUnpreventableEffect: false }
            : {}),
        };
      })
    ),
    getCardDefinitionById
  );
}

export interface LifeDamageContext {
  cause: "opponent_effect" | "self_effect" | "battle";
  actingPlayerId: string;
  sourcePreventionLevel?: EffectPreventionLevel;
  battleEndDeferralAttackId?: string;
  /**
   * 効果起因のライフ減少で、発生源カードが CardFilter に一致するかを呼び出し側が評価する。
   * core-system は card-filter / effective getter へ依存せず、評価済み predicate だけを消費する。
   */
  sourceCardMatchesFilter?: (
    filter: CardFilter,
    protectedPlayerId: string
  ) => boolean;
  /**
   * P3-125 Step3: バトル解決 (`getUnblockedLifeDamage`) が参加体単位で
   * `life_damage_source_prevention_immunity` 一致済みと判定した分。true のとき
   * `applyLifeDamageInterception` は interceptionCEs のスキャンを全スキップし、
   * amount 全量を通す（BSLH01-X08【ソウルドライブ・S】等の producer 側昇格）。
   */
  forcedUnpreventable?: boolean;
}

function lifeZoneFilterMatchesPlayer(
  state: GameState,
  filter: { player?: string; zone?: readonly Zone[] },
  protectedPlayerId: string,
  effectOwnerPlayerId: string
): boolean {
  if (!filter.zone?.includes("life")) return false;
  const opponentId = state.players.find(
    (p) => p.id !== effectOwnerPlayerId
  )?.id;
  const expectedPlayerId =
    filter.player === "self"
      ? effectOwnerPlayerId
      : filter.player === "opponent"
        ? opponentId
        : undefined;
  return (
    expectedPlayerId === undefined || expectedPlayerId === protectedPlayerId
  );
}

function isLifeZoneProtectedByEffectImmunity(
  state: GameState,
  protectedPlayerId: string,
  context: LifeDamageContext
): boolean {
  if (context.cause !== "opponent_effect") return false;
  if (context.actingPlayerId === protectedPlayerId) return false;
  if (context.sourcePreventionLevel === "unpreventable") return false;

  for (const ce of state.activeContinuousEffects) {
    if (ce.modifierTag !== "defense_immune") continue;
    if (!ce.targetFilter) continue;
    if (
      !lifeZoneFilterMatchesPlayer(
        state,
        ce.targetFilter,
        protectedPlayerId,
        ce.actingPlayerId
      )
    ) {
      continue;
    }
    const sourceRelation =
      context.actingPlayerId === ce.actingPlayerId ? "self" : "opponent";
    const playerScope = ce.immunityPlayerScope ?? "opponent";
    if (playerScope !== "any" && playerScope !== sourceRelation) continue;
    if (ce.immunitySourceScope !== undefined) continue;
    return true;
  }
  return false;
}

function matchesLifeDamageInterceptionCause(
  filter: "opponent_effect" | "opponent" | "any",
  context: LifeDamageContext,
  protectedPlayerId: string
): boolean {
  if (filter === "any") return true;
  if (filter === "opponent_effect") {
    return context.cause === "opponent_effect";
  }
  return context.actingPlayerId !== protectedPlayerId;
}

/**
 * discardCostGate / useCostGate 付き `life_damage_interception` の直接スキャン
 * （CE 登録に依存しない）。
 *
 * `continuous-effect-rebuild.ts` の `REBUILD_ZONES` は `{field, mirage, burst}` のみで
 * "hand"/"set_aside" 未収録のため、手札/手元ゾーンの continuous 効果は
 * `activeContinuousEffects` に一切登録されない（BSTH02.7-C06[0] / BSGE01-C16 の既存
 * コメントが同じギャップを "runtime sleeping" と明記）。discardCostGate/useCostGate は
 * この2ゾーン専用の機構のため、CE 登録を待たず `card.effects` を直接読む
 * （cost-system.ts の `getEffectiveReductionSymbolEntries` と同じ SSOT パターン:
 * 手札ゾーンの continuous は DSL 直接読みで解決する）。
 *
 * `condition` 付きの discardCostGate/useCostGate 効果は保守的に非対象とする
 * （本関数は `evaluateCondition` を呼べない層のため。将来 condition 付きカードが
 * 出た場合は要拡張）。`timingScope`（「アタックステップ中」等の窓限定、BSLH01-M05[1]）は
 * `ConditionClause` ではなく構造的フィールドのため `isTimingScopeActive`
 * （card/ce-lookup.ts、CE 消費側と同じ SSOT）でここでも判定できる。
 */
function collectDirectLifeDamageCostGateEntries(
  state: GameState,
  playerId: string,
  cause: "opponent_effect" | "self_effect" | "battle",
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): PendingLifeDamageDiscardEntry[] {
  if (!getCardDefinitionById) return [];
  const entries: PendingLifeDamageDiscardEntry[] = [];

  for (const card of state.cardInstances) {
    if (card.ownerPlayerId !== playerId) continue;
    if (card.zone !== "hand" && card.zone !== "set_aside") continue;
    const def = getCardDefinitionById(card.definitionId);
    if (!def) continue;

    for (const effect of def.effects ?? []) {
      if (effect.timing.kind !== "continuous") continue;
      // 保守的フォールバック: condition 付きは評価できないため非対象。
      if (effect.condition && effect.condition.length > 0) continue;
      if (
        !isTimingScopeActive(
          effect.timingScope,
          state.step,
          state.activePlayerId,
          card.ownerPlayerId,
          state.window === "step_end" ? "end" : undefined
        )
      ) {
        continue;
      }
      const applicabilityZones = effect.applicability?.zone
        ? Array.isArray(effect.applicability.zone)
          ? effect.applicability.zone
          : [effect.applicability.zone]
        : undefined;
      if (!applicabilityZones || !applicabilityZones.includes(card.zone)) {
        continue;
      }

      for (const step of effect.steps) {
        const action = step.action;
        if (action.kind !== "life_damage_interception") continue;
        if (action.mode !== "replace") continue;
        if (!action.discardCostGate && !action.useCostGate) continue;
        if (action.cause === "opponent_effect" && cause !== "opponent_effect") {
          continue;
        }
        if (action.cause === "opponent" && cause === "self_effect") {
          continue;
        }
        const ceEffectId = `dsl-direct:${card.instanceId}:${def.effects!.indexOf(effect)}`;
        if (action.discardCostGate) {
          if (!action.discardCostGate.zones.includes(card.zone)) continue;
          entries.push({
            costKind: "discard",
            ceEffectId,
            sourceInstanceId: card.instanceId,
            sourceDefinitionId: card.definitionId,
            sourceZone: card.zone as "hand" | "set_aside",
          });
        } else if (action.useCostGate) {
          if (!action.useCostGate.zones.includes(card.zone as "hand")) continue;
          const useEffectIndex = action.useCostGate.effectIndex;
          const useEffect = def.effects?.[useEffectIndex];
          if (
            useEffect?.timing.kind !== "activated" ||
            useEffect.timing.mode !== "flash"
          ) {
            continue;
          }
          if (
            useEffect.usageLimit &&
            !canUseEffectByUsageLimit({
              state,
              sourceInstanceId: card.instanceId,
              sourceDefinitionId: card.definitionId,
              getCardDefinitionById,
              sourceEffect: useEffect,
              effectLabel: "magic",
              usageLimit: useEffect.usageLimit,
            })
          ) {
            continue;
          }
          entries.push({
            costKind: "use",
            ceEffectId,
            sourceInstanceId: card.instanceId,
            sourceDefinitionId: card.definitionId,
            sourceZone: card.zone as "hand",
            useEffectIndex,
          });
        }
      }
    }
  }

  return entries;
}

/**
 * ライフダメージインターセプション共通処理。
 * resolveLifeDamage / executeCoreMove(life→) の両方から呼ばれる。
 *
 * @returns replaced=true の場合、呼び出し元はダメージ/コア移動をスキップする。
 *   adjustedAmount は floor 等でクランプ後の実ダメージ量（呼び出し元はこの値で減算する）。
 */
export function applyLifeDamageInterception(
  state: GameState,
  playerId: string,
  amount: number,
  context: LifeDamageContext,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): {
  state: GameState;
  replaced: boolean;
  adjustedAmount: number;
  /**
   * discardCostGate 一致（CE 登録経由 or 直接スキャン）があった場合に設定される。
   * `resolveLifeDamage` と `executeCoreMove` の life→X (trash/void/reserve/field_card/
   * this_card) 5 経路の双方がこの値を消費し、`pendingLifeDamageDiscardChoice` を立てて
   * プレイヤー選択（pay/decline）を経由してから解決を再開する
   * （`resolvePendingLifeDamageDiscardChoice` / `resolvePendingLifeDamageDiscardChoiceForCoreMove`）。
   */
  pendingDiscardChoice?: {
    entries: PendingLifeDamageDiscardEntry[];
    turnCapConsumption?: PendingLifeDamageTurnCapConsumption;
  };
} {
  // P3-125 Step3: バトル解決側が参加体単位で判定済みの producer 側昇格
  // (`life_damage_source_prevention_immunity`)。全 interceptionCE スキャンを
  // スキップし、amount 全量を通す。
  if (context.forcedUnpreventable) {
    return { state, replaced: false, adjustedAmount: amount };
  }
  if (isLifeZoneProtectedByEffectImmunity(state, playerId, context)) {
    return {
      state: {
        ...state,
        log: [
          ...state.log,
          `effect:life_effect_immunity:${playerId}:blocked:${amount}`,
        ],
      },
      replaced: true,
      adjustedAmount: 0,
    };
  }
  // 効果起因 (self_effect/opponent_effect) は sourceCardMatchesFilter で単一の
  // 発生源カードを確定できるため、ここで producer 側昇格の一致判定を行う
  // (バトル起因は複数参加体が混在し得るため getUnblockedLifeDamage 側で判定する)。
  if (
    context.cause !== "battle" &&
    typeof context.sourceCardMatchesFilter === "function"
  ) {
    const sourceMatchesFilter = context.sourceCardMatchesFilter;
    const grantMatched = state.activeContinuousEffects.some((ce) => {
      if (ce.modifierTag !== "life_damage_source_prevention_immunity") {
        return false;
      }
      if (ce.targetInstanceId !== context.actingPlayerId) return false;
      const meta = ce.metadata as { sourceFilter?: CardFilter } | undefined;
      return (
        meta?.sourceFilter !== undefined &&
        sourceMatchesFilter(meta.sourceFilter, playerId)
      );
    });
    if (grantMatched) {
      return { state, replaced: false, adjustedAmount: amount };
    }
  }

  let currentState = state;
  let adjustedAmount = amount;
  let playerWideTurnCapMatched = false;
  const filteredTurnCapEffectIds = new Set<string>();
  // 手札/手元ゾーンは CE 未登録 (REBUILD_ZONES 未収録) のため直接スキャンで収集する。
  const discardGateEntries: PendingLifeDamageDiscardEntry[] = [
    ...collectDirectLifeDamageCostGateEntries(
      currentState,
      playerId,
      context.cause,
      getCardDefinitionById
    ),
  ];
  // declareGimmickGate は field 上の CE 登録経路のみ (discardCostGate の手札/手元直接
  // スキャンに相当するものは無い。カード自身ではなく宣言アクションが支払いのため)。
  const declareGimmickGateEntries: PendingLifeDamageDiscardEntry[] = [];

  const interceptionCEs = currentState.activeContinuousEffects.filter(
    (ce) =>
      ce.modifierTag === "life_damage_interception" &&
      ce.targetInstanceId === playerId
  );

  for (const ce of interceptionCEs) {
    const meta = ce.metadata as
      | {
          cause: string;
          mode: string;
          turnThreshold: number;
          floor?: number;
          cap?: number;
          battleOnly?: boolean;
          attackerFilter?: unknown;
          attackerInstanceIds?: unknown;
          discardCostGate?: { zones: readonly string[] };
          useCostGate?: { zones: readonly string[]; effectIndex: number };
          declareGimmickGate?: { reduceBy?: number };
          coreAction?: {
            from: { kind: string; player?: string };
            to: { kind: string; player?: string };
          };
        }
      | undefined;
    if (!meta) continue;
    if (meta.battleOnly && context.cause !== "battle") {
      continue;
    }

    const hasFilteredInterception =
      context.cause !== "battle" &&
      (meta.attackerFilter || meta.attackerInstanceIds);
    if (hasFilteredInterception) {
      if (meta.attackerInstanceIds) {
        continue;
      }
      if (
        !meta.attackerFilter ||
        typeof context.sourceCardMatchesFilter !== "function" ||
        !context.sourceCardMatchesFilter(
          meta.attackerFilter as CardFilter,
          playerId
        )
      ) {
        continue;
      }
    }

    // 攻撃者限定ライフ減少防止 (attackerFilter / attackerInstanceIds 付き) は
    // バトル解決の getUnblockedLifeDamage が per-participant に適用するため、
    // ここでは扱わない。(この CE を replace として全 damage に適用すると、
    //  フィルタ外アタッカーのライフ減少まで誤って 0 にしてしまう。)
    if (
      !hasFilteredInterception &&
      (meta.attackerFilter || meta.attackerInstanceIds)
    ) {
      continue;
    }

    // per-participant cap (「ライフは N しか減らない」, cap 指定) も
    // getUnblockedLifeDamage 側で per-participant にクランプ済みのため、
    // ここで replace として全 damage を 0 にしないよう除外する。
    if (
      !hasFilteredInterception &&
      meta.mode === "replace" &&
      meta.cap !== undefined
    ) {
      continue;
    }

    // cause フィルタ。非バトルの source-filter 型は「相手のカードによって」を
    // sourceCardMatchesFilter 側の controller 判定で満たすため、actingPlayerId が
    // protected player でも cause:"opponent" を通す。
    const causeMatches =
      hasFilteredInterception && meta.cause === "opponent"
        ? true
        : matchesLifeDamageInterceptionCause(
            meta.cause as "opponent_effect" | "opponent" | "any",
            context,
            playerId
          );
    if (!causeMatches) {
      continue;
    }

    // ターン累積上限「このターン、自分のライフは N しか減らない」(mode:"turn_cap")。
    // 無印 turn_cap は全原因（バトル／効果／その他）合算で player-wide に頭打ちする。
    // attackerFilter / attackerInstanceIds 付きは一致する発生源由来だけを
    // protected player + CE/filter バケット単位で頭打ちする。
    // 累積カウンタは自ターン開始でリセット済み（turn-system）。
    // 10_rules/05b §ライフ減少の上限キャップ、裁定 2026-06-15。
    if (meta.mode === "turn_cap") {
      const cap = meta.cap ?? 0;
      const filteredTurnCap = hasFilteredInterception;
      const filteredKey = filteredTurnCap
        ? filteredLifeReductionKey(playerId, ce.effectId)
        : undefined;
      const cumulative =
        filteredKey !== undefined
          ? ((currentState.filteredLifeReductionCappedThisTurn ?? {})[
              filteredKey
            ] ?? 0)
          : ((currentState.lifeReductionCappedThisTurn ?? {})[playerId] ?? 0);
      const remaining = Math.max(0, cap - cumulative);
      const allowed = Math.min(adjustedAmount, remaining);
      if (allowed < adjustedAmount) {
        const blocked = adjustedAmount - allowed;
        adjustedAmount = allowed;
        currentState = {
          ...currentState,
          log: [
            ...currentState.log,
            `effect:life_damage_interception:turn_cap:${playerId}:cap=${cap}:cumulative=${cumulative}:blocked=${blocked}`,
          ],
        };
      }
      if (filteredTurnCap) {
        filteredTurnCapEffectIds.add(ce.effectId);
      } else {
        playerWideTurnCapMatched = true;
      }
      continue;
    }

    // 破棄コストゲート（BSTH02.7-C05[1] 等）: 「破棄することで、自分のライフは減らない」型。
    // sourceInstanceId が discardCostGate.zones を離れていれば防止不可 (無条件スキップ)。
    // まだ zones 内にあれば即座に replace せず、pendingDiscardChoice へ積んで呼び出し元
    // (resolveLifeDamage / executeCoreMove) にプレイヤー選択を委ねる。
    if (meta.mode === "replace" && meta.discardCostGate) {
      const zones = meta.discardCostGate.zones ?? [];
      const sourceCard = currentState.cardInstances.find(
        (c) => c.instanceId === ce.sourceInstanceId
      );
      if (!sourceCard || !zones.includes(sourceCard.zone)) {
        continue;
      }
      // 直接スキャン (collectDirectLifeDamageCostGateEntries) と重複登録しないよう防御する
      // （将来 REBUILD_ZONES が hand/set_aside 対応した場合、同一カードが両経路で
      // 見つかる可能性があるため sourceInstanceId で dedupe する）。
      if (
        !discardGateEntries.some(
          (e) => e.sourceInstanceId === ce.sourceInstanceId
        )
      ) {
        discardGateEntries.push({
          costKind: "discard",
          ceEffectId: ce.effectId,
          sourceInstanceId: ce.sourceInstanceId,
          sourceDefinitionId: ce.sourceDefinitionId,
          sourceZone: sourceCard.zone as "hand" | "set_aside",
        });
      }
      continue;
    }

    // 使用コストゲート（BSLH01-M05[1]）: 「コストを支払わずに使用することで、
    // 自分のライフは減らない」型。discardCostGate と同型の CE 登録経路
    // （direct scan が主経路。ここは REBUILD_ZONES が将来 hand 対応した場合の保険）。
    if (meta.mode === "replace" && meta.useCostGate) {
      const zones = meta.useCostGate.zones ?? [];
      const sourceCard = currentState.cardInstances.find(
        (c) => c.instanceId === ce.sourceInstanceId
      );
      if (!sourceCard || !zones.includes(sourceCard.zone)) {
        continue;
      }
      const sourceDefinition = getCardDefinitionById?.(ce.sourceDefinitionId);
      const useEffectIndex = meta.useCostGate.effectIndex;
      const useEffect = sourceDefinition?.effects?.[useEffectIndex];
      if (
        useEffect?.timing.kind !== "activated" ||
        useEffect.timing.mode !== "flash"
      ) {
        continue;
      }
      if (
        useEffect.usageLimit &&
        !canUseEffectByUsageLimit({
          state: currentState,
          sourceInstanceId: sourceCard.instanceId,
          sourceDefinitionId: sourceCard.definitionId,
          getCardDefinitionById,
          sourceEffect: useEffect,
          effectLabel: "magic",
          usageLimit: useEffect.usageLimit,
        })
      ) {
        continue;
      }
      if (
        !discardGateEntries.some(
          (e) => e.sourceInstanceId === ce.sourceInstanceId
        )
      ) {
        discardGateEntries.push({
          costKind: "use",
          ceEffectId: ce.effectId,
          sourceInstanceId: ce.sourceInstanceId,
          sourceDefinitionId: ce.sourceDefinitionId,
          sourceZone: sourceCard.zone as "hand",
          useEffectIndex,
        });
      }
      continue;
    }

    // 宣言コストゲート（BSLH01-C12 等）:「宣言することで、減るコアの数を-N する」型。
    // discardCostGate と異なりカードがゾーンを離れて自然消滅する仕組みが無いため、
    // 「ターンに1回」を declareGimmickGateUsedThisTurn の明示フラグで管理する。
    // 使用済みならこの CE は黙ってスキップし通常解決へフォールスルーする。
    if (meta.mode === "replace" && meta.declareGimmickGate) {
      if (
        isDeclareGimmickGateUsedThisTurn(currentState, playerId, ce.effectId)
      ) {
        continue;
      }
      if (
        !declareGimmickGateEntries.some((e) => e.ceEffectId === ce.effectId)
      ) {
        declareGimmickGateEntries.push({
          costKind: "declare_gimmick",
          ceEffectId: ce.effectId,
          sourceInstanceId: ce.sourceInstanceId,
          sourceDefinitionId: ce.sourceDefinitionId,
          reduceBy: meta.declareGimmickGate.reduceBy ?? 1,
        });
      }
      continue;
    }

    if (meta.mode === "floor") {
      // ライフ下限保護: ライフが floor を下回らないようにダメージ量をクランプする。
      // 「自分のライフは0にならない」= floor:1。turnThreshold は floor では使わない
      // （現在ライフ基準でクランプするため、累積判定は不要）。
      const floor = meta.floor ?? 1;
      const playerState = currentState.players.find((p) => p.id === playerId);
      if (!playerState) continue;
      const currentLife = getPlayerLifeCoreCount(playerState);
      const maxAllowed = Math.max(0, currentLife - floor);
      if (adjustedAmount > maxAllowed) {
        const blocked = adjustedAmount - maxAllowed;
        adjustedAmount = maxAllowed;
        currentState = {
          ...currentState,
          log: [
            ...currentState.log,
            `effect:life_damage_interception:floor:${playerId}:floor=${floor}:blocked=${blocked}`,
          ],
        };
      }
      continue;
    }

    // turnThreshold チェック（累積 + 今回 >= 閾値）
    const cumulative = currentState.effectLifeReductionThisTurn[playerId] ?? 0;
    if (meta.turnThreshold && cumulative + amount < meta.turnThreshold)
      continue;

    if (meta.mode === "before" && meta.coreAction) {
      // ダメージ前にボイドからライフにコアを追加（可能な分だけ）
      const fromPlayerId =
        meta.coreAction.from.player === "opponent"
          ? (currentState.players.find((p) => p.id !== ce.actingPlayerId)?.id ??
            ce.actingPlayerId)
          : ce.actingPlayerId;
      const toPlayerId =
        meta.coreAction.to.player === "opponent"
          ? (currentState.players.find((p) => p.id !== ce.actingPlayerId)?.id ??
            ce.actingPlayerId)
          : ce.actingPlayerId;
      const fromContainer: NormalCoreContainer = {
        kind: meta.coreAction.from.kind as "void",
        playerId: fromPlayerId,
      };
      const toContainer: NormalCoreContainer = {
        kind: meta.coreAction.to.kind as "life",
        playerId: toPlayerId,
      };
      const availableCores = getNormalCoreCountAtLocation(
        currentState,
        fromContainer
      );
      const moveAmount = Math.min(amount, availableCores);
      if (moveAmount > 0) {
        currentState = moveNormalCores(
          currentState,
          fromContainer,
          toContainer,
          moveAmount
        );
        currentState = {
          ...currentState,
          log: [
            ...currentState.log,
            `effect:life_damage_interception:before:${playerId}:${moveAmount}`,
          ],
        };
      }
      break; // 最初の buffer CE のみ発火（二重バッファ防止）
    } else if (meta.mode === "replace" && meta.cap !== undefined) {
      const allowed = Math.min(adjustedAmount, meta.cap);
      if (allowed < adjustedAmount) {
        const blocked = adjustedAmount - allowed;
        adjustedAmount = allowed;
        currentState = {
          ...currentState,
          log: [
            ...currentState.log,
            `effect:life_damage_interception:replace-cap:${playerId}:cap=${meta.cap}:blocked=${blocked}`,
          ],
        };
      }
      continue;
    } else if (meta.mode === "replace") {
      // ダメージをスキップ
      currentState = {
        ...currentState,
        log: [
          ...currentState.log,
          `effect:life_damage_interception:replace:${playerId}:${amount}`,
        ],
      };
      if (context.cause === "opponent_effect") {
        currentState = updateEffectLifeReduction(
          currentState,
          playerId,
          amount
        );
      }
      return { state: currentState, replaced: true, adjustedAmount: 0 };
    }
  }

  // floor/turn_cap 等で全ダメージがクランプされた場合は replaced 扱い。
  // 実ライフ減少がないなら discardCostGate の破棄選択も発生しない。
  if (adjustedAmount <= 0) {
    return { state: currentState, replaced: true, adjustedAmount: 0 };
  }

  // コストゲート一致あり (discardCostGate / declareGimmickGate): このダメージはまだ
  // 確定しない。呼び出し元 (resolveLifeDamage / executeCoreMove) にプレイヤー選択
  // (pay/decline) を委ねる。
  const gateEntries = [...discardGateEntries, ...declareGimmickGateEntries];
  if (gateEntries.length > 0) {
    const turnCapConsumption = buildPendingTurnCapConsumption(
      playerWideTurnCapMatched,
      filteredTurnCapEffectIds
    );
    return {
      state: currentState,
      replaced: false,
      adjustedAmount,
      pendingDiscardChoice: {
        entries: gateEntries,
        ...(turnCapConsumption ? { turnCapConsumption } : {}),
      },
    };
  }

  // turn_cap の累積カウンタは、この関数内の全 replacement/floor/turn_cap を
  // 適用した後に「実際に減る量」だけ計上する。重複 CE がある場合も、
  // 各 bucket は同じ最終実減少量を観測する。
  if (playerWideTurnCapMatched) {
    currentState = updateCappedLifeReduction(
      currentState,
      playerId,
      adjustedAmount
    );
  }
  for (const effectId of filteredTurnCapEffectIds) {
    currentState = updateFilteredCappedLifeReduction(
      currentState,
      playerId,
      effectId,
      adjustedAmount
    );
  }

  // 累積カウンタ更新（クランプ後の実ダメージ量で計上）。
  if (context.cause === "opponent_effect") {
    currentState = updateEffectLifeReduction(
      currentState,
      playerId,
      adjustedAmount
    );
  }

  return { state: currentState, replaced: false, adjustedAmount };
}

export function resolveLifeDamage(
  state: GameState,
  playerId: string,
  amount: number,
  chosenCoreKinds: readonly LifeCoreKind[] = [],
  context?: LifeDamageContext,
  /**
   * discardCostGate の手札/手元直接スキャン (`collectDirectDiscardCostGateEntries`) に必要。
   * 省略時は discardCostGate 一致の検出をスキップする（CE 登録済みの経路のみ有効）。
   */
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): GameState {
  assertPositiveCoreAmount(amount);

  const playerIndex = getPlayerIndexOrThrow(state, playerId);
  const player = state.players[playerIndex];

  if (!player) {
    throw new Error(`Unknown player: ${playerId}`);
  }

  let currentState = state;

  // --- ライフダメージインターセプション ---
  // 適用後の実ダメージ量（floor クランプ等）を damageAmount として以降使用する。
  let damageAmount = amount;
  if (context) {
    const result = applyLifeDamageInterception(
      currentState,
      playerId,
      amount,
      context,
      getCardDefinitionById
    );
    currentState = result.state;
    if (result.replaced) return currentState;
    if (result.pendingDiscardChoice) {
      // 破棄コストゲート一致: ダメージ解決を中断し、プレイヤー選択待ちを立てる。
      // resolvePendingLifeDamageDiscardChoice が解決 (pay=0 / decline=pendingAmount) する。
      return {
        ...currentState,
        pendingLifeDamageDiscardChoice: {
          pendingId: `ldc-${currentState.log.length}-${playerId}`,
          decidingPlayerId: playerId,
          actingPlayerId: context.actingPlayerId,
          cause: context.cause,
          pendingAmount: result.adjustedAmount,
          entries: result.pendingDiscardChoice.entries,
          ...(result.pendingDiscardChoice.turnCapConsumption
            ? {
                turnCapConsumption:
                  result.pendingDiscardChoice.turnCapConsumption,
              }
            : {}),
          ...(context.battleEndDeferralAttackId !== undefined
            ? { battleEndDeferralAttackId: context.battleEndDeferralAttackId }
            : {}),
        },
        log: [
          ...currentState.log,
          `effect:life_damage_interception:discard-cost-gate:pending:${playerId}:${result.adjustedAmount}`,
        ],
      };
    }
    damageAmount = result.adjustedAmount;
  }

  return applyRawLifeDamageReduction(
    currentState,
    playerId,
    amount,
    damageAmount,
    chosenCoreKinds,
    context
  );
}

/**
 * インターセプション適用後の実ダメージ量 (`damageAmount`) を実際にライフコアから
 * 減算する共通処理。`resolveLifeDamage` の通常経路と
 * `resolvePendingLifeDamageDiscardChoice` の decline (辞退) 経路の両方から呼ばれる。
 *
 * `amount` はエラーメッセージ用の元ダメージ量（呼び出し元によっては damageAmount と同じ）。
 */
function applyRawLifeDamageReduction(
  state: GameState,
  playerId: string,
  amount: number,
  damageAmount: number,
  chosenCoreKinds: readonly LifeCoreKind[],
  context?: LifeDamageContext
): GameState {
  let currentState = state;

  // --- 通常のライフダメージ解決 ---
  const totalLifeCoreCount = getPlayerLifeCoreCount(
    currentState.players[getPlayerIndexOrThrow(currentState, playerId)]!
  );

  // ライフを超えるダメージは、残ライフを 0 にして頭打ちにする。
  // 超過分は「ライフ 0 = 敗北」で処理されるため捨てられる（公式: 勝敗判定はライフ減少直後）。
  // context 付き呼び出し（バトル / life_damage DSL）は実際のダメージなのでクランプし、
  // context 無しの低レベルプリミティブ用途は従来通り不変条件として throw する。
  let effectiveAmount = damageAmount;
  if (totalLifeCoreCount < damageAmount) {
    if (!context) {
      throw new Error(
        `Not enough life cores to resolve damage: player=${playerId} amount=${amount}`
      );
    }
    effectiveAmount = totalLifeCoreCount;
  }

  if (effectiveAmount === 0) {
    return currentState;
  }

  for (let index = 0; index < effectiveAmount; index += 1) {
    const availableChoices = getAvailableLifeCoreMoveChoices({
      state: currentState,
      playerId,
      destination: {
        kind: "reserve",
        playerId,
      },
      effectKind: "generic",
    });
    const fallbackChoice =
      availableChoices.find(
        (availableChoice) => availableChoice.coreKind === "normal"
      ) ?? availableChoices[0];

    if (!fallbackChoice) {
      throw new Error(
        `Not enough life cores to resolve damage: player=${playerId} amount=${amount}`
      );
    }

    currentState = moveLifeCoreByEffect({
      state: currentState,
      playerId,
      destination: {
        kind: "reserve",
        playerId,
      },
      effectKind: "generic",
      chosenCoreKind: chosenCoreKinds[index] ?? fallbackChoice.coreKind,
    });
  }

  return currentState;
}

function buildPendingTurnCapConsumption(
  playerWide: boolean,
  filteredEffectIds: ReadonlySet<string>
): PendingLifeDamageTurnCapConsumption | undefined {
  const filtered = [...filteredEffectIds];
  if (!playerWide && filtered.length === 0) return undefined;
  return {
    ...(playerWide ? { playerWide: true } : {}),
    ...(filtered.length > 0 ? { filteredEffectIds: filtered } : {}),
  };
}

function getLifeCoreCountByPlayerId(
  state: GameState,
  playerId: string
): number {
  return getPlayerLifeCoreCount(
    state.players[getPlayerIndexOrThrow(state, playerId)]!
  );
}

export function consumePendingLifeDamageTurnCapBuckets(
  state: GameState,
  pending: {
    decidingPlayerId: string;
    turnCapConsumption?: PendingLifeDamageTurnCapConsumption;
  },
  amount: number
): GameState {
  if (amount <= 0 || !pending.turnCapConsumption) return state;
  let currentState = state;
  if (pending.turnCapConsumption.playerWide) {
    currentState = updateCappedLifeReduction(
      currentState,
      pending.decidingPlayerId,
      amount
    );
  }
  for (const effectId of pending.turnCapConsumption.filteredEffectIds ?? []) {
    currentState = updateFilteredCappedLifeReduction(
      currentState,
      pending.decidingPlayerId,
      effectId,
      amount
    );
  }
  return currentState;
}

/**
 * decline (辞退) / declareGimmickGate の pay で entries が枯渇した場合の共通の後始末:
 * amount をダメージとして確定適用し、turn_cap バケットを実減少分だけ消費する。
 */
function finalizeGatedLifeDamage(
  state: GameState,
  pending: PendingLifeDamageDiscardChoice,
  amount: number
): GameState {
  let afterState: GameState = {
    ...state,
    pendingLifeDamageDiscardChoice: null,
  };
  if (pending.cause === "opponent_effect") {
    afterState = updateEffectLifeReduction(
      afterState,
      pending.decidingPlayerId,
      amount
    );
  }

  const beforeLife = getLifeCoreCountByPlayerId(
    afterState,
    pending.decidingPlayerId
  );
  afterState = applyRawLifeDamageReduction(
    afterState,
    pending.decidingPlayerId,
    amount,
    amount,
    [],
    { cause: pending.cause, actingPlayerId: pending.actingPlayerId }
  );
  const afterLife = getLifeCoreCountByPlayerId(
    afterState,
    pending.decidingPlayerId
  );
  return consumePendingLifeDamageTurnCapBuckets(
    afterState,
    pending,
    Math.max(0, beforeLife - afterLife)
  );
}

/**
 * `pendingLifeDamageDiscardChoice` を解決する（discardCostGate 破棄コストゲート /
 * useCostGate 使用コストゲート / declareGimmickGate 宣言コストゲート）。
 *
 * - `pay` (costKind:"discard"): entry.sourceInstanceId を手札/手元からトラッシュへ破棄し、
 *   このダメージ全体を 0 に置換する（残り entries があっても不要になるため畳む。
 *   「破棄することで、自分のライフは減らない」＝支払い確定でダメージそのものが
 *   無かったことになる）。
 * - `pay` (costKind:"use"): 通常の magic 使用・スタック解決が必要なため、この下位層の
 *   直接解決器では扱わない。legal pending handler が無償 magic 使用パイプラインへ接続する。
 * - `pay` (costKind:"declare_gimmick"): 宣言ギミック (declarationCountThisTurn+1) を
 *   消費し、CE 単位の「ターンに1回」使用済みフラグを立て、ダメージを 0 にはせず
 *   `reduceBy` 分だけ軽減する（discardCostGate の全額防止とは異なる）。残り entries が
 *   あれば軽減後の金額で継続、無ければそのまま確定適用する。
 * - `decline`: 当該 entry を辞退。残り entries があれば継続（次のコストゲート候補へ）、
 *   無ければ `pendingAmount` を通常通り適用してダメージ解決を再開する。
 *
 * 10_rules/02 §コスト先払い型ドロー枚数修正と同じ「プレ判断モデル」
 * （コスト → 効果確定 → システム処理）。
 */
export function resolvePendingLifeDamageDiscardChoice(
  state: GameState,
  choice: "pay" | "decline"
): GameState {
  const pending = state.pendingLifeDamageDiscardChoice;
  if (!pending) return state;
  const entry = pending.entries[0];
  if (!entry) {
    // エントリ枯渇（不変条件違反）。pending を畳んでそのまま返す。
    return { ...state, pendingLifeDamageDiscardChoice: null };
  }

  if (choice === "pay") {
    if (entry.costKind === "declare_gimmick") {
      let afterState = applyDeclareGimmickForLifeDamageGate(
        state,
        pending.decidingPlayerId
      );
      afterState = markDeclareGimmickGateUsedThisTurn(
        afterState,
        pending.decidingPlayerId,
        entry.ceEffectId
      );
      const reducedAmount = Math.max(0, pending.pendingAmount - entry.reduceBy);
      afterState = {
        ...afterState,
        log: [
          ...afterState.log,
          `effect:life_damage_interception:declare-gimmick-gate:pay:${pending.decidingPlayerId}:reduceBy=${entry.reduceBy}:remaining=${reducedAmount}`,
        ],
      };

      const remaining = pending.entries.slice(1);
      if (remaining.length > 0) {
        return {
          ...afterState,
          pendingLifeDamageDiscardChoice: {
            ...pending,
            pendingAmount: reducedAmount,
            entries: remaining,
          },
        };
      }
      return finalizeGatedLifeDamage(afterState, pending, reducedAmount);
    }

    if (entry.costKind === "use") {
      throw new Error(
        "useCostGate must be resolved through applyPendingLifeDamageDiscardChoiceAction"
      );
    }

    let afterState = moveCardZone(state, entry.sourceInstanceId, "trash");
    afterState = {
      ...afterState,
      log: [
        ...afterState.log,
        `effect:life_damage_interception:discard-cost-gate:pay:${pending.decidingPlayerId}:discard=${entry.sourceInstanceId}`,
      ],
    };
    return { ...afterState, pendingLifeDamageDiscardChoice: null };
  }

  const afterState: GameState = {
    ...state,
    log: [
      ...state.log,
      `effect:life_damage_interception:discard-cost-gate:decline:${pending.decidingPlayerId}:entry=${entry.sourceInstanceId}`,
    ],
  };

  const remaining = pending.entries.slice(1);
  if (remaining.length > 0) {
    return {
      ...afterState,
      pendingLifeDamageDiscardChoice: { ...pending, entries: remaining },
    };
  }

  return finalizeGatedLifeDamage(afterState, pending, pending.pendingAmount);
}

function updateEffectLifeReduction(
  state: GameState,
  playerId: string,
  amount: number
): GameState {
  return {
    ...state,
    effectLifeReductionThisTurn: {
      ...state.effectLifeReductionThisTurn,
      [playerId]: (state.effectLifeReductionThisTurn[playerId] ?? 0) + amount,
    },
  };
}

function updateCappedLifeReduction(
  state: GameState,
  playerId: string,
  amount: number
): GameState {
  const prev = state.lifeReductionCappedThisTurn ?? {};
  return {
    ...state,
    lifeReductionCappedThisTurn: {
      ...prev,
      [playerId]: (prev[playerId] ?? 0) + amount,
    },
  };
}

function filteredLifeReductionKey(playerId: string, effectId: string): string {
  return `${playerId}:${effectId}`;
}

function updateFilteredCappedLifeReduction(
  state: GameState,
  playerId: string,
  effectId: string,
  amount: number
): GameState {
  const prev = state.filteredLifeReductionCappedThisTurn ?? {};
  const key = filteredLifeReductionKey(playerId, effectId);
  return {
    ...state,
    filteredLifeReductionCappedThisTurn: {
      ...prev,
      [key]: (prev[key] ?? 0) + amount,
    },
  };
}

function declareGimmickGateUsageKey(
  playerId: string,
  effectId: string
): string {
  return `${playerId}:${effectId}`;
}

function isDeclareGimmickGateUsedThisTurn(
  state: GameState,
  playerId: string,
  effectId: string
): boolean {
  const key = declareGimmickGateUsageKey(playerId, effectId);
  return (state.declareGimmickGateUsedThisTurn ?? {})[key] === true;
}

export function markDeclareGimmickGateUsedThisTurn(
  state: GameState,
  playerId: string,
  effectId: string
): GameState {
  const key = declareGimmickGateUsageKey(playerId, effectId);
  return {
    ...state,
    declareGimmickGateUsedThisTurn: {
      ...(state.declareGimmickGateUsedThisTurn ?? {}),
      [key]: true,
    },
  };
}

/** `lifeDamageInterceptionUseCostGateUsedThisTurn` のキー生成（SSOT）。 */
export function lifeDamageInterceptionUseCostGateUsageKey(
  playerId: string,
  sourceInstanceId: string
): string {
  return `${playerId}:${sourceInstanceId}`;
}

/**
 * `life_damage_interception` の `useCostGate` が今ターン中に支払われたか判定する。
 * `life_damage_interception_use_cost_gate_paid_this_turn` ConditionClause の評価から
 * 参照される（BSLH01-M05[2] の field_lacks 条件無視）。
 */
export function isLifeDamageInterceptionUseCostGateUsedThisTurn(
  state: GameState,
  playerId: string,
  sourceInstanceId: string
): boolean {
  const key = lifeDamageInterceptionUseCostGateUsageKey(
    playerId,
    sourceInstanceId
  );
  return (
    (state.lifeDamageInterceptionUseCostGateUsedThisTurn ?? {})[key] === true
  );
}

export function markLifeDamageInterceptionUseCostGateUsedThisTurn(
  state: GameState,
  playerId: string,
  sourceInstanceId: string
): GameState {
  const key = lifeDamageInterceptionUseCostGateUsageKey(
    playerId,
    sourceInstanceId
  );
  return {
    ...state,
    lifeDamageInterceptionUseCostGateUsedThisTurn: {
      ...(state.lifeDamageInterceptionUseCostGateUsedThisTurn ?? {}),
      [key]: true,
    },
  };
}

/**
 * declareGimmickGate の支払い側が消費する宣言ギミック処理。
 * `effect/structured-modifiers.ts` の `executeDeclareGimmick` と同じ
 * `declarationCountThisTurn` 更新（collectDirectDiscardCostGateEntries と同じ理由で、
 * core-system.ts は effect/* 層に依存しない下位レイヤーのため独立実装する）。
 */
export function applyDeclareGimmickForLifeDamageGate(
  state: GameState,
  playerId: string
): GameState {
  const nextCount = (state.declarationCountThisTurn[playerId] ?? 0) + 1;
  return {
    ...state,
    declarationCountThisTurn: {
      ...state.declarationCountThisTurn,
      [playerId]: nextCount,
    },
    log: [...state.log, `effect:declare_gimmick:${playerId}:${nextCount}`],
  };
}

export function resolveCardLeavesFieldCores(
  state: GameState,
  instanceId: string,
  override: LeaveFieldCoreDestinationOverride | null = null,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): GameState {
  const cardIndex = getCardIndexOrThrow(state, instanceId);
  const card = state.cardInstances[cardIndex];

  if (!card) {
    throw new Error(`Unknown card instance: ${instanceId}`);
  }

  let currentState = state;
  const destinationPlayerId = card.controllerPlayerId;
  const normalCoreDestination: LeaveFieldNormalCoreDestination =
    override?.normalCoreDestination ?? {
      kind: "reserve",
      playerId: destinationPlayerId,
    };
  const soulCoreDestination: LeaveFieldSoulCoreDestination =
    override?.soulCoreDestination ?? {
      kind: "reserve",
      playerId: destinationPlayerId,
    };

  if (card.normalCoreCount > 0) {
    currentState = moveNormalCores(
      currentState,
      {
        kind: "card",
        instanceId,
      },
      normalCoreDestination,
      card.normalCoreCount,
      getCardDefinitionById,
      { ignoreNormalCoreMoveRestriction: true }
    );
  }

  const primarySoulOwners = currentState.players
    .filter(
      (player) =>
        player.soulCoreLocation?.kind === "card" &&
        player.soulCoreLocation.instanceId === instanceId
    )
    .map((player) => player.id);

  for (const ownerId of primarySoulOwners) {
    const currentCard = currentState.cardInstances.find(
      (c) => c.instanceId === instanceId
    );
    if ((currentCard?.soulCoreCount ?? 0) <= 0) break;
    currentState = moveSoulCore(
      currentState,
      ownerId,
      {
        kind: "card",
        instanceId,
      },
      resolveLeaveFieldSoulCoreDestinationForPlayer(
        soulCoreDestination,
        ownerId
      )
    );
  }

  const currentCard = currentState.cardInstances.find(
    (c) => c.instanceId === instanceId
  );
  const remainingCountOnlySoulCores = currentCard?.soulCoreCount ?? 0;
  if (remainingCountOnlySoulCores > 0) {
    currentState = moveSoulCore(
      currentState,
      destinationPlayerId,
      {
        kind: "card",
        instanceId,
      },
      resolveLeaveFieldSoulCoreDestinationForPlayer(
        soulCoreDestination,
        destinationPlayerId
      ),
      remainingCountOnlySoulCores
    );
  }

  return currentState;
}

// ---------------------------------------------------------------------------
// 汎用状態変更プリミティブ
// ---------------------------------------------------------------------------

/**
 * instanceId でカードインスタンスのプロパティを更新する。
 */
export function updateCard(
  state: GameState,
  instanceId: string,
  update: (card: CardInstance) => CardInstance
): GameState {
  const cardIndex = getCardIndexOrThrow(state, instanceId);
  return updateCardAtIndex(state, cardIndex, update);
}

/**
 * playerId でプレイヤー状態を更新する。
 */
export function updatePlayer(
  state: GameState,
  playerId: string,
  update: (player: PlayerState) => PlayerState
): GameState {
  const playerIndex = getPlayerIndexOrThrow(state, playerId);
  return updatePlayerAtIndex(state, playerIndex, update);
}

/**
 * カードのゾーンを変更し、handCount を自動で増減する。
 * カード状態への移行時は戦闘状態を初期化する。コア・合体関係は呼び出し側で処理する。
 */
export function moveCardZone(
  state: GameState,
  instanceId: string,
  toZone: CardZone,
  zoneRoleName?: string
): GameState {
  requireCardZone(toZone);
  const cardIndex = getCardIndexOrThrow(state, instanceId);
  const card = state.cardInstances[cardIndex]!;
  const fromZone = card.zone;

  let newState = updateCardAtIndex(state, cardIndex, (c) => {
    const moved = {
      ...c,
      zone: toZone,
      inUseSourceZone:
        toZone === "in_use"
          ? fromZone === "in_use"
            ? c.inUseSourceZone
            : fromZone
          : undefined,
      ...(zoneRoleName !== undefined ? { zoneRoleName } : {}),
      // ENGINE-accel-tribe-cost-override: 「このカードが〜に置かれたターンの間」型の
      // continuous 効果ゲート (CardInstance.zoneEnteredAtTurn) の唯一の書き込み経路。
      ...(fromZone !== toZone ? { zoneEnteredAtTurn: state.turnNumber } : {}),
    };
    return isCardTextCardState(moved, state)
      ? resetCardBattleStatus(moved)
      : moved;
  });

  // updateCardAtIndex -> replaceCardInstances が手札・デッキ枚数も同期済み。
  newState = recordHandEntries(state, newState);
  return fromZone === "field" && toZone !== "field"
    ? advanceDepartedFieldInstanceGeneration(state, newState)
    : newState;
}

/**
 * 同一プレイヤーのデッキ内で、選択カードを山札の上/下へ寄せる。
 * デッキ順は cardInstances の配列順（先頭 = top / 末尾 = bottom）。
 */
export function moveDeckCardsToPosition(
  state: GameState,
  ownerPlayerId: string,
  selectedInstanceIds: readonly string[],
  position: "top" | "bottom"
): GameState {
  if (selectedInstanceIds.length === 0) return state;

  const selectedSet = new Set(selectedInstanceIds);
  const selectedCards = selectedInstanceIds.map((id) => {
    const card = state.cardInstances.find((c) => c.instanceId === id);
    if (!card) {
      throw new Error(`Selected deck card not found: ${id}`);
    }
    if (card.ownerPlayerId !== ownerPlayerId || card.zone !== "deck") {
      throw new Error(`Selected card is not in ${ownerPlayerId}'s deck: ${id}`);
    }
    return card;
  });
  const otherDeckCards = state.cardInstances.filter(
    (card) =>
      card.ownerPlayerId === ownerPlayerId &&
      card.zone === "deck" &&
      !selectedSet.has(card.instanceId)
  );
  const reorderedDeck =
    position === "top"
      ? [...selectedCards, ...otherDeckCards]
      : [...otherDeckCards, ...selectedCards];
  let deckIndex = 0;
  return replaceCardInstances(
    {
      ...state,
    },
    state.cardInstances.map((card) => {
      if (card.ownerPlayerId !== ownerPlayerId || card.zone !== "deck") {
        return card;
      }
      return reorderedDeck[deckIndex++]!;
    })
  );
}
