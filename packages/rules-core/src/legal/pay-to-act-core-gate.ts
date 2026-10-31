// Extracted from legal-actions-apply.ts (P2-11 god-file decomposition).

import type {
  ActiveStack,
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  GameState,
} from "../model";

import { isNormalCoreMovePrevented } from "../core/core-system";
import { getCardById } from "../card/card-lookup";
import { matchesCardFilter } from "../card/card-filter";
import { resolveCardImmunityAffect } from "../effect/effect-affect-adapter";
import { getFieldCoreSourceTakeableCount } from "../effect/structured-core-shoot";
import { isCEActiveForScope } from "../card/ce-lookup";
import { getEffectiveSoulStateIds } from "../mechanics/magic-compatible-soul-state";

/**
 * card が「創界神/導界者/創界石ネクサス」「魂状態」「ミラージュ(セット中)」など、効果文中
 * に明示の「○○を含む」opt-in が無い限り対象に含まれない特別カテゴリに属するか。
 *
 * 「相手が[フラッシュ/スタック]効果を発揮するとき」型の発揮前提ゲート
 * (gate_flash_stack_core / gate_flash_stack_hand_discard) は、文中に「創界神ネクサスを
 * 含む」「魂状態を含む」等の指定を持たない限り、これらのカテゴリを対象にしない
 * (独自カード裁定、ユーザー確認 2026-08-02)。①発揮するカード自身(holder)にも
 * ②コア除去型のコア源候補にも同じ判定を適用する(card-filter.ts の既定除外は
 * 役割を問わない汎用ルールのため)。
 * 創界神/導界者/創界石/魂状態は `matchesCardFilter` の既定除外(card-filter.ts、
 * `hasIndependentCoreManagement` と同じ集合を `isGrandwalkerOrGuidedNexus`/
 * `isGrandstoneNexus` でカバー)を空フィルタ(`{}` = opt-in 無し)で流用する
 * (SSOT、判別ロジックを二重管理しない)。
 * ミラージュは `matchesCardFilter` に既定除外ブロックが無い(10_rules/08c:94
 * 「ミラージュを対象にした効果のみ受ける」)ため、`zone === "mirage"` を別途判定する
 * (このゾーン判定自体は native-action-registry.ts 等の既存コードと同じ SSOT リテラル)。
 */
export function isCardInOptInOnlyCategory(
  state: GameState,
  card: CardInstance,
  definition: CardDefinition,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): boolean {
  if (card.zone === "mirage") return true;
  const soulStateIds = getCardDefinitionById
    ? getEffectiveSoulStateIds(state, getCardDefinitionById)
    : undefined;
  return !matchesCardFilter(
    card,
    definition,
    {},
    {
      state,
      ...(soulStateIds ? { soulStateIds } : {}),
    }
  );
}

/**
 * 発揮前提ゲート(gate_flash_stack_core / gate_flash_stack_hand_discard)の**受け手②**
 * (コア源候補 / 破棄対象手札カード候補)が、`gateCEs` のうち少なくとも1つの発揮元
 * 効果を「受ける」か(=候補として採用可能か)を判定する SSOT 述語。
 *
 * **この関数を経由せず候補フィルタを個別実装しないこと。** コア除去型
 * (`gate_flash_stack_core`)は当初この②判定自体が未実装のまま(耐性を一切見ずに
 * コアを持つ全フィールドカードを候補に含めていた)長期未検知だった実例がある
 * (手札破棄型の②は最初から実装されていたが、コア除去型には横展開されなかった —
 * 二つの並行実装が同じ規則(10_rules/03d.md「耐性の受け手は2つ」)を別々に持ち、
 * 片方だけ更新された典型的な SSOT ドリフト)。以後、②を扱うゲート実装は必ずこの
 * 関数を呼ぶ(専用フィルタを書かない)。
 *
 * 除外(=候補にしない)条件は2つ:
 * - `isCardInOptInOnlyCategory`: 創界神/導界者/創界石/魂状態/ミラージュ等、
 *   「含む」opt-in の無いカテゴリ構造的除外。
 * - `gateCEs` の**全て**の発揮元効果に `resolveCardImmunityAffect` で耐性(受けない)
 *   なら除外(=バイスタンダー保護)。複数ゲート同時発生時は、いずれか1つでも「受ける」
 *   ならその1つを満たす候補として有効(保守的近似、コア除去型の集約プール設計に
 *   合わせた挙動。手札破棄型は1CE単位で呼ぶため実質「そのCEを受けるか」のみ判定)。
 */
export function isGateCandidateProtected(
  state: GameState,
  card: CardInstance,
  gateCEs: readonly ContinuousEffect[],
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): boolean {
  const definition = getCardDefinitionById?.(card.definitionId);
  if (
    definition &&
    isCardInOptInOnlyCategory(state, card, definition, getCardDefinitionById)
  ) {
    return true;
  }
  return gateCEs.every((ce) => {
    const gateSourceCard = state.cardInstances.find(
      (c) => c.instanceId === ce.sourceInstanceId
    );
    const gateSourceDefinition = getCardDefinitionById?.(ce.sourceDefinitionId);
    return (
      resolveCardImmunityAffect(
        state,
        card,
        ce.actingPlayerId,
        "none",
        {
          ...(gateSourceCard ? { instance: gateSourceCard } : {}),
          ...(gateSourceDefinition ? { definition: gateSourceDefinition } : {}),
        },
        getCardDefinitionById
      ).kind !== "allowed"
    );
  });
}

export const PAY_TO_ACT_GATED_STACK_KINDS: ReadonlySet<
  ActiveStack["actionKind"]
> = new Set([
  "magic",
  "accel",
  "change",
  "field_card_effect",
  "hand_card_effect",
  "declare_advent",
  "declare_host_dual_advent",
  "declare_dual_host_advent",
  "declare_manifest",
  "contract_combine",
  "link_aid",
]);

export function getStackActivationLabel(
  stack: ActiveStack
): NonNullable<ActiveStack["activationLabel"]> {
  return stack.activationLabel ?? stack.chosenTiming ?? "flash";
}

/**
 * 発揮前提コア除去ゲート (gate_flash_stack_core。BSTS01-M03) の発揮前チェック。
 *
 * 解決しようとするスタック (resolvedStack) が相手のフラッシュ/スタック効果で、活性な
 * gate_flash_stack_core CE がそのプレイヤーをゲートしているとき、コア除去 pending を返す。
 * 不成立 (ゲート無し / 効果保持カードが耐性持ち / 移動可能なコア無し) なら null を返す。
 *
 * - ①効果保持カードの耐性: card immunity gate が blocked なら
 *   そのゲートはこの効果に適用されない (創界神/創界石ネクサスは素で耐性 → 神技フラッシュは
 *   コア移動不要)。
 * - ②コア源: ゲートされる側のフィールドカード上のコア + リザーブコアを候補にする。
 *   移動可能なコアが1つも無ければゲート不成立 (発揮可) ではなく「発揮できない」になるが、
 *   本実装ではこの判定を resolve 側 (decline) に委ね、候補0でも pending を立てる…のではなく
 *   候補0なら発揮できない (空撃ち) を resolve 側で扱うため、ここでは候補があるときのみ
 *   pending を立て、候補0かつ要支払いなら「発揮不可」フラグ付き pending を立てる。
 * - 同名ゲートは〔重複不可〕で1つに集約 (sourceDefinitionId で dedup)。別カードは各加算。
 */
export function computePayToActCoreGate(
  state: GameState,
  resolvedStack: ActiveStack,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): import("../model").PendingPayToActCoreGate | null {
  if (!PAY_TO_ACT_GATED_STACK_KINDS.has(resolvedStack.actionKind)) {
    return null;
  }
  // P3-103: chosenTiming / timing.mode は使用窓、activationLabel は効果カテゴリ。
  // 本文「フラッシュタイミングで」の非フラッシュ効果は mode:"flash" でもゲート対象外。
  if (!["flash", "stack"].includes(getStackActivationLabel(resolvedStack))) {
    return null;
  }

  const gatedPlayerId = resolvedStack.actingPlayerId;

  // 活性な gate_flash_stack_core CE のうち、gatedPlayerId を対象にするもの。
  // timingScope (例『自分のアタックステップ』) を honor する。
  const gateCEs = state.activeContinuousEffects.filter(
    (ce) =>
      ce.modifierTag === "gate_flash_stack_core" &&
      ce.targetInstanceId === gatedPlayerId &&
      isCEActiveForScope(ce, state.step, state.activePlayerId)
  );
  if (gateCEs.length === 0) return null;

  // 効果保持カード (スタックのソースカード)。耐性判定 ①。
  const holderCard = getCardById(state, resolvedStack.cardInstanceId);

  // 〔重複不可〕: 同名ゲートは 1 つに集約。別カード名は各加算。
  const appliedGateNames = new Set<string>();
  let requiredCount = 0;
  let bindingRequiredCount = 0;
  for (const ce of gateCEs) {
    if (appliedGateNames.has(ce.sourceDefinitionId)) continue;
    appliedGateNames.add(ce.sourceDefinitionId);

    // ①効果保持カードの耐性は「コアを置かねば発揮できない」の拘束力(不発の要否)だけを
    // 左右する (10_rules/03d.md)。要求自体は耐性の有無を問わず変わらず提示するため、
    // continue せず requiredCount には算入し、bindingRequiredCount からのみ除く。
    // ②(コア源候補)と同じ isGateCandidateProtected (SSOT) を使う。
    const holderImmune =
      !!holderCard &&
      isGateCandidateProtected(state, holderCard, [ce], getCardDefinitionById);

    requiredCount += 1;
    if (!holderImmune) bindingRequiredCount += 1;
  }
  if (requiredCount === 0) return null;

  // ②コア源候補: ゲートされる側のフィールドカード上のコア + リザーブコア。
  //   coreSourceZones (metadata) を honor する (既定 field+reserve)。
  //
  //   本ゲートは「コアを移動させる効果」なので、候補判定は通常の core_move
  //   (「相手のスピリットのコア1個をリザーブに置く」等) と**同じ** SSOT
  //   `getFieldCoreSourceTakeableCount` を通す。免疫 / CardFilter 既定除外
  //   (創界神・導界者・創界石・魂状態) / コア最低残存数耐性がまとめて効く。
  //   `filter: {}` = 本文に「創界神ネクサスを含む」等の opt-in が無いことの表現。
  //   available も raw normalCoreCount ではなく耐性を差し引いた実移動可能数を渡す
  //   (10_rules/03d.md 「②除去不可な場所からは移動不可」)。
  const zones = new Set<string>();
  for (const ce of gateCEs) {
    const z = (ce.metadata?.["coreSourceZones"] as string[] | undefined) ?? [
      "field",
      "reserve",
    ];
    for (const zone of z) zones.add(zone);
  }
  const candidates: import("../model").PendingPayToActCoreGate["candidates"] =
    [];
  if (zones.has("field")) {
    for (const card of state.cardInstances) {
      if (card.zone !== "field") continue;
      if (card.controllerPlayerId !== gatedPlayerId) continue;
      // 複数ゲート同時発生時は、いずれかのゲートで取れるならその最大数を候補量とする。
      let available = 0;
      for (const ce of gateCEs) {
        const gateSourceCard = state.cardInstances.find(
          (c) => c.instanceId === ce.sourceInstanceId
        );
        const gateSourceDefinition = getCardDefinitionById?.(
          ce.sourceDefinitionId
        );
        const takeable = getFieldCoreSourceTakeableCount(
          state,
          card,
          ce.actingPlayerId,
          {
            effectSource: {
              ...(gateSourceCard ? { instance: gateSourceCard } : {}),
              ...(gateSourceDefinition
                ? { definition: gateSourceDefinition }
                : {}),
            },
            getCardDefinitionById,
            filter: {},
            soulCoresOnCard: card.soulCoreCount,
            soulCoresMovable: card.soulCoreCount,
          }
        );
        if (takeable > available) available = takeable;
      }
      if (available > 0) {
        candidates.push({
          containerId: card.instanceId,
          available,
          normalAvailable: isNormalCoreMovePrevented(state, card.instanceId)
            ? 0
            : Math.min(available, card.normalCoreCount),
          soulAvailable: Math.min(available, card.soulCoreCount),
        });
      }
    }
  }
  if (zones.has("reserve")) {
    const player = state.players.find((p) => p.id === gatedPlayerId);
    if (
      player &&
      player.reserveNormalCoreCount + player.reserveSoulCoreCount > 0
    ) {
      candidates.push({
        containerId: "reserve",
        available: player.reserveNormalCoreCount + player.reserveSoulCoreCount,
        normalAvailable: player.reserveNormalCoreCount,
        soulAvailable: player.reserveSoulCoreCount,
      });
    }
  }

  if (bindingRequiredCount === 0 && candidates.length === 0) {
    // 全ゲートが holder 耐性による非拘束かつコア源候補も無い: 提示すべき選択肢が無く、
    // 拘束も無いのでゲート不成立として扱い、そのまま解決へ進む(不発にしない)。
    return null;
  }

  const sourceCe = gateCEs[0]!;
  return {
    pendingId: `pay-to-act-core-gate:${resolvedStack.chainId}`,
    actingPlayerId: gatedPlayerId,
    gateSourceInstanceId: sourceCe.sourceInstanceId,
    gateSourceDefinitionId: sourceCe.sourceDefinitionId,
    deferredStack: resolvedStack,
    remainingStacks: [],
    remainingCount: requiredCount,
    candidates,
    declineFizzles: bindingRequiredCount > 0,
  };
}
