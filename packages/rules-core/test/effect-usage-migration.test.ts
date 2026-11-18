/**
 * P3-170 W5 / V14・V15: 旧形式の使用会計 → effectAccounting の版付き migration。
 *
 * 旧形式の入力は fixtures/legacy-effect-usage/*.json (旧 model.ts の型に従って組んだ state と、
 * 旧コードで作った実スナップショット real-*.json)。期待値は「同じ使用を新形式の本番 API
 * (fixture builder 経由) で行った state」との bucket 一致と、変換後の合法手 (使用可否) / 取消結果で検査する。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEmptyEffectAccounting,
  describeUsageBucket,
} from "../src/effect-usage";
import {
  migrateEffectAccounting,
  type UsageAccountingMigrationResult,
} from "../src/effect-usage/migration";
import { hasLegacyEffectUsageData } from "../src/effect-usage/legacy-guard";
import {
  canUseEffectUsage as canUseSite,
  refundEffectUsageOperations,
} from "../src/legal/legal-actions-shared";
import {
  getActiveAttackConnectBattleGrant,
  hasAdditionalAttackGrant,
  additionalAttackGrantRemaining,
} from "../src/mechanics/battle-grant-usage";
import { hasUsedMirageSetCountExemption } from "../src/mechanics/mirage-exemption-usage";
import {
  canUseAdventUsage,
  adventUsageSite,
} from "../src/mechanics/advent-usage";
import { divineSkillUsageSite } from "../src/legal/divine-skill-usage";
import { observedAmountThisTurn } from "../src/effect/effect-usage-accounting";
import {
  backfillOptionalStateFields,
  sanitizeStateForViewer,
} from "../src/state-sanitize";
import type { EffectUsageLimit, GameState } from "../src";
import {
  getCatalogDefinition,
  type Rec,
} from "./helpers/legacy-effect-usage-states";
import {
  canUseEffectUsage,
  listEffectUsage,
  seedEffectUsage,
} from "./helpers/effect-usage-fixture";
import {
  isCountGainModifierConsumed,
  isTaplessBattleDeclareUsed,
  isUseCostGatePaid,
} from "./helpers/dedicated-usage-fixture";
import {
  cappedLifeReduction,
  effectCauseLifeReduction,
  bpThresholdCappedLifeReduction,
  filteredCappedLifeReduction,
  symbolAdditionRestrictedCount,
  gimmickDeclarationCount,
} from "./helpers/quantity-usage-fixture";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "legacy-effect-usage"
);

function load(name: string): Rec {
  const raw = JSON.parse(
    readFileSync(join(FIXTURES, `${name}.json`), "utf8")
  ) as Rec;
  delete raw._comment;
  return raw;
}

const ctx = { getCardDefinitionById: getCatalogDefinition };

function migrate(raw: unknown): UsageAccountingMigrationResult {
  return migrateEffectAccounting(raw, ctx);
}

function migrateOk(raw: unknown): GameState {
  const result = migrate(raw);
  if (!result.ok) {
    throw new Error(
      `migration failed: ${result.error.path} ${result.error.reason} ${result.error.detail ?? ""}`
    );
  }
  return result.state;
}

it("BSDB01-C07 legacy high-count branch keeps the shared turn limit after migration", () => {
  const base = load("records-basic");
  const migrateCapsule = (effectLabel: string) =>
    migrateOk({
      ...base,
      effectUsageRecords: [
        {
          sourceInstanceId: "capsule",
          sourceDefinitionId: "BSDB01-C07",
          playerId: "alice",
          effectLabel,
          turnNumber: 3,
          step: "main",
          duration: "turn",
          count: 1,
          groupId: "BSDB01-C07-advent-draw",
        },
      ],
    });
  const previousHighCount = migrateCapsule("effect:3");
  const previousLowCount = migrateCapsule("effect:2");
  expect(previousHighCount.effectAccounting.buckets).toHaveLength(1);
  expect(amounts(previousHighCount)).toEqual(amounts(previousLowCount));
});

function migrateFail(raw: unknown) {
  const result = migrate(raw);
  if (result.ok) throw new Error("migration unexpectedly succeeded");
  return result.error;
}

/** bucket の (key → amount)。識別が同じなら一致する。 */
function amounts(
  state: Pick<GameState, "effectAccounting">
): Record<string, number> {
  return Object.fromEntries(
    state.effectAccounting.buckets.map((b) => [b.key, b.amount])
  );
}

function emptyAccounting(state: GameState): GameState {
  return { ...state, effectAccounting: createEmptyEffectAccounting() };
}

const limitOf = (
  cardNo: string,
  effectIndex: number
): EffectUsageLimit | EffectUsageLimit[] =>
  (
    getCatalogDefinition(cardNo)!.effects![effectIndex] as {
      usageLimit: EffectUsageLimit;
    }
  ).usageLimit;

const LEGACY_KEYS = [
  "effectUsageRecords",
  "effectOccurrenceRecords",
  "usedDivineSkillKeysThisTurn",
  "usedTrashAdventKeysThisTurn",
  "usedAlternateCostAdventKeysThisTurn",
  "usedAdventDeclareKeysThisTurn",
  "countGainModifierConsumedThisTurn",
  "pendingAdditionalAttackGrants",
  "usedTaplessBattleDeclareInstanceIdsThisTurn",
  "mirageSetCountExemptionsUsed",
  "mirageSetCountExemptionUsedPlayerIds",
  "declareGimmickGateUsedThisTurn",
  "lifeDamageInterceptionUseCostGateUsedThisTurn",
  "effectLifeReductionThisTurn",
  "declarationCountThisTurn",
  "lifeReductionCappedThisTurn",
  "filteredLifeReductionCappedThisTurn",
  "bpThresholdCappedLifeReductionThisTurn",
  "symbolAdditionRestrictedCountThisTurn",
];

function legacyKeysIn(obj: Rec): string[] {
  return LEGACY_KEYS.filter((k) => k in obj);
}

describe("V14(a) 通常: 新形式は不変・冪等", () => {
  it("変換済みの state は同じ参照を changed:false で返す", () => {
    const migrated = migrateOk(load("records-basic"));
    const again = migrate(migrated);
    expect(again).toEqual({ ok: true, state: migrated, changed: false });
    expect((again as { state: GameState }).state).toBe(migrated);
  });

  it("旧キーは除去され、会計版1とステップ序数0を持つ", () => {
    const raw = load("records-basic");
    const state = migrateOk(raw);
    expect(legacyKeysIn(state as unknown as Rec)).toEqual([]);
    expect(state.effectAccounting.version).toBe(1);
    expect(state.stepOrdinalThisTurn).toBe(0);
  });

  it("入力は変更しない", () => {
    const raw = load("records-basic");
    const before = JSON.stringify(raw);
    migrate(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it("空の旧配列/辞書だけの実スナップショットは空の会計へ変換できる (定義なしでも)", () => {
    const raw = (load("real-field-symbol-extension-snapshot") as { state: Rec })
      .state;
    expect(hasLegacyEffectUsageData(raw)).toBe(false);
    const result = migrateEffectAccounting(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.effectAccounting.buckets).toEqual([]);
      expect(legacyKeysIn(result.state as unknown as Rec)).toEqual([]);
    }
  });

  it("旧コードで作った実スナップショット (game 記録・契約合体代理・効果番号ラベル) を変換できる", () => {
    for (const name of ["real-flash-priority", "real-private-declaration"]) {
      const raw = load(name);
      expect(hasLegacyEffectUsageData(raw)).toBe(true);
      // 定義なしで空にはしない
      expect(migrateEffectAccounting(raw).ok).toBe(false);
      const state = migrateOk(raw);
      const used = state.effectAccounting.buckets.filter(
        (b) => b.measure === "use"
      );
      // 場のカードの起動効果 (spirit:0) の game 記録 ×2、契約合体代理 (同名・ターン)、effect:2 (個体・ターン)
      expect(used.map((b) => b.period).sort()).toEqual([
        "game",
        "game",
        "turn",
        "turn",
      ]);
      expect(used.every((b) => b.amount === 1)).toBe(true);
      // 期間と数量だけでなく、枠の識別(共有範囲・使用者・個体/同名)も旧 state の記録と一致する
      const entries = listEffectUsage(state);
      expect(entries).toHaveLength(4);
      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: "spirit:0",
            share: "instance",
            period: "game",
            playerId: "bob",
            sourceInstanceId: "card-52",
          }),
          expect.objectContaining({
            share: "card_name",
            period: "game",
            playerId: "alice",
            nameKey: "ソルティリーナ・セルルト",
          }),
          expect.objectContaining({
            share: "card_name",
            period: "turn",
            playerId: "bob",
            periodId: "turn:4",
            nameKey: "フェンリル極東支部",
          }),
          expect.objectContaining({
            label: "effect:2",
            share: "instance",
            period: "turn",
            playerId: "bob",
            periodId: "turn:4",
            sourceInstanceId: "card-50",
          }),
        ])
      );
      expect(legacyKeysIn(state as unknown as Rec)).toEqual([]);
      expect(migrate(state)).toMatchObject({ ok: true, changed: false });
    }
  });

  it("対応しない会計版は明示エラー", () => {
    const state = migrateOk(load("records-basic"));
    const future = {
      ...state,
      effectAccounting: { ...state.effectAccounting, version: 2 },
    };
    expect(migrateFail(future)).toMatchObject({
      code: "usage_accounting_migration_failed",
      reason: "unsupported_accounting_version",
      path: "state.effectAccounting.version",
    });
  });
});

describe("V14(b) 旧形式から変換: 残量・合法手が旧 state と等価", () => {
  it("effectUsageRecords: 制限ごとの記録を、本番 API で使用した state と同じ枠へ変換する", () => {
    const m = migrateOk(load("records-basic"));
    let expected = emptyAccounting(m);
    const seed = (
      id: string,
      cardNo: string,
      effectIndex: number,
      playerId: string
    ): void => {
      expected = seedEffectUsage(expected, {
        sourceInstanceId: id,
        effectLabel: `effect:${effectIndex}`,
        usageLimit: limitOf(cardNo, effectIndex),
        playerId,
        getCardDefinitionById: getCatalogDefinition,
      });
    };
    seed("komachi-a", "BSTH04-X03", 0, "alice");
    seed("flan-a", "BSTH01-X04", 1, "alice");
    seed("bakebake-a", "BSTH002-C01", 0, "alice");
    seed("flan-b", "BSTH01-X04", 1, "bob");
    expect(amounts(m)).toEqual(amounts(expected));
  });

  it("H3: 同一 duration の2制限は1回の使用 (count=2) を、各枠1回ずつの使用へ割る", () => {
    const m = migrateOk(load("records-basic"));
    for (const entry of listEffectUsage(m)) expect(entry.amount).toBe(1);
    // 化け化け(BSTH002-C01 effect:0)は〔個体・ターン〕と〔同名・ターン〕の2制限を持つ。
    // 旧記録は1件(count=2)で、変換後は2つの枠へ各1回ずつ割られる。
    const bakebake = listEffectUsage(m).filter(
      (e) =>
        e.sourceInstanceId === "bakebake-a" ||
        e.nameKey === getCatalogDefinition("BSTH002-C01")!.name
    );
    expect(bakebake).toHaveLength(2);
    expect(bakebake).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          share: "instance",
          period: "turn",
          sourceInstanceId: "bakebake-a",
          amount: 1,
        }),
        expect.objectContaining({
          share: "card_name",
          period: "turn",
          nameKey: getCatalogDefinition("BSTH002-C01")!.name,
          amount: 1,
        }),
      ])
    );
  });

  it("実離脱世代を持つ旧記録は、同じ世代の個体だけを使用済みにし、出直した個体(次の世代)は使える", () => {
    const raw = legacyState([{ id: "komachi-a", cardNo: "BSTH04-X03" }], {
      effectUsageRecords: [
        oldRecord({
          sourceInstanceId: "komachi-a",
          sourceDefinitionId: "BSTH04-X03",
          effectLabel: "effect:0",
          playerId: "alice",
          sourceFieldInstanceGeneration: 2,
        }),
      ],
    });
    (raw.cardInstances as Rec[])[0]!.fieldInstanceGeneration = 2;
    const m = migrateOk(raw);
    const options = {
      sourceInstanceId: "komachi-a",
      effectLabel: "effect:0",
      usageLimit: limitOf("BSTH04-X03", 0),
      playerId: "alice",
      getCardDefinitionById: getCatalogDefinition,
    };
    expect(canUseEffectUsage(m, options)).toBe(false);
    const reentered: GameState = {
      ...m,
      cardInstances: m.cardInstances.map((card) =>
        card.instanceId === "komachi-a"
          ? { ...card, fieldInstanceGeneration: 3 }
          : card
      ),
    };
    expect(canUseEffectUsage(reentered, options)).toBe(true);
  });

  it("使用済みの効果は再び使えず、相手プレイヤーの同名や別の枠は影響を受けない", () => {
    const m = migrateOk(load("records-basic"));
    const can = (
      id: string,
      cardNo: string,
      i: number,
      playerId: string
    ): boolean =>
      canUseEffectUsage(m, {
        sourceInstanceId: id,
        effectLabel: `effect:${i}`,
        usageLimit: limitOf(cardNo, i),
        playerId,
        getCardDefinitionById: getCatalogDefinition,
      });
    expect(can("komachi-a", "BSTH04-X03", 0, "alice")).toBe(false);
    expect(can("flan-a", "BSTH01-X04", 1, "alice")).toBe(false);
    expect(can("bakebake-a", "BSTH002-C01", 0, "alice")).toBe(false);
    expect(can("flan-b", "BSTH01-X04", 1, "bob")).toBe(false);
    // 期限切れの記録 (別ターン) は残らない
    expect(
      m.effectAccounting.buckets.every(
        (b) => b.period !== "turn" || b.turnId === 3
      )
    ).toBe(true);
    // 別ターンへ進むと turn 枠だけ再び使える (game 枠は残る)
    const next = { ...m, turnNumber: 4 } as GameState;
    expect(
      canUseEffectUsage(next, {
        sourceInstanceId: "komachi-a",
        effectLabel: "effect:0",
        usageLimit: limitOf("BSTH04-X03", 0),
        playerId: "alice",
        getCardDefinitionById: getCatalogDefinition,
      })
    ).toBe(true);
    expect(
      canUseEffectUsage(next, {
        sourceInstanceId: "flan-a",
        effectLabel: "effect:1",
        usageLimit: limitOf("BSTH01-X04", 1),
        playerId: "alice",
        getCardDefinitionById: getCatalogDefinition,
      })
    ).toBe(false);
  });

  it("神技キー: once / once_per_name / maxUsesPerTurn=2 / 制限なし(死に書き)を神技の枠へ変換する", () => {
    const m = migrateOk(load("divine-skill-keys"));
    const used = m.effectAccounting.buckets.filter((b) => b.measure === "use");
    // once(instance) / once_per_name / max2 の3枠。制限なしの技の死に書きは回数枠に載らない。
    expect(used.map((b) => b.amount).sort()).toEqual([1, 1, 2]);
    const site = (id: string, skillIndex: number) =>
      divineSkillUsageSite({
        state: m,
        sourceInstanceId: id,
        skillIndex,
        getCardDefinitionById: getCatalogDefinition,
      });
    expect(canUseSite(site("nexus-eiki", 0)!)).toBe(false);
    expect(canUseSite(site("nexus-miko-a", 0)!)).toBe(false);
    // 同名でも相手プレイヤー側は使える (使用者ごと)
    expect(canUseSite(site("nexus-miko-b", 0)!)).toBe(true);
    expect(canUseSite(site("nexus-yukari", 0)!)).toBe(false);
    expect(site("nexus-cardinal", 1)).toBeUndefined();
    // 宣言の観測は旧キーの件数ぶん (5件)
    expect(observedAmountThisTurn(m, "divine_skill")).toBe(5);
  });

  it("煌臨キー: 使用者付き(trash host)と、所有者が一意な name: キーを使用者ごとの枠へ変換する", () => {
    const m = migrateOk(load("advent-keys"));
    const used = m.effectAccounting.buckets.filter((b) => b.measure === "use");
    expect(used).toHaveLength(3);
    expect(used.every((b) => b.playerId === "alice" && b.amount === 1)).toBe(
      true
    );
    const defs = (cardNo: string) => getCatalogDefinition(cardNo)!;
    const can = (
      kind: "trash_host" | "alternate_cost" | "declare",
      cardNo: string,
      id: string,
      player: string
    ) =>
      canUseAdventUsage({
        state: m,
        kind,
        actingPlayerId: player,
        instanceId: id,
        definition: defs(cardNo),
      });
    expect(can("trash_host", "BSAZ01-C01", "kg6-c01", "alice")).toBe(false);
    expect(can("trash_host", "BSAZ01-C01", "kg6-c01", "bob")).toBe(true);
    expect(can("alternate_cost", "BSSL01-X01", "shadow-x01", "alice")).toBe(
      false
    );
    expect(can("declare", "BSSL01-X02", "shadow-x02", "alice")).toBe(false);
    expect(can("declare", "BSSL01-X02", "shadow-x02", "bob")).toBe(true);
    expect(adventUsageSite).toBeTypeOf("function");
  });

  it("専用の枠: I05 count gain / I06 tapless / I07 declare gimmick / I08 mirage / I10 use-cost-gate", () => {
    const m = migrateOk(load("dedicated-flags"));
    expect(
      isCountGainModifierConsumed(
        m,
        { sourceInstanceId: "rigurudo-a", sourceDefinitionId: "BSTS01-C03" },
        "alice"
      )
    ).toBe(true);
    expect(isTaplessBattleDeclareUsed(m, "renki-a")).toBe(true);
    expect(isUseCostGatePaid(m, "alice", "sou-m05")).toBe(true);
    expect(
      hasUsedMirageSetCountExemption({
        state: m,
        playerId: "alice",
        cardNo: "BSTH002-C01",
      })
    ).toBe(true);
    // 別プレイヤーには成立しない
    expect(
      hasUsedMirageSetCountExemption({
        state: m,
        playerId: "bob",
        cardNo: "BSTH002-C01",
      })
    ).toBe(false);
    const gimmick = m.effectAccounting.buckets.filter((b) =>
      describeUsageBucket(b)?.ability?.path.endsWith("declareGimmickGate")
    );
    expect(gimmick).toHaveLength(1);
  });

  it('旧 mirage の cardNo="*" は、特定のカード名に捏造せず、そのターンの全同名を使用済みにする', () => {
    const m = migrateOk(load("mirage-player-wide"));
    const names = m.effectAccounting.buckets
      .map((b) => describeUsageBucket(b)?.nameKey)
      .sort();
    expect(names).toEqual(["*"]);
    expect(
      hasUsedMirageSetCountExemption({
        state: m,
        playerId: "alice",
        cardNo: "BSTH002-C01",
      })
    ).toBe(true);
    expect(
      hasUsedMirageSetCountExemption({
        state: m,
        playerId: "bob",
        cardNo: "BSTH002-C01",
      })
    ).toBe(false);
    // 次のターンでは再び使える
    expect(
      hasUsedMirageSetCountExemption({
        state: { ...m, turnNumber: 4 } as GameState,
        playerId: "alice",
        cardNo: "BSTH002-C01",
      })
    ).toBe(false);
  });

  it('最古の版の mirageSetCountExemptionUsedPlayerIds は cardNo="*" と同じ扱い', () => {
    const m = migrateOk(load("mirage-ancient-player-ids"));
    expect(
      hasUsedMirageSetCountExemption({
        state: m,
        playerId: "bob",
        cardNo: "BSTH002-C01",
      })
    ).toBe(true);
  });

  it("数量・宣言事実・観測 (I13〜I15): 本番 API と同じ枠・量へ変換する", () => {
    const m = migrateOk(load("quantities"));
    expect(effectCauseLifeReduction(m, "bob")).toBe(2);
    expect(cappedLifeReduction(m, "bob")).toBe(3);
    expect(bpThresholdCappedLifeReduction(m, "bob")).toBe(1);
    const ce21 = {
      sourceInstanceId: "noh-a",
      sourceDefinitionId: "BSTH08.5-C21",
      provenance: { effectIndex: 0, stepIndex: 0 },
    };
    const ce22 = {
      sourceInstanceId: "riguru-a",
      sourceDefinitionId: "BSTH03-C04",
      provenance: { effectIndex: 2, stepIndex: 0 },
    };
    expect(filteredCappedLifeReduction(m, "bob", ce21 as never)).toBe(2);
    expect(symbolAdditionRestrictedCount(m, "bob", ce22 as never)).toBe(1);
    expect(gimmickDeclarationCount(m, "alice")).toBe(1);
    const observations = m.effectAccounting.buckets.filter(
      (b) => b.measure === "observation"
    );
    expect(observations.map((b) => b.amount)).toEqual([3]);
  });

  it("権利: 追加アタック権(各要素=1権利)とコネクトバトル権(残量)を由来不明の legacy grant として移す", () => {
    const m = migrateOk(load("grants"));
    expect(additionalAttackGrantRemaining(m, "sakuya-a")).toBe(2);
    expect(hasAdditionalAttackGrant(m, "sakuya-a")).toBe(true);
    const connect = getActiveAttackConnectBattleGrant(m);
    expect(connect).toMatchObject({
      sourceInstanceId: "yugi-a",
      remaining: 2,
      used: 0,
    });
    for (const grant of m.effectAccounting.grants) {
      expect(grant.sourceRef.kind).toBe("rule");
      expect(grant.sourceRef.path).toBe("legacy");
    }
    // 決定待ちは同じ権利を参照する (旧: 残量の複写)
    expect(m.pendingConnectBattleDecision).toMatchObject({
      grantId: connect!.grantId,
      attackId: "attack-1",
    });
    expect(m.pendingConnectBattleDecision).not.toHaveProperty("remainingUses");
    expect(m.activeAttack).not.toHaveProperty("connectBattleGrant");
    expect(m.activeAttack?.connectBattleGrantId).toBe(connect!.grantId);
  });
});

describe("V14(c) 新旧競合は原本不変の明示エラー", () => {
  it("新旧の使用量が異なれば競合エラー", () => {
    const migrated = migrateOk(load("records-basic"));
    const hybrid = {
      ...migrated,
      effectUsageRecords: [
        {
          sourceInstanceId: "komachi-a",
          sourceDefinitionId: "BSTH04-X03",
          playerId: "alice",
          effectLabel: "effect:0",
          turnNumber: 3,
          step: "main",
          duration: "turn",
          count: 1,
        },
      ],
    };
    // 新形式には komachi-a の使用が既にあり、旧は同量。さらに旧だけに別の枠を足して食い違わせる
    hybrid.effectUsageRecords.push({
      sourceInstanceId: "flan-b",
      sourceDefinitionId: "BSTH01-X04",
      playerId: "bob",
      effectLabel: "effect:1",
      turnNumber: 3,
      step: "main",
      duration: "game",
      count: 1,
    });
    // 食い違わせた後の入力そのものを渡し、失敗しても入力(原本)が変わらないことを検査する。
    const input = JSON.parse(JSON.stringify(hybrid));
    const before = JSON.stringify(input);
    const error = migrateFail(input);
    expect(error).toMatchObject({ reason: "legacy_new_conflict" });
    expect(JSON.stringify(input)).toBe(before);
  });

  it("新旧が等価と証明できる入力は旧キーだけを除去する", () => {
    const migrated = migrateOk(load("records-basic"));
    const equal = {
      ...migrated,
      effectUsageRecords: (
        load("records-basic") as { effectUsageRecords: unknown[] }
      ).effectUsageRecords,
    };
    const result = migrate(equal);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(legacyKeysIn(result.state as unknown as Rec)).toEqual([]);
      expect(amounts(result.state)).toEqual(amounts(migrated));
    }
  });

  it("新旧の権利が両方ある入力は等価性を証明できず競合エラー", () => {
    const migrated = migrateOk(load("grants"));
    const hybrid = {
      ...migrated,
      pendingAdditionalAttackGrants: ["sakuya-a"],
    };
    expect(migrateFail(hybrid)).toMatchObject({
      reason: "legacy_new_conflict",
    });
  });
});

describe("V14(d) 復元不能は明示エラーで入力不変", () => {
  const cases: [string, () => Rec, string, RegExp | string][] = [
    [
      "使用者が一意に決まらない name: 煌臨キー",
      () => load("advent-name-key-ambiguous"),
      "advent_user_unresolvable",
      "state.usedAlternateCostAdventKeysThisTurn[0]",
    ],
    [
      "解決できない旧ラベル",
      () => {
        const raw = load("records-basic") as { effectUsageRecords: Rec[] };
        raw.effectUsageRecords.push({
          sourceInstanceId: "komachi-a",
          sourceDefinitionId: "BSTH04-X03",
          playerId: "alice",
          effectLabel: "hand_activated:9",
          turnNumber: 3,
          step: "main",
          duration: "turn",
          count: 1,
        });
        return raw as unknown as Rec;
      },
      "usage_label_unresolvable",
      "state.effectUsageRecords[7]",
    ],
    [
      "制限数で割り切れない count",
      () => {
        const raw = load("records-basic") as { effectUsageRecords: Rec[] };
        raw.effectUsageRecords[3]!.count = 3;
        return raw as unknown as Rec;
      },
      "usage_record_count_not_divisible",
      "state.effectUsageRecords[3]",
    ],
    [
      "消えた CE の declareGimmick キー",
      () => {
        const raw = load("dedicated-flags") as {
          activeContinuousEffects: Rec[];
        };
        raw.activeContinuousEffects = [];
        return raw as unknown as Rec;
      },
      "continuous_effect_missing",
      // 辞書キー (プレイヤーID:効果ID) は path に出さず、位置だけで示す。
      "state.declareGimmickGateUsedThisTurn[0]",
    ],
    [
      "解釈できない神技キー",
      () => {
        const raw = load("divine-skill-keys") as {
          usedDivineSkillKeysThisTurn: string[];
        };
        raw.usedDivineSkillKeysThisTurn.push("garbage");
        return raw as unknown as Rec;
      },
      "divine_skill_key_unparsable",
      "state.usedDivineSkillKeysThisTurn[5]",
    ],
    [
      "使用者を導出できない記録 (支配変更の可能性)",
      () => {
        const raw = load("records-basic") as {
          effectUsageRecords: Rec[];
          cardInstances: Rec[];
        };
        delete raw.effectUsageRecords[0]!.playerId;
        const card = raw.cardInstances.find(
          (c) => c.instanceId === "komachi-a"
        )!;
        card.controllerPlayerId = "bob";
        return raw as unknown as Rec;
      },
      "usage_player_unresolvable",
      "state.effectUsageRecords[0]",
    ],
    // 旧版が「宣言時に消費済み」を運んでいたフラグは、対応する枠を一意に特定できない。
    // 黙って落とすと解決時に再評価されて必須誘発が消えるので、途中の読込を明示エラーにする。
    [
      "宣言時消費済みの pending 誘発 (usageLimitConsumedOnPrivateDeclaration)",
      () => {
        const raw = load("records-basic");
        raw.pendingTriggeredEffects = [
          { pendingId: "p1", usageLimitConsumedOnPrivateDeclaration: true },
        ];
        return raw;
      },
      "unconvertible_in_flight_usage_flag",
      "state.pendingTriggeredEffects[0].usageLimitConsumedOnPrivateDeclaration",
    ],
    [
      "宣言時消費済みの継続効果 (usageLimitConsumed)",
      () => {
        const raw = load("records-basic");
        raw.activeContinuousEffects = [{ id: "ce1", usageLimitConsumed: true }];
        return raw;
      },
      "unconvertible_in_flight_usage_flag",
      "state.activeContinuousEffects[0].usageLimitConsumed",
    ],
    [
      "ミラージュ免除を消費済みのスタック (mirageSetCountExemptionConsumed)",
      () => {
        const raw = load("records-basic");
        raw.mirageStackWindow = { mirageSetCountExemptionConsumed: true };
        return raw;
      },
      "unconvertible_in_flight_usage_flag",
      "state.mirageStackWindow.mirageSetCountExemptionConsumed",
    ],
    [
      "消費済みの共有グループを持つ step 文脈 (consumedUsageGroups)",
      () => {
        const raw = load("records-basic");
        raw.pendingStepContext = { consumedUsageGroups: ["group-a"] };
        return raw;
      },
      "unconvertible_in_flight_usage_flag",
      "state.pendingStepContext.consumedUsageGroups",
    ],
  ];
  for (const [name, build, reason, path] of cases) {
    it(`${name}`, () => {
      const raw = build();
      const before = JSON.stringify(raw);
      const error = migrateFail(raw);
      expect(error).toMatchObject({
        code: "usage_accounting_migration_failed",
        reason,
        path,
      });
      expect(JSON.stringify(raw)).toBe(before);
    });
  }

  it("定義が渡されていない非空の旧データは、黙って空にせず明示エラー", () => {
    const result = migrateEffectAccounting(load("records-basic"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("definitions_required");
  });

  it("旧データが非空なのに migration を通らない backfill は拒否する (空の会計で使用済みを失わない)", () => {
    expect(() =>
      backfillOptionalStateFields(load("records-basic") as never)
    ).toThrow(/migrateEffectAccounting/);
    const migrated = migrateOk(load("records-basic"));
    expect(
      backfillOptionalStateFields(migrated).effectAccounting.buckets.length
    ).toBeGreaterThan(0);
  });
});

describe("V14(d2) 読み込んだ会計の形・値の検査 (版1でも破損は明示エラー)", () => {
  const sound = (): Rec => {
    const state = JSON.parse(JSON.stringify(migrateOk(load("records-basic"))));
    expect(state.effectAccounting.buckets.length).toBeGreaterThan(0);
    return state as Rec;
  };
  const accountingOf = (state: Rec): Rec => state.effectAccounting as Rec;
  const firstBucket = (state: Rec): Rec =>
    (accountingOf(state).buckets as Rec[])[0] as Rec;
  const cases: [string, (s: Rec) => void, string][] = [
    [
      "buckets が欠けた版1の会計",
      (s) => {
        s.effectAccounting = { version: 1, nextOperationSeq: 0 };
      },
      "state.effectAccounting.buckets",
    ],
    [
      "負の bucket 量",
      (s) => {
        firstBucket(s).amount = -3;
      },
      "state.effectAccounting.buckets[0].amount",
    ],
    [
      "null の bucket 量",
      (s) => {
        firstBucket(s).amount = null;
      },
      "state.effectAccounting.buckets[0].amount",
    ],
    [
      "小数の bucket 量",
      (s) => {
        firstBucket(s).amount = 1.5;
      },
      "state.effectAccounting.buckets[0].amount",
    ],
    [
      "未知の期間",
      (s) => {
        firstBucket(s).period = "forever";
      },
      "state.effectAccounting.buckets[0].period",
    ],
    [
      "operation の delta が整数でない",
      (s) => {
        accountingOf(s).operations = [
          {
            operationId: "op-x",
            turnId: 1,
            status: "applied",
            deltas: [{ bucketKey: "k", delta: "1" }],
          },
        ];
      },
      "state.effectAccounting.operations[0].deltas[0].delta",
    ],
  ];
  for (const [name, corrupt, path] of cases) {
    it(`${name}`, () => {
      const raw = sound();
      corrupt(raw);
      const before = JSON.stringify(raw);
      const result = migrateEffectAccounting(raw, ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toBe("invalid_accounting_shape");
        expect(result.error.path).toBe(path);
      }
      expect(JSON.stringify(raw)).toBe(before);
    });
  }

  it("effectAccounting が null の入力は、空の会計にせず明示エラー(使用済みを黙って失わない)", () => {
    const raw = sound();
    raw.effectAccounting = null;
    const before = JSON.stringify(raw);
    const result = migrateEffectAccounting(raw, ctx);
    expect(result).toMatchObject({
      ok: false,
      error: {
        reason: "invalid_accounting_shape",
        path: "state.effectAccounting",
      },
    });
    expect(JSON.stringify(raw)).toBe(before);
  });

  it("重複した bucket key は後ろの要素で検出する", () => {
    const raw = sound();
    const buckets = accountingOf(raw).buckets as Rec[];
    buckets.push({ ...(buckets[0] as Rec) });
    const result = migrateEffectAccounting(raw, ctx);
    expect(result).toMatchObject({
      ok: false,
      error: {
        reason: "invalid_accounting_shape",
        path: `state.effectAccounting.buckets[${buckets.length - 1}].key`,
      },
    });
  });

  it("正常な会計は不変で通る (検査が正常系を拒否しない)", () => {
    const raw = sound();
    const result = migrateEffectAccounting(raw, ctx);
    expect(result).toMatchObject({ ok: true, changed: false });
  });
});

describe("V14(e) 入れ子の pending", () => {
  it("priorStateSnapshot を持つ pendingZoneSelection: 親と入れ子をそれぞれ独立に変換する", () => {
    const m = migrateOk(load("nested-prior-snapshot"));
    const inner = (
      m.pendingZoneSelection as unknown as { priorStateSnapshot: GameState }
    ).priorStateSnapshot;
    expect(inner.effectAccounting.version).toBe(1);
    expect(legacyKeysIn(inner as unknown as Rec)).toEqual([]);
    expect(legacyKeysIn(m as unknown as Rec)).toEqual([]);
    // 親は once_per_name、入れ子は once(instance) の使用。互いに混ざらない。
    const kinds = (s: GameState): string[] =>
      s.effectAccounting.buckets
        .filter((b) => b.measure === "use")
        .map((b) => describeUsageBucket(b)!.share)
        .sort();
    expect(kinds(m)).toEqual(["card_name"]);
    expect(kinds(inner)).toEqual(["instance"]);
    // 冪等
    expect(migrate(m)).toMatchObject({ ok: true, changed: false });
  });

  it("入れ子の state で復元不能なら path に入れ子を含めて失敗する", () => {
    const raw = load("nested-prior-snapshot") as {
      pendingZoneSelection: {
        priorStateSnapshot: { usedDivineSkillKeysThisTurn: string[] };
      };
    };
    raw.pendingZoneSelection.priorStateSnapshot.usedDivineSkillKeysThisTurn = [
      "garbage",
    ];
    const error = migrateFail(raw);
    expect(error.path).toBe(
      "state.pendingZoneSelection.priorStateSnapshot.usedDivineSkillKeysThisTurn[0]"
    );
  });
});

describe("V14(f)/V15 追加ターンの入れ子 (returnContext 連鎖)", () => {
  it("中断元の turn 記録は中断元の時計 (turnNumber・ステップ序数) へ、game 記録は二重加算しない", () => {
    const m = migrateOk(load("extra-turn-nested"));
    const used = m.effectAccounting.buckets.filter((b) => b.measure === "use");
    // game 記録は現行 state のもの (turn 4 に作成) だけを数え、退避側の game 記録は (ラベルが解決できなくても) 数えない。
    // 中断元 turn 3 の神技 once、さらにその前 turn 2 の once_per_name。
    const turns = used.map((b) => b.turnId).sort();
    expect(turns).toEqual([2, 3, 4]);
    expect(m.extraTurnState?.returnContext?.turnContext).not.toHaveProperty(
      "usedDivineSkillKeysThisTurn"
    );
    expect(m.extraTurnState?.returnContext).not.toHaveProperty(
      "effectUsageRecords"
    );
    expect(
      m.extraTurnState?.returnContext?.turnContext?.stepOrdinalThisTurn
    ).toBe(0);
    // 現在のターン(5)の時計では中断元の枠は見えず、中断元のターンへ戻ると再び見える (台帳は入れ替えない)。
    expect(
      m.effectAccounting.buckets.filter((b) => b.turnId === m.turnNumber)
    ).toEqual([]);
    expect(migrate(m)).toMatchObject({ ok: true, changed: false });
  });
});

describe("V14(g) 旧 recordedUsage の receipt 合成と取消", () => {
  it("旧 refund が戻していた枠を差分に持つ操作を合成し、取消でその差分だけを戻す", () => {
    const m = migrateOk(load("recorded-usage-stack"));
    const stack = m.stackWindow!.pendingStackAction as unknown as {
      recordedUsage: { operationIds: string[] };
    };
    expect(stack.recordedUsage).not.toHaveProperty("effectLabel");
    expect(stack.recordedUsage.operationIds).toHaveLength(1);
    const options = {
      sourceInstanceId: "komachi-a",
      effectLabel: "effect:0",
      usageLimit: limitOf("BSTH04-X03", 0),
      playerId: "alice",
      getCardDefinitionById: getCatalogDefinition,
    };
    expect(canUseEffectUsage(m, options)).toBe(false);
    const refunded = refundEffectUsageOperations(
      m,
      stack.recordedUsage.operationIds
    );
    expect(canUseEffectUsage(refunded, options)).toBe(true);
    // 二度目の取消は何も戻さない
    expect(
      refundEffectUsageOperations(refunded, stack.recordedUsage.operationIds)
        .effectAccounting.buckets
    ).toEqual(refunded.effectAccounting.buckets);
  });

  it("取消対象の記録が現在のステップに無い recordedUsage は、旧 refund と同じく何も戻さない", () => {
    const raw = load("recorded-usage-stack") as { effectUsageRecords: Rec[] };
    // 取消対象(komachi-a の effect:0)の記録を、別の枠(flan-a の effect:1・game)の記録に差し替える。
    const other = (
      load("records-basic") as { effectUsageRecords: Rec[] }
    ).effectUsageRecords.filter((r) => r.sourceInstanceId === "flan-a");
    expect(other.length).toBeGreaterThan(0);
    raw.effectUsageRecords = other;
    const m = migrateOk(raw);
    const stack = m.stackWindow!.pendingStackAction as unknown as {
      recordedUsage: { operationIds: string[] };
    };
    const usedBefore = amounts(m);
    expect(Object.keys(usedBefore).length).toBeGreaterThan(0);
    // 取消は、無関係な枠(別効果の使用)を減らさない
    expect(
      amounts(refundEffectUsageOperations(m, stack.recordedUsage.operationIds))
    ).toEqual(usedBefore);
  });
});

describe("V14(h) 2回変換の一致", () => {
  it("すべての fixture で、2回変換した結果が1回と一致する", () => {
    for (const name of [
      "records-basic",
      "divine-skill-keys",
      "advent-keys",
      "dedicated-flags",
      "mirage-player-wide",
      "quantities",
      "grants",
      "recorded-usage-stack",
      "nested-prior-snapshot",
      "extra-turn-nested",
    ]) {
      const once = migrateOk(load(name));
      const twice = migrate(once);
      expect(twice.ok).toBe(true);
      if (twice.ok) expect(twice.state).toEqual(once);
    }
  });
});

// ---------------------------------------------------------------
// 旧ラベルの解決と取消の運搬フィールド (追加)
// ---------------------------------------------------------------
import { readFileSync as readSource } from "node:fs";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { expandCardDefinitionsWithBackFaces } from "../src";
import {
  CONTRACT_COMBINE_PROXY_USAGE_LABEL,
  CONTRACT_COMBINE_PROXY_USAGE_LIMIT,
  FIELD_MAGIC_PRE_COST_TRIGGER_USAGE_LABEL,
  FIELD_MAGIC_PRE_COST_TRIGGER_USAGE_LIMIT,
  FIXED_RULE_LABEL_LIMITS,
} from "../src/effect-usage/fixed-labels";
import { legacyState, oldRecord } from "./helpers/legacy-effect-usage-states";

describe("旧ラベルの解決", () => {
  it("magic ラベル: 制限付きの効果が1つに決まるカードだけ変換する", () => {
    const state = legacyState(
      [{ id: "again-a", cardNo: "BSAZ03-C01", zone: "trash" }],
      {
        effectUsageRecords: [
          oldRecord({
            sourceInstanceId: "again-a",
            sourceDefinitionId: "BSAZ03-C01",
            effectLabel: "magic",
            playerId: "alice",
          }),
        ],
      }
    );
    const m = migrateOk(state);
    expect(listEffectUsage(m)).toHaveLength(1);
    // 制限付きの効果が複数あるカードの magic は一意に決まらず失敗する
    const ambiguous = legacyState(
      [{ id: "ancient-a", cardNo: "BSAZ02-C13", zone: "trash" }],
      {
        effectUsageRecords: [
          oldRecord({
            sourceInstanceId: "ancient-a",
            sourceDefinitionId: "BSAZ02-C13",
            effectLabel: "magic",
            playerId: "alice",
          }),
        ],
      }
    );
    expect(migrateFail(ambiguous)).toMatchObject({
      reason: "usage_label_unresolvable",
      path: "state.effectUsageRecords[0]",
    });
  });

  it("__step: ラベル: step の usageLimit を持つ効果を変換する", () => {
    const defs = expandCardDefinitionsWithBackFaces(ALL_CARDS);
    let found:
      | { cardNo: string; effectIndex: number; stepIndex: number }
      | undefined;
    for (const def of defs) {
      (def.effects ?? []).forEach((effect, effectIndex) => {
        (effect.steps ?? []).forEach((step, stepIndex) => {
          const s = step as { usageLimit?: unknown; usageGroupId?: string };
          if (
            !found &&
            s.usageLimit &&
            !Array.isArray(s.usageLimit) &&
            !s.usageGroupId
          ) {
            found = { cardNo: def.cardNo, effectIndex, stepIndex };
          }
        });
      });
    }
    expect(found).toBeDefined();
    const { cardNo, effectIndex, stepIndex } = found!;
    const limit = (
      getCatalogDefinition(cardNo)!.effects![effectIndex]!.steps![
        stepIndex
      ] as {
        usageLimit: EffectUsageLimit;
      }
    ).usageLimit;
    const record = oldRecord({
      sourceInstanceId: "step-a",
      sourceDefinitionId: cardNo,
      effectLabel: `__step:${cardNo}:${effectIndex}:${stepIndex}`,
      playerId: "alice",
      duration: limit.duration ?? "turn",
    });
    const m = migrateOk(
      legacyState([{ id: "step-a", cardNo }], { effectUsageRecords: [record] })
    );
    expect(
      m.effectAccounting.buckets.filter((b) => b.measure === "use")
    ).toHaveLength(1);
  });

  it("エンジン内で固定の枠の旧ラベル(契約合体の代理・場の魔法の使用前誘発)は、同名・ターンの枠へ変換する", () => {
    for (const effectLabel of [
      "contract_combine_proxy",
      "field_magic_pre_cost_trigger",
    ]) {
      const state = legacyState([{ id: "fixed-a", cardNo: "BSTH04-X03" }], {
        effectUsageRecords: [
          oldRecord({
            sourceInstanceId: "fixed-a",
            sourceDefinitionId: "BSTH04-X03",
            effectLabel,
            playerId: "alice",
          }),
        ],
      });
      const m = migrateOk(state);
      expect(listEffectUsage(m)).toEqual([
        expect.objectContaining({
          share: "card_name",
          period: "turn",
          playerId: "alice",
          periodId: "turn:3",
          amount: 1,
          nameKey: getCatalogDefinition("BSTH04-X03")!.name,
        }),
      ]);
      // 変換した枠は、エンジンが同じラベルで照会する制限と同じ識別になり、使用済みとして効く。
      const options = {
        sourceInstanceId: "fixed-a",
        effectLabel,
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
        } as EffectUsageLimit,
        playerId: "alice",
        getCardDefinitionById: getCatalogDefinition,
      };
      expect(canUseEffectUsage(m, options)).toBe(false);
      expect(canUseEffectUsage(emptyAccounting(m), options)).toBe(true);
    }
  });

  it("固定ラベルの制限は、エンジンと移行が同じ定数表 (effect-usage/fixed-labels.ts) を使い、リテラルを重複して持たない", () => {
    // 移行の表とエンジンの定数は同一の表から作られる
    expect(FIXED_RULE_LABEL_LIMITS[CONTRACT_COMBINE_PROXY_USAGE_LABEL]).toBe(
      CONTRACT_COMBINE_PROXY_USAGE_LIMIT
    );
    expect(
      FIXED_RULE_LABEL_LIMITS[FIELD_MAGIC_PRE_COST_TRIGGER_USAGE_LABEL]
    ).toBe(FIELD_MAGIC_PRE_COST_TRIGGER_USAGE_LIMIT);
    // エンジン側のファイルは、ラベルと制限のリテラルを再び書かない (定数表だけが正源)
    for (const path of [
      "../src/mechanics/contract-combine-system.ts",
      "../src/legal/field-magic-pre-cost-trigger.ts",
      "../src/legal/legal-actions-availability.ts",
    ]) {
      const source = readSource(new URL(path, import.meta.url), "utf8");
      expect(source, path).not.toContain('"contract_combine_proxy"');
      expect(source, path).not.toContain('"field_magic_pre_cost_trigger"');
    }
    for (const path of [
      "../src/mechanics/contract-combine-system.ts",
      "../src/legal/field-magic-pre-cost-trigger.ts",
    ]) {
      const source = readSource(new URL(path, import.meta.url), "utf8");
      expect(source, path).not.toContain(
        'usageLimit: { kind: "per_card_name", duration: "turn" }'
      );
    }
  });
});

describe("取消の運搬フィールド", () => {
  const komachi = [{ id: "komachi-a", cardNo: "BSTH04-X03" }];
  const komachiRecord = oldRecord({
    sourceInstanceId: "komachi-a",
    sourceDefinitionId: "BSTH04-X03",
    effectLabel: "effect:0",
    playerId: "alice",
  });
  const options = {
    sourceInstanceId: "komachi-a",
    effectLabel: "effect:0",
    usageLimit: limitOf("BSTH04-X03", 0),
    playerId: "alice",
    getCardDefinitionById: getCatalogDefinition,
  };

  it("refundableUsageEntries (ターン終了/アタックステップ終了の予約) は refundableUsage の receipt へ置き換わる", () => {
    const m = migrateOk(
      legacyState(komachi, {
        effectUsageRecords: [komachiRecord],
        pendingTurnEndFinalizations: [
          {
            pendingId: "tef-1",
            actingPlayerId: "alice",
            sourceInstanceId: "komachi-a",
            createdAtTurn: 3,
            refundableUsageEntries: [
              {
                effectLabel: "effect:0",
                usageLimit: { kind: "per_instance", duration: "turn" },
              },
            ],
          },
        ],
      })
    );
    const pending = m.pendingTurnEndFinalizations[0] as unknown as Rec;
    expect(pending).not.toHaveProperty("refundableUsageEntries");
    const usage = pending.refundableUsage as { operationIds: string[] };
    expect(usage.operationIds).toHaveLength(1);
    expect(canUseEffectUsage(m, options)).toBe(false);
    expect(
      canUseEffectUsage(
        refundEffectUsageOperations(m, usage.operationIds),
        options
      )
    ).toBe(true);
  });

  it("normalHandPlayRollback の declarationUsageDeltas は declarationUsageOperationIds へ置き換わり、取消はその差分だけを戻す", () => {
    const other = oldRecord({
      sourceInstanceId: "flan-a",
      sourceDefinitionId: "BSTH01-X04",
      effectLabel: "effect:1",
      playerId: "alice",
      duration: "game",
    });
    const m = migrateOk(
      legacyState([...komachi, { id: "flan-a", cardNo: "BSTH01-X04" }], {
        effectUsageRecords: [komachiRecord, other],
        stackWindow: {
          priorityPlayerId: "bob",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: "alice",
          pendingStackAction: {
            cardInstanceId: "komachi-a",
            normalHandPlayRollback: {
              declarationUsageDeltas: [komachiRecord],
              declarationOccurrenceDeltas: [],
            },
          },
        },
      })
    );
    const rollback = (
      m.stackWindow!.pendingStackAction as unknown as {
        normalHandPlayRollback: Rec;
      }
    ).normalHandPlayRollback;
    expect(rollback).not.toHaveProperty("declarationUsageDeltas");
    expect(rollback).not.toHaveProperty("declarationOccurrenceDeltas");
    const ids = rollback.declarationUsageOperationIds as string[];
    expect(ids).toHaveLength(1);
    const refunded = refundEffectUsageOperations(m, ids);
    expect(canUseEffectUsage(refunded, options)).toBe(true);
    // 宣言と無関係な枠 (flan-a の game) は戻らない
    expect(
      refunded.effectAccounting.buckets.some((b) => b.period === "game")
    ).toBe(true);
  });

  it("recordedUsage の発揮元が決まらず、一致しうる記録が現在のステップにあれば失敗する", () => {
    const raw = legacyState(komachi, {
      effectUsageRecords: [komachiRecord],
      stackWindow: {
        priorityPlayerId: "bob",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "alice",
        pendingStackAction: {
          recordedUsage: {
            effectLabel: "effect:0",
            usageLimit: { kind: "per_instance", duration: "turn" },
          },
        },
      },
    });
    expect(migrateFail(raw)).toMatchObject({
      reason: "receipt_source_ambiguous",
      path: "state.stackWindow.pendingStackAction.recordedUsage",
    });
  });
});

import {
  GAME_SNAPSHOT_SCHEMA_VERSION,
  parseGameSnapshot,
} from "../src/snapshot";

describe("snapshot の版 (schemaVersion 4)", () => {
  const envelope = (schemaVersion: number, state: Rec): Rec => ({
    schemaVersion,
    savedAt: "2026-11-07T00:00:00.000Z",
    state,
  });

  it("v1〜v3 の旧形式は定義解決つきで migration を通り、v4 で返る", () => {
    expect(GAME_SNAPSHOT_SCHEMA_VERSION).toBe(4);
    for (const version of [1, 2, 3]) {
      const parsed = parseGameSnapshot(
        envelope(version, load("records-basic")),
        ctx
      );
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.snapshot.schemaVersion).toBe(4);
        expect(
          parsed.snapshot.state.effectAccounting.buckets.length
        ).toBeGreaterThan(0);
        expect(legacyKeysIn(parsed.snapshot.state as unknown as Rec)).toEqual(
          []
        );
      }
    }
  });

  it("旧形式の非空データがあるのに定義が渡されない場合は、黙って空にせず明示エラー", () => {
    const parsed = parseGameSnapshot(envelope(3, load("records-basic")));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain("usage_accounting_migration_failed");
      expect(parsed.migrationError).toMatchObject({
        code: "usage_accounting_migration_failed",
        reason: "definitions_required",
      });
    }
  });

  it("復元不能な旧データは path 付きで拒否し、変換済みの v4 は不変で通る", () => {
    const bad = load("advent-name-key-ambiguous");
    const parsed = parseGameSnapshot(envelope(3, bad), ctx);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.migrationError?.path).toBe(
        "state.usedAlternateCostAdventKeysThisTurn[0]"
      );
    }
    const migrated = migrateOk(load("records-basic"));
    const v4 = parseGameSnapshot(envelope(4, migrated as unknown as Rec), ctx);
    expect(v4.ok).toBe(true);
    if (v4.ok) expect(amounts(v4.snapshot.state)).toEqual(amounts(migrated));
  });

  it("壊れた旧データ (null・型違いの入れ子) は生の例外ではなく、元データを保った明示エラーになる", () => {
    const brokenLimit = load("recorded-usage-stack") as {
      stackWindow?: { pendingStackAction?: { recordedUsage?: Rec } };
    };
    const recorded = brokenLimit.stackWindow?.pendingStackAction?.recordedUsage;
    expect(recorded).toBeDefined();
    recorded!.usageLimit = null;
    const brokenCards = load("records-basic") as { cardInstances: unknown };
    brokenCards.cardInstances = null;
    for (const broken of [brokenLimit, brokenCards]) {
      const before = JSON.stringify(broken);
      const result = migrateEffectAccounting(broken, ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("usage_accounting_migration_failed");
        expect(result.error.reason).toBe("invalid_legacy_shape");
      }
      // 入力は変更されない
      expect(JSON.stringify(broken)).toBe(before);
    }
  });

  it("失敗の path に辞書キー (プレイヤーID・個体ID・効果ID) を含めない", () => {
    const raw = load("dedicated-flags") as { activeContinuousEffects: Rec[] };
    raw.activeContinuousEffects = [];
    const result = migrateEffectAccounting(raw, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.path).not.toMatch(/alice|bob|dsl-ce/);
    }
  });
});

// ---------------------------------------------------------------
// 旧 pendingLifeDamageDiscardChoice (選択待ち) の能力識別と、step/battle 期間・旧 receipt の競合 (査読ラウンド4)
// ---------------------------------------------------------------
import { consumePendingLifeDamageTurnCapBuckets } from "../src/core/core-system";
import { ceQuantitySourceOf } from "../src/mechanics/quantity-usage";
import { declareGimmickGateAbilityRef } from "../src/mechanics/dedicated-usage";
import { makeAbilityRef } from "../src/effect-usage/normalize";

describe("V14(i) 旧 pendingLifeDamageDiscardChoice (選択待ち) の能力識別", () => {
  const ce21 = {
    sourceInstanceId: "noh-a",
    sourceDefinitionId: "BSTH08.5-C21",
    provenance: { effectIndex: 0, stepIndex: 0 },
  };
  const gimmickCe = {
    effectId: "dsl-ce-30",
    sourceInstanceId: "noh-a",
    sourceDefinitionId: "BSLH01-C12",
    provenance: { effectIndex: 1, stepIndex: 0 },
  };

  function withPending(pending: Rec, extraCes: Rec[] = []): Rec {
    const raw = load("quantities");
    (raw.activeContinuousEffects as Rec[]).push(...extraCes);
    raw.pendingLifeDamageDiscardChoice = {
      pendingId: "ldc-0-bob",
      decidingPlayerId: "bob",
      actingPlayerId: "alice",
      cause: "opponent_effect",
      pendingAmount: 1,
      entries: [],
      ...pending,
    };
    return raw;
  }

  it("filteredEffectIds は効果元の能力 (filteredSources) へ移り、辞退時の遅延消費は旧 state と同じ枠へ計上される", () => {
    const raw = withPending({
      turnCapConsumption: {
        playerWide: true,
        filteredEffectIds: ["dsl-ce-21"],
      },
    });
    const m = migrateOk(raw);
    const pending = m.pendingLifeDamageDiscardChoice!;
    expect(pending.turnCapConsumption).toEqual({
      playerWide: true,
      filteredSources: [ceQuantitySourceOf(ce21, "life_turn_cap", "bob")],
    });
    expect(JSON.stringify(pending)).not.toContain("filteredEffectIds");
    // 変換前の累積 (全体 3 / フィルタ付き 2) に、辞退で確定した 1 が加わる。落ちていれば 3 / 2 のまま。
    const declined = consumePendingLifeDamageTurnCapBuckets(m, pending, 1);
    expect(cappedLifeReduction(declined, "bob")).toBe(4);
    expect(filteredCappedLifeReduction(declined, "bob", ce21 as never)).toBe(3);
    // 2 回変換しても同じ。
    const twice = migrate(m);
    expect(twice.ok).toBe(true);
    if (twice.ok) expect(twice.state).toEqual(m);
  });

  it("filteredEffectIds の継続効果が消えていれば、推測せず場所を示して失敗し入力は変わらない", () => {
    const raw = withPending({
      turnCapConsumption: { filteredEffectIds: ["dsl-ce-99"] },
    });
    const before = JSON.stringify(raw);
    expect(migrateFail(raw)).toMatchObject({
      reason: "continuous_effect_missing",
      path: "state.pendingLifeDamageDiscardChoice.turnCapConsumption.filteredEffectIds[0]",
    });
    expect(JSON.stringify(raw)).toBe(before);
  });

  it("declare_gimmick の entry は、継続効果の登録位置 (無ければ保存済みの能力) から usageAbility を得る", () => {
    const stored = makeAbilityRef(
      "gimmick",
      "BSLH01-C12",
      "effects[3].steps[2].declareGimmickGate"
    );
    const entry = (ceEffectId: string): Rec => ({
      costKind: "declare_gimmick",
      ceEffectId,
      sourceInstanceId: "noh-a",
      sourceDefinitionId: "BSLH01-C12",
      reduceBy: 1,
    });
    const m = migrateOk(
      withPending({ entries: [entry("dsl-ce-30"), entry("dsl-ce-31")] }, [
        gimmickCe,
        {
          ...gimmickCe,
          effectId: "dsl-ce-31",
          metadata: { usageAbility: stored },
        },
      ])
    );
    const entries = m.pendingLifeDamageDiscardChoice!.entries as unknown as {
      usageAbility: unknown;
    }[];
    expect(entries[0]!.usageAbility).toEqual(
      declareGimmickGateAbilityRef(
        "BSLH01-C12",
        { effectIndex: 1, stepIndex: 0 },
        "bob"
      )
    );
    expect(entries[1]!.usageAbility).toEqual(stored);
  });

  it("declare_gimmick の entry の継続効果が消えていれば失敗し、新形式と併存する旧項目は競合になる", () => {
    const missing = withPending({
      entries: [
        {
          costKind: "declare_gimmick",
          ceEffectId: "dsl-ce-99",
          sourceInstanceId: "noh-a",
          sourceDefinitionId: "BSLH01-C12",
          reduceBy: 1,
        },
      ],
    });
    expect(migrateFail(missing)).toMatchObject({
      reason: "continuous_effect_missing",
      path: "state.pendingLifeDamageDiscardChoice.entries[0]",
    });
    // 新形式の会計がある state に旧 filteredEffectIds が残っていれば、等価性を証明できず競合になる。
    // (入れ子の旧項目が検査されるのは、トップレベルの旧キーで migration が走るとき。新形式だけの state は素通しする)
    const migrated = JSON.parse(
      JSON.stringify(
        migrateOk(
          withPending({
            turnCapConsumption: { filteredEffectIds: ["dsl-ce-21"] },
          })
        )
      )
    ) as Rec;
    (
      (migrated.pendingLifeDamageDiscardChoice as Rec).turnCapConsumption as Rec
    ).filteredEffectIds = ["dsl-ce-21"];
    migrated.effectUsageRecords = [];
    expect(migrateFail(migrated)).toMatchObject({
      reason: "legacy_new_conflict",
      path: "state.pendingLifeDamageDiscardChoice.turnCapConsumption.filteredEffectIds",
    });
  });

  it("入れ子の state (pendingZoneSelection.priorStateSnapshot) の旧 pending も、その state の継続効果から変換し、消えていれば入れ子の path で失敗する", () => {
    const build = (ceEffectIds: string[]): Rec => {
      const raw = load("nested-prior-snapshot");
      const nested = (raw.pendingZoneSelection as Rec)
        .priorStateSnapshot as Rec;
      nested.activeContinuousEffects = [
        {
          effectId: "dsl-ce-40",
          sourceInstanceId: "nexus-eiki",
          sourceDefinitionId: "BSTH04-XX01",
          provenance: { effectIndex: 0, stepIndex: 0 },
        },
      ];
      nested.pendingLifeDamageDiscardChoice = {
        pendingId: "ldc-0-bob",
        decidingPlayerId: "bob",
        actingPlayerId: "alice",
        cause: "opponent_effect",
        pendingAmount: 1,
        entries: [],
        turnCapConsumption: { filteredEffectIds: ceEffectIds },
      };
      return raw;
    };
    const m = migrateOk(build(["dsl-ce-40"]));
    const nestedPending = (
      (m.pendingZoneSelection as unknown as Rec).priorStateSnapshot as Rec
    ).pendingLifeDamageDiscardChoice as Rec;
    expect(nestedPending.turnCapConsumption).toEqual({
      filteredSources: [
        ceQuantitySourceOf(
          {
            sourceInstanceId: "nexus-eiki",
            sourceDefinitionId: "BSTH04-XX01",
            provenance: { effectIndex: 0, stepIndex: 0 },
          },
          "life_turn_cap",
          "bob"
        ),
      ],
    });
    const broken = build(["dsl-ce-99"]);
    const before = JSON.stringify(broken);
    expect(migrateFail(broken)).toMatchObject({
      reason: "continuous_effect_missing",
      path: "state.pendingZoneSelection.priorStateSnapshot.pendingLifeDamageDiscardChoice.turnCapConsumption.filteredEffectIds[0]",
    });
    expect(JSON.stringify(broken)).toBe(before);
  });
});

describe("V16 神技等の宣言数の観測は、旧 usedDivineSkillKeysThisTurn と同じく相手・観戦者にも見える", () => {
  it("相手・観戦者の投影にも宣言数の観測が残り、使用回数の枠 (measure=use) は本人にしか渡らない", () => {
    const m = migrateOk(load("divine-skill-keys"));
    const total = observedAmountThisTurn(m, "divine_skill");
    expect(total).toBe(5);
    for (const viewer of ["alice", "bob", null] as const) {
      expect(
        observedAmountThisTurn(
          sanitizeStateForViewer(m, viewer),
          "divine_skill"
        ),
        String(viewer)
      ).toBe(total);
    }
    // 使用回数の枠 (use) は、その枠の持ち主以外には渡さない。
    const usePlayers = new Set(
      m.effectAccounting.buckets
        .filter(
          (b) => b.measure === "use" && b.constraintId.includes("divine_skill")
        )
        .map((b) => b.playerId)
    );
    expect(usePlayers.size).toBeGreaterThan(0);
    for (const owner of usePlayers) {
      const others = (["alice", "bob"] as const).filter((id) => id !== owner);
      for (const viewer of [...others, null] as const) {
        const view = sanitizeStateForViewer(m, viewer);
        expect(
          view.effectAccounting.buckets.filter(
            (b) =>
              b.measure === "use" &&
              b.playerId === owner &&
              b.constraintId.includes("divine_skill")
          ),
          `${owner} -> ${String(viewer)}`
        ).toEqual([]);
      }
    }
  });
});

describe("V14(j) 旧 step / battle 期間の記録と、旧 receipt の競合", () => {
  function firstEffectWithDuration(
    cardNo: string,
    duration: string
  ): { effectIndex: number; stepIndex: number | null } {
    const def = getCatalogDefinition(cardNo)!;
    for (const [effectIndex, effect] of (def.effects ?? []).entries()) {
      const limit = effect.usageLimit as { duration?: string } | undefined;
      if (limit && !Array.isArray(limit) && limit.duration === duration) {
        return { effectIndex, stepIndex: null };
      }
      for (const [stepIndex, step] of (effect.steps ?? []).entries()) {
        const stepLimit = (step as { usageLimit?: { duration?: string } })
          .usageLimit;
        if (
          stepLimit &&
          !Array.isArray(stepLimit) &&
          stepLimit.duration === duration
        ) {
          return { effectIndex, stepIndex };
        }
      }
    }
    throw new Error(`no ${duration} limit on ${cardNo}`);
  }

  function labelOf(
    cardNo: string,
    at: { effectIndex: number; stepIndex: number | null }
  ): string {
    return at.stepIndex === null
      ? `effect:${at.effectIndex}`
      : `__step:${cardNo}:${at.effectIndex}:${at.stepIndex}`;
  }

  it("step 期間: 現在のステップの記録だけが枠になり、別ステップの記録は期限切れとして捨てる", () => {
    const cardNo = "BSTH02.7-C03";
    const effectLabel = labelOf(
      cardNo,
      firstEffectWithDuration(cardNo, "step")
    );
    const record = (step: string) =>
      oldRecord({
        sourceInstanceId: "step-a",
        sourceDefinitionId: cardNo,
        effectLabel,
        playerId: "alice",
        duration: "step",
        step,
      });
    const m = migrateOk(
      legacyState([{ id: "step-a", cardNo }], {
        effectUsageRecords: [record("main"), record("attack")],
      })
    );
    const used = listEffectUsage(m);
    expect(used).toHaveLength(1);
    expect(used[0]).toMatchObject({
      period: "step",
      periodId: "step:3.0",
      playerId: "alice",
      amount: 1,
    });
  });

  it("battle 期間: 現在のバトルの記録だけが枠になり、別バトルの記録は期限切れとして捨てる", () => {
    const cardNo = "BSTH06-X03";
    const effectLabel = labelOf(
      cardNo,
      firstEffectWithDuration(cardNo, "battle")
    );
    const record = (attackId: string) =>
      oldRecord({
        sourceInstanceId: "yugi-a",
        sourceDefinitionId: cardNo,
        effectLabel,
        playerId: "alice",
        duration: "battle",
        attackId,
      });
    const raw = load("grants");
    raw.effectUsageRecords = [record("attack-1"), record("attack-0")];
    const m = migrateOk(raw);
    const used = listEffectUsage(m).filter((u) => u.period === "battle");
    expect(used).toHaveLength(1);
    expect(used[0]).toMatchObject({
      playerId: "alice",
      periodId: "battle:attack-1",
      amount: 1,
    });
  });

  it.each([
    [
      "recordedUsage",
      (s: Rec) => {
        ((s.stackWindow as Rec).pendingStackAction as Rec).recordedUsage = {
          effectLabel: "effect:0",
          usageLimit: { kind: "per_instance", duration: "turn" },
        };
      },
      "state.stackWindow.pendingStackAction.recordedUsage",
    ],
    [
      "refundableUsageEntries",
      (s: Rec) => {
        s.pendingTurnEndFinalizations = [
          {
            refundableUsageEntries: [
              {
                effectLabel: "effect:0",
                usageLimit: { kind: "per_instance", duration: "turn" },
              },
            ],
          },
        ];
      },
      "state.pendingTurnEndFinalizations[0].refundableUsageEntries",
    ],
    [
      "declarationUsageDeltas",
      (s: Rec) => {
        (
          (s.stackWindow as Rec).pendingStackAction as Rec
        ).normalHandPlayRollback = {
          declarationUsageDeltas: [],
        };
      },
      "state.stackWindow.pendingStackAction.normalHandPlayRollback",
    ],
  ])(
    "旧 receipt (%s) が新会計と併存する入力は、等価性を証明できず競合エラーで入力は変わらない",
    (_name, inject, path) => {
      const hybrid = JSON.parse(
        JSON.stringify(migrateOk(load("recorded-usage-stack")))
      ) as Rec;
      inject(hybrid);
      // 入れ子の旧 receipt が検査されるのは、トップレベルの旧キーで migration が走るとき。
      hybrid.effectUsageRecords = [];
      const before = JSON.stringify(hybrid);
      expect(migrateFail(hybrid)).toMatchObject({
        reason: "legacy_new_conflict",
        path,
      });
      expect(JSON.stringify(hybrid)).toBe(before);
    }
  );
});
