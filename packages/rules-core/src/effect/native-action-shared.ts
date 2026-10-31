// P2-14 inc5: 効果 native 実行の共有 leaf helper (連番カウンタ / ロケーション・数値変換)。
// effect-interpreter と各 native handler sibling が一方向 import する土台。これにより
// sibling↔親の循環 import を解消する。

import { resolveCount } from "./target-resolution";
import { matchesCardFilter, matchesCardName } from "../card/card-filter";
import { getEffectiveLevel } from "../battle/battle-shared";
import {
  getEffectiveCardName,
  getEffectiveColors,
} from "../legal/legal-actions-shared";
import type { CardFilter, Count, CoreLocation } from "../dsl-types";
import type {
  CardDefinition,
  CardInstance,
  EffectCoreLocation,
  EffectPlayerRef,
  GameState,
} from "../model";
import type { StepExecutionContext } from "../step-execution-context";

/** CE 生成用連番カウンタ */
let dslCeSequence = 0;
export function nextDslCeId(tag: string): string {
  return `dsl-ce-${tag}-${dslCeSequence++}`;
}

export function convertCoreLocation(loc: CoreLocation): EffectCoreLocation {
  switch (loc.kind) {
    case "union":
      return { kind: "union", sources: loc.sources.map(convertCoreLocation) };
    case "void":
      return { kind: "void", player: loc.player as EffectPlayerRef };
    case "reserve":
      return { kind: "reserve", player: loc.player as EffectPlayerRef };
    case "trash":
      return { kind: "trash", player: loc.player as EffectPlayerRef };
    case "life":
      return { kind: "life", player: loc.player as EffectPlayerRef };
    case "outside_game":
      return { kind: "outside_game" };
    case "removed_from_game":
      return {
        kind: "removed_from_game",
        player: loc.player as EffectPlayerRef,
      };
    case "field":
      return {
        kind: "field",
        player: loc.player as EffectPlayerRef,
        ...(loc.filter ? { filter: loc.filter } : {}),
        ...(loc.minRemainingPerCandidate !== undefined
          ? { minRemainingPerCandidate: loc.minRemainingPerCandidate }
          : {}),
        ...(loc.minRemainingPerCandidateByFilter !== undefined
          ? {
              minRemainingPerCandidateByFilter:
                loc.minRemainingPerCandidateByFilter,
            }
          : {}),
        ...(loc.includeReserve === true ? { includeReserve: true } : {}),
        ...(loc.eachZone === true ? { eachZone: true } : {}),
      };
    case "this_card":
      return { kind: "this_card" };
    case "target_card":
      return { kind: "target_card" };
    case "card_instance":
      return { kind: "card_instance", instanceId: loc.instanceId };
    case "count_area":
      return { kind: "count_area", player: loc.player as EffectPlayerRef };
    case "ref":
      return { kind: "this_card" }; // fallback
    case "field_card":
      return {
        kind: "field_card",
        player: loc.player as EffectPlayerRef,
        // CardFilter の SSOT を保持する。hasMechanic を含め、個別 allowlist
        // で source selection だけ脱落するフィールドを作らない。
        filter: { ...loc.filter },
      };
    case "any_movable_self":
      // P3-47 F-5: multi-source マーカー。executeCoreDistribute で early-return
      // 経路に分岐しているため、ここに到達した場合は誤用 (他 helper が
      // `any_movable_self` を扱えない)。fallback として self.reserve に縮退。
      return { kind: "reserve", player: "self" };
    case "non_life_normal_self":
      // 「ライフ/ソウル以外の自分のコアすべて」マーカー。executeCoreDistribute の
      // early-return 経路でのみ扱うため、ここへ来た場合は fallback として self.reserve に縮退。
      return { kind: "reserve", player: "self" };
    case "field_and_reserve_self":
      // 「フィールド/リザーブのコアを好きなだけ」マーカー。any_movable_self と同じく
      // executeCoreDistribute の early-return 経路でのみ扱われるため、ここに到達した
      // 場合は誤用。fallback として self.reserve に縮退。
      return { kind: "reserve", player: "self" };
    case "field_reserve_and_trash_self":
      // field/reserve + trash 上限つきの複合 source marker。executeCoreDistribute 専用。
      return { kind: "reserve", player: "self" };

    default: {
      // P3-139: CoreLocation.kind は上記で網羅済み。新しい kind を追加した場合はここで
      // コンパイルエラーになる（void/self への無記名 silent fallback を再発させないため）。
      const exhaustiveCheck: never = loc;
      throw new Error(
        `convertCoreLocation: unhandled CoreLocation kind ${
          (exhaustiveCheck as { kind?: unknown }).kind
        }`
      );
    }
  }
}

/**
 * host 解決系 native handler (move_card の `from.hostFilter` / place_text_role_under_card の
 * `sourceHostFilter` 等) 共通の CardFilter 評価。`cardNameEffective` は `matchesCardFilter`
 * (card-filter.ts) 内では評価できない (legal-actions-shared.ts から import される側のため
 * `getEffectiveCardName` を呼ぶと循環 import になる) ため、host 解決側のこの1箇所で
 * `matchesCardFilter` 本体判定の後に個別評価する (SSOT、ENGINE-x03-cross-zone-aldnoah-drive-transfer
 * で2箇所目の呼び出し元が生じたため native-move-core-handlers.ts のインライン実装から抽出)。
 */
export function matchesHostCardFilter(
  state: GameState,
  card: CardInstance,
  def: CardDefinition,
  filter: CardFilter,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  opts?: {
    underCardIds?: {
      adventSource: ReadonlySet<string>;
      textRole: ReadonlySet<string>;
    };
  }
): boolean {
  if (
    !matchesCardFilter(card, def, filter, {
      effectiveColors: getEffectiveColors(state, card, def),
      effectiveLevel:
        card.zone === "field"
          ? getEffectiveLevel(state, card, def, getCardDefinitionById)
          : undefined,
      ...(opts?.underCardIds ? { underCardIds: opts.underCardIds } : {}),
    })
  ) {
    return false;
  }
  if (filter.cardNameEffective !== undefined) {
    const effectiveName = getEffectiveCardName(
      state,
      card,
      def,
      getCardDefinitionById
    );
    if (!matchesCardName(effectiveName, filter.cardNameEffective)) {
      return false;
    }
  }
  return true;
}

export function resolveCountToNumber(
  count: Count,
  state: GameState,
  actingPlayerId: string,
  stepCtx: StepExecutionContext,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  /**
   * `step.repeat` の各反復で新たに解決された対象 id（`target_card` 系 DynamicCount
   * source を「その反復で選んだ対象」に束ねる）。省略時は従来どおり
   * `stepCtx.selectedTargetInstanceIds`（反復間で不変の全体リスト）を使う。
   * 「2体を選び、各々のコア数に応じた量を動かす」型 (BSGE01-C16 等) で、反復2回目以降が
   * 常に1体目基準の量を再利用してしまう食い違いを防ぐ。
   */
  targetIdsOverride?: readonly string[]
): number {
  const effectiveStepCtx =
    targetIdsOverride !== undefined && targetIdsOverride.length > 0
      ? { ...stepCtx, selectedTargetInstanceIds: [...targetIdsOverride] }
      : stepCtx;
  return resolveCount(
    count,
    state,
    actingPlayerId,
    effectiveStepCtx,
    getCardDefinitionById
  );
}
