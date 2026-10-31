import { getCardById } from "../card/card-lookup";
import { moveNormalCores, moveSoulCore } from "./core-system";
import type { EnterFieldCorePlacement } from "../zone/enter-field-placement-execution";
import {
  hasEnterFieldOnlyCorePlacementRestriction,
  hasIndependentCoreManagement,
  isCardTextCardState,
} from "../model";
import type {
  CardDefinition,
  GameState,
  NormalCoreContainer,
  SoulCoreContainer,
} from "../model";
import type { CardCostPaymentSource } from "./payment-system";

/**
 * draft 移動の用途タグ。GUI 側 facade が「どの選択モードで作られた draft か」を
 * 保持するために使う。`applyDraftCoreMoves` は enter-field 配置 preview と
 * 通常コア移動 preview の choke point を分けるために purpose を見る。
 * facade.commit 側で recompose する際の振り分けキーとしても必要。
 */
export type DraftCorePurpose =
  | "card_cost"
  | "placement"
  | "shoot"
  | "separation"
  | "core_move"
  | "trash_distribution"
  | "count_decrease"
  | "core_split"
  | "core_source_allocation";

export type DraftCoreMove =
  | {
      kind: "normal";
      from: NormalCoreContainer;
      to: NormalCoreContainer;
      amount: number;
      purpose: DraftCorePurpose;
      /** `core_split` purpose のとき、pending.destinations の index を保持する。 */
      coreSplitDestinationIndex?: number;
    }
  | {
      kind: "soul";
      playerId: string;
      from: SoulCoreContainer;
      to: SoulCoreContainer;
      purpose: DraftCorePurpose;
    };

/**
 * `state` に対して draft moves を順次適用した projection を返す純関数。
 *
 * - 既存プリミティブ (`moveNormalCores` / `moveSoulCore`) を順に呼び出すだけの
 *   薄いラッパー。SBA・継続効果再評価・トリガー誘発などの副作用は **行わない**。
 *   preview 表示用の派生 state を得ることが目的で、確定時は facade.commit から
 *   既存 LegalAction 経路 (またはプリミティブ直呼び) で正規の commit を行う。
 * - `state` を mutate しない。プリミティブ側が新しい `GameState` を返す契約に従う。
 * - draft 配列が空の場合は `state` をそのまま返す (参照同一性が維持される)。
 */
export function applyDraftCoreMoves(
  state: GameState,
  drafts: readonly DraftCoreMove[],
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): GameState {
  if (
    findManualCoreMoveViolation(
      state,
      drafts.filter((draft) => draft.purpose === "core_move"),
      getCardDefinitionById ?? (() => undefined)
    )
  ) {
    return state;
  }
  let currentState = state;

  for (const draft of drafts) {
    if (draft.purpose === "count_decrease" || draft.purpose === "core_split") {
      continue;
    }
    if (draft.kind === "normal") {
      const options =
        draft.purpose === "placement"
          ? { allowEnterFieldOnlyPlacementDestination: true }
          : undefined;
      currentState = moveNormalCores(
        currentState,
        draft.from,
        draft.to,
        draft.amount,
        getCardDefinitionById,
        options
      );
    } else {
      const options =
        draft.purpose === "placement"
          ? { allowEnterFieldOnlyPlacementDestination: true }
          : undefined;
      currentState = moveSoulCore(
        currentState,
        draft.playerId,
        draft.from,
        draft.to,
        1,
        getCardDefinitionById,
        options
      );
    }
  }

  return currentState;
}

/**
 * 手動コア移動 draft が独立コア管理カード（創界神 / 導界者 / 創界石）に
 * コアを置く・引き抜くものになっていないか検証した結果。
 *
 * ルール正源 `10_rules/08d_grandwalker-nexus.md`:
 * - 創界神「コアは『創界神ネクサス』対象の効果（主に《神託》）でのみ置ける。
 *   通常コア移動効果の対象外」「ソウルコア配置不可」
 * - 創界石「コアは解封と創界石ネクサス対象の効果でしか置けず、上のコアは
 *   創界石対象の効果しか受けず移動できない」
 *
 * メインステップの手動コア移動はいずれの「対象にした効果」でもないため、
 * これらのカードを from / to にできない。
 */
export interface ManualCoreMoveViolation {
  /** 違反となったコンテナがソース側か行き先側か。 */
  side: "from" | "to";
  /**
   * 違反対象カードの instanceId。カードを伴わない違反（ソウルコア→ボイド等）では
   * 省略される。
   */
  instanceId?: string;
  /** エラーメッセージ（REST 400 / GUI 拒否文言の SSOT）。 */
  reason: string;
}

/** 手動コア移動のカード選択可否。GUI の候補・preview・REST で共有する。 */
export function getManualCoreMoveCardBlockReason(
  state: GameState,
  instanceId: string,
  side: "from" | "to",
  getDefinitionById: (definitionId: string) => CardDefinition | undefined
): string | null {
  const card = getCardById(state, instanceId);
  if (!card) return null;
  if (isCardTextCardState(card, state)) {
    return `カード状態のカードは手動コア移動の移動元・配置先にできません（instance=${instanceId}）`;
  }
  const def = getDefinitionById(card.definitionId);
  if (def && hasIndependentCoreManagement(def)) {
    return `独立コア管理カード（創界神 / 導界者 / 創界石）${
      side === "to" ? "へのコア配置" : "からのコア移動"
    }は手動コア移動では行えません（対象の効果でのみ可。instance=${instanceId}）`;
  }
  if (side === "to" && def && hasEnterFieldOnlyCorePlacementRestriction(def)) {
    return `このカードへのコア配置は出すとき以外では行えません（instance=${instanceId}）`;
  }
  return null;
}

/**
 * `applyDraftCoreMoves` で適用する前に、手動コア移動 draft が独立コア管理カード
 * （創界神 / 導界者 / 創界石）を from / to に含まないか検証する純関数。
 *
 * 違反があれば最初の 1 件を返し、無ければ `null`。独立コア管理カードの判定述語は
 * model.ts の `hasIndependentCoreManagement`（SSOT。汎用コア移動ソース除外・離脱時
 * コア→ボイドと同一述語）に委譲する。
 *
 * さらにソウルコア固有の禁止先も検査する。`10_rules/06_core-system.md:69`
 * 「ボイドは常に不可。explicit 指定があってもソウルコアをボイドに置くことはできない」
 * に基づき、手動コア移動でソウルコアをボイドへ送る draft を拒否する
 * （ライフ / 創界神 / 創界石は generic 不可・explicit 可で裁定が分かれるため、
 * 全 source で一致する硬制約のボイドのみをここで扱う。
 * [[project_soul_core_movement_generic]]）。
 *
 * REST `core-move` endpoint と GUI core-selection の双方から呼び、同じ拒否条件を
 * 共有する（P3-90 / P3-93）。
 */
export function findManualCoreMoveViolation(
  state: GameState,
  drafts: readonly DraftCoreMove[],
  getDefinitionById: (definitionId: string) => CardDefinition | undefined
): ManualCoreMoveViolation | null {
  for (const draft of drafts) {
    // ソウルコアをボイドへ送る手動移動は常に不可（06_core-system.md:69）。
    if (draft.kind === "soul" && draft.to.kind === "void") {
      return {
        side: "to",
        reason:
          "ソウルコアをボイドに置くことはできません（手動コア移動では常に不可。06_core-system.md）",
      };
    }
    for (const side of ["from", "to"] as const) {
      const container = draft[side];
      if (container.kind !== "card") continue;
      const reason = getManualCoreMoveCardBlockReason(
        state,
        container.instanceId,
        side,
        getDefinitionById
      );
      if (reason) {
        return {
          side,
          instanceId: container.instanceId,
          reason,
        };
      }
    }
  }
  return null;
}

/**
 * `recomposeSummonLegalAction` の戻り値。`applyLegalAction` (または
 * `playSummonAsAction` / `placeNexusAsAction`) に渡す引数のうち、draft から
 * 機械的に再構築できるものだけを返す。
 */
export interface RecomposedSummonPayload {
  paymentSources: readonly CardCostPaymentSource[];
  summonEnterFieldCorePlacements: readonly EnterFieldCorePlacement[];
}

interface PaymentAccumulator {
  normalAmount: number;
  hasSoul: boolean;
  /** null = reserve / それ以外 = card */
  instanceId: string | null;
  destination?: "trash" | "void";
}

interface PlacementAccumulator {
  normalAmount: number;
  hasSoul: boolean;
  sourceKind: "reserve" | "card" | "trash" | "void";
  /** card source のときだけ instanceId */
  instanceId: string | null;
}

function paymentSourceKey(
  container: NormalCoreContainer | SoulCoreContainer
): { key: string; instanceId: string | null } | null {
  if (container.kind === "reserve") {
    return { key: "reserve", instanceId: null };
  }
  if (container.kind === "card") {
    return {
      key: `card:${container.instanceId}`,
      instanceId: container.instanceId,
    };
  }
  return null;
}

function placementSourceKey(
  container: NormalCoreContainer | SoulCoreContainer
): {
  key: string;
  sourceKind: "reserve" | "card" | "trash" | "void";
  instanceId: string | null;
} | null {
  if (container.kind === "reserve") {
    return { key: "reserve", sourceKind: "reserve", instanceId: null };
  }
  if (container.kind === "card") {
    return {
      key: `card:${container.instanceId}`,
      sourceKind: "card",
      instanceId: container.instanceId,
    };
  }
  if (container.kind === "void") {
    return { key: "void", sourceKind: "void", instanceId: null };
  }
  if (container.kind === "trash") {
    return { key: "trash", sourceKind: "trash", instanceId: null };
  }
  return null;
}

function coreDistributionSourceKey(
  container: NormalCoreContainer | SoulCoreContainer
): string | null {
  if (container.kind === "reserve") return "reserve";
  if (container.kind === "trash") return "trash";
  if (container.kind === "void") return "void";
  if (container.kind === "life") return "life";
  if (container.kind === "card") return `field:${container.instanceId}`;
  return null;
}

/**
 * Phase 3 入口 gate (検証計画 #15) で使う recompose 関数。
 *
 * `card_cost` purpose の draft を `CardCostPaymentSource[]` に、
 * `placement` purpose の draft を `EnterFieldCorePlacement[]` に変換する。
 *
 * 仕様:
 * - source ごとの累積 (同じ reserve/card への複数 draft) は 1 件にまとめる。
 * - normal + soul が同じ source から出る場合は単一の payment/placement 内で
 *   `includeSoulCore: true` フラグまたは `*_soul` placement で表現する。
 * - 既存 `BattleScreen.tsx` の組み立てロジックと byte-equal な payload を生成する
 *   (順序: 出現順 / payment は normal+soul を 1 件に集約 / placement は normal を
 *   先・soul を後に出力)。
 * - `card_cost` / `placement` 以外の purpose タグは無視する。
 *
 * 例外:
 * - card_cost draft の `to` が `trash` 以外の場合は throw (recompose 文脈外)。
 * - placement draft の `to` が同一の card 以外の場合は throw (複数 destination は
 *   single summon の文脈に存在しない)。
 */
export function recomposeSummonLegalAction(
  drafts: readonly DraftCoreMove[]
): RecomposedSummonPayload {
  const paymentOrder: string[] = [];
  const paymentMap = new Map<string, PaymentAccumulator>();
  const placementOrder: string[] = [];
  const placementMap = new Map<string, PlacementAccumulator>();
  let placementDestinationInstanceId: string | null = null;

  for (const draft of drafts) {
    if (draft.purpose === "card_cost") {
      if (draft.to.kind !== "trash") {
        throw new Error(
          `recomposeSummonLegalAction: card_cost draft must target trash (got ${draft.to.kind})`
        );
      }
      const sourceKey = paymentSourceKey(draft.from);
      if (!sourceKey) {
        throw new Error(
          `recomposeSummonLegalAction: card_cost draft has unsupported source kind ${draft.from.kind}`
        );
      }
      let acc = paymentMap.get(sourceKey.key);
      if (!acc) {
        acc = {
          normalAmount: 0,
          hasSoul: false,
          instanceId: sourceKey.instanceId,
        };
        paymentMap.set(sourceKey.key, acc);
        paymentOrder.push(sourceKey.key);
      }
      if (draft.kind === "normal") {
        acc.normalAmount += draft.amount;
      } else {
        if (acc.hasSoul) {
          throw new Error(
            `recomposeSummonLegalAction: duplicate soul-core cost draft for source ${sourceKey.key}`
          );
        }
        acc.hasSoul = true;
      }
      continue;
    }
    if (draft.purpose === "placement") {
      if (draft.to.kind !== "card") {
        throw new Error(
          `recomposeSummonLegalAction: placement draft must target a card (got ${draft.to.kind})`
        );
      }
      if (placementDestinationInstanceId === null) {
        placementDestinationInstanceId = draft.to.instanceId;
      } else if (placementDestinationInstanceId !== draft.to.instanceId) {
        throw new Error(
          `recomposeSummonLegalAction: placement drafts must share one destination instanceId`
        );
      }
      const sourceKey = placementSourceKey(draft.from);
      if (!sourceKey) {
        throw new Error(
          `recomposeSummonLegalAction: placement draft has unsupported source kind ${draft.from.kind}`
        );
      }
      let acc = placementMap.get(sourceKey.key);
      if (!acc) {
        acc = {
          normalAmount: 0,
          hasSoul: false,
          sourceKind: sourceKey.sourceKind,
          instanceId: sourceKey.instanceId,
        };
        placementMap.set(sourceKey.key, acc);
        placementOrder.push(sourceKey.key);
      }
      if (draft.kind === "normal") {
        acc.normalAmount += draft.amount;
      } else {
        if (acc.hasSoul) {
          throw new Error(
            `recomposeSummonLegalAction: duplicate soul-core placement draft for source ${sourceKey.key}`
          );
        }
        acc.hasSoul = true;
      }
      continue;
    }
    // shoot / separation / core_move / trash_distribution は本関数の対象外
  }

  const paymentSources: CardCostPaymentSource[] = [];
  for (const key of paymentOrder) {
    const acc = paymentMap.get(key)!;
    const totalAmount = acc.normalAmount + (acc.hasSoul ? 1 : 0);
    if (totalAmount === 0) continue;
    if (acc.instanceId === null) {
      paymentSources.push({
        kind: "reserve",
        amount: totalAmount,
        ...(acc.hasSoul ? { includeSoulCore: true } : {}),
      });
    } else {
      paymentSources.push({
        kind: "card",
        instanceId: acc.instanceId,
        amount: totalAmount,
        ...(acc.hasSoul ? { includeSoulCore: true } : {}),
      });
    }
  }

  const summonEnterFieldCorePlacements: EnterFieldCorePlacement[] = [];
  for (const key of placementOrder) {
    const acc = placementMap.get(key)!;
    if (acc.sourceKind === "reserve") {
      if (acc.normalAmount > 0) {
        summonEnterFieldCorePlacements.push({
          kind: "reserve_normal",
          amount: acc.normalAmount,
        });
      }
      if (acc.hasSoul) {
        summonEnterFieldCorePlacements.push({ kind: "reserve_soul" });
      }
    } else if (acc.sourceKind === "card") {
      if (acc.instanceId === null) {
        throw new Error("card placement source missing instanceId");
      }
      if (acc.normalAmount > 0) {
        summonEnterFieldCorePlacements.push({
          kind: "card_normal",
          instanceId: acc.instanceId,
          amount: acc.normalAmount,
        });
      }
      if (acc.hasSoul) {
        summonEnterFieldCorePlacements.push({
          kind: "card_soul",
          instanceId: acc.instanceId,
        });
      }
    } else if (acc.sourceKind === "void") {
      if (acc.hasSoul) {
        throw new Error("void placement cannot include soul core");
      }
      if (acc.normalAmount > 0) {
        summonEnterFieldCorePlacements.push({
          kind: "void_normal",
          amount: acc.normalAmount,
        });
      }
    } else {
      if (acc.normalAmount > 0) {
        summonEnterFieldCorePlacements.push({
          kind: "trash_normal",
          amount: acc.normalAmount,
        });
      }
      if (acc.hasSoul) {
        summonEnterFieldCorePlacements.push({ kind: "trash_soul" });
      }
    }
  }

  return {
    paymentSources,
    summonEnterFieldCorePlacements,
  };
}

/**
 * P3-49 placement_multi: 複数体同時召喚 placement の per-target 集約結果。
 * `apply_pending_multi_placement` の `multiPlacementAllocations` パラメータに
 * 渡す形式。
 */
export interface RecomposedMultiPlacementPayload {
  multiPlacementAllocations: ReadonlyArray<{
    destinationInstanceId: string;
    placements: readonly EnterFieldCorePlacement[];
  }>;
}

/**
 * P3-49 placement_multi: `placement` purpose draft を destination ごとに集約する。
 *
 * `recomposeSummonLegalAction` は単一 destination 前提で multi destination を throw するが、
 * 本関数は per-destination で `EnterFieldCorePlacement[]` を構築する。
 *
 * 仕様:
 * - 同一 source × 同一 destination の draft は 1 件にまとめる (normal+soul 折り畳み)
 * - destination 出現順を保つ
 * - `placement` 以外の purpose タグは無視する
 *
 * 例外:
 * - `placement` draft の `to` が `card` 以外の場合は throw
 */
export function recomposeMultiPlacement(
  drafts: readonly DraftCoreMove[]
): RecomposedMultiPlacementPayload {
  const perDestination = new Map<
    string,
    {
      order: string[];
      map: Map<string, PlacementAccumulator>;
    }
  >();

  for (const draft of drafts) {
    if (draft.purpose !== "placement") continue;
    if (draft.to.kind !== "card") {
      throw new Error(
        `recomposeMultiPlacement: placement draft must target a card (got ${draft.to.kind})`
      );
    }
    const dest = draft.to.instanceId;
    let bucket = perDestination.get(dest);
    if (!bucket) {
      bucket = { order: [], map: new Map() };
      perDestination.set(dest, bucket);
    }
    const sourceKey = placementSourceKey(draft.from);
    if (!sourceKey) {
      throw new Error(
        `recomposeMultiPlacement: placement draft has unsupported source kind ${draft.from.kind}`
      );
    }
    let acc = bucket.map.get(sourceKey.key);
    if (!acc) {
      acc = {
        normalAmount: 0,
        hasSoul: false,
        sourceKind: sourceKey.sourceKind,
        instanceId: sourceKey.instanceId,
      };
      bucket.map.set(sourceKey.key, acc);
      bucket.order.push(sourceKey.key);
    }
    if (draft.kind === "normal") {
      acc.normalAmount += draft.amount;
    } else {
      if (acc.hasSoul) {
        throw new Error(
          `recomposeMultiPlacement: duplicate soul-core placement draft for ${dest}/${sourceKey.key}`
        );
      }
      acc.hasSoul = true;
    }
  }

  const multiPlacementAllocations: Array<{
    destinationInstanceId: string;
    placements: readonly EnterFieldCorePlacement[];
  }> = [];
  for (const [destinationInstanceId, bucket] of perDestination) {
    const placements: EnterFieldCorePlacement[] = [];
    for (const key of bucket.order) {
      const acc = bucket.map.get(key)!;
      if (acc.sourceKind === "reserve") {
        if (acc.normalAmount > 0) {
          placements.push({
            kind: "reserve_normal",
            amount: acc.normalAmount,
          });
        }
        if (acc.hasSoul) {
          placements.push({ kind: "reserve_soul" });
        }
      } else if (acc.sourceKind === "card") {
        if (acc.instanceId === null) {
          throw new Error("card placement source missing instanceId");
        }
        if (acc.normalAmount > 0) {
          placements.push({
            kind: "card_normal",
            instanceId: acc.instanceId,
            amount: acc.normalAmount,
          });
        }
        if (acc.hasSoul) {
          placements.push({
            kind: "card_soul",
            instanceId: acc.instanceId,
          });
        }
      } else if (acc.sourceKind === "void") {
        if (acc.hasSoul) {
          throw new Error("void placement cannot include soul core");
        }
        if (acc.normalAmount > 0) {
          placements.push({
            kind: "void_normal",
            amount: acc.normalAmount,
          });
        }
      } else {
        if (acc.normalAmount > 0) {
          placements.push({
            kind: "trash_normal",
            amount: acc.normalAmount,
          });
        }
        if (acc.hasSoul) {
          placements.push({ kind: "trash_soul" });
        }
      }
    }
    multiPlacementAllocations.push({ destinationInstanceId, placements });
  }

  return { multiPlacementAllocations };
}

/**
 * `recomposeMagicLegalAction` の戻り値。マジック使用 LegalAction (`use_magic` /
 * effect 経由 `pay_cost`) では placement が存在しないため `paymentSources` のみ。
 */
export interface RecomposedMagicPayload {
  paymentSources: readonly CardCostPaymentSource[];
}

/**
 * Phase 3 サブステップ #16 (検証計画) で使う recompose 関数。
 *
 * `card_cost` purpose の draft を `CardCostPaymentSource[]` に集約する。
 * 仕様は `recomposeSummonLegalAction` の cost 部分と同等 (集約・順序保持・
 * normal+soul 折り畳み)。マジック / pay_cost / アクセル / チェンジのコスト
 * 支払い stage で使うことを想定。
 *
 * `placement` 等 magic 文脈外の purpose は無視する。
 *
 * 例外: `card_cost` draft の `to` が `trash` / `void` 以外の場合は throw。
 */
export function recomposeMagicLegalAction(
  drafts: readonly DraftCoreMove[]
): RecomposedMagicPayload {
  const paymentOrder: string[] = [];
  const paymentMap = new Map<string, PaymentAccumulator>();

  for (const draft of drafts) {
    if (draft.purpose !== "card_cost") continue;
    if (draft.to.kind !== "trash" && draft.to.kind !== "void") {
      throw new Error(
        `recomposeMagicLegalAction: card_cost draft must target trash or void (got ${draft.to.kind})`
      );
    }
    const sourceKey = paymentSourceKey(draft.from);
    if (!sourceKey) {
      throw new Error(
        `recomposeMagicLegalAction: card_cost draft has unsupported source kind ${draft.from.kind}`
      );
    }
    if (sourceKey.instanceId === null && draft.to.kind === "void") {
      throw new Error(
        `recomposeMagicLegalAction: reserve card_cost draft cannot target void`
      );
    }
    const destination = draft.to.kind;
    const paymentKey =
      sourceKey.instanceId === null
        ? sourceKey.key
        : `${sourceKey.key}:${destination}`;
    let acc = paymentMap.get(paymentKey);
    if (!acc) {
      acc = {
        normalAmount: 0,
        hasSoul: false,
        instanceId: sourceKey.instanceId,
        destination,
      };
      paymentMap.set(paymentKey, acc);
      paymentOrder.push(paymentKey);
    }
    if (draft.kind === "normal") {
      acc.normalAmount += draft.amount;
    } else {
      if (acc.hasSoul) {
        throw new Error(
          `recomposeMagicLegalAction: duplicate soul-core cost draft for source ${paymentKey}`
        );
      }
      acc.hasSoul = true;
    }
  }

  const paymentSources: CardCostPaymentSource[] = [];
  for (const key of paymentOrder) {
    const acc = paymentMap.get(key)!;
    const totalAmount = acc.normalAmount + (acc.hasSoul ? 1 : 0);
    if (totalAmount === 0) continue;
    if (acc.instanceId === null) {
      paymentSources.push({
        kind: "reserve",
        amount: totalAmount,
        ...(acc.hasSoul ? { includeSoulCore: true } : {}),
      });
    } else {
      paymentSources.push({
        kind: "card",
        instanceId: acc.instanceId,
        amount: totalAmount,
        ...(acc.hasSoul ? { includeSoulCore: true } : {}),
        ...(acc.destination === "void" ? { destination: "void" as const } : {}),
      });
    }
  }

  return { paymentSources };
}

/**
 * `recomposeCoreShootLegalAction` の戻り値。`resolve_pending_core_shoot` /
 * use_magic 経由のコアシュート LegalAction で `applyLegalAction` に渡す
 * `coreShootDistribution` (= source 別の通常コア取り出し量) と
 * `coreShootSoulCoreInstanceId` (= ソウルコアを取り出す source カード) を返す。
 */
export interface RecomposedCoreShootPayload {
  coreShootDistribution: Record<string, number>;
  coreShootSoulCoreInstanceId?: string;
}

/**
 * Phase 3 サブステップ #17 で使う recompose 関数。
 *
 * `shoot` purpose の draft を `coreShootDistribution` Record に集約する。
 * source は **必ず field card** (=`from.kind === "card"`)。reserve からのシュートは
 * ない。destination は engine 側 pending state の `toKind` で決まるため
 * 本関数は検査しない (draft 間で一貫している前提だが byte-equal な aggregate のみ要求)。
 *
 * 仕様:
 * - 同じ source instance への複数 draft は 1 件にまとめる (amount 合算)。
 * - `kind: "soul"` の draft は最大 1 件のみ許容し、`coreShootSoulCoreInstanceId`
 *   として返す。複数あれば throw (engine 契約上 1 件しか受け取れない)。
 * - `shoot` 以外の purpose は無視する。
 * - フィールド/リザーブ横断 (BSTH001-X01): source が `{kind:"reserve", playerId}`
 *   の normal draft は `reserve:<playerId>` sentinel キーに集約する。apply 側が
 *   このキーをリザーブコア減算として扱う。
 *
 * 例外:
 * - `from.kind` が card / reserve 以外の場合 throw。
 * - 複数 soul draft で throw。
 */
export function recomposeCoreShootLegalAction(
  drafts: readonly DraftCoreMove[]
): RecomposedCoreShootPayload {
  const distribution: Record<string, number> = {};
  let soulSourceInstanceId: string | undefined;

  for (const draft of drafts) {
    if (draft.purpose !== "shoot") continue;
    if (draft.from.kind !== "card" && draft.from.kind !== "reserve") {
      throw new Error(
        "recomposeCoreShootLegalAction: shoot draft source must be a card or reserve"
      );
    }
    const sourceInstanceId =
      draft.from.kind === "card"
        ? draft.from.instanceId
        : "reserve:" + draft.from.playerId;
    if (draft.kind === "normal") {
      distribution[sourceInstanceId] =
        (distribution[sourceInstanceId] ?? 0) + draft.amount;
    } else {
      if (soulSourceInstanceId !== undefined) {
        throw new Error(
          `recomposeCoreShootLegalAction: only one soul-core draft is allowed (got duplicate from ${sourceInstanceId})`
        );
      }
      soulSourceInstanceId = sourceInstanceId;
    }
  }

  return {
    coreShootDistribution: distribution,
    ...(soulSourceInstanceId !== undefined
      ? { coreShootSoulCoreInstanceId: soulSourceInstanceId }
      : {}),
  };
}

/**
 * `recomposeBraveSeparationLegalAction` の戻り値。
 * - `separateCoreDistribution`: source (`reserve` または `card:instanceId`) 別の
 *   通常コア補填量。`applyLegalAction({kind:"brave_separate", ...})` に渡す。
 * - `separationSoulCoreSource`: ソウルコアを補填する source キー (engine 側で
 *   `moveSoulCore` を別途呼び出すために必要)。
 * - `braveInstanceId`: 全 draft が共有する補填先カード ID (recompose の妥当性
 *   検査結果)。caller (BattleScreen) が既に持っている値と一致確認できるよう返す。
 */
export interface RecomposedBraveSeparationPayload {
  separateCoreDistribution: Record<string, number>;
  separationSoulCoreSource?: string;
  braveInstanceId: string | null;
}

/**
 * Phase 3 サブステップ #18 で使う recompose 関数。
 *
 * `separation` purpose の draft を `separateCoreDistribution` Record に集約する。
 * source キーは reserve→`"reserve"` / card→`instanceId` の文字列 (BattleScreen の
 * 既存 `pendingSeparation.coreDistribution` に揃える)。
 *
 * 仕様:
 * - 全 draft の `to` は同一の card (= ブレイヴ補填先) でなければならない。
 * - `kind: "soul"` の draft は最大 1 件まで。複数あれば throw。
 * - source-key が同一の複数 normal draft は amount 合算。
 *
 * 例外:
 * - `to.kind !== "card"` の draft で throw。
 * - `to.instanceId` が draft 間で食い違うと throw。
 * - 複数 soul draft で throw。
 */
export function recomposeBraveSeparationLegalAction(
  drafts: readonly DraftCoreMove[]
): RecomposedBraveSeparationPayload {
  const distribution: Record<string, number> = {};
  let soulSourceKey: string | undefined;
  let braveInstanceId: string | null = null;

  for (const draft of drafts) {
    if (draft.purpose !== "separation") continue;
    if (draft.to.kind !== "card") {
      throw new Error(
        `recomposeBraveSeparationLegalAction: separation draft must target a card (got ${draft.to.kind})`
      );
    }
    if (braveInstanceId === null) {
      braveInstanceId = draft.to.instanceId;
    } else if (braveInstanceId !== draft.to.instanceId) {
      throw new Error(
        `recomposeBraveSeparationLegalAction: separation drafts must share one brave instanceId`
      );
    }
    let sourceKey: string;
    if (draft.from.kind === "reserve") {
      sourceKey = "reserve";
    } else if (draft.from.kind === "card") {
      sourceKey = draft.from.instanceId;
    } else {
      throw new Error(
        `recomposeBraveSeparationLegalAction: separation draft has unsupported source kind ${draft.from.kind}`
      );
    }

    if (draft.kind === "normal") {
      distribution[sourceKey] = (distribution[sourceKey] ?? 0) + draft.amount;
    } else {
      if (soulSourceKey !== undefined) {
        throw new Error(
          `recomposeBraveSeparationLegalAction: only one soul-core draft is allowed`
        );
      }
      soulSourceKey = sourceKey;
    }
  }

  return {
    separateCoreDistribution: distribution,
    ...(soulSourceKey !== undefined
      ? { separationSoulCoreSource: soulSourceKey }
      : {}),
    braveInstanceId,
  };
}

/**
 * `recomposeTrashDistributionLegalAction` の戻り値。
 * - `coreDistributionAllocations`: 配分先カード instanceId ごとの通常コア配置量。
 * - `coreDistributionSoulCoreAllocations`: ソウルコア配置数の宛先別配分。
 * - `coreDistributionSoulCoreInstanceId`: 旧 UI 互換の単一ソウルコア配置先。
 * - `coreDistributionSourceAllocations`: P3-47 F-5 multi-source 用の
 *   ソース別取得量 (key = "reserve" / "trash" / "life" / `field:<instanceId>`)。
 *   単一ソース (BSTH01-M01 trash) のみで構成されている場合は省略可能。
 * - `coreDistributionSoulCoreSourceAllocations`: P3-47 F-5 multi-source 用の
 *   ソウルコア source 別取得量。key 規則は `coreDistributionSourceAllocations` と同じ。
 */
export interface RecomposedTrashDistributionPayload {
  coreDistributionAllocations: Record<string, number>;
  coreDistributionSoulCoreAllocations?: Record<string, number>;
  coreDistributionSoulCoreInstanceId?: string;
  coreDistributionSourceAllocations?: Record<string, number>;
  coreDistributionSoulCoreSourceAllocations?: Record<string, number>;
}

export interface RecomposedCoreSplitPayload {
  coreSplitDistribution: readonly number[];
}

export interface RecomposedCoreSourceAllocationPayload {
  coreSourceAllocations: Record<string, number>;
  coreSourceSoulCoreInstanceId?: string;
}

function sameNormalContainer(
  a: NormalCoreContainer,
  b: NormalCoreContainer
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "card" && b.kind === "card") {
    return a.instanceId === b.instanceId;
  }
  if (
    (a.kind === "reserve" ||
      a.kind === "trash" ||
      a.kind === "life" ||
      a.kind === "void") &&
    (b.kind === "reserve" ||
      b.kind === "trash" ||
      b.kind === "life" ||
      b.kind === "void")
  ) {
    return a.playerId === b.playerId;
  }
  return true;
}

export function recomposeCoreSplitLegalAction(
  drafts: readonly DraftCoreMove[],
  destinations: readonly NormalCoreContainer[]
): RecomposedCoreSplitPayload {
  const distribution = destinations.map(() => 0);

  for (const draft of drafts) {
    if (draft.purpose !== "core_split") continue;
    if (draft.kind !== "normal") {
      throw new Error(
        "recomposeCoreSplitLegalAction: soul draft is unsupported"
      );
    }
    const index =
      draft.coreSplitDestinationIndex !== undefined
        ? draft.coreSplitDestinationIndex
        : destinations.findIndex((dest) => sameNormalContainer(draft.to, dest));
    if (index < 0) {
      throw new Error(
        `recomposeCoreSplitLegalAction: unsupported destination ${draft.to.kind}`
      );
    }
    if (index >= destinations.length) {
      throw new Error(
        `recomposeCoreSplitLegalAction: destination index ${index} is out of range`
      );
    }
    distribution[index] = (distribution[index] ?? 0) + draft.amount;
  }

  return { coreSplitDistribution: distribution };
}

/** 盤面コアの識別子。ゾーンの所属を落とさず候補・HUD・送信で共有する。 */
export function coreContainerId(container: NormalCoreContainer): string {
  return container.kind === "card"
    ? container.instanceId
    : `${container.kind}:${container.playerId}`;
}

export function recomposeCoreSourceAllocationLegalAction(
  drafts: readonly DraftCoreMove[],
  candidateIdsByContainerId?: Readonly<Record<string, string>>
): RecomposedCoreSourceAllocationPayload {
  const coreSourceAllocations: Record<string, number> = {};
  let coreSourceSoulCoreInstanceId: string | undefined;
  for (const draft of drafts) {
    if (draft.purpose !== "core_source_allocation") continue;
    if (
      !candidateIdsByContainerId &&
      draft.from.kind !== "card" &&
      draft.from.kind !== "reserve"
    ) {
      throw new Error(
        "recomposeCoreSourceAllocationLegalAction: source must be a card or reserve"
      );
    }
    const id = candidateIdsByContainerId
      ? candidateIdsByContainerId[
          coreContainerId(draft.from as NormalCoreContainer)
        ]
      : draft.from.kind === "card"
        ? draft.from.instanceId
        : "reserve";
    if (id === undefined)
      throw new Error("core source is not a pending candidate");
    if (draft.kind === "soul") {
      if (coreSourceSoulCoreInstanceId !== undefined) {
        throw new Error(
          "recomposeCoreSourceAllocationLegalAction: only one soul core is supported"
        );
      }
      coreSourceSoulCoreInstanceId = id;
    } else {
      coreSourceAllocations[id] =
        (coreSourceAllocations[id] ?? 0) + draft.amount;
    }
  }
  return {
    coreSourceAllocations,
    ...(coreSourceSoulCoreInstanceId !== undefined
      ? { coreSourceSoulCoreInstanceId }
      : {}),
  };
}

/**
 * Phase 3 サブステップ #19 で使う recompose 関数。
 *
 * `trash_distribution` purpose の draft を、配分先カード ID をキーとした
 * Record に集約する。
 *
 * 仕様:
 * - 同じ destination card への複数 normal draft は amount 合算。
 * - `kind: "soul"` の draft は destination card ごとの数に合算し、
 *   `coreDistributionSoulCoreAllocations` として返す。
 * - soul draft の宛先が 1 種だけなら旧 UI 互換の
 *   `coreDistributionSoulCoreInstanceId` も併記する。
 * - `trash_distribution` 以外の purpose は無視する。
 * - P3-47 F-5: source は trash / reserve / void / life / card (= 自分 field カード) を許容。
 *   各 source 取得量は `coreDistributionSourceAllocations` /
 *   `coreDistributionSoulCoreSourceAllocations` に集約する。
 *
 * 例外:
 * - `to.kind !== "card"` で throw。
 * - サポート外の `from.kind` で throw。
 */
export function recomposeTrashDistributionLegalAction(
  drafts: readonly DraftCoreMove[]
): RecomposedTrashDistributionPayload {
  const allocations: Record<string, number> = {};
  const soulCoreAllocations: Record<string, number> = {};
  const sourceAllocations: Record<string, number> = {};
  const soulSourceAllocations: Record<string, number> = {};
  let sawAnyNormalDraft = false;
  let sawAnySoulDraft = false;

  for (const draft of drafts) {
    if (draft.purpose !== "trash_distribution") continue;
    if (draft.to.kind !== "card") {
      throw new Error(
        `recomposeTrashDistributionLegalAction: trash_distribution draft must target a card (got ${draft.to.kind})`
      );
    }
    const destInstanceId = draft.to.instanceId;
    if (draft.kind === "normal") {
      allocations[destInstanceId] =
        (allocations[destInstanceId] ?? 0) + draft.amount;
      sawAnyNormalDraft = true;
      // P3-47 F-5: source 別取得量
      const sourceKey = coreDistributionSourceKey(draft.from);
      if (!sourceKey) {
        throw new Error(
          `recomposeTrashDistributionLegalAction: unsupported draft source ${draft.from.kind}`
        );
      }
      sourceAllocations[sourceKey] =
        (sourceAllocations[sourceKey] ?? 0) + draft.amount;
    } else {
      soulCoreAllocations[destInstanceId] =
        (soulCoreAllocations[destInstanceId] ?? 0) + 1;
      const sourceKey = coreDistributionSourceKey(draft.from);
      if (!sourceKey) {
        throw new Error(
          `recomposeTrashDistributionLegalAction: unsupported soul draft source ${draft.from.kind}`
        );
      }
      soulSourceAllocations[sourceKey] =
        (soulSourceAllocations[sourceKey] ?? 0) + 1;
      sawAnySoulDraft = true;
    }
  }

  const soulDestIds = Object.keys(soulCoreAllocations).filter(
    (id) => (soulCoreAllocations[id] ?? 0) > 0
  );

  return {
    coreDistributionAllocations: allocations,
    ...(sawAnySoulDraft
      ? { coreDistributionSoulCoreAllocations: soulCoreAllocations }
      : {}),
    ...(soulDestIds.length === 1
      ? { coreDistributionSoulCoreInstanceId: soulDestIds[0] }
      : {}),
    // 通常 draft が 1 件でもあれば常に source 別合計を返す (multi-source apply 用)。
    // single-source apply は本フィールドを無視するため、両者で安全に共有できる。
    ...(sawAnyNormalDraft
      ? { coreDistributionSourceAllocations: sourceAllocations }
      : {}),
    ...(sawAnySoulDraft
      ? { coreDistributionSoulCoreSourceAllocations: soulSourceAllocations }
      : {}),
  };
}
