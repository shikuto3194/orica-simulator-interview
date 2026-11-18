#!/usr/bin/env node
/**
 * Unit tests for effect-level optionality detection.
 */

import {
  findCountZeroOptionalCountStepIssues,
  findEffectLevelOptionalityIssue,
  findRedundantRootStepOptionalityIssue,
} from "./effect-optionality-detector.mjs";

let pass = 0;
let fail = 0;

function check(label, cond) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  x ${label}`);
  }
}

const optionalDrawThenDiscard = {
  timing: { kind: "card_event", event: "summon" },
  steps: [
    {
      id: "drew",
      action: { kind: "draw", count: 2 },
      executionMode: "optional",
    },
    {
      action: { kind: "discard", player: "self", count: 2 },
      connector: "conditional_result",
    },
  ],
  textRef: [0, 1],
};

const optionalSingleDrawStepOnly = {
  timing: { kind: "game_event", event: "count_increase" },
  steps: [
    {
      action: { kind: "draw", count: 1 },
      executionMode: "optional",
    },
  ],
  textRef: [0],
};

check(
  "single optional sentence implemented only as step optional is missing effect-level optional",
  findEffectLevelOptionalityIssue(optionalSingleDrawStepOnly, [
    "自分のカウントが増えたとき、自分はデッキの上から1枚ドローできる。",
  ])?.kind === "effect_level_optional_missing"
);

check(
  "single optional sentence uses effect-level optional and keeps step mandatory",
  findEffectLevelOptionalityIssue(
    {
      ...optionalSingleDrawStepOnly,
      executionMode: "optional",
      steps: [{ action: { kind: "draw", count: 1 } }],
    },
    ["自分のカウントが増えたとき、自分はデッキの上から1枚ドローできる。"]
  ) === null
);

check(
  "optional first sentence + dependent mandatory follow-up is missing effect-level optional",
  findEffectLevelOptionalityIssue(optionalDrawThenDiscard, [
    "Lv1-Lv2『このスピリットの召喚時』",
    "自分はデッキの上から2枚ドローできる。ドロー後、自分は手札2枚を破棄する。",
  ])?.kind === "effect_level_optional_missing"
);

check(
  "effect.executionMode optional satisfies the rule",
  findEffectLevelOptionalityIssue(
    { ...optionalDrawThenDiscard, executionMode: "optional" },
    [
      "Lv1-Lv2『このスピリットの召喚時』",
      "自分はデッキの上から2枚ドローできる。ドロー後、自分は手札2枚を破棄する。",
    ]
  ) === null
);

check(
  "effect-level optional single root step should not also use step executionMode optional",
  findRedundantRootStepOptionalityIssue(
    { ...optionalSingleDrawStepOnly, executionMode: "optional" },
    ["自分のカウントが増えたとき、自分はデッキの上から1枚ドローできる。"]
  )?.kind === "root_step_optional_redundant"
);

check(
  "dependent later optional sentence keeps step optional but root step does not",
  findRedundantRootStepOptionalityIssue(
    {
      timing: { kind: "card_event", event: ["advent", "attack"] },
      executionMode: "optional",
      steps: [
        {
          id: "advent-vegeta",
          executionMode: "optional",
          action: { kind: "advent" },
        },
        {
          id: "draw-after-advent",
          connector: "sequential",
          executionMode: "optional",
          stepCondition: { kind: "ref_succeeded", stepId: "advent-vegeta" },
          action: { kind: "draw", count: 2 },
        },
      ],
      textRef: [0],
    },
    [
      "手札にある「ベジータ」1枚をこのスピリットの隣に【契約煌臨】できる。そうしたとき、自分はデッキの上から2枚ドローできる。",
    ]
  )?.kind === "root_step_optional_redundant"
);

check(
  "effect-level optional with a dependent later optional step accepts a mandatory root step",
  findRedundantRootStepOptionalityIssue(
    {
      timing: { kind: "card_event", event: ["advent", "attack"] },
      executionMode: "optional",
      steps: [
        {
          id: "advent-vegeta",
          action: { kind: "advent" },
        },
        {
          id: "draw-after-advent",
          connector: "sequential",
          executionMode: "optional",
          stepCondition: { kind: "ref_succeeded", stepId: "advent-vegeta" },
          action: { kind: "draw", count: 2 },
        },
      ],
      textRef: [0],
    },
    [
      "手札にある「ベジータ」1枚をこのスピリットの隣に【契約煌臨】できる。そうしたとき、自分はデッキの上から2枚ドローできる。",
    ]
  ) === null
);

check(
  "root step optional is not flagged when a later step is independent",
  findRedundantRootStepOptionalityIssue(
    {
      timing: { kind: "card_event", event: "attack" },
      executionMode: "optional",
      steps: [
        {
          id: "first",
          executionMode: "optional",
          action: { kind: "draw", count: 1 },
        },
        {
          connector: "sequential",
          action: { kind: "destroy" },
        },
      ],
      textRef: [0],
    },
    [
      "自分はデッキの上から1枚ドローできる。その後、相手のスピリット1体を破壊する。",
    ]
  ) === null
);

const optionalRootThenAfterTriggers = {
  timing: { kind: "card_event", event: "attack" },
  steps: [
    {
      id: "bounce",
      executionMode: "optional",
      action: { kind: "bounce" },
    },
    {
      id: "follow-up",
      connector: "after_triggers",
      action: { kind: "draw", count: 1 },
    },
  ],
  textRef: [0],
};

check(
  "after_triggers alone does not make a mandatory follow-up depend on the optional root",
  findEffectLevelOptionalityIssue(optionalRootThenAfterTriggers, [
    "相手のスピリット1体を手札に戻せる。この効果発揮後、自分はデッキから1枚ドローする。",
  ]) === null
);

check(
  "independent optional after_triggers keeps the root optional even when its own later steps depend on it",
  findRedundantRootStepOptionalityIssue(
    {
      ...optionalRootThenAfterTriggers,
      executionMode: "optional",
      steps: [
        optionalRootThenAfterTriggers.steps[0],
        {
          ...optionalRootThenAfterTriggers.steps[1],
          executionMode: "optional",
        },
        {
          stepCondition: { kind: "ref_succeeded", stepId: "follow-up" },
          action: { kind: "discard", player: "self", count: 1 },
        },
      ],
    },
    [
      "相手のスピリット1体を手札に戻せる。この効果発揮後、自分はデッキから1枚ドローできる。ドロー後、手札1枚を破棄する。",
    ]
  ) === null
);

for (const stepCondition of [
  { kind: "ref_succeeded", stepId: "bounce" },
  {
    kind: "and",
    conditions: [
      { kind: "ref_succeeded", stepId: "bounce" },
      { kind: "ref_count", stepId: "bounce", min: 1 },
    ],
  },
]) {
  const dependentAfterTriggers = {
    ...optionalRootThenAfterTriggers,
    steps: [
      optionalRootThenAfterTriggers.steps[0],
      { ...optionalRootThenAfterTriggers.steps[1], stepCondition },
    ],
  };
  const dependentText = [
    "相手のスピリット1体を手札に戻せる。戻したとき、この効果発揮後、自分はデッキから1枚ドローする。",
  ];
  check(
    `after_triggers with explicit ${stepCondition.kind} result condition still needs effect-level optional`,
    findEffectLevelOptionalityIssue(dependentAfterTriggers, dependentText)
      ?.kind === "effect_level_optional_missing"
  );
  check(
    `after_triggers with explicit ${stepCondition.kind} result condition still makes root optional redundant`,
    findRedundantRootStepOptionalityIssue(
      { ...dependentAfterTriggers, executionMode: "optional" },
      dependentText
    )?.kind === "root_step_optional_redundant"
  );
}

check(
  "しなければ gate remains mandatory because decline enables the later mandatory step",
  findEffectLevelOptionalityIssue(
    {
      timing: { kind: "game_event", event: "targeted" },
      steps: [
        {
          id: "payment",
          action: { kind: "count_decrease", amount: 4 },
          executionMode: "optional",
        },
        {
          action: { kind: "effect_immunity" },
          connector: "unless_previous_succeeded",
        },
      ],
      textRef: [0],
    },
    [
      "このネクサスが相手の効果の対象になるとき、相手が相手のカウント-4しなければ、その効果を受けない。",
    ]
  ) === null
);

check(
  "mandatory text with a min:0 implementation detail is not flagged",
  findEffectLevelOptionalityIssue(
    {
      timing: { kind: "phase", step: "start", whose: "either" },
      steps: [
        {
          id: "move",
          action: { kind: "core_move", amount: { min: 0, max: 1 } },
        },
        {
          action: { kind: "core_move", amount: 1 },
          connector: "after_triggers",
          stepCondition: { kind: "ref_left_field", stepId: "move" },
        },
      ],
      textRef: [0],
    },
    [
      "フィールド/リザーブのコア1個をボイドに置く。この効果で消滅したスピリット1つにつき、ボイドからコア1個を置く。",
    ]
  ) === null
);

check(
  "possible-form variable amount with dependent mandatory follow-up is flagged",
  findEffectLevelOptionalityIssue(
    {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          id: "cd",
          action: { kind: "count_decrease", amount: { min: 0 } },
          executionMode: "optional",
        },
        {
          action: { kind: "cost_modify" },
          connector: "conditional_result",
        },
      ],
      textRef: [0],
    },
    [
      "自分のカウントを好きなだけ減らせる。そうしたとき、減らしたカウント1につき、相手のカードのコストを+1する。",
    ]
  )?.kind === "effect_level_optional_missing"
);

check(
  "up-to-N mandatory wording is not effect-level optional by itself",
  findEffectLevelOptionalityIssue(
    {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          id: "destroy",
          action: {
            kind: "destroy",
            target: { kind: "filter", count: { min: 0, max: 2 } },
          },
        },
        {
          action: { kind: "draw", count: 3 },
          stepCondition: { kind: "ref_has_match", stepId: "destroy" },
        },
      ],
      textRef: [0],
    },
    [
      "創界神ネクサス2つまでを破壊する。この効果で「ヴァース」を破壊したとき、自分はデッキの上から3枚ドローする。",
    ]
  ) === null
);

check(
  "mandatory choice followed by an optional up-to-N step is not first-sentence optional",
  findEffectLevelOptionalityIssue(
    {
      timing: { kind: "burst", trigger: { kind: "attack_finished" } },
      steps: [
        {
          action: { kind: "summon", target: { kind: "self" } },
          choice: [
            { action: { kind: "quartz_set", target: { kind: "self" } } },
          ],
        },
        {
          id: "exclude",
          action: {
            kind: "remove_from_game",
            target: { kind: "filter", count: { min: 0, max: 2 } },
          },
          connector: "sequential",
        },
        {
          action: {
            kind: "summon",
            target: { kind: "ref", stepId: "exclude" },
          },
          connector: "after_triggers",
        },
      ],
      textRef: [0],
    },
    [
      "このカードを召喚するか、セットする。その後、スピリット2体までを除外する。この効果発揮後、除外した対象を召喚する。",
    ]
  ) === null
);

check(
  "activated effects are already opt-in by declaration",
  findEffectLevelOptionalityIssue(
    {
      ...optionalDrawThenDiscard,
      timing: { kind: "activated", mode: "main" },
    },
    [
      "メイン",
      "自分はデッキの上から2枚ドローできる。ドロー後、自分は手札2枚を破棄する。",
    ]
  ) === null
);

const countZeroLine =
  "自分はデッキの下から1枚ドローできる。自分のカウント0のとき、自分のカウント+1できる。";

check(
  "count0 optional count+ in a multi-step effect requires step executionMode optional",
  findCountZeroOptionalCountStepIssues(
    {
      timing: { kind: "card_event", event: "summon" },
      executionMode: "optional",
      steps: [
        { action: { kind: "draw", count: 1, position: "bottom" } },
        {
          action: { kind: "count_increase", player: "self", amount: 1 },
          condition: [{ kind: "count_value", player: "self", max: 0 }],
          connector: "simultaneous",
        },
      ],
      textRef: [0],
    },
    [countZeroLine]
  ).some(
    (issue) => issue.kind === "count_zero_optional_count_step_missing_optional"
  )
);

check(
  "count0 optional count+ step requires prompt sourceText wiring",
  findCountZeroOptionalCountStepIssues(
    {
      timing: { kind: "card_event", event: "summon" },
      executionMode: "optional",
      steps: [
        { action: { kind: "draw", count: 1 } },
        {
          action: { kind: "count_increase", player: "self", amount: 1 },
          condition: [{ kind: "count_value", player: "self", max: 0 }],
          connector: "simultaneous",
          executionMode: "optional",
        },
      ],
      textRef: [0],
    },
    [countZeroLine]
  ).some(
    (issue) =>
      issue.kind === "count_zero_optional_count_step_missing_prompt_source"
  )
);

check(
  "count0 optional count+ with step optional and prompt sourceText passes",
  findCountZeroOptionalCountStepIssues(
    {
      timing: { kind: "card_event", event: "summon" },
      executionMode: "optional",
      steps: [
        { action: { kind: "draw", count: 1 } },
        {
          action: { kind: "count_increase", player: "self", amount: 1 },
          condition: [{ kind: "count_value", player: "self", max: 0 }],
          connector: "simultaneous",
          executionMode: "optional",
          prompt: {
            sourceText: "自分のカウント0のとき、自分のカウント+1できる。",
          },
        },
      ],
      textRef: [0],
    },
    [countZeroLine]
  ).length === 0
);

check(
  "single-step count0 optional count+ can rely on effect-level optional",
  findCountZeroOptionalCountStepIssues(
    {
      timing: { kind: "card_event", event: "summon" },
      executionMode: "optional",
      steps: [
        {
          action: { kind: "count_increase", player: "self", amount: 1 },
          condition: [{ kind: "count_value", player: "self", max: 0 }],
        },
      ],
      textRef: [0],
    },
    ["自分のカウント0のとき、自分のカウント+1できる。"]
  ).length === 0
);

console.log(`\n[effect-optionality-detector] ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
