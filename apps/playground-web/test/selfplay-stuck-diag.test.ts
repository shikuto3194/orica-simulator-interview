/**
 * stuck 原因の分布診断。堅牢ドライバ実装の優先順位付け用。
 * 実行: vitest run selfplay-stuck-diag
 */
import { describe, it } from "vitest";
import {
  initializeGame,
  getLegalActions,
  applyLegalAction,
  advanceStep,
  getCurrentActorPlayerIds,
  buildTriggeredEffectLookup,
  buildBurstEffectLookup,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildHandActivatedEffectLookup,
  buildMagicLookup,
  randomDeck as buildRandomDeck,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "@orica/rules-core";
import { ALL_CARDS } from "@orica/card-data";

const GAMES = Number(process.env.BENCH_GAMES ?? 200);
const MAX_STEPS = Number(process.env.BENCH_MAX_STEPS ?? 2000);

const cardNoMap = new Map<string, CardDefinition>(
  (ALL_CARDS as CardDefinition[]).map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
const lookups = {
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(
    ALL_CARDS as CardDefinition[]
  ),
  getRegisteredBurstActions: buildBurstEffectLookup(
    ALL_CARDS as CardDefinition[]
  ),
  getRegisteredBattleImmediateEffectActions: buildBattleImmediateEffectLookup(
    ALL_CARDS as CardDefinition[]
  ),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(
    ALL_CARDS as CardDefinition[]
  ),
  getRegisteredHandActivatedEffectActions: buildHandActivatedEffectLookup(
    ALL_CARDS as CardDefinition[]
  ),
  getRegisteredMagicActions: buildMagicLookup(ALL_CARDS as CardDefinition[]),
};

function randomDeck(): CardDefinition[] {
  return buildRandomDeck(ALL_CARDS as CardDefinition[]);
}

function norm(msg: string): string {
  // pendingId / actor 等の可変部を削って分類キーにする
  return msg
    .replace(/\(.*?\)/g, "")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

// 診断用（200局の自己対戦・長時間同期ブロック）は既定 `pnpm test`（merge ゲート）から
// 除外する（vitest birpc onTaskUpdate タイムアウト偽陽性回避）。RUN_PERF=1 で実行する。
describe.runIf(process.env.RUN_PERF === "1")("stuck cause diagnostics", () => {
  it(`categorizes stuck reasons over ${GAMES} games`, () => {
    const advanceBlock: Record<string, number> = {};
    const applyFail: Record<string, number> = {};
    // stuck 時に「候補は存在したが全 apply 失敗」か「候補ゼロ」かを区別
    let stuckWithCandidates = 0;
    let stuckNoCandidates = 0;
    let naturalEnds = 0;
    let cappedEnds = 0;
    // stuck 時の window/step 分布
    const windowStep: Record<string, number> = {};

    for (let g = 0; g < GAMES; g++) {
      let state: GameState = initializeGame({
        decks: [randomDeck(), randomDeck()],
        skipPreGame: true,
      });
      let ended = false;
      for (let steps = 0; steps < MAX_STEPS; steps++) {
        if (state.gameResult !== null) {
          naturalEnds++;
          ended = true;
          break;
        }
        let candidates: LegalAction[] = [];
        let actor: string | undefined;
        try {
          actor = getCurrentActorPlayerIds(state).values().next().value as
            | string
            | undefined;
          if (actor)
            candidates = getLegalActions({
              state,
              actingPlayerId: actor,
              getCardDefinitionById,
              ...lookups,
            }).filter((a) => a.can);
        } catch {
          candidates = [];
        }

        let progressed = false;
        const applyErrs: string[] = [];
        for (const action of candidates) {
          try {
            state = applyLegalAction({
              state,
              action,
              getCardDefinitionById,
              ...lookups,
            }).state;
            progressed = true;
            break;
          } catch (e) {
            applyErrs.push((e as Error).message ?? String(e));
          }
        }

        if (!progressed) {
          try {
            state = advanceStep(
              state,
              getCardDefinitionById,
              lookups.getRegisteredTriggeredEffectActions,
              lookups.getRegisteredBurstActions
            );
          } catch (e) {
            // STUCK
            const key = norm((e as Error).message ?? String(e));
            advanceBlock[key] = (advanceBlock[key] ?? 0) + 1;
            const ws = `${state.window}/${state.step}`;
            windowStep[ws] = (windowStep[ws] ?? 0) + 1;
            if (candidates.length > 0) {
              stuckWithCandidates++;
              for (const m of applyErrs.slice(0, 1)) {
                const k = norm(m);
                applyFail[k] = (applyFail[k] ?? 0) + 1;
              }
            } else {
              stuckNoCandidates++;
            }
            ended = true;
            break;
          }
        }
      }
      if (!ended) cappedEnds++;
    }

    const top = (rec: Record<string, number>, n = 12) =>
      Object.entries(rec)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n);

    console.log("\n===== STUCK DIAGNOSTICS =====");
    console.log(
      `games=${GAMES} natural=${naturalEnds} capped=${cappedEnds} stuck=${
        stuckWithCandidates + stuckNoCandidates
      } (withCandidates=${stuckWithCandidates} noCandidates=${stuckNoCandidates})`
    );
    console.log("\n-- advanceStep block reasons (top) --");
    for (const [k, v] of top(advanceBlock)) console.log(`  ${v}\t${k}`);
    console.log(
      "\n-- apply failure messages (top, when candidates existed) --"
    );
    for (const [k, v] of top(applyFail)) console.log(`  ${v}\t${k}`);
    console.log("\n-- stuck window/step (top) --");
    for (const [k, v] of top(windowStep)) console.log(`  ${v}\t${k}`);
    console.log("=============================\n");
  }, 600_000);
});
