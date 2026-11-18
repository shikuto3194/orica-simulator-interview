/**
 * P3-61 GUI: pendingStackAction.fieldEffectRegistrationIndex から
 * 対応する effects[].textRef を引いて効果テキストを表示する。
 *
 * バグ: 同一カードに複数の `activated/flash` 効果がある場合
 * (例: BSTH01-X04 フランドール 第1効果『お互いのアタックステップ』 + 第2効果【フォーオブアカインド】)、
 * extractEffectText("flash") は常に先頭の "フラッシュ" ブロックを返してしまい、
 * スタックに乗ったのが第2効果でも第1効果のテキストが表示されていた。
 *
 * このテストは EffectQueueOverlay のテキスト抽出ロジックが
 * registrationIndex 経由で正しい textRef を引くことを保証する。
 */
import { describe, expect, it } from "vitest";
import { buildEffectQueue } from "../src/components/EffectQueueOverlay";
import { ALL_CARDS } from "../../../packages/card-data/src/generated-index";
import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
} from "../../../packages/rules-core/src";
import type {
  ActiveStack,
  CardDefinition,
  GameState,
} from "../../../packages/rules-core/src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const フランドール = cardNoMap.get("BSTH01-X04")!;
const 神薙ユウ = cardNoMap.get("BSGE01-CX01")!;
const ヨハネス = cardNoMap.get("BSGE01-M01")!;

function makeStateWithFlandreFlashOnStack(
  registrationIndex: number | undefined
): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const host = createCardInstance(フランドール, {
    instanceId: "host",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 3,
  });
  const activeStack: ActiveStack = {
    stackId: "stack:effect:test",
    actionKind: "field_card_effect",
    chainId: "effect:test",
    actingPlayerId: "alice",
    cardInstanceId: "host",
    cardDefinitionId: フランドール.cardNo,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    fieldEffectSourceKind: "spirit",
    chosenTiming: "flash",
    ...(registrationIndex !== undefined
      ? { fieldEffectRegistrationIndex: registrationIndex }
      : {}),
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
  return {
    ...base,
    turnNumber: 3,
    activePlayerId: "alice",
    step: "main",
    window: "stack",
    cardInstances: [host],
    stackWindow: {
      actingPlayerId: "alice",
      previousWindow: "none",
      subStackEverOpened: false,
      burstWindowKind: null,
      priorityPlayerId: "bob",
      consecutivePassCount: 0,
      stackResponseSourcePlayerId: "alice",
      pendingStackAction: activeStack,
    },
  };
}

describe("P3-61 GUI: effect text extraction via fieldEffectRegistrationIndex", () => {
  const triggeredLookup = buildTriggeredEffectLookup(ALL_CARDS);

  it("regIdx=0 を保持していれば第1効果『お互いのアタックステップ』のテキストを返す", () => {
    const state = makeStateWithFlandreFlashOnStack(0);
    const queue = buildEffectQueue(
      state,
      (id) => cardNoMap.get(id),
      triggeredLookup,
      "bob"
    );
    expect(queue.length).toBeGreaterThan(0);
    const text = queue[0]!.effectText;
    expect(text).toContain("お互いのアタックステップ");
    expect(text).toContain("BP10000以下");
    expect(text).not.toContain("フォーオブアカインド");
  });

  it("regIdx=1 を保持していれば第2効果【フォーオブアカインド】のテキストを返す", () => {
    const state = makeStateWithFlandreFlashOnStack(1);
    const queue = buildEffectQueue(
      state,
      (id) => cardNoMap.get(id),
      triggeredLookup,
      "bob"
    );
    expect(queue.length).toBeGreaterThan(0);
    const text = queue[0]!.effectText;
    expect(text).toContain("フォーオブアカインド");
    expect(text).not.toContain("BP10000以下");
  });

  it("regIdx 未指定 (旧 state) はフォールバックで先頭フラッシュブロックを返す (後方互換)", () => {
    const state = makeStateWithFlandreFlashOnStack(undefined);
    const queue = buildEffectQueue(
      state,
      (id) => cardNoMap.get(id),
      triggeredLookup,
      "bob"
    );
    expect(queue.length).toBeGreaterThan(0);
    // フォールバックは "フラッシュ" キーワード先頭一致 (= 第1効果)
    const text = queue[0]!.effectText;
    expect(text).toContain("フラッシュ");
  });

  it("fieldEffectIndex を優先し、BSGE01-M01 under-card【神楽：スラスター】をトラッシュ起動効果に誤表示しない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const host = createCardInstance(神薙ユウ, {
      instanceId: "host-ge",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 1,
    });
    host.underCards = [
      {
        cardInstanceId: "under-johannes",
        role: "text_role",
        roleTag: "バレットエディット",
      },
    ];
    const under = createCardInstance(ヨハネス, {
      instanceId: "under-johannes",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    under.attachedToInstanceId = host.instanceId;
    const activeStack: ActiveStack = {
      stackId: "stack:kagura:test",
      actionKind: "field_card_effect",
      chainId: "kagura:test",
      actingPlayerId: "alice",
      cardInstanceId: host.instanceId,
      cardDefinitionId: 神薙ユウ.cardNo,
      effectSourceInstanceId: under.instanceId,
      effectSourceDefinitionId: ヨハネス.cardNo,
      fieldEffectSourceKind: "spirit",
      chosenTiming: "flash",
      fieldEffectRegistrationIndex: 0,
      fieldEffectIndex: 2,
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };
    const state: GameState = {
      ...base,
      turnNumber: 3,
      activePlayerId: "alice",
      step: "attack",
      window: "stack",
      cardInstances: [host, under],
      stackWindow: {
        actingPlayerId: "alice",
        previousWindow: "flash_before_block",
        subStackEverOpened: false,
        burstWindowKind: null,
        priorityPlayerId: "bob",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "alice",
        pendingStackAction: activeStack,
      },
    };

    const queue = buildEffectQueue(
      state,
      (id) => cardNoMap.get(id),
      triggeredLookup,
      "bob"
    );

    expect(queue.length).toBeGreaterThan(0);
    const text = queue[0]!.effectText;
    expect(text).toContain("【神楽：スラスタ");
    expect(text).toContain("相手の創界神ネクサス1つを破壊する");
    expect(text).not.toContain("トラッシュにあるこのカード");
  });
});

/**
 * accel スタック表示: 「メイン【アクセル：…】」のようにタイミング語 (メイン) で
 * 始まり 【 が行頭に来ない accel ブロックを splitTextBlocks がヘッダー認識できず、
 * extractEffectText("accel") が該当ブロックを見つけられずカード全文へフォールバック
 * していた退行 (snapshot 2026-06-19 小悪魔 BSTH01-R05) を防ぐ。
 * フラッシュ版は元から接頭許可されていたため、メイン版のみが対象だった。
 */
const 小悪魔 = cardNoMap.get("BSTH01-R05")!;

function makeStateWithAccelOnStack(): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const activeStack: ActiveStack = {
    stackId: "stack:accel:test",
    actionKind: "accel",
    chainId: "accel:test",
    actingPlayerId: "alice",
    cardInstanceId: "card-4",
    cardDefinitionId: 小悪魔.cardNo,
    targetInstanceIds: [],
    targetEffectFilterTags: ["general"],
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };
  return {
    ...base,
    turnNumber: 1,
    activePlayerId: "alice",
    step: "main",
    window: "stack",
    cardInstances: [],
    stackWindow: {
      actingPlayerId: "alice",
      previousWindow: "none",
      subStackEverOpened: false,
      burstWindowKind: null,
      priorityPlayerId: "bob",
      consecutivePassCount: 0,
      stackResponseSourcePlayerId: "alice",
      pendingStackAction: activeStack,
    },
  };
}

describe("accel スタック表示: メイン接頭の accel ブロックをピンポイント抽出する", () => {
  const triggeredLookup = buildTriggeredEffectLookup(ALL_CARDS);

  it("BSTH01-R05 のスタックはアクセルブロックのみを表示しカード全文化しない", () => {
    const state = makeStateWithAccelOnStack();
    const queue = buildEffectQueue(
      state,
      (id) => cardNoMap.get(id),
      triggeredLookup,
      "alice"
    );
    expect(queue.length).toBeGreaterThan(0);
    const text = queue[0]!.effectText;
    // アクセルブロック (ヘッダー + 効果本体) を含む
    expect(text).toContain("メイン【アクセル");
    expect(text).toContain("自分のデッキを上から3枚トラッシュに置く");
    // 召喚時ブロックや常時効果は含まない (= 全文フォールバックしていない)
    expect(text).not.toContain("このスピリットの召喚時");
    expect(text).not.toContain("紫としても扱う");
  });
});
