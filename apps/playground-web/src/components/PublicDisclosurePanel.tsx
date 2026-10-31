import { ZONE_LABELS, stepDisplayLabel } from "@orica/rules-core";
import { effectActionLabel } from "@orica/rules-core";
import {
  definitionEffectPath,
  resolveDefinitionEffect,
  sameDefinitionEffectPath,
} from "@orica/rules-core";
/** 公開情報の通知とログ。表示対象は sanitize 済み GameState のみ。 */
import type { CSSProperties } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CardDefinition,
  GameState,
  LegalAction,
  PublicDisclosure,
  PublicDisclosureActionLabel,
} from "@orica/rules-core";
import {
  ZoneBrowseModal,
  type ZoneBrowseSnapshotCard,
  type ZoneBrowseSnapshotTone,
} from "./ZoneBrowseModal";

interface PublicDisclosurePanelProps {
  state: GameState;
  viewerPlayerId: string;
  getDefinition: (id: string) => CardDefinition | undefined;
  viewerLegalActions: readonly LegalAction[];
  viewerActionSequence: number;
  logOpen: boolean;
  onCloseLog: () => void;
  /** 同じ game/viewer の再接続で公開情報通知を再生しないための任意キー。 */
  presentationContextKey?: string;
  /** room 初期同期など、初回 state に含まれる公開情報を履歴として扱う。 */
  suppressInitialPresentation?: boolean;
  /** 対象ピッカー中は、確定済み target_declared の盤面演出を次 render まで待つ。 */
  suppressTargetDeclaredPresentation?: boolean;
  /** カード型通知を片付ける先の画面座標。未指定時は従来どおり消える。 */
  getCardPresentationExitAnchor?: () => PublicDisclosureExitAnchor | null;
  /** カード型通知の格納演出が始まったときに呼ばれる。 */
  onCardPresentationExit?: () => void;
}

interface PublicDisclosureExitAnchor {
  x: number;
  y: number;
}

const ACTION_LABELS: Record<PublicDisclosureActionLabel, string> = {
  attack: "アタックする",
  attack_target: "アタック対象にする",
  block: "ブロックする",
  block_target: "ブロック対象にする",
  battle_resolve: "バトルを解決する",
  reveal: "オープン",
  draw: "ドローする",
  add_to_hand: "手札に加える",
  move_to_top: "デッキの上に置く",
  move_to_bottom: "デッキの下に置く",
  move_to_trash: "トラッシュに置く",
  move_to_field: "フィールドに出す",
  move_to_deck: "デッキに戻す",
  show_cards: "公開する",
  summon: "召喚する",
  put: "フィールドに出す",
  genkai: "現界する",
  advent: "煌臨する",
  contract_combine: "契約合体する",
  manifest: "顕現する",
  rebirth: "転醒する",
  flip: "裏返す",
  brave_swap: "交換する",
  leave_soul_state: "魂状態からフィールドに戻す",
  suppress: "効果を発揮させない",
  mirage_set: "ミラージュセットする",
  move_to_set_aside: "手元に置く",
  move_to_removed: "除外する",
  destroy: "破壊する",
  vanish: "消滅させる",
  core_move: "コアを移動する",
  bp_modified: "BPを変更する",
  recover: "回復させる",
  exhaust: "疲労させる",
  heavily_exhaust: "重疲労させる",
  life_reduce: "ライフを減らす",
  life_recover: "ライフを増やす",
  count_increase: "カウントを増やす",
  count_decrease: "カウントを減らす",
  count_set: "カウントを変更する",
  symbol_modified: "シンボルを変更する",
  enter_soul_state: "魂状態にする",
  place: "配置する",
  combine: "合体する",
  separate: "分離する",
  negate: "効果を無効にする",
  property_modified: "特性を変更する",
  restriction_added: "制限を付与する",
  immunity_added: "耐性を付与する",
  effect_granted: "効果を付与する",
  discard: "破棄する",
  bullet_edit_place: "バレットエディットで下に置く",
  bullet_edit_swap: "バレットエディットで入れ替える",
  action_execute: "処理を実行する",
};

const PRESENTATION_ACTION_LABELS: Record<PublicDisclosureActionLabel, string> =
  {
    attack: "アタック",
    attack_target: "対象",
    block: "ブロック",
    block_target: "対象",
    battle_resolve: "バトル解決",
    reveal: "オープン",
    draw: "ドロー",
    add_to_hand: "手札へ",
    move_to_top: "デッキ上へ",
    move_to_bottom: "デッキ下へ",
    move_to_trash: "トラッシュへ",
    move_to_field: "フィールドへ",
    move_to_deck: "デッキへ",
    show_cards: "公開",
    summon: "召喚",
    put: "出す",
    genkai: "現界",
    advent: "煌臨",
    contract_combine: "契約合体",
    manifest: "顕現",
    rebirth: "転醒",
    flip: "裏返す",
    brave_swap: "交換",
    leave_soul_state: "魂状態から戻る",
    suppress: "発揮不可",
    mirage_set: "ミラージュへ",
    move_to_set_aside: "手元へ",
    move_to_removed: "除外へ",
    destroy: "破壊",
    vanish: "消滅",
    core_move: "コア移動",
    bp_modified: "BP変更",
    recover: "回復",
    exhaust: "疲労",
    heavily_exhaust: "重疲労",
    life_reduce: "ライフ減少",
    life_recover: "ライフ回復",
    count_increase: "カウント増加",
    count_decrease: "カウント減少",
    count_set: "カウント変更",
    symbol_modified: "シンボル変更",
    enter_soul_state: "魂状態",
    place: "配置",
    combine: "合体",
    separate: "分離",
    negate: "無効",
    property_modified: "特性変更",
    restriction_added: "制限付与",
    immunity_added: "耐性付与",
    effect_granted: "効果付与",
    discard: "破棄",
    bullet_edit_place: "下に置く",
    bullet_edit_swap: "入替",
    action_execute: "実行",
  };

const FULLWIDTH_DIGITS = "０１２３４５６７８９";

function formatPublicDisclosureOrder(value: number): string {
  return String(value).replace(
    /\d/g,
    (digit) => FULLWIDTH_DIGITS[Number(digit)] ?? digit
  );
}

function deckMovePresentationLabel(
  actionLabel: PublicDisclosureActionLabel,
  result?: PublicDisclosure["results"][number]
): string | null {
  if (
    !result ||
    result.deckPositionSnapshot === undefined ||
    result.deckIndexFromBottomSnapshot === undefined ||
    result.deckCountSnapshot === undefined
  ) {
    return null;
  }
  if (actionLabel === "move_to_top" && result.deckPositionSnapshot === "top") {
    const indexFromTop =
      result.deckCountSnapshot - result.deckIndexFromBottomSnapshot;
    return indexFromTop > 0
      ? `デッキ上${formatPublicDisclosureOrder(indexFromTop)}`
      : null;
  }
  if (
    actionLabel === "move_to_bottom" &&
    result.deckPositionSnapshot === "bottom"
  ) {
    return `デッキ下${formatPublicDisclosureOrder(
      result.deckIndexFromBottomSnapshot + 1
    )}`;
  }
  return null;
}

/** Anonymous cards still have a public destination; never read their identity. */
function hiddenMoveDestinationLabel(
  result: PublicDisclosure["results"][number],
  sentence = false
): string | undefined {
  const to =
    result.to ??
    (result.kind === "hand_delta" && result.actionLabel === "draw"
      ? "hand"
      : undefined);
  if (!to) return undefined;
  if (
    to === "deck" &&
    (result.actionLabel === "move_to_top" ||
      result.actionLabel === "move_to_bottom")
  )
    return sentence
      ? ACTION_LABELS[result.actionLabel]
      : PRESENTATION_ACTION_LABELS[result.actionLabel];
  return sentence ? `${ZONE_LABELS[to]}に移動する` : `${ZONE_LABELS[to]}へ`;
}

export const PUBLIC_DISCLOSURE_PRESENTATION_MS = 3000;
export const PUBLIC_DISCLOSURE_ARROW_PRESENTATION_MS = 2000;
export const PUBLIC_DISCLOSURE_CARD_EXIT_MS = 520;

const publicDisclosureDismissedSequences = new Map<string, number>();

function actionLabelText(reference: {
  actionLabel?: PublicDisclosureActionLabel;
  actionKind?: string;
}): string {
  const actionLabel = reference.actionLabel ?? "action_execute";
  if (actionLabel !== "action_execute") return ACTION_LABELS[actionLabel];
  if (!reference.actionKind) return ACTION_LABELS.action_execute;
  return effectActionLabel(reference.actionKind);
}

function viewerLabel(playerId: string, viewerPlayerId: string): string {
  return playerId === viewerPlayerId ? "自分" : "相手";
}

function cardLabel(
  state: GameState,
  instanceId: string | undefined,
  definitionIdSnapshot: string | undefined,
  getDefinition: (id: string) => CardDefinition | undefined
): string {
  const definition = cardDefinition(
    state,
    instanceId,
    definitionIdSnapshot,
    getDefinition
  );
  if (definition) return definition.name;
  if (definitionIdSnapshot) return "公開済みのカード";
  return instanceId ? "伏せられたカード" : "カード";
}

function cardDefinition(
  state: GameState,
  instanceId: string | undefined,
  definitionIdSnapshot: string | undefined,
  getDefinition: (id: string) => CardDefinition | undefined
): CardDefinition | undefined {
  if (definitionIdSnapshot) {
    return getDefinition(definitionIdSnapshot);
  }
  if (!instanceId) return undefined;
  const card = state.cardInstances.find(
    (entry) => entry.instanceId === instanceId
  );
  return card ? getDefinition(card.definitionId) : undefined;
}

function describeBulletEditSwap(
  disclosure: PublicDisclosure,
  state: GameState,
  getDefinition: (id: string) => CardDefinition | undefined
): string | null {
  const swapResults = disclosure.results.filter(
    (result) => result.actionLabel === "bullet_edit_swap"
  );
  if (swapResults.length < 2) return null;
  const incoming = swapResults.find(
    (result) => result.from === "hand" && result.to === "field"
  );
  const outgoing = swapResults.find(
    (result) => result.from === "field" && result.to === "hand"
  );
  if (!incoming || !outgoing) return null;
  const incomingCard = cardLabel(
    state,
    incoming.instanceId,
    incoming.definitionIdSnapshot,
    getDefinition
  );
  const outgoingCard = cardLabel(
    state,
    outgoing.instanceId,
    outgoing.definitionIdSnapshot,
    getDefinition
  );
  return `${incomingCard}をバレットエディットで下に置き、${outgoingCard}と入れ替える`;
}

export function describePublicDisclosure(
  disclosure: PublicDisclosure,
  state: GameState,
  viewerPlayerId: string,
  getDefinition: (id: string) => CardDefinition | undefined
): string {
  const actor = viewerLabel(disclosure.actorPlayerId, viewerPlayerId);
  const targetText = disclosure.targets
    .map((target) => {
      if (target.kind === "card") {
        return cardLabel(
          state,
          target.instanceId,
          target.definitionIdSnapshot,
          getDefinition
        );
      }
      if (target.kind === "zone")
        return target.zone ? ZONE_LABELS[target.zone] : "ゾーン";
      if (target.kind === "player") {
        return target.playerId
          ? viewerLabel(target.playerId, viewerPlayerId)
          : "プレイヤー";
      }
      return "コア";
    })
    .join("、");
  const bulletEditSwapText = describeBulletEditSwap(
    disclosure,
    state,
    getDefinition
  );
  const resultText =
    bulletEditSwapText ??
    disclosure.results
      .map((result) => {
        if (result.kind === "hidden_card_move") {
          const hidden =
            result.hiddenReason === "face_down" ? "裏向きで" : "内容を見せずに";
          const from = result.from ? `${ZONE_LABELS[result.from]}の` : "";
          const move =
            hiddenMoveDestinationLabel(result, true) ?? actionLabelText(result);
          return `${from}${result.count ?? 1}枚を${hidden}${move}`;
        }
        if (result.kind === "life_delta") {
          const amount = Math.abs(result.amount ?? 0);
          const player = result.playerId
            ? viewerLabel(result.playerId, viewerPlayerId)
            : "プレイヤー";
          return `${player}のライフを${amount}${result.amount && result.amount > 0 ? "増やす" : "減らす"}`;
        }
        if (result.kind === "hand_delta") {
          const amount = Math.abs(result.amount ?? 0);
          const player = result.playerId
            ? viewerLabel(result.playerId, viewerPlayerId)
            : "プレイヤー";
          return result.amount && result.amount > 0
            ? result.actionLabel !== "draw"
              ? `${player}の手札が${amount}枚増加`
              : result.playerId === disclosure.actorPlayerId
                ? `${amount}枚ドローして手札に加える`
                : `${player}に${amount}枚ドローさせ、手札に加える`
            : `${player}の手札が${amount}枚減少`;
        }
        if (result.kind === "count_delta") {
          const amount = Math.abs(result.amount ?? 0);
          const player = result.playerId
            ? viewerLabel(result.playerId, viewerPlayerId)
            : "プレイヤー";
          if (
            result.actionLabel === "count_set" &&
            result.value !== undefined
          ) {
            return `${player}のカウントを${result.value}にする`;
          }
          return `${player}のカウントを${amount}${result.amount && result.amount > 0 ? "増やす" : "減らす"}`;
        }
        if (result.kind === "core_delta") {
          const amount = Math.abs(result.amount ?? 0);
          const subject =
            result.instanceId || result.definitionIdSnapshot
              ? cardLabel(
                  state,
                  result.instanceId,
                  result.definitionIdSnapshot,
                  getDefinition
                )
              : `${result.playerId ? viewerLabel(result.playerId, viewerPlayerId) : "プレイヤー"}の${result.zone ? ZONE_LABELS[result.zone] : "コア置き場"}`;
          return `${subject}のコアが${amount}個${result.amount && result.amount > 0 ? "増加" : "減少"}`;
        }
        if (result.kind === "exhaust_state") {
          const card = cardLabel(
            state,
            result.instanceId,
            result.definitionIdSnapshot,
            getDefinition
          );
          return `${card}を${actionLabelText(result)}`;
        }
        const card = cardLabel(
          state,
          result.instanceId,
          result.definitionIdSnapshot,
          getDefinition
        );
        if (result.kind === "bp_delta") {
          if (result.amount === undefined) return `${card}のBPを変更する`;
          return `${card}のBP${(result.amount ?? 0) >= 0 ? "+" : ""}${result.amount ?? 0}`;
        }
        if (result.kind === "core_move") {
          const from = result.from ? `${ZONE_LABELS[result.from]}から` : "";
          const to = result.to ? `${ZONE_LABELS[result.to]}へ` : "";
          const amount = result.amount ?? result.count;
          return `${from}${to}コア${amount === undefined ? "" : `${Math.abs(amount)}個`}を移動する`;
        }
        const actionLabel = actionLabelText(result);
        return `${card}を${actionLabel}`;
      })
      .join("、");

  if (disclosure.kind === "deck_revealed") {
    const label = disclosurePresentationLabel(disclosure);
    return `${actor}が${targetText || "カード"}を${label}`;
  }
  if (disclosure.kind === "attack_declared") {
    const attackers = disclosure.targets
      .filter((target) => target.actionLabel === "attack")
      .map((target) =>
        target.kind === "card"
          ? cardLabel(
              state,
              target.instanceId,
              target.definitionIdSnapshot,
              getDefinition
            )
          : "カード"
      )
      .join("、");
    const destination = disclosure.targets.find(
      (target) => target.actionLabel === "attack_target"
    );
    const destinationText =
      destination?.kind === "player" && destination.playerId
        ? viewerLabel(destination.playerId, viewerPlayerId)
        : destination?.kind === "card"
          ? cardLabel(
              state,
              destination.instanceId,
              destination.definitionIdSnapshot,
              getDefinition
            )
          : "相手";
    return `${actor}が${attackers || "カード"}で${destinationText}にアタック`;
  }
  if (disclosure.kind === "block_declared") {
    const blockers = disclosure.targets
      .filter((target) => target.actionLabel === "block")
      .map((target) =>
        target.kind === "card"
          ? cardLabel(
              state,
              target.instanceId,
              target.definitionIdSnapshot,
              getDefinition
            )
          : "カード"
      )
      .join("、");
    const blocked = disclosure.targets.find(
      (target) => target.actionLabel === "block_target"
    );
    const blockedText =
      blocked?.kind === "card"
        ? cardLabel(
            state,
            blocked.instanceId,
            blocked.definitionIdSnapshot,
            getDefinition
          )
        : "アタッカー";
    return `${actor}が${blockers || "カード"}で${blockedText}をブロック`;
  }
  if (disclosure.kind === "battle_resolved") {
    return resultText ? `バトル解決：${resultText}` : `${actor}のバトルを解決`;
  }
  if (disclosure.kind === "target_declared") {
    const declarations = disclosure.targets
      .map((target) => {
        const label = actionLabelText(target);
        if (target.kind === "card") {
          const labelPrefix =
            target.actionLabel === "bp_modified" ? "の" : "に";
          const labelText =
            target.actionLabel === "bp_modified" ? label : `「${label}」`;
          return `${cardLabel(
            state,
            target.instanceId,
            target.definitionIdSnapshot,
            getDefinition
          )}${labelPrefix}${labelText}`;
        }
        if (target.kind === "zone") {
          return `${target.zone ? ZONE_LABELS[target.zone] : "ゾーン"}に「${label}」`;
        }
        if (target.kind === "player") {
          return `${target.playerId ? viewerLabel(target.playerId, viewerPlayerId) : "プレイヤー"}に「${label}」`;
        }
        return `コアに「${label}」`;
      })
      .join("、");
    const declaration = `${actor}が${declarations || targetText || "対象を選択"}`;
    return resultText ? `${declaration} → ${resultText}` : declaration;
  }
  return resultText ? `${actor}が${resultText}` : `${actor}が公開情報を更新`;
}

/** 通知とログで共有する 1 record の renderer。 */
export function PublicDisclosureRenderer({
  disclosure,
  state,
  viewerPlayerId,
  getDefinition,
  onOpenCards,
}: {
  disclosure: PublicDisclosure;
  state: GameState;
  viewerPlayerId: string;
  getDefinition: (id: string) => CardDefinition | undefined;
  onOpenCards?: () => void;
}) {
  const description = describePublicDisclosure(
    disclosure,
    state,
    viewerPlayerId,
    getDefinition
  );
  const body = (
    <>
      <span className="public-disclosure-seq">#{disclosure.sequence}</span>
      <div>
        <div className="public-disclosure-text">{description}</div>
        <div className="public-disclosure-meta">
          {disclosure.turnNumber}ターン目 / {stepDisplayLabel(disclosure.step)}
        </div>
      </div>
    </>
  );
  if (onOpenCards) {
    return (
      <button
        type="button"
        className="public-disclosure-entry public-disclosure-entry-clickable"
        data-testid={`public-disclosure-${disclosure.sequence}`}
        onClick={onOpenCards}
        aria-label={`公開情報 #${disclosure.sequence} のカード一覧を開く`}
      >
        {body}
      </button>
    );
  }
  return (
    <article
      className="public-disclosure-entry"
      data-testid={`public-disclosure-${disclosure.sequence}`}
    >
      {body}
    </article>
  );
}

type PublicDisclosureCardReference = {
  instanceId?: string;
  definitionIdSnapshot?: string;
};

type PublicDisclosurePresentationTone = ZoneBrowseSnapshotTone;

export interface PublicDisclosurePresentationCard extends ZoneBrowseSnapshotCard {
  actionLabel: string;
  tone: PublicDisclosurePresentationTone;
}

type PublicDisclosureCardOutcomeReference = PublicDisclosureCardReference & {
  badgeLabel: string;
  detailStateLabel: string;
  badgeTone: PublicDisclosurePresentationTone;
};

function definitionIdForDisclosureCardReference(
  reference: PublicDisclosureCardReference,
  state: GameState
): string | undefined {
  if (reference.definitionIdSnapshot) return reference.definitionIdSnapshot;
  if (!reference.instanceId) return undefined;
  const instance = state.cardInstances.find(
    (card) => card.instanceId === reference.instanceId
  );
  if (!instance || instance.definitionId === "_hidden_card_") return undefined;
  return instance.definitionId;
}

function snapshotCardForDisclosureReference(
  reference: PublicDisclosureCardReference,
  state: GameState,
  getDefinition: (id: string) => CardDefinition | undefined,
  index: number
): ZoneBrowseSnapshotCard | null {
  const definitionIdSnapshot = definitionIdForDisclosureCardReference(
    reference,
    state
  );
  if (
    !definitionIdSnapshot ||
    definitionIdSnapshot === "_hidden_card_" ||
    !getDefinition(definitionIdSnapshot)
  ) {
    return null;
  }
  return {
    key: reference.instanceId
      ? `instance:${reference.instanceId}`
      : `snapshot:${definitionIdSnapshot}:${index}`,
    ...(reference.instanceId ? { instanceId: reference.instanceId } : {}),
    definitionIdSnapshot,
  };
}

function cardReferenceFromDisclosureEntry(
  entry: PublicDisclosureCardReference
): PublicDisclosureCardReference {
  return {
    ...(entry.instanceId ? { instanceId: entry.instanceId } : {}),
    ...(entry.definitionIdSnapshot
      ? { definitionIdSnapshot: entry.definitionIdSnapshot }
      : {}),
  };
}

function specificDeckLabelForPlannedLabel(
  planned: string,
  specific: string
): boolean {
  const normalizedPlanned = planned.replace(/^→/, "");
  const normalizedSpecific = specific.replace(/^→/, "");
  const match = normalizedPlanned.match(/^デッキ([上下])へ$/);
  if (!match) return false;
  return new RegExp(`^デッキ${match[1]}[０-９0-9]+$`).test(normalizedSpecific);
}

function mergeDisclosureLabels(current: string, next: string): string {
  if (specificDeckLabelForPlannedLabel(current, next)) return next;
  if (specificDeckLabelForPlannedLabel(next, current)) return current;
  return current.split(" / ").includes(next) ? current : `${current} / ${next}`;
}

function presentationToneForAction(
  actionLabel: PublicDisclosureActionLabel
): PublicDisclosurePresentationTone {
  if (
    actionLabel === "destroy" ||
    actionLabel === "discard" ||
    actionLabel === "move_to_trash" ||
    actionLabel === "move_to_removed"
  ) {
    return "danger";
  }
  if (
    actionLabel === "add_to_hand" ||
    actionLabel === "move_to_field" ||
    actionLabel === "mirage_set" ||
    actionLabel === "move_to_set_aside" ||
    actionLabel === "bullet_edit_place" ||
    actionLabel === "bullet_edit_swap"
  ) {
    return "selected";
  }
  return "neutral";
}

function detailStateLabelForOutcome(
  actionLabel: PublicDisclosureActionLabel,
  badgeLabel: string
): string {
  switch (actionLabel) {
    case "add_to_hand":
    case "move_to_top":
    case "move_to_bottom":
    case "move_to_trash":
    case "move_to_set_aside":
    case "move_to_removed":
      return `→${badgeLabel}`;
    case "destroy":
      return "破壊";
    case "vanish":
      return "消滅";
    default:
      return badgeLabel;
  }
}

function disclosureOutcomeForTarget(
  target: PublicDisclosure["targets"][number]
): PublicDisclosureCardOutcomeReference | null {
  if (target.kind !== "card") return null;
  const actionLabel = target.actionLabel ?? "reveal";
  const badgeLabel =
    actionLabel === "action_execute"
      ? actionLabelText(target)
      : PRESENTATION_ACTION_LABELS[actionLabel];
  return {
    ...cardReferenceFromDisclosureEntry(target),
    badgeLabel,
    detailStateLabel: detailStateLabelForOutcome(actionLabel, badgeLabel),
    badgeTone: presentationToneForAction(actionLabel),
  };
}

function disclosureOutcomeForResult(
  result: PublicDisclosure["results"][number]
): PublicDisclosureCardOutcomeReference | null {
  if (
    result.kind !== "card_move" &&
    result.kind !== "destroyed" &&
    result.kind !== "card_state"
  )
    return null;
  const badgeLabel =
    deckMovePresentationLabel(result.actionLabel, result) ??
    (result.actionLabel === "action_execute"
      ? actionLabelText(result)
      : PRESENTATION_ACTION_LABELS[result.actionLabel]);
  return {
    ...cardReferenceFromDisclosureEntry(result),
    badgeLabel,
    detailStateLabel: detailStateLabelForOutcome(
      result.actionLabel,
      badgeLabel
    ),
    badgeTone: presentationToneForAction(result.actionLabel),
  };
}

function disclosureOutcomeForSource(
  disclosure: PublicDisclosure,
  state: GameState,
  getDefinition: (id: string) => CardDefinition | undefined
): PublicDisclosureCardOutcomeReference | null {
  if (!disclosure.source || disclosure.source.effectIndex === undefined) {
    return null;
  }
  const badgeLabel = `${
    publicDisclosureEffectBadge(disclosure, state, getDefinition).label
  }発揮`;
  return {
    ...cardReferenceFromDisclosureEntry(disclosure.source),
    badgeLabel,
    detailStateLabel: badgeLabel,
    badgeTone: "selected",
  };
}

function mergePresentationTone(
  current: PublicDisclosurePresentationTone,
  next: PublicDisclosurePresentationTone
): PublicDisclosurePresentationTone {
  if (current === "danger" || next === "danger") return "danger";
  if (current === "selected" || next === "selected") return "selected";
  return "neutral";
}

function snapshotCardsForDisclosureOutcomes(
  outcomes: readonly PublicDisclosureCardOutcomeReference[],
  state: GameState,
  getDefinition: (id: string) => CardDefinition | undefined
): ZoneBrowseSnapshotCard[] {
  const cards: ZoneBrowseSnapshotCard[] = [];
  const indexesByInstanceId = new Map<string, number>();
  for (const [index, outcome] of outcomes.entries()) {
    const card = snapshotCardForDisclosureReference(
      outcome,
      state,
      getDefinition,
      index
    );
    if (!card) continue;
    if (outcome.instanceId) {
      const existingIndex = indexesByInstanceId.get(outcome.instanceId);
      if (existingIndex !== undefined) {
        const existing = cards[existingIndex]!;
        cards[existingIndex] = {
          ...existing,
          badgeLabel: existing.badgeLabel
            ? mergeDisclosureLabels(existing.badgeLabel, outcome.badgeLabel)
            : outcome.badgeLabel,
          detailStateLabel: existing.detailStateLabel
            ? mergeDisclosureLabels(
                existing.detailStateLabel,
                outcome.detailStateLabel
              )
            : outcome.detailStateLabel,
          badgeTone: mergePresentationTone(
            existing.badgeTone ?? "neutral",
            outcome.badgeTone
          ),
        };
        continue;
      }
      indexesByInstanceId.set(outcome.instanceId, cards.length);
    }
    cards.push({
      ...card,
      badgeLabel: outcome.badgeLabel,
      detailStateLabel: outcome.detailStateLabel,
      badgeTone: outcome.badgeTone,
    });
  }
  return cards;
}

/** 匿名移動とドローの枚数から裏面を作り、実体やカード定義は参照しない。 */
function hiddenDisclosureCards(
  disclosure: PublicDisclosure
): PublicDisclosurePresentationCard[] {
  return disclosure.results.flatMap((result, resultIndex) => {
    const count =
      result.kind === "hidden_card_move"
        ? (result.count ?? 1)
        : result.kind === "hand_delta" && result.actionLabel === "draw"
          ? Math.max(0, result.amount ?? 0)
          : 0;
    const badgeLabel =
      hiddenMoveDestinationLabel(result) ??
      PRESENTATION_ACTION_LABELS[result.actionLabel];
    return Array.from({ length: count }, (_, index) => ({
      key: `hidden:${disclosure.sequence}:${resultIndex}:${index}`,
      definitionIdSnapshot: "_hidden_card_",
      badgeLabel,
      detailStateLabel: detailStateLabelForOutcome(
        result.actionLabel,
        badgeLabel
      ),
      badgeTone: presentationToneForAction(result.actionLabel),
      actionLabel: badgeLabel,
      tone: presentationToneForAction(result.actionLabel),
    }));
  });
}

function isOffFieldPublicDisclosureMove(
  result: PublicDisclosure["results"][number]
): boolean {
  if (result.kind !== "card_move") return false;
  const from = result.from;
  const to = result.to;
  return (
    from !== undefined && to !== undefined && from !== "field" && to !== "field"
  );
}

export function isPublicDisclosureCardPresentationEligible(
  disclosure: PublicDisclosure
): boolean {
  // Audience and card identity are already masked by sanitizeStateForViewer.
  // The actor receives the same presentation as every other permitted viewer.
  if (hiddenDisclosureCards(disclosure).length > 0) return true;
  if (disclosure.kind === "deck_revealed") return true;
  if (disclosure.kind === "picked" && disclosure.results.length === 0)
    return true;
  return (
    (disclosure.kind === "picked" ||
      disclosure.kind === "zone_moved" ||
      disclosure.kind === "target_declared") &&
    disclosure.results.some(isOffFieldPublicDisclosureMove)
  );
}

export function publicDisclosureReferencedCards(
  disclosure: PublicDisclosure,
  state: GameState,
  getDefinition: (id: string) => CardDefinition | undefined
): ZoneBrowseSnapshotCard[] {
  const sourceOutcome = disclosureOutcomeForSource(
    disclosure,
    state,
    getDefinition
  );
  const outcomes: PublicDisclosureCardOutcomeReference[] = [
    ...(sourceOutcome ? [sourceOutcome] : []),
    ...disclosure.targets.flatMap((target) => {
      const outcome = disclosureOutcomeForTarget(target);
      return outcome ? [outcome] : [];
    }),
    ...disclosure.results.flatMap((result) => {
      const outcome = disclosureOutcomeForResult(result);
      return outcome ? [outcome] : [];
    }),
  ];
  return [
    ...snapshotCardsForDisclosureOutcomes(outcomes, state, getDefinition),
    ...hiddenDisclosureCards(disclosure),
  ];
}

export function publicDisclosurePresentationCards(
  disclosure: PublicDisclosure,
  state: GameState,
  getDefinition: (id: string) => CardDefinition | undefined
): PublicDisclosurePresentationCard[] {
  // Completed moves use their actual results, not planned target labels. A
  // single disclosure can also contain field moves or non-card results.
  const revealTargets =
    disclosure.kind === "deck_revealed" ||
    (disclosure.kind === "picked" && disclosure.results.length === 0)
      ? disclosure.targets
      : [];
  const outcomes: PublicDisclosureCardOutcomeReference[] = [
    ...revealTargets.flatMap((target) => {
      const outcome = disclosureOutcomeForTarget(target);
      return outcome ? [outcome] : [];
    }),
    ...disclosure.results
      .filter(isOffFieldPublicDisclosureMove)
      .flatMap((result) => {
        const outcome = disclosureOutcomeForResult(
          result.actionLabel === "discard" && result.to === "trash"
            ? { ...result, actionLabel: "move_to_trash" }
            : result
        );
        return outcome ? [outcome] : [];
      }),
  ];
  const cards: PublicDisclosurePresentationCard[] = [];
  const indexesByInstanceId = new Map<string, number>();
  for (const [index, reference] of outcomes.entries()) {
    const card = snapshotCardForDisclosureReference(
      reference,
      state,
      getDefinition,
      index
    );
    if (!card) continue;
    if (reference.instanceId) {
      const existingIndex = indexesByInstanceId.get(reference.instanceId);
      if (existingIndex !== undefined) {
        const existing = cards[existingIndex]!;
        const labels = mergeDisclosureLabels(
          existing.actionLabel,
          reference.badgeLabel
        );
        cards[existingIndex] = {
          ...existing,
          actionLabel: labels,
          tone: mergePresentationTone(existing.tone, reference.badgeTone),
        };
        continue;
      }
      indexesByInstanceId.set(reference.instanceId, cards.length);
    }
    cards.push({
      ...card,
      actionLabel: reference.badgeLabel,
      tone: reference.badgeTone,
    });
  }
  return [...cards, ...hiddenDisclosureCards(disclosure)];
}

function elementForInstance(instanceId: string): HTMLElement | null {
  return (
    Array.from(
      document.querySelectorAll<HTMLElement>("[data-instance-id]")
    ).find((element) => element.dataset.instanceId === instanceId) ??
    document.querySelector<HTMLElement>(`[data-testid="card-${instanceId}"]`)
  );
}

type PublicDisclosureArrowTone =
  | "destroy"
  | "bp"
  | "core"
  | "deck"
  | "hidden"
  | "move";

export interface PublicDisclosureArrowAnchor {
  instanceId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  tone?: PublicDisclosureArrowTone;
}

interface PublicDisclosureArrowPoint {
  x: number;
  y: number;
}

export interface PublicDisclosureArrowGeometry {
  start: PublicDisclosureArrowPoint;
  end: PublicDisclosureArrowPoint;
  control1: PublicDisclosureArrowPoint;
  control2: PublicDisclosureArrowPoint;
  path: string;
  labelCenter: PublicDisclosureArrowPoint;
  labelWidth: number;
}

function pointOnAnchorEdge(
  anchor: PublicDisclosureArrowAnchor,
  toward: PublicDisclosureArrowPoint
): PublicDisclosureArrowPoint {
  const dx = toward.x - anchor.x;
  const dy = toward.y - anchor.y;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
    return { x: anchor.x, y: anchor.y };
  }
  const factor =
    1 /
    Math.max(
      Math.abs(dx) / Math.max(anchor.width / 2, 1),
      Math.abs(dy) / Math.max(anchor.height / 2, 1)
    );
  return { x: anchor.x + dx * factor, y: anchor.y + dy * factor };
}

export function buildPublicDisclosureArrowGeometry(
  source: PublicDisclosureArrowAnchor,
  target: PublicDisclosureArrowAnchor,
  index: number,
  viewport?: { width: number; height: number }
): PublicDisclosureArrowGeometry {
  const start = pointOnAnchorEdge(source, target);
  const end = pointOnAnchorEdge(target, source);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.max(Math.hypot(dx, dy), 1);
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const bendDirection = end.y < start.y ? -1 : 1;
  const bend = bendDirection * (Math.min(82, distance * 0.16) + index * 12);
  const control1 = {
    x: start.x + dx * 0.34 + normalX * bend,
    y: start.y + dy * 0.34 + normalY * bend,
  };
  const control2 = {
    x: start.x + dx * 0.72 + normalX * bend,
    y: start.y + dy * 0.72 + normalY * bend,
  };
  const path = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${control1.x.toFixed(1)} ${control1.y.toFixed(1)} ${control2.x.toFixed(1)} ${control2.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
  const labelWidth = Math.max(
    52,
    Math.min(126, Array.from(target.label).length * 10 + 18)
  );
  const labelBack = Math.min(labelWidth / 2 + 16, distance * 0.38);
  const unclampedLabelCenter = {
    x: end.x + ((start.x - end.x) / distance) * labelBack,
    y: end.y + ((start.y - end.y) / distance) * labelBack,
  };
  const labelCenter = viewport
    ? {
        x: Math.max(
          labelWidth / 2 + 4,
          Math.min(viewport.width - labelWidth / 2 - 4, unclampedLabelCenter.x)
        ),
        y: Math.max(15, Math.min(viewport.height - 15, unclampedLabelCenter.y)),
      }
    : unclampedLabelCenter;
  return {
    start,
    end,
    control1,
    control2,
    path,
    labelCenter,
    labelWidth,
  };
}

function targetArrowTone(
  actionLabel: PublicDisclosureActionLabel
): PublicDisclosureArrowTone {
  if (actionLabel === "destroy") return "destroy";
  if (actionLabel === "bp_modified") return "bp";
  if (actionLabel === "core_move") return "core";
  if (actionLabel === "move_to_top" || actionLabel === "move_to_bottom") {
    return "deck";
  }
  if (actionLabel === "discard") return "hidden";
  return "move";
}

function anchorFor(
  instanceId: string,
  label: string,
  tone?: PublicDisclosureArrowTone
): PublicDisclosureArrowAnchor | null {
  const element = elementForInstance(instanceId);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    instanceId,
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    width: rect.width,
    height: rect.height,
    label,
    ...(tone ? { tone } : {}),
  };
}

function sourceDefinitionForDisclosure(
  disclosure: PublicDisclosure,
  state: GameState,
  getDefinition: (id: string) => CardDefinition | undefined
): CardDefinition | undefined {
  const sourceDefinitionId =
    disclosure.source?.definitionIdSnapshot ??
    (disclosure.source?.instanceId
      ? state.cardInstances.find(
          (card) => card.instanceId === disclosure.source?.instanceId
        )?.definitionId
      : undefined);
  return sourceDefinitionId ? getDefinition(sourceDefinitionId) : undefined;
}

export function publicDisclosureEffectText(
  disclosure: PublicDisclosure,
  state: GameState,
  getDefinition: (id: string) => CardDefinition | undefined
): string {
  const definition = sourceDefinitionForDisclosure(
    disclosure,
    state,
    getDefinition
  );
  const effectIndex = disclosure.source?.effectIndex;
  const effect =
    effectIndex !== undefined
      ? resolveDefinitionEffect(
          definition,
          effectIndex,
          disclosure.source?.definitionPath
        )
      : undefined;
  const textRef = effect?.textRef ?? [];
  const referencedText = textRef
    .map((index) => definition?.textLines?.[index] ?? "")
    .filter((line) => line.length > 0)
    .join("\n");
  if (referencedText.length > 0) return referencedText;
  return definition?.textLines?.join("\n") ?? "";
}

function publicDisclosureEffectBadge(
  disclosure: PublicDisclosure,
  state: GameState,
  getDefinition: (id: string) => CardDefinition | undefined
): { color: string; label: string } {
  const definition = sourceDefinitionForDisclosure(
    disclosure,
    state,
    getDefinition
  );
  const effectIndex = disclosure.source?.effectIndex;
  const timingKind =
    effectIndex !== undefined
      ? resolveDefinitionEffect(
          definition,
          effectIndex,
          disclosure.source?.definitionPath
        )?.timing.kind
      : undefined;
  switch (timingKind) {
    case "card_event":
    case "game_event":
      return { color: "#8e44ad", label: "誘発" };
    case "activated":
      return { color: "#d97706", label: "起動" };
    case "burst":
      return { color: "#2563eb", label: "バースト" };
    default:
      return { color: "#8e44ad", label: "効果" };
  }
}

function PublicDisclosureEffectSource({
  disclosure,
  state,
  viewerPlayerId,
  getDefinition,
  captureAnchor,
}: {
  disclosure: PublicDisclosure;
  state: GameState;
  viewerPlayerId: string;
  getDefinition: (id: string) => CardDefinition | undefined;
  captureAnchor: (element: HTMLDivElement | null) => void;
}) {
  const definition = sourceDefinitionForDisclosure(
    disclosure,
    state,
    getDefinition
  );
  const badge = publicDisclosureEffectBadge(disclosure, state, getDefinition);
  const isSelf = disclosure.actorPlayerId === viewerPlayerId;
  const effectText = publicDisclosureEffectText(
    disclosure,
    state,
    getDefinition
  );
  return (
    <div
      ref={captureAnchor}
      className="public-disclosure-effect-source effect-queue-card active"
      data-testid="public-disclosure-effect-source"
      aria-label={`${definition?.name ?? "発揮元"}の効果`}
      onAnimationEnd={(event) => captureAnchor(event.currentTarget)}
    >
      <div className="effect-queue-card-image">
        <img
          src={
            definition?.image
              ? `/${definition.image}`
              : "/images/ForGUI/card-back.jpg"
          }
          alt={definition?.name ?? "発揮元"}
        />
        <span
          className="effect-queue-badge"
          style={{ backgroundColor: badge.color }}
        >
          {badge.label}
        </span>
        <span className={`effect-queue-player ${isSelf ? "self" : "opponent"}`}>
          {isSelf ? "自分" : "相手"}
        </span>
      </div>
      <div className="effect-queue-text">
        <div className="effect-queue-timing">効果解決</div>
        <div
          className={`effect-queue-description${
            effectText.length > 0 ? "" : " is-blank"
          }`}
        >
          {effectText}
        </div>
      </div>
    </div>
  );
}

function disclosurePresentationLabel(disclosure: PublicDisclosure): string {
  switch (disclosure.kind) {
    case "deck_revealed":
      return disclosure.targets.some(
        (target) => target.actionLabel === "show_cards"
      )
        ? "公開"
        : "オープン";
    case "picked":
      return "手札に加える";
    case "zone_moved":
      return "移動";
    case "hidden_card_action":
      return "非公開処理";
    default:
      return "公開情報";
  }
}

function publicDisclosureCardFoldStyle(
  index: number,
  count: number
): CSSProperties {
  const center = (count - 1) / 2;
  const offset = index - center;
  const centerPull = Math.max(0, center - Math.abs(offset));
  const foldX = -offset * 44;
  const foldY = 24 + centerPull * 18;
  const foldRotate = -offset * 4;
  return {
    "--public-disclosure-card-fold-x": `${foldX}px`,
    "--public-disclosure-card-fold-y": `${foldY}px`,
    "--public-disclosure-card-fold-mid-x": `${foldX * 0.56}px`,
    "--public-disclosure-card-fold-mid-y": `${foldY * 0.5}px`,
    "--public-disclosure-card-fold-end-x": `${foldX * 1.18}px`,
    "--public-disclosure-card-fold-end-y": `${foldY * 1.36}px`,
    "--public-disclosure-card-fold-rotate": `${foldRotate}deg`,
    "--public-disclosure-card-fold-mid-rotate": `${foldRotate * 0.45}deg`,
  } as CSSProperties;
}

function PublicDisclosureCardPresentation({
  disclosure,
  state,
  viewerPlayerId,
  getDefinition,
  exiting,
  exitAnchor,
}: {
  disclosure: PublicDisclosure;
  state: GameState;
  viewerPlayerId: string;
  getDefinition: (id: string) => CardDefinition | undefined;
  exiting?: boolean;
  exitAnchor?: PublicDisclosureExitAnchor | null;
}) {
  const cards = publicDisclosurePresentationCards(
    disclosure,
    state,
    getDefinition
  );
  const presentationRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!exiting || !exitAnchor) return;
    const element = presentationRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    element.style.setProperty(
      "--public-disclosure-card-exit-x",
      `${exitAnchor.x - (rect.left + rect.width / 2)}px`
    );
    element.style.setProperty(
      "--public-disclosure-card-exit-y",
      `${exitAnchor.y - (rect.top + rect.height / 2)}px`
    );
    return () => {
      element.style.removeProperty("--public-disclosure-card-exit-x");
      element.style.removeProperty("--public-disclosure-card-exit-y");
    };
  }, [disclosure.sequence, exitAnchor, exiting]);

  if (cards.length === 0) return null;
  const actor = viewerLabel(disclosure.actorPlayerId, viewerPlayerId);
  return (
    <div
      ref={presentationRef}
      className={`public-disclosure-card-presentation${
        exiting ? " public-disclosure-card-presentation-exit" : ""
      }`}
      data-testid="public-disclosure-card-presentation"
    >
      <div className="public-disclosure-card-presentation-meta">
        #{disclosure.sequence} {actor} /{" "}
        {disclosurePresentationLabel(disclosure)}
      </div>
      <div className="public-disclosure-card-strip">
        {cards.map((card, index) => {
          const definition = getDefinition(card.definitionIdSnapshot);
          return (
            <div
              className={`public-disclosure-card-thumb public-disclosure-card-thumb-${card.tone}`}
              key={card.key}
              style={publicDisclosureCardFoldStyle(index, cards.length)}
            >
              {card.definitionIdSnapshot === "_hidden_card_" ? (
                <img src="/images/ForGUI/card-back.jpg" alt="非公開カード" />
              ) : definition?.image ? (
                <img
                  src={`/${definition.image}`}
                  alt={definition.name}
                  loading="lazy"
                />
              ) : (
                <div className="public-disclosure-card-placeholder">
                  {definition?.name ?? "？？？"}
                </div>
              )}
              <span className="public-disclosure-card-badge">
                {card.actionLabel}
              </span>
              <span>{definition?.name ?? "？？？"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function isContinuousTargetDisclosure(
  disclosure: PublicDisclosure,
  state: GameState,
  getDefinition: (id: string) => CardDefinition | undefined
): boolean {
  if (
    disclosure.kind !== "target_declared" ||
    disclosure.source?.effectIndex === undefined
  ) {
    return false;
  }
  const sourceDefinition = sourceDefinitionForDisclosure(
    disclosure,
    state,
    getDefinition
  );
  return (
    resolveDefinitionEffect(
      sourceDefinition,
      disclosure.source.effectIndex,
      disclosure.source.definitionPath
    )?.timing.kind === "continuous"
  );
}

export function isPublicDisclosureLoggable(
  disclosure: PublicDisclosure,
  state: GameState,
  getDefinition: (id: string) => CardDefinition | undefined
): boolean {
  if (!isContinuousTargetDisclosure(disclosure, state, getDefinition)) {
    return true;
  }
  return (
    disclosure.results.length > 0 ||
    disclosure.targets.some(
      (target) =>
        target.actionLabel !== undefined &&
        target.actionLabel !== "action_execute"
    )
  );
}

interface DisclosureEffectKey {
  sourceInstanceId: string | undefined;
  sourceDefinitionId: string | undefined;
  effectIndex: number | undefined;
  definitionPath: readonly (string | number)[] | null | undefined;
}

const SOURCE_INSTANCE_KEYS = [
  "sourceInstanceId",
  "effectSourceInstanceId",
  "sourceEffectInstanceId",
  "cardInstanceId",
];

const SOURCE_DEFINITION_KEYS = [
  "sourceDefinitionId",
  "effectSourceDefinitionId",
  "sourceEffectDefinitionId",
  "cardDefinitionId",
  "sourceCardNo",
];

const EFFECT_INDEX_KEYS = [
  "effectIndex",
  "sourceEffectIndex",
  "magicEffectIndex",
  "fieldEffectIndex",
  "handActivatedEffectIndex",
  "battleImmediateEffectIndex",
  "targetEffectIndex",
];

const RECURSION_SKIP_KEYS = new Set([
  "cardInstances",
  "effectResolutionBeforeState",
  "players",
  "publicDisclosures",
  "state",
]);

function disclosureEffectKey(
  disclosure: PublicDisclosure
): DisclosureEffectKey | null {
  const source = disclosure.source;
  if (!source) return null;
  const key = {
    sourceInstanceId: source.instanceId,
    sourceDefinitionId: source.definitionIdSnapshot,
    effectIndex: source.effectIndex,
    definitionPath: source.definitionPath,
  };
  if (
    key.sourceInstanceId === undefined &&
    key.sourceDefinitionId === undefined &&
    key.effectIndex === undefined
  ) {
    return null;
  }
  return key;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValues(
  record: Record<string, unknown>,
  keys: readonly string[]
): string[] {
  return keys.flatMap((key) => {
    const value = record[key];
    return typeof value === "string" ? [value] : [];
  });
}

function numberValues(
  record: Record<string, unknown>,
  keys: readonly string[]
): number[] {
  return keys.flatMap((key) => {
    const value = record[key];
    return typeof value === "number" ? [value] : [];
  });
}

function recordMatchesDisclosureEffect(
  value: unknown,
  key: DisclosureEffectKey
): boolean {
  if (!isRecord(value)) return false;
  if (key.definitionPath !== undefined && key.definitionPath !== null) {
    const path =
      Array.isArray(value.definitionPath) || value.definitionPath === null
        ? (value.definitionPath as readonly (string | number)[] | null)
        : definitionEffectPath({
            ...(typeof value.divineSkillIndex === "number"
              ? { divineSkillIndex: value.divineSkillIndex }
              : {}),
            isAccelData: value.isAccelData === true,
            isChangeData: value.isChangeData === true,
          });
    if (!sameDefinitionEffectPath(key.definitionPath, path)) return false;
  }
  const sourceInstances = stringValues(value, SOURCE_INSTANCE_KEYS);
  const sourceDefinitions = stringValues(value, SOURCE_DEFINITION_KEYS);
  const effectIndexes = numberValues(value, EFFECT_INDEX_KEYS);
  const hasMatchingEffectIndex =
    key.effectIndex === undefined ||
    effectIndexes.length === 0 ||
    effectIndexes.includes(key.effectIndex);
  const hasExactEffectIndex =
    key.effectIndex !== undefined && effectIndexes.includes(key.effectIndex);
  if (
    key.sourceInstanceId !== undefined &&
    sourceInstances.includes(key.sourceInstanceId) &&
    hasMatchingEffectIndex
  ) {
    return true;
  }
  if (
    key.sourceDefinitionId !== undefined &&
    sourceDefinitions.includes(key.sourceDefinitionId) &&
    (key.effectIndex === undefined || hasExactEffectIndex)
  ) {
    return true;
  }
  return false;
}

function valueMatchesDisclosureEffect(
  value: unknown,
  key: DisclosureEffectKey,
  depth = 0
): boolean {
  if (!isRecord(value) && !Array.isArray(value)) return false;
  if (recordMatchesDisclosureEffect(value, key)) return true;
  if (depth >= 5) return false;
  if (Array.isArray(value)) {
    return value.some((entry) =>
      valueMatchesDisclosureEffect(entry, key, depth + 1)
    );
  }
  return Object.entries(value).some(
    ([entryKey, entryValue]) =>
      !RECURSION_SKIP_KEYS.has(entryKey) &&
      valueMatchesDisclosureEffect(entryValue, key, depth + 1)
  );
}

function actionMayBelongToEffectTree(action: LegalAction): boolean {
  const kind = action.kind;
  return (
    kind.startsWith("resolve_pending_") ||
    kind === "resolve_core_source_allocation" ||
    kind === "select_pending_to_resolve" ||
    kind === "declare_private_triggered_effect" ||
    kind === "skip_private_triggered_effect" ||
    kind === "confirm_target_redirect" ||
    kind === "decline_target_redirect" ||
    kind === "pass_stack" ||
    kind === "pass_battle_flash" ||
    kind === "pass_pre_declaration_stack"
  );
}

function pendingIdForAction(action: LegalAction): string | undefined {
  const value = (action as unknown as Record<string, unknown>).pendingId;
  return typeof value === "string" ? value : undefined;
}

function pendingRecordsById(
  state: GameState,
  pendingId: string
): readonly unknown[] {
  return Object.entries(state as unknown as Record<string, unknown>).flatMap(
    ([stateKey, value]) => {
      if (!stateKey.startsWith("pending")) return [];
      if (Array.isArray(value)) {
        return value.filter(
          (entry) => isRecord(entry) && entry.pendingId === pendingId
        );
      }
      return isRecord(value) && value.pendingId === pendingId ? [value] : [];
    }
  );
}

function stackRecordsForAction(
  state: GameState,
  action: LegalAction
): readonly unknown[] {
  if (action.kind === "pass_stack") {
    return [state.stackWindow?.pendingStackAction].filter(Boolean);
  }
  if (action.kind === "pass_pre_declaration_stack") {
    return [state.preDeclarationStackWindow?.pendingStackAction].filter(
      Boolean
    );
  }
  if (
    action.kind === "pass_battle_flash" &&
    action.responseTiming === "stack"
  ) {
    return [state.activeAttack?.flashWindowState?.pendingStackAction].filter(
      Boolean
    );
  }
  return [];
}

export function hasPublicDisclosureEffectTreeLegalAction(
  disclosure: PublicDisclosure,
  state: GameState,
  legalActions: readonly LegalAction[]
): boolean {
  const key = disclosureEffectKey(disclosure);
  if (!key) return false;
  return legalActions.some((action) => {
    if (!actionMayBelongToEffectTree(action)) return false;
    if (valueMatchesDisclosureEffect(action, key)) return true;
    const pendingId = pendingIdForAction(action);
    if (
      pendingId !== undefined &&
      pendingRecordsById(state, pendingId).some((record) =>
        valueMatchesDisclosureEffect(record, key)
      )
    ) {
      return true;
    }
    return stackRecordsForAction(state, action).some((record) =>
      valueMatchesDisclosureEffect(record, key)
    );
  });
}

export function publicDisclosureAutoDismissDelay(
  disclosure: PublicDisclosure,
  pendingCount: number,
  hasEffectTreeLegalActions: boolean
): number | null {
  if (hasEffectTreeLegalActions) return null;
  void pendingCount;
  if (
    disclosure.kind === "target_declared" &&
    !disclosure.results.some(isOffFieldPublicDisclosureMove)
  ) {
    return PUBLIC_DISCLOSURE_ARROW_PRESENTATION_MS;
  }
  return PUBLIC_DISCLOSURE_PRESENTATION_MS;
}

function maxPublicDisclosureSequence(
  disclosures: readonly PublicDisclosure[]
): number {
  return disclosures.reduce(
    (maxSequence, disclosure) => Math.max(maxSequence, disclosure.sequence),
    0
  );
}

function rememberedPublicDisclosureDismissedSequence(
  presentationContextKey: string | undefined
): number | undefined {
  return presentationContextKey
    ? publicDisclosureDismissedSequences.get(presentationContextKey)
    : undefined;
}

function initialPublicDisclosureDismissedSequence({
  presentationContextKey,
  suppressInitialPresentation,
  disclosures,
}: {
  presentationContextKey: string | undefined;
  suppressInitialPresentation: boolean | undefined;
  disclosures: readonly PublicDisclosure[];
}): number {
  const remembered = rememberedPublicDisclosureDismissedSequence(
    presentationContextKey
  );
  if (remembered !== undefined) return remembered;
  return suppressInitialPresentation
    ? maxPublicDisclosureSequence(disclosures)
    : 0;
}

function PublicDisclosurePresentation({
  state,
  viewerPlayerId,
  getDefinition,
  viewerLegalActions,
  viewerActionSequence,
  presentationContextKey,
  suppressInitialPresentation,
  suppressTargetDeclaredPresentation,
  getCardPresentationExitAnchor,
  onCardPresentationExit,
}: Pick<
  PublicDisclosurePanelProps,
  | "state"
  | "viewerPlayerId"
  | "getDefinition"
  | "viewerLegalActions"
  | "viewerActionSequence"
  | "presentationContextKey"
  | "suppressInitialPresentation"
  | "suppressTargetDeclaredPresentation"
  | "getCardPresentationExitAnchor"
  | "onCardPresentationExit"
>) {
  const disclosures = useMemo(
    () => state.publicDisclosures ?? [],
    [state.publicDisclosures]
  );
  const presentableDisclosures = useMemo(
    () =>
      disclosures.filter((disclosure) => {
        if (isContinuousTargetDisclosure(disclosure, state, getDefinition)) {
          return false;
        }
        if (disclosure.kind === "target_declared") {
          return suppressTargetDeclaredPresentation !== true;
        }
        return (
          isPublicDisclosureCardPresentationEligible(disclosure) &&
          publicDisclosurePresentationCards(disclosure, state, getDefinition)
            .length > 0
        );
      }),
    [disclosures, getDefinition, state, suppressTargetDeclaredPresentation]
  );
  const [dismissedThroughSequence, setDismissedThroughSequence] = useState(() =>
    initialPublicDisclosureDismissedSequence({
      presentationContextKey,
      suppressInitialPresentation,
      disclosures: presentableDisclosures,
    })
  );
  const active =
    presentableDisclosures.find(
      (disclosure) => disclosure.sequence > dismissedThroughSequence
    ) ?? null;
  const pendingCount = presentableDisclosures.filter(
    (disclosure) => disclosure.sequence > dismissedThroughSequence
  ).length;
  const previousViewerActionSequence = useRef(viewerActionSequence);
  const previousActiveSequence = useRef(active?.sequence);
  const [effectSourceAnchor, setEffectSourceAnchor] =
    useState<PublicDisclosureArrowAnchor | null>(null);
  const [exitingCardSequence, setExitingCardSequence] = useState<number | null>(
    null
  );
  const [cardExitAnchor, setCardExitAnchor] =
    useState<PublicDisclosureExitAnchor | null>(null);
  const captureEffectSourceAnchor = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) {
        setEffectSourceAnchor(null);
        return;
      }
      const rect = element.getBoundingClientRect();
      const next = {
        instanceId: active?.source?.instanceId ?? "effect-source",
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        width: rect.width,
        height: rect.height,
        label: "発揮元",
      };
      setEffectSourceAnchor((previous) =>
        previous?.instanceId === next.instanceId &&
        previous.x === next.x &&
        previous.y === next.y &&
        previous.width === next.width &&
        previous.height === next.height
          ? previous
          : next
      );
    },
    [active?.source?.instanceId]
  );

  const dismissThroughSequence = useCallback(
    (sequence: number) => {
      setDismissedThroughSequence(sequence);
      if (presentationContextKey) {
        const previous =
          publicDisclosureDismissedSequences.get(presentationContextKey) ?? 0;
        publicDisclosureDismissedSequences.set(
          presentationContextKey,
          Math.max(previous, sequence)
        );
      }
    },
    [presentationContextKey]
  );

  const beginDismiss = useCallback(
    (disclosure: PublicDisclosure) => {
      if (exitingCardSequence === disclosure.sequence) return;
      if (isPublicDisclosureCardPresentationEligible(disclosure)) {
        const anchor = getCardPresentationExitAnchor?.() ?? null;
        if (anchor) {
          setCardExitAnchor(anchor);
          setExitingCardSequence(disclosure.sequence);
          onCardPresentationExit?.();
          return;
        }
      }
      dismissThroughSequence(disclosure.sequence);
    },
    [
      dismissThroughSequence,
      exitingCardSequence,
      getCardPresentationExitAnchor,
      onCardPresentationExit,
    ]
  );

  useEffect(() => {
    if (!active) return;
    if (exitingCardSequence === active.sequence) return;
    const delay = publicDisclosureAutoDismissDelay(
      active,
      pendingCount,
      hasPublicDisclosureEffectTreeLegalAction(
        active,
        state,
        viewerLegalActions
      )
    );
    if (delay === null) return;
    const timeout = window.setTimeout(() => {
      beginDismiss(active);
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [
    active,
    beginDismiss,
    exitingCardSequence,
    pendingCount,
    state,
    viewerLegalActions,
  ]);

  useEffect(() => {
    const presentedSequence = previousActiveSequence.current;
    previousActiveSequence.current = active?.sequence;
    if (previousViewerActionSequence.current === viewerActionSequence) return;
    previousViewerActionSequence.current = viewerActionSequence;
    // Only dismiss what was already visible before the action. A disclosure
    // created by this very action must get its own presentation lifetime.
    if (!active || active.sequence !== presentedSequence) return;
    const timeout = window.setTimeout(() => beginDismiss(active), 0);
    return () => window.clearTimeout(timeout);
  }, [active, beginDismiss, viewerActionSequence]);

  useEffect(() => {
    if (!active || exitingCardSequence !== active.sequence) return;
    const timeout = window.setTimeout(() => {
      dismissThroughSequence(active.sequence);
      setExitingCardSequence(null);
      setCardExitAnchor(null);
    }, PUBLIC_DISCLOSURE_CARD_EXIT_MS);
    return () => window.clearTimeout(timeout);
  }, [active, dismissThroughSequence, exitingCardSequence]);

  useEffect(() => {
    if (!active || active.kind !== "target_declared") return;
    const elements = active.targets
      .filter(
        (target): target is typeof target & { instanceId: string } =>
          target.kind === "card" && target.instanceId !== undefined
      )
      .map((target) => elementForInstance(target.instanceId));
    for (const element of elements)
      element?.classList.add("public-disclosure-target");
    return () => {
      for (const element of elements)
        element?.classList.remove("public-disclosure-target");
    };
  }, [active]);

  if (!active) return null;
  // 盤面演出はレンダー済みのアンカーを読む。対象が場を離れて DOM が無ければ
  // 矢印を出さず、同じ record は公開情報ログだけに残す。
  const sourceAnchor = active.source?.instanceId
    ? anchorFor(active.source.instanceId, "発揮元")
    : null;
  const targetAnchors = active.targets
    .filter(
      (target): target is typeof target & { instanceId: string } =>
        target.kind === "card" && target.instanceId !== undefined
    )
    .map((target) =>
      anchorFor(
        target.instanceId,
        actionLabelText(target),
        targetArrowTone(target.actionLabel ?? "action_execute")
      )
    )
    .filter((anchor): anchor is PublicDisclosureArrowAnchor => anchor !== null);
  const fallbackSource = {
    x: window.innerWidth - 90,
    y: 92,
    width: 156,
    height: 152,
  };
  const source = effectSourceAnchor ??
    sourceAnchor ?? {
      instanceId: "source",
      ...fallbackSource,
      label: "発揮元",
    };
  const cardPresentation =
    isPublicDisclosureCardPresentationEligible(active) &&
    publicDisclosurePresentationCards(active, state, getDefinition).length >
      0 ? (
      <div
        className="public-disclosure-presentation public-disclosure-card-presentation-wrap"
        data-testid="public-disclosure-active"
      >
        <PublicDisclosureCardPresentation
          disclosure={active}
          state={state}
          viewerPlayerId={viewerPlayerId}
          getDefinition={getDefinition}
          exiting={exitingCardSequence === active.sequence}
          exitAnchor={cardExitAnchor}
        />
      </div>
    ) : null;
  if (active.kind !== "target_declared" || targetAnchors.length === 0)
    return cardPresentation;
  return (
    <>
      {cardPresentation}
      <div
        className="public-disclosure-presentation"
        data-testid="public-disclosure-active"
      >
        <PublicDisclosureEffectSource
          key={active.sequence}
          disclosure={active}
          state={state}
          viewerPlayerId={viewerPlayerId}
          getDefinition={getDefinition}
          captureAnchor={captureEffectSourceAnchor}
        />
        <svg
          className="public-disclosure-arrows"
          data-testid="public-disclosure-arrows"
        >
          <defs>
            <marker
              id="public-disclosure-arrowhead"
              markerWidth="8"
              markerHeight="8"
              refX="6"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L0,6 L7,3 z" />
            </marker>
          </defs>
          {targetAnchors.map((target, index) => {
            const geometry = buildPublicDisclosureArrowGeometry(
              source,
              target,
              index,
              { width: window.innerWidth, height: window.innerHeight }
            );
            return (
              <g key={target.instanceId}>
                <path
                  className="public-disclosure-arrow public-disclosure-arrow-halo"
                  d={geometry.path}
                  pathLength={1}
                />
                <path
                  className="public-disclosure-arrow public-disclosure-arrow-body"
                  d={geometry.path}
                  pathLength={1}
                  markerEnd="url(#public-disclosure-arrowhead)"
                />
                <path
                  className="public-disclosure-arrow public-disclosure-arrow-core"
                  d={geometry.path}
                  pathLength={1}
                />
                <g
                  className={`public-disclosure-target-tag public-disclosure-target-tag--${target.tone ?? "move"}`}
                >
                  <rect
                    x={geometry.labelCenter.x - geometry.labelWidth / 2}
                    y={geometry.labelCenter.y - 11}
                    width={geometry.labelWidth}
                    height={22}
                    rx={5}
                  />
                  <text
                    x={geometry.labelCenter.x}
                    y={geometry.labelCenter.y + 0.5}
                  >
                    {target.label}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>
      </div>
    </>
  );
}

function PublicDisclosureLogModal({
  state,
  viewerPlayerId,
  getDefinition,
  onClose,
}: Omit<
  PublicDisclosurePanelProps,
  "logOpen" | "onCloseLog" | "viewerLegalActions" | "viewerActionSequence"
> & {
  onClose: () => void;
}) {
  const [browseCards, setBrowseCards] = useState<{
    title: string;
    cards: ZoneBrowseSnapshotCard[];
  } | null>(null);
  const entries = useMemo(
    () =>
      [...(state.publicDisclosures ?? [])]
        .filter((disclosure) =>
          isPublicDisclosureLoggable(disclosure, state, getDefinition)
        )
        .sort((a, b) => b.sequence - a.sequence),
    [getDefinition, state]
  );
  return (
    <div
      className="zone-browse-overlay public-disclosure-log-overlay"
      onClick={onClose}
    >
      <section
        className="zone-browse-panel public-disclosure-log-panel"
        data-testid="public-disclosure-log-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="zone-browse-header">
          <h3 className="zone-browse-title">公開情報ログ</h3>
          <button
            className="zone-browse-close"
            onClick={onClose}
            aria-label="ログを閉じる"
          >
            ✕
          </button>
        </div>
        {entries.length === 0 ? (
          <p className="zone-browse-empty">公開情報はまだありません</p>
        ) : (
          <div className="public-disclosure-log-list">
            {entries.map((disclosure) => {
              const referencedCards = publicDisclosureReferencedCards(
                disclosure,
                state,
                getDefinition
              );
              return (
                <PublicDisclosureRenderer
                  key={disclosure.id}
                  disclosure={disclosure}
                  state={state}
                  viewerPlayerId={viewerPlayerId}
                  getDefinition={getDefinition}
                  {...(referencedCards.length > 0
                    ? {
                        onOpenCards: () =>
                          setBrowseCards({
                            title: `公開情報 #${disclosure.sequence}`,
                            cards: referencedCards,
                          }),
                      }
                    : {})}
                />
              );
            })}
          </div>
        )}
        {browseCards && (
          <ZoneBrowseModal
            state={state}
            snapshotCards={browseCards.cards}
            titleOverride={browseCards.title}
            getDefinition={getDefinition}
            onClose={() => setBrowseCards(null)}
            viewingPlayerId={viewerPlayerId}
          />
        )}
      </section>
    </div>
  );
}

export function PublicDisclosurePanel({
  state,
  viewerPlayerId,
  getDefinition,
  viewerLegalActions,
  viewerActionSequence,
  logOpen,
  onCloseLog,
  presentationContextKey,
  suppressInitialPresentation,
  suppressTargetDeclaredPresentation,
  getCardPresentationExitAnchor,
  onCardPresentationExit,
}: PublicDisclosurePanelProps) {
  const presentationKey = `${presentationContextKey ?? "local"}:${
    suppressInitialPresentation === true ? "suppress" : "show"
  }`;
  return (
    <>
      <PublicDisclosurePresentation
        key={presentationKey}
        state={state}
        viewerPlayerId={viewerPlayerId}
        getDefinition={getDefinition}
        viewerLegalActions={viewerLegalActions}
        viewerActionSequence={viewerActionSequence}
        {...(presentationContextKey !== undefined
          ? { presentationContextKey }
          : {})}
        {...(suppressInitialPresentation !== undefined
          ? { suppressInitialPresentation }
          : {})}
        {...(suppressTargetDeclaredPresentation !== undefined
          ? { suppressTargetDeclaredPresentation }
          : {})}
        {...(getCardPresentationExitAnchor !== undefined
          ? { getCardPresentationExitAnchor }
          : {})}
        {...(onCardPresentationExit !== undefined
          ? { onCardPresentationExit }
          : {})}
      />
      {logOpen && (
        <PublicDisclosureLogModal
          state={state}
          viewerPlayerId={viewerPlayerId}
          getDefinition={getDefinition}
          onClose={onCloseLog}
        />
      )}
    </>
  );
}
