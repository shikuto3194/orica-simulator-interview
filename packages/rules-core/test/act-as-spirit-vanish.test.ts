/**
 * P3-47 F-2: act_as_spirit (分身) トークンのコア不足消滅 (SBA) を検証する。
 *
 * フランドール・スカーレット (BSTH01-X04)【フォーオブアカインド】の分身は、裏向きカードに
 * 「Lvコスト1 … スピリットとして扱う」act_as_spirit CE を載せたもの。物理的には裏向き
 * カード (印字 minimumRequiredCores=0 のマジック等) だが、疑似スピリットとして維持に
 * 必要な最小コア (Lvコスト1=1) を下回ると消滅しなければならない。
 *
 * 旧実装は collectStateBasedActions が裏向きカードを一律スキップし、かつ印字
 * minimumRequiredCores=0 を読んでいたため、コア0の分身が消滅しなかった。
 */
import { describe, it, expect } from "vitest";
import {
  collectStateBasedActions,
  runStateBasedActions,
  flushPendingLeaves,
} from "../src/state-based-actions";
import { runActionMainResolution } from "../src/effect/effect-resolution";
import { resolveActAsSpiritMinimumRequiredCores } from "../src/mechanics/act-as-spirit";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import type { ActAsSpiritMetadata } from "../src/mechanics/act-as-spirit";
import type {
  CardDefinition,
  ContinuousEffect,
  ContinuousEffectTag,
  GameState,
} from "../src/model";

const BOB = "player-1";

/** 印字 levelDefs 空 = minimumRequiredCores 0 のマジックカード (分身の素体)。 */
function magicDef(): CardDefinition {
  return {
    cardNo: "TEST-MAGIC",
    name: "Test Magic",
    printedCategory: "magic",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 2,
    cost: 2,
    reductionSymbols: [],
    levelDefs: [],
    textLines: [],
    images: {},
    tribe: "",
    colors: ["red"],
  } as CardDefinition;
}

function actAsSpiritCE(
  targetInstanceId: string,
  metadata: ActAsSpiritMetadata
): ContinuousEffect {
  return {
    effectId: `ce-act-as-spirit-${targetInstanceId}`,
    sourceInstanceId: "host-1",
    sourceDefinitionId: "BSTH01-X04",
    actingPlayerId: BOB,
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "act_as_spirit" as ContinuousEffectTag,
    targetInstanceId,
    metadata: metadata as unknown as Record<string, unknown>,
  };
}

/** X04 分身相当: live_copy ベース + overrides.levelDefs で Lvコスト1 を上書き。 */
const TOKEN_META: ActAsSpiritMetadata = {
  statBlueprint: {
    kind: "live_copy_from",
    sourceInstanceId: "host-1",
    aspects: ["cost", "symbolColors", "tribes", "levelDefs", "currentLv"],
  },
  overrides: {
    cardName: "フランドール・スカーレット",
    levelDefs: [{ level: 1, requiredCores: 1, bp: 0 }],
    keywords: ["cannot_combine"],
  },
};

function makeFaceDownTokenState(
  cores: number,
  ces: ContinuousEffect[]
): GameState {
  const token = createCardInstance(magicDef(), {
    instanceId: "card-token",
    ownerPlayerId: BOB,
    zone: "field",
    faceDown: true,
    cores,
  });
  // 分身の素体はマジック → 印字 minimumRequiredCores は 0。
  expect(token.minimumRequiredCores).toBe(0);
  const state = createEmptyGameState({ playerIds: ["player-1", "player-2"] });
  return {
    ...state,
    cardInstances: [token],
    activeContinuousEffects: ces,
  };
}

describe("P3-47 F-2: act_as_spirit 分身のコア不足消滅", () => {
  it("実効最低コアは overrides.levelDefs (Lvコスト1) から導出される", () => {
    const state = makeFaceDownTokenState(0, [
      actAsSpiritCE("card-token", TOKEN_META),
    ]);
    const token = state.cardInstances[0];
    expect(resolveActAsSpiritMinimumRequiredCores(state, token, magicDef)).toBe(
      1
    );
  });

  it("コア0の分身は消滅 (vanish_due_to_core_deficit) する", () => {
    const state = makeFaceDownTokenState(0, [
      actAsSpiritCE("card-token", TOKEN_META),
    ]);
    const checks = collectStateBasedActions(state, magicDef);
    expect(
      checks.some(
        (c) =>
          c.kind === "vanish_due_to_core_deficit" &&
          c.instanceId === "card-token"
      )
    ).toBe(true);
  });

  it("コア1の分身は Lvコスト1 を満たすので消滅しない", () => {
    const state = makeFaceDownTokenState(1, [
      actAsSpiritCE("card-token", TOKEN_META),
    ]);
    const checks = collectStateBasedActions(state, magicDef);
    expect(checks.some((c) => c.instanceId === "card-token")).toBe(false);
  });

  it("付与前 (act_as_spirit なし) のコア0裏向きリンボは消滅対象外", () => {
    // F-1 リンボ保護: 素性なしの裏向きカードは従来どおりスキップされる。
    const state = makeFaceDownTokenState(0, []);
    const checks = collectStateBasedActions(state, magicDef);
    expect(checks.some((c) => c.instanceId === "card-token")).toBe(false);
  });

  it("コア0の分身は SBA → flush で実際にフィールドを離れトラッシュへ移動する", () => {
    const state = makeFaceDownTokenState(0, [
      actAsSpiritCE("card-token", TOKEN_META),
    ]);
    const pending = runStateBasedActions(state, magicDef).state;
    expect(pending.cardInstances[0].pendingLeaveKind).toBe("vanish");

    const flushed = flushPendingLeaves(pending, magicDef);
    const token = flushed.cardInstances[0];
    expect(token.zone).toBe("trash");
    expect(token.pendingLeaveKind).toBeNull();
    // フィールドを離れた裏向きカードは表向きに戻る (通常カード化)。
    expect(token.faceDown).toBe(false);
  });

  // 旧バグ: effect-resolution / trigger-system の SBA 呼び出しが getCardDefinitionById を
  // 渡しておらず (undefined)、分身トークンが faceDown スキップに落ちて消滅しなかった
  // (フランドール【フォーオブアカインド】のコア配分後に 0 コア分身が残存)。
  // 既存テストは collect/run を直接 def 付きで叩いていたため call-site の漏れを検出できなかった。
  it("効果解決パス (runActionMainResolution) でも 0 コア分身が消滅する (call-site 回帰)", () => {
    const state = makeFaceDownTokenState(0, [
      actAsSpiritCE("card-token", TOKEN_META),
    ]);
    // resolveEffect は no-op。解決後の SBA だけを通す。context は SBA/recompute が読む
    // actingPlayerId + getCardDefinitionById のみ最小構成。
    const context = {
      actingPlayerId: BOB,
      getCardDefinitionById: magicDef,
      // production 経路 (P3-39 で必須化) を通すため trigger lookup を渡す。
      // 渡さないと raw fallback で responder 不在イベントも pending 化され、
      // チェーン束縛された消滅待機の flush が遅延する (P3-84)。
      getRegisteredTriggeredEffectActions: () => [],
    } as unknown as Parameters<typeof runActionMainResolution>[0]["context"];
    const resolved = runActionMainResolution({
      state,
      chainId: "test-chain",
      startLogs: [],
      endLogs: [],
      context,
      resolveEffect: (s) => s,
    });
    // 解決の最後に pending leave が flush されるため、消滅完了 = トラッシュ移動で観測する。
    // 旧バグでは getCardDefinitionById 欠落で SBA が分身を拾えず field に残留していた。
    const token = resolved.cardInstances.find(
      (c) => c.instanceId === "card-token"
    )!;
    expect(token.zone).toBe("trash");
    expect(token.faceDown).toBe(false);
  });
});
