/**
 * P3-47 F-2: token-as-spirit (act_as_spirit ContinuousEffect)
 *
 * 任意のカードを実行時に「スピリットとして扱う」継続効果。`act_as_spirit` タグの
 * ContinuousEffect を targetInstanceId 付きで登録すると、そのカードはスピリット属性で
 * legal-action / battle / 効果対象 / BP 計算等に参加する。
 *
 * Step 1: 型 + isSpirit() / getActAsSpiritMetadata() helper。
 * Step 2: BP / Lv 解決 (resolveActAsSpiritBp / resolveActAsSpiritLevel)。
 *         live_copy_from は参照先カードの現在値を再帰取得し、循環参照を visited セットで
 *         ガードする。
 * Step 3: getEffectiveCategory() helper。card-filter / battle-shared が
 *         act_as_spirit token を "spirit" 扱いで受け入れる経路を提供。
 * Step 4: BSTH01-X04 の本体参照型 CE は次の寿命で登録する:
 *         - duration: { scope: "while_on_field" } (host 側の発揮元離場で消滅)
 *         - sourceInstanceId: host (フランドール本体) の instanceId
 *         - targetInstanceId: token (裏向きカード) の instanceId
 *         これにより `recomputeContinuousEffects` が
 *           - host (sourceInstanceId) フィールド離脱 → CE 削除
 *           - token (targetInstanceId) フィールド離脱 → CE 削除
 *         を自動処理する。F-1 規則 (裁定 #2) により裏向きカード自体は host 離脱後も
 *         フィールドに残るが、付与が外れると素性のない裏向きカードとなる。
 *         元の印字 category へは戻らない。分身自身の効果消失とは区別する。
 */
import { getCEsForTarget } from "../card/ce-lookup";
import { isCardTextCardState } from "../model";
import { getTotalCoresOnCardById } from "../core/core-system";
import type {
  CardCategory,
  CardColor,
  CardDefinition,
  CardInstance,
  GameState,
  LevelDefinition,
  SymbolColor,
} from "../model";
import { isEffectivelyCombined } from "./virtual-combine";

/** act_as_spirit metadata で参照するステータス側面。 */
export type ActAsSpiritStatAspect =
  | "cost"
  | "reductionSymbols"
  | "symbolColors"
  | "tribes"
  | "levelDefs"
  | "currentLv";

/**
 * 静的にコピーしたスピリットステータス snapshot。
 * 効果登録時点の値を凍結する用途。
 *
 * `colors` (engine-deck-derived-clone-spirit): カード色の完全上書き。「黄の分身スピリット」
 * のような固定色記述カードのみが populate する。省略時 (X04 フランドール等) は色を
 * 上書きしない。裏向き null-identity では印字色へフォールバックせず、付与色なしとして扱う。
 * live_copy_from の aspects には未対応 (現状 static_copy 専用の使用実績のみ)。
 */
export interface ActAsSpiritStatSnapshot {
  cost: number;
  reductionSymbols: SymbolColor[];
  symbolColors: SymbolColor[];
  tribes: string[];
  levelDefs: LevelDefinition[];
  colors?: CardColor[];
}

/**
 * ステータス参照源。
 * - live_copy_from: 参照先カードの現在値を毎回再帰取得 (動的追従)
 * - static_copy: 登録時の snapshot を固定
 */
export type ActAsSpiritStatBlueprint =
  | {
      kind: "live_copy_from";
      sourceInstanceId: string;
      aspects: ActAsSpiritStatAspect[];
    }
  | { kind: "static_copy"; snapshot: ActAsSpiritStatSnapshot };

/**
 * act_as_spirit の上書き値。cardName 固定や「合体できない」等の制約付与に使う。
 */
export interface ActAsSpiritOverrides {
  cardName?: string;
  levelDefs?: LevelDefinition[];
  /** 「合体できない」等の制約キーワード。 */
  keywords?: string[];
}

/**
 * act_as_spirit ContinuousEffect の metadata 構造。
 * `ContinuousEffect.metadata` (Record<string, unknown>) に格納する。
 */
export interface ActAsSpiritMetadata {
  statBlueprint: ActAsSpiritStatBlueprint;
  overrides?: ActAsSpiritOverrides;
}

/**
 * カードが現在「スピリットとして扱われる」かを判定する。
 *
 * - 表向きで印字 category が "spirit" のカードはスピリット
 * - act_as_spirit CE が targetInstanceId 一致で登録されていれば true
 *
 * 既存の divineTransformState (転神/転者) は別経路。本 helper は act_as_spirit の
 * 判定のみを扱い、呼び出し側で必要なら他の category override と OR 合成する。
 */
export function isSpirit(
  card: CardInstance,
  state: Pick<GameState, "activeContinuousEffects"> &
    Partial<Pick<GameState, "step" | "activePlayerId">>,
  getCardDefinitionById?: (
    id: string
  ) => { printedCategory?: string } | undefined
): boolean {
  if (isCardTextCardState(card, state)) return false;
  if (!card.faceDown && getCardDefinitionById) {
    const def = getCardDefinitionById(card.definitionId);
    if (def?.printedCategory === "spirit") return true;
  }
  const ces = getCEsForTarget(state, card.instanceId);
  return ces.some((ce) => ce.modifierTag === "act_as_spirit");
}

/**
 * 召喚・場入りなど、カードの現在の対象カテゴリではなくイベント帰属を判定する文脈で
 * 使用する印字カテゴリ。`getEffectiveCategory` と取り違えないため、印字 identity を
 * 必要とする consumer はこの helper を経由する。
 *
 * 例: スピリットとして扱う継続効果が付いたブレイヴでも、「ブレイヴを召喚したとき」の
 * 召喚イベントはブレイヴに帰属する。逆に別カテゴリをブレイヴとして扱っても、印字上の
 * ブレイヴ召喚イベントにはならない。
 */
export function getEventPrintedCategory(
  def: Pick<CardDefinition, "printedCategory">
): CardDefinition["printedCategory"] {
  return def.printedCategory;
}

/**
 * カードの実効 category を返す。act_as_spirit CE が適用されていれば "spirit" を返し、
 * 無ければ印字 category を返す。
 *
 * Step 3 で legal-action / 効果対象 filter が token を「スピリット」として扱うために使う。
 * 印字 category を直接消費していた箇所は本 helper 経由で置換する。
 * 効果源にも使うため、カード状態だけを理由に種類を消さない（公式Q3641）。
 * 戦闘実体の有無は isCardTextCardState で別に判定する。
 *
 * P3-69: 裏向き (faceDown) で付与 (act_as_spirit) が無いカードは素性なし →
 * `undefined` を返す (どの category フィルタにもマッチしない)。印字 category を漏らさない。
 *
 * `excludeCategory`（engine-category-negation-override）: 「〇〇として扱わない」型の
 * 否定 override。`treatAsCategory` の置換より弱く、他 CE が置換していればそちらが勝つ。
 * 印字 category（act_as_spirit / faceDown 適用後の実効値）と一致する場合のみ `undefined`
 * を返す（そのカテゴリとしてマッチしなくなる。他カテゴリへの置換ではない）。
 */
export function getEffectiveCategory(
  state: Pick<GameState, "activeContinuousEffects"> &
    Partial<Pick<GameState, "step" | "activePlayerId">>,
  card: CardInstance,
  def: CardDefinition,
  ignoreCategoryExclusion = false
): CardDefinition["printedCategory"] | undefined {
  const ces = getCEsForTarget(state, card.instanceId);
  let excludeCategory: CardCategory | undefined;
  for (let i = ces.length - 1; i >= 0; i--) {
    const ce = ces[i]!;
    if (ce.modifierTag !== "override_properties" || !ce.metadata) continue;
    const props = ce.metadata.properties as
      | { treatAsCategory?: CardCategory; excludeCategory?: CardCategory }
      | undefined;
    if (props?.treatAsCategory !== undefined) {
      return props.treatAsCategory as CardDefinition["printedCategory"];
    }
    if (
      !ignoreCategoryExclusion &&
      excludeCategory === undefined &&
      props?.excludeCategory !== undefined
    ) {
      excludeCategory = props.excludeCategory;
    }
  }
  if (ces.some((ce) => ce.modifierTag === "act_as_spirit")) {
    return excludeCategory === "spirit" ? undefined : "spirit";
  }
  if (card.faceDown) {
    return undefined;
  }
  return excludeCategory === def.printedCategory
    ? undefined
    : def.printedCategory;
}

/**
 * P3-142: 防止元 identity 照合専用の実効カテゴリ「集合」を返す。
 *
 * `getEffectiveCategory()` は対象フィルタ/条件評価からも呼ばれる SSOT のため単一値の
 * まま変更しない（issue P3-142 guardrails）。ここでは `EffectSourceIdentity.categories`
 * の合成専用に、印字/act_as_spirit 由来の単一カテゴリへ「二重状態」を union で追加する。
 * 二重状態はいずれも既存の裁定/コメントに明記されたものだけを反映し、独自解釈は作らない:
 *
 * - 転神中 (`card.divineTransformState !== null`): 「創界神上のコアをボイドに置き、
 *   スピリットとしても扱う。」(08d_grandwalker-nexus.md:44「転神」) の二重状態 → spirit を追加。
 * - 合体中のブレイヴ (`isEffectivelyCombined` && 自身がホストへ結合された側):
 *   「合体した結果は1体の『合体スピリット』として扱う」
 *   (05_brave-and-attack-special-cases.md) → ホスト側の実効カテゴリを追加する
 *   (合体ホスト側のカテゴリで代表、P3-142 残タスク2)。
 * - フィールドで単独のブレイヴ (`attachedToInstanceId===null` かつ非合体 = スピリット状態):
 *   「独立したスピリットのように扱われる」(同ファイル:12) → spirit を追加。
 *   `attachedToInstanceId!==null` かつ非合体 (under card 等) はスピリット状態ではない
 *   ため追加しない (印字 category のみ、P3-142 残タスク3)。
 */
export function getEffectiveCategories(
  state: Pick<GameState, "activeContinuousEffects" | "cardInstances"> &
    Partial<Pick<GameState, "step" | "activePlayerId" | "players">>,
  card: CardInstance,
  def: CardDefinition,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  ignoreCategoryExclusion = false
): CardCategory[] {
  const categories = new Set<CardCategory>();
  const base = getEffectiveCategory(state, card, def, ignoreCategoryExclusion);
  if (base !== undefined) categories.add(base);

  if (card.divineTransformState) {
    categories.add("spirit");
  }

  const combined = isEffectivelyCombined(state, card);
  if (card.attachedToInstanceId !== null && combined) {
    const host = state.cardInstances.find(
      (c) => c.instanceId === card.attachedToInstanceId
    );
    const hostDef =
      host && getCardDefinitionById
        ? getCardDefinitionById(host.definitionId)
        : undefined;
    if (host && hostDef) {
      const hostCategory = getEffectiveCategory(
        state,
        host,
        hostDef,
        ignoreCategoryExclusion
      );
      if (hostCategory !== undefined) categories.add(hostCategory);
    }
  } else if (
    !card.faceDown &&
    def.printedCategory === "brave" &&
    card.zone === "field" &&
    card.attachedToInstanceId === null &&
    !combined &&
    !state.players?.some((player) =>
      player.soulStateInstanceIds.includes(card.instanceId)
    )
  ) {
    categories.add("spirit");
  }

  return [...categories];
}

export function isAttachedCombinedChild(
  state: Pick<GameState, "activeContinuousEffects"> &
    Partial<Pick<GameState, "cardInstances">>,
  card: CardInstance
): boolean {
  return (
    card.zone === "field" &&
    card.attachedToInstanceId !== null &&
    isEffectivelyCombined(state, card)
  );
}

/**
 * P3-69: カードの実効系統 (tribe 文字列) を返す。
 * - 裏向きカード: 付与 (act_as_spirit) があればその系統、無ければ "" (素性なし)
 *   → 印字系統を漏らさない。
 * - 表向きカード: 印字 `def.tribe`。
 */
export function getEffectiveTribe(
  state: Pick<GameState, "activeContinuousEffects" | "cardInstances"> &
    Partial<Pick<GameState, "step" | "activePlayerId">>,
  card: CardInstance,
  def: CardDefinition,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): string {
  if (card.faceDown) {
    if (!getCardDefinitionById) return "";
    return resolveActAsSpiritTribes(state, card, getCardDefinitionById) ?? "";
  }
  return def.tribe ?? "";
}

/**
 * 指定カードに紐付いた act_as_spirit metadata を取得する。
 * 複数登録されている場合は最初の 1 件を返す (通常は 1 カードに 1 件)。
 */
export function getActAsSpiritMetadata(
  state: Pick<GameState, "activeContinuousEffects"> &
    Partial<Pick<GameState, "step" | "activePlayerId">>,
  targetInstanceId: string
): ActAsSpiritMetadata | undefined {
  const ces = getCEsForTarget(state, targetInstanceId);
  const ce = ces.find((c) => c.modifierTag === "act_as_spirit");
  if (!ce) return undefined;
  const meta = ce.metadata;
  if (!meta || typeof meta !== "object") return undefined;
  const blueprint = (meta as Record<string, unknown>).statBlueprint;
  if (!blueprint) return undefined;
  return meta as unknown as ActAsSpiritMetadata;
}

/**
 * 指定カードを act_as_spirit 登録した「発動元」カードの instanceId を返す
 * (CE の `sourceInstanceId`＝register_act_as_spirit を実行したカード、`getActAsSpiritMetadata`
 * と同じ CE を参照するが返す値が異なる)。未登録なら undefined。
 * 「このカード自身が生成したトークンか」を区別する用途 (BSAZ02-X03【分身：1】上限ゲート、
 * 複数の同名実カードが場にいるとき互いのトークンを誤カウントしないため)。
 */
export function getActAsSpiritSourceInstanceId(
  state: Pick<GameState, "activeContinuousEffects"> &
    Partial<Pick<GameState, "step" | "activePlayerId">>,
  targetInstanceId: string
): string | undefined {
  const ces = getCEsForTarget(state, targetInstanceId);
  const ce = ces.find((c) => c.modifierTag === "act_as_spirit");
  return ce?.sourceInstanceId;
}

/**
 * act_as_spirit スコープ判定の共有ロジック (SSOT)。`ConditionClause.field_has.actAsSpiritOnly`/
 * `actAsSpiritSourceSelf` (structured-condition-eval.ts) と `CardFilter.actAsSpiritOnly`/
 * `actAsSpiritSourceSelf` (target-resolution.ts の TargetSpec `filter` kind 解決) の両消費先が
 * 同一の判定を共有するために切り出した (engine-tx03-continuous-under-card-reacquire)。
 * `only`/`sourceSelf` がいずれも false/未指定なら常に true (フィルタ無効)。
 */
export function matchesActAsSpiritSourceScope(
  state: Pick<GameState, "activeContinuousEffects"> &
    Partial<Pick<GameState, "step" | "activePlayerId">>,
  targetInstanceId: string,
  sourceInstanceId: string,
  scope: { only?: boolean | undefined; sourceSelf?: boolean | undefined }
): boolean {
  if (!scope.only && !scope.sourceSelf) return true;
  if (getActAsSpiritMetadata(state, targetInstanceId) === undefined) {
    return false;
  }
  if (
    scope.sourceSelf &&
    getActAsSpiritSourceInstanceId(state, targetInstanceId) !== sourceInstanceId
  ) {
    return false;
  }
  return true;
}

/**
 * Step 5: act_as_spirit token に付与された制約キーワード一覧を返す。
 *
 * `overrides.keywords` の中身を素直に返す。複数の act_as_spirit CE が同じ token に
 * 重複登録されることは通常無いが、最初の 1 件を採用する (`getActAsSpiritMetadata`
 * の挙動と一貫)。token に CE が無い場合は空配列を返す。
 */
export function getActAsSpiritKeywords(
  state: Pick<GameState, "activeContinuousEffects"> &
    Partial<Pick<GameState, "step" | "activePlayerId">>,
  targetInstanceId: string
): readonly string[] {
  const meta = getActAsSpiritMetadata(state, targetInstanceId);
  return meta?.overrides?.keywords ?? [];
}

/** Step 5: act_as_spirit token が指定キーワードを持つか。 */
export function hasActAsSpiritKeyword(
  state: Pick<GameState, "activeContinuousEffects"> &
    Partial<Pick<GameState, "step" | "activePlayerId">>,
  targetInstanceId: string,
  keyword: string
): boolean {
  return getActAsSpiritKeywords(state, targetInstanceId).includes(keyword);
}

/**
 * Step 5: 「合体できない」制約を保有するか。
 *
 * 供給源は2種類: act_as_spirit overrides.keywords=["cannot_combine"] (token専用)、
 * および印字カード自身の CardDefinition.keywordTags=["cannot_combine"] (BSAZ02-C10
 * 【合体条件：合体不可】等)。definition 省略時は act_as_spirit 経路のみ判定する
 * (呼び出し側が定義を持たない場合の後方互換)。
 * instance ID 省略時は印字だけを評価し、仮想 B 面や定義だけの候補評価にも使える。
 *
 * brave_combine の合体先候補から除外する用途で使う。
 */
export function hasCannotCombineRestriction(
  state: Pick<GameState, "activeContinuousEffects"> &
    Partial<Pick<GameState, "step" | "activePlayerId">>,
  targetInstanceId: string | undefined,
  definition?: CardDefinition
): boolean {
  if (definition?.keywordTags?.includes("cannot_combine")) return true;
  // 仮想転醒など定義だけの候補評価では、印字制約のみを調べる。
  if (targetInstanceId === undefined) return false;
  const overrideHasCannotCombine = getCEsForTarget(
    state,
    targetInstanceId
  ).some((ce) => {
    if (ce.modifierTag !== "override_properties" || !ce.metadata) {
      return false;
    }
    const props = ce.metadata.properties as
      | { keywords?: readonly string[] }
      | undefined;
    return props?.keywords?.includes("cannot_combine") === true;
  });
  if (overrideHasCannotCombine) return true;
  return hasActAsSpiritKeyword(state, targetInstanceId, "cannot_combine");
}

/**
 * engine-deck-derived-clone-spirit: 「分身スピリットは、入れ替えできず、フィールドを
 * 離れたとき、破棄する」制約を保有するか。
 *
 * overrides.keywords=["discard_on_leave"] のみが供給源 (BSAZ01-C12/BSAZ02-C07)。
 * 「入れ替えできず」は本 flag と独立した制約ではなく、公式裁定 (07b §5 分身)
 * 「入れ替えも破棄されるため不可」の通り、本 flag による強制トラッシュ送りの
 * 帰結として自動的に満たされる (入れ替えは対象を手札へ送る前提の効果だが、
 * 手札行きが常にトラッシュへ差し替わるため入れ替え自体が成立しない)。
 * 現状エンジンに「フィールドスピリットを手札カードと入れ替える」汎用効果が
 * 存在しないため、独立した cannot_swap 相当の判定 helper は追加しない。
 *
 * bounce (手札/手元へ戻る) / move_card (デッキ等へ戻る) の実行元で、
 * このカードの移動先をトラッシュへ強制上書きする用途で使う。
 * destroy/vanish は既定で trash 着地のため対象外 (state-based-actions.ts
 * getDefaultLeaveDestinationZone)。
 */
export function hasDiscardOnLeaveRestriction(
  state: Pick<GameState, "activeContinuousEffects"> &
    Partial<Pick<GameState, "step" | "activePlayerId">>,
  targetInstanceId: string
): boolean {
  return hasActAsSpiritKeyword(state, targetInstanceId, "discard_on_leave");
}

/**
 * engine-deck-derived-clone-spirit: 「分身スピリットは、煌臨できず」制約を保有するか。
 *
 * overrides.keywords=["cannot_advent"] のみが供給源。BSAZ02-C07「（分身スピリットは、
 * 煌臨/入れ替えできず...）」にのみ印字されており、BSAZ01-C12「（分身スピリットは、
 * 入れ替えできず...）」には煌臨への言及が無いため両カードで供給元が異なる
 * (adversarial verifier 2026-07-10 round1 で BSAZ02-C07 の煌臨制約欠落を refute
 * された修正)。
 *
 * advent-system.ts の matchesAdventCondition (getAdventTargets/getFContractAdventTargets
 * の nexusTargets が経由) から参照する。getContractAdventTargets の魂状態候補
 * (soulTargets) は matchesAdventCondition を通らず個別判定するため、そちらでも
 * 個別に本 helper を呼ぶ (round2 adversarial verifier 2026-07-10 refute 対応、
 * カード名条件の個別判定と同型)。
 */
export function hasCannotAdventRestriction(
  state: Pick<GameState, "activeContinuousEffects"> &
    Partial<Pick<GameState, "step" | "activePlayerId">>,
  targetInstanceId: string
): boolean {
  return hasActAsSpiritKeyword(state, targetInstanceId, "cannot_advent");
}

/**
 * engine-deck-derived-clone-spirit: act_as_spirit トークンの実効カード色を解決する。
 * 影響下に無い、または snapshot.colors 未指定の場合は undefined
 * (呼び出し側は印字 def.colors へフォールバックする、既存挙動不変)。
 *
 * static_copy のみ対応。live_copy_from の色コピーは使用実績が無いため未対応。
 */
export function resolveActAsSpiritColors(
  state: Pick<GameState, "activeContinuousEffects"> &
    Partial<Pick<GameState, "step" | "activePlayerId">>,
  card: CardInstance
): CardColor[] | undefined {
  const meta = getActAsSpiritMetadata(state, card.instanceId);
  if (!meta) return undefined;
  const blueprint = meta.statBlueprint;
  if (blueprint.kind !== "static_copy") return undefined;
  return blueprint.snapshot.colors ? [...blueprint.snapshot.colors] : undefined;
}

/**
 * engine-deck-derived-clone-spirit: act_as_spirit トークンの実効カード名を解決する。
 * overrides.cardName のみが供給源 (影響下に無い/未指定なら undefined)。
 *
 * P3-47 F-2 で型定義された overrides.cardName はこれまで読み出し側が無く、X04
 * フランドールの "cardName: フランドール・スカーレット" も実際には getEffectiveCardName
 * に反映されていなかった (grep 2026-07-10 確認、消費箇所ゼロ)。本 primitive
 * (BSAZ01-C12「アレイオン」/BSAZ02-C07「スティギス」) はカード名固定が本質的な要件のため
 * ここで配線する。
 */
export function resolveActAsSpiritCardName(
  state: Pick<GameState, "activeContinuousEffects"> &
    Partial<Pick<GameState, "step" | "activePlayerId">>,
  targetInstanceId: string
): string | undefined {
  return getActAsSpiritMetadata(state, targetInstanceId)?.overrides?.cardName;
}

/**
 * engine-deck-derived-clone-spirit: act_as_spirit トークンの実効コストを解決する。
 * 影響下に無い場合は undefined。resolveActAsSpiritCardName と同じ理由
 * (cost aspect 自体は P3-47 時点で ActAsSpiritStatAspect に定義済みだが読み出し側が無かった)
 * でここに新設する。
 */
export function resolveActAsSpiritCost(
  state: Pick<GameState, "activeContinuousEffects" | "cardInstances"> &
    Partial<Pick<GameState, "step" | "activePlayerId">>,
  card: CardInstance,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): number | undefined {
  const meta = getActAsSpiritMetadata(state, card.instanceId);
  if (!meta) return undefined;
  const blueprint = meta.statBlueprint;
  if (blueprint.kind === "static_copy") return blueprint.snapshot.cost;
  if (!blueprint.aspects.includes("cost")) return undefined;
  const sourceCard = state.cardInstances.find(
    (c) => c.instanceId === blueprint.sourceInstanceId
  );
  if (!sourceCard) return undefined;
  return getCardDefinitionById(sourceCard.definitionId)?.cost;
}

// ────────────────────────────────────────────────────────────
// Step 2: BP / Lv 解決
// ────────────────────────────────────────────────────────────

/** 既定の levelDefs から coreCount に基づき到達 Lv を返す。 */
function levelFromCores(
  levelDefs: readonly LevelDefinition[],
  coreCount: number
): number {
  let lv = 0;
  for (const ld of levelDefs) {
    if (coreCount >= ld.requiredCores) lv = Math.max(lv, ld.level);
  }
  return lv;
}

/** 既定の levelDefs から coreCount に基づき到達 BP を返す。 */
function bpFromCores(
  levelDefs: readonly LevelDefinition[],
  coreCount: number
): number {
  if (levelDefs.length === 0) return 0;
  const reached = levelDefs.filter((ld) => ld.requiredCores <= coreCount);
  if (reached.length === 0) return 0;
  return reached.reduce((max, ld) => Math.max(max, ld.bp ?? 0), 0);
}

/**
 * act_as_spirit の影響下にあるカードの実効 BP を解決する。
 * 影響下に無い場合は undefined。
 *
 * - static_copy: snapshot.levelDefs と本カードのコア数で BP 計算
 * - live_copy_from: source カードを参照し、`getEffectiveBp` を循環ガード付きで再帰呼出
 *
 * 循環参照 (A→B→A) は visited で検知して 0 を返す (fallback)。
 */
export function resolveActAsSpiritBp(
  state: GameState,
  card: CardInstance,
  getEffectiveBp: (
    state: GameState,
    card: CardInstance,
    def: CardDefinition,
    visited: ReadonlySet<string>
  ) => number,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  visited: ReadonlySet<string> = new Set()
): number | undefined {
  const meta = getActAsSpiritMetadata(state, card.instanceId);
  if (!meta) return undefined;
  if (visited.has(card.instanceId)) return 0;
  const nextVisited = new Set(visited).add(card.instanceId);

  const blueprint = meta.statBlueprint;
  if (blueprint.kind === "static_copy") {
    const levelDefs = meta.overrides?.levelDefs ?? blueprint.snapshot.levelDefs;
    return bpFromCores(
      levelDefs,
      getTotalCoresOnCardById(state, card.instanceId)
    );
  }
  // live_copy_from
  const sourceCard = state.cardInstances.find(
    (c) => c.instanceId === blueprint.sourceInstanceId
  );
  if (!sourceCard) return 0;
  const sourceDef = getCardDefinitionById(sourceCard.definitionId);
  if (!sourceDef) return 0;
  return getEffectiveBp(state, sourceCard, sourceDef, nextVisited);
}

/**
 * act_as_spirit の影響下にあるカードの実効 Lv を解決する。
 * 影響下に無い場合は undefined。
 *
 * - static_copy: snapshot.levelDefs と本カードのコア数で Lv 算出
 * - live_copy_from: aspects に "currentLv" 含む場合は source の現在 Lv を再帰取得、
 *   含まない場合は source の levelDefs を本カードのコアに適用
 */
export function resolveActAsSpiritLevel(
  state: GameState,
  card: CardInstance,
  getEffectiveLevel: (
    state: GameState,
    card: CardInstance,
    def: CardDefinition,
    visited: ReadonlySet<string>
  ) => number,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  visited: ReadonlySet<string> = new Set()
): number | undefined {
  const meta = getActAsSpiritMetadata(state, card.instanceId);
  if (!meta) return undefined;
  if (visited.has(card.instanceId)) return 0;
  const nextVisited = new Set(visited).add(card.instanceId);

  const blueprint = meta.statBlueprint;
  if (blueprint.kind === "static_copy") {
    const levelDefs = meta.overrides?.levelDefs ?? blueprint.snapshot.levelDefs;
    return levelFromCores(
      levelDefs,
      getTotalCoresOnCardById(state, card.instanceId)
    );
  }
  // live_copy_from
  const sourceCard = state.cardInstances.find(
    (c) => c.instanceId === blueprint.sourceInstanceId
  );
  if (!sourceCard) return 0;
  const sourceDef = getCardDefinitionById(sourceCard.definitionId);
  if (!sourceDef) return 0;

  if (blueprint.aspects.includes("currentLv")) {
    return getEffectiveLevel(state, sourceCard, sourceDef, nextVisited);
  }
  // currentLv 非対象なら source の levelDefs を本カードのコアに適用
  return levelFromCores(
    sourceDef.levelDefs,
    getTotalCoresOnCardById(state, card.instanceId)
  );
}

/**
 * act_as_spirit トークンの実効 levelDefs を解決する。
 * resolveActAsSpiritBp / resolveActAsSpiritLevel と同じ供給源優先順:
 * - overrides.levelDefs (Lvコスト上書き) 最優先
 * - static_copy: snapshot.levelDefs
 * - live_copy_from: source カードの印字 levelDefs
 */
function resolveActAsSpiritEffectiveLevelDefs(
  meta: ActAsSpiritMetadata,
  state: Pick<GameState, "cardInstances">,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): readonly LevelDefinition[] {
  if (meta.overrides?.levelDefs) return meta.overrides.levelDefs;
  const blueprint = meta.statBlueprint;
  if (blueprint.kind === "static_copy") return blueprint.snapshot.levelDefs;
  const sourceCard = state.cardInstances.find(
    (c) => c.instanceId === blueprint.sourceInstanceId
  );
  if (!sourceCard) return [];
  return getCardDefinitionById(sourceCard.definitionId)?.levelDefs ?? [];
}

/** Publicly granted level table, without treating it as printed card data. */
export function resolveActAsSpiritLevelDefinitions(
  state: Pick<GameState, "activeContinuousEffects" | "cardInstances"> &
    Partial<Pick<GameState, "step" | "activePlayerId">>,
  card: CardInstance,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): readonly LevelDefinition[] | undefined {
  const meta = getActAsSpiritMetadata(state, card.instanceId);
  return meta
    ? resolveActAsSpiritEffectiveLevelDefs(meta, state, getCardDefinitionById)
    : undefined;
}

/**
 * act_as_spirit トークンの実効「最低 Lv コスト」(コア不足消滅判定に使う最小必要コア数)
 * を解決する。影響下に無い場合は undefined。
 *
 * カード本文「Lvコスト1 … スピリットとして扱う」(BSTH01-X04 等) に従い、トークンが
 * 疑似スピリットとして維持に必要な最小コア数 = 実効 levelDefs の requiredCores 最小値。
 * これを下回ると state-based-actions の `vanish_due_to_core_deficit` の対象になる。
 *
 * トークンは物理的には裏向きカード (印字 minimumRequiredCores=0 のことが多い) なので、
 * 印字値ではなく act_as_spirit が載せた素性 (levelDefs) から最低コアを導出する。
 * levelDefs が空なら 0 (維持コア不要)。
 */
export function resolveActAsSpiritMinimumRequiredCores(
  state: Pick<GameState, "activeContinuousEffects" | "cardInstances"> &
    Partial<Pick<GameState, "step" | "activePlayerId">>,
  card: CardInstance,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): number | undefined {
  const meta = getActAsSpiritMetadata(state, card.instanceId);
  if (!meta) return undefined;
  const levelDefs = resolveActAsSpiritEffectiveLevelDefs(
    meta,
    state,
    getCardDefinitionById
  );
  if (levelDefs.length === 0) return 0;
  return levelDefs.reduce(
    (min, ld) => Math.min(min, ld.requiredCores),
    Number.POSITIVE_INFINITY
  );
}

/**
 * P3-69: act_as_spirit トークンの実効シンボルを解決する。
 * 影響下に無い場合は undefined。
 *
 * カード本文「同じ…シンボル…を持つ」(BSTH01-X04 等) に従い、
 * - live_copy_from: source カードの実効シンボルを取得 (本体追従)
 * - static_copy: snapshot.symbolColors を固定
 * aspects に "symbolColors" が含まれない blueprint は付与しない (= 空配列)。
 * 循環参照は visited で 0 個 (空) に落とす。
 *
 * 合体スピリットは1体として扱う (05_brave-and-attack-special-cases.md「ブレイヴの
 * シンボルがスピリットに追加」)。分身がコピーする「このスピリット」= 合体ユニット
 * なので、live_copy は合体単位のバンドル取得を呼び出す。色と個数を分離して保持し、
 * 左右合体・仮想合体・シンボル数固定も呼び出し元と同じ正源で評価する。
 */
export function resolveActAsSpiritSymbolBundles(
  state: GameState,
  card: CardInstance,
  getUnitSymbolBundles: (
    state: GameState,
    card: CardInstance,
    def: CardDefinition,
    visited: ReadonlySet<string>
  ) => { colors: SymbolColor[]; count: number }[],
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  visited: ReadonlySet<string> = new Set()
): { colors: SymbolColor[]; count: number }[] | undefined {
  const meta = getActAsSpiritMetadata(state, card.instanceId);
  if (!meta) return undefined;
  if (visited.has(card.instanceId)) return [];
  const nextVisited = new Set(visited).add(card.instanceId);

  const blueprint = meta.statBlueprint;
  if (blueprint.kind === "static_copy") {
    return blueprint.snapshot.symbolColors.map((color) => ({
      colors: [color],
      count: 1,
    }));
  }
  if (!blueprint.aspects.includes("symbolColors")) return [];
  const sourceCard = state.cardInstances.find(
    (c) => c.instanceId === blueprint.sourceInstanceId
  );
  if (!sourceCard) return [];
  const sourceDef = getCardDefinitionById(sourceCard.definitionId);
  if (!sourceDef) return [];
  return getUnitSymbolBundles(state, sourceCard, sourceDef, nextVisited);
}

/**
 * P3-69: act_as_spirit トークンの実効系統 (tribe 文字列「幻想・紅魔…」形式) を解決する。
 * 影響下に無い場合は undefined。aspects に "tribes" が含まれなければ空文字 (系統なし)。
 *
 * - live_copy_from: source カードの印字 tribe を返す (本体追従)
 * - static_copy: snapshot.tribes を「・」連結
 * tribe は静的定義由来のため再帰は不要。
 */
export function resolveActAsSpiritTribes(
  state: Pick<GameState, "activeContinuousEffects" | "cardInstances"> &
    Partial<Pick<GameState, "step" | "activePlayerId">>,
  card: CardInstance,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): string | undefined {
  const meta = getActAsSpiritMetadata(state, card.instanceId);
  if (!meta) return undefined;
  const blueprint = meta.statBlueprint;
  if (blueprint.kind === "static_copy") {
    return blueprint.snapshot.tribes.join("・");
  }
  if (!blueprint.aspects.includes("tribes")) return "";
  const sourceCard = state.cardInstances.find(
    (c) => c.instanceId === blueprint.sourceInstanceId
  );
  if (!sourceCard) return "";
  const sourceDef = getCardDefinitionById(sourceCard.definitionId);
  if (!sourceDef) return "";
  return sourceDef.tribe;
}
