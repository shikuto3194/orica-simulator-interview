import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  applyLegalAction,
  buildMagicLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type CardDefinition,
  type GameState,
} from "../src";
import type { Action } from "../src/dsl-types";
import {
  buildPendingStepPrompt,
  stepPromptForChoosingPlayer,
} from "../src/effect/effect-step-prompt";

describe("操作文は選択者視点、引用は効果所有者視点", () => {
  it.each<[Action, string]>([
    [
      { kind: "count_decrease", player: "opponent", amount: 4 },
      "自分のカウントを4減らしますか？",
    ],
    [
      { kind: "count_increase", player: "self", amount: 2 },
      "相手のカウント+2しますか？",
    ],
    [
      { kind: "discard", player: "opponent", count: 1 },
      "自分の手札を1枚破棄しますか？",
    ],
    [
      {
        kind: "core_move",
        from: { kind: "life", player: "opponent" },
        to: { kind: "reserve", player: "self" },
        amount: 1,
      },
      "自分のライフからコア1個を相手のリザーブに置きますか？",
    ],
    [
      {
        kind: "destroy",
        target: {
          kind: "filter",
          player: "opponent",
          filter: {
            category: ["spirit"],
            cardName: { contains: "相手と自分" },
          },
          count: 1,
        },
      },
      "自分のカード名に「相手と自分」を含むスピリット1つを破壊しますか？",
    ],
    [
      {
        kind: "core_move",
        from: { kind: "any_movable_self" },
        to: { kind: "void" },
        amount: 1,
      },
      "相手の移動可能なコアからコア1個をボイドに置きますか？",
    ],
  ])("%j を操作する相手に正しい資源の持ち主を示す", (action, question) => {
    const prompt = buildPendingStepPrompt({ action });
    expect(stepPromptForChoosingPlayer(prompt, "alice", "bob").question).toBe(
      question
    );
    expect(stepPromptForChoosingPlayer(prompt, "bob", "alice").question).toBe(
      question
    );
    expect(stepPromptForChoosingPlayer(prompt, "alice", "alice")).toEqual(
      prompt
    );
  });

  it("明示した確認文・ラベルだけを反転し、引用と入力を保持する", () => {
    const sourceText = "相手が相手のカウント-4しなければ、その効果を受けない。";
    const prompt = {
      label: "相手のカウント-4",
      question: "相手のカウント-4しますか？",
      sourceText,
    };
    expect(stepPromptForChoosingPlayer(prompt, "alice", "bob")).toEqual({
      label: "自分のカウント-4",
      question: "自分のカウント-4しますか？",
      sourceText,
    });
    expect(prompt.label).toBe("相手のカウント-4");
    expect(
      stepPromptForChoosingPlayer(
        {
          label: "相手ターン飛ばし",
          question: "「相手ターン飛ばし」を発揮しますか？",
        },
        "alice",
        "bob"
      ).question
    ).toBe("「自分ターン飛ばし」を発揮しますか？");
  });

  it("全収録面・付与効果・choice・神技を再帰走査し、相手選択の定義を監査する", () => {
    const found: string[] = [];
    const visit = (value: unknown, path: string) => {
      if (value === null || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (record.chooser === "opponent") found.push(path);
      for (const [key, child] of Object.entries(record))
        visit(child, `${path}.${key}`);
    };
    for (const card of ALL_CARDS) visit(card, card.cardNo);
    expect(found.sort()).toEqual([
      "BSGE01-C13.effects.1.steps.0",
      "BSKB01-C02.effects.0.steps.2",
      "BSKB01-T01.effects.1.steps.1",
    ]);
  });
});

const source: CardDefinition = {
  cardNo: "TEST-CHOOSER-PROMPT",
  name: "相手選択テスト",
  printedCategory: "magic",
  colors: ["red"],
  cost: 0,
  reductionSymbols: [],
  levelDefs: [],
  symbolColors: [],
  textLines: ["相手は相手のカウントを1減らすか、自分のカウントを2減らす。"],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [
    {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          chooser: "opponent",
          action: { kind: "count_decrease", player: "opponent", amount: 1 },
          prompt: {
            label: "相手のカウントを1減らす",
            sourceText: "相手のカウントを1減らす。",
          },
          choice: [
            {
              action: { kind: "count_decrease", player: "self", amount: 2 },
              prompt: {
                label: "自分のカウントを2減らす",
                sourceText: "自分のカウントを2減らす。",
              },
            },
          ],
        },
      ],
    },
  ],
};
const lookups = {
  getCardDefinitionById: (id: string) =>
    id === source.cardNo ? source : undefined,
  getRegisteredMagicActions: buildMagicLookup([source]),
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
};
function initialState(): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ countValue: 5 }, { countValue: 5 }],
      cardInstances: [
        createCardInstance(source, {
          instanceId: "source",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    }),
    step: "main",
    turnNumber: 2,
    activePlayerId: "alice",
  };
}

it.each([
  { isAccelData: true },
  { isChangeData: true },
  { divineSkillIndex: 0 },
])("通常effectsと別の本文でも、解決中のtextRefを引用する: %j", (mode) => {
  const definition = {
    ...source,
    textLines: ["通常効果の本文", "相手のカウントを1減らせる。"],
  };
  const state = executeEffect({
    chainId: "test:step-prompt-perspective:195",
    state: initialState(),
    effect: {
      timing: { kind: "activated", mode: "main" },
      textRef: [1],
      steps: [
        {
          executionMode: "optional",
          chooser: "opponent",
          action: { kind: "count_decrease", player: "opponent", amount: 1 },
        },
      ],
    },
    sourceInstanceId: "source",
    actingPlayerId: "alice",
    ...mode,
    getCardDefinitionById: () => definition,
    getRegisteredTriggeredEffectActions: () => [],
  });
  expect(state.pendingStepOptionalChoice?.prompt).toEqual({
    label: "自分のカウントを1減らす",
    question: "自分のカウントを1減らしますか？",
    sourceText: "相手のカウントを1減らせる。",
  });
});

it("choice変種のchooserとpromptを任意確認にも引き継ぐ", () => {
  const original = source.effects![0]!;
  const step = original.steps[0]!;
  let state = executeEffect({
    chainId: "test:step-prompt-perspective:224",
    state: initialState(),
    effect: {
      ...original,
      steps: [
        {
          ...step,
          executionMode: "optional",
          chooser: "self",
          choice: [{ ...step.choice![0]!, chooser: "opponent" }],
        },
      ],
    },
    sourceInstanceId: "source",
    actingPlayerId: "alice",
    choiceIndex: 1,
    ...lookups,
  });
  expect(state.pendingStepOptionalChoice).toMatchObject({
    choosingPlayerId: "bob",
    prompt: {
      label: "相手のカウントを2減らす",
      question: "相手のカウントを2減らしますか？",
      sourceText: "自分のカウントを2減らす。",
    },
  });
  const execute = getLegalActions({
    state,
    actingPlayerId: "bob",
    ...lookups,
  }).find(
    (action) =>
      action.kind === "resolve_pending_step_optional_choice" &&
      action.choice === "execute"
  )!;
  state = applyLegalAction({ state, action: execute, ...lookups }).state;
  expect(state.pendingStepOptionalChoice).toBeNull();
  expect(state.players.map((player) => player.countValue)).toEqual([3, 5]);
});

for (const route of ["interpreter", "stack"] as const) {
  it(`${route}: 相手の選択肢とAPIラベルが一致し、選んだ側のカウントだけ減る`, () => {
    let state = initialState();
    if (route === "interpreter") {
      state = executeEffect({
        chainId: "test:step-prompt-perspective:268",
        state,
        effect: source.effects![0]!,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        promptUnresolvedChoice: true,
        ...lookups,
      });
    } else {
      const use = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...lookups,
      }).find((a) => a.kind === "use_magic")!;
      expect(use).toBeDefined();
      state = applyLegalAction({ state, action: use, ...lookups }).state;
      const pass = getLegalActions({
        state,
        actingPlayerId: "bob",
        ...lookups,
      }).find((a) => a.kind === "pass_stack")!;
      expect(pass).toBeDefined();
      state = applyLegalAction({ state, action: pass, ...lookups }).state;
    }
    expect(state.pendingStepChoice?.choosingPlayerId).toBe("bob");
    expect(state.pendingStepChoice?.choices.map((c) => c.label)).toEqual([
      "自分のカウントを1減らす",
      "相手のカウントを2減らす",
    ]);
    expect(state.pendingStepChoice?.choices[0]?.prompt?.sourceText).toBe(
      "相手のカウントを1減らす。"
    );
    const choices = getLegalActions({
      state,
      actingPlayerId: "bob",
      ...lookups,
    }).filter((a) => a.kind === "resolve_pending_step_choice");
    expect(choices.map((a) => a.choicePrompt?.label)).toEqual([
      "自分のカウントを1減らす",
      "相手のカウントを2減らす",
    ]);
    state = applyLegalAction({ state, action: choices[1]!, ...lookups }).state;
    expect(state.pendingStepChoice).toBeNull();
    expect(state.players.map((p) => p.countValue)).toEqual([3, 5]);
  });
}
