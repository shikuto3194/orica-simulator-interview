import type {
  NormalCoreContainer,
  SoulCoreContainer,
  CoreDistributionAllocationGroup,
} from "../model";

type CoreDistributionSourceContainer = NormalCoreContainer | SoulCoreContainer;

type CoreDistributionSourceChunk<C extends CoreDistributionSourceContainer> = {
  container: C;
  remaining: number;
};

export type NormalCoreDistributionSourceChunk =
  CoreDistributionSourceChunk<NormalCoreContainer>;

export type SoulCoreDistributionSourceChunk =
  CoreDistributionSourceChunk<SoulCoreContainer>;

export type CoreDistributionMovePlanEntry = {
  container: NormalCoreContainer;
  targetInstanceId: string;
  amount: number;
};

export type CoreDistributionSoulMovePlanEntry = {
  container: SoulCoreContainer;
  targetInstanceId: string;
  amount: number;
};

export function coreDistributionSoulCoreSourceContainerFromKey(
  playerId: string,
  key: string
): SoulCoreContainer | undefined {
  if (key === "reserve" || key === "trash" || key === "life") {
    return { kind: key, playerId };
  }
  if (key.startsWith("field:")) {
    const instanceId = key.slice("field:".length);
    return instanceId ? { kind: "card", instanceId } : undefined;
  }
  return undefined;
}

export function coreDistributionSoulCoreSourceKey(
  source: SoulCoreContainer
): string | undefined {
  if (
    source.kind === "reserve" ||
    source.kind === "trash" ||
    source.kind === "life"
  ) {
    return source.kind;
  }
  return source.kind === "card" ? `field:${source.instanceId}` : undefined;
}

function isSameCardCoreSource(
  container: CoreDistributionSourceContainer,
  targetInstanceId: string
): boolean {
  return container.kind === "card" && container.instanceId === targetInstanceId;
}

type FlowEdge = {
  to: number;
  rev: number;
  cap: number;
  originalCap: number;
  sourceIndex?: number;
  targetIndex?: number;
};

type FlowResult = {
  flow: number;
  sourceToTargetEdges: FlowEdge[];
};

function runDistributionFlow<C>(
  sourceChunks: readonly { container: C; remaining: number }[],
  targets: readonly { targetInstanceId: string; amount: number }[],
  canRoute: (container: C, targetInstanceId: string) => boolean
): FlowResult {
  if (sourceChunks.length === 0 || targets.length === 0) {
    return { flow: 0, sourceToTargetEdges: [] };
  }

  const sourceStart = 1;
  const targetStart = sourceStart + sourceChunks.length;
  const sink = targetStart + targets.length;
  const graph: FlowEdge[][] = Array.from({ length: sink + 1 }, () => []);
  const sourceToTargetEdges: FlowEdge[] = [];

  const addEdge = (
    from: number,
    to: number,
    cap: number,
    meta: Pick<FlowEdge, "sourceIndex" | "targetIndex"> = {}
  ): FlowEdge => {
    const forward: FlowEdge = {
      to,
      rev: graph[to]!.length,
      cap,
      originalCap: cap,
      ...meta,
    };
    const reverse: FlowEdge = {
      to: from,
      rev: graph[from]!.length,
      cap: 0,
      originalCap: 0,
    };
    graph[from]!.push(forward);
    graph[to]!.push(reverse);
    return forward;
  };

  sourceChunks.forEach((chunk, sourceIndex) => {
    addEdge(0, sourceStart + sourceIndex, chunk.remaining);
  });
  targets.forEach((target, targetIndex) => {
    addEdge(targetStart + targetIndex, sink, target.amount);
  });
  sourceChunks.forEach((chunk, sourceIndex) => {
    targets.forEach((target, targetIndex) => {
      if (!canRoute(chunk.container, target.targetInstanceId)) {
        return;
      }
      const edge = addEdge(
        sourceStart + sourceIndex,
        targetStart + targetIndex,
        chunk.remaining,
        { sourceIndex, targetIndex }
      );
      sourceToTargetEdges.push(edge);
    });
  });

  let flow = 0;
  for (;;) {
    const parentNode = Array<number>(graph.length).fill(-1);
    const parentEdge = Array<number>(graph.length).fill(-1);
    const queue = [0];
    parentNode[0] = 0;
    const hasSinkParent = () => (parentNode[sink] ?? -1) >= 0;
    for (let q = 0; q < queue.length && !hasSinkParent(); q++) {
      const node = queue[q]!;
      graph[node]!.forEach((edge, edgeIndex) => {
        if (edge.cap <= 0 || (parentNode[edge.to] ?? -1) >= 0) return;
        parentNode[edge.to] = node;
        parentEdge[edge.to] = edgeIndex;
        queue.push(edge.to);
      });
    }
    if (!hasSinkParent()) break;

    let add = Number.POSITIVE_INFINITY;
    for (let node = sink; node !== 0; node = parentNode[node]!) {
      const edge = graph[parentNode[node]!]![parentEdge[node]!]!;
      add = Math.min(add, edge.cap);
    }
    for (let node = sink; node !== 0; node = parentNode[node]!) {
      const edge = graph[parentNode[node]!]![parentEdge[node]!]!;
      edge.cap -= add;
      graph[edge.to]![edge.rev]!.cap += add;
    }
    flow += add;
  }

  return { flow, sourceToTargetEdges };
}

export function computeCoreDistributionNormalMoveCapacity(
  sourceChunks: readonly NormalCoreDistributionSourceChunk[],
  targetInstanceIds: readonly string[]
): number {
  const totalAvailable = sourceChunks.reduce(
    (sum, chunk) => sum + Math.max(0, chunk.remaining),
    0
  );
  if (totalAvailable <= 0 || targetInstanceIds.length === 0) return 0;
  return runDistributionFlow(
    sourceChunks,
    targetInstanceIds.map((targetInstanceId) => ({
      targetInstanceId,
      amount: totalAvailable,
    })),
    (container, id) => !isSameCardCoreSource(container, id)
  ).flow;
}

/** 重なった候補集合の共有予算も、移動元配分と同じ最大流で判定する。 */
export function computeCoreDistributionGroupCapacity(
  groups: readonly CoreDistributionAllocationGroup[],
  targetCaps: Readonly<Record<string, number>>
): number {
  return runDistributionFlow(
    groups.map((group) => ({
      container: new Set(group.candidateInstanceIds),
      remaining: group.maxCount,
    })),
    Object.entries(targetCaps).map(([targetInstanceId, amount]) => ({
      targetInstanceId,
      amount,
    })),
    (candidates, id) => candidates.has(id)
  ).flow;
}

export function buildCoreDistributionMovePlan(
  sourceChunks: readonly NormalCoreDistributionSourceChunk[],
  allocations: ReadonlyMap<string, number>,
  pendingId: string
): CoreDistributionMovePlanEntry[] {
  const targets = [...allocations.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([targetInstanceId, amount]) => ({ targetInstanceId, amount }));
  const totalDemand = targets.reduce((sum, target) => sum + target.amount, 0);
  if (totalDemand <= 0) return [];

  const result = runDistributionFlow(
    sourceChunks,
    targets,
    (container, id) => !isSameCardCoreSource(container, id)
  );
  if (result.flow !== totalDemand) {
    throw new Error(
      `Core distribution ${pendingId} cannot satisfy recipient allocations without moving cores from a card to itself`
    );
  }

  return result.sourceToTargetEdges
    .map((edge) => ({
      edge,
      moved: edge.originalCap - edge.cap,
    }))
    .filter(({ moved }) => moved > 0)
    .map(({ edge, moved }) => ({
      container: sourceChunks[edge.sourceIndex!]!.container,
      targetInstanceId: targets[edge.targetIndex!]!.targetInstanceId,
      amount: moved,
    }));
}

export function buildCoreDistributionSoulMovePlan(
  sourceChunks: readonly SoulCoreDistributionSourceChunk[],
  allocations: ReadonlyMap<string, number>,
  pendingId: string
): CoreDistributionSoulMovePlanEntry[] {
  const targets = [...allocations.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([targetInstanceId, amount]) => ({ targetInstanceId, amount }));
  const totalDemand = targets.reduce((sum, target) => sum + target.amount, 0);
  if (totalDemand <= 0) return [];

  const result = runDistributionFlow(
    sourceChunks,
    targets,
    (container, id) => !isSameCardCoreSource(container, id)
  );
  if (result.flow !== totalDemand) {
    throw new Error(
      `Core distribution ${pendingId} cannot satisfy soul recipient allocations without moving a soul core from a card to itself`
    );
  }

  return result.sourceToTargetEdges
    .map((edge) => ({
      edge,
      moved: edge.originalCap - edge.cap,
    }))
    .filter(({ moved }) => moved > 0)
    .map(({ edge, moved }) => ({
      container: sourceChunks[edge.sourceIndex!]!.container,
      targetInstanceId: targets[edge.targetIndex!]!.targetInstanceId,
      amount: moved,
    }));
}
