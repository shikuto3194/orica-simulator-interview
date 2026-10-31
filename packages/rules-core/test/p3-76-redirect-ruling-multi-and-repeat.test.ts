/**
 * P3-76 / P3-47 F-4 裁定確認: 効果対象リダイレクトの (1) 同一分身への反復差し替え と
 * (2) 多重対象 (本体 + 全分身が同時対象) での redirect 不可・取りこぼし無し。
 *
 * 裁定正源 (issues/archive/P3-47/F-4-effect-redirect.md):
 * - #5 redirect は同一 target slice 内の field S/U/B/N を replacement 1体へ変更する
 * - #6 「変更」= 元対象を集合から除外し新対象だけへ collapse
 * - #7 候補集合と resolved 集合の共通要素を除外。「本体 + token 両方が既に対象」なら redirect 不可
 *
 * Q1 (反復): 「疲労/重疲労させる」「アタック/ブロックできない」「シンボル0化」等の
 *   フィールドを離れない効果は分身を場に残すため、同じ分身へ何度でも差し替えられる
 *   (分身が候補から外れない)。重疲労状態でも候補資格は失わない。
 * Q2 (多重対象): 残存する分身すべてと本体を同時に対象に取った場合、差し替え先候補が
 *   尽きるため redirect 不可。一部だけが同時対象なら自由な分身 1 体へ対象集合を collapse する。
 */
import { describe, expect, it } from "vitest";
import {
  applyRedirectToResolvedTargets,
  createCardInstance,
  createEmptyGameState,
  findApplicableTargetRedirects,
} from "../src";
import type {
  CardDefinition,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
} from "../src";

const ALICE = "alice";
const BOB = "bob";
const HOST = "flandre-host";
const TOKEN_A = "token-a";
const TOKEN_B = "token-b";
const TOKEN_C = "token-c";

const spiritDef: CardDefinition = {
  cardNo: "P3-76-RULING-SPIRIT",
  name: "P3-76 裁定確認スピリット",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

// 本体を保護し token 群へ差し替える redirect_effect_target CE (explicit 候補)。
function redirectCE(): ContinuousEffect {
  return {
    effectId: "ce-redirect",
    sourceInstanceId: HOST,
    sourceDefinitionId: spiritDef.cardNo,
    actingPlayerId: ALICE,
    duration: { scope: "permanent" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "redirect_effect_target" as ContinuousEffectTag,
    metadata: {
      triggerCondition: {
        sourcePlayerRef: "opponent",
        protectedTargetKind: "instances",
        protectedInstanceIds: [HOST],
      },
      redirectCandidateSource: {
        kind: "explicit",
        instanceIds: [TOKEN_A, TOKEN_B, TOKEN_C],
      },
      optional: true,
    } as unknown as Record<string, unknown>,
  };
}

/** 本体 + 分身3体を alice 場に置く。token の exhaustState を個別指定可。 */
function buildState(
  exhaust: Partial<
    Record<string, GameState["cardInstances"][number]["exhaustState"]>
  > = {}
): GameState {
  const mk = (id: string) =>
    createCardInstance(spiritDef, {
      instanceId: id,
      ownerPlayerId: ALICE,
      zone: "field",
      cores: 1,
      exhaustState: exhaust[id] ?? "recovered",
    });
  const base = createEmptyGameState({
    playerIds: [ALICE, BOB],
    cardInstances: [mk(HOST), mk(TOKEN_A), mk(TOKEN_B), mk(TOKEN_C)],
  });
  return { ...base, activeContinuousEffects: [redirectCE()] };
}

describe("P3-76 裁定: 同一分身への反復差し替え (フィールドを離れない効果)", () => {
  it("本体への単体対象は毎回 redirect 可能で、差し替え済み分身も場に残る限り候補に残り続ける", () => {
    // 1 回目: 相手効果が本体のみを対象。候補に分身3体すべてが出る。
    const s1 = buildState();
    const m1 = findApplicableTargetRedirects(s1, [HOST], BOB);
    expect(m1).toHaveLength(1);
    expect([...m1[0]!.candidateTokenInstanceIds].sort()).toEqual([
      TOKEN_A,
      TOKEN_B,
      TOKEN_C,
    ]);
    // TOKEN_A へ差し替え。
    expect(applyRedirectToResolvedTargets([HOST], HOST, TOKEN_A)).toEqual([
      TOKEN_A,
    ]);
  });

  it("重疲労になった分身でも、本体が再び対象になれば同じ分身へ再度差し替えられる", () => {
    // TOKEN_A は前の効果で重疲労 (フィールドは離れていない)。
    const s2 = buildState({ [TOKEN_A]: "heavily_exhausted" });
    const m2 = findApplicableTargetRedirects(s2, [HOST], BOB);
    expect(m2).toHaveLength(1);
    // 重疲労でも候補資格を失わない → TOKEN_A は引き続き候補。
    expect(m2[0]!.candidateTokenInstanceIds).toContain(TOKEN_A);
    expect(applyRedirectToResolvedTargets([HOST], HOST, TOKEN_A)).toEqual([
      TOKEN_A,
    ]);
  });
});

describe("P3-76 裁定 #7: 多重対象 (本体 + 全分身) では redirect 不可・取りこぼし無し", () => {
  it("本体 + 残存分身すべてが同時対象 → 差し替え先候補が尽き redirect 不可 (match 0)", () => {
    const s = buildState();
    const matches = findApplicableTargetRedirects(
      s,
      [HOST, TOKEN_A, TOKEN_B, TOKEN_C],
      BOB
    );
    // 候補 (A/B/C) がすべて resolved に含まれる → 除外され候補 0 → match 無し。
    expect(matches).toHaveLength(0);
  });

  it("本体 + 一部分身が対象 → 残りの自由な分身1体へ target slice を collapse する", () => {
    const s = buildState();
    // 本体 + TOKEN_A が対象 (TOKEN_B/C は自由)。
    const matches = findApplicableTargetRedirects(s, [HOST, TOKEN_A], BOB);
    expect(matches).toHaveLength(1);
    // 候補は B/C のみ (A は既に対象なので #7 で除外)。
    expect([...matches[0]!.candidateTokenInstanceIds].sort()).toEqual([
      TOKEN_B,
      TOKEN_C,
    ]);
    expect(matches[0]!.protectedInstanceId).toBe(HOST);
    // 本体と同時指定された field target を TOKEN_B 1体へ collapse する。
    const after = applyRedirectToResolvedTargets(
      [HOST, TOKEN_A],
      [HOST, TOKEN_A],
      TOKEN_B
    );
    expect(after).toEqual([TOKEN_B]);
    expect(after).toHaveLength(1);
    expect(after).not.toContain(TOKEN_A);
    expect(after).not.toContain(HOST);
  });
});
