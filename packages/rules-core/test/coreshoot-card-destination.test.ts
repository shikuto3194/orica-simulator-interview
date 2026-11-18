/**
 * コアシュート (from:field) の行き先を field/field_card/card_instance (= 特定カード上) に
 * 拡張する回帰。ENGINE-coreshoot-soul-destination-include-field-card。
 *
 * 10_rules/06 §41-42・§54・§71: generic な「コア」は soul も含み、行き先は field/card 上も
 * 可 (ボイドのみ硬制約)。coreShootSoulDestinationAllowed/genericSoulDestination は従来
 * reserve/trash/life のみを soul 可としていたが、field/field_card/card_instance も候補に
 * 含める。soul のカード間移転は ENGINE-core-move-soul-cross-player-destination option (b)
 * に整合させ、fromPlayerId===toPlayerId (同一プレイヤー) のときのみ許可する。
 * field/field_card は destination 候補がちょうど1枚のときだけ auto-resolve する
 * (resolveCoreShootCardDestinationId)。複数候補時の行き先選択 pending は未実装で park。
 *
 * card_instance 宛の実運用経路は `target: TargetSpec` + `to: {kind:"target_card"}`
 * (effect-interpreter.resolveTargetCardCoreLocation が resolvedTargetIds[0] を
 * card_instance に束ねる。precedent: BSKB01-CX01「相手のリザーブのコア1個を相手の
 * スピリット/アルティメットに置ける」)。本ファイルはそれの from:field (coreshoot) 版。
 */
import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  executeEffect,
  withSoulCoreLocation,
} from "../src/index";
import type { CardDefinition, GameState } from "../src/index";

const shooter: CardDefinition = {
  cardNo: "TEST-CORESHOOT-CARD-DEST",
  name: "コアシュート発生源(カード宛)",
  printedCategory: "spirit",
  colors: ["purple"],
  cost: 4,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const oppSp: CardDefinition = {
  cardNo: "TEST-OPP-SPIRIT-CD",
  name: "相手スピリット",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const ownSp: CardDefinition = {
  cardNo: "TEST-OWN-SPIRIT-CD",
  name: "自分のスピリット",
  printedCategory: "spirit",
  colors: ["green"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  symbolColors: ["green"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const enterFieldOnlyDest: CardDefinition = {
  ...ownSp,
  cardNo: "TEST-ENTER-FIELD-ONLY-DEST-CD",
  name: "出すとき以外コア配置不可の行き先",
  tokenIndependentCoreManagement: {
    redirectCoresToVoid: false,
    placementRestrictedToEnterField: true,
  },
};

const localDefs = new Map<string, CardDefinition>([
  [shooter.cardNo, shooter],
  [oppSp.cardNo, oppSp],
  [ownSp.cardNo, ownSp],
  [enterFieldOnlyDest.cardNo, enterFieldOnlyDest],
]);

describe("コアシュート: 行き先が特定フィールドカード上 (card_instance/field_card)", () => {
  it("相手フィールド→自分のスピリット(target_card→card_instance, cross-player)は通常コアのみ移動する(soulはfromPlayerId!==toPlayerIdで除外)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const shooterDef: CardDefinition = {
      ...shooter,
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "core_move",
                // excludeSelf で発生源 (shooter-1) を destination 候補から除外し、
                // own-a 1枚だけに絞り込む。
                target: {
                  kind: "filter",
                  player: "self",
                  filter: {},
                  count: 1,
                  excludeSelf: true,
                },
                from: { kind: "field", player: "opponent" },
                to: { kind: "target_card" },
                amount: 1,
              },
            },
          ],
        },
      ],
    };
    const defs = new Map(localDefs);
    defs.set(shooterDef.cardNo, shooterDef);

    const stateWithoutSoul: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(shooterDef, {
          instanceId: "shooter-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        // alice のフィールドは own-a 1枚のみ → target 単一候補で自動解決
        createCardInstance(ownSp, {
          instanceId: "own-a",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        // opp-b: 相手のソウルコアのみが乗った単独候補 (coreshoot 側も候補1 → auto-resolve)
        createCardInstance(oppSp, {
          instanceId: "opp-b",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 0,
        }),
      ],
    };
    const state = withSoulCoreLocation(stateWithoutSoul, "bob", {
      kind: "card",
      instanceId: "opp-b",
    });

    const result = executeEffect({
      chainId: "test:coreshoot-card-destination:155",
      state,
      effect: shooterDef.effects![0],
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    // 候補1(opp-b) → auto-resolve。cross-player (bob→alice) のため soul は除外され、
    // 通常コアは無い (opp-b は soul のみ) ので移動は発生しない。
    expect(result.pendingCoreShootSelection).toBeNull();
    const ownA = result.cardInstances.find((c) => c.instanceId === "own-a")!;
    expect(ownA.normalCoreCount).toBe(0);
    const bob = result.players.find((p) => p.id === "bob")!;
    expect(bob.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "opp-b",
    });
  });

  it("相手フィールド(通常コア2)→自分のスピリット(target_card→card_instance, 複数候補→pending)で通常コアがカードへ乗る", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const shooterDef: CardDefinition = {
      ...shooter,
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "core_move",
                // excludeSelf で発生源 (shooter-1) を destination 候補から除外し、
                // own-a 1枚だけに絞り込む。
                target: {
                  kind: "filter",
                  player: "self",
                  filter: {},
                  count: 1,
                  excludeSelf: true,
                },
                from: { kind: "field", player: "opponent" },
                to: { kind: "target_card" },
                amount: 1,
              },
            },
          ],
        },
      ],
    };
    const defs = new Map(localDefs);
    defs.set(shooterDef.cardNo, shooterDef);

    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(shooterDef, {
          instanceId: "shooter-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        createCardInstance(ownSp, {
          instanceId: "own-a",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        createCardInstance(oppSp, {
          instanceId: "opp-a",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 2,
        }),
        createCardInstance(oppSp, {
          instanceId: "opp-c",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    };

    const pendingResult = executeEffect({
      chainId: "test:coreshoot-card-destination:238",
      state,
      effect: shooterDef.effects![0],
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    expect(pendingResult.pendingCoreShootSelection).not.toBeNull();
    const pending = pendingResult.pendingCoreShootSelection!;
    expect(pending.toKind).toBe("card_instance");
    expect(pending.toCardInstanceId).toBe("own-a");

    const actions = getLegalActions({
      state: pendingResult,
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredFieldCardEffectActions: () => undefined,
    });
    const csAction = actions.find(
      (a) => a.kind === "resolve_pending_core_shoot"
    );
    expect(csAction).toBeDefined();

    const resolved = applyLegalAction({
      state: pendingResult,
      action: csAction!,
      getCardDefinitionById: (id) => defs.get(id),
      getRegisteredTriggeredEffectActions: () => [],
      coreShootDistribution: { "opp-a": 1 },
    });
    const result = resolved.state;

    const ownA = result.cardInstances.find((c) => c.instanceId === "own-a")!;
    expect(ownA.normalCoreCount).toBe(1);
    const oppA = result.cardInstances.find((c) => c.instanceId === "opp-a")!;
    expect(oppA.normalCoreCount).toBe(1);
  });

  it("自分フィールド→自分の別スピリット(target_card→card_instance, same-player)はsoulも一緒に移せる", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const shooterDef: CardDefinition = {
      ...shooter,
      effects: [
        {
          timing: { kind: "card_event", event: "main" },
          steps: [
            {
              action: {
                kind: "core_move",
                // excludeSelf で発生源 (shooter-1) を destination 候補から除外し、
                // own-b 1枚だけに絞り込む (coreshoot 源=shooter-1 自身との混同を避ける)。
                target: {
                  kind: "filter",
                  player: "self",
                  filter: {},
                  count: 1,
                  excludeSelf: true,
                },
                from: { kind: "field", player: "self" },
                to: { kind: "target_card" },
                amount: 1,
              },
            },
          ],
        },
      ],
    };
    const defs = new Map(localDefs);
    defs.set(shooterDef.cardNo, shooterDef);

    const stateWithoutSoul: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        // shooter-1: alice のソウルコアのみが乗った単独 coreshoot 源候補
        // (from:field player:self の候補は shooter-1 のみ → auto-resolve)。
        createCardInstance(shooterDef, {
          instanceId: "shooter-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        // own-b: shooter-1 (excludeSelf で除外) を除く alice の唯一の destination 候補
        createCardInstance(ownSp, {
          instanceId: "own-b",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
      ],
    };
    const state = withSoulCoreLocation(stateWithoutSoul, "alice", {
      kind: "card",
      instanceId: "shooter-1",
    });

    const result = executeEffect({
      chainId: "test:coreshoot-card-destination:335",
      state,
      effect: shooterDef.effects![0],
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    // coreshoot 源候補1 (shooter-1、ソウルのみ) → auto-resolve。destination も候補1
    // (own-b) → auto-resolve。same-player なので soul が own-b へ移動する。
    expect(result.pendingCoreShootSelection).toBeNull();
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "own-b",
    });
  });

  it("自分フィールド→出すとき以外配置不可の target_card には soul を移さない", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const shooterDef: CardDefinition = {
      ...shooter,
      effects: [
        {
          timing: { kind: "card_event", event: "main" },
          steps: [
            {
              action: {
                kind: "core_move",
                target: {
                  kind: "filter",
                  player: "self",
                  filter: { colors: ["green"] },
                  count: 1,
                  excludeSelf: true,
                },
                from: { kind: "field", player: "self" },
                to: { kind: "target_card" },
                amount: 1,
              },
            },
          ],
        },
      ],
    };
    const defs = new Map(localDefs);
    defs.set(shooterDef.cardNo, shooterDef);

    const stateWithoutSoul: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(shooterDef, {
          instanceId: "shooter-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        createCardInstance(enterFieldOnlyDest, {
          instanceId: "locked-dest",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
      ],
    };
    const state = withSoulCoreLocation(stateWithoutSoul, "alice", {
      kind: "card",
      instanceId: "shooter-1",
    });

    const result = executeEffect({
      chainId: "test:coreshoot-card-destination:406",
      state,
      effect: shooterDef.effects![0],
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "shooter-1",
    });
    const source = result.cardInstances.find(
      (card) => card.instanceId === "shooter-1"
    )!;
    const destination = result.cardInstances.find(
      (card) => card.instanceId === "locked-dest"
    )!;
    expect(source.soulCoreCount).toBe(1);
    expect(destination.soulCoreCount).toBe(0);
  });

  it("行き先が field_card + filter で候補ちょうど1枚のとき auto-resolve する", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const shooterDef: CardDefinition = {
      ...shooter,
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "core_move",
                from: { kind: "field", player: "opponent" },
                to: {
                  kind: "field_card",
                  player: "self",
                  filter: { colors: ["green"] },
                },
                amount: 1,
              },
            },
          ],
        },
      ],
    };
    const defs = new Map(localDefs);
    defs.set(shooterDef.cardNo, shooterDef);

    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(shooterDef, {
          instanceId: "shooter-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        // alice の緑スピリットは own-a 1枚のみ (filter が絞り込む唯一の候補)
        createCardInstance(ownSp, {
          instanceId: "own-a",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        createCardInstance(oppSp, {
          instanceId: "opp-b",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    };

    const result = executeEffect({
      chainId: "test:coreshoot-card-destination:482",
      state,
      effect: shooterDef.effects![0],
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    expect(result.pendingCoreShootSelection).toBeNull();
    const ownA = result.cardInstances.find((c) => c.instanceId === "own-a")!;
    expect(ownA.normalCoreCount).toBe(1);
    const oppB = result.cardInstances.find((c) => c.instanceId === "opp-b")!;
    expect(oppB.normalCoreCount).toBe(0);
  });

  it("行き先が field_card + filter で候補が複数枚のときは未解決のまま何も動かない (残スコープ)", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const shooterDef: CardDefinition = {
      ...shooter,
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "core_move",
                from: { kind: "field", player: "opponent" },
                to: {
                  kind: "field_card",
                  player: "self",
                  filter: { colors: ["green"] },
                },
                amount: 1,
              },
            },
          ],
        },
      ],
    };
    const defs = new Map(localDefs);
    defs.set(shooterDef.cardNo, shooterDef);

    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(shooterDef, {
          instanceId: "shooter-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        // alice の緑スピリットが2枚 → 行き先候補が複数のため未対応 (park)
        createCardInstance(ownSp, {
          instanceId: "own-a",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        createCardInstance(ownSp, {
          instanceId: "own-b",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        createCardInstance(oppSp, {
          instanceId: "opp-b",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    };

    const result = executeEffect({
      chainId: "test:coreshoot-card-destination:556",
      state,
      effect: shooterDef.effects![0],
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    // 行き先が解決できないため partial-impl fallback。状態は変化しない。
    expect(result.pendingCoreShootSelection).toBeNull();
    const ownA = result.cardInstances.find((c) => c.instanceId === "own-a")!;
    const ownB = result.cardInstances.find((c) => c.instanceId === "own-b")!;
    const oppB = result.cardInstances.find((c) => c.instanceId === "opp-b")!;
    expect(ownA.normalCoreCount).toBe(0);
    expect(ownB.normalCoreCount).toBe(0);
    expect(oppB.normalCoreCount).toBe(1);
    expect(result.log.some((l) => l.endsWith(":partial-impl"))).toBe(true);
  });

  it("field_card destination の唯一の候補が target-lock CE (cannot_be_targeted) 対象のときは auto-resolve しない", () => {
    // verifier 2026-07-02 round 1 lens 4: resolveCoreShootCardDestinationId は
    // applyCardTargetAcquisitionGate (from:field_card ソース側候補解決と同じゲート) を
    // 経由しない限り、target-lock されたカードを唯一の残存候補として誤って
    // auto-resolve してしまう。own-a を cannot_be_targeted CE で対象ロックし、
    // ゲートが正しく除外することを確認する (回帰: ゲート未適用ならこのテストは fail する)。
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const shooterDef: CardDefinition = {
      ...shooter,
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "core_move",
                from: { kind: "field", player: "opponent" },
                to: {
                  kind: "field_card",
                  player: "self",
                  filter: { colors: ["green"] },
                },
                amount: 1,
              },
            },
          ],
        },
      ],
    };
    const defs = new Map(localDefs);
    defs.set(shooterDef.cardNo, shooterDef);

    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(shooterDef, {
          instanceId: "shooter-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        // alice の緑スピリットは own-a 1枚のみだが cannot_be_targeted CE で対象ロック済み。
        createCardInstance(ownSp, {
          instanceId: "own-a",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        createCardInstance(oppSp, {
          instanceId: "opp-b",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
      activeContinuousEffects: [
        {
          effectId: "ce-lock-own-a",
          sourceInstanceId: "opp-lock-source",
          sourceDefinitionId: oppSp.cardNo,
          actingPlayerId: "bob",
          duration: { scope: "permanent" },
          createdAtTurn: 0,
          createdAtAttackId: null,
          modifierTag: "cannot_be_targeted",
          targetInstanceId: "own-a",
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:coreshoot-card-destination:646",
      state,
      effect: shooterDef.effects![0],
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    // own-a が target-lock で候補から除外され、行き先候補0枚 → 未解決 fallback。
    // 通常コアはどこにも移動しない (own-a に乗らない)。
    expect(result.pendingCoreShootSelection).toBeNull();
    const ownA = result.cardInstances.find((c) => c.instanceId === "own-a")!;
    const oppB = result.cardInstances.find((c) => c.instanceId === "opp-b")!;
    expect(ownA.normalCoreCount).toBe(0);
    expect(oppB.normalCoreCount).toBe(1);
    expect(result.log.some((l) => l.endsWith(":partial-impl"))).toBe(true);
  });

  it("同一プレイヤー内 from:field (無filter) の唯一の候補が destination 自身のとき、自己参照でコアが相殺されない (verifier 2026-07-02 round 2 lens 3)", () => {
    // own-a は「from:field player:self (無filter)」の唯一の source 候補であり、同時に
    // 「to:field_card filter:green」の唯一の destination 候補でもある。destination を
    // source プールから除外しないと take と movedTotal 加算が同一カードに適用され、
    // コアが一切動いていないのに movedTotal>0 (「1個移動した」) と誤ログするバグが起きる。
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const shooterDef: CardDefinition = {
      ...shooter,
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "core_move",
                from: { kind: "field", player: "self" },
                to: {
                  kind: "field_card",
                  player: "self",
                  filter: { colors: ["green"] },
                },
                amount: 1,
              },
            },
          ],
        },
      ],
    };
    const defs = new Map(localDefs);
    defs.set(shooterDef.cardNo, shooterDef);

    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(shooterDef, {
          instanceId: "shooter-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        // alice の緑スピリットは own-a 1枚のみ。from:field (無filter) の source 候補としても
        // own-a だけが対象 (shooter-1 は cores:0 で対象外)。
        createCardInstance(ownSp, {
          instanceId: "own-a",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
    };

    const result = executeEffect({
      chainId: "test:coreshoot-card-destination:716",
      state,
      effect: shooterDef.effects![0],
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    // own-a は source プールから除外されるため取れるコアが無く、コアは一切動かない。
    expect(result.pendingCoreShootSelection).toBeNull();
    const ownA = result.cardInstances.find((c) => c.instanceId === "own-a")!;
    expect(ownA.normalCoreCount).toBe(2);
    // 修正前は自己参照の take/movedTotal 加算が相殺し合い、状態は不変なのに
    // movedTotal=1 (「1個移動した」) と誤ログした。修正後は正しく movedTotal=0。
    const coreMoveLog = result.log.find((l) =>
      l.startsWith("effect:core_move:field:alice->field_card:alice:")
    );
    expect(coreMoveLog).toBe(
      "effect:core_move:field:alice->field_card:alice:0"
    );
  });

  it("destination カード自身が soul を保持しているとき、auto-resolve fallback が自己参照 soul で amount を偽装消費しない (verifier 2026-07-02 round 3 lens 3)", () => {
    // own-a (destination, green filter で一意) が alice のソウルコアを保持している。
    // own-b (通常コア1個、green ではないので destination 候補にならないが from:field
    // (無filter) の source 候補にはなる) が唯一の実在する取得元。amount:2 かつ
    // includeReserve:true でリザーブにも通常コアがあるとき、destination 自身の soul を
    // 自己参照で「取得」して amount を消費すると、本来リザーブから取れたはずの2個目の
    // コアが沈黙裡に取りこぼされ、かつログには実際には動いていない ":+soul" が付く。
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const shooterDef: CardDefinition = {
      ...shooter,
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "core_move",
                from: { kind: "field", player: "self", includeReserve: true },
                to: {
                  kind: "field_card",
                  player: "self",
                  filter: { colors: ["green"] },
                },
                amount: 2,
              },
            },
          ],
        },
      ],
    };
    const defs = new Map(localDefs);
    defs.set(shooterDef.cardNo, shooterDef);

    const nonGreenSp: CardDefinition = {
      ...oppSp,
      cardNo: "TEST-OWN-NONGREEN",
    };
    defs.set(nonGreenSp.cardNo, nonGreenSp);

    const stateWithoutSoul: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(shooterDef, {
          instanceId: "shooter-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        // destination (green で一意) かつ alice のソウルコアの在処。通常コアは0。
        createCardInstance(ownSp, {
          instanceId: "own-a",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        // green ではないので destination 候補にならないが、from の唯一の実在 source。
        createCardInstance(nonGreenSp, {
          instanceId: "own-b",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      players: base.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              // totalAvailable (own-b の1 + リザーブの1 = 2) = amount(2) となるように
              // ちょうど 1 に設定し、analyzeCoreShootCandidates が pending ではなく
              // auto-resolve fallback (null 復帰) を選ぶよう仕向ける
              // (reserve が候補に余剰があると pending 経路に分岐してしまうため)。
              reserveNormalCoreCount: 1,
            }
          : p
      ),
    };
    const state = withSoulCoreLocation(stateWithoutSoul, "alice", {
      kind: "card",
      instanceId: "own-a",
    });

    const result = executeEffect({
      chainId: "test:coreshoot-card-destination:820",
      state,
      effect: shooterDef.effects![0],
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
    });

    expect(result.pendingCoreShootSelection).toBeNull();
    // own-b の1個 + リザーブの1個 = 2個が own-a に乗る（destination 自身の soul は
    // 自己参照のため source としてカウントされない）。
    const ownA = result.cardInstances.find((c) => c.instanceId === "own-a")!;
    expect(ownA.normalCoreCount).toBe(2);
    const ownB = result.cardInstances.find((c) => c.instanceId === "own-b")!;
    expect(ownB.normalCoreCount).toBe(0);
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(0);
    expect(alice.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "own-a",
    });
    const coreMoveLog = result.log.find((l) =>
      l.startsWith("effect:core_move:field:alice->field_card:alice:")
    );
    // 修正前は own-a 自身の soul を自己参照で「取得」して amount を偽装消費し、
    // リザーブから取らずに ":+soul" と誤ログした (own-a は1個止まり、リザーブ未消費)。
    expect(coreMoveLog).toBe(
      "effect:core_move:field:alice->field_card:alice:2:+reserve1"
    );
  });

  it("coreShootDistribution (player-selected 分配) に destination 自身の自己参照エントリが含まれても movedTotal を水増ししない (verifier 2026-07-02 round 4 lens 3)", () => {
    // pending 経路 (applyPendingCoreShootAction) は pending.candidates 由来のため destination
    // 自身を分配先に含められないが、executeEffect は coreShootDistribution を直接受け取れる
    // 公開 API であり、この検証を経由しない呼び出し元 (AI/直接呼び出し) が destination 自身の
    // instanceId を分配に含めても、analyzeCoreShootCandidates / auto-resolve fallback と対称に
    // 除外されることを保証する回帰。own-a (destination) の自己エントリは最終状態には影響しない
    // (代数的に相殺されるため) が、movedTotal ログが自己参照分だけ水増しされていた。
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const shooterDef: CardDefinition = {
      ...shooter,
      effects: [
        {
          timing: { kind: "card_event", event: "attack" },
          steps: [
            {
              action: {
                kind: "core_move",
                from: { kind: "field", player: "self" },
                to: {
                  kind: "field_card",
                  player: "self",
                  filter: { colors: ["green"] },
                },
                amount: 1,
              },
            },
          ],
        },
      ],
    };
    const defs = new Map(localDefs);
    defs.set(shooterDef.cardNo, shooterDef);

    const nonGreenSp: CardDefinition = {
      ...oppSp,
      cardNo: "TEST-OWN-NONGREEN-2",
    };
    defs.set(nonGreenSp.cardNo, nonGreenSp);

    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(shooterDef, {
          instanceId: "shooter-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        createCardInstance(ownSp, {
          instanceId: "own-a",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
        createCardInstance(nonGreenSp, {
          instanceId: "own-b",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    };

    const result = executeEffect({
      chainId: "test:coreshoot-card-destination:915",
      state,
      effect: shooterDef.effects![0],
      sourceInstanceId: "shooter-1",
      actingPlayerId: "alice",
      getCardDefinitionById: (id) => defs.get(id),
      // own-a (= destination) 自身を分配に含める不正入力を模擬。
      coreShootDistribution: { "own-a": 1, "own-b": 1 },
    });

    // own-a の自己エントリは相殺され最終状態には影響しない (代数的に常に同じ結果になる):
    // own-a = 元の2個 + own-b からの1個 = 3個、own-b は0個。
    const ownA = result.cardInstances.find((c) => c.instanceId === "own-a")!;
    expect(ownA.normalCoreCount).toBe(3);
    const ownB = result.cardInstances.find((c) => c.instanceId === "own-b")!;
    expect(ownB.normalCoreCount).toBe(0);
    const coreMoveLog = result.log.find((l) =>
      l.startsWith("effect:core_move:field:alice->field_card:alice:")
    );
    // 修正前は own-a の自己エントリ (1) も movedTotal に加算し ":2:player-selected" と
    // 誤ログした (実際に動いたのは own-b の1個のみ)。修正後は正しく ":1"。
    expect(coreMoveLog).toBe(
      "effect:core_move:field:alice->field_card:alice:1:player-selected"
    );
  });
});
