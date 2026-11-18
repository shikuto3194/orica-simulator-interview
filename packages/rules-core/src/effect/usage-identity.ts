/**
 * 効果の使用枠の識別(P3-170)。能力への構造参照と、同名共有用の参照を、定義から一度だけ作る。
 *
 * - `ability`: 定義と構造path(effects[i] / effects[i].choices[k] / effects[i].steps[j] / ルール)。
 *   個体共有・グループ共有・主語別の識別に使う。表示ラベルとは独立。
 * - `nameAbility`: printed name + 能力指紋(効果内容の安定ハッシュ)。同名共有に使う。
 *   同名でも本文が違えば別枠、別カード番号でも同一本文なら同枠になる。10_rules/03e が定めるのは
 *   同名(printed name)での共有までで、本文差で分ける点は P3-170 の設計判断(信頼度C・裁定待ち。
 *   manual/ai-reference/00_meta/open-questions.md「使用会計」)。
 *
 * 識別はラベル(登録時に決まる効果の安定した識別文字列)から作る唯一の写像 `usageIdentityOfLabel` と、
 * その部品 (`usageIdentityOfChoiceVariant` / `usageIdentityOfStep`) に集約する。列挙・宣言・解決は
 * 同じ入力(定義とラベル、【魂状態】の判定には効果そのもの)を使う。
 */

import {
  abilityFingerprint,
  makeAbilityRef,
  sharedNameAbilityRef,
  stepStructuralPath,
} from "../effect-usage";
import type { AbilityRef } from "../effect-usage";
import type { Effect } from "../dsl-types";
import type { CardDefinition } from "../model";
import { resolveDefinitionEffect } from "./definition-effect-reference";

export interface UsageIdentity {
  ability: AbilityRef;
  nameAbility: AbilityRef;
}

function identityOf(
  definition: Pick<CardDefinition, "cardNo" | "name">,
  kind: AbilityRef["kind"],
  path: string,
  contentForFingerprint: object
): UsageIdentity {
  return {
    ability: makeAbilityRef(kind, definition.cardNo, path),
    nameAbility: sharedNameAbilityRef(
      definition.name,
      abilityFingerprint(contentForFingerprint)
    ),
  };
}

/** 選択肢の変種ごとに独立した「ターンに1回ずつ」型の識別(効果単位とは別の枠)。 */
export function usageIdentityOfChoiceVariant(
  definition: CardDefinition,
  baseIdentity: UsageIdentity,
  choiceIndex: number
): UsageIdentity {
  return {
    ability: makeAbilityRef(
      "choice",
      baseIdentity.ability.definitionKey,
      `${baseIdentity.ability.path}.choices[${choiceIndex}]`
    ),
    nameAbility: sharedNameAbilityRef(
      definition.name,
      abilityFingerprint({
        base: baseIdentity.nameAbility.path,
        choiceIndex,
      })
    ),
  };
}

/**
 * step 単位の制限の識別。`usageGroupId` があれば同一グループの step は同じ能力として共有する。
 * 無ければ step の位置(stepIndex)で識別する。
 */
export function usageIdentityOfStep(
  definition: CardDefinition,
  effectIndex: number,
  stepIndex: number,
  usageGroupId?: string
): UsageIdentity {
  const effect = definition.effects?.[effectIndex];
  const step = effect?.steps?.[stepIndex];
  const path =
    usageGroupId !== undefined
      ? `effects[${effectIndex}].stepGroup[${usageGroupId}]`
      : stepStructuralPath(effectIndex, stepIndex);
  return identityOf(definition, "step", path, {
    step: step ?? { effectIndex, stepIndex },
    usageGroupId,
  });
}

/**
 * 継続効果(CE)を登録した効果そのもの。CE の使用枠のラベルは経路名(`redirect_effect_target` 等)で
 * `effectOfUsageLabel` では効果を逆引きできない。【魂状態】を含む効果は個体の寿命キーが変わるため、
 * 列挙と記録は**必ずこの関数が返す効果**を `sourceEffect` に渡す(片方だけだと、記録しても
 * 枠が埋まらず〔ターンに1回〕が効かなくなる)。
 */
export function sourceEffectOfContinuousEffect(
  ce: {
    sourceDefinitionId: string;
    provenance?:
      | {
          effectIndex?: number;
          effectSourceDefinitionId?: string | undefined;
          definitionPath?: readonly (string | number)[] | null | undefined;
        }
      | undefined;
  },
  getCardDefinitionById:
    | ((definitionId: string) => CardDefinition | undefined)
    | undefined
): Effect | undefined {
  const provenance = ce.provenance;
  if (provenance?.effectIndex === undefined) return undefined;
  // 効果の置き場(effects 以外の神技・アクセル・チェンジ等)と、効果の提供元が host と違う場合(星霊衣等)は、
  // CE の再構築と同じ正源 (resolveDefinitionEffect) で引く。
  return resolveDefinitionEffect(
    getCardDefinitionById?.(
      provenance.effectSourceDefinitionId ?? ce.sourceDefinitionId
    ),
    provenance.effectIndex,
    provenance.definitionPath
  );
}

/**
 * 安定ラベルが指す効果そのもの(`effect:N` / `effect:N:choice:k` / `__step:…:N:…`)。
 * 【魂状態】を含むかは個体の寿命キー(soul 世代を含めるか)を決めるので、列挙(効果を渡す)と
 * 記録・解決(ラベルしか持たない)で同じ効果から判定しなければ、記録したのに枠が効かなくなる。
 * `usageIdentityOfLabel` と対で保守する唯一の写像。効果を特定できないラベル(経路名)は undefined。
 */
export function effectOfUsageLabel(
  definition: CardDefinition | undefined,
  label: string
): Effect | undefined {
  const base = /^(.*):choice:\d+$/.exec(label)?.[1] ?? label;
  const effect = /^effect:(\d+)$/.exec(base);
  if (effect) return definition?.effects?.[Number(effect[1])];
  const step = /^__step:.*:(\d+):(.+)$/.exec(base);
  if (step) return definition?.effects?.[Number(step[1])];
  return undefined;
}

/**
 * 安定ラベル(登録時に決まる効果の識別文字列: `effect:N` / `…:choice:k` / `__step:…` / 経路名)から
 * 識別を得る**唯一の写像**。ラベルを作る関数(legal-actions-shared の getStableEffectLabel 等)と
 * 対で保守する。呼出点は、列挙・宣言・解決のいずれもこの関数と同じ入力(定義とラベル)を使う。
 *
 * 構造path(`effects[N]` など)は定義が無くても作れる。同名共有用の能力指紋だけが効果の内容(定義)を
 * 要するため、`definition` が解決できない場合の nameAbility は「定義ID＋ラベル」の識別になる
 * (同名共有は定義IDで共有)。
 */
export function usageIdentityOfLabel(
  definition: CardDefinition | undefined,
  definitionId: string,
  label: string
): UsageIdentity {
  const named = definition ?? { cardNo: definitionId, name: definitionId };
  const choice = /^(.*):choice:(\d+)$/.exec(label);
  if (choice) {
    return usageIdentityOfChoiceVariant(
      named as CardDefinition,
      usageIdentityOfLabel(definition, definitionId, choice[1]!),
      Number(choice[2])
    );
  }
  const effect = /^effect:(\d+)$/.exec(label);
  if (effect) {
    const index = Number(effect[1]);
    const content = definition?.effects?.[index];
    return identityOf(
      named,
      "effect",
      `effects[${index}]`,
      content ?? { label }
    );
  }
  const step = /^__step:.*:(\d+):(.+)$/.exec(label);
  if (step) {
    const tail = step[2]!;
    const numeric = /^\d+$/.test(tail);
    return usageIdentityOfStep(
      named as CardDefinition,
      Number(step[1]),
      numeric ? Number(tail) : 0,
      numeric ? undefined : tail
    );
  }
  // 経路名などのラベル(マジック本体・場の固定効果など)は、定義の内容を含めて同名共有を判定する
  // (同名でも本文が違えば別枠)。定義が解決できないときだけラベルのみ。
  return identityOf(named, "effect", `label:${label}`, {
    label,
    effects: definition?.effects ?? null,
  });
}
