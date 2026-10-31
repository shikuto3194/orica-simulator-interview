/**
 * Room dispatch queue regression guard.
 *
 * DeckReveal の「pick 確定 → ordering を楽観表示 → 順番確定」のように、
 * 1 つ前の room dispatch がまだ in-flight の間に次の合法 input が発生する。
 * 旧実装は `roomDispatchInFlightRef.current` だけで早期 return し、後続 input を
 * 捨てていたため、順番確定が server に送られず modal 内の選択順だけがリセットされた。
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  drainRoomDispatchQueue,
  isDuplicateRoomDispatchSignature,
  resolveDeferredRoomState,
  resolveFailedRoomDispatchState,
  runTrackedRoomDispatch,
  type RoomDispatchTask,
} from "../src/utils/room-dispatch-queue";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BATTLE_SCREEN = readFileSync(
  resolve(__dirname, "../src/components/BattleScreen.tsx"),
  "utf8"
);
const USE_ROOM_SYNC = readFileSync(
  resolve(__dirname, "../src/hooks/useRoomSync.ts"),
  "utf8"
);

describe("room dispatch queue contract", () => {
  it("paints A before sending B and discards C when B fails", async () => {
    const events: string[] = [];
    const sendC = vi.fn(async () => ({ ok: true, state: "C" }));
    await drainRoomDispatchQueue({
      firstTask: {
        signature: "A",
        dispatch: async () => ({ ok: true, state: "A" }),
      },
      queue: [
        {
          signature: "B",
          dispatch: async () => {
            events.push("send B");
            return { ok: false, state: "A" };
          },
        },
        { signature: "C", dispatch: sendC },
      ],
      onActiveTask: () => {},
      checkpointSuccessfulState: (state) => {
        events.push(`paint ${state}`);
      },
      reconcile: async (result) => {
        events.push(`reconcile ${result.state}`);
      },
    });
    expect(events).toEqual(["paint A", "send B", "reconcile A"]);
    expect(sendC).not.toHaveBeenCalled();
  });
  it("A→B→A は保持し、active/queue末尾との連続重複だけを落とす", () => {
    expect(isDuplicateRoomDispatchSignature("A", "A", null)).toBe(true);
    expect(isDuplicateRoomDispatchSignature("A", "A", "B")).toBe(false);
    expect(isDuplicateRoomDispatchSignature("B", "A", "B")).toBe(true);
  });

  it("in-flight 中の別 input は捨てず queue する", () => {
    expect(BATTLE_SCREEN).toContain("const roomDispatchQueueRef = useRef");
    expect(BATTLE_SCREEN).toContain("roomDispatchQueueRef.current.push");
    expect(BATTLE_SCREEN).toContain(
      "void runRoomDispatchQueue(roomDispatchTask)"
    );
    expect(BATTLE_SCREEN).toContain("await drainRoomDispatchQueue({");
    expect(BATTLE_SCREEN).toContain("const queueRoomSpecialMutation");
    expect(BATTLE_SCREEN).toContain('roomSpecialDispatchSignature("core-move"');
    expect(BATTLE_SCREEN).toContain(
      'roomSpecialDispatchSignature("brave-separation"'
    );
    expect(BATTLE_SCREEN).toContain(
      'roomSpecialDispatchSignature("pregame-update"'
    );
    expect(BATTLE_SCREEN).toContain("return runTrackedRoomDispatch(");
    expect(BATTLE_SCREEN).toContain("checkpointSuccessfulState:");
    expect(BATTLE_SCREEN).toContain(
      "checkpointSuccessfulState: applyRoomAuthoritativeState"
    );
    expect(BATTLE_SCREEN).toContain("getConfirmedState()");
    expect(BATTLE_SCREEN).not.toContain(
      "if (roomId && roomDispatchInFlightRef.current) return;"
    );
  });

  it("DeckReveal pick 応答待ちでも order を送り、再 fetch 失敗時は最終 state を失わない", async () => {
    type DeckRevealState = {
      pendingDeckReveal: null | { phase: "picking" | "ordering_remainder" };
    };
    let releasePick!: () => void;
    const pickGate = new Promise<void>((resolve) => {
      releasePick = resolve;
    });
    const dispatched: string[] = [];
    const queue: RoomDispatchTask<DeckRevealState>[] = [];
    let displayed: DeckRevealState = {
      pendingDeckReveal: { phase: "ordering_remainder" },
    };
    let deferred: DeckRevealState | null = null;
    let inFlight = true;
    const pickTask: RoomDispatchTask<DeckRevealState> = {
      signature: "resolve_pending_deck_reveal_pick:pick",
      dispatch: async () => {
        dispatched.push("pick");
        await pickGate;
        return {
          ok: true,
          state: { pendingDeckReveal: { phase: "ordering_remainder" } },
        };
      },
    };
    const orderTask: RoomDispatchTask<DeckRevealState> = {
      signature: "resolve_pending_deck_reveal_order:order",
      dispatch: async () => {
        dispatched.push("order");
        return { ok: true, state: { pendingDeckReveal: null } };
      },
    };

    const draining = drainRoomDispatchQueue({
      firstTask: pickTask,
      queue,
      onActiveTask: () => {},
      reconcile: async (result) => {
        if (!result.state) return;
        if (inFlight) deferred = result.state;
        else displayed = result.state;
      },
    });
    await Promise.resolve();
    queue.push(orderTask);
    releasePick();
    await draining;
    inFlight = false;

    const fetchLatestState = vi.fn(async () => null);
    const authoritative = await resolveDeferredRoomState(
      deferred,
      fetchLatestState
    );
    if (authoritative) displayed = authoritative;

    expect(dispatched).toEqual(["pick", "order"]);
    expect(displayed.pendingDeckReveal).toBeNull();
    expect(fetchLatestState).not.toHaveBeenCalled();
  });

  it("最終 reconcile 待ち中に追加された DeckReveal order も drain する", async () => {
    type DeckRevealState = {
      pendingDeckReveal: null | { phase: "ordering_remainder" };
    };
    let notifyReconcileStarted!: () => void;
    const reconcileStarted = new Promise<void>((resolve) => {
      notifyReconcileStarted = resolve;
    });
    let releaseReconcile!: () => void;
    const reconcileGate = new Promise<void>((resolve) => {
      releaseReconcile = resolve;
    });
    const dispatched: string[] = [];
    const reconciled: Array<DeckRevealState["pendingDeckReveal"]> = [];
    const queue: RoomDispatchTask<DeckRevealState>[] = [];
    const orderTask: RoomDispatchTask<DeckRevealState> = {
      signature: "resolve_pending_deck_reveal_order:late-order",
      dispatch: async () => {
        dispatched.push("order");
        return { ok: true, state: { pendingDeckReveal: null } };
      },
    };

    const draining = drainRoomDispatchQueue({
      firstTask: {
        signature: "resolve_pending_deck_reveal_pick:pick",
        dispatch: async () => {
          dispatched.push("pick");
          return {
            ok: true,
            state: { pendingDeckReveal: { phase: "ordering_remainder" } },
          };
        },
      },
      queue,
      onActiveTask: () => {},
      reconcile: async (result) => {
        reconciled.push(result.state?.pendingDeckReveal ?? null);
        if (reconciled.length === 1) {
          notifyReconcileStarted();
          await reconcileGate;
        }
      },
    });

    await reconcileStarted;
    queue.push(orderTask);
    releaseReconcile();
    await draining;

    expect(dispatched).toEqual(["pick", "order"]);
    expect(reconciled).toEqual([{ phase: "ordering_remainder" }, null]);
  });

  it("通常 action 待ち中の special mutation も同じ queue で直列化する", async () => {
    type SyncState = { version: number };
    const order: string[] = [];
    let releaseAction!: () => void;
    const actionGate = new Promise<void>((resolve) => {
      releaseAction = resolve;
    });
    let notifyActionStarted!: () => void;
    const actionStarted = new Promise<void>((resolve) => {
      notifyActionStarted = resolve;
    });
    const queue: RoomDispatchTask<SyncState>[] = [];

    const draining = drainRoomDispatchQueue({
      firstTask: {
        signature: "action:pick",
        dispatch: async () => {
          order.push("action:start");
          notifyActionStarted();
          await actionGate;
          order.push("action:end");
          return { ok: true, state: { version: 1 } };
        },
      },
      queue,
      onActiveTask: () => {},
      reconcile: async () => {},
    });

    await actionStarted;
    queue.push({
      signature: "special:core-move",
      dispatch: async () => {
        order.push("special");
        return { ok: true, state: { version: 2 } };
      },
    });
    releaseAction();
    await draining;

    expect(order).toEqual(["action:start", "action:end", "special"]);
  });

  it("先行 action 失敗で未実行 special を破棄するとガードも解除する", async () => {
    const discarded = vi.fn();
    const specialDispatch = vi.fn(async () => ({ ok: true }));
    const queue: RoomDispatchTask<unknown>[] = [
      {
        signature: "special:core-move",
        dispatch: specialDispatch,
        onDiscard: discarded,
      },
    ];

    await drainRoomDispatchQueue({
      firstTask: {
        signature: "action:failed",
        dispatch: async () => ({ ok: false }),
      },
      queue,
      onActiveTask: () => {},
      reconcile: async () => {},
    });

    expect(specialDispatch).not.toHaveBeenCalled();
    expect(discarded).toHaveBeenCalledOnce();
    expect(queue).toHaveLength(0);
  });

  it("version-only success の回復に失敗したら stale version の後続を送らない", async () => {
    type SyncState = { marker: string };
    const followUpDispatch = vi.fn(async () => ({
      ok: true,
      state: { marker: "unexpected" },
    }));
    const reconcile = vi.fn(async () => {});

    await drainRoomDispatchQueue<SyncState>({
      firstTask: {
        signature: "first",
        dispatch: async () => ({ ok: true, version: 1 }),
      },
      queue: [{ signature: "follow-up", dispatch: followUpDispatch }],
      onActiveTask: () => {},
      reconcile,
    });

    expect(followUpDispatch).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledOnce();
  });

  it("先行成功後に後続と full fetch が失敗したら先行 checkpoint へ戻る", async () => {
    type DeckRevealState = {
      pendingDeckReveal: null | { phase: "picking" | "ordering_remainder" };
    };
    const picking: DeckRevealState = {
      pendingDeckReveal: { phase: "picking" },
    };
    const ordering: DeckRevealState = {
      pendingDeckReveal: { phase: "ordering_remainder" },
    };
    let displayed: DeckRevealState = { pendingDeckReveal: null };
    let checkpoint: DeckRevealState = picking;
    const queue: RoomDispatchTask<DeckRevealState>[] = [
      {
        signature: "resolve_pending_deck_reveal_order:order",
        dispatch: async () => ({ ok: false }),
      },
    ];

    await drainRoomDispatchQueue({
      firstTask: {
        signature: "resolve_pending_deck_reveal_pick:pick",
        dispatch: async () => ({ ok: true, state: ordering }),
      },
      queue,
      onActiveTask: () => {},
      checkpointSuccessfulState: (state) => {
        checkpoint = state;
      },
      reconcile: async (result) => {
        expect(result.ok).toBe(false);
        const authoritative = await resolveDeferredRoomState(
          null,
          async () => checkpoint
        );
        if (authoritative) displayed = authoritative;
      },
    });

    expect(displayed).toBe(ordering);
    expect(queue).toHaveLength(0);
  });

  it("special dispatch 失敗と full fetch 失敗が重なっても deferred SSE state を適用する", async () => {
    type SyncState = { marker: "stale" | "opponent-latest" };
    let displayed: SyncState = { marker: "stale" };
    const deferred: SyncState = { marker: "opponent-latest" };
    const fetchLatestState = vi.fn(async () => null);

    const result = await runTrackedRoomDispatch(
      async () => ({ ok: false as const, error: "Network error" }),
      async () => {
        const authoritative = await resolveDeferredRoomState(
          deferred,
          fetchLatestState
        );
        if (authoritative) displayed = authoritative;
      }
    );

    expect(result.ok).toBe(false);
    expect(displayed).toEqual({ marker: "opponent-latest" });
    expect(fetchLatestState).not.toHaveBeenCalled();
  });

  it("後続失敗と full fetch 失敗でも新しい deferred SSE を checkpoint で潰さない", async () => {
    const deferred = { version: 3, marker: "opponent-latest" };
    const checkpoint = { version: 2, marker: "pick-success" };

    const resolved = await resolveFailedRoomDispatchState(
      deferred,
      async () => null,
      checkpoint
    );

    expect(resolved).toBe(deferred);
  });

  it("失敗reconcileは取得できた最新stateを deferred より優先する", async () => {
    const fetched = { version: 4, marker: "fetched-latest" };
    const resolved = await resolveFailedRoomDispatchState(
      { version: 3, marker: "deferred" },
      async () => fetched,
      { version: 2, marker: "checkpoint" }
    );

    expect(resolved).toBe(fetched);
  });

  it("dispatch と full fetch が失敗したら最後の authoritative state を維持する", async () => {
    type SyncState = { marker: "optimistic" | "last-authoritative" };
    const lastAuthoritative: SyncState = { marker: "last-authoritative" };
    let displayed: SyncState = { marker: "optimistic" };

    const authoritative = await resolveDeferredRoomState(null, async () => {
      const fetched = null;
      return fetched ?? lastAuthoritative;
    });
    if (authoritative) displayed = authoritative;

    expect(displayed).toBe(lastAuthoritative);
  });

  it("pregame-update の version conflict は権威 state 取得後にだけ再送する", () => {
    expect(USE_ROOM_SYNC).toMatch(
      /path === "pregame-update" &&\s+recovered &&\s+attempt < maxRetries/
    );
    expect(USE_ROOM_SYNC).toContain("continue;");
    expect(USE_ROOM_SYNC).toContain(
      "requestExpectedVersion = lastKnownVersion.current"
    );
    expect(USE_ROOM_SYNC).toContain("expectedVersion: requestExpectedVersion");
    expect(USE_ROOM_SYNC).toContain("core-move / brave-separation は非冪等");
  });

  // Server retry recovery is exercised through HTTP in room-rematch.test.ts.

  it("SSE先着済みの同一version HTTP応答は既知stateを再利用する", () => {
    expect(USE_ROOM_SYNC).toMatch(
      /data\.version === lastKnownStateVersion\.current &&\s+lastKnownState\.current/
    );
    expect(USE_ROOM_SYNC).toContain("result.state = lastKnownState.current");
  });

  it("mulligan失敗の権威rollbackで送信ガードと操作UIを戻す", () => {
    expect(BATTLE_SCREEN).toMatch(
      /mulliganSubmittedRef\.current &&\s+polledPg\.mulliganDone\[myId\] === undefined/
    );
    expect(BATTLE_SCREEN).toContain("mulliganSubmittedRef.current = false");
    expect(BATTLE_SCREEN).toContain('setUiPhase({ kind: "mulligan_self" })');
  });

  it("pregame の onSync は React state updater 内から二重発火させない", () => {
    expect(BATTLE_SCREEN).toContain(
      "const currentStateRef = useRef(gameState)"
    );
    expect(BATTLE_SCREEN).toContain(
      "const next = updater(currentStateRef.current)"
    );
    expect(BATTLE_SCREEN).not.toContain("queueMicrotask(() => onSync(next))");
  });

  it("room の pregame 完了は local start を合成せず権威 state を待つ", () => {
    expect(BATTLE_SCREEN).toContain(
      "room preGame completion waits for server-authoritative state"
    );
    expect(BATTLE_SCREEN).toMatch(
      /if \(roomId\) \{\s+\/\/ room preGame completion waits for server-authoritative state\.[\s\S]*?void flushDeferredRoomAuthoritativeState\(true\);\s+return;\s+\}/
    );
  });
});
