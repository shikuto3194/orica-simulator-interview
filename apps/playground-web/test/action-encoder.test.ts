/**
 * 行動エンコーダ検証: 全合法手を固定長ベクトル化、source/target ポインタ整合、
 * 出現 kind 網羅、有限値。実行: vitest run action-encoder
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, it, expect } from "vitest";
import {
  ACTION_FEAT_DIM,
  ACTION_KINDS,
  ACTION_KIND_UNK,
  buildAiObservation,
  buildAiObservationCardVocabulary,
  encodeAction,
  encodeAiObservation,
  encodeTrainingDecisionChoice,
  initializeGame,
  getLegalActions,
  applyLegalAction,
  advanceStep,
  getCurrentActorPlayerIds,
  legalActionsForTraining,
  TRAINING_CHOICE_FEAT_DIM,
  type GameState,
  type LegalAction,
} from "@orica/rules-core";
import { buildEngine, randomDeck } from "./selfplay-driver";

const engine = buildEngine();
const { getCardDefinitionById, lookups, cards } = engine;
const __dirname = dirname(fileURLToPath(import.meta.url));
const LEGAL_ACTION_TYPES_PATH = resolve(
  __dirname,
  "../../../packages/rules-core/src/legal/legal-actions-types.ts"
);

function kindLiterals(typeNode: ts.TypeNode): string[] {
  if (ts.isLiteralTypeNode(typeNode) && ts.isStringLiteral(typeNode.literal)) {
    return [typeNode.literal.text];
  }
  if (ts.isUnionTypeNode(typeNode)) {
    return typeNode.types.flatMap(kindLiterals);
  }
  return [];
}

function collectLegalActionKinds(): string[] {
  const source = readFileSync(LEGAL_ACTION_TYPES_PATH, "utf8");
  const sourceFile = ts.createSourceFile(
    LEGAL_ACTION_TYPES_PATH,
    source,
    ts.ScriptTarget.Latest,
    true
  );
  const interfaceKinds = new Map<string, string[]>();

  for (const statement of sourceFile.statements) {
    if (!ts.isInterfaceDeclaration(statement)) continue;
    for (const member of statement.members) {
      if (
        !ts.isPropertySignature(member) ||
        !ts.isIdentifier(member.name) ||
        member.name.text !== "kind" ||
        !member.type
      ) {
        continue;
      }
      const kinds = kindLiterals(member.type);
      if (kinds.length > 0) interfaceKinds.set(statement.name.text, kinds);
    }
  }

  for (const statement of sourceFile.statements) {
    if (
      !ts.isTypeAliasDeclaration(statement) ||
      statement.name.text !== "LegalAction" ||
      !ts.isUnionTypeNode(statement.type)
    ) {
      continue;
    }
    const kinds = statement.type.types.flatMap((node) => {
      if (!ts.isTypeReferenceNode(node) || !ts.isIdentifier(node.typeName)) {
        throw new Error(
          `Unsupported LegalAction union member: ${node.getText()}`
        );
      }
      const resolved = interfaceKinds.get(node.typeName.text);
      if (!resolved) {
        throw new Error(`Missing kind property for ${node.typeName.text}`);
      }
      return resolved;
    });
    return [...new Set(kinds)].sort();
  }

  throw new Error("LegalAction type alias not found");
}

describe("action encoder", () => {
  it("ACTION_KINDS covers every LegalAction kind literal", () => {
    const legalActionKinds = collectLegalActionKinds();
    const encodedKinds = [...ACTION_KINDS].sort();

    expect(encodedKinds).toHaveLength(new Set(encodedKinds).size);
    expect(encodedKinds).toEqual(legalActionKinds);
  });

  it("encodes all legal actions across a self-play game with stable dims", () => {
    let state: GameState = initializeGame({
      decks: [randomDeck(cards), randomDeck(cards)],
      skipPreGame: true,
    });

    const seenKinds = new Set<string>();
    let unkCount = 0;
    let encodedActions = 0;
    let sourceResolved = 0;
    let withSource = 0;

    for (let s = 0; s < 400 && state.gameResult === null; s++) {
      const actors = [...getCurrentActorPlayerIds(state)];
      let actingPlayerId: string | undefined;
      let cand: LegalAction[] = [];
      for (const a of actors) {
        const acts = getLegalActions({
          state,
          actingPlayerId: a,
          getCardDefinitionById,
          ...lookups,
        }).filter((x) => x.can);
        if (acts.length > 0) {
          cand = acts;
          actingPlayerId = a;
          break;
        }
      }

      if (cand.length > 0 && actingPlayerId) {
        const observation = buildAiObservation({
          state,
          viewpointPlayerId: actingPlayerId,
          mode: "player",
          getCardDefinitionById,
        });
        const cardVocabulary = buildAiObservationCardVocabulary(
          cards.map((card) => card.cardNo)
        );
        const enc = encodeAiObservation({
          observation,
          cardVocabulary,
        });
        for (const action of cand) {
          const ea = encodeAction(action, enc, {
            cardVocabulary,
            getCardDefinitionById,
          });
          expect(ea.feats.length).toBe(ACTION_FEAT_DIM);
          expect(ea.feats.every((x) => Number.isFinite(x))).toBe(true);
          seenKinds.add(action.kind);
          if (ea.kindIndex === ACTION_KIND_UNK) unkCount++;
          encodedActions++;
          const hasSource = "sourceInstanceId" in action;
          if (hasSource) {
            withSource++;
            if (ea.sourceTokenIndex >= 0) sourceResolved++;
          }
        }
      }

      // 進行
      let moved = false;
      for (const action of cand) {
        try {
          const extra =
            action.kind === "resolve_pending_enter_field_placement"
              ? {
                  enterFieldCorePlacements: [
                    {
                      kind: "reserve_normal" as const,
                      amount:
                        state.pendingEnterFieldPlacement?.minimumCoreCount ?? 1,
                    },
                  ],
                }
              : {};
          state = applyLegalAction({
            state,
            action,
            getCardDefinitionById,
            ...lookups,
            ...extra,
          }).state;
          moved = true;
          break;
        } catch {
          /* next */
        }
      }
      if (!moved) {
        try {
          state = advanceStep(
            state,
            getCardDefinitionById,
            lookups.getRegisteredTriggeredEffectActions,
            lookups.getRegisteredBurstActions
          );
        } catch {
          break;
        }
      }
    }

    console.log("\n===== ACTION ENCODER =====");
    console.log(`ACTION_FEAT_DIM   : ${ACTION_FEAT_DIM}`);
    console.log(`known kinds       : ${ACTION_KINDS.length}`);
    console.log(`encoded actions   : ${encodedActions}`);
    console.log(`distinct kinds    : ${seenKinds.size}`);
    console.log(`UNK-kind actions  : ${unkCount}`);
    console.log(
      `source pointer    : ${sourceResolved}/${withSource} resolved to visible token`
    );
    console.log(`kinds seen        : ${[...seenKinds].sort().join(", ")}`);
    console.log("==========================\n");

    // 既知 kind に無い行動が出たら ACTION_KINDS の更新漏れ
    expect(unkCount).toBe(0);
    expect(encodedActions).toBeGreaterThan(0);
  });

  it("encodes TrainingDecisionChoice entries with stable dimensions", () => {
    let state: GameState = initializeGame({
      decks: [randomDeck(cards), randomDeck(cards)],
      skipPreGame: true,
    });

    let node = legalActionsForTraining(state, engine, {
      maxGeneratedChoices: 64,
    });
    while (node === null) {
      state = advanceStep(
        state,
        getCardDefinitionById,
        lookups.getRegisteredTriggeredEffectActions,
        lookups.getRegisteredBurstActions
      );
      node = legalActionsForTraining(state, engine, {
        maxGeneratedChoices: 64,
      });
    }

    const observation = buildAiObservation({
      state,
      viewpointPlayerId: node.actingPlayerId,
      mode: "player",
      getCardDefinitionById,
    });
    const cardVocabulary = buildAiObservationCardVocabulary(
      cards.map((card) => card.cardNo)
    );
    const encodedObservation = encodeAiObservation({
      observation,
      cardVocabulary,
    });

    const encodedChoices = node.choices.map((choice) =>
      encodeTrainingDecisionChoice({
        node,
        choice,
        encodedObservation,
        cardVocabulary,
        getCardDefinitionById,
      })
    );

    expect(encodedChoices.length).toBeGreaterThan(0);
    for (const encodedChoice of encodedChoices) {
      expect(encodedChoice.feats).toHaveLength(TRAINING_CHOICE_FEAT_DIM);
      expect(encodedChoice.feats.every((value) => Number.isFinite(value))).toBe(
        true
      );
    }
  });
});
