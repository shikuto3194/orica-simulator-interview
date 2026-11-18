import {
  coreContainerId,
  getNormalCoreCountAtLocation,
  recomposeCoreSourceAllocationLegalAction,
  resolvePlayerRef,
} from "@orica/rules-core";
import type {
  ApplyLegalActionOptions,
  EffectCoreLocation,
  GameState,
  LegalAction,
  NormalCoreContainer,
  DraftCoreMove,
} from "@orica/rules-core";
import {
  getFixedCoreDestination,
  createGrabbedCoreMove,
  locationIdToNormalContainer,
} from "../coreSelectionFacade";
import type { HeldCoreEntry } from "../coreSelectionFacade";

export interface PendingCoreHudSource {
  id: string;
  from: NormalCoreContainer;
  normal: number;
  soul: number;
  max?: number;
}
export interface PendingCoreHud {
  confirmLabel?: string;
  key: string;
  title: string;
  action: LegalAction;
  sources: PendingCoreHudSource[];
  min: number;
  max: number;
  destination?: NormalCoreContainer;
  destinations?: NormalCoreContainer[];
  distribute?: boolean;
  payment: boolean;
  chooseSoul?: boolean;
  maxSoul?: number;
  confirm: (
    cores: readonly HeldCoreEntry[],
    destination?: NormalCoreContainer,
    placements?: readonly DraftCoreMove[]
  ) => {
    action: LegalAction;
    payload: Partial<ApplyLegalActionOptions>;
  };
  decline?: { label: string; payload: Partial<ApplyLegalActionOptions> };
}

/** EffectCoreLocation の解決は split/count/partition の全 GUI で共有する。 */
export function effectCoreLocationToNormalContainer(
  location: EffectCoreLocation,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string
): NormalCoreContainer | null {
  switch (location.kind) {
    case "void":
    case "reserve":
    case "trash":
    case "life":
      return {
        kind: location.kind,
        playerId: resolvePlayerRef(actingPlayerId, location.player, state),
      };
    case "card_instance":
      return { kind: "card", instanceId: location.instanceId };
    case "this_card":
      return { kind: "card", instanceId: sourceInstanceId };
    default:
      return null;
  }
}

/** ゾーンは所有者をキーに含め、相手のライフ等も盤面上で選ぶ。 */
export const coreContainerTapId = coreContainerId;

/** 共通HUDの取得済みコアを差し引いた、候補ごとの選択可能数。 */
export function getPendingCoreSourceRemaining(
  pending: PendingCoreHud | null,
  cores: readonly HeldCoreEntry[],
  id: string,
  kind: "normal" | "soul"
): number {
  if (
    kind === "soul" &&
    pending?.maxSoul !== undefined &&
    cores.filter((c) => c.kind === "soul").length >= pending.maxSoul
  )
    return 0;
  const src = pending?.sources.find((s) => s.id === id);
  if (!src) return 0;
  const taken = cores.filter(
    (c) => coreContainerTapId(c.from as NormalCoreContainer) === id
  );
  return Math.max(
    0,
    Math.min(
      src[kind] - taken.filter((c) => c.kind === kind).length,
      (src.max ?? src.normal + src.soul) - taken.length
    )
  );
}

/** エンジン pending → 共通 HUD 入力。数/種類/支払い元を別モーダルに分岐させない。 */
export function buildPendingCoreHud(
  state: GameState,
  actions: readonly LegalAction[]
): PendingCoreHud | null {
  const find = (kind: LegalAction["kind"]) =>
    actions.find((a) => a.kind === kind);
  const source = (
    from: NormalCoreContainer,
    normal: number,
    soul = 0,
    max = normal + soul
  ): PendingCoreHudSource => ({
    id: coreContainerTapId(from),
    from,
    normal,
    soul,
    max,
  });
  const allocation = state.pendingCoreSourceAllocation;
  const shoot = state.pendingCoreShootSelection;
  if (shoot?.ownerCoreChoice) {
    const action = find("resolve_pending_core_shoot");
    if (!action) return null;
    const sourceId = shoot.ownerCoreChoice.soulSourceId;
    const from =
      sourceId === `reserve:${shoot.fromPlayerId}`
        ? { kind: "reserve" as const, playerId: shoot.fromPlayerId }
        : { kind: "card" as const, instanceId: sourceId };
    return {
      key: shoot.pendingId,
      title: "移動する自分のコアを選択",
      action,
      min: shoot.totalAmount,
      max: shoot.totalAmount,
      payment: false,
      chooseSoul: true,
      sources: [source(from, getNormalCoreCountAtLocation(state, from), 1)],
      confirm: (cores) => ({
        action,
        payload: {
          coreShootDistribution: {
            [sourceId]: cores.filter((c) => c.kind === "normal").length,
          },
          ...(cores.some((c) => c.kind === "soul")
            ? { coreShootSoulCoreInstanceId: sourceId }
            : {}),
        },
      }),
    };
  }
  if (allocation) {
    const action = find("resolve_core_source_allocation");
    if (!action) return null;
    const destination = effectCoreLocationToNormalContainer(
      allocation.toLocation,
      state,
      allocation.actingPlayerId,
      allocation.sourceInstanceId
    );
    if (!destination) return null;
    return {
      key: allocation.pendingId,
      ...(allocation.minimumTotal !== undefined
        ? { confirmLabel: "完了" }
        : {}),
      ...(allocation.canDecline
        ? {
            decline: {
              label: "支払わず手札を増やさない",
              payload: { coreSourceAllocations: {} },
            },
          }
        : {}),
      title:
        allocation.purpose === "core_move_bonus"
          ? "追加で移動するコアを選択"
          : allocation.purpose === "core_move"
            ? "移動するコアを選択"
            : "コア支払い元を選択",
      action,
      min: allocation.minimumTotal ?? allocation.requiredTotal,
      max: allocation.requiredTotal,
      payment: allocation.purpose === undefined,
      chooseSoul: true,
      // 現行の配分アクションはソウルコア1個を別フィールドで受け取る。
      maxSoul: 1,
      sources: allocation.candidates.map((c) =>
        source(
          c.container ??
            locationIdToNormalContainer(
              c.instanceId,
              allocation.actingPlayerId
            ),
          c.normalAvailable ?? c.available,
          c.hasSoulCore ? 1 : 0,
          c.available
        )
      ),
      destination,
      confirm: (cores) => ({
        action,
        payload: recomposeCoreSourceAllocationLegalAction(
          cores.map((core) =>
            createGrabbedCoreMove(core, destination, "core_source_allocation")
          ),
          Object.fromEntries(
            allocation.candidates.map((c) => [
              coreContainerId(
                c.container ??
                  locationIdToNormalContainer(
                    c.instanceId,
                    allocation.actingPlayerId
                  )
              ),
              c.instanceId,
            ])
          )
        ),
      }),
    };
  }
  const link = state.pendingLinkAidCostSourceChoice;
  if (link) {
    const choices = actions.filter(
      (a) =>
        a.kind === "resolve_pending_link_aid_cost_source_choice" &&
        a.pendingId === link.pendingId
    );
    const action = choices[0];
    if (!action) return null;
    return {
      key: link.pendingId,
      title: "リンクエイド コスト支払い",
      action,
      min: 1,
      max: 1,
      payment: true,
      sources: link.candidates.map((c) =>
        source(
          locationIdToNormalContainer(
            c.costSourceInstanceId,
            link.actingPlayerId
          ),
          c.availableNormalCoreCount
        )
      ),
      destination: { kind: "void", playerId: link.actingPlayerId },
      confirm: (cores) => {
        const id = cores[0]?.from;
        const selected = choices.find(
          (a) =>
            a.kind === "resolve_pending_link_aid_cost_source_choice" &&
            a.costSourceInstanceId ===
              (id?.kind === "card" ? id.instanceId : id?.kind)
        );
        if (!selected) throw new Error("支払い元のコアを選択してください");
        return { action: selected, payload: {} };
      },
    };
  }
  const gate = state.pendingPayToActCoreGate;
  if (gate) {
    const action = find("resolve_pay_to_act_core_gate");
    if (!action) return null;
    return {
      key: gate.pendingId + ":" + gate.remainingCount,
      title: "発揮前提コア（残り" + gate.remainingCount + "）",
      action,
      min: 1,
      max: 1,
      payment: false,
      chooseSoul: true,
      sources: gate.candidates.map((c) =>
        source(
          locationIdToNormalContainer(c.containerId, gate.actingPlayerId),
          c.normalAvailable ?? c.available,
          c.soulAvailable ?? 0,
          c.available
        )
      ),
      destination: { kind: "trash", playerId: gate.actingPlayerId },
      confirm: (cores) => {
        const from = cores[0]!.from;
        return {
          action,
          payload: {
            payToActCoreKind: cores[0]!.kind,
            payToActCoreSourceContainerId:
              from.kind === "card" ? from.instanceId : from.kind,
          },
        };
      },
      decline: {
        label: gate.declineFizzles ? "発揮しない" : "置かずに続ける",
        payload: { payToActCoreGateDecline: true },
      },
    };
  }
  const life = state.pendingLifeCoreSelection;
  const count = state.pendingCoreCountSelection;
  const pending = life ?? count;
  if (pending) {
    const action = find(
      life
        ? "resolve_pending_life_core_selection"
        : "resolve_pending_core_count"
    );
    const playerId = life?.effectSourcePlayerId ?? pending.actingPlayerId;
    const from = effectCoreLocationToNormalContainer(
      pending.fromLocation,
      state,
      playerId,
      pending.sourceInstanceId
    );
    if (!action || !from) return null;
    const to = effectCoreLocationToNormalContainer(
      pending.toLocation,
      state,
      playerId,
      pending.sourceInstanceId
    );
    return {
      key: pending.pendingId,
      title: life ? "移動するコアを選択" : "移動コア数を選択",
      action,
      min: life?.totalAmount ?? count!.min,
      max: life?.totalAmount ?? count!.max,
      payment: false,
      // 数選択の後に持ち主の通常/ソウル選択が続く場合、ここで種類は確定しない。
      chooseSoul: !!life,
      sources: [
        source(
          from,
          life?.normalAvailable ??
            Math.min(count!.max, getNormalCoreCountAtLocation(state, from)),
          life?.soulAvailable ??
            Math.max(0, count!.max - getNormalCoreCountAtLocation(state, from))
        ),
      ],
      ...(life && to ? { destination: to } : {}),
      confirm: (cores) => ({
        action,
        payload: life
          ? {
              lifeCorePartitionChoice: {
                normalChosen: cores.filter((c) => c.kind === "normal").length,
                soulChosen: cores.filter((c) => c.kind === "soul").length,
              },
            }
          : { coreCountSelection: cores.length },
      }),
    };
  }
  const summon = state.pendingSummonCostCoreMoveChoice;
  if (summon) {
    const action = find("resolve_pending_summon_cost_core_move_choice");
    if (!action) return null;
    const from: NormalCoreContainer = {
      kind: "trash",
      playerId: summon.actingPlayerId,
    };
    const normal = Math.min(
      summon.availableCoreCount,
      getNormalCoreCountAtLocation(state, from)
    );
    const destinations: NormalCoreContainer[] = [
      { kind: "reserve", playerId: summon.actingPlayerId },
      ...summon.fieldDestinationCandidateInstanceIds.map((instanceId) => ({
        kind: "card" as const,
        instanceId,
      })),
    ];
    const destination = getFixedCoreDestination(destinations);
    return {
      key: summon.pendingId,
      title: "コア移動で召喚",
      distribute: true,
      action,
      min: summon.minCount,
      max: summon.availableCoreCount,
      payment: false,
      chooseSoul: true,
      sources: [source(from, normal, summon.availableCoreCount - normal)],
      destinations,
      ...(destination ? { destination } : {}),
      confirm: (cores, to, placements) => {
        if (!to) throw new Error("コアの移動先を選択してください");
        const allocations =
          placements ??
          cores.map((core) => createGrabbedCoreMove(core, to, "card_cost"));
        return {
          action,
          payload: {
            ...(summon.grantsFreeSummon ? {} : { paymentSources: [] }),
            summonCostCoreMoveSelectedCount: cores.length,
            summonCostCoreMoveAllocations: allocations.map((move) => ({
              destination:
                move.to.kind === "card"
                  ? { fieldCardInstanceId: move.to.instanceId }
                  : ("reserve" as const),
              normalCount: move.kind === "normal" ? move.amount : 0,
              soulCount: move.kind === "soul" ? (1 as const) : (0 as const),
            })),
            summonCostCoreMoveDestination:
              to.kind === "card"
                ? { fieldCardInstanceId: to.instanceId }
                : "reserve",
          },
        };
      },
    };
  }
  return null;
}
