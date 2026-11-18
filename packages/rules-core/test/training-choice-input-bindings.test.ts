import { describe, expect, it } from "vitest";
import {
  buildAiObservation,
  buildEncodedTrainingReplayBatch,
  buildPolicyValueInferenceInput,
  buildTrainingReplaySample,
  createCardInstance,
  createEmptyGameState,
  createTinyPolicyValueNetwork,
  recomposeCoreSourceAllocationLegalAction,
  recomposeTrashDistributionLegalAction,
  type CardDefinition,
  type Engine,
  type TrainingDecisionNode,
  type TrainingTraceSmokeFrame,
} from "../src";
import {
  CHOICE_INPUT_BINDING_FIELDS,
  CHOICE_INPUT_CONTAINERS,
  CHOICE_INPUT_DESTINATIONS,
  CHOICE_INPUT_OWNERS,
} from "../src/training-choice-bindings";
import { coreSourceAllocationChoices } from "../src/action-input-choices";
import { coreContainerId } from "../src/core/core-container-id";

const card: CardDefinition = {
  cardNo: "INPUT-BINDING",
  name: "Input binding",
  printedCategory: "spirit",
  cost: 2,
  colors: ["red"],
  reductionSymbols: [],
  symbolColors: ["red"],
  levelDefs: [
    { level: 1, requiredCores: 1, bp: 1000 },
    { level: 2, requiredCores: 3, bp: 5000 },
  ],
  keywordTags: [],
  textLines: [],
};
const engine: Engine = {
  cards: [card],
  getCardDefinitionById: (id) => (id === card.cardNo ? card : undefined),
  lookups: {} as Engine["lookups"],
};

function fixture(
  options: NonNullable<
    TrainingDecisionNode["choices"][number]["applyOptions"]
  >[],
  playerIds: [string, string] = ["alice", "bob"]
) {
  const state = createEmptyGameState({
    playerIds,
    cardInstances: [
      createCardInstance(card, {
        instanceId: "a",
        ownerPlayerId: playerIds[0],
        zone: "field",
        cores: 1,
      }),
      createCardInstance(card, {
        instanceId: "b",
        ownerPlayerId: playerIds[0],
        zone: "field",
        cores: 4,
      }),
      createCardInstance(card, {
        instanceId: "hidden",
        ownerPlayerId: playerIds[1],
        zone: "hand",
      }),
    ],
  });
  const node: TrainingDecisionNode = {
    nodeId: "input",
    kind: "action_input",
    actingPlayerId: playerIds[0],
    fields: [],
    truncated: false,
    choices: options.map((applyOptions, i) => ({
      choiceId: `choice-${i}`,
      label: `label-${i}`,
      applyOptions,
    })),
  };
  const inputFor = (decision = node, current = state) =>
    buildPolicyValueInferenceInput({
      state: current,
      node: decision,
      engine,
      maxCards: 8,
      maxKnownDeckEntries: 1,
    });
  const input = inputFor();
  const batchFor = (decision = node) => {
    const observation = buildAiObservation({
      state,
      viewpointPlayerId: decision.actingPlayerId,
      mode: "player",
      getCardDefinitionById: engine.getCardDefinitionById,
    });
    const frame: TrainingTraceSmokeFrame = {
      frameIndex: 0,
      stateHash: "state",
      observationHash: "observation",
      state,
      observation,
      node: decision,
      selected: {
        step: 0,
        nodeKind: decision.kind,
        actingPlayerId: decision.actingPlayerId,
        choiceId: decision.choices[0]!.choiceId,
        choiceCount: decision.choices.length,
        fields: [],
        truncated: false,
      },
    };
    return buildEncodedTrainingReplayBatch(
      [
        buildTrainingReplaySample(
          { outcome: "natural", winner: playerIds[0] },
          frame,
          { gameId: "input-binding", gameIndex: 0, seed: 9 }
        ),
      ],
      {
        maxCards: 8,
        maxKnownDeckEntries: 1,
        maxChoices: options.length + 1,
        cardVocabulary: new Map([[card.cardNo, 1]]),
      }
    );
  };
  return { state, node, input, inputFor, batchFor };
}

function isolatedNetwork(
  input: ReturnType<typeof buildPolicyValueInferenceInput>
) {
  const initial = createTinyPolicyValueNetwork({ seed: 31, hiddenDim: 4 });
  initial.predict(input);
  const checkpoint = initial.exportCheckpoint();
  const p = checkpoint.params;
  for (const matrix of [
    p.globalW,
    p.cardW,
    p.knownDeckW,
    p.choiceW,
    p.sourceW,
    p.targetW,
  ])
    matrix.forEach((row) => row.fill(0));
  p.stateBias.fill(0);
  p.choiceBias.fill(0);
  p.valueHead.fill(0);
  p.valueBias = p.policyBias = 0;
  p.policyHead.fill(1);
  return createTinyPolicyValueNetwork({ checkpoint });
}

function forward(input: ReturnType<typeof buildPolicyValueInferenceInput>) {
  return {
    observation: input.observation,
    choiceFeatures: input.choices.map((x) => x.feats),
    choiceSourceTokenIndices: input.choices.map(
      (x) => x.action.sourceTokenIndex
    ),
    choiceTargetTokenIndices: input.choices.map(
      (x) => x.action.targetTokenIndex
    ),
    choiceInputBindings: input.choices.map((x) => x.inputBindings),
    choiceMask: input.choiceMask,
  };
}
function probabilities(logits: readonly number[]) {
  const max = Math.max(...logits);
  const exp = logits.map((x) => Math.exp(x - max));
  const total = exp.reduce((a, b) => a + b, 0);
  return exp.map((x) => x / total);
}

describe("concrete choice input bindings", () => {
  it.each([
    ["targets", [{ targetInstanceIds: ["a"] }, { targetInstanceIds: ["b"] }]],
    [
      "target order",
      [{ targetInstanceIds: ["a", "b"] }, { targetInstanceIds: ["b", "a"] }],
    ],
    [
      "payment source",
      [
        { paymentSources: [{ kind: "card", instanceId: "a", amount: 1 }] },
        { paymentSources: [{ kind: "card", instanceId: "b", amount: 1 }] },
      ],
    ],
    [
      "payment quantity",
      [
        { paymentSources: [{ kind: "card", instanceId: "b", amount: 1 }] },
        { paymentSources: [{ kind: "card", instanceId: "b", amount: 2 }] },
      ],
    ],
    [
      "payment container",
      [
        { paymentSources: [{ kind: "reserve", amount: 1 }] },
        { paymentSources: [{ kind: "card", instanceId: "a", amount: 1 }] },
      ],
    ],
    [
      "physical core",
      [
        { paymentSources: [{ kind: "card", instanceId: "b", amount: 1 }] },
        {
          paymentSources: [
            { kind: "card", instanceId: "b", amount: 1, includeSoulCore: true },
          ],
        },
      ],
    ],
    [
      "payment destination",
      [
        { paymentSources: [{ kind: "card", instanceId: "b", amount: 1 }] },
        {
          paymentSources: [
            { kind: "card", instanceId: "b", amount: 1, destination: "void" },
          ],
        },
      ],
    ],
    [
      "allocation pairing",
      [
        { coreDistributionAllocations: { a: 1, b: 2 } },
        { coreDistributionAllocations: { a: 2, b: 1 } },
      ],
    ],
    [
      "allocation source",
      [
        { coreDistributionSourceAllocations: { reserve: 1 } },
        { coreDistributionSourceAllocations: { "field:a": 1 } },
      ],
    ],
  ] as const)(
    "keeps %s distinct through live, replay, head update, reorder and restore",
    (_name, options) => {
      const { input, node, inputFor, batchFor } = fixture(
        structuredClone(options) as Parameters<typeof fixture>[0]
      );
      expect(input.choices[0]!.feats).toEqual(input.choices[1]!.feats);
      const network = isolatedNetwork(input);
      const before = network.predict(input);
      expect(
        Math.abs(before.policyLogits[0]! - before.policyLogits[1]!)
      ).toBeGreaterThan(1e-8);
      const batch = batchFor();
      expect(batch.choiceInputBindings[0]!.slice(0, 2)).toEqual(
        input.choices.map((x) => x.inputBindings)
      );
      const replay = network.forward({
        observation: batch.observations[0]!,
        choiceFeatures: batch.choiceFeatures[0]!.slice(0, 2),
        choiceSourceTokenIndices: batch.choiceSourceTokenIndices[0]!.slice(
          0,
          2
        ),
        choiceTargetTokenIndices: batch.choiceTargetTokenIndices[0]!.slice(
          0,
          2
        ),
        choiceInputBindings: batch.choiceInputBindings[0]!.slice(0, 2),
      });
      expect(replay.policyLogits).toEqual(before.policyLogits);
      const reordered = inputFor({
        ...node,
        choices: [...node.choices]
          .reverse()
          .map((x, i) => ({ ...x, choiceId: `new-${i}`, label: "new label" })),
      });
      const assertReordered = (model: typeof network) => {
        const original = model.predict(input).policyLogits;
        const reverse = model.predict(reordered).policyLogits;
        expect(reverse).toEqual([...original].reverse());
        expect(probabilities(reverse)).toEqual(
          [...probabilities(original)].reverse()
        );
      };
      assertReordered(network);
      const updated = network.trainBatch(batch, {
        epochs: 1,
        learningRate: 0.01,
      });
      expect(updated.appliedUpdates).toBe(1);
      assertReordered(network);
      const restored = createTinyPolicyValueNetwork({
        checkpoint: network.exportCheckpoint(),
      });
      assertReordered(restored);
      expect(restored.predict(input)).toEqual(network.predict(input));
    }
  );

  it("preserves card-token reorder and visible ID renaming without using hidden identity", () => {
    const { input, state, node, inputFor } = fixture([
      { coreDistributionAllocations: { a: 1, b: 2 } },
      { coreDistributionAllocations: { b: 2, a: 1 } },
    ]);
    const network = isolatedNetwork(input);
    expect(network.predict(input).policyLogits[0]).toBe(
      network.predict(input).policyLogits[1]
    );
    const reordered = structuredClone(input);
    reordered.observation.cards.reverse();
    reordered.observation.cardMask.reverse();
    reordered.observation.cardInstanceIds.reverse();
    reordered.choices.forEach((choice) =>
      choice.inputBindings.forEach((binding) => {
        if (binding.tokenIndex >= 0)
          binding.tokenIndex = 7 - binding.tokenIndex;
      })
    );
    expect(network.predict(reordered)).toEqual(network.predict(input));
    const renamed = structuredClone(state);
    renamed.cardInstances.forEach((c) => {
      if (c.instanceId === "hidden") {
        c.instanceId = "secret-renamed";
        c.definitionId = "unrelated-secret";
      } else c.instanceId = `renamed-${c.instanceId}`;
    });
    const renamedNode = {
      ...node,
      choices: node.choices.map((x) => ({
        ...x,
        applyOptions: {
          coreDistributionAllocations: Object.fromEntries(
            Object.entries(x.applyOptions!.coreDistributionAllocations!).map(
              ([k, v]) => [`renamed-${k}`, v]
            )
          ),
        },
      })),
    };
    expect(network.predict(inputFor(renamedNode, renamed))).toEqual(
      network.predict(input)
    );
  });

  it("rejects missing or masked references, invalid amounts, malformed bindings and old checkpoints", () => {
    const { input, node, inputFor } = fixture([{ targetInstanceIds: ["a"] }]);
    expect(() =>
      inputFor({
        ...node,
        choices: [
          {
            choiceId: "bad",
            label: "bad",
            applyOptions: { targetInstanceIds: ["hidden"] },
          },
        ],
      })
    ).toThrow("observed card");
    expect(() =>
      inputFor({
        ...node,
        choices: [
          {
            choiceId: "bad",
            label: "bad",
            applyOptions: { coreDistributionAllocations: { a: NaN } },
          },
        ],
      })
    ).toThrow("amount");
    const network = isolatedNetwork(input);
    const bad = forward(structuredClone(input));
    bad.choiceInputBindings[0]![0]!.amount = Infinity;
    expect(() => network.forward(bad)).toThrow("binding");
    const masked = forward(structuredClone(input));
    masked.observation.cardMask[masked.choiceInputBindings[0]![0]!.tokenIndex] =
      0;
    expect(() => network.forward(masked)).toThrow("visible card");
    const old = network.exportCheckpoint();
    Object.assign(old, { schemaVersion: 2 });
    expect(() => createTinyPolicyValueNetwork({ checkpoint: old })).toThrow(
      "unsupported"
    );
    const checkpoint = network.exportCheckpoint();
    checkpoint.params.inputW[0]![0] = NaN;
    expect(() => createTinyPolicyValueNetwork({ checkpoint })).toThrow(
      "finite"
    );
  });

  it("keeps the parent action source for action-input choices", () => {
    const { node, inputFor } = fixture([{ targetInstanceIds: ["b"] }]);
    const input = inputFor({
      ...node,
      action: {
        kind: "attack",
        actionId: "parent",
        can: true,
        reason: "",
        actingPlayerId: "alice",
        sourceInstanceId: "a",
        sourceDefinitionId: card.cardNo,
        sourceCardNo: card.cardNo,
        battleEntityId: "a",
      },
    });
    expect(
      input.observation.cardInstanceIds[
        input.choices[0]!.action.sourceTokenIndex
      ]
    ).toBe("a");
  });

  it("canonicalizes split and reordered payment entries, and refuses legacy encoded batches before updating", () => {
    const { input, batchFor } = fixture([
      {
        paymentSources: [
          { kind: "reserve", amount: 1 },
          { kind: "card", instanceId: "b", amount: 2 },
          { kind: "reserve", amount: 2 },
        ],
      },
      {
        paymentSources: [
          { kind: "reserve", amount: 3 },
          { kind: "card", instanceId: "b", amount: 2 },
        ],
      },
    ]);
    const network = isolatedNetwork(input);
    expect(network.predict(input).policyLogits[0]).toBe(
      network.predict(input).policyLogits[1]
    );
    const old = batchFor();
    Object.assign(old, { schemaVersion: 1 });
    const checkpoint = network.exportCheckpoint();
    expect(() => network.trainBatch(old)).toThrow("unsupported encoded replay");
    expect(network.exportCheckpoint()).toEqual(checkpoint);
    const missing = batchFor();
    Reflect.deleteProperty(missing, "choiceInputBindings");
    expect(() => network.trainBatch(missing)).toThrow(
      "unsupported encoded replay"
    );
    expect(network.exportCheckpoint()).toEqual(checkpoint);
  });

  it("records role and container domains in the checkpoint schema", () => {
    const { input } = fixture([
      { paymentSources: [{ kind: "reserve", amount: 2 }] },
    ]);
    const schema = JSON.parse(
      isolatedNetwork(input).exportCheckpoint()
        .trainingChoiceFeatureSchemaFingerprint!
    );
    expect(schema.inputBindings.fields).toEqual(CHOICE_INPUT_BINDING_FIELDS);
    expect(schema.inputBindings.containers).toEqual(CHOICE_INPUT_CONTAINERS);
    expect(schema.inputBindings.destinations).toEqual(
      CHOICE_INPUT_DESTINATIONS
    );
    expect(schema.inputBindings.owners).toEqual(CHOICE_INPUT_OWNERS);
  });

  it.each(["alice", "bob"])(
    "encodes legal reserve-source choices for %s through replay, update, restore and ID renaming",
    (actor) => {
      const build = (players: [string, string], actorIndex: number) => {
        const f = fixture(
          players.map((id) => ({
            coreSourceAllocations: { [`reserve:${id}`]: 1 },
          })),
          players
        );
        const action = {
          kind: "resolve_core_source_allocation" as const,
          actionId: "source-input",
          can: true as const,
          reason: "pending_core_source_allocation",
          actingPlayerId: players[actorIndex]!,
          pendingId: "source-input",
          requiredTotal: 1,
          toKind: "field_card",
          candidates: players.map((id) => ({
            instanceId: coreContainerId({ kind: "reserve", playerId: id }),
            available: 1,
            normalAvailable: 1,
          })),
        };
        const node = {
          ...f.node,
          actingPlayerId: action.actingPlayerId,
          action,
          choices: coreSourceAllocationChoices(action, 8).values.map(
            (applyOptions, i) => ({
              choiceId: `source-${i}`,
              label: "source",
              applyOptions,
            })
          ),
        };
        return { ...f, node, action, input: f.inputFor(node) };
      };
      const actorIndex = actor === "alice" ? 0 : 1;
      const f = build(["alice", "bob"], actorIndex);
      const network = isolatedNetwork(f.input);
      expect(f.input.choices).toHaveLength(2);
      expect(f.input.choices[0]!.feats).toEqual(f.input.choices[1]!.feats);
      expect(
        new Set(f.input.choices.map((c) => c.inputBindings[0]!.ownerIndex))
      ).toEqual(new Set([1, 2]));
      const before = network.predict(f.input);
      expect(
        Math.abs(before.policyLogits[0]! - before.policyLogits[1]!)
      ).toBeGreaterThan(1e-8);
      const renamed = build(["public-player-x", "public-player-y"], actorIndex);
      expect(network.predict(renamed.input)).toEqual(before);
      const ownContainer = { kind: "reserve" as const, playerId: actor };
      const legacyPayload = recomposeCoreSourceAllocationLegalAction([
        {
          kind: "normal",
          from: ownContainer,
          to: { kind: "card", instanceId: "a" },
          amount: 1,
          purpose: "core_source_allocation",
        },
      ]);
      expect(legacyPayload.coreSourceAllocations).toEqual({ reserve: 1 });
      const legacyAction = {
        ...f.action,
        candidates: f.action.candidates.map((candidate) => ({
          ...candidate,
          instanceId:
            candidate.instanceId === coreContainerId(ownContainer)
              ? "reserve"
              : candidate.instanceId,
        })),
      };
      const legacyNode = {
        ...f.node,
        action: legacyAction,
        choices: coreSourceAllocationChoices(legacyAction, 8).values.map(
          (applyOptions, i) => ({
            choiceId: `legacy-${i}`,
            label: "source",
            applyOptions,
          })
        ),
      };
      const legacyInput = f.inputFor(legacyNode);
      const batch = f.batchFor(f.node);
      expect(batch.valueTargets[0]).toBe(actor === "alice" ? 1 : -1);
      const replay = () =>
        network.forward({
          observation: batch.observations[0]!,
          choiceFeatures: batch.choiceFeatures[0]!.slice(0, 2),
          choiceSourceTokenIndices: batch.choiceSourceTokenIndices[0]!.slice(
            0,
            2
          ),
          choiceTargetTokenIndices: batch.choiceTargetTokenIndices[0]!.slice(
            0,
            2
          ),
          choiceInputBindings: batch.choiceInputBindings[0]!.slice(0, 2),
        });
      expect(replay().policyLogits).toEqual(before.policyLogits);
      const reversed = f.inputFor({
        ...f.node,
        choices: [...f.node.choices].reverse(),
      });
      const check = (model: typeof network) => {
        const prediction = model.predict(f.input);
        expect(model.predict(legacyInput)).toEqual(prediction);
        expect(model.predict(renamed.input)).toEqual(prediction);
        expect(model.predict(reversed).policyLogits).toEqual(
          [...prediction.policyLogits].reverse()
        );
        expect(probabilities(model.predict(reversed).policyLogits)).toEqual(
          [...probabilities(prediction.policyLogits)].reverse()
        );
      };
      check(network);
      expect(
        network.trainBatch(batch, { epochs: 1, learningRate: 0.01 })
          .appliedUpdates
      ).toBe(1);
      expect(replay().policyLogits).toEqual(
        network.predict(f.input).policyLogits
      );
      check(network);
      check(
        createTinyPolicyValueNetwork({ checkpoint: network.exportCheckpoint() })
      );
    }
  );

  it.each(["reserve", "trash", "life", "void"] as const)(
    "shares the container codec for %s core-source adapter payloads",
    (kind) => {
      const source = { kind, playerId: "bob" };
      const id = coreContainerId(source);
      const payload = recomposeCoreSourceAllocationLegalAction(
        [
          {
            kind: "normal",
            from: source,
            to: { kind: "card", instanceId: "a" },
            amount: 1,
            purpose: "core_source_allocation",
          },
        ],
        { [id]: id }
      );
      const { input } = fixture([payload]);
      const binding = input.choices[0]!.inputBindings[0]!;
      expect(binding.containerIndex).toBe(
        CHOICE_INPUT_CONTAINERS.indexOf(kind)
      );
      expect(binding.ownerIndex).toBe(2);
      expect(binding.tokenIndex).toBe(-1);
      expect(isolatedNetwork(input).predict(input).policyLogits).toHaveLength(
        1
      );
    }
  );

  it("accepts the real single-void recompose payload through live/replay and keeps soul void invalid", () => {
    const payload = (kind: "void" | "reserve") =>
      recomposeTrashDistributionLegalAction([
        {
          kind: "normal",
          from: { kind, playerId: "alice" },
          to: { kind: "card", instanceId: "a" },
          amount: 2,
          purpose: "trash_distribution",
        },
      ]);
    const fromVoid = payload("void");
    expect(fromVoid.coreDistributionSourceAllocations).toEqual({ void: 2 });
    const f = fixture([fromVoid, payload("reserve")]);
    expect(f.input.choices[0]!.feats).toEqual(f.input.choices[1]!.feats);
    const network = isolatedNetwork(f.input);
    const batch = f.batchFor();
    expect(batch.choiceInputBindings[0]!.slice(0, 2)).toEqual(
      f.input.choices.map((c) => c.inputBindings)
    );
    const logits = network.predict(f.input).policyLogits;
    expect(Math.abs(logits[0]! - logits[1]!)).toBeGreaterThan(1e-8);
    const readReplay = () =>
      network.forward({
        observation: batch.observations[0]!,
        choiceFeatures: batch.choiceFeatures[0]!.slice(0, 2),
        choiceSourceTokenIndices: batch.choiceSourceTokenIndices[0]!.slice(
          0,
          2
        ),
        choiceTargetTokenIndices: batch.choiceTargetTokenIndices[0]!.slice(
          0,
          2
        ),
        choiceInputBindings: batch.choiceInputBindings[0]!.slice(0, 2),
      }).policyLogits;
    expect(readReplay()).toEqual(logits);
    expect(network.trainBatch(batch, { epochs: 1 }).appliedUpdates).toBe(1);
    expect(readReplay()).toEqual(network.predict(f.input).policyLogits);
    expect(
      createTinyPolicyValueNetwork({
        checkpoint: network.exportCheckpoint(),
      }).predict(f.input)
    ).toEqual(network.predict(f.input));
    expect(() =>
      fixture([{ coreDistributionSoulCoreSourceAllocations: { void: 1 } }])
    ).toThrow("unsupported choice input binding source");
  });

  it("rejects pre-owner binding fingerprints and batches before updating", () => {
    const f = fixture([{ coreSourceAllocations: { reserve: 1 } }]);
    const network = isolatedNetwork(f.input);
    const saved = network.exportCheckpoint();
    const old = structuredClone(saved);
    const schema = JSON.parse(old.trainingChoiceFeatureSchemaFingerprint!);
    schema.inputBindings.version = 1;
    Reflect.deleteProperty(schema.inputBindings, "owners");
    old.trainingChoiceFeatureSchemaFingerprint = JSON.stringify(schema);
    expect(() => createTinyPolicyValueNetwork({ checkpoint: old })).toThrow(
      "schema"
    );
    const batch = f.batchFor();
    Reflect.deleteProperty(batch.choiceInputBindings[0]![0]![0]!, "ownerIndex");
    expect(() => network.trainBatch(batch)).toThrow("category");
    expect(network.exportCheckpoint()).toEqual(saved);
  });

  it.each(["card", "reserve"] as const)(
    "rejects incompatible ownership on a %s binding before live/replay inference or training",
    (kind) => {
      const f = fixture([
        kind === "card"
          ? { targetInstanceIds: ["a"] }
          : { coreSourceAllocations: { reserve: 1 } },
      ]);
      const network = isolatedNetwork(f.input);
      const saved = network.exportCheckpoint();
      const ownerIndex = kind === "card" ? 1 : 0;
      const live = structuredClone(f.input);
      live.choices[0]!.inputBindings[0]!.ownerIndex = ownerIndex;
      expect(() => network.predict(live)).toThrow(
        "invalid choice input binding"
      );
      const batch = f.batchFor();
      batch.choiceInputBindings[0]![0]![0]!.ownerIndex = ownerIndex;
      expect(() =>
        network.forward({
          observation: batch.observations[0]!,
          choiceFeatures: batch.choiceFeatures[0]!,
          choiceSourceTokenIndices: batch.choiceSourceTokenIndices[0]!,
          choiceTargetTokenIndices: batch.choiceTargetTokenIndices[0]!,
          choiceInputBindings: batch.choiceInputBindings[0]!,
          choiceMask: batch.choiceMask[0]!,
        })
      ).toThrow("invalid choice input binding");
      expect(() => network.trainBatch(batch)).toThrow(
        "invalid choice input binding"
      );
      expect(network.exportCheckpoint()).toEqual(saved);
    }
  );

  it("keeps observed card IDs opaque when their spelling resembles a player-zone ID", () => {
    const f = fixture([{ coreSourceAllocations: { a: 1, b: 2 } }]);
    const network = isolatedNetwork(f.input);
    const renamed = structuredClone(f.state);
    const names: Record<string, string> = { a: "life:bob", b: "reserve:alice" };
    for (const instance of renamed.cardInstances)
      instance.instanceId = names[instance.instanceId] ?? instance.instanceId;
    const input = f.inputFor(
      {
        ...f.node,
        choices: [
          {
            choiceId: "renamed",
            label: "renamed",
            applyOptions: {
              coreSourceAllocations: { "life:bob": 1, "reserve:alice": 2 },
            },
          },
        ],
      },
      renamed
    );
    expect(input.choices[0]!.inputBindings).toEqual(
      f.input.choices[0]!.inputBindings
    );
    expect(network.predict(input)).toEqual(network.predict(f.input));
  });

  it("takes distribution-source ownership from the public parent action instead of the chooser", () => {
    const f = fixture([{ coreDistributionSourceAllocations: { reserve: 1 } }]);
    const action = {
      kind: "resolve_pending_core_distribution" as const,
      actionId: "distribution",
      can: true as const,
      reason: "pending_core_distribution",
      actingPlayerId: "alice",
      pendingId: "distribution",
      candidates: [{ instanceId: "a", definitionId: card.cardNo }],
      totalNormalCores: 1,
      hasSoulCore: false,
      fromKind: "reserve" as const,
      fromPlayerId: "bob",
      toPlayerId: "alice",
    };
    const opposing = f.inputFor({ ...f.node, action });
    const own = f.inputFor({
      ...f.node,
      action: { ...action, fromPlayerId: "alice" },
    });
    expect(opposing.choices[0]!.inputBindings[0]!.ownerIndex).toBe(2);
    expect(own.choices[0]!.inputBindings[0]!.ownerIndex).toBe(1);
    expect(opposing.choices[0]!.feats).toEqual(own.choices[0]!.feats);
    const network = isolatedNetwork(opposing);
    expect(network.predict(opposing).policyLogits).not.toEqual(
      network.predict(own).policyLogits
    );
  });
});
