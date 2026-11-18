/**
 * P1-01 楽観的ロック: CAS (Compare-And-Swap) ロジックのユニットテスト。
 *
 * サーバーの `updateRoomCAS` は Supabase の `UPDATE WHERE state_version = N`
 * で原子性を保証するため、ここではコンフリクト検出とリトライのロジックをテスト。
 */
import { describe, it, expect } from "vitest";

/** 簡易 CAS シミュレータ: サーバー側の楽観的ロック動作を模擬 */
function createCASStore(initialVersion: number) {
  let currentVersion = initialVersion;
  let state: unknown = null;

  return {
    getVersion: () => currentVersion,
    getState: () => state,

    /**
     * CAS 更新: expectedVersion が一致する場合のみ更新。
     * 成功なら { ok: true, newVersion }、失敗なら { ok: false, currentVersion } を返す。
     */
    updateCAS(
      expectedVersion: number,
      newState: unknown
    ):
      | { ok: true; newVersion: number }
      | { ok: false; currentVersion: number } {
      if (expectedVersion !== currentVersion) {
        return { ok: false, currentVersion };
      }
      currentVersion++;
      state = newState;
      return { ok: true, newVersion: currentVersion };
    },
  };
}

/** クライアント側のリトライロジック (useRoomSync.pushState の簡易版) */
async function pushStateWithRetry(
  store: ReturnType<typeof createCASStore>,
  newState: unknown,
  clientVersion: number,
  maxRetries = 3
): Promise<{ success: boolean; finalVersion: number; attempts: number }> {
  let version = clientVersion;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = store.updateCAS(version, newState);
    if (result.ok) {
      return {
        success: true,
        finalVersion: result.newVersion,
        attempts: attempt + 1,
      };
    }
    // 409 相当: サーバーの最新バージョンを取得してリトライ
    version = result.currentVersion;
  }
  return {
    success: false,
    finalVersion: store.getVersion(),
    attempts: maxRetries + 1,
  };
}

describe("P1-01 optimistic locking CAS", () => {
  it("single client: sequential updates succeed", () => {
    const store = createCASStore(0);
    const r1 = store.updateCAS(0, { turnNumber: 1 });
    expect(r1).toEqual({ ok: true, newVersion: 1 });

    const r2 = store.updateCAS(1, { turnNumber: 2 });
    expect(r2).toEqual({ ok: true, newVersion: 2 });

    const r3 = store.updateCAS(2, { turnNumber: 3 });
    expect(r3).toEqual({ ok: true, newVersion: 3 });
  });

  it("concurrent: second writer gets conflict (409)", () => {
    const store = createCASStore(5);

    // 両クライアントが version 5 をベースに操作
    const aliceResult = store.updateCAS(5, {
      turnNumber: 6,
      activePlayerId: "alice",
    });
    expect(aliceResult).toEqual({ ok: true, newVersion: 6 });

    // bob は version 5 を期待するが、既に 6 に更新済み
    const bobResult = store.updateCAS(5, {
      turnNumber: 6,
      activePlayerId: "bob",
    });
    expect(bobResult).toEqual({ ok: false, currentVersion: 6 });
  });

  it("concurrent: conflict detection prevents silent overwrite", () => {
    const store = createCASStore(10);

    // Alice: 攻撃宣言 (version 10 → 11)
    const aliceResult = store.updateCAS(10, {
      step: "attack",
      activePlayerId: "alice",
    });
    expect(aliceResult.ok).toBe(true);

    // Bob: バーストセット (version 10 → conflict!)
    const bobResult = store.updateCAS(10, { step: "main", burstSet: true });
    expect(bobResult.ok).toBe(false);

    // Alice の操作が保持されている
    expect(store.getState()).toEqual({
      step: "attack",
      activePlayerId: "alice",
    });
  });

  it("client retry: succeeds after conflict", async () => {
    const store = createCASStore(5);

    // 別クライアントが先に更新
    store.updateCAS(5, { turnNumber: 6 });

    // クライアントは古い version 5 でリトライ
    const result = await pushStateWithRetry(store, { turnNumber: 7 }, 5);

    // リトライで成功（2回目で version 6 を使って成功）
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.finalVersion).toBe(7);
  });

  it("client retry: fails after max retries when server keeps advancing", async () => {
    const store = createCASStore(5);

    // 毎回 CAS を試みる前にサーバーが進む（他クライアントが連続更新するシナリオ）
    const originalUpdateCAS = store.updateCAS.bind(store);
    let callCount = 0;
    store.updateCAS = (expectedVersion: number, newState: unknown) => {
      callCount++;
      // 毎回呼ばれる直前にサーバーバージョンを進める
      if (callCount <= 4) {
        originalUpdateCAS(store.getVersion(), { raceCondition: callCount });
      }
      return originalUpdateCAS(expectedVersion, newState);
    };

    const result = await pushStateWithRetry(store, { turnNumber: 99 }, 5, 3);

    // 4回リトライしても追いつけない
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(4); // 0, 1, 2, 3 = 4 attempts
  });

  it("triple concurrent: only one writer succeeds per version", () => {
    const store = createCASStore(0);

    // 3クライアントが version 0 をベースに同時操作
    const results = [
      store.updateCAS(0, { player: "alice" }),
      store.updateCAS(0, { player: "bob" }),
      store.updateCAS(0, { player: "charlie" }),
    ];

    const successes = results.filter((r) => r.ok);
    const failures = results.filter((r) => !r.ok);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(2);
    expect(store.getVersion()).toBe(1);
  });

  it("sequential conflict resolution: all clients eventually succeed", async () => {
    const store = createCASStore(0);

    // Alice と Bob が同時に version 0 をベースに操作
    // Alice が先に成功
    const aliceResult = await pushStateWithRetry(
      store,
      { turn: 1, by: "alice" },
      0
    );
    expect(aliceResult.success).toBe(true);

    // Bob は version 0 で試みるが、Alice が先に version 1 にしたのでリトライ
    const bobResult = await pushStateWithRetry(
      store,
      { turn: 2, by: "bob" },
      0
    );
    expect(bobResult.success).toBe(true);
    expect(bobResult.attempts).toBe(2); // 1回目失敗、2回目成功

    expect(store.getVersion()).toBe(2);
  });
});
