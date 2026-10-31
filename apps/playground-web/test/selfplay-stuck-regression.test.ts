/**
 * P3-91 回帰テスト: selfplay fuzz で stuck を起こした seed の固定再現。
 *
 * seed は mulberry32 で Math.random ごと差し替えた完全決定 self-play
 * (selfplay-driver の playGame + rng)。修正前は以下の 4+1 系統で stuck した:
 *
 * - advanceStep blocked: activeAttack is in progress
 *   (実体は pendingEffectTargetSelection 未解決。driver が targetInstanceIds を
 *    供給しておらず resolve_pending_effect_target が常に throw)
 * - N pending triggered effect remain / N pending burst check remain /
 *   N battle immediate effect remain
 *   (getCurrentActorPlayerIds の優先順が getLegalActionsInner と不一致で、
 *    legal action を持つプレイヤーが actor 集合に居なかった)
 *
 * エンジン変更で同 seed の対局軌跡は変わり得るが、「seed 固定のランダム対局が
 * capped / stuck / error なく自然終局する」ことの smoke 回帰として維持する。
 */
import { describe, expect, it } from "vitest";
import { buildEngine, mulberry32, playGameAsync } from "./selfplay-driver";

describe("grouped target disclosure after immunity response", () => {
  it("seed 1558726003 は強制対象を含めて対象選択を完了する", async () => {
    const result = await playGameAsync({
      engine: buildEngine(),
      rng: mulberry32(1_558_726_003),
    });
    expect(result.outcome, result.lastError ?? "").toBe("natural");
  });
  it.each([1_558_723_490, 1_558_723_493])(
    "seed %i は配分と対象応答を完走する",
    async (seed) => {
      const result = await playGameAsync({
        engine: buildEngine(),
        rng: mulberry32(seed),
      });
      expect(result.outcome, result.lastError ?? "").toBe("natural");
    }
  );
  it("seed 1558722431 はコア支払いで対象候補が消滅してもスタックを完走する", async () => {
    const result = await playGameAsync({
      engine: buildEngine(),
      rng: mulberry32(1_558_722_431),
    });
    expect(result.outcome, result.lastError ?? "").toBe("natural");
  });
  it("seed 1558712826 は手札不足時に成立する別条件を選び終局する", async () => {
    const result = await playGameAsync({
      engine: buildEngine(),
      rng: mulberry32(1_558_712_826),
    });
    expect(result.outcome, result.lastError ?? "").toBe("natural");
  });
  it("seed 1558711590 は確定対象の再開示を繰り返さず終局する", async () => {
    const result = await playGameAsync({
      engine: buildEngine(),
      rng: mulberry32(1_558_711_590),
    });
    expect(result.outcome, result.lastError ?? "").toBe("natural");
  });
});

// 修正前に stuck した seed (FUZZ_SEED_BASE=1, 300 局 + 1000 局計測)。
// activeAttack系: 10, 84, 225, 226, 249, 277, 281 / burst: 28, 43 /
// effectTarget: 125, 144, 287 / battleImmediate: 188, 336 (BIE 全 variant
// 発揮不能滞留 → skipOnly action で drain) / triggered: 295 /
// deckReveal: 20
const STUCK_SEEDS = [
  10, 20, 28, 43, 84, 125, 144, 188, 225, 226, 249, 277, 281, 287, 295, 336,
  858,
];

describe("P3-91 selfplay stuck regression", () => {
  const engine = buildEngine();

  for (const seed of STUCK_SEEDS) {
    // seed 287 のみ engine-claude worktree の既知の perf skew
    // (project_worktree_directory_perf_skew) で既定 90_000ms を超えて
    // ~96-120s かかることがある。実際に stuck していないことは分離実行で確認済み。
    // 他 seed は既定 timeout のまま (不要な緩和をしない)。
    const timeout = seed === 287 ? 180_000 : undefined;
    it(
      `seed ${seed} はランダム自己対戦が stuck せず終局する`,
      async () => {
        const result = await playGameAsync({ engine, rng: mulberry32(seed) });
        expect(result.outcome, result.lastError ?? "").toBe("natural");
      },
      timeout
    );
  }
});

/**
 * P3-120 回帰テスト: 指定対象 (`battle_entity`) アタックの burst 解決後、
 * `resolveDeferredStackAction` の burst_activation 分岐 (対象選択待ちで中断した
 * burst 効果の再開経路) が `advanceAttackDeclarationStateIfReady` を呼ばず
 * `window` が `declare_attack` のまま stuck した (P3-119 修正で fuzz が完走する
 * ようになって初めて到達できた別バグ)。
 */
const P3_120_STUCK_SEEDS = [166];

describe("P3-120 selfplay stuck regression", () => {
  const engine = buildEngine();

  for (const seed of P3_120_STUCK_SEEDS) {
    it(`seed ${seed} はランダム自己対戦が stuck せず終局する`, async () => {
      const result = await playGameAsync({ engine, rng: mulberry32(seed) });
      expect(result.outcome, result.lastError ?? "").toBe("natural");
    });
  }
});

/**
 * ENGINE-burst-after-triggered-optional-step 回帰テスト:
 * バトル解決のライフ減少でバーストと同時誘発が queued され、同時誘発の任意 step を
 * decline したとき、戦闘終了後も deferred burst activation を保持して解決する。
 * 修正前は battle-end cleanup が burst_activation stack まで破棄し、
 * activationSelected の pendingBurstCheck が孤立して advanceStep が停止した。
 */
const ENGINE_BURST_AFTER_TRIGGERED_OPTIONAL_STEP_STUCK_SEEDS = [
  346, 403, 525, 682, 708, 796,
];

describe("ENGINE-burst-after-triggered-optional-step selfplay stuck regression", () => {
  const engine = buildEngine();

  for (const seed of ENGINE_BURST_AFTER_TRIGGERED_OPTIONAL_STEP_STUCK_SEEDS) {
    it(`seed ${seed} は任意誘発解決後のバーストを drain して終局する`, async () => {
      const result = await playGameAsync({ engine, rng: mulberry32(seed) });
      expect(result.outcome, result.lastError ?? "").toBe("natural");
    });
  }
});

/**
 * ENGINE-battle-immediate-stale-target-fizzle 回帰テスト:
 * `pendingEffectTargetSelection`（deferredStack.actionKind === "battle_immediate_effect"）の
 * 対象候補は、確定後に同時解決の他効果でフィールドを離れる等して stale 化しうる。
 * apply 側 (`isTargetStillValid`) はこれを正しく reject するが、legal action 側は候補を
 * 再検証せず frozen candidateInstanceIds をそのまま曝露していたため、GUI/AI が無効な唯一の
 * 候補を選ぶしかなく、選び直しの余地が無いまま `advanceStep blocked: activeAttack is in
 * progress` で永久 stuck した (BSAZ02-C11 実装セッション中の selfplay fuzz seed=142 で発見。
 * BSAZ02-C11 自体はこのゲームで一度もドローされておらず、無関係な BSAZ02-C13 実装の
 * legal action 数変化が RNG 消費列をずらして到達しただけの pre-existing バグと確認済み)。
 * 修正: legal-actions.ts / effect-target-handlers.ts の両方で isTargetStillValid (SSOT) を
 * 再利用し、stale 化した候補を除外・下限緩和する。allowDuplicateTargets のときは
 * 単一生存候補で複数回選択が成立するため下限緩和の対象外 (bsaz01-repeat-activation.test.ts
 * 回帰から学習)。
 */
const ENGINE_BATTLE_IMMEDIATE_STALE_TARGET_STUCK_SEEDS = [142];

describe("ENGINE-battle-immediate-stale-target-fizzle selfplay stuck regression", () => {
  const engine = buildEngine();

  for (const seed of ENGINE_BATTLE_IMMEDIATE_STALE_TARGET_STUCK_SEEDS) {
    it(`seed ${seed} はランダム自己対戦が stuck せず終局する`, async () => {
      const result = await playGameAsync({ engine, rng: mulberry32(seed) });
      expect(result.outcome, result.lastError ?? "").toBe("natural");
    });
  }
});

/**
 * ENGINE-battle-end-deferred-optional-pending-leave-flush 回帰テスト:
 * battle_end deferred の「アタックステップを終了する。その後、このカードをフィールドに
 * 置ける。」の任意 step、または転醒に必要なコア配置を解決した後、同じバトルで SBA により
 * 生じた pending leave が battle_end chain の外側に残っていた。attack-step の終了予約は
 * pending leave を blocker とみなすため、flush を再試行しなければ advanceStep が永久に停止する。
 */
const ENGINE_BATTLE_END_DEFERRED_OPTIONAL_PENDING_LEAVE_STUCK_SEEDS = [
  1_558_301_836, 1_558_402_499,
];

describe("ENGINE-battle-end-deferred-optional-pending-leave-flush selfplay stuck regression", () => {
  const engine = buildEngine();

  for (const seed of ENGINE_BATTLE_END_DEFERRED_OPTIONAL_PENDING_LEAVE_STUCK_SEEDS) {
    it(`seed ${seed} は deferred optional 後の待機離脱を drain して終局する`, async () => {
      const result = await playGameAsync({ engine, rng: mulberry32(seed) });
      expect(result.outcome, result.lastError ?? "").toBe("natural");
    });
  }
});

/**
 * ENGINE-interspersed-flash-history-selfplay-cycle 回帰テスト:
 * 「発揮した」事実を参照する条件は source の存在と現在 timing window の最新 source
 * だけを使う。無制限のフラッシュ効果を他の発揮が挟まる形で往復すると、append-only
 * 履歴をそのまま loop fingerprint に含めている限り既出状態を検出できず capped した。
 */
const ENGINE_INTERSPERSED_FLASH_HISTORY_CYCLE_SEEDS = [1_558_403_647];

describe("ENGINE-interspersed-flash-history-selfplay-cycle regression", () => {
  const engine = buildEngine();

  for (const seed of ENGINE_INTERSPERSED_FLASH_HISTORY_CYCLE_SEEDS) {
    it(`seed ${seed} はフラッシュ履歴の往復で capped せず終局する`, async () => {
      const result = await playGameAsync({ engine, rng: mulberry32(seed) });
      expect(result.outcome, result.lastError ?? "").toBe("natural");
    });
  }
});

/**
 * ENGINE-deferred-burst-multi-placement 回帰テスト:
 * multi placement の入力が残る間は、待機中バーストの effect declaration を開かない。
 * 先に開くと、その後の abort が prior snapshot を復元して stack window を失わせ、
 * activationSelected の pendingBurstCheck だけが残って advanceStep が停止する。
 */
const ENGINE_DEFERRED_BURST_MULTI_PLACEMENT_STUCK_SEEDS = [1_558_408_619];

describe("ENGINE-deferred-burst-multi-placement regression", () => {
  const engine = buildEngine();

  for (const seed of ENGINE_DEFERRED_BURST_MULTI_PLACEMENT_STUCK_SEEDS) {
    it(`seed ${seed} は選択済みバーストを drain して終局する`, async () => {
      const result = await playGameAsync({ engine, rng: mulberry32(seed) });
      expect(result.outcome, result.lastError ?? "").toBe("natural");
    });
  }
});
