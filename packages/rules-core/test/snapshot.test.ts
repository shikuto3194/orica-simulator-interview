/**
 * GameSnapshot のテスト。
 *
 * - parseGameSnapshot: 不正な形を弾く
 * - createGameSnapshot: 期待通りの形になる
 * - restoreSnapshot: round-trip / カード drift / 未知 cardNo / 進行中 state でも復元できる
 */
import { describe, expect, it } from "vitest";
import {
  GAME_SNAPSHOT_SCHEMA_VERSION,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  createGameSnapshot,
  parseGameSnapshot,
  restoreSnapshot,
} from "../src";
import type {
  ActiveAttack,
  CardDefinition,
  ContinuousEffect,
  GameState,
} from "../src";

function patchouliLikeDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["purple"],
    cost: 7,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 6000 }],
    symbolColors: ["purple"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    tribe: "紅魔",
    effects: [
      {
        timing: { kind: "continuous" },
        steps: [
          {
            action: {
              kind: "cost_modify",
              player: "self",
              cardFilter: { category: ["magic"], tribes: ["紅魔"] },
              modifier: "free",
              duration: { scope: "permanent" },
            },
          },
        ],
      },
    ],
  };
}

function zeroCostBraveDef(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "brave",
    colors: ["red"],
    cost: 4,
    reductionSymbols: ["red"],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 4000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    tribe: "機竜",
    effects: [],
  };
}

function makeState(): GameState {
  return createEmptyGameState({ playerIds: ["alice", "bob"] });
}

function makeLookup(defs: CardDefinition[]) {
  const map = new Map(defs.map((d) => [d.cardNo, d]));
  return (id: string) => map.get(id);
}

describe("createGameSnapshot", () => {
  it("schemaVersion / savedAt / state を含む snapshot を作る", () => {
    const state = makeState();
    const snap = createGameSnapshot(state, {
      label: "test-1",
      nowIso: "2026-04-29T00:00:00.000Z",
      origin: { sourceKind: "manual" },
    });
    expect(snap.schemaVersion).toBe(GAME_SNAPSHOT_SCHEMA_VERSION);
    expect(snap.savedAt).toBe("2026-04-29T00:00:00.000Z");
    expect(snap.label).toBe("test-1");
    expect(snap.origin?.sourceKind).toBe("manual");
    expect(snap.state).toBe(state);
  });
});

describe("parseGameSnapshot", () => {
  it("正常系: createGameSnapshot の結果を JSON round-trip しても通る", () => {
    const state = makeState();
    const snap = createGameSnapshot(state, {
      nowIso: "2026-04-29T00:00:00.000Z",
    });
    const json = JSON.parse(JSON.stringify(snap));
    const result = parseGameSnapshot(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.schemaVersion).toBe(GAME_SNAPSHOT_SCHEMA_VERSION);
      expect(result.snapshot.state.turnNumber).toBe(state.turnNumber);
    }
  });

  it("schemaVersion 不一致は ok=false で拒否", () => {
    const result = parseGameSnapshot({
      schemaVersion: 99,
      savedAt: "2026-04-29",
      state: { turnNumber: 1, activePlayerId: "alice" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("schemaVersion");
  });

  it("非オブジェクト入力は拒否", () => {
    expect(parseGameSnapshot(null).ok).toBe(false);
    expect(parseGameSnapshot("string").ok).toBe(false);
    expect(parseGameSnapshot(42).ok).toBe(false);
  });

  it("savedAt 不在は拒否", () => {
    const result = parseGameSnapshot({
      schemaVersion: GAME_SNAPSHOT_SCHEMA_VERSION,
      state: {
        turnNumber: 1,
        activePlayerId: "alice",
        cardInstances: [],
        players: [],
        activeContinuousEffects: [],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("savedAt");
  });

  it("state.turnNumber が数値でない場合は拒否", () => {
    const result = parseGameSnapshot({
      schemaVersion: GAME_SNAPSHOT_SCHEMA_VERSION,
      savedAt: "2026-04-29",
      state: {
        turnNumber: "one",
        activePlayerId: "alice",
        cardInstances: [],
        players: [],
        activeContinuousEffects: [],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("turnNumber");
  });

  it("後方互換: 新フィールド追加前の旧 state は欠落キーが既定値で補完される", () => {
    // pendingEffectTargetSelection 等を schemaVersion を上げずに追加したため、
    // それ以前に保存された state には当該キーが存在しない。補完しないと新コードの
    // 厳密 `!== null` 判定が `undefined` を pending とみなして進行不能になる。
    const snap = createGameSnapshot(makeState());
    const json = JSON.parse(JSON.stringify(snap)) as {
      state: Record<string, unknown>;
    };
    // 旧スナップショットを模す: 後から追加されたフィールドをキーごと削除。
    delete json.state.pendingEffectTargetSelection;
    delete json.state.pendingTargetRedirects;
    expect("pendingEffectTargetSelection" in json.state).toBe(false);

    const result = parseGameSnapshot(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // undefined ではなく null / [] に正規化されている。
    expect(result.snapshot.state.pendingEffectTargetSelection).toBeNull();
    expect(result.snapshot.state.pendingTargetRedirects).toEqual([]);
  });
});

describe("restoreSnapshot", () => {
  it("round-trip: createGameSnapshot → JSON.stringify → parse → restore で同等", () => {
    const def = patchouliLikeDef("TEST-PATCHOULI");
    const stateRaw: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
    };
    // 通常召喚パイプラインを経由していないため CE は未登録。
    // Save 前にリビルダで CE を登録した「健全な save」を作る。
    const beforeSave = restoreSnapshot(
      createGameSnapshot(stateRaw),
      makeLookup([def])
    ).state;
    expect(beforeSave.activeContinuousEffects.length).toBeGreaterThan(0);

    const snap = createGameSnapshot(beforeSave);
    const json = JSON.parse(JSON.stringify(snap));
    const parsed = parseGameSnapshot(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const { state: restored, warnings } = restoreSnapshot(
      parsed.snapshot,
      makeLookup([def])
    );
    expect(warnings).toEqual([]);
    expect(restored.activeContinuousEffects.length).toBe(
      beforeSave.activeContinuousEffects.length
    );
    expect(restored.activeContinuousEffects[0]!.modifierTag).toBe(
      "cost_override"
    );
  });

  it("カード定義 drift: stale minimumRequiredCores を現行定義から復元する", () => {
    const def = zeroCostBraveDef("TEST-ZERO-BRAVE");
    const staleBrave = createCardInstance(def, {
      instanceId: "brave-1",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
      minimumRequiredCores: 1,
      attachedToInstanceId: "host-1",
    });
    const savedState: GameState = {
      ...makeState(),
      cardInstances: [staleBrave],
      pendingCoreDistribution: {
        pendingId: "sba-brave-separate-core:brave-1",
        actingPlayerId: "alice",
        sourceInstanceId: "brave-1",
        sourceDefinitionId: def.cardNo,
        candidates: [{ instanceId: "brave-1", definitionId: def.cardNo }],
        totalNormalCores: 1,
        hasSoulCore: false,
        fromKind: "any_movable",
        minTotal: 1,
        fromPlayerId: "alice",
        toPlayerId: "alice",
        effectTiming: { kind: "continuous" },
        stateBasedBraveSeparation: {
          hostInstanceId: "host-1",
          braveInstanceId: "brave-1",
        },
      },
    };

    const { state: restored, warnings } = restoreSnapshot(
      createGameSnapshot(savedState),
      makeLookup([def])
    );

    expect(restored.cardInstances[0]!.minimumRequiredCores).toBe(0);
    expect(restored.pendingCoreDistribution?.minTotal).toBe(0);
    expect(warnings).toContain(
      "synced minimumRequiredCores for 1 card instance(s) from current definitions: brave-1"
    );
  });

  it("カード定義 drift: save 後に新しい continuous 効果が増えたら restore で補完される", () => {
    const oldDef: CardDefinition = {
      ...patchouliLikeDef("TEST-DRIFT"),
      effects: [], // save 時点では効果無し
    };
    const newDef = patchouliLikeDef("TEST-DRIFT"); // restore 時点では continuous 効果あり

    const savedState: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(oldDef, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
    };
    expect(savedState.activeContinuousEffects).toHaveLength(0);

    const snap = createGameSnapshot(savedState);
    const { state: restored, warnings } = restoreSnapshot(
      snap,
      makeLookup([newDef])
    );

    // リビルダが新 effects[0] を CE として補完
    expect(restored.activeContinuousEffects.length).toBe(1);
    expect(warnings.some((w) => w.includes("rebuilder added"))).toBe(true);
  });

  it("pending leave 中の field カードは restore の drift 補完で新規 CE 登録しない", () => {
    const oldDef: CardDefinition = {
      ...patchouliLikeDef("TEST-PENDING-DRIFT"),
      effects: [],
    };
    const newDef = patchouliLikeDef("TEST-PENDING-DRIFT");
    const savedState: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(oldDef, {
          instanceId: "pending-src",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
          pendingLeaveKind: "destroy",
        }),
      ],
      pendingLeaveEntities: [
        {
          instanceId: "pending-src",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: "bob",
          chainId: "restore-pending-drift",
          deferZoneMoveUntilChainEnd: false,
        },
      ],
    };

    const { state: restored, warnings } = restoreSnapshot(
      createGameSnapshot(savedState),
      makeLookup([newDef])
    );

    expect(restored.activeContinuousEffects).toHaveLength(0);
    expect(warnings.some((w) => w.includes("rebuilder added"))).toBe(false);
  });

  it("未知 cardNo: warnings に列挙され、CE は登録されない", () => {
    const def = patchouliLikeDef("TEST-PATCHOULI");
    const savedState: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
    };
    const snap = createGameSnapshot(savedState);

    // ルックアップが何も返さない (現行カードデータからカードが消えた想定)
    const { state: restored, warnings } = restoreSnapshot(
      snap,
      () => undefined
    );

    expect(restored.activeContinuousEffects).toHaveLength(0);
    expect(warnings.some((w) => w.includes("unknown cardNo"))).toBe(true);
  });

  it("バトル進行中の state でも復元できる (ガードバイパス)", () => {
    const def = patchouliLikeDef("TEST-PATCHOULI");
    const fakeAttack: ActiveAttack = {
      attackId: "atk-1",
      primaryEntityId: "ent-1",
      participantEntityIds: ["ent-1"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [],
      symbolResolutionOrder: [],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const stateMidBattle: GameState = {
      ...makeState(),
      activeAttack: fakeAttack,
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
    };

    const snap = createGameSnapshot(stateMidBattle);
    // 通常はリビルダがガードで throw するが、restoreSnapshot はバイパスする
    const { state: restored } = restoreSnapshot(snap, makeLookup([def]));

    expect(restored.activeAttack).not.toBeNull();
    expect(restored.activeContinuousEffects.length).toBeGreaterThan(0);
  });

  it("既に CE が完備していれば restore で差分ゼロ (冪等)", () => {
    const def = patchouliLikeDef("TEST-PATCHOULI");
    const state: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
    };
    // 1 回目の restore で CE を完備させる
    const first = restoreSnapshot(
      createGameSnapshot(state),
      makeLookup([def])
    ).state;

    // 完備済 state を save → restore
    const second = restoreSnapshot(
      createGameSnapshot(first),
      makeLookup([def])
    );
    expect(second.warnings).toEqual([]);
    expect(second.state.activeContinuousEffects.length).toBe(
      first.activeContinuousEffects.length
    );
  });

  it("P3-45: pendingTriggeredEffects は round-trip で保持される", () => {
    // P3-45 再現確認: snapshot 保存→復元の経路で pending キューが消えないか。
    // ここで落ちたら rules-core の snapshot/rebuild 層に原因がある。
    const def = patchouliLikeDef("TEST-PTE");
    const stateWithPending: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
      pendingTriggeredEffects: [
        {
          pendingId: "pte-1",
          eventKind: "summon",
          actingPlayerId: "alice",
          source: "action_resolution",
          chainId: "test:snapshot:447",
          attackId: null,
          relatedPlayerId: null,
          relatedInstanceId: "src-1",
          amount: null,
          step: "main",
          window: "none",
          resolvedSourceInstanceIds: [],
        },
        {
          pendingId: "pte-2",
          eventKind: "summon",
          actingPlayerId: "bob",
          source: "action_resolution",
          chainId: "test:snapshot:461",
          attackId: null,
          relatedPlayerId: null,
          relatedInstanceId: "src-1",
          amount: null,
          step: "main",
          window: "none",
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    const snap = createGameSnapshot(stateWithPending);
    const json = JSON.parse(JSON.stringify(snap));
    const parsed = parseGameSnapshot(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const { state: restored } = restoreSnapshot(
      parsed.snapshot,
      makeLookup([def])
    );

    expect(restored.pendingTriggeredEffects).toHaveLength(2);
    expect(restored.pendingTriggeredEffects.map((e) => e.pendingId)).toEqual([
      "pte-1",
      "pte-2",
    ]);
  });

  it("P3-45 scrub: applicability で source 全滅の orphan pending は drop + warning される", () => {
    // P3-44 適用前に save された snapshot の再現:
    // - 紅魔館ライク (Lv2 制限の game_event:summon trigger 持ち) の nexus が Lv1 で場にある
    // - applicability: { level: { min: 2 } } を満たさないが、旧バグで pending が積まれた状態
    // - 復元時に scrub で drop され、warning にも痕跡が残る
    const triggerNexusDef: CardDefinition = {
      cardNo: "TEST-LV2-TRIGGER-NEXUS",
      name: "Lv2 trigger nexus",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [
        { level: 1, requiredCores: 0, bp: 0 },
        { level: 2, requiredCores: 1, bp: 0 },
      ],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: {
            kind: "game_event",
            player: "self",
            event: "summon",
            triggerFilter: { category: ["spirit"], colors: ["red"] },
          },
          applicability: { level: { min: 2 } },
          executionMode: "optional",
          steps: [
            {
              action: { kind: "life_fill", player: "self", targetValue: 5 },
            },
          ],
        },
      ],
    };
    const summonedSpiritDef: CardDefinition = {
      cardNo: "TEST-RED-SPIRIT",
      name: "Red spirit",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const savedState: GameState = {
      ...makeState(),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        // R21-like nexus at Lv1 (cores=0 → fails level: { min: 2 })
        createCardInstance(triggerNexusDef, {
          instanceId: "nexus-orphan",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        createCardInstance(summonedSpiritDef, {
          instanceId: "spirit-12",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      pendingTriggeredEffects: [
        {
          pendingId: "orphan-pte-1",
          eventKind: "summon",
          actingPlayerId: "alice",
          source: "action_resolution",
          chainId: "play:summon:spirit-12",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "spirit-12",
          amount: null,
          step: "main",
          window: "none",
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    const lookup = buildTriggeredEffectLookup([
      triggerNexusDef,
      summonedSpiritDef,
    ]);
    const cardLookup = makeLookup([triggerNexusDef, summonedSpiritDef]);

    const { state: restored, warnings } = restoreSnapshot(
      createGameSnapshot(savedState),
      cardLookup,
      { getRegisteredTriggeredEffectActions: lookup }
    );

    expect(restored.pendingTriggeredEffects).toHaveLength(0);
    expect(warnings.some((w) => w.includes("orphan-pte-1"))).toBe(true);
    expect(warnings.some((w) => w.includes("scrubbed"))).toBe(true);
  });

  it("P3-45 scrub: applicability OK な pending は scrub されない", () => {
    // 同じ trigger nexus が Lv2 (cores=1) なら applicability 通過 → pending は保持
    const triggerNexusDef: CardDefinition = {
      cardNo: "TEST-LV2-TRIGGER-NEXUS-OK",
      name: "Lv2 trigger nexus ok",
      printedCategory: "nexus",
      colors: ["red"],
      cost: 5,
      reductionSymbols: [],
      levelDefs: [
        { level: 1, requiredCores: 0, bp: 0 },
        { level: 2, requiredCores: 1, bp: 0 },
      ],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [
        {
          timing: {
            kind: "game_event",
            player: "self",
            event: "summon",
            triggerFilter: { category: ["spirit"], colors: ["red"] },
          },
          applicability: { level: { min: 2 } },
          executionMode: "optional",
          steps: [
            {
              action: { kind: "life_fill", player: "self", targetValue: 5 },
            },
          ],
        },
      ],
    };
    const summonedSpiritDef: CardDefinition = {
      cardNo: "TEST-RED-SPIRIT-OK",
      name: "Red spirit ok",
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
      effects: [],
    };
    const savedState: GameState = {
      ...makeState(),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [
        createCardInstance(triggerNexusDef, {
          instanceId: "nexus-ok",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1, // Lv2
        }),
        createCardInstance(summonedSpiritDef, {
          instanceId: "spirit-ok",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      pendingTriggeredEffects: [
        {
          pendingId: "valid-pte-1",
          eventKind: "summon",
          actingPlayerId: "alice",
          source: "action_resolution",
          chainId: "play:summon:spirit-ok",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "spirit-ok",
          amount: null,
          step: "main",
          window: "none",
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    const lookup = buildTriggeredEffectLookup([
      triggerNexusDef,
      summonedSpiritDef,
    ]);
    const cardLookup = makeLookup([triggerNexusDef, summonedSpiritDef]);

    const { state: restored, warnings } = restoreSnapshot(
      createGameSnapshot(savedState),
      cardLookup,
      { getRegisteredTriggeredEffectActions: lookup }
    );

    expect(restored.pendingTriggeredEffects).toHaveLength(1);
    expect(restored.pendingTriggeredEffects[0]!.pendingId).toBe("valid-pte-1");
    expect(warnings.some((w) => w.includes("scrubbed"))).toBe(false);
  });

  it("provenance 無しの旧 CE が混在していても modifierTag fallback で重複登録しない", () => {
    const def = patchouliLikeDef("TEST-PATCHOULI");
    const legacyCe: ContinuousEffect = {
      effectId: "legacy-ce",
      sourceInstanceId: "src-1",
      sourceDefinitionId: def.cardNo,
      actingPlayerId: "alice",
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "cost_override",
      modifierAmount: 0,
      targetFilter: { player: "self", category: ["magic"], tribes: ["紅魔"] },
      // provenance 無し (旧パイプラインで保存された snapshot 想定)
    };
    const oldStyleState: GameState = {
      ...makeState(),
      cardInstances: [
        createCardInstance(def, {
          instanceId: "src-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
      activeContinuousEffects: [legacyCe],
    };

    const { state: restored } = restoreSnapshot(
      createGameSnapshot(oldStyleState),
      makeLookup([def])
    );
    expect(restored.activeContinuousEffects).toHaveLength(1);
    expect(restored.activeContinuousEffects[0]!.effectId).toBe("legacy-ce");
  });
});
