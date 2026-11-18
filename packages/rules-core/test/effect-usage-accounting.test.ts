/**
 * P3-170 使用枠の純粋な契約テスト (V01・V03基盤・V04・V05・V09・V12・V15時計部)。
 * 期待値はルール章 (03e 期間と反復 / 02d 追加ステップ・ターン) に基づく。
 * 現状の挙動を固定するsnapshotではない。
 */
import { describe, expect, it } from "vitest";
import {
  buildUsageConstraint,
  consumeUsage,
  createEmptyEffectAccounting,
  effectAbilityRef,
  abilityFingerprint,
  grantUsage,
  normalizeUsageLimits,
  sharedNameAbilityRef,
  pruneAccounting,
  queryUsage,
  refundUsage,
  releaseOperation,
  type EffectAccounting,
  type EffectUsageLimit,
  type UsageClock,
  type UsageConstraint,
  type UsageContext,
} from "../src/effect-usage";

const fixedMax = (c: UsageConstraint): number => c.maximum.base;

function clock(
  turnId: number,
  stepId = 1,
  battleId: string | null = null
): UsageClock {
  return { turnId, stepId, battleId };
}

function ctx(
  partial: Partial<UsageContext> & { clock: UsageClock }
): UsageContext {
  return {
    playerId: "alice",
    sourceInstanceId: "a1",
    sourceFieldGeneration: 0,
    sourceSoulGeneration: 0,
    nameKey: "Name-X",
    ...partial,
  };
}

function constraintsFor(
  limits: EffectUsageLimit | EffectUsageLimit[],
  effectIndex = 0,
  definitionKey = "DEF-X",
  groupId?: string
): UsageConstraint[] {
  return normalizeUsageLimits({
    abilityRef: effectAbilityRef(definitionKey, effectIndex),
    limits,
    ...(groupId !== undefined ? { groupId } : {}),
  });
}

function use(
  acc: EffectAccounting,
  constraints: UsageConstraint[],
  context: UsageContext,
  operationId: string,
  amount = 1
): EffectAccounting {
  const result = consumeUsage(
    acc,
    constraints,
    context,
    operationId,
    fixedMax,
    amount
  );
  if (!result.ok) throw new Error(`consume failed: ${result.reason}`);
  return result.accounting;
}

function remaining(
  acc: EffectAccounting,
  constraints: UsageConstraint[],
  context: UsageContext
): number[] {
  return queryUsage(acc, constraints, context, fixedMax).entries.map(
    (e) => e.remaining
  );
}

// 時計は台帳に持たず、GameStateから導出して文脈で渡す。
const empty = (_clock?: UsageClock) => createEmptyEffectAccounting();

describe("V01 同名の別個体は個別枠、同個体は再使用不可、refund後だけ再使用可", () => {
  const limit: EffectUsageLimit = { kind: "per_instance", duration: "turn" };
  const cs = constraintsFor(limit);

  it("同名別個体2体のうち片方を使用しても他個体は使用可", () => {
    const c1 = ctx({ clock: clock(1), sourceInstanceId: "a1" });
    const c2 = ctx({ clock: clock(1), sourceInstanceId: "a2" });
    const acc = use(empty(), cs, c1, "op-1");
    expect(queryUsage(acc, cs, c1, fixedMax).allowed).toBe(false);
    expect(queryUsage(acc, cs, c2, fixedMax).allowed).toBe(true);
  });

  it("refund後だけ同個体を再使用できる", () => {
    const c1 = ctx({ clock: clock(1), sourceInstanceId: "a1" });
    const used = use(empty(), cs, c1, "op-1");
    expect(queryUsage(used, cs, c1, fixedMax).allowed).toBe(false);
    const refunded = refundUsage(used, "op-1");
    expect(queryUsage(refunded, cs, c1, fixedMax).allowed).toBe(true);
  });

  it("実離脱で世代が進んだ個体は新しい個体として扱う (V06基盤)", () => {
    const before = ctx({
      clock: clock(1),
      sourceInstanceId: "a1",
      sourceFieldGeneration: 0,
    });
    const after = ctx({
      clock: clock(1),
      sourceInstanceId: "a1",
      sourceFieldGeneration: 1,
    });
    const acc = use(empty(), cs, before, "op-1");
    expect(queryUsage(acc, cs, after, fixedMax).allowed).toBe(true);
  });

  it("魂状態化で世代が進んだ個体は、魂状態を含む効果では維持・含まない効果では更新 (V06基盤)", () => {
    const soulCs = normalizeUsageLimits({
      abilityRef: effectAbilityRef("DEF-X", 0),
      limits: limit,
      includesSoulState: true,
    });
    const base = ctx({ clock: clock(1), sourceSoulGeneration: 0 });
    const soul = ctx({ clock: clock(1), sourceSoulGeneration: 1 });
    const plain = use(empty(), cs, base, "op-1");
    const withSoul = use(empty(), soulCs, base, "op-2");
    expect(queryUsage(plain, cs, soul, fixedMax).allowed).toBe(true);
    expect(queryUsage(withSoul, soulCs, soul, fixedMax).allowed).toBe(false);
  });
});

describe("V02/V03 基盤: 使用者・同名・別効果・groupの共有境界", () => {
  const nameLimit: EffectUsageLimit = {
    kind: "per_card_name",
    duration: "turn",
  };

  it("同名共有はプレイヤーごとに独立 (Aだけ不可、B可)", () => {
    const cs = constraintsFor(nameLimit);
    const a = ctx({
      clock: clock(1),
      playerId: "alice",
      sourceInstanceId: "a1",
    });
    const a2 = ctx({
      clock: clock(1),
      playerId: "alice",
      sourceInstanceId: "a2",
    });
    const b = ctx({ clock: clock(1), playerId: "bob", sourceInstanceId: "b1" });
    const acc = use(empty(), cs, a, "op-1");
    expect(queryUsage(acc, cs, a2, fixedMax).allowed).toBe(false);
    expect(queryUsage(acc, cs, b, fixedMax).allowed).toBe(true);
  });

  it("同名でも別効果は別枠、異名でも同じgroupは共有", () => {
    const e0 = constraintsFor(nameLimit, 0);
    const e1 = constraintsFor(nameLimit, 1);
    const context = ctx({ clock: clock(1) });
    const acc = use(empty(), e0, context, "op-1");
    expect(queryUsage(acc, e1, context, fixedMax).allowed).toBe(true);

    const group: EffectUsageLimit = { kind: "per_group", duration: "turn" };
    const g1 = constraintsFor(group, 0, "DEF-A", "G1");
    const g2 = constraintsFor(group, 3, "DEF-B", "G1");
    const gOther = constraintsFor(group, 0, "DEF-A", "G2");
    const gAcc = use(
      empty(),
      g1,
      ctx({ clock: clock(1), nameKey: "A" }),
      "op-g"
    );
    expect(
      queryUsage(
        gAcc,
        g2,
        ctx({ clock: clock(1), nameKey: "B", sourceInstanceId: "b9" }),
        fixedMax
      ).allowed
    ).toBe(false);
    expect(queryUsage(gAcc, gOther, context, fixedMax).allowed).toBe(true);
  });

  it("V07 subject_instance は対象Y別に独立し、出直した対象は新枠 (発揮元別個体でも共有対象枠は復活しない)", () => {
    const cs = constraintsFor({
      kind: "per_trigger_related_instance",
      duration: "turn",
    });
    const y1 = ctx({
      clock: clock(1),
      subjectInstanceId: "y1",
      subjectFieldGeneration: 0,
    });
    const y2 = ctx({
      clock: clock(1),
      subjectInstanceId: "y2",
      subjectFieldGeneration: 0,
    });
    const y1Again = ctx({
      clock: clock(1),
      subjectInstanceId: "y1",
      subjectFieldGeneration: 1,
    });
    const acc = use(empty(), cs, y1, "op-1");
    expect(queryUsage(acc, cs, y1, fixedMax).allowed).toBe(false);
    expect(queryUsage(acc, cs, y2, fixedMax).allowed).toBe(true);
    expect(queryUsage(acc, cs, y1Again, fixedMax).allowed).toBe(true);

    // 〔重複不可〕と併記された共有対象枠は、発揮元の個体が違っても(同名なら)同じ対象Yで復活しない。
    // 単独の〔対象ごと〕は発揮元の個体ごとの枠で、別個体なら別の枠になる(対比)。
    const shared = constraintsFor([
      { kind: "per_trigger_related_instance", duration: "turn" },
      { kind: "no_duplicate" },
    ]);
    // 〔重複不可〕は同一 event 内だけを畳むので、別 event の照会は重複不可の枠では止まらない。
    // 別個体 (a-other) が止まるなら、それは共有対象枠 (同名で共有する対象 Y 別の枠) が効いている証拠になる。
    const bySource = (
      sourceInstanceId: string,
      subjectInstanceId: string,
      eventId: string
    ) =>
      ctx({
        clock: clock(1),
        sourceInstanceId,
        subjectInstanceId,
        subjectFieldGeneration: 0,
        eventId,
      });
    const sharedAcc = use(
      empty(),
      shared,
      bySource("a1", "y1", "ev-1"),
      "op-s1"
    );
    expect(
      queryUsage(sharedAcc, shared, bySource("a1", "y1", "ev-1"), fixedMax)
        .allowed
    ).toBe(false);
    expect(
      queryUsage(sharedAcc, shared, bySource("a-other", "y1", "ev-2"), fixedMax)
        .allowed
    ).toBe(false);
    // 対象 Y が違えば、別個体でも別 event でも通る (共有は同じ対象 Y に限る)。
    expect(
      queryUsage(sharedAcc, shared, bySource("a-other", "y2", "ev-2"), fixedMax)
        .allowed
    ).toBe(true);
    const lone = use(empty(), cs, bySource("a1", "y1", "ev-1"), "op-s2");
    expect(
      queryUsage(lone, cs, bySource("a-other", "y1", "ev-2"), fixedMax).allowed
    ).toBe(true);
  });

  it("V08 重複不可は同一event内のみ畳み、別eventは可。同一activationの制限は1回", () => {
    const nodup = constraintsFor({ kind: "no_duplicate" });
    const ev1 = ctx({
      clock: clock(1),
      eventId: "ev-1",
      sourceInstanceId: "a1",
    });
    const ev1b = ctx({
      clock: clock(1),
      eventId: "ev-1",
      sourceInstanceId: "a2",
    });
    const ev2 = ctx({
      clock: clock(1),
      eventId: "ev-2",
      sourceInstanceId: "a2",
    });
    const acc = use(empty(), nodup, ev1, "op-1");
    expect(queryUsage(acc, nodup, ev1b, fixedMax).allowed).toBe(false);
    expect(queryUsage(acc, nodup, ev2, fixedMax).allowed).toBe(true);

    const act = constraintsFor({ kind: "per_trigger_activation" });
    const chain1 = ctx({ clock: clock(1), activationId: "chain-1" });
    const chain2 = ctx({ clock: clock(1), activationId: "chain-2" });
    const accAct = use(empty(), act, chain1, "op-a");
    expect(queryUsage(accAct, act, chain1, fixedMax).allowed).toBe(false);
    expect(queryUsage(accAct, act, chain2, fixedMax).allowed).toBe(true);
  });
});

describe("V03 同名共有の識別: 名前 + 能力指紋 (H2 基盤)", () => {
  const limit: EffectUsageLimit = { kind: "per_card_name", duration: "turn" };
  const effectA = {
    timing: { kind: "phase" },
    steps: [{ action: { kind: "draw", amount: 1 } }],
  };
  const effectACopy = JSON.parse(JSON.stringify(effectA)) as object;
  const effectB = {
    timing: { kind: "phase" },
    steps: [{ action: { kind: "draw", amount: 2 } }],
  };

  function named(
    defId: string,
    effect: object,
    effectIndex: number
  ): UsageConstraint[] {
    return normalizeUsageLimits({
      abilityRef: effectAbilityRef(defId, effectIndex),
      nameAbilityRef: sharedNameAbilityRef("魔界", abilityFingerprint(effect)),
      limits: limit,
    });
  }

  it("同名・別definitionIdでも同一本文の能力は同じ枠を共有する (効果番号が違っても)", () => {
    const first = named("DEF-1", effectA, 1);
    const second = named("DEF-2", effectACopy, 4);
    const a = ctx({ clock: clock(1), nameKey: "魔界", sourceInstanceId: "a1" });
    const b = ctx({ clock: clock(1), nameKey: "魔界", sourceInstanceId: "a2" });
    const acc = use(empty(), first, a, "op-1");
    expect(queryUsage(acc, second, b, fixedMax).allowed).toBe(false);
  });

  it("同名でも本文が違う別効果は独立した枠", () => {
    const first = named("DEF-1", effectA, 1);
    const other = named("DEF-3", effectB, 1);
    const a = ctx({ clock: clock(1), nameKey: "魔界", sourceInstanceId: "a1" });
    const c = ctx({ clock: clock(1), nameKey: "魔界", sourceInstanceId: "a3" });
    const acc = use(empty(), first, a, "op-1");
    expect(queryUsage(acc, other, c, fixedMax).allowed).toBe(true);
  });

  it("指紋はキー順に依存しない", () => {
    const x = { a: 1, b: { c: [1, 2], d: "x" } };
    const y = { b: { d: "x", c: [1, 2] }, a: 1 };
    expect(abilityFingerprint(x)).toBe(abilityFingerprint(y));
    expect(abilityFingerprint({ a: 2 })).not.toBe(abilityFingerprint({ a: 1 }));
  });
});

describe("V04 turn と game の複数制限 (H3)", () => {
  const limits: EffectUsageLimit[] = [
    { kind: "per_instance", duration: "game", maxCount: 3 },
    { kind: "per_card_name", duration: "turn", maxCount: 2 },
  ];
  const cs = constraintsFor(limits);

  it("1回使用後の残量は game=2 / turn=1。2回目後はturn不可、次ターンはgame残1", () => {
    const t1 = ctx({ clock: clock(1) });
    let acc = use(empty(), cs, t1, "op-1");
    expect(remaining(acc, cs, t1)).toEqual([2, 1]);
    expect(
      queryUsage(acc, cs, t1, fixedMax).entries.map((e) => e.used)
    ).toEqual([1, 1]);

    acc = use(acc, cs, t1, "op-2");
    expect(queryUsage(acc, cs, t1, fixedMax).allowed).toBe(false);
    expect(remaining(acc, cs, t1)).toEqual([1, 0]);

    const t2 = ctx({ clock: clock(2) });
    expect(remaining(acc, cs, t2)).toEqual([1, 2]);
    expect(queryUsage(acc, cs, t2, fixedMax).allowed).toBe(true);
  });

  it("refundは両枠を1ずつ戻す", () => {
    const t1 = ctx({ clock: clock(1) });
    let acc = use(empty(), cs, t1, "op-1");
    acc = use(acc, cs, t1, "op-2");
    acc = refundUsage(acc, "op-2");
    expect(
      queryUsage(acc, cs, t1, fixedMax).entries.map((e) => e.used)
    ).toEqual([1, 1]);
  });

  it("複数制限は全件確認後に原子的に消費する (一部だけ更新して失敗しない)", () => {
    const t1 = ctx({ clock: clock(1) });
    let acc = use(empty(), cs, t1, "op-1");
    acc = use(acc, cs, t1, "op-2"); // turn枠は使い切り
    const before = JSON.stringify(acc);
    const result = consumeUsage(acc, cs, t1, "op-3", fixedMax);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(acc)).toBe(before);
  });
});

describe("V05 ステップ期間: 追加ステップは別、ターン枠は維持 (H4, 02d)", () => {
  const stepLimit: EffectUsageLimit = {
    kind: "per_instance",
    duration: "step",
  };
  const turnLimit: EffectUsageLimit = {
    kind: "per_instance",
    duration: "turn",
  };

  it("同名の追加attack stepでも step枠は更新され、turn枠は維持される", () => {
    const stepCs = constraintsFor(stepLimit, 0);
    const turnCs = constraintsFor(turnLimit, 1);
    const attack1 = ctx({ clock: clock(5, 10) });
    const attack2 = ctx({ clock: clock(5, 12) }); // 同名step (追加) は別stepId
    let acc = use(empty(clock(5, 10)), stepCs, attack1, "s-1");
    acc = use(acc, turnCs, attack1, "t-1");
    expect(queryUsage(acc, stepCs, attack1, fixedMax).allowed).toBe(false);
    expect(queryUsage(acc, stepCs, attack2, fixedMax).allowed).toBe(true);
    expect(queryUsage(acc, turnCs, attack2, fixedMax).allowed).toBe(false);
  });

  it("連続する同名stepも別stepIdなので以前の消費を再利用しない", () => {
    const stepCs = constraintsFor(stepLimit, 0);
    const first = ctx({ clock: clock(5, 20) });
    const second = ctx({ clock: clock(5, 21) });
    const acc = use(empty(clock(5, 20)), stepCs, first, "s-1");
    expect(queryUsage(acc, stepCs, second, fixedMax).allowed).toBe(true);
  });

  it("バトル外の battle 期間は常に使用不可", () => {
    const cs = constraintsFor({ kind: "per_instance", duration: "battle" });
    expect(
      queryUsage(empty(), cs, ctx({ clock: clock(1, 1, null) }), fixedMax)
        .allowed
    ).toBe(false);
    expect(
      queryUsage(empty(), cs, ctx({ clock: clock(1, 1, "atk-1") }), fixedMax)
        .allowed
    ).toBe(true);
  });
});

describe("V09 上限の増減と使用済みの扱い", () => {
  it("上限1→3→1、使用済み2: 上限3で残1、上限1で残0。使用済みは切り詰めない", () => {
    const cs = constraintsFor({
      kind: "per_instance",
      duration: "turn",
      maxCount: 1,
    });
    const context = ctx({ clock: clock(1) });
    let acc = empty();
    const resolveTo = (n: number) => () => n;
    // 上限3の間に2回使用
    for (const id of ["op-1", "op-2"]) {
      const result = consumeUsage(acc, cs, context, id, resolveTo(3));
      if (!result.ok) throw new Error(result.reason);
      acc = result.accounting;
    }
    expect(queryUsage(acc, cs, context, resolveTo(3)).entries[0]).toMatchObject(
      {
        limit: 3,
        used: 2,
        remaining: 1,
      }
    );
    expect(queryUsage(acc, cs, context, resolveTo(1)).entries[0]).toMatchObject(
      {
        limit: 1,
        used: 2,
        remaining: 0,
      }
    );
  });

  it("不正な上限 (負・NaN・非整数) は拒否する", () => {
    const cs = constraintsFor({ kind: "per_instance" });
    const context = ctx({ clock: clock(1) });
    for (const bad of [-1, Number.NaN, 1.5]) {
      const r = consumeUsage(empty(), cs, context, "op", () => bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("invalid_maximum");
    }
  });
});

describe("V12 操作の冪等・取消の帰属", () => {
  const cs = constraintsFor({
    kind: "per_instance",
    duration: "turn",
    maxCount: 3,
  });
  const context = ctx({ clock: clock(1) });

  it("同一operationIdの再送は1回だけ加算 (冪等)", () => {
    const first = consumeUsage(empty(), cs, context, "op-1", fixedMax);
    if (!first.ok) throw new Error(first.reason);
    const again = consumeUsage(first.accounting, cs, context, "op-1", fixedMax);
    expect(again.ok && again.replayed).toBe(true);
    if (again.ok) expect(again.accounting).toBe(first.accounting);
    expect(
      queryUsage(first.accounting, cs, context, fixedMax).entries[0]!.used
    ).toBe(1);
  });

  it("同じ operationId で量や対象の枠が違う再送は、黙って成功にせず operation_conflict", () => {
    const first = consumeUsage(empty(), cs, context, "op-1", fixedMax);
    if (!first.ok) throw new Error(first.reason);
    const otherAmount = consumeUsage(
      first.accounting,
      cs,
      context,
      "op-1",
      fixedMax,
      2
    );
    expect(otherAmount).toEqual({ ok: false, reason: "operation_conflict" });
    const otherBucket = consumeUsage(
      first.accounting,
      cs,
      ctx({ clock: clock(1), sourceInstanceId: "a2" }),
      "op-1",
      fixedMax
    );
    expect(otherBucket).toEqual({ ok: false, reason: "operation_conflict" });
  });

  it("バトル外の battle 期間の観測は、照会と同じく止めず、何も記録しない", () => {
    const observation = buildUsageConstraint({
      abilityRef: effectAbilityRef("DEF-X", 0),
      share: "instance",
      period: "battle",
      measure: "observation",
    });
    const outside = ctx({ clock: clock(1) });
    expect(queryUsage(empty(), [observation], outside, fixedMax).allowed).toBe(
      true
    );
    const result = consumeUsage(
      empty(),
      [observation],
      outside,
      "op-obs",
      fixedMax
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accounting.buckets).toEqual([]);
      expect(result.operation.deltas).toEqual([]);
    }
  });

  it("別operationIdは別消費。旧refundは自身の差分だけを戻し、二重refundは不変", () => {
    let acc = use(empty(), cs, context, "op-1");
    acc = use(acc, cs, context, "op-2");
    acc = refundUsage(acc, "op-1");
    expect(queryUsage(acc, cs, context, fixedMax).entries[0]!.used).toBe(1);
    const twice = refundUsage(acc, "op-1");
    expect(twice).toBe(acc);
    expect(queryUsage(twice, cs, context, fixedMax).entries[0]!.used).toBe(1);
  });

  it("他プレイヤーの消費は旧refundで減らない", () => {
    const sharedCs = constraintsFor({
      kind: "per_card_name",
      duration: "turn",
      maxCount: 3,
    });
    const a = ctx({ clock: clock(1), playerId: "alice" });
    const b = ctx({ clock: clock(1), playerId: "bob", sourceInstanceId: "b1" });
    let acc = use(empty(), sharedCs, a, "op-a");
    acc = use(acc, sharedCs, b, "op-b");
    acc = refundUsage(acc, "op-a");
    expect(queryUsage(acc, sharedCs, b, fixedMax).entries[0]!.used).toBe(1);
    expect(queryUsage(acc, sharedCs, a, fixedMax).entries[0]!.used).toBe(0);
  });

  it("取消済みoperationIdの再送は拒否、負数や非整数の量は拒否", () => {
    const used = use(empty(), cs, context, "op-1");
    const refunded = refundUsage(used, "op-1");
    const resend = consumeUsage(refunded, cs, context, "op-1", fixedMax);
    expect(resend.ok).toBe(false);
    for (const bad of [-1, 1.5, Number.NaN]) {
      const r = consumeUsage(empty(), cs, context, "x", fixedMax, bad);
      expect(r.ok).toBe(false);
    }
  });

  it("使用者が欠落した文脈は拒否 (推測補完しない)", () => {
    const sharedCs = constraintsFor({ kind: "per_card_name" });
    const missing = { ...ctx({ clock: clock(1) }), playerId: "" };
    const r = consumeUsage(empty(), sharedCs, missing, "op", fixedMax);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_player");
  });

  it("queryは状態を変更しない", () => {
    const acc = use(empty(), cs, context, "op-1");
    const snapshot = JSON.stringify(acc);
    queryUsage(acc, cs, context, fixedMax);
    expect(JSON.stringify(acc)).toBe(snapshot);
  });

  it("並行する二つのstate branchが索引キャッシュを汚さない", () => {
    const base = use(empty(), cs, context, "op-1");
    const branchA = use(base, cs, context, "op-a");
    const branchB = use(base, cs, context, "op-b");
    expect(queryUsage(branchA, cs, context, fixedMax).entries[0]!.used).toBe(2);
    expect(queryUsage(branchB, cs, context, fixedMax).entries[0]!.used).toBe(2);
    expect(queryUsage(base, cs, context, fixedMax).entries[0]!.used).toBe(1);
  });
});

describe("V15 時計: 中断復帰で元の枠が見え、game枠は累積する", () => {
  const turnCs = constraintsFor({ kind: "per_instance", duration: "turn" }, 0);
  const stepCs = constraintsFor({ kind: "per_instance", duration: "step" }, 1);
  const gameCs = constraintsFor(
    { kind: "per_instance", duration: "game", maxCount: 5 },
    2
  );

  it("中断元のturn/step枠は追加ターン中に見えず、復帰で復元される。game消費は累積する", () => {
    const original = clock(7, 3);
    const extra = clock(9, 1);
    const inOriginal = ctx({ clock: original });
    const inExtra = ctx({ clock: extra });

    let acc = empty();
    acc = use(acc, turnCs, inOriginal, "t-7");
    acc = use(acc, stepCs, inOriginal, "s-3");
    acc = use(acc, gameCs, inOriginal, "g-1");

    // 追加ターンへ入る: 台帳は入れ替えない。中断元の時計は生存側に含める。
    acc = pruneAccounting(acc, [extra, original]);
    expect(queryUsage(acc, turnCs, inExtra, fixedMax).allowed).toBe(true);
    expect(queryUsage(acc, stepCs, inExtra, fixedMax).allowed).toBe(true);
    acc = use(acc, gameCs, inExtra, "g-2");
    acc = use(acc, turnCs, inExtra, "t-9");

    // 復帰: 追加ターン分は整理され、中断元の枠が再び見え、game累積は保たれる。
    acc = pruneAccounting(acc, [original]);
    expect(queryUsage(acc, turnCs, inOriginal, fixedMax).allowed).toBe(false);
    expect(queryUsage(acc, stepCs, inOriginal, fixedMax).allowed).toBe(false);
    expect(
      queryUsage(acc, gameCs, inOriginal, fixedMax).entries[0]
    ).toMatchObject({
      used: 2,
      remaining: 3,
    });
    expect(acc.buckets.some((b) => b.turnId === 9 && b.period === "turn")).toBe(
      false
    );
  });

  it("入れ子の中断でも各階層の枠が復元される", () => {
    const t1 = clock(1, 2);
    const t2 = clock(2, 2);
    const t3 = clock(3, 2);
    let acc = empty();
    acc = use(acc, turnCs, ctx({ clock: t1 }), "a");
    acc = use(acc, turnCs, ctx({ clock: t2 }), "b");
    acc = pruneAccounting(acc, [t3, t2, t1]);
    expect(acc.buckets.filter((b) => b.period === "turn")).toHaveLength(2);
    acc = pruneAccounting(acc, [t2, t1]);
    expect(queryUsage(acc, turnCs, ctx({ clock: t2 }), fixedMax).allowed).toBe(
      false
    );
    acc = pruneAccounting(acc, [t1]);
    expect(queryUsage(acc, turnCs, ctx({ clock: t1 }), fixedMax).allowed).toBe(
      false
    );
    expect(acc.buckets.filter((b) => b.period === "turn")).toHaveLength(1);
  });

  it("同じ序数のstepでもターンが違えば別枠 (追加ターン内のstepと衝突しない)", () => {
    const orig = ctx({ clock: clock(7, 3) });
    const extra = ctx({ clock: clock(9, 3) });
    const acc = use(empty(), stepCs, orig, "s");
    expect(queryUsage(acc, stepCs, extra, fixedMax).allowed).toBe(true);
  });

  it("参照中 (releaseされていない) のreceiptは期限切れだけでは消えず、release後に整理される", () => {
    const t1 = clock(1, 1);
    let acc = empty();
    acc = use(acc, turnCs, ctx({ clock: t1 }), "held");
    acc = pruneAccounting(acc, [clock(2, 1)]);
    expect(acc.operations.map((o) => o.operationId)).toEqual(["held"]);
    acc = releaseOperation(acc, "held");
    acc = pruneAccounting(acc, [clock(2, 1)]);
    expect(acc.operations).toEqual([]);
  });
});

describe("grant: 再開時に二重付与しない (V11基盤)", () => {
  const grant = {
    grantId: "g-1",
    grantKind: "additional_attack",
    playerId: "alice",
    sourceRef: effectAbilityRef("DEF-X", 0),
    total: 2,
    expires: { period: "turn" as const, turnId: 1, stepId: 1 },
    operationId: "grant-op-1",
  };

  it("同じgrantIdの再送は何も追加しない。内容が異なれば競合として拒否", () => {
    const first = grantUsage(empty(), grant);
    if (!first.ok) throw new Error(first.reason);
    const again = grantUsage(first.accounting, grant);
    expect(again.ok && again.replayed).toBe(true);
    if (again.ok) expect(again.accounting.grants).toHaveLength(1);
    const conflict = grantUsage(first.accounting, { ...grant, total: 5 });
    expect(conflict.ok).toBe(false);
  });
});

describe("observation は上限で止めない", () => {
  it("観測3回のうち発揮1回: 観測は数えるが使用枠は別 (V13基盤)", () => {
    const use1 = constraintsFor({ kind: "per_instance", duration: "turn" }, 0);
    const obs: UsageConstraint[] = use1.map((c) => ({
      ...c,
      constraintId: c.constraintId + "#obs",
      measure: "observation" as const,
    }));
    const context = ctx({ clock: clock(1) });
    let acc = empty();
    for (const id of ["o1", "o2", "o3"]) acc = use(acc, obs, context, id);
    acc = use(acc, use1, context, "fire");
    expect(queryUsage(acc, obs, context, fixedMax).entries[0]!.used).toBe(3);
    expect(queryUsage(acc, use1, context, fixedMax).entries[0]!.used).toBe(1);
    expect(queryUsage(acc, obs, context, fixedMax).allowed).toBe(true);
  });
});
