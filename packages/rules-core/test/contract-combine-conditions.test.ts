import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { getLegalActions } from "../src";
import {
  getContractCombineCandidateTargets,
  resolveDeferredContractCombineStack,
} from "../src/mechanics/contract-combine-system";
import type { ActiveStack, CardDefinition } from "../src/model";

const definitions = new Map(ALL_CARDS.map((c) => [c.cardNo, c]));
const card = (no: string) => definitions.get(no)!;

function position(no: string, proxy: boolean) {
  const braveDefinition = card(no);
  const name =
    braveDefinition.contractCombineData!.braveCondition.cardNameContains![0]!;
  let hostDefinition: CardDefinition = {
    ...ALL_CARDS.find((c) => c.name === name)!,
  };
  const host = createCardInstance(hostDefinition, {
    instanceId: "host",
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 1,
  });
  const brave = createCardInstance(braveDefinition, {
    instanceId: "brave",
    ownerPlayerId: "alice",
    zone: "hand",
  });
  const old = createCardInstance(card("BSGE01-C05"), {
    instanceId: "old",
    ownerPlayerId: "alice",
    zone: "field",
  });
  old.attachedToInstanceId = host.instanceId;
  host.attachedChildrenIds = [old.instanceId];
  const nexus = createCardInstance(card("BSGE01-C13"), {
    instanceId: "proxy",
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 1,
  });
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [host, brave, old, ...(proxy ? [nexus] : [])],
    playerOverrides: [
      { handCount: 1, soulCoreLocation: { kind: proxy ? "void" : "reserve" } },
      {},
    ],
  });
  state.activePlayerId = "alice";
  state.step = "main";
  state.window = "none";
  const lookup = (id: string) =>
    id === hostDefinition.cardNo ? hostDefinition : definitions.get(id);
  const candidates = () =>
    getContractCombineCandidateTargets({
      state,
      actingPlayerId: "alice",
      braveCard: brave,
      braveDefinition,
      getCardDefinitionById: lookup,
    });
  const stack: ActiveStack = {
    stackId: "contract",
    chainId: "test:contract",
    actionKind: "contract_combine",
    actingPlayerId: "alice",
    cardInstanceId: brave.instanceId,
    cardDefinitionId: braveDefinition.cardNo,
    targetInstanceIds: [host.instanceId],
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
    ...(proxy
      ? {
          contractCombineCostWaived: true,
          contractCombineProxySourceInstanceId: nexus.instanceId,
        }
      : {}),
  };
  return {
    state,
    candidates,
    lookup,
    stack,
    changeHost: (change: Partial<CardDefinition>) => {
      hostDefinition = { ...hostDefinition, ...change };
    },
  };
}

describe("契約合体は契約条件と通常合体条件を併せて満たす (qa-013)", () => {
  for (const no of [
    "BSGE01-TX01(A)",
    "BSGE01-TX02(A)",
    "BSGE01-TX03(A)",
    "BSGE01-TX04(A)",
  ]) {
    it.each([false, true])(
      `${no}: 支払い免除=%s、条件を満たす対象では成立`,
      (proxy) => {
        const p = position(no, proxy);
        expect(p.candidates().map((c) => c.instanceId)).toEqual(["host"]);
        const after = resolveDeferredContractCombineStack(p.state, p.stack, {
          getCardDefinitionById: p.lookup,
          getRegisteredTriggeredEffectActions: () => [],
        });
        expect(
          after.cardInstances.find((c) => c.instanceId === "brave")
            ?.attachedToInstanceId
        ).toBe("host");
        expect(
          after.cardInstances.find((c) => c.instanceId === "old")?.zone
        ).toBe("trash");
        expect(after.players[0]!.soulCoreLocation).toEqual({
          kind: proxy ? "void" : "trash",
        });
      }
    );
    it.each([false, true])(
      `${no}: 支払い免除=%s、条件を失うと候補・実行とも不成立`,
      (proxy) => {
        for (const change of [
          { tribe: "GE・1G" },
          { tribe: "神喰" },
          { name: "別名" },
        ]) {
          const p = position(no, proxy);
          expect(p.candidates()).toHaveLength(1);
          p.changeHost(change);
          expect(p.candidates()).toEqual([]);
          expect(
            getLegalActions({
              state: p.state,
              actingPlayerId: "alice",
              getCardDefinitionById: p.lookup,
              getRegisteredFieldCardEffectActions: () => [],
            }).filter((a) => a.kind === "contract_combine")
          ).toEqual([]);
          const before = structuredClone(p.state);
          const after = resolveDeferredContractCombineStack(p.state, p.stack, {
            getCardDefinitionById: p.lookup,
          });
          expect(after.cardInstances).toEqual(before.cardInstances);
          expect(after.players).toEqual(before.players);
          expect(after.effectUsageRecords).toEqual(before.effectUsageRecords);
        }
      }
    );
  }
});
