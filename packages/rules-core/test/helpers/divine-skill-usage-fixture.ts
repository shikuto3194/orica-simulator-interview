/**
 * 神技(divine skill)の使用枠 (P3-170 I01) を、テストが本番の使用枠APIを直接 import せずに
 * 差し込む/読むための fixture。`effect-usage-fixture.ts` の `seedEffectUsage` は効果(effect)の
 * 能力参照で枠を作るため、神技の能力参照 (`divine_skill`) の枠は作れない。ここで神技専用に補う。
 *
 * 枠の組み立ては本番と同じ `divineSkillUsageSite` を使う (宣言・列挙と同じ枠になる)。
 */
import {
  divineSkillDeclarationObservationSite,
  divineSkillUsageSite,
} from "../../src/legal/divine-skill-usage";
import {
  canUseEffectUsage,
  consumeEffectUsage,
} from "../../src/legal/legal-actions-shared";
import type { CardDefinition, GameState } from "../../src";
import { listEffectUsage } from "./effect-usage-fixture";
import type { EffectUsageEntry } from "./effect-usage-fixture";

/**
 * 神技 `skillIndex` を `times` 回宣言した状態にする。本番の宣言(applyDivineSkillAction)と同じく、
 * 回数制限(usageLimit があれば)の消費と、制限の有無に関わらない宣言の観測を1件ずつ記録する。
 */
export function seedDivineSkillUsage(
  state: GameState,
  options: {
    sourceInstanceId: string;
    skillIndex: number;
    times?: number;
    getCardDefinitionById: (id: string) => CardDefinition | undefined;
  }
): GameState {
  let current = state;
  const where = `${options.sourceInstanceId}[${options.skillIndex}]`;
  for (let i = 0; i < (options.times ?? 1); i++) {
    const site = divineSkillUsageSite({
      state: current,
      sourceInstanceId: options.sourceInstanceId,
      skillIndex: options.skillIndex,
      getCardDefinitionById: options.getCardDefinitionById,
    });
    if (site) {
      const result = consumeEffectUsage(site);
      if (!result.ok) {
        throw new Error(
          `divine-skill fixture: 枠を消費できません (${result.reason}) ${where} ${i + 1}回目`
        );
      }
      current = result.state;
    }
    const observationSite = divineSkillDeclarationObservationSite({
      state: current,
      sourceInstanceId: options.sourceInstanceId,
      skillIndex: options.skillIndex,
      getCardDefinitionById: options.getCardDefinitionById,
    });
    if (!observationSite) {
      throw new Error(
        `divine-skill fixture: 神技の発揮元が存在しません (${where})`
      );
    }
    current = consumeEffectUsage(observationSite).state;
  }
  return current;
}

/**
 * 神技の使用回数枠だけを列挙する。個体枠の label は `divineSkills[<idx>]`、
 * 同名共有枠は共有能力 (名前+能力指紋) なので label は `fp:…` になる。
 * 同名共有枠は `nameKey` (カード名) と `playerId` で識別する。
 */
export function listDivineSkillUsage(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): EffectUsageEntry[] {
  const divineNames = new Set(
    state.cardInstances
      .map((card) => getCardDefinitionById(card.definitionId))
      .filter((def) => (def?.grandwalkerData?.divineSkills?.length ?? 0) > 0)
      .map((def) => def!.name)
  );
  return listEffectUsage(state).filter(
    (entry) =>
      entry.label.startsWith("divineSkills[") ||
      (entry.share === "card_name" &&
        entry.nameKey !== undefined &&
        divineNames.has(entry.nameKey) &&
        entry.label.startsWith("fp:"))
  );
}

/** 神技 `skillIndex` の回数枠が、いま使用可能か (全制限を通過するか)。状態は変更しない。 */
export function canUseDivineSkillUsage(
  state: GameState,
  options: {
    sourceInstanceId: string;
    skillIndex: number;
    getCardDefinitionById: (id: string) => CardDefinition | undefined;
  }
): boolean {
  const site = divineSkillUsageSite({
    state,
    sourceInstanceId: options.sourceInstanceId,
    skillIndex: options.skillIndex,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  if (!site) {
    throw new Error(
      `divine-skill fixture: 使用枠を持たない神技です (${options.sourceInstanceId}[${options.skillIndex}])`
    );
  }
  return canUseEffectUsage(site);
}
