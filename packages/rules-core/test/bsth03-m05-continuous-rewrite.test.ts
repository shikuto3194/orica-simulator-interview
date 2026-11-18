import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getCombinedUnitBp,
  getLegalActions,
  type CardDefinition,
  type GameState,
} from "../src/runtime";
import { recomputeAndRebuildContinuousEffects } from "../src/effect/continuous-effect-rebuild";

const M05 = ALL_CARDS.find((card) => card.cardNo === "BSTH03-M05")!;
const body =
  "このアルティメットは、系統：「導魔」を持つブレイヴ3つまでと合体条件を無視して合体でき、それらの効果の「このスピリット」すべては、「このアルティメット」に変更する。";
const brave: CardDefinition = {
  cardNo: "TEST-M05-CONTINUOUS",
  name: "継続読み替え検証ブレイヴ",
  printedCategory: "brave",
  colors: ["yellow"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  combinedBoost: 1000,
  symbolColors: ["yellow"],
  tribe: "導魔",
  braveCondition: { categories: ["spirit"], tribes: ["妖精"], minCost: 99 },
  textLines: ["【合体中】このスピリットをBP+5000する。"],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "continuous" },
      applicability: { combined: true },
      steps: [
        {
          action: {
            kind: "bp_modify",
            target: { kind: "self" },
            amount: 5000,
            duration: { scope: "while_on_field" },
          },
        },
      ],
      textRef: [0],
    },
  ],
};

function fixture(hostDef = M05, braveDef = brave, hostCores = 1) {
  const lookup = (id: string) =>
    [hostDef, braveDef].find((d) => d.cardNo === id);
  const options = {
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup([
      hostDef,
      braveDef,
    ]),
  };
  const state: GameState = {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    activePlayerId: "alice",
    turnNumber: 3,
    step: "main",
    cardInstances: [
      createCardInstance(hostDef, {
        instanceId: "host",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: hostCores,
      }),
      createCardInstance(braveDef, {
        instanceId: "brave",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
    ],
  };
  const actions = (s: GameState) =>
    getLegalActions({ state: s, actingPlayerId: "alice", ...options });
  const combine = (s: GameState) => {
    const action = actions(s).find(
      (a) => a.kind === "brave_combine" && a.targetInstanceId === "host"
    )!;
    expect(action).toBeDefined();
    return applyLegalAction({ state: s, action, ...options }).state;
  };
  const rebuild = (s: GameState) =>
    recomputeAndRebuildContinuousEffects(s, lookup);
  const bp = (s: GameState) =>
    getCombinedUnitBp(
      s,
      s.cardInstances.find((c) => c.instanceId === "host")!,
      hostDef,
      lookup
    );
  const ces = (s: GameState) =>
    s.activeContinuousEffects.filter(
      (ce) =>
        ce.sourceInstanceId === "brave" && ce.modifierTag === "bp_modifier"
    );
  return { state, options, lookup, actions, combine, rebuild, bp, ces };
}

describe("BSTH03-M05 必須の継続読み替え", () => {
  it("正本・弾別保存本文・実行定義は末尾だけを変更し、合体許可を維持する", () => {
    expect(M05.textLines[6]).toBe(body);
    for (const path of [
      "../../card-data/raw/cardData.js",
      "../../card-data/raw/by-pack/BSTH03.js",
    ]) {
      const raw = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(raw).toContain(body);
      expect(raw).not.toContain(body.replace("変更する。", "変更できる。"));
    }
    expect(M05.maxCombinedBraves?.selfReferenceRewrite?.executionMode).toBe(
      "mandatory"
    );
  });

  it.each([
    [1, 16000],
    [2, 18000],
    [3, 21000],
  ])(
    "Lv3〜Lv5: 合体前コア%sで合法合体後のBPは%s、読み替え選択を作らない",
    (cores, expected) => {
      const f = fixture(M05, brave, cores);
      expect(f.ces(f.rebuild(f.state))).toHaveLength(0);
      const after = f.combine(f.state);
      expect(
        after.cardInstances.find((c) => c.instanceId === "brave")
      ).toMatchObject({ attachedToInstanceId: "host", normalCoreCount: 0 });
      expect(f.bp(after)).toBe(expected);
      expect(f.ces(after)).toHaveLength(1);
      expect(f.ces(f.rebuild(after))).toHaveLength(1);
      expect(after.pendingTriggeredEffects).toHaveLength(0);
      expect(after.battleImmediateEffects).toHaveLength(0);
      expect(after.stackWindow).toBeNull();
    }
  );

  it("読み替えcarrier欠落の対照では合体できても継続BPは適用しない", () => {
    const { selfReferenceRewrite: _rewrite, ...limit } = M05.maxCombinedBraves!;
    const f = fixture({ ...M05, maxCombinedBraves: limit });
    const after = f.combine(f.state);
    expect(f.bp(after)).toBe(11000);
    expect(f.ces(after)).toHaveLength(0);
  });

  it("Lv不足で既登録CEを除き、Lv復帰時は選び直さず自動適用する", () => {
    const f = fixture();
    const active = f.combine(f.state);
    // Core-change boundary before SBA: test carrier eligibility independently
    // of the host's ensuing disappearance and automatic separation.
    const setCores = (s: GameState, cores: number) => ({
      ...s,
      cardInstances: s.cardInstances.map((c) =>
        c.instanceId === "host" ? { ...c, normalCoreCount: cores } : c
      ),
    });
    const inactive = f.rebuild(setCores(active, 0));
    expect(f.ces(inactive)).toHaveLength(0);
    const restored = f.rebuild(setCores(inactive, 2));
    expect(f.bp(restored)).toBe(16000);
    expect(f.ces(restored)).toHaveLength(1);
    expect(restored.pendingTriggeredEffects).toHaveLength(0);
  });

  it("ホスト効果抑止で継続CEを除き、抑止解除時は自動で再適用する", () => {
    const f = fixture();
    const active = f.combine(f.state);
    const suppressed = f.rebuild({
      ...active,
      activeContinuousEffects: [
        ...active.activeContinuousEffects,
        {
          effectId: "suppress-host",
          sourceInstanceId: "host",
          sourceDefinitionId: M05.cardNo,
          actingPlayerId: "bob",
          targetInstanceId: "host",
          modifierTag: "effect_suppression",
          metadata: { effectFilter: { effectIndex: 1 } },
          duration: { scope: "turn" },
          createdAtTurn: 3,
          createdAtAttackId: null,
        },
      ],
    });
    expect(f.ces(suppressed)).toHaveLength(0);
    expect(f.bp(suppressed)).toBe(11000);
    const restored = f.rebuild({
      ...suppressed,
      activeContinuousEffects: suppressed.activeContinuousEffects.filter(
        (ce) => ce.effectId !== "suppress-host"
      ),
    });
    expect(f.ces(restored)).toHaveLength(1);
    expect(f.bp(restored)).toBe(16000);
  });

  it("合法分離で読み替えを解除し、再合体で自動復帰する", () => {
    const f = fixture();
    const active = f.combine(f.state);
    const action = f.actions(active).find((a) => a.kind === "brave_separate")!;
    expect(action).toBeDefined();
    const separated = applyLegalAction({
      state: active,
      action,
      ...f.options,
    }).state;
    expect(
      separated.cardInstances.find((c) => c.instanceId === "brave")!
        .attachedToInstanceId
    ).toBeNull();
    expect(f.ces(separated)).toHaveLength(0);
    const recombined = f.combine(separated);
    expect(f.ces(recombined)).toHaveLength(1);
    expect(recombined.pendingTriggeredEffects).toHaveLength(0);
  });

  it("非導魔ブレイヴは合体候補にならず、接続済み境界でも読み替えない", () => {
    const f = fixture(M05, { ...brave, tribe: "妖精" });
    expect(f.actions(f.state).some((a) => a.kind === "brave_combine")).toBe(
      false
    );
    const attached = f.rebuild({
      ...f.state,
      cardInstances: f.state.cardInstances.map((c) =>
        c.instanceId === "host"
          ? { ...c, attachedChildrenIds: ["brave"] }
          : { ...c, attachedToInstanceId: "host", normalCoreCount: 0 }
      ),
    });
    expect(f.ces(attached)).toHaveLength(0);
  });

  it("【スピリット合体中】は本文読み替えでアルティメット用見出しに変えない", () => {
    const f = fixture(M05, {
      ...brave,
      textLines: [
        brave.textLines[0]!.replace("【合体中】", "【スピリット合体中】"),
      ],
    });
    expect(f.ces(f.combine(f.state))).toHaveLength(0);
  });

  it("通常のスピリットへの合体効果には読み替えcarrierを要求しない", () => {
    const { maxCombinedBraves: _limit, ...host } = M05;
    const f = fixture(
      { ...host, printedCategory: "spirit", effects: [] },
      { ...brave, braveCondition: { categories: ["spirit"], minCost: 6 } }
    );
    const after = f.combine(f.state);
    expect(f.ces(after)).toHaveLength(1);
    expect(f.bp(after)).toBe(16000);
  });

  it("アルティメットを直接指定する効果には読み替えcarrierを要求しない", () => {
    const { selfReferenceRewrite: _rewrite, ...limit } = M05.maxCombinedBraves!;
    const f = fixture(
      { ...M05, maxCombinedBraves: limit },
      {
        ...brave,
        textLines: [
          brave.textLines[0]!.replace("このスピリット", "このアルティメット"),
        ],
      }
    );
    const after = f.combine(f.state);
    expect(f.ces(after)).toHaveLength(1);
    expect(f.bp(after)).toBe(16000);
  });

  it("任意の読み替え設定を必須へ拡張せず、継続効果を無断で自動適用しない", () => {
    const f = fixture({
      ...M05,
      maxCombinedBraves: {
        ...M05.maxCombinedBraves!,
        selfReferenceRewrite: {
          ...M05.maxCombinedBraves!.selfReferenceRewrite!,
          executionMode: "optional",
        },
      },
    });
    const after = f.combine(f.state);
    expect(f.ces(after)).toHaveLength(0);
    expect(f.bp(after)).toBe(11000);
  });

  it("起動効果も有効な読み替えが必要で、宣言後の資格喪失を解決時に再確認する", () => {
    const activated: CardDefinition = {
      ...brave,
      textLines: ["【合体中】フラッシュ：このスピリットは回復する。"],
      effects: [
        {
          timing: { kind: "activated", mode: "flash" },
          applicability: { combined: true },
          steps: [{ action: { kind: "recover", target: { kind: "self" } } }],
          textRef: [0],
        },
      ],
    };
    const f = fixture(M05, activated);
    const active = f.combine(f.state);
    const exhausted = {
      ...active,
      cardInstances: active.cardInstances.map((c) =>
        c.instanceId === "host"
          ? { ...c, exhaustState: "exhausted" as const }
          : c
      ),
    };
    expect(
      f.actions(exhausted).some((a) => a.kind === "use_field_card_effect")
    ).toBe(true);
    const execute = (state: GameState) =>
      executeEffect({
        state,
        chainId: "test:m05-activated",
        sourceInstanceId: "host",
        effectSourceInstanceId: "brave",
        effectSourceDefinitionId: activated.cardNo,
        actingPlayerId: "alice",
        effect: activated.effects![0]!,
        getCardDefinitionById: f.lookup,
      });
    expect(
      execute(exhausted).cardInstances.find((c) => c.instanceId === "host")!
        .exhaustState
    ).toBe("recovered");
    const inactive = {
      ...exhausted,
      cardInstances: exhausted.cardInstances.map((c) =>
        c.instanceId === "host" ? { ...c, normalCoreCount: 0 } : c
      ),
    };
    expect(
      f.actions(inactive).some((a) => a.kind === "use_field_card_effect")
    ).toBe(false);
    expect(
      execute(inactive).cardInstances.find((c) => c.instanceId === "host")!
        .exhaustState
    ).toBe("exhausted");
  });
});
