import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { PRINTED_ORACLE_EVENTS } from "./oracle-trigger-kind-detector.mjs";

const GUIDED_ORACLE_BODY_RE =
  /^◆対象の自分のスピリット\/アルティメット\/ブレイヴを召喚\/煌臨したとき、ボイドからコア1個をこのネクサスに置ける。$/;
const GUIDED_PLACEMENT_ORACLE_BODY_RE =
  /^◆このネクサスを配置したとき、同じカード名の自分の(?:導界者|創界神)ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につきボイドからコア1個をこのネクサスに置く。$/;
const GUIDED_ORACLE_CATEGORIES = ["spirit", "ultimate", "brave"];
const MIRAGE_REDUCTION_SYMBOLS = new Set([
  "red",
  "purple",
  "green",
  "white",
  "yellow",
  "blue",
  "black",
  "god",
  "guide",
  "ultimate_symbol",
  "seven",
  "six",
]);
const SOUL_STATE_CONTRACT_COMBINE_TEXT =
  "魂状態のこのカードには【契約合体】できる。このとき、このカードに自分のフィールド/リザーブのコアを好きなだけ置いてスピリット状態にする。";
const SOUL_STATE_CONTRACT_ADVENT_TEXT =
  "魂状態のこのカードには【契約煌臨】できる。このとき、煌臨するカードに自分のフィールド/リザーブのコアを好きなだけ置く。";
const LINK_AID_HEADERS = new Set([
  "【リンクエイド】フラッシュ『お互いのアタックステップ』",
  "【リンクエイド：フラッシュ『お互いのアタックステップ』】",
]);

function sameStringList(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function sameNumberList(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

/** Complete printed manifest profile: count belongs to the player, not target cores. */
export function hasExactManifestCarrier(face, line) {
  const headerRe =
    /^フラッシュ【顕現：「([^」]+)」[&＆](導界者|創界神)ネクサス[&＆]C([0-9]+)以上『自分のメインステップ』】$/;
  const body =
    "自分の《ソウルコア》をトラッシュに置くことで、対象から1コスト支払って手札から召喚する。";
  const headers = (face.textLines ?? []).filter((text) => headerRe.test(text));
  if (
    headers.length !== 1 ||
    !face.textLines.includes(body) ||
    (line !== headers[0] && line !== body)
  )
    return false;
  const [, name, kind, count] = headerRe.exec(headers[0]);
  const data = face.manifestData;
  const filter = data?.targetFilter;
  const condition = data?.condition;
  return (
    face.printedCategory === "spirit" &&
    data?.manifestTiming === "own_main_step" &&
    data.soulCoreDest === "trash" &&
    Object.keys(data).every((key) =>
      ["targetFilter", "condition", "manifestTiming", "soulCoreDest"].includes(
        key
      )
    ) &&
    sameStringList(filter?.category, ["nexus"]) &&
    filter.targetsGrandwalker === true &&
    sameStringList(filter.hasMechanic, [
      kind === "導界者" ? "guided" : "grandwalker",
    ]) &&
    filter.cardName?.contains === name &&
    Object.keys(filter.cardName).length === 1 &&
    Object.keys(filter).every((key) =>
      ["category", "targetsGrandwalker", "hasMechanic", "cardName"].includes(
        key
      )
    ) &&
    Array.isArray(condition) &&
    condition.length === 1 &&
    condition[0]?.kind === "count_value" &&
    condition[0].player === "self" &&
    condition[0].min === Number(count) &&
    Number.isSafeInteger(Number(count)) &&
    Object.keys(condition[0]).every((key) =>
      ["kind", "player", "min"].includes(key)
    )
  );
}

function isPositiveOwnNoContractClause(clause) {
  return (
    clause?.kind === "no_contract_card" &&
    (clause.player === undefined || clause.player === "self") &&
    (clause.negate === undefined || clause.negate === false) &&
    Object.keys(clause).every((key) =>
      ["kind", "player", "negate"].includes(key)
    )
  );
}

/** Only credit the printed entry gate when both summon and, if printed, genkai use it. */
export function hasExactNoContractEntryCarrier(face, line) {
  const header = /^【召喚(?:[／/]現界)?条件[：:]自分が契約していない】$/;
  if (
    !header.test(line) ||
    face.printedCategory !== "ultimate" ||
    !Array.isArray(face.summonCondition) ||
    face.summonCondition.length !== 1 ||
    !isPositiveOwnNoContractClause(face.summonCondition[0])
  )
    return false;
  if (!/[／/]現界/.test(line)) return true;
  const genkai = (face.effects ?? []).filter((effect) =>
    effect.steps?.some((step) => step.action?.effectScope === "genkai")
  );
  if (genkai.length !== 1) return false;
  const effect = genkai[0];
  const gate = effect.condition?.filter(
    (clause) => clause.kind === "no_contract_card"
  );
  return (
    gate?.length === 1 &&
    isPositiveOwnNoContractClause(gate[0]) &&
    effect.timing?.kind === "activated" &&
    effect.timing.mode === "flash" &&
    effect.applicability?.zone === "hand" &&
    effect.steps.some(
      (step) =>
        step.action?.kind === "put" &&
        step.action.effectScope === "genkai" &&
        step.action.target?.kind === "self"
    )
  );
}

const ARTS_SOUL_STATE_HEADER_RE =
  /^【アーツ[：:]\(自分の魂状態の「オーブメント」の属性値が以下を満たしている間、フィールドに置き、フィールドにある間、〔ターンに1回[：:]同名〕アタックステップに使用できる）】$/;
const ARTS_ATTRIBUTE_NAMES = new Set([
  "地",
  "火",
  "水",
  "風",
  "時",
  "空",
  "幻",
]);
// この carrier は、実盤面を各カードについて回帰化した今回の review batch の証拠
// 契約である。似た本文を持つ未確認カードをカード番号だけで除外するものではなく、
// 実盤面証拠のあるカードだけを credit する fail-closed な範囲である。
const ARTS_SOUL_STATE_PLACEMENT_EVIDENCED_CARD_NOS = new Set([
  "BSLH01-T07",
  "BSLH01-T08",
  "BSLH01-T09",
  "BSLH01-T10",
  "BSLH01-T11",
  "BSLH01-T12",
  "BSLH01-T13",
  "BSLH01-T14",
  "BSLH01-T15",
  "BSLH01-T16",
  "BSLH01-T17",
]);

/**
 * 【アーツ】本文の ``〔<地>4 <風>1〕/...`` を、配置条件の OR-of-AND
 * プロファイルへ正規化する。区切りの ``/`` が元データで省かれていても、括弧ごとの
 * 1 グループという原文上の境界は失わない。
 */
function parseArtsAttributeProfile(line) {
  const groups = [...line.matchAll(/〔([^〕]+)〕/g)].map(([, body]) => {
    const attributes = [...body.matchAll(/<([^>]+)>(\d+)/g)].map(
      ([, attribute, min]) => ({ attribute, min: Number(min) })
    );
    const remaining = body.replace(/<([^>]+)>\d+/g, "").trim();
    if (
      !attributes.length ||
      remaining ||
      attributes.some(
        ({ attribute, min }) =>
          !ARTS_ATTRIBUTE_NAMES.has(attribute) ||
          !Number.isSafeInteger(min) ||
          min < 0
      )
    )
      return null;
    return attributes;
  });
  return groups.length && groups.every(Boolean) ? groups : null;
}

function hasExactArtsSoulStatePlacementCarrier(face, line) {
  if (!ARTS_SOUL_STATE_PLACEMENT_EVIDENCED_CARD_NOS.has(face.cardNo)) {
    return false;
  }
  const header = face.textLines?.find((candidate) =>
    ARTS_SOUL_STATE_HEADER_RE.test(candidate)
  );
  const profileLine = face.textLines?.find((candidate) =>
    parseArtsAttributeProfile(candidate)
  );
  const expectedGroups = profileLine
    ? parseArtsAttributeProfile(profileLine)
    : null;
  const condition = face.summonCondition?.[0];
  if (
    !header ||
    !expectedGroups ||
    face.continuousSummonCondition !== true ||
    !Array.isArray(face.summonCondition) ||
    face.summonCondition.length !== 1 ||
    condition?.kind !== "any_of" ||
    !Array.isArray(condition.groups) ||
    condition.groups.length !== expectedGroups.length
  )
    return false;

  const profileMatches = condition.groups.every(
    (actualGroup, groupIndex) =>
      Array.isArray(actualGroup) &&
      actualGroup.length === expectedGroups[groupIndex].length &&
      actualGroup.every((actual, attributeIndex) => {
        const expected = expectedGroups[groupIndex][attributeIndex];
        return (
          actual?.kind === "quartz_attribute" &&
          actual.player === "self" &&
          actual.attribute === expected.attribute &&
          actual.min === expected.min &&
          Object.keys(actual).every((key) =>
            ["kind", "player", "attribute", "min"].includes(key)
          )
        );
      })
  );
  return (
    profileMatches &&
    (line === header ||
      (line === profileLine && parseArtsAttributeProfile(line) !== null))
  );
}

function hasNoAdditionalTribeRestriction(condition) {
  return (
    (condition.tribesLogic === undefined || condition.tribesLogic === "or") &&
    (condition.tribesRequired === undefined ||
      condition.tribesRequired.length === 0) &&
    condition.noTribes !== true &&
    (condition.excludeTribeSubstring === undefined ||
      condition.excludeTribeSubstring.length === 0)
  );
}

function hasExactStandardPlacementOracle(data) {
  const placementOracle = data.placementOracle;
  if (placementOracle === undefined) return true;
  if (!placementOracle || typeof placementOracle !== "object") return false;
  return (
    (placementOracle.revealCount === undefined ||
      placementOracle.revealCount === 3) &&
    placementOracle.sameNameGate !== false &&
    placementOracle.turnLimit === undefined &&
    (placementOracle.remainderDest === undefined ||
      placementOracle.remainderDest === "trash")
  );
}

function hasPlainCannotCombineContinuousCarrier(face) {
  return (
    Array.isArray(face.effects) &&
    face.effects.some(
      (effect) =>
        effect?.timing?.kind === "continuous" &&
        effect.applicability?.level?.min === 1 &&
        Array.isArray(effect.steps) &&
        effect.steps.some(
          (step) =>
            step?.action?.kind === "override_properties" &&
            step.action?.target?.kind === "self" &&
            Array.isArray(step.action?.properties?.keywords) &&
            step.action.properties.keywords.includes("cannot_combine") &&
            step.action?.duration?.scope === "while_on_field"
        )
    )
  );
}

/**
 * `keywordTags.contract` is the engine's SSOT for a player's contract card.
 * It is deliberately paired with the complete printed soul-state rule here:
 * the tag on its own must never account for an empty continuous effect.
 */
function hasSoulStateContractCarrier(face, line) {
  return (
    (line === SOUL_STATE_CONTRACT_COMBINE_TEXT ||
      line === SOUL_STATE_CONTRACT_ADVENT_TEXT) &&
    face.keywordTags?.includes("contract") === true
  );
}

function hasSoulStateContractCombineCarrier(face, line) {
  return (
    line === SOUL_STATE_CONTRACT_COMBINE_TEXT &&
    hasSoulStateContractCarrier(face, line)
  );
}

function hasSoulStateContractAdventCarrier(face, line) {
  return (
    line === SOUL_STATE_CONTRACT_ADVENT_TEXT &&
    hasSoulStateContractCarrier(face, line)
  );
}

function hasExactLinkAidCarrier(face, line) {
  const bodyMatch =
    /^魂状態のこのカードは、系統：「([^」]+)」を持つ自分のスピリットから1コスト支払うことで、リザーブのコアを好きなだけ置いてスピリット状態にする。$/.exec(
      line
    );
  const headerOrBody = LINK_AID_HEADERS.has(line) || bodyMatch !== null;
  if (!headerOrBody) return false;

  const body = (face.textLines ?? []).find((candidate) =>
    /^魂状態のこのカードは、系統：「([^」]+)」を持つ自分のスピリットから1コスト支払うことで、リザーブのコアを好きなだけ置いてスピリット状態にする。$/.test(
      candidate
    )
  );
  const tribeMatch = body
    ? /^魂状態のこのカードは、系統：「([^」]+)」を持つ自分のスピリットから1コスト支払うことで、リザーブのコアを好きなだけ置いてスピリット状態にする。$/.exec(
        body
      )
    : null;
  const data = face.linkAidData;
  return (
    (face.textLines ?? []).some((candidate) =>
      LINK_AID_HEADERS.has(candidate)
    ) &&
    tribeMatch !== null &&
    data?.timingScope?.player === "both" &&
    data?.timingScope?.period === "attack" &&
    sameStringList(data.costSourceTribes, [tribeMatch[1]])
  );
}

function cardTribeParts(card) {
  const tribe = card?.tribe;
  return Array.isArray(tribe)
    ? tribe.filter((part) => typeof part === "string" && part)
    : typeof tribe === "string"
      ? tribe.split("・").filter(Boolean)
      : [];
}

function hasExactUnconditionalTribesCarrier(face, line) {
  // A complete, unconditional identity statement. A field-only/conditional
  // grant or a following action cannot be accounted for by static tribe data.
  const match =
    /^このカード(\/ネクサス)?は、系統：(「[^」]+」(?:\/「[^」]+」)*)を持つ。$/.exec(
      line
    );
  if (!match || (match[1] && face.printedCategory !== "nexus")) return false;
  const expected = [...match[2].matchAll(/「([^」]+)」/g)].map((m) => m[1]);
  const actual = cardTribeParts(face);
  const rawParts = Array.isArray(face.tribe)
    ? face.tribe
    : typeof face.tribe === "string"
      ? face.tribe.split("・")
      : [];
  return (
    rawParts.length === actual.length &&
    new Set(expected).size === expected.length &&
    sameStringList([...actual].sort(), [...expected].sort())
  );
}

function hasExactUltimateAddedTribesCarrier(face, line) {
  const match =
    /^このカード[／/]アルティメットは、系統：(「[^」]+」(?:[／/]「[^」]+」)*)を持つ。$/.exec(
      line
    );
  if (!match || face.printedCategory !== "ultimate") return false;
  const expected = [...match[1].matchAll(/「([^」]+)」/g)].map((m) => m[1]);
  // This sentence adds tribes to the printed tribe box; it does not replace
  // the other innate tribes. Its permission applies outside the field too.
  const actual = cardTribeParts(face);
  return (
    new Set(expected).size === expected.length &&
    expected.every((tribe) => actual.includes(tribe))
  );
}

function hasExactCardAttackStepUsageCarrier(face, line) {
  if (
    face.printedCategory !== "magic" ||
    line !== "このカードは、『お互いのアタックステップ』にしか使えない。"
  )
    return false;
  const activated = (face.effects ?? []).filter(
    (effect) => effect?.timing?.kind === "activated"
  );
  return (
    activated.length > 0 &&
    activated.every(
      (effect) =>
        ["flash", "stack"].includes(effect.timing.mode) &&
        !effect.stub &&
        Array.isArray(effect.steps) &&
        effect.steps.length > 0 &&
        effect.timingScope?.player === "both" &&
        effect.timingScope.period === "attack" &&
        Object.keys(effect.timingScope).length === 2
    )
  );
}

function hasExactSoulStateOnlyFieldCarrier(face, line) {
  if (
    line !==
      "このカードはデッキに1枚しか入れられず、魂状態以外でフィールドに存在できない。" ||
    face.maxDeckCount !== 1
  ) {
    return false;
  }
  return collectEffectContainers(face).some(({ effects }) =>
    effects.some(
      (effect) =>
        effect?.timing?.kind === "activated" &&
        effect.timing?.mode === "main" &&
        effect.executionMode === "optional" &&
        Array.isArray(effect.applicability?.zone) &&
        sameStringList(effect.applicability.zone, ["hand", "set_aside"]) &&
        Array.isArray(effect.steps) &&
        effect.steps.some(
          (step) =>
            step?.action?.kind === "enter_soul_state" &&
            step.action?.target?.kind === "self"
        )
    )
  );
}

function hasExactBraveLimitExemptionCarrier(face, line) {
  const match =
    /^このカード\/ブレイヴは、系統：「([^」]+)」を持つ自分のスピリット\/導界者ネクサスの合体可能体数に数えない。$/.exec(
      line
    );
  if (match === null) return false;
  const condition = face.braveLimitExemption?.hostCondition;
  const alternative = condition?.alternatives?.[0];
  return (
    sameStringList(condition?.categories, ["spirit"]) &&
    sameStringList(condition?.tribes, [match[1]]) &&
    condition?.alternatives?.length === 1 &&
    sameStringList(alternative?.categories, ["nexus"]) &&
    sameStringList(alternative?.tribes, [match[1], "導界者"]) &&
    alternative?.tribesLogic === "and" &&
    alternative?.targetsGrandwalker === "only" &&
    alternative?.grandwalkerKind === "guided"
  );
}

function levelHeaderAt(face, lineIndex) {
  const header = String(face.textLines?.[lineIndex] ?? "");
  if (!/^Lv\d+(?:-Lv\d+)*$/.test(header)) return null;
  return [...header.matchAll(/Lv(\d+)/g)].map((match) => Number(match[1]));
}

function previousNonblankLineIndex(face, lineIndex) {
  const lines = face.textLines ?? [];
  let headerIndex = lineIndex - 1;
  while (headerIndex >= 0 && !String(lines[headerIndex] ?? "").trim()) {
    headerIndex--;
  }
  return headerIndex;
}

function nextNonblankLineIndex(face, lineIndex) {
  const lines = face.textLines ?? [];
  let bodyIndex = lineIndex + 1;
  while (bodyIndex < lines.length && !String(lines[bodyIndex] ?? "").trim()) {
    bodyIndex++;
  }
  return bodyIndex < lines.length ? bodyIndex : -1;
}

function hasScopedBraveCapacityEffect(face, bodyIndex, headerLevels) {
  const index = face.maxCombinedBraves?.effectIndex;
  const effect = Number.isInteger(index) ? face.effects?.[index] : undefined;
  const level = effect?.applicability?.level;
  return (
    headerLevels?.length > 0 &&
    effect?.timing?.kind === "continuous" &&
    effect?.textRef?.includes(bodyIndex) === true &&
    level?.min === headerLevels[0] &&
    level?.max === headerLevels.at(-1)
  );
}

function hasExactTribalMaxCombinedBravesCarrier(
  face,
  line,
  _parentFace,
  lineIndex
) {
  const bodyPattern =
    /^このスピリットは系統：「([^」]+)」を持つブレイヴ(\d+)つまでと?合体できる。$/.exec(
      line
    );
  const directHeaderLevels = levelHeaderAt(face, lineIndex);
  const bodyIndex = directHeaderLevels
    ? nextNonblankLineIndex(face, lineIndex)
    : lineIndex;
  const match =
    bodyPattern ??
    /^このスピリットは系統：「([^」]+)」を持つブレイヴ(\d+)つまでと?合体できる。$/.exec(
      String(face.textLines?.[bodyIndex] ?? "")
    );
  if (match === null) return false;
  const limit = face.maxCombinedBraves;
  const headerLevels =
    directHeaderLevels ??
    levelHeaderAt(face, previousNonblankLineIndex(face, lineIndex));
  if (
    !headerLevels?.length ||
    !sameStringList(headerLevels, [...new Set(headerLevels)])
  ) {
    return false;
  }
  return (
    Number.isInteger(limit?.count) &&
    limit.count === Number(match[2]) &&
    sameStringList(limit.condition?.tribes, [match[1]]) &&
    Object.keys(limit.condition ?? {}).every((key) => key === "tribes") &&
    // This plain permission does not waive incoming combine conditions or
    // rewrite brave effects. Those additional permissions need their own text.
    limit.ignoreIncomingBraveCondition !== true &&
    limit.selfReferenceRewrite === undefined &&
    (limit.nameLimits === undefined || limit.nameLimits.length === 0) &&
    hasScopedBraveCapacityEffect(face, bodyIndex, headerLevels)
  );
}

/**
 * `Lv1『このネクサスの転醒時』` のような見出しは、直後の本文を参照する
 * card_event:rebirth effect の発揮タイミングを宣言する。本文を同じ effect が
 * textRef で参照していることまで確認し、別の転醒効果や本文未参照の effect に
 * 見出しを誤って帰属させない。
 */
function hasAdjacentRebirthTriggerEffect(face, lineIndex) {
  const lines = Array.isArray(face.textLines) ? face.textLines : [];
  const bodyIndex = lines.findIndex(
    (line, index) => index > lineIndex && String(line ?? "").trim() !== ""
  );
  if (bodyIndex === -1) return false;

  return collectEffectContainers(face).some(({ effects }) =>
    effects.some((effect) => {
      if (
        effect?.timing?.kind !== "card_event" ||
        !Array.isArray(effect.textRef) ||
        !effect.textRef.includes(bodyIndex)
      )
        return false;
      const events = Array.isArray(effect.timing.event)
        ? effect.timing.event
        : [effect.timing.event];
      return events.includes("rebirth");
    })
  );
}

/**
 * 「〔tribe & cost〕〔tribe & ultimate〕〔tribe & brave〕」型の導託本文と
 * GrandwalkerData の条件・イベント限定を同時に照合する。本文の3条件を単に
 * `oracleConditions.length > 0` で credit すると、別種別/最低コストの欠落を
 * coverage が見逃すため、BSAZ02-X04/X05 の構文を機械的に比較する。
 */
function hasExactGuidedOracleCarrier(face) {
  const data = face.grandwalkerData;
  if (
    !data ||
    data.kind !== "guided" ||
    !Array.isArray(data.oracleConditions)
  ) {
    return false;
  }
  if (data.oracleConditions.length !== GUIDED_ORACLE_CATEGORIES.length) {
    return false;
  }
  if (!sameStringList(data.oracleTriggerKinds, ["summon", "advent"])) {
    return false;
  }
  if (
    (data.oracleExecutionMode !== undefined &&
      data.oracleExecutionMode !== "optional") ||
    data.oracleTriggerLimit !== undefined
  ) {
    return false;
  }

  const header = face.textLines?.find((text) => /^【導託[：:]/.test(text));
  if (!header) return false;
  const clauses = [...header.matchAll(/〔([^〕]+)〕/g)].map(
    (match) => match[1]
  );
  if (clauses.length !== GUIDED_ORACLE_CATEGORIES.length) return false;

  return clauses.every((clause, index) => {
    const normalized = clause.replaceAll("／", "/").replaceAll("＆", "&");
    const minCost = normalized.match(/(?:^|&)コスト(\d+)以上$/);
    const tribePart = normalized.split("&")[0];
    const expectedTribes = tribePart
      .split("/")
      .map((tribe) => tribe.trim())
      .filter(Boolean);
    const actual = data.oracleConditions[index];
    return (
      actual !== undefined &&
      sameStringList(actual.tribes, expectedTribes) &&
      sameStringList(actual.categories, [GUIDED_ORACLE_CATEGORIES[index]]) &&
      actual.minCost === (minCost ? Number(minCost[1]) : undefined) &&
      (actual.hasMechanic === undefined || actual.hasMechanic.length === 0) &&
      hasNoAdditionalTribeRestriction(actual)
    );
  });
}

function hasTextRefInEffectMatching(face, lineIndex, predicate) {
  return collectEffectContainers(face).some(({ effects }) =>
    effects.some(
      (effect) =>
        Array.isArray(effect?.textRef) &&
        effect.textRef.includes(lineIndex) &&
        predicate(effect)
    )
  );
}

function sameStringSet(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value) => expected.includes(value))
  );
}

/**
 * 導託/神託の通常本文は effects[] ではなく grandwalkerData を carrier にする。
 * 本文から対象種別とイベントを復元し、各 oracleCondition と照合することで、
 * 単に grandwalkerData があるだけの誤 credit を避ける。
 */
function hasExactNormalOracleCarrier(face, line, _parentFace, lineIndex) {
  const match =
    /^◆対象の自分の(スピリット(?:\/(?:アルティメット|ブレイヴ|ネクサス))*)を(召喚\/煌臨(?:\/配置)?)したとき、(?:(?:ボイドから)?コア1個をこのネクサスに置ける|このネクサスにコア\+1できる)。$/.exec(
      line
    );
  if (!match) return false;
  const data = face.grandwalkerData;
  if (
    !data ||
    !["guided", "grandwalker"].includes(data.kind) ||
    !Array.isArray(data.oracleConditions)
  ) {
    return false;
  }
  const declarationHeader = face.textLines?.find((candidate) =>
    /^【(?:導託|神託)[：:]/.test(candidate)
  );
  const expectedKind = /^【導託[：:]/.test(declarationHeader ?? "")
    ? "guided"
    : /^【神託[：:]/.test(declarationHeader ?? "")
      ? "grandwalker"
      : undefined;
  if (data.kind !== expectedKind) return false;
  const expectedCategories = match[1].split("/").map(
    (category) =>
      ({
        スピリット: "spirit",
        アルティメット: "ultimate",
        ブレイヴ: "brave",
        ネクサス: "nexus",
      })[category]
  );
  const expectedEvents = match[2]
    .split("/")
    .map((event) => PRINTED_ORACLE_EVENTS[event]);
  const declaredEvents = data.oracleTriggerKinds;
  return (
    data.oracleConditions.length === expectedCategories.length &&
    data.oracleConditions.every(
      (condition, index) =>
        sameStringList(condition?.categories, [expectedCategories[index]]) &&
        hasNoAdditionalTribeRestriction(condition)
    ) &&
    sameStringSet(declaredEvents, expectedEvents) &&
    data.oracleExecutionMode === undefined &&
    (data.oracleTriggerLimit === undefined ||
      (data.oracleTriggerLimit === "step_once" &&
        declarationHeader?.includes("ステップに1回"))) &&
    // 本文を実行する effect が二重に存在しないことも確認する。grandwalkerData が
    // 唯一の実行 carrier であり、直後本文を effects に見せかけていない。
    !hasTextRefInEffectMatching(face, lineIndex, () => true)
  );
}

function hasExactNormalPlacementOracleCarrier(face, line) {
  const match =
    /^◆このネクサスを配置したとき、同じカード名の自分の(導界者|創界神)ネクサスがなければ、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につき(?:(?:ボイドから)?コア1個をこのネクサスに置く|このネクサスにコア\+1する)。$/.exec(
      line
    );
  if (!match) return false;
  const data = face.grandwalkerData;
  const expectedKind = match[1] === "導界者" ? "guided" : "grandwalker";
  return (
    data?.kind === expectedKind &&
    hasExactStandardPlacementOracle(data) &&
    face.textLines?.some((candidate, index) =>
      hasExactNormalOracleCarrier(face, candidate, undefined, index)
    ) === true
  );
}

const PRINTED_ORACLE_CATEGORIES = {
  スピリット: "spirit",
  アルティメット: "ultimate",
  ブレイヴ: "brave",
  ネクサス: "nexus",
  マジック: "magic",
};
const PRINTED_ORACLE_COLORS = {
  赤: "red",
  紫: "purple",
  緑: "green",
  白: "white",
  黄: "yellow",
  青: "blue",
  黒: "black",
};

// OR clauses may combine categories with otherwise identical restrictions.
// Expand only the category dimension: every color/tribe/cost/mechanic remains
// attached to its own branch, so merging unrelated OR restrictions cannot pass.
function oracleConditionSignatures(conditions) {
  if (!Array.isArray(conditions)) return null;
  const signatures = [];
  for (const condition of conditions) {
    if (
      !condition ||
      Object.keys(condition).some(
        (key) =>
          ![
            "tribes",
            "tribesLogic",
            "categories",
            "minCost",
            "hasMechanic",
            "colors",
            "colorCount",
          ].includes(key)
      ) ||
      !Array.isArray(condition.categories) ||
      condition.categories.length === 0 ||
      new Set(condition.categories).size !== condition.categories.length
    )
      return null;
    for (const category of condition.categories) {
      signatures.push(
        JSON.stringify({
          category,
          tribes: condition.tribes,
          tribesLogic: condition.tribesLogic ?? "or",
          minCost: condition.minCost,
          hasMechanic: condition.hasMechanic,
          colors: condition.colors,
          colorCount: condition.colorCount,
        })
      );
    }
  }
  return signatures.sort();
}
const normalizeOracleText = (text) =>
  text
    .replaceAll(" ", "")
    .replaceAll("／", "/")
    .replaceAll("＆", "&")
    .replaceAll("：", ":")
    .replaceAll("[", "〔")
    .replaceAll("]", "〕");

/**
 * 印字された OR 条件を構造化 carrier と照合する。バッチで個別の盤面証拠を
 * 登録した行だけに使うため、未確認の同型カードへの自動 credit はしない。
 * AND 系統・複数カテゴリ・転醒ネクサスは別々の意味として復元する。
 */
export function hasExactPrintedOracleCarrier(
  face,
  line,
  { normalOnly = false } = {}
) {
  const lines = (face.textLines ?? []).map(normalizeOracleText);
  const header = lines.find((candidate) =>
    /^【(?:真・)?(?:導託|神託):/.test(candidate)
  );
  const body = lines.find((candidate) => /^◆対象の自分の/.test(candidate));
  const bodyMatch =
    /^◆対象の自分の((?:スピリット|アルティメット|ブレイヴ|ネクサス|マジック)(?:\/(?:スピリット|アルティメット|ブレイヴ|ネクサス|マジック))*)を((?:召喚|煌臨|配置|使用|アクセル使用)(?:\/(?:召喚|煌臨|配置|使用|アクセル使用))*)したとき、(?:ボイドからコア1個をこのネクサスに置ける|このネクサスにコア\+1できる)。$/.exec(
      (body ?? "").replace(
        "の召喚/煌臨/【アクセル】の使用をしたとき、",
        "を召喚/煌臨/アクセル使用したとき、"
      )
    );
  const headerMatch =
    /^【(真・)?(導託|神託):((?:〔[^〕]+〕)+|[^〔〕]+)】$/.exec(header ?? "");
  const data = face.grandwalkerData;
  if (!headerMatch || !bodyMatch || !data) return false;
  const categories = bodyMatch[1]
    .split("/")
    .map((category) => PRINTED_ORACLE_CATEGORIES[category]);
  const events = bodyMatch[2]
    .split("/")
    .map((event) => PRINTED_ORACLE_EVENTS[event]);
  const clauses = [
    ...(headerMatch[3].startsWith("〔")
      ? headerMatch[3]
      : `〔${headerMatch[3]}〕`
    ).matchAll(/〔([^〕]+)〕/g),
  ].map((match) => match[1]);
  // 独立してカテゴリを印字した枝がある場合、種別のない枝は残りの本文カテゴリ。
  // 例: 〔妖精〕〔妖精&アルティメット〕の先頭はスピリットにだけ対応する。
  const explicitCategories = clauses.flatMap((clause) =>
    clause === "ブレイヴ&【アクセル】を持つ"
      ? ["brave"]
      : clause
          .split("&")
          .flatMap((term) =>
            term.split("/").every((value) => PRINTED_ORACLE_CATEGORIES[value])
              ? term.split("/").map((value) => PRINTED_ORACLE_CATEGORIES[value])
              : []
          )
  );
  const conditions = clauses.map((clause) => {
    if (clause === "導界者ネクサス")
      return { categories: ["nexus"], hasMechanic: ["guided"] };
    if (clause === "転醒ネクサス")
      return { categories: ["nexus"], hasMechanic: ["rebirth"] };
    if (clause === "ブレイヴ&【アクセル】を持つ")
      return { categories: ["brave"], hasMechanic: ["accel"] };
    if (clause === "スタック効果&マジック")
      return { categories: ["magic"], hasMechanic: ["stack_effect"] };
    const terms = clause.split("&");
    const costTerm = terms.find((term) => /^コスト\d+以上$/.test(term));
    const colorTerm = terms.find((term) => /^[赤紫緑白黄青黒]1色$/.test(term));
    const categoryTerm = terms.find((term) =>
      term.split("/").every((value) => PRINTED_ORACLE_CATEGORIES[value])
    );
    const tribeTerms = terms.filter(
      (term) => term !== costTerm && term !== categoryTerm && term !== colorTerm
    );
    if (
      (tribeTerms.length === 0 && !colorTerm) ||
      tribeTerms.some((term) => /コスト|転醒|〔|〕|\d+色/.test(term)) ||
      (tribeTerms.length > 1 && tribeTerms.some((term) => term.includes("/")))
    )
      return null;
    const defaultCategories = categories.filter(
      (category) => !explicitCategories.includes(category)
    );
    return {
      ...(tribeTerms.length > 0
        ? { tribes: tribeTerms.flatMap((term) => term.split("/")) }
        : {}),
      ...(tribeTerms.length > 1 ? { tribesLogic: "and" } : {}),
      ...(colorTerm
        ? { colors: [PRINTED_ORACLE_COLORS[colorTerm[0]]], colorCount: "mono" }
        : {}),
      categories: categoryTerm
        ? categoryTerm
            .split("/")
            .map((value) => PRINTED_ORACLE_CATEGORIES[value])
        : defaultCategories,
      ...(costTerm ? { minCost: Number(costTerm.match(/\d+/)[0]) } : {}),
    };
  });
  const expectedSignatures = oracleConditionSignatures(conditions);
  const actualSignatures = oracleConditionSignatures(data.oracleConditions);
  const exactConditions =
    expectedSignatures !== null &&
    actualSignatures !== null &&
    sameStringList(actualSignatures, expectedSignatures);
  if (
    data.kind !== (headerMatch[2] === "導託" ? "guided" : "grandwalker") ||
    !exactConditions ||
    !sameStringSet(data.oracleTriggerKinds, events) ||
    new Set(data.oracleTriggerKinds).size !== events.length ||
    ![undefined, "optional"].includes(data.oracleExecutionMode) ||
    data.oracleTriggerLimit !== undefined ||
    data.placementOracleReturnToHand !== undefined
  )
    return false;
  // 通常神託と配置時神託は独立した本文。配置時に独自DSLを使うカードでも、
  // 通常本文だけを印字対象・イベント・任意性と厳密照合できる。
  if (normalOnly) {
    return (
      [header, body].includes(normalizeOracleText(line)) &&
      !face.textLines.some(
        (candidate, index) =>
          [header, body].includes(normalizeOracleText(candidate)) &&
          hasTextRefInEffectMatching(face, index, () => true)
      )
    );
  }
  const placement = lines.find((candidate) =>
    /^◆(?:〔ターンに1回:同名〕)?このネクサスを配置したとき、/.test(candidate)
  );
  const placementMatch =
    /^◆(〔ターンに1回:同名〕)?このネクサスを配置したとき、(?:同じカード名の自分の(導界者|創界神)ネクサスがなければ、)?自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につき、?(?:ボイドからコア1個をこのネクサスに置く|このネクサスにコア\+1する)。$/.exec(
      placement ?? ""
    );
  if (!placementMatch) return false;
  if (
    data.placementOracle &&
    Object.keys(data.placementOracle).some(
      (key) =>
        !["sameNameGate", "turnLimit", "revealCount", "remainderDest"].includes(
          key
        )
    )
  )
    return false;
  if (headerMatch[1]) {
    if (
      !placementMatch[1] ||
      placementMatch[2] ||
      data.placementOracle?.sameNameGate !== false ||
      data.placementOracle?.turnLimit !== "per_card_name" ||
      ![undefined, 3].includes(data.placementOracle?.revealCount) ||
      ![undefined, "trash"].includes(data.placementOracle?.remainderDest)
    )
      return false;
  } else if (
    placementMatch[1] ||
    (placementMatch[2]
      ? placementMatch[2] !== (data.kind === "guided" ? "導界者" : "創界神") ||
        !hasExactStandardPlacementOracle(data)
      : data.placementOracle?.sameNameGate !== false ||
        data.placementOracle?.turnLimit !== undefined ||
        ![undefined, 3].includes(data.placementOracle?.revealCount) ||
        ![undefined, "trash"].includes(data.placementOracle?.remainderDest))
  )
    return false;
  return (
    [header, body, placement].includes(normalizeOracleText(line)) &&
    !face.textLines.some(
      (candidate, index) =>
        [header, body, placement].includes(normalizeOracleText(candidate)) &&
        hasTextRefInEffectMatching(face, index, () => true)
    )
  );
}

// These hooks have fixed runtime contracts: blue magic payment at Lv1/Lv2,
// and mandatory four-card mill plus one core after a blue stack magic resolves
// at Lv2. Keep both printed bodies and all hooks exact; hook presence alone is
// insufficient evidence, and card numbers do not participate in matching.
export function hasExactBlueMagicDomainCarrier(face, line) {
  const bodies = [
    "【導域】Lv1-Lv2",
    "自分の青のマジックカードの使用コストは、このネクサスからボイドに支払うこともできる。",
    "【導域】Lv2",
    "自分の青のマジックカードのスタック効果が発揮されたとき、相手のデッキを上から4枚破棄し、ボイドからコア1個をこのネクサスに置く。",
  ];
  const lines = face.textLines ?? [];
  const paymentHeader = lines.indexOf(bodies[0]);
  const stackHeader = lines.indexOf(bodies[2]);
  return (
    bodies.includes(line) &&
    bodies.every(
      (body) => lines.filter((candidate) => candidate === body).length === 1
    ) &&
    lines[paymentHeader + 1] === bodies[1] &&
    lines[stackHeader + 1] === bodies[3] &&
    face.grandwalkerData?.kind === "grandwalker" &&
    sameStringSet(face.grandwalkerData.domainHooks, [
      "blue_magic_void_payment",
      "blue_magic_stack_domain",
    ]) &&
    new Set(face.grandwalkerData.domainHooks).size === 2 &&
    face.grandwalkerData.domainHooks.length === 2 &&
    sameStringSet(
      face.levelDefs?.map((definition) => definition.level),
      [1, 2]
    ) &&
    new Set(face.levelDefs.map((definition) => definition.level)).size === 2 &&
    face.levelDefs.length === 2 &&
    !lines.some(
      (candidate, index) =>
        bodies.includes(candidate) &&
        hasTextRefInEffectMatching(face, index, () => true)
    )
  );
}

function hasExactAlternateContractAdventCarrier(face, line) {
  const countMatch =
    /^〔ターンに1回[：:]同名〕このカードは、相手のアタックステップで自分のカウント(\d+)以上なら、《ソウルコア》をトラッシュに置いたものとして【契約煌臨】できる。$/.exec(
      line
    );
  const trashMatch =
    /^〔ターンに1回[：:]同名〕相手のアタックステップ中、自分のトラッシュが(\d+)枚以上のとき、このカードは、《ソウルコア》をトラッシュに置いたものとして【契約煌臨】できる。$/.exec(
      line
    );
  if (!countMatch && !trashMatch) return false;
  const alternate = face.adventData?.alternateCostAdvent;
  const condition = alternate?.condition?.[0];
  const sharedContractAdvent =
    face.adventData?.adventVariant === "contract" &&
    face.adventData?.soulCoreDest === "trash" &&
    alternate?.timing === "opponent_attack_step" &&
    alternate.condition?.length === 1;
  if (!sharedContractAdvent) return false;
  if (countMatch) {
    return (
      face.adventData?.adventTiming === "both_attack_step" &&
      condition?.kind === "count_value" &&
      condition.player === "self" &&
      condition.min === Number(countMatch[1]) &&
      Object.keys(condition).every((key) =>
        ["kind", "player", "min"].includes(key)
      )
    );
  }
  return (
    face.adventData?.adventTiming === "main_and_flash" &&
    condition?.kind === "cards_in_zone" &&
    condition.player === "self" &&
    condition.zone === "trash" &&
    condition.min === Number(trashMatch[1]) &&
    Object.keys(condition).every((key) =>
      ["kind", "player", "zone", "min"].includes(key)
    )
  );
}

function hasExactContractAdventSelfCoreCarrier(face, line) {
  const match =
    /^〔ターンに1回[：:]同名〕このカードを手札から魂状態\/煌臨元を含む対象に重ねることで、自分の《ソウルコア》をこのスピリットに置く。$/.exec(
      line
    );
  if (!match) return false;
  const data = face.adventData;
  const condition = data?.adventCondition;
  const declareCondition = data?.declareCondition?.[0];
  const sourceAddition = data?.beforeAdventSourceAddition;
  return (
    Array.isArray(face.textLines) &&
    face.textLines.includes(
      "フラッシュ【超契約煌臨：「水篠 旬」＆契約スピリット＆C7以上『自分のターン』】"
    ) &&
    data?.adventVariant === "contract" &&
    data.adventTiming === "own_turn" &&
    data.soulCoreDest === "this_card" &&
    data.includeAdventSourceTarget === true &&
    data.declareUsageLimit?.kind === "per_card_name" &&
    data.declareUsageLimit?.duration === "turn" &&
    data.declareCondition?.length === 1 &&
    declareCondition?.kind === "count_value" &&
    declareCondition.player === "self" &&
    declareCondition.min === 7 &&
    Object.keys(declareCondition).every((key) =>
      ["kind", "player", "min"].includes(key)
    ) &&
    condition?.isContract === true &&
    sameStringList(condition.targetCategory, ["spirit"]) &&
    condition.cardNames?.length === 1 &&
    condition.cardNames[0]?.contains === "水篠 旬" &&
    Object.keys(condition.cardNames[0]).every((key) => key === "contains") &&
    Object.keys(condition).every((key) =>
      ["cardNames", "isContract", "targetCategory"].includes(key)
    ) &&
    sameStringList(sourceAddition?.fromZones, ["hand", "trash"]) &&
    sameStringList(sourceAddition?.filter?.tribes, ["プレイヤー"]) &&
    Object.keys(sourceAddition?.filter ?? {}).every(
      (key) => key === "tribes"
    ) &&
    sameNumberList(sourceAddition?.textRef, [3]) &&
    Object.keys(sourceAddition ?? {}).every((key) =>
      ["fromZones", "filter", "textRef"].includes(key)
    ) &&
    Object.keys(data).every((key) =>
      [
        "adventCondition",
        "adventTiming",
        "soulCoreDest",
        "adventVariant",
        "includeAdventSourceTarget",
        "declareUsageLimit",
        "declareCondition",
        "beforeAdventSourceAddition",
      ].includes(key)
    )
  );
}

function hasExactSpacedContractAdventHeaderCarrier(face, line) {
  const match = /^フラッシュ 【契約煌臨：「([^」]+)」『自分のターン』】$/.exec(
    line
  );
  if (!match) return false;
  const data = face.adventData;
  const condition = data?.adventCondition;
  return (
    data?.adventVariant === "contract" &&
    data.adventTiming === "own_turn" &&
    data.soulCoreDest === "trash" &&
    sameStringList(condition?.targetCategory, ["spirit"]) &&
    condition?.cardNames?.length === 1 &&
    condition.cardNames[0]?.contains === match[1] &&
    Object.keys(condition.cardNames[0] ?? {}).every(
      (key) => key === "contains"
    ) &&
    Object.keys(condition).every((key) =>
      ["cardNames", "targetCategory"].includes(key)
    ) &&
    Object.keys(data).every((key) =>
      [
        "adventCondition",
        "adventTiming",
        "soulCoreDest",
        "adventVariant",
      ].includes(key)
    )
  );
}

function hasExactTenshoSummonCarrier(face, line) {
  const headerIndex = face.textLines?.findIndex((candidate) =>
    /^【転召：\d+／[^＆／]+＆コスト\d+以上／ボイド】$/.test(candidate)
  );
  if (headerIndex === undefined || headerIndex < 0) return false;
  const header = face.textLines?.[headerIndex];
  const bodyIndex = nextNonblankLineIndex(face, headerIndex);
  const body = bodyIndex < 0 ? undefined : face.textLines?.[bodyIndex];
  const headerMatch =
    /^【転召：(\d+)／([^＆／]+)＆コスト(\d+)以上／(ボイド)】$/.exec(
      header ?? ""
    );
  const bodyMatch =
    /^召喚コスト支払い後、対象の自分のスピリット1体の上のコアすべて（最低(\d+)個）を(ボイド)に置かなければならない。$/.exec(
      body ?? ""
    );
  if (!headerMatch || !bodyMatch) return false;
  const data = face.tenshoSummon;
  const filter = data?.targetFilter;
  const expectedMinCores = Number(headerMatch[1]);
  return (
    (line === header || line === body) &&
    sameStringList(filter?.category, ["spirit"]) &&
    sameStringList(filter?.tribesRequired, [headerMatch[2]]) &&
    filter?.minCost === Number(headerMatch[3]) &&
    Object.keys(filter ?? {}).every((key) =>
      ["category", "tribesRequired", "minCost"].includes(key)
    ) &&
    data?.minCores === expectedMinCores &&
    data.destination === "void" &&
    headerMatch[4] === bodyMatch[2] &&
    expectedMinCores === Number(bodyMatch[1]) &&
    Object.keys(data ?? {}).every((key) =>
      ["targetFilter", "minCores", "destination"].includes(key)
    )
  );
}

function hasExactGrandstoneCarrier(face, line) {
  const data = face.grandstoneData;
  if (
    !data ||
    face.keywordTags?.includes("enter_field_core_placement_forbidden") !== true
  )
    return false;

  const coreRule =
    "このネクサスは創界石ネクサス対象の効果しか受けない。このネクサスには解放と創界石ネクサス対象の効果でしかコアを置けず、そのコアは創界石ネクサス対象の効果しか受けず移動できない。";
  if (line === coreRule) return true;

  const unsealHeader =
    /^【解封：〔カード名に「([^」]+)」を含む／系統：「([^」]+)」を持つ自分のスピリットの(召喚／アタック)〕】$/.exec(
      line
    );
  if (unsealHeader) {
    const [nameCondition, tribeCondition] = data.unsealConditions ?? [];
    return (
      data.unsealConditions?.length === 2 &&
      sameStringList(
        nameCondition?.events,
        unsealHeader[3]
          .split("／")
          .map((event) => (event === "召喚" ? "summon" : "attack"))
      ) &&
      sameStringList(nameCondition?.cardFilter?.categories, ["spirit"]) &&
      sameStringList(nameCondition?.cardFilter?.nameContains, [
        unsealHeader[1],
      ]) &&
      Object.keys(nameCondition?.cardFilter ?? {}).every((key) =>
        ["categories", "nameContains"].includes(key)
      ) &&
      sameStringList(tribeCondition?.events, ["summon", "attack"]) &&
      sameStringList(tribeCondition?.cardFilter?.categories, ["spirit"]) &&
      sameStringList(tribeCondition?.cardFilter?.tribes, [unsealHeader[2]]) &&
      Object.keys(tribeCondition?.cardFilter ?? {}).every((key) =>
        ["categories", "tribes"].includes(key)
      )
    );
  }

  if (
    line ===
    "◆解放条件を満たしたとき、ボイドからコア1個をこのネクサスに置ける。"
  ) {
    return data.unsealConditions?.length === 2;
  }

  const rebirthHeader =
    /^Lv\d+【転醒：自分のカウント(\d+)以下（転醒は同時に使えない）】$/.exec(
      line
    );
  // Both queueing and resolving stone rebirth require a real second face.
  // A threshold/postRebirth record alone cannot implement the printed flip.
  if (face.isDoubleSided !== true || !face.backFace) return false;
  if (rebirthHeader) return data.rebirthMaxCount === Number(rebirthHeader[1]);

  const rebirthBody =
    /^このネクサスのコアが(\d+)個以上になったとき、このネクサスを裏返せる。（置かれているコアすべてをボイドに置く。）このとき、この転醒後ブレイヴは自分のスピリットに合体できる。$/.exec(
      line
    );
  return (
    rebirthBody !== null &&
    face.backFace.printedCategory === "brave" &&
    data.rebirthCoreThreshold === Number(rebirthBody[1]) &&
    data.rebirthRetainCores === 0 &&
    data.postRebirth === "combine_with_own_spirit"
  );
}

// These printed variants use the same engine primitive, but their complete OR
// filters and post-rebirth behavior differ from the original Hakurei profile.
// Compare the whole data record: extra filters/events or an unprinted post-choice
// must not earn credit merely because one source line looks familiar.
function hasExactPrintedGrandstoneCarrier(face, line) {
  const lines = face.textLines ?? [];
  const header = lines.find((text) => text.startsWith("【解封："));
  let unsealConditions;
  if (
    header ===
    "【解封：〔自分の「アリス邸」／系統：「導魔」／「動玩」を持つスピリットの召喚／転醒〕】"
  ) {
    unsealConditions = [
      {
        events: ["summon", "rebirth"],
        cardFilter: { nameContains: ["アリス邸"] },
      },
      {
        events: ["summon", "rebirth"],
        cardFilter: { tribes: ["導魔", "動玩"], categories: ["spirit"] },
      },
    ];
  } else {
    const attack =
      /^【解封：〔系統：「([^」]+)」を持つ自分のスピリットのアタック〕】$/.exec(
        header ?? ""
      );
    const hand =
      /^【解封：〔系統：(「[^」]+」(?:／「[^」]+」)*)を持つ自分の(青の)?効果による自分の手札の増加〕】$/.exec(
        header ?? ""
      );
    if (attack) {
      unsealConditions = [
        {
          events: ["attack"],
          cardFilter: { tribes: [attack[1]], categories: ["spirit"] },
        },
      ];
    } else if (hand) {
      unsealConditions = [
        {
          events: ["hand_increase"],
          causeFilter: {
            tribes: [...hand[1].matchAll(/「([^」]+)」/g)].map(
              (match) => match[1]
            ),
            ...(hand[2] ? { colors: ["blue"] } : {}),
          },
        },
      ];
    } else return false;
  }

  const countHeader = lines.find((text) => /^Lv\d+【転醒：/.test(text));
  const count =
    /^Lv1【転醒：自分のカウント(\d+)以下（転醒は同時に使えない）】$/.exec(
      countHeader ?? ""
    );
  const body = lines.find((text) => text.startsWith("このネクサスのコアが"));
  const combine =
    /^このネクサスのコアが(\d+)個以上になったとき、このネクサスを裏返せる。（置かれているコアすべてはボイドに置かれる）このとき、この転醒後ブレイヴは自分のスピリットに合体できる。この転醒で【解封】はできない。$/.exec(
      body ?? ""
    );
  const retain =
    /^このネクサスのコアが(\d+)個以上になったとき、このネクサスを裏返せる。（置かれているコアは1個を残してボイドに置く。）(このとき、自分のフィールド\/リザーブのコアを好きなだけこの転醒後スピリットに置ける。)?$/.exec(
      body ?? ""
    );
  if (
    !count ||
    (!combine && !retain) ||
    face.isDoubleSided !== true ||
    !face.backFace ||
    face.backFace.printedCategory !== (combine ? "brave" : "spirit") ||
    !face.keywordTags?.includes("enter_field_core_placement_forbidden")
  )
    return false;
  const expected = {
    unsealConditions,
    rebirthCoreThreshold: Number((combine ?? retain)[1]),
    rebirthMaxCount: Number(count[1]),
    rebirthRetainCores: combine ? 0 : 1,
    ...(combine
      ? {
          postRebirth: "combine_with_own_spirit",
          rebirthExcludedFromUnseal: true,
        }
      : retain[2]
        ? { postRebirth: "charge_cores_from_field_reserve" }
        : {}),
  };
  const exact = (actual, wanted) => {
    if (wanted === null || typeof wanted !== "object") return actual === wanted;
    if (
      !actual ||
      typeof actual !== "object" ||
      Array.isArray(actual) !== Array.isArray(wanted)
    )
      return false;
    const keys = Object.keys(wanted);
    return (
      Object.keys(actual).length === keys.length &&
      keys.every((key) => exact(actual[key], wanted[key]))
    );
  };
  if (!exact(face.grandstoneData, expected)) return false;
  return (
    line === header ||
    line === body ||
    /^◆ ?解[封放]条件を満たしたとき、ボイドからコア1個をこのネクサスに置ける。$/.test(
      line
    ) ||
    line ===
      "このネクサスは創界石ネクサス対象の効果しか受けない。このネクサスには解封と創界石ネクサス対象の効果でしかコアを置けず、そのコアは創界石ネクサス対象の効果しか受けず移動できない。"
  );
}

function hasExactMirageSetCountExemptionCarrier(face, line) {
  return (
    line ===
      "セットしている/手札にあるこのカードは、自分のセット可能枚数に数えない。この効果は重複せず、ターンに1回しか使えない。" &&
    face.mirageData?.exemptSetCountLimits === true &&
    face.mirageData?.cost === 2 &&
    sameStringList(face.mirageData?.reduction, ["purple"])
  );
}

function hasExactDivineSkillHeaderCarrier(face, line, _parentFace, lineIndex) {
  const match =
    /^【神技：(\d+)】(?:フラッシュ )?Lv(\d+)(?:-Lv(\d+))?『(自分のメインステップ|お互いのアタックステップ)』$/.exec(
      line
    );
  if (!match) return false;
  const [, rawCost, rawMinLevel, rawMaxLevel, sourceTiming] = match;
  const cost = Number(rawCost);
  const minLevel = Number(rawMinLevel);
  const maxLevel = rawMaxLevel ? Number(rawMaxLevel) : minLevel;
  return (face.grandwalkerData?.divineSkills ?? []).some((skill) => {
    const timingMatches =
      (sourceTiming === "自分のメインステップ" && skill.timing === "main") ||
      (sourceTiming === "お互いのアタックステップ" &&
        skill.timing?.step === "attack" &&
        skill.timing?.whose === "both" &&
        skill.timing?.mode === "flash");
    return (
      skill.label === "divine_skill" &&
      skill.coreCost === cost &&
      skill.minLevel === minLevel &&
      (skill.maxLevel ?? skill.minLevel) === maxLevel &&
      timingMatches &&
      Array.isArray(skill.effects) &&
      skill.effects.some((effect) => effect?.textRef?.includes(lineIndex + 1))
    );
  });
}

function hasExactSummonTimingHeaderCarrier(face, line, _parentFace, lineIndex) {
  const match = /^Lv(\d+)(?:-Lv(\d+))?『このスピリットの召喚時』$/.exec(line);
  if (!match) return false;
  const minLevel = Number(match[1]);
  const maxLevel = Number(match[2] ?? match[1]);
  const allLevelsCovered =
    Array.isArray(face.levelDefs) &&
    face.levelDefs.length > 0 &&
    face.levelDefs.every(
      (level) => level.level >= minLevel && level.level <= maxLevel
    );
  if (!allLevelsCovered) return false;
  const body = face.textLines?.[nextNonblankLineIndex(face, lineIndex)] ?? "";
  const expectsSwapTrigger =
    body.includes("手札から入れ替えたときにも発揮できる");
  return hasTextRefInEffectMatching(
    face,
    nextNonblankLineIndex(face, lineIndex),
    (effect) => {
      if (effect?.timing?.kind !== "card_event") return false;
      const events = Array.isArray(effect.timing.event)
        ? effect.timing.event
        : [effect.timing.event];
      return expectsSwapTrigger
        ? sameStringSet(events, ["summon", "field_hand_swap"])
        : sameStringList(events, ["summon"]);
    }
  );
}

function hasExactHostDualAdventGrantCarrier(face, line) {
  const match =
    /^自分は、「([^」]+)」を《ソウルコア》をトラッシュに置いたものとしてこのスピリットに【煌臨】できる。$/.exec(
      line
    );
  if (!match) return false;
  const data = face.hostDualAdventGrant;
  const slot = data?.slots?.[0];
  return (
    data?.slots?.length === 1 &&
    slot?.cardNames?.length === 1 &&
    slot.cardNames[0]?.contains === match[1] &&
    Object.keys(slot.cardNames[0] ?? {}).length === 1 &&
    data.timing === "main_and_flash" &&
    data.normalPathDisabled === true &&
    data.alternateCost?.timing === "main_and_flash" &&
    data.alternateCost?.turnLimitDisabled === true
  );
}

function hasExactDualHostAdventCarrier(face, line, _parentFace, lineIndex) {
  const headerIndex = /^フラッシュ【煌臨：/.test(line)
    ? lineIndex
    : previousNonblankLineIndex(face, lineIndex);
  const header = face.textLines?.[headerIndex];
  const match =
    /^フラッシュ【煌臨：「([^」]+)」1体＆「([^」]+)」1体＆どちらもコスト(\d+)以上『自分のターン』】$/.exec(
      header ?? ""
    );
  if (
    !match ||
    ![
      header,
      "自分の《ソウルコア》をトラッシュに置くことで、対象の自分のスピリット2体に手札から重ねる。",
    ].includes(line)
  )
    return false;
  const data = face.dualHostAdventData;
  return (
    data?.adventTiming === "own_turn" &&
    data.soulCoreDest === "trash" &&
    data.hostSlotConditions?.length === 2 &&
    data.hostSlotConditions.every(
      (slot, index) =>
        slot?.cardNames?.length === 1 &&
        slot.cardNames[0]?.contains === match[index + 1] &&
        slot.minCost === Number(match[3]) &&
        sameStringList(slot.targetCategory, ["spirit"])
    )
  );
}

const TRUE_GUIDED_ORACLE_HEADER = "【真・導託：〔８６＆ブレイヴ〕】";
const TRUE_GUIDED_ORACLE_SUMMON_BODY =
  "◆対象の自分のブレイヴを召喚したとき、このネクサスにコア+1できる。";
const TRUE_GUIDED_ORACLE_PLACEMENT_BODY =
  "◆〔ターンに1回：同名〕このネクサスを配置したとき、自分のデッキの上から3枚をトラッシュに置ける。その中の対象カード1枚につき、このネクサスにコア+1する。";

/**
 * 真・導託は通常の「召喚/煌臨」両対応導託ではなく、印字どおりブレイヴの
 * 召喚だけを契機にする。本文3行、対象条件、summon 限定、配置時神託の
 * same-name scope、色条件なし、配置時の3枚全てトラッシュを同時に比較し、
 * いずれかを欠く DSL を coverage から隠さない。
 */
function hasExactTrueGuidedOracleCarrier(face, line) {
  if (
    ![
      TRUE_GUIDED_ORACLE_HEADER,
      TRUE_GUIDED_ORACLE_SUMMON_BODY,
      TRUE_GUIDED_ORACLE_PLACEMENT_BODY,
    ].includes(line)
  )
    return false;
  const data = face.grandwalkerData;
  const oracleCondition = data?.oracleConditions?.[0];
  return (
    data?.kind === "guided" &&
    data.oracleConditions?.length === 1 &&
    sameStringList(data.oracleTriggerKinds, ["summon"]) &&
    sameStringList(oracleCondition?.tribes, ["８６"]) &&
    sameStringList(oracleCondition?.categories, ["brave"]) &&
    oracleCondition?.minCost === undefined &&
    oracleCondition?.colors === undefined &&
    oracleCondition?.colorCount === undefined &&
    (oracleCondition?.hasMechanic === undefined ||
      oracleCondition.hasMechanic.length === 0) &&
    hasNoAdditionalTribeRestriction(oracleCondition) &&
    data.oracleExecutionMode === undefined &&
    data.oracleTriggerLimit === undefined &&
    data.placementOracle?.sameNameGate === false &&
    data.placementOracle?.turnLimit === "per_card_name" &&
    (data.placementOracle?.revealCount === undefined ||
      data.placementOracle.revealCount === 3) &&
    (data.placementOracle?.remainderDest === undefined ||
      data.placementOracle.remainderDest === "trash") &&
    data.placementOracleReturnToHand === undefined &&
    face.textLines?.includes(TRUE_GUIDED_ORACLE_HEADER) === true &&
    face.textLines?.includes(TRUE_GUIDED_ORACLE_SUMMON_BODY) === true &&
    face.textLines?.includes(TRUE_GUIDED_ORACLE_PLACEMENT_BODY) === true
  );
}

function hasExactPrintedOverCountCarrier(face, line) {
  const match = /^【OC条件：カウント(\d+)以上】$/.exec(line);
  if (match === null) return false;
  const minCount = Number(match[1]);
  return (
    face.printedOverCount?.minCount === minCount &&
    face.overCount?.minCount === minCount
  );
}

function hasExactContractCombineProxyCarrier(
  face,
  line,
  _parentFace,
  lineIndex
) {
  const directHeader = line === "Lv2";
  const headerIndex = directHeader
    ? lineIndex
    : previousNonblankLineIndex(face, lineIndex);
  const bodyIndex = directHeader
    ? nextNonblankLineIndex(face, lineIndex)
    : lineIndex;
  if (
    face.textLines?.[headerIndex] !== "Lv2" ||
    typeof face.textLines?.[bodyIndex] !== "string"
  )
    return false;

  const body = face.textLines[bodyIndex];
  const named =
    /^〔ターンに1回：同名〕自分は、魂状態を含む「([^」]+)」に《ソウルコア》をトラッシュに置いたものとして【契約合体】できる。$/.exec(
      body
    );
  const unrestricted =
    body ===
    "〔ターンに1回：同名〕自分は、《ソウルコア》をトラッシュに置いたものとして【契約合体】できる。";
  if (!named && !unrestricted) return false;

  const data = face.contractCombineProxyData;
  if (data?.requiredLevel !== 2) return false;
  if (named) {
    const targets = data.targetCardNames;
    return (
      Array.isArray(targets) &&
      targets.length === 1 &&
      targets[0]?.contains === named[1] &&
      Object.keys(targets[0] ?? {}).length === 1
    );
  }
  return data.targetCardNames === undefined;
}

function hasExactTokenDeckExclusionCarrier(face, line) {
  return (
    line === "このカードはデッキに入れられない。" &&
    Number.isInteger(face.maxTokenDeckCount) &&
    face.maxTokenDeckCount > 0
  );
}

function hasExactSingletonDeckLimitCarrier(face, line) {
  return (
    line === "このカードはデッキに1枚しか入れられない。" &&
    face.maxDeckCount === 1 &&
    face.maxTokenDeckCount === undefined
  );
}

function hasExactTokenIndependentCoreCarrier(face, line) {
  return (
    line ===
      "このカード/スピリットはコアを、出すとき以外で置けず、移動するとき/このスピリットがフィールドを離れるとき、ボイドに置かなければならない。" &&
    face.tokenIndependentCoreManagement?.redirectCoresToVoid === true &&
    face.tokenIndependentCoreManagement?.placementRestrictedToEnterField ===
      true &&
    Number.isInteger(face.maxTokenDeckCount) &&
    face.maxTokenDeckCount > 0
  );
}

function isStandardGuidedOracleBody(face) {
  return Boolean(
    face.textLines?.some((line) => GUIDED_ORACLE_BODY_RE.test(line))
  );
}

function matchesGrandwalkerOrGuidedDeclaration(face, line) {
  if (!face.grandwalkerData) return false;
  if (
    line ===
    "このネクサス/スピリットは導界者ネクサス/創界神ネクサス対象の効果しか受けない。このネクサス/スピリットには導託と導界者ネクサス対象の効果でしかコアを置けず、そのコアは導界者ネクサス/創界神ネクサス対象の効果しか受けず移動できない。また、導託・転者・導域は、神託・転神・神域としても扱う。"
  ) {
    return (
      face.grandwalkerData.kind === "guided" &&
      face.keywordTags?.includes("guided_nexus") === true
    );
  }
  if (/^このネクサスは(?:導界者|創界神)ネクサス/.test(line)) {
    return (
      face.grandwalkerData.kind === "guided" ||
      face.grandwalkerData.kind === "grandwalker"
    );
  }
  if (!/^【(?:導託|神託)[：:]/.test(line)) return false;

  // 「対象の自分のスピリット/アルティメット/ブレイヴを召喚/煌臨」の定型導託は
  // header だけを generic grandwalkerData で credit しない。種別を創界神へ壊すと
  // 導託の対象・トリガー・配置時本文が同時に未回収となる必要がある。
  return (
    !(/^【導託[：:]/.test(line) && isStandardGuidedOracleBody(face)) ||
    hasExactGuidedOracleCarrier(face)
  );
}

/**
 * card-text accountability の判定本体。
 *
 * `textRef` は原文との構造的な対応を示すが、それだけではカード固有の挙動が
 * 実装済みとは証明しない。このモジュールは両者を意図的に別 status にする。
 */

export const STRUCTURED_CARRIER_SPECS = [
  {
    carrierPath: "summonCondition[no_contract_card:self]",
    testRefs: ["packages/rules-core/test/bsth10-no-contract-entry.test.ts"],
    behavior: "printed-no-contract-summon-gate-and-resolved-field-entry",
    testEvidence: {
      testRef: "packages/rules-core/test/bsth10-no-contract-entry.test.ts",
      testName:
        "BSTH10 の7枚は契約未採用なら通常召喚をスタック解決して場に出せる",
    },
    matches: (face, line) =>
      !/[／/]現界/.test(line) && hasExactNoContractEntryCarrier(face, line),
  },
  {
    carrierPath:
      "summonCondition + hand genkai condition[no_contract_card:self]",
    testRefs: ["packages/rules-core/test/bsth10-no-contract-entry.test.ts"],
    behavior:
      "printed-no-contract-summon-and-genkai-gates-and-resolved-field-entry",
    testEvidence: {
      testRef: "packages/rules-core/test/bsth10-no-contract-entry.test.ts",
      testName:
        "BSTH10-X05 は契約未採用なら現界を宣言し、窓後にソウルコア支払いと場入りを完了する",
    },
    matches: (face, line) =>
      /[／/]現界/.test(line) && hasExactNoContractEntryCarrier(face, line),
  },
  {
    carrierPath: "tribe[exact unconditional source identity]",
    testRefs: ["packages/rules-core/test/unconditional-tribes-carrier.test.ts"],
    behavior: "unconditional-tribes-hand-trash-and-field-resolution",
    testEvidence: {
      testRef: "packages/rules-core/test/unconditional-tribes-carrier.test.ts",
      testName:
        "系統本文監査16面: 各印字系統でトラッシュ回収と手札破棄を完走し、異系統は残る",
    },
    matches: hasExactUnconditionalTribesCarrier,
  },
  {
    carrierPath: "tribe[unconditional additional ultimate identity]",
    testRefs: [
      "packages/rules-core/test/printed-identity-and-usage-carrier.test.ts",
    ],
    behavior: "ultimate-added-tribe-all-zones",
    testEvidence: {
      testRef:
        "packages/rules-core/test/printed-identity-and-usage-carrier.test.ts",
      testName:
        "BSTH03-X04 ultimate-added-tribe-all-zones: 起幻の手札破棄・トラッシュ回収と場の参照を確認",
    },
    matches: hasExactUltimateAddedTribesCarrier,
  },
  {
    carrierPath: "effects[].timingScope[all magic uses both/attack]",
    testRefs: [
      "packages/rules-core/test/printed-identity-and-usage-carrier.test.ts",
    ],
    behavior: "card-attack-step-use-restriction",
    testEvidence: {
      testRef:
        "packages/rules-core/test/printed-identity-and-usage-carrier.test.ts",
      testName:
        "BSTH03-R03/BSTH06-R01 card-attack-step-use-restriction: 両ターンのフラッシュ/スタック完走と他ステップ不発",
    },
    matches: hasExactCardAttackStepUsageCarrier,
  },
  {
    carrierPath: "effects[].timing.card_event[rebirth] + adjacent textRef",
    testRefs: [
      "packages/rules-core/test/autorun-w1-advent-rebirth-fidelity.test.ts",
    ],
    behavior: "rebirth-trigger-header-and-back-face-board-resolution",
    testEvidence: {
      testRef:
        "packages/rules-core/test/autorun-w1-advent-rebirth-fidelity.test.ts",
      testName:
        "BSTH07-転醒R01(B) 命蓮寺 (stub 除去): 転醒時の破壊対象は本来コスト6以下のみ (コスト8は残る)",
    },
    // 見出しだけを event 名で credit すると、直後の本文が未実装でも review を
    // 隠してしまう。card_event:rebirth と、その effect が直後の本文を textRef
    // で参照する組合せだけを、発揮タイミングの structured carrier とする。
    matches: (face, line, _parentFace, lineIndex) =>
      /^(?:Lv\d+(?:-Lv\d+)*)?『この(?:スピリット|アルティメット|ネクサス|ブレイヴ|カード)の転醒時』$/.test(
        line
      ) && hasAdjacentRebirthTriggerEffect(face, lineIndex),
  },
  {
    carrierPath: "effects[].cardEventDisposition[kind=swap]",
    testRefs: ["packages/rules-core/test/deck-open-swap-self-recovery.test.ts"],
    behavior: "card-event-disposition-zone-resolution",
    testEvidence: {
      testRef: "packages/rules-core/test/deck-open-swap-self-recovery.test.ts",
      testName:
        "BSDB01-C07: card-event disposition swap resolves the revealed card into hand and swaps one hand card to the reveal remainder",
    },
    // swap disposition は Effect.steps ではなく、オープン/トラッシュ連動の共通処理が
    // 直接読む structured carrier。実盤面回帰を持つ swap だけをここで扱い、未対応の
    // summon/steps_only や別の disposition は個別の carrier/test を持つまで review に残す。
    // consumer がある event に限定し、同じ source-line index を参照する effect だけを
    // 根拠にする。
    matches: (face, line, _parentFace, lineIndex) =>
      /入れ替え(?:られる|る|できる)/.test(line) &&
      collectEffectContainers(face).some(({ effects }) =>
        effects.some((effect) => {
          if (
            effect?.timing?.kind !== "card_event" ||
            effect.cardEventDisposition?.kind !== "swap" ||
            !effect.textRef?.includes(lineIndex)
          )
            return false;
          const events = Array.isArray(effect.timing.event)
            ? effect.timing.event
            : [effect.timing.event];
          return events.some(
            (event) => event === "revealed" || event === "moved_to_trash"
          );
        })
      ),
  },
  {
    carrierPath: "effects[].cardEventDisposition[kind=set_as_burst]",
    testRefs: ["packages/rules-core/test/bsth09-cards.test.ts"],
    behavior: "tribal-deck-reveal-optional-set-into-empty-burst-slot",
    testEvidence: {
      testRef: "packages/rules-core/test/bsth09-cards.test.ts",
      testName:
        "[board] 妖戒カードでオープンされ受理すると burst ゾーンへ直行し setBurstStates に登録される",
    },
    matches: (face, line, _parentFace, lineIndex) => {
      const match =
        /^系統：((?:「[^」]+」)(?:\/「[^」]+」)*)を持つ効果でデッキからオープンされたこのカードは、自分のバーストがセットされていなければ、セットできる。$/.exec(
          line
        );
      if (!match) return false;
      const tribes = [...match[1].matchAll(/「([^」]+)」/g)].map(
        (entry) => entry[1]
      );
      if (new Set(tribes).size !== tribes.length) return false;
      return collectEffectContainers(face).some(({ effects }) =>
        effects.some((effect) => {
          const conditions = effect?.condition;
          const events = Array.isArray(effect?.timing?.event)
            ? effect.timing.event
            : [effect?.timing?.event];
          return (
            effect?.timing?.kind === "card_event" &&
            sameStringList(events, ["revealed"]) &&
            !effect.stub &&
            effect.executionMode === "optional" &&
            effect.cardEventDisposition?.kind === "set_as_burst" &&
            Object.keys(effect.cardEventDisposition).length === 1 &&
            effect.textRef?.includes(lineIndex) === true &&
            effect.applicability === undefined &&
            effect.timingScope === undefined &&
            effect.usageLimit === undefined &&
            effect.usageLimits === undefined &&
            Array.isArray(conditions) &&
            conditions.length === 3 &&
            conditions.some(
              (condition) =>
                condition?.kind === "trigger_tribes" &&
                sameStringList(condition.tribes, tribes) &&
                Object.keys(condition).every((key) =>
                  ["kind", "tribes"].includes(key)
                )
            ) &&
            conditions.some(
              (condition) =>
                condition?.kind === "trigger_from_zone" &&
                sameStringList(condition.zones, ["deck"]) &&
                Object.keys(condition).length === 2
            ) &&
            conditions.some(
              (condition) =>
                condition?.kind === "burst_set_count" &&
                condition.player === "self" &&
                condition.max === 0 &&
                Object.keys(condition).length === 3
            )
          );
        })
      );
    },
  },
  {
    carrierPath: "effects[].cardEventDisposition[kind=set_as_mirage]",
    testRefs: ["packages/rules-core/test/bses01-r02-mirage.test.ts"],
    behavior: "card-event-disposition-paid-mirage-set-from-deck-origin",
    testEvidence: {
      testRef: "packages/rules-core/test/bses01-r02-mirage.test.ts",
      testName:
        "BSES01-R02 [0] トラッシュ由来: 自分のデッキ由来効果で置かれた後も同じ有償セットを解決する",
    },
    // set_as_mirage disposition は Effect.steps ではなく、公開/トラッシュ連動の
    // 共通処理がミラージュ支払い選択と最終セットを実行する structured carrier。
    // 原文が明示する、余計な競合条件を持たない「自分の効果で」「デッキからだけ」の
    // 条件、有限な非負整数コストと
    // 有効な軽減シンボルからなるミラージュ支払い定義、公開・トラッシュだけの
    // event 集合、同じ textRef、任意の set_as_mirage disposition のすべてを要求する。
    // 片方だけの event、別 event、相手の効果、複数起点、競合条件、ミラージュ定義なし、
    // 不正な支払い定義、または強制実行を空 steps の根拠にしない。
    matches: (face, line, _parentFace, lineIndex) => {
      if (
        !line.includes("デッキからオープンされた") ||
        !line.includes("トラッシュに置かれた") ||
        !line.includes("セットできる")
      )
        return false;
      const hasMiragePaymentDefinition =
        Number.isInteger(face?.mirageData?.cost) &&
        face.mirageData.cost >= 0 &&
        Array.isArray(face.mirageData.reduction) &&
        face.mirageData.reduction.every((symbol) =>
          MIRAGE_REDUCTION_SYMBOLS.has(symbol)
        );
      if (!hasMiragePaymentDefinition) return false;
      const mirageSetEvents = new Set(
        collectEffectContainers(face).flatMap(({ effects }) =>
          effects.flatMap((effect) => {
            const conditions = Array.isArray(effect.condition)
              ? effect.condition
              : [];
            const hasExactOwnDeckOrigin =
              conditions.length === 2 &&
              conditions.some(
                (condition) =>
                  condition?.kind === "trigger_source_player" &&
                  condition.player === "self"
              ) &&
              conditions.some(
                (condition) =>
                  condition?.kind === "trigger_from_zone" &&
                  Array.isArray(condition.zones) &&
                  condition.zones.length === 1 &&
                  condition.zones[0] === "deck"
              );
            if (
              effect?.timing?.kind !== "card_event" ||
              effect.cardEventDisposition?.kind !== "set_as_mirage" ||
              effect.executionMode !== "optional" ||
              !effect.textRef?.includes(lineIndex) ||
              !hasExactOwnDeckOrigin
            )
              return [];
            return Array.isArray(effect.timing.event)
              ? effect.timing.event
              : [effect.timing.event];
          })
        )
      );
      return (
        mirageSetEvents.size === 2 &&
        mirageSetEvents.has("revealed") &&
        mirageSetEvents.has("moved_to_trash")
      );
    },
  },
  {
    carrierPath: "effects[].cardEventDisposition[kind=blocked]",
    testRefs: ["packages/rules-core/test/bses01-c04-cx01-t01-coverage.test.ts"],
    behavior: "card-event-disposition-blocked-hand-entry-and-swap",
    testEvidence: {
      testRef: "packages/rules-core/test/bses01-c04-cx01-t01-coverage.test.ts",
      testName:
        "[board] BSES01-C04 はトラッシュに置かれても任意手札追加/入れ替え pending を生成しない",
    },
    // blocked disposition も Effect.steps ではなく公開/トラッシュ連動の共通処理が
    // 直接読む carrier。任意の blocked を空 steps の根拠にしてしまわないよう、
    // 原文が明示する「デッキからオープン」と「トラッシュにある」の**両方**、かつ textRef
    // を持つ revealed / moved_to_trash event の**両方**に限定する。一方だけなら、同じ
    // 原文行がいうもう一方の起点を実装していないので空 steps の review を残す。
    matches: (face, line, _parentFace, lineIndex) => {
      if (
        !line.includes("デッキからオープンされた") ||
        !line.includes("トラッシュにある") ||
        !/(?:手札に加えられ(?:ず|ない)).*(?:入れ替えられ(?:ず|ない)|入れ替えできない)/.test(
          line
        )
      )
        return false;
      const blockedEvents = new Set(
        collectEffectContainers(face).flatMap(({ effects }) =>
          effects.flatMap((effect) => {
            if (
              effect?.timing?.kind !== "card_event" ||
              effect.cardEventDisposition?.kind !== "blocked" ||
              !effect.textRef?.includes(lineIndex)
            )
              return [];
            return Array.isArray(effect.timing.event)
              ? effect.timing.event
              : [effect.timing.event];
          })
        )
      );
      return (
        blockedEvents.has("revealed") && blockedEvents.has("moved_to_trash")
      );
    },
  },
  {
    carrierPath: "adventData.beforeAdventSourceAddition",
    testRefs: [
      "packages/rules-core/test/bssl01-preparation-and-position.test.ts",
    ],
    behavior: "before-advent-source-selection-and-continuation",
    testEvidence: {
      testRef:
        "packages/rules-core/test/bssl01-preparation-and-position.test.ts",
      testName: "効果による煌臨も追加選択を挟み、その後に元効果のドローへ戻る",
    },
    matches: (face, line) =>
      face.adventData?.beforeAdventSourceAddition?.textRef?.some(
        (index) => face.textLines?.[index] === line
      ) ?? false,
  },
  {
    carrierPath: "adventData",
    testRefs: ["packages/rules-core/test/advent-declaration.test.ts"],
    behavior: "advent-declaration-legal-action",
    testEvidence: {
      testRef: "packages/rules-core/test/advent-declaration.test.ts",
      testName:
        "メインステップでソウルコアと有効な煌臨先があれば declare_advent が legal になる",
    },
    matches: (face, line) =>
      Boolean(face.adventData) &&
      (/^(?:フラッシュ)?【(?:超契約|契約)?煌臨[：:]/.test(line) ||
        /^自分の[《≪]ソウルコア[》≫]をトラッシュに置くことで、対象の自分の.*手札から(?:重ねる|合体する)/.test(
          line
        )),
  },
  {
    carrierPath: "manifestData[printed target and player count]",
    testRefs: ["packages/rules-core/test/bsth02-7-x03-manifest.test.ts"],
    behavior:
      "manifest-count-gate-trash-payment-stack-and-maintenance-resolution",
    testEvidence: {
      testRef: "packages/rules-core/test/bsth02-7-x03-manifest.test.ts",
      testName:
        "BSTH02.7-X03本文監査: 窓後に対象の1コアとソウルコアをトラッシュへ払い、維持コア配置まで完走する",
    },
    matches: hasExactManifestCarrier,
  },
  {
    // 超契約煌臨の「ソウルコアをこのスピリットに置く」は通常の
    // soulCoreDest:"trash" と異なる。契約先・煌臨元再利用・同名ターン制限・
    // カウント条件まで冒頭本文と同じ AdventData にある場合だけ credit する。
    carrierPath: "adventData[soulCoreDest=this_card]",
    testRefs: ["packages/rules-core/test/bssl01-cards.test.ts"],
    behavior: "super-contract-advent-self-soul-core-placement",
    testEvidence: {
      testRef: "packages/rules-core/test/bssl01-cards.test.ts",
      testName:
        "盤面: 煌臨適用後、消費したソウルコアはトラッシュではなく煌臨後のこのスピリット自身に置かれる",
    },
    matches: hasExactContractAdventSelfCoreCarrier,
  },
  {
    // 「フラッシュ」とヘッダの間に空白を含む契約煌臨は、通常のヘッダ正規表現に
    // 無条件で緩和を加えず、名前・対象・自ターン・実消費先と、未印字の
    // adventCondition 制約がないことまで照合して扱う。
    carrierPath: "adventData[contract own_turn soulCoreDest=trash]",
    testRefs: ["packages/rules-core/test/bssl01-cards.test.ts"],
    behavior: "spaced-contract-advent-declaration",
    testEvidence: {
      testRef: "packages/rules-core/test/bssl01-cards.test.ts",
      testName:
        "盤面: 契約煌臨は自ターンに水篠 旬へ重なり、ソウルコアをトラッシュに置く",
    },
    matches: hasExactSpacedContractAdventHeaderCarrier,
  },
  {
    carrierPath: "trashAdventHostGrant",
    testRefs: ["packages/rules-core/test/trash-advent.test.ts"],
    behavior: "trash-advent-host-permission-and-per-name-turn-limit",
    testEvidence: {
      testRef: "packages/rules-core/test/trash-advent.test.ts",
      testName:
        "手札からトラッシュのカードへ煌臨し、ソウルコアを消費して場へ重なる",
    },
    matches: (face, line) =>
      Boolean(face.trashAdventHostGrant) &&
      /^〔ターンに1回[：:]同名〕トラッシュにあるこのカードは、フィールドで、スピリットとしているものとして.*【煌臨】できる(?:。|$)/.test(
        line
      ) &&
      !/フィールド\/リザーブのコアを好きなだけ置く/.test(line),
  },
  {
    carrierPath: "trashAdventHostGrant.chargeCoresOnAdvent",
    testRefs: ["packages/rules-core/test/trash-advent.test.ts"],
    behavior: "trash-advent-host-core-charge-pending-distribution",
    testEvidence: {
      testRef: "packages/rules-core/test/trash-advent.test.ts",
      testName:
        "chargeCoresOnAdvent で任意コア配置 pending(any_movable) が生成される",
    },
    matches: (face, line) =>
      face.trashAdventHostGrant?.chargeCoresOnAdvent === true &&
      /^(?:このとき、【?煌臨】?するカードに|〔ターンに1回[：:]同名〕トラッシュにあるこのカードは、フィールドで、スピリットとしているものとして.*【煌臨】できる。このとき、【?煌臨】?するカードに)フィールド\/リザーブのコアを好きなだけ置く。?$/.test(
        line
      ),
  },
  {
    carrierPath: "summonCondition",
    testRefs: ["packages/rules-core/test/bsaz02-c01-alguile.test.ts"],
    behavior: "summon-condition-field-prerequisite",
    testEvidence: {
      testRef: "packages/rules-core/test/bsaz02-c01-alguile.test.ts",
      testName: "自分の場に「ＣＦ」アルティメットが0体なら召喚可",
    },
    matches: (face, line) =>
      Boolean(face.summonCondition?.length) && /^《?召喚条件[：:]/.test(line),
  },
  {
    // 転召は effect ではなく、支払い済みの召喚宣言に続く共通手順。header だけで
    // credit すると対象・最低コア・ボイド送りの本文を落とすので、2 行と
    // TenshoSummonData を完全に照合する。
    carrierPath: "tenshoSummon",
    testRefs: ["packages/rules-core/test/tensho-summon-gate.test.ts"],
    behavior: "post-payment-tensho-before-field-entry-core-voiding",
    testEvidence: {
      testRef: "packages/rules-core/test/tensho-summon-gate.test.ts",
      testName:
        "コスト支払い→スタック窓→転召（場入り前）→維持コア配置 の順で解決する",
    },
    matches: hasExactTenshoSummonCarrier,
  },
  {
    // 創界石は空の Effect ではなく grandstoneData と共通 target/core/rebirth
    // primitive が消費する。解封の OR 条件、転醒上限、全コア void、転醒後合体を
    // 本文と値単位で比較し、どれかを欠くなら review に残す。
    carrierPath: "grandstoneData + enter_field_core_placement_forbidden",
    testRefs: ["packages/rules-core/test/grandstone.test.ts"],
    behavior: "grandstone-unseal-core-placement-and-rebirth-combine",
    testEvidence: {
      testRef: "packages/rules-core/test/grandstone.test.ts",
      testName:
        "陰陽玉本文監査: 名前/系統と召喚/アタックの解封、閾値/カウント境界、転醒合体の最終盤面",
    },
    matches: hasExactGrandstoneCarrier,
  },
  {
    carrierPath: "grandstoneData[printed unseal and complete rebirth profile]",
    testRefs: ["packages/rules-core/test/printed-grandstone-carrier.test.ts"],
    behavior: "printed-grandstone-unseal-and-completed-rebirth",
    testEvidence: {
      testRef: "packages/rules-core/test/printed-grandstone-carrier.test.ts",
      testName:
        "創界石4面本文監査: OR条件・辞退・閾値/カウント・残置/合体/配置・解封除外の最終盤面",
    },
    matches: hasExactPrintedGrandstoneCarrier,
  },
  {
    // ミラージュのセット可能枚数免除は effects[] に置かず、全セットwriterの
    // 個体0枠と同名ターン1回の行動数 gate が MirageData を直接参照する。コスト・軽減も本文の同カードを
    // 一体として確定するため、免除フラグだけの broad credit は許可しない。
    carrierPath: "mirageData.exemptSetCountLimits",
    testRefs: [
      "packages/rules-core/test/bsth002-c01-mirage-set-count-exemption.test.ts",
    ],
    behavior: "mirage-zero-slot-and-per-name-turn-action-exemption",
    testEvidence: {
      testRef:
        "packages/rules-core/test/bsth002-c01-mirage-set-count-exemption.test.ts",
      testName:
        "同名ターン1回はプレイヤー+cardNoで共有し、最初の化け化けは通常セット行動数を使わない",
    },
    matches: hasExactMirageSetCountExemptionCarrier,
  },
  {
    carrierPath:
      "continuousSummonCondition + summonCondition[any_of quartz_attribute]",
    testRefs: ["packages/rules-core/test/bslh01-cards.test.ts"],
    behavior: "arts-soul-state-attribute-auto-placement-gate",
    testEvidence: {
      testRef: "packages/rules-core/test/bslh01-cards.test.ts",
      testName:
        "BSLH01-T07〜T17 arts-soul-state-attribute-placement-gate: 原文の全 OR 属性プロファイルを満たすと自動配置し、必須値を失うと配置しない",
    },
    // 【アーツ】は Effect.steps ではなく、魂状態のオーブメント属性値を読む
    // summonCondition と SBA の継続判定で「置く間」を自動処理する。ヘッダーだけ、
    // あるいは閾値行だけを無条件に帰属させず、原文の全 OR-of-AND プロファイルと
    // DSL の全条件を一致させる。閾値欠落・追加・所有者違いは未帰属のまま残る。
    matches: hasExactArtsSoulStatePlacementCarrier,
  },
  {
    carrierPath:
      "grandwalkerData.oracleConditions (normal guided/grandwalker oracle)",
    testRefs: ["packages/rules-core/test/phase-f-grandwalker.test.ts"],
    behavior: "guided-oracle-summon-advent-core-placement",
    testEvidence: {
      testRef: "packages/rules-core/test/phase-f-grandwalker.test.ts",
      testName:
        "F-real: BSLH01-X01 の召喚/煌臨導託は辞退後なら同ステップで再度キューできる",
    },
    matches: hasExactNormalOracleCarrier,
  },
  {
    carrierPath:
      "grandwalkerData.placementOracle (normal guided/grandwalker placement oracle)",
    testRefs: ["packages/rules-core/test/phase-f-grandwalker.test.ts"],
    behavior: "guided-placement-oracle-mill-and-core-placement",
    testEvidence: {
      testRef: "packages/rules-core/test/phase-f-grandwalker.test.ts",
      testName: "配置時導託のマッチ数は additional_cost CE の実効コストも見る",
    },
    matches: hasExactNormalPlacementOracleCarrier,
  },
  {
    carrierPath: "adventData.alternateCostAdvent",
    testRefs: ["packages/rules-core/test/bsrk01-advent.test.ts"],
    behavior: "opponent-attack-step-as-if-soul-core-contract-advent",
    testEvidence: {
      testRef: "packages/rules-core/test/bsrk01-advent.test.ts",
      testName:
        "適用後: ソウルコアは実消費されず(元々null)、overlay成立、usedAlternateCostAdventKeysThisTurnに記録され、同ターン中は同名の別インスタンスでも代替コスト経路が再度出ない",
    },
    matches: hasExactAlternateContractAdventCarrier,
  },
  {
    carrierPath: "grandwalkerData.divineSkills",
    testRefs: ["packages/rules-core/test/bssa01-bssg02-cards.test.ts"],
    behavior: "divine-skill-header-cost-level-and-timing-wiring",
    testEvidence: {
      testRef: "packages/rules-core/test/bssa01-bssg02-cards.test.ts",
      testName:
        "grandwalkerData(grandwalker) + 神技2/神技4 effect 配線 + 多色treat_as を実装",
    },
    matches: hasExactDivineSkillHeaderCarrier,
  },
  {
    carrierPath: "effects[].timing.card_event[summon] + adjacent textRef",
    testRefs: ["packages/rules-core/test/bssg01-cards.test.ts"],
    behavior: "summon-timing-header-and-board-resolution",
    testEvidence: {
      testRef: "packages/rules-core/test/bssg01-cards.test.ts",
      testName: "召喚時 実行: ボイドのコア1個が自身へ移動",
    },
    matches: hasExactSummonTimingHeaderCarrier,
  },
  {
    carrierPath: "hostDualAdventGrant",
    testRefs: ["packages/rules-core/test/host-dual-advent.test.ts"],
    behavior: "host-side-as-if-soul-core-advent-permission",
    testEvidence: {
      testRef: "packages/rules-core/test/host-dual-advent.test.ts",
      testName:
        "代替コスト経路 (擬制消費) は emit され、ソウルコアを消費せず契約煌臨できる",
    },
    matches: hasExactHostDualAdventGrantCarrier,
  },
  {
    carrierPath: "dualHostAdventData",
    testRefs: ["packages/rules-core/test/multi-host-advent.test.ts"],
    behavior: "dual-host-advent-source-selection-and-core-integration",
    testEvidence: {
      testRef: "packages/rules-core/test/multi-host-advent.test.ts",
      testName:
        "対象2体を1つの煌臨元スタックへ統合し、選んだ「上」が状態を引き継ぎ、コアは合算される",
    },
    matches: hasExactDualHostAdventCarrier,
  },
  {
    carrierPath: "braveCondition",
    testRefs: ["packages/rules-core/test/brave-combine-summon.test.ts"],
    behavior: "brave-combine-host-eligibility",
    testEvidence: {
      testRef: "packages/rules-core/test/brave-combine-summon.test.ts",
      testName:
        "合体条件 (cardNames 完全一致) を満たすホストだけが合体候補になる",
    },
    matches: (face, line) =>
      Boolean(face.braveCondition) && /^【合体条件[：:]/.test(line),
  },
  {
    carrierPath: "additionalBraveSlot",
    testRefs: ["packages/rules-core/test/bsaz01-cards.test.ts"],
    behavior: "conditional-additional-brave-slot-on-qualified-host",
    testEvidence: {
      testRef: "packages/rules-core/test/bsaz01-cards.test.ts",
      testName:
        "BSAZ01-C18 は『界塚伊奈帆』合体中のＣＦスピリットへ追加合体できる",
    },
    matches: (face, line) => {
      const attachedNames = [...line.matchAll(/「([^」]+)」/g)].map(
        (match) => match[1]
      );
      return (
        Boolean(face.additionalBraveSlot) &&
        /^〔重複不可〕このカード\/ブレイヴは、.+に追加で合体できる。?$/.test(
          line
        ) &&
        attachedNames.length === 1 &&
        face.additionalBraveSlot.maxPerHost === 1 &&
        (face.additionalBraveSlot.requiredAttachedBraveNameContains?.includes(
          attachedNames[0]
        ) ||
          face.additionalBraveSlot.hostCondition?.attachedBraveNameContains?.includes(
            attachedNames[0]
          ))
      );
    },
  },
  {
    // 「このスピリットは『A』Nつまでと『B』Mつと合体できる」型は、空の
    // continuous Effect ではなく host 定義の nameLimits まで含む
    // maxCombinedBraves が実行時の合体候補を制限する。この carrier は名前別上限、
    // 総数、許可名が本文とすべて一致するときだけ成立させる。
    carrierPath: "maxCombinedBraves.condition/nameLimits",
    testRefs: [
      "packages/rules-core/test/bsth01-x02-named-brave-combine-limit.test.ts",
    ],
    behavior: "named-brave-combine-total-and-per-name-limits",
    testEvidence: {
      testRef:
        "packages/rules-core/test/bsth01-x02-named-brave-combine-limit.test.ts",
      testName:
        "「ミニ八卦炉」2体合体済み (名前別上限到達) のとき、3体目とは合体できない",
    },
    matches: (face, line, _parentFace, lineIndex) => {
      const namedLimits = [
        ...line.matchAll(/「([^」]+)」(\d+)つ(?:まで)?/g),
      ].map((match) => ({
        cardNameContains: match[1],
        maxCount: Number(match[2]),
      }));
      const limit = face.maxCombinedBraves;
      if (
        !/^この(?:スピリット|アルティメット)は(?:「[^」]+」\d+つ(?:まで)?と)+合体できる。?$/.test(
          line
        ) ||
        namedLimits.length === 0 ||
        !limit ||
        typeof limit !== "object" ||
        !Number.isInteger(limit.count) ||
        !Array.isArray(limit.condition?.cardNameContains) ||
        !Array.isArray(limit.nameLimits)
      )
        return false;
      return (
        hasScopedBraveCapacityEffect(
          face,
          lineIndex,
          levelHeaderAt(face, previousNonblankLineIndex(face, lineIndex))
        ) &&
        limit.count ===
          namedLimits.reduce(
            (sum, namedLimit) => sum + namedLimit.maxCount,
            0
          ) &&
        limit.condition.cardNameContains.length === namedLimits.length &&
        limit.nameLimits.length === namedLimits.length &&
        namedLimits.every(
          (namedLimit) =>
            limit.condition.cardNameContains.includes(
              namedLimit.cardNameContains
            ) &&
            limit.nameLimits.some(
              (configuredLimit) =>
                configuredLimit?.cardNameContains ===
                  namedLimit.cardNameContains &&
                configuredLimit.maxCount === namedLimit.maxCount
            )
        )
      );
    },
  },
  {
    carrierPath: "grandwalkerData.trueGuidedOracle",
    testRefs: ["packages/rules-core/test/bses01-c04-cx01-t01-coverage.test.ts"],
    behavior: "true-guided-oracle-summon-only-and-placement-oracle",
    testEvidence: {
      testRef: "packages/rules-core/test/bses01-c04-cx01-t01-coverage.test.ts",
      testName:
        "[board] BSES01-CX01 真・導託は対象８６ブレイヴの召喚だけでキューし、煌臨ではキューしない",
    },
    matches: hasExactTrueGuidedOracleCarrier,
  },
  {
    carrierPath: "printedOverCount + overCount",
    testRefs: ["packages/rules-core/test/bsdb01-cards.test.ts"],
    behavior: "printed-over-count-condition-and-runtime-over-count",
    testEvidence: {
      testRef: "packages/rules-core/test/bsdb01-cards.test.ts",
      testName:
        "[board] OC コスト以下のみ破壊: 自身コスト7、相手コスト5は破壊・コスト8は残る",
    },
    matches: hasExactPrintedOverCountCarrier,
  },
  {
    carrierPath: "contractCombineProxyData",
    testRefs: ["packages/rules-core/test/bsge01-cards.test.ts"],
    behavior: "level-two-per-name-as-if-soul-core-contract-combine",
    testEvidence: {
      testRef: "packages/rules-core/test/bsge01-cards.test.ts",
      testName:
        "Lv2 到達済みなら、ソウルコアが無くても対象カード名一致で契約合体宣言が列挙される",
    },
    matches: hasExactContractCombineProxyCarrier,
  },
  {
    carrierPath: "maxTokenDeckCount",
    testRefs: [
      "packages/rules-core/test/card-text-deck-limit-carriers.test.ts",
    ],
    behavior: "token-pool-main-deck-exclusion",
    testEvidence: {
      testRef: "packages/rules-core/test/card-text-deck-limit-carriers.test.ts",
      testName:
        "source-text deck-limit carriers: token-pool cards are rejected from the main deck and singleton cards reject a second copy",
    },
    matches: hasExactTokenDeckExclusionCarrier,
  },
  {
    carrierPath: "maxDeckCount",
    testRefs: [
      "packages/rules-core/test/card-text-deck-limit-carriers.test.ts",
    ],
    behavior: "singleton-main-deck-copy-limit",
    testEvidence: {
      testRef: "packages/rules-core/test/card-text-deck-limit-carriers.test.ts",
      testName:
        "source-text deck-limit carriers: token-pool cards are rejected from the main deck and singleton cards reject a second copy",
    },
    matches: hasExactSingletonDeckLimitCarrier,
  },
  {
    carrierPath: "tokenIndependentCoreManagement",
    testRefs: [
      "packages/rules-core/test/core-move-forced-void-redirect.test.ts",
    ],
    behavior: "token-independent-core-placement-and-forced-void-redirect",
    testEvidence: {
      testRef:
        "packages/rules-core/test/core-move-forced-void-redirect.test.ts",
      testName:
        "auto-fallback (single candidate): opponent's coreshoot off a flagged card redirects to its owner's void, not the attacker's destination",
    },
    matches: hasExactTokenIndependentCoreCarrier,
  },
  {
    // 契約カードの判定は keywordTags.contract が SSOT。ここではそれだけでなく、
    // 魂状態の契約合体と任意コア配置の定型本文が完全一致する場合だけ
    // 共通機構の carrier として空 Effect を帰属する。
    carrierPath: "keywordTags.contract + soul-state contract rule",
    testRefs: ["packages/rules-core/test/bsge01-cards.test.ts"],
    behavior: "soul-state-contract-combine-and-charge-core-placement",
    testEvidence: {
      testRef: "packages/rules-core/test/bsge01-cards.test.ts",
      testName: "魂状態の契約カード (CX01) は契約合体の対象になる",
    },
    matches: hasSoulStateContractCombineCarrier,
  },
  {
    // 契約煌臨も同じ契約カード SSOT を用いるが、煌臨宣言・重ね・任意コア配置は
    // contract combine と別の共通実行経路である。回帰証跡も分離して保持する。
    carrierPath: "keywordTags.contract + soul-state contract advent rule",
    testRefs: ["packages/rules-core/test/bsrk01-advent.test.ts"],
    behavior: "soul-state-contract-advent-and-charge-core-placement",
    testEvidence: {
      testRef: "packages/rules-core/test/bsrk01-advent.test.ts",
      testName:
        "BSRK01-CX01 の魂状態に BSRK01-C04 を契約煌臨すると任意コア配置 pending が生成される",
    },
    matches: hasSoulStateContractAdventCarrier,
  },
  {
    // Link Aid は card Effect でなく linkAidData を消費する共通 legal action。
    // ヘッダ、本文のコスト源系統、両者のアタックステップ、DSL の三点が一致しない
    // 形は review のまま残す。
    carrierPath: "linkAidData",
    testRefs: ["packages/rules-core/test/bsge01-cards.test.ts"],
    behavior: "link-aid-soul-state-transition-and-core-placement",
    testEvidence: {
      testRef: "packages/rules-core/test/bsge01-cards.test.ts",
      testName:
        "適用: コスト源のコア1個がボイドへ、魂状態を離れ、reserve_only の任意コア配置が開く（召喚扱いではない）",
    },
    matches: hasExactLinkAidCarrier,
  },
  {
    // ENIGMA の「魂状態以外でフィールドに存在できない」は空 continuous
    // Effect 自体が実行するのではない。手札/手元からの魂状態化 activation が
    // legal action 抑止と SBA cleanup の SSOT になるため、本文・枚数上限・activation
    // の全てを照合する。
    carrierPath: "activated enter_soul_state + soul-state-only SBA",
    testRefs: ["packages/rules-core/test/quartz-system.test.ts"],
    behavior: "soul-state-only-field-rule-cleanup",
    testEvidence: {
      testRef: "packages/rules-core/test/quartz-system.test.ts",
      testName:
        "BSLH01-CX01: 魂状態でない field ENIGMA は SBA で存在できず trash へ送られる",
    },
    matches: hasExactSoulStateOnlyFieldCarrier,
  },
  {
    carrierPath: "braveLimitExemption.hostCondition",
    testRefs: ["packages/rules-core/test/bsth003-cards.test.ts"],
    behavior: "guided-brave-limit-exemption-on-qualified-hosts",
    testEvidence: {
      testRef: "packages/rules-core/test/bsth003-cards.test.ts",
      testName:
        "[board] 受けず選択 (choiceIndex 1): 手札のミミちゃんが対象の導魔スピリットへ直接合体し、相手の破壊効果を免疫で防ぎつつ離脱耐性CEを登録する",
    },
    matches: hasExactBraveLimitExemptionCarrier,
  },
  {
    carrierPath: "maxCombinedBraves.condition.tribes",
    testRefs: [
      "packages/rules-core/test/bsth02-x04-multi-brave-combine.test.ts",
    ],
    behavior: "tribal-multi-brave-combine-capacity",
    testEvidence: {
      testRef:
        "packages/rules-core/test/bsth02-x04-multi-brave-combine.test.ts",
      testName:
        "既に導魔ブレイヴ3体が合体済み (上限到達) のとき、4体目とは合体できない",
    },
    matches: hasExactTribalMaxCombinedBravesCarrier,
  },
  {
    carrierPath:
      "keywordTags[cannot_combine] | effects[].override_properties.properties.keywords[cannot_combine]",
    testRefs: [
      "packages/rules-core/test/engine-aldnoah-drive-under-card-keyword.test.ts",
      "packages/rules-core/test/bssa01-cards.test.ts",
    ],
    behavior: "printed-cannot-combine-restriction",
    testEvidence: {
      testRef: "packages/rules-core/test/bssa01-cards.test.ts",
      testName:
        "BSSA01-転醒X03(B) printed-cannot-combine-restriction: [board] 効果抑止中の合体と復帰時の強制分離を盤面で再現する",
    },
    matches: (face, line) =>
      (/^【合体条件[：:]合体不可】$/.test(line) &&
        face.keywordTags?.includes("cannot_combine") === true) ||
      (/^この(?:スピリット|ブレイヴ|アルティメット)は合体できない。?$/.test(
        line
      ) &&
        hasPlainCannotCombineContinuousCarrier(face)),
  },
  {
    carrierPath: "maxDeckCount",
    testRefs: [
      "packages/rules-core/test/engine-aldnoah-drive-under-card-keyword.test.ts",
    ],
    behavior: "printed-main-deck-copy-limit",
    testEvidence: {
      testRef:
        "packages/rules-core/test/engine-aldnoah-drive-under-card-keyword.test.ts",
      testName: "BSAZ02-C10 は印字どおり20枚を超えてメインデッキに入れられない",
    },
    matches: (face, line) => {
      const match = /^このカードは、?(\d+)枚までデッキに入れられる。?$/.exec(
        line
      );
      return (
        match !== null &&
        Number.isInteger(face.maxDeckCount) &&
        Number(match[1]) === face.maxDeckCount
      );
    },
  },
  {
    carrierPath: "grandwalkerData",
    testRefs: ["packages/rules-core/test/bsaz02-x04-aselam.test.ts"],
    behavior: "grandwalker-guided-oracle-declaration",
    testEvidence: {
      testRef: "packages/rules-core/test/bsaz02-x04-aselam.test.ts",
      testName:
        "kind:guided + 本文どおりの召喚/煌臨トリガーとoracleConditions 3件が宣言される",
    },
    matches: matchesGrandwalkerOrGuidedDeclaration,
  },
  {
    carrierPath: "grandwalkerData.oracleConditions",
    testRefs: ["packages/rules-core/test/bsaz02-x04-aselam.test.ts"],
    behavior: "guided-oracle-core-placement-after-matching-summon-or-advent",
    testEvidence: {
      testRef: "packages/rules-core/test/bsaz02-x04-aselam.test.ts",
      testName: "導託対象の自分の召喚後、任意でこのネクサスにコア1個を置ける",
    },
    matches: (face, line) =>
      GUIDED_ORACLE_BODY_RE.test(line) && hasExactGuidedOracleCarrier(face),
  },
  {
    carrierPath: "grandwalkerData.placementOracle",
    testRefs: ["packages/rules-core/test/bsaz02-x04-aselam.test.ts"],
    behavior: "guided-placement-oracle-mill-and-matching-core-placement",
    testEvidence: {
      testRef: "packages/rules-core/test/bsaz02-x04-aselam.test.ts",
      testName:
        "配置時導託を発揮すると同名不在でデッキ上をトラッシュに置き、対象枚数分のコアを強制で置く",
    },
    matches: (face, line) =>
      GUIDED_PLACEMENT_ORACLE_BODY_RE.test(line) &&
      hasExactGuidedOracleCarrier(face) &&
      hasExactStandardPlacementOracle(face.grandwalkerData),
  },
  {
    carrierPath: "contractCombineData",
    testRefs: ["packages/rules-core/test/bsge01-cards.test.ts"],
    behavior: "contract-combine-trigger-wiring",
    testEvidence: {
      testRef: "packages/rules-core/test/bsge01-cards.test.ts",
      testName:
        "誘発配線: 契約合体で場入りしたブレイヴの『召喚/契約合体時』は契約合体時として pendingTriggeredEffects へ積まれる",
    },
    matches: (face, line) =>
      Boolean(face.contractCombineData) &&
      (/^(?:フラッシュ)?【契約合体[：:]/.test(line) ||
        /^自分の[《≪]ソウルコア[》≫]をトラッシュに置くことで、対象の自分の.*手札から合体する/.test(
          line
        )),
  },
  {
    carrierPath: "manifestData",
    testRefs: ["packages/rules-core/test/bsth02-7-x03-manifest.test.ts"],
    behavior: "manifest-target-condition-wiring",
    testEvidence: {
      testRef: "packages/rules-core/test/bsth02-7-x03-manifest.test.ts",
      testName: "manifestData が対象条件どおりに配線されている",
    },
    matches: (face, line) =>
      Boolean(face.manifestData) && /^【顕現[：:]/.test(line),
  },
  {
    carrierPath: "attackAlternativeFlip",
    testRefs: ["packages/rules-core/test/bsdb01-cards.test.ts"],
    behavior: "attack-declaration-alternative-face-flip-and-count-increase",
    testEvidence: {
      testRef: "packages/rules-core/test/bsdb01-cards.test.ts",
      testName:
        "BSDB01-TX01(A) 超サイヤ人3 孫悟空＆超サイヤ人2 ベジータ-天使- > [board] アタック宣言の代わりに flip_instead_of_attack を選ぶと裏返り、カウント+3、疲労もバトルも発生しない",
    },
    matches: (face, line) => {
      const amount = face.attackAlternativeFlip?.countIncreaseAmount;
      if (!Number.isInteger(amount) || amount <= 0) return false;
      const isMatchingEffectLine = (candidate) => {
        const match =
          /^このスピリットはアタックするかわりに裏返せる。このとき、自分のカウント[+＋](\d+)する。?$/.exec(
            candidate
          );
        return match !== null && Number(match[1]) === amount;
      };
      if (isMatchingEffectLine(line)) return true;
      const coveredLevels = [...line.matchAll(/Lv(\d+)/g)].map((match) =>
        Number(match[1])
      );
      const coversAllDefinitionLevels =
        /^Lv\d+(?:-Lv\d+)*$/.test(line) &&
        coveredLevels.length > 0 &&
        Array.isArray(face.levelDefs) &&
        face.levelDefs.length > 0 &&
        face.levelDefs.every((levelDef) =>
          coveredLevels.includes(levelDef.level)
        );
      return (
        coversAllDefinitionLevels &&
        (face.textLines ?? []).some(
          (candidate, index) =>
            candidate === line &&
            isMatchingEffectLine(face.textLines[index + 1] ?? "")
        )
      );
    },
  },
  {
    carrierPath: "mirageData",
    testRefs: ["packages/rules-core/test/bsge01-mirage-set-drain.test.ts"],
    behavior: "mirage-cost-reduction-wiring",
    testEvidence: {
      testRef: "packages/rules-core/test/bsge01-mirage-set-drain.test.ts",
      testName: "mirageData: cost 2 / reduction 赤",
    },
    matches: (face, line) =>
      Boolean(face.mirageData) && /^【ミラージュ[：:]/.test(line),
  },
  {
    carrierPath: "mirageData.canSetFromTrash",
    testRefs: ["packages/rules-core/test/bsdb01-cards.test.ts"],
    behavior: "mirage-trash-set-payment-and-zone-transition",
    testEvidence: {
      testRef: "packages/rules-core/test/bsdb01-cards.test.ts",
      testName:
        "[board] トラッシュからコスト1を支払ってセットし、ミラージュへ移す",
    },
    matches: (face, line) =>
      face.mirageData?.canSetFromTrash === true &&
      /^トラッシュにあるこのカードはセットできる。?$/.test(line),
  },
  {
    carrierPath: "accelData",
    testRefs: ["packages/rules-core/test/accel-change-system.test.ts"],
    behavior: "accel-card-definition-wiring",
    testEvidence: {
      testRef: "packages/rules-core/test/accel-change-system.test.ts",
      testName: "AccelData is set on CardDefinition",
    },
    matches: (face, line) =>
      Boolean(face.accelData) && /^【アクセル[：:]/.test(line),
  },
  {
    carrierPath: "changeData",
    testRefs: ["packages/rules-core/test/accel-change-system.test.ts"],
    behavior: "change-card-definition-wiring",
    testEvidence: {
      testRef: "packages/rules-core/test/accel-change-system.test.ts",
      testName: "ChangeData is set on CardDefinition",
    },
    matches: (face, line) =>
      Boolean(face.changeData) &&
      /^【(?:コントラクト)?チェンジ[：:]/.test(line),
  },
  {
    carrierPath: "underCardSlots",
    testRefs: ["packages/rules-core/test/bsaz02-tr01-heras.test.ts"],
    behavior: "aldnoah-drive-under-card-slot-capacity",
    testEvidence: {
      testRef: "packages/rules-core/test/bsaz02-tr01-heras.test.ts",
      testName:
        "BSAZ02-TR01(B) aldnoah-drive-under-card-slot-capacity: 転醒後もC10を1枚まで配置し、ドライブ下の継続効果を盤面へ登録する",
    },
    matches: (face, line) => {
      const match = /^【アルドノアドライブ[：:]\s*(\d+)】/.exec(line);
      if (!match) return false;
      const maxCount = Number(match[1]);
      return (
        Number.isInteger(maxCount) &&
        face.underCardSlots?.some(
          (slot) =>
            slot?.roleTag === "アルドノアドライブ" && slot.maxCount === maxCount
        )
      );
    },
  },
  {
    carrierPath: "keywordTags",
    testRefs: ["packages/rules-core/test/bsft01-cards.test.ts"],
    behavior: "star-garment-under-placement-exclusion",
    testEvidence: {
      testRef: "packages/rules-core/test/bsft01-cards.test.ts",
      testName:
        "BSFT01-TR02(B) star-garment-under-placement-exclusion: [board] 親A面を選んでもB面タグにより星霊衣の配置候補にならない",
    },
    matches: (face, line) =>
      face.keywordTags?.includes("star_garment_cannot_be_under") === true &&
      /^このカードは、【星霊衣】で自分のスピリットの下に置けない。?$/.test(
        line
      ),
  },
  {
    carrierPath: "parentFace.effects[].steps[].action.rebirth",
    testRefs: [
      "packages/rules-core/test/bsaz02-tx01-dioscuria.test.ts",
      "packages/rules-core/test/autorun-w1-advent-rebirth-fidelity.test.ts",
    ],
    behavior: "rebirth-back-face-transition-and-count-mode",
    testEvidence: {
      testRef:
        "packages/rules-core/test/autorun-w1-advent-rebirth-fidelity.test.ts",
      testName:
        "BSTH09.2-転醒R03(B): 親 A 面の rebirth で B 面へ裏返り、定型 count + B面転醒時効果を最終盤面まで解決する",
    },
    matches: (face, line, parentFace) => {
      const normalized = line
        .replace(/（[^）]*）/g, "")
        .replace(/[。．]/g, "")
        .trim();
      const isFieldRemain = /^この面に裏返ったとき、フィールドに残る$/.test(
        normalized
      );
      const isFieldRemainAndReset =
        /^この面に裏返ったとき、フィールドに残り、カウントを0にする$/.test(
          normalized
        );
      // 「カウント1する」は通常の定型文ではない。BSTH09.2-転醒R03(B) と
      // 親 A 面だけは needs-ruling.jsonl `BSTH09.2-転醒R03(A)` のユーザー裁定
      // (2026-08-01、案A) が +1 の表記脱落と確定しているため、他カードへ
      // 一般化せず、この親子面かつ既定 increment_1 に限定して帰属する。
      // parent が無い B 面単独、または countBonusMode:"none" は未帰属のまま
      // 残して、誤った +1 実装を隠さない。
      const isAdjudicatedCountOne =
        face.cardNo === "BSTH09.2-転醒R03(B)" &&
        parentFace?.cardNo === "BSTH09.2-転醒R03(A)" &&
        /^この面に裏返ったとき、フィールドに残り、カウント1する$/.test(
          normalized
        );
      if (!isFieldRemain && !isFieldRemainAndReset && !isAdjudicatedCountOne)
        return false;
      const rebirthActions = (parentFace?.effects ?? [])
        .flatMap((effect) => (effect.steps ?? []).map((step) => step?.action))
        .filter((action) => action?.kind === "rebirth");
      return isFieldRemainAndReset
        ? rebirthActions.some(
            (action) => action.countBonusMode === "reset_to_zero"
          )
        : isAdjudicatedCountOne
          ? rebirthActions.some(
              (action) =>
                action.countBonusMode === undefined ||
                action.countBonusMode === "increment_1"
            )
          : rebirthActions.length > 0;
    },
  },
  {
    // `Lv1-Lv2-Lv3` のような単独のレベル見出しは、後続本文の効果そのものでは
    // ない。列挙された全レベルがその面の levelDefs と一致する場合だけ、印字済み
    // レベル定義による宣言として帰属する。部分的な列挙は追加の対象範囲を表すため、
    // effects.textRef などの個別根拠なしにはここで隠さない。
    carrierPath: "levelDefs",
    testRefs: [
      "packages/rules-core/test/attacker-filtered-life-prevention.test.ts",
    ],
    behavior: "level-heading-all-defined-levels",
    testEvidence: {
      testRef:
        "packages/rules-core/test/attacker-filtered-life-prevention.test.ts",
      testName:
        "level-heading-all-defined-levels: TR12(B)/TR13(B) は全Lvでライフ減少を防止する",
    },
    matches: (face, line) => {
      const matchedLevels = [...line.matchAll(/Lv(\d+)/g)].map((match) =>
        Number(match[1])
      );
      return (
        /^Lv\d+(?:-Lv\d+)*$/.test(line) &&
        matchedLevels.length > 0 &&
        new Set(matchedLevels).size === matchedLevels.length &&
        Array.isArray(face.levelDefs) &&
        face.levelDefs.length === matchedLevels.length &&
        face.levelDefs.every((levelDef) =>
          matchedLevels.includes(levelDef.level)
        )
      );
    },
  },
];

const GENERAL_RULE_SPECS = [
  {
    ruleId: "song-type-classification",
    ruleRef:
      "manual/ai-reference/10_rules/03c3_activated-effect-labels.md:18-20",
    testRefs: ["packages/rules-core/test/bssa01-cards.test.ts"],
    behavior: "song-type-is-a-non-effect-classification-label",
    testEvidence: {
      testRef: "packages/rules-core/test/bssa01-cards.test.ts",
      testName:
        "BSSA01-C06 effects: 軽減シンボル紫/白扱い + 使用後フィールド残置 + スタック prevent_battle",
    },
    // 公式 FAQ BSC35 のとおり、タイプ：歌は参照/対象になり得る分類であって
    // それ自体は起動・誘発・常時効果を発揮しない。ここで cardNo を列挙せず、
    // ラベルだけを一般ルールとして扱う。
    matches: (line) => /^【タイプ：歌(?:／[^】]+)?】$/.test(line),
  },
  {
    ruleId: "rebirth-back-face-default",
    ruleRef:
      "manual/ai-reference/10_rules/08a_advent-rebirth-contract.md:93-96",
    testRefs: [
      "packages/rules-core/test/autorun-w1-advent-rebirth-fidelity.test.ts",
    ],
    behavior: "rebirth-boilerplate-exclusion",
    testEvidence: {
      testRef:
        "packages/rules-core/test/autorun-w1-advent-rebirth-fidelity.test.ts",
      testName:
        "各 B 面定義は boilerplate 由来の count_increase rebirth 効果を持たない",
    },
    matches: (line) => {
      // B 面の定型文は印字セットによって「カウント+1」と「残りカウント+1」、
      // 末尾の注記付きの揺れがある。いずれも RebirthAction が処理するルール本文で
      // あって effects に再実装すると二重加算になる。一方、符号のない
      // 「カウント1する」や +2/-2 等は裁定・個別実装を要するためここでは除外する。
      const normalized = line
        .replace(/（[^）]*）/g, "")
        .replace(/[。．]/g, "")
        .trim();
      return /^この(?:面に?|転醒後(?:スピリット|ブレイヴ|ネクサス)に?)裏返ったとき、フィールドに残(?:る|り)(?:、)?(?:残り)?カウント(?:を)?[+＋]1する$/.test(
        normalized
      );
    },
  },
];

export function collectTestEvidenceRefs(overrides = { accounts: {} }) {
  const refs = new Set(
    [...STRUCTURED_CARRIER_SPECS, ...GENERAL_RULE_SPECS]
      .map((spec) => spec.testEvidence?.testRef)
      .filter((testRef) => typeof testRef === "string")
  );
  for (const override of Object.values(overrides.accounts ?? {})) {
    if (typeof override?.testEvidence?.testRef === "string") {
      refs.add(override.testEvidence.testRef);
    }
  }
  return [...refs].sort();
}

export function sourceHash(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function lineId(cardNo, lineIndex) {
  return `${cardNo}:textLines[${lineIndex}]`;
}

/** coverage / fidelity 共通の効果テキスト検出。意味的な完全実装の判定ではない。 */
export const CARD_EFFECT_MARKER =
  /■|【|フラッシュ|スタック|〔|『|Lv\d|^メイン$/m;

/** 監査ではデッキ用プールを変更せず、表裏をそれぞれ1面として列挙する。 */
export function collectCardFaces(card) {
  const parentFace = card.__accountabilityParentFace;
  const faces = [{ cardNo: card.cardNo, face: card, parentFace }];
  if (card.backFace) {
    faces.push({
      cardNo: card.backFace.cardNo ?? `${card.cardNo}#backFace`,
      face: card.backFace,
      parentFace: card,
    });
  }
  return faces;
}

export function collectEffectContainers(face) {
  const out = [];
  const push = (path, effects) => {
    if (Array.isArray(effects)) out.push({ path, effects });
  };
  push("effects", face.effects);
  push("mirageData.effects", face.mirageData?.effects);
  push("accelData.effects", face.accelData?.effects);
  push("changeData.effects", face.changeData?.effects);
  push("zeroCounterData.effects", face.zeroCounterData?.effects);
  push("quartzData.effects", face.quartzData?.effects);
  face.grandwalkerData?.divineSkills?.forEach((skill, index) =>
    push(`grandwalkerData.divineSkills[${index}].effects`, skill.effects)
  );
  return out;
}

function effectPathsByTextLine(face) {
  const byLine = new Map();
  for (const { path, effects } of collectEffectContainers(face)) {
    effects.forEach((effect, effectIndex) => {
      if (!Array.isArray(effect?.textRef)) return;
      for (const index of effect.textRef) {
        const existing = byLine.get(index) ?? [];
        existing.push(`${path}[${effectIndex}]`);
        byLine.set(index, existing);
      }
    });
  }
  return byLine;
}

function findStructuredCarrier(face, line, parentFace, lineIndex, allCards) {
  return STRUCTURED_CARRIER_SPECS.find((spec) =>
    spec.matches(face, line, parentFace, lineIndex, allCards)
  );
}

function findGeneralRule(line) {
  return GENERAL_RULE_SPECS.find((spec) => spec.matches(line));
}

function isExecutionLike(line) {
  return /する|できる|置(?:く|ける)|戻(?:す|せる)|破棄|召喚|配置|合体|アタック|ブロック|裏返|発揮|受け(?:る|ない)|減(?:らす|る)|増(?:やす|える)|ドロー|除外|コア|BP|シンボル/.test(
    line
  );
}

export function sourceManifestHash(entries) {
  const manifest = entries
    .map((entry) => `${entry.id}\t${entry.textHash}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(manifest).digest("hex").slice(0, 16);
}

function readPath(value, path) {
  if (typeof path !== "string" || !path.trim()) return undefined;
  return path.split(".").reduce((current, segment) => {
    if (current === null || current === undefined) return undefined;
    return current[segment];
  }, value);
}

function testEvidenceFailure({
  cardNo,
  behavior,
  testRefs,
  testEvidence,
  discoveredTestTitles,
  requireIdentity,
}) {
  if (typeof behavior !== "string" || !behavior.trim()) {
    return "behavior must be a nonblank declared behavior mapping";
  }
  if (!testEvidence || typeof testEvidence !== "object") {
    return "testEvidence must name an executable it/test case";
  }
  const { testRef, testName } = testEvidence;
  if (typeof testRef !== "string" || !testRefs.includes(testRef)) {
    return "testEvidence.testRef must be one of testRefs";
  }
  if (typeof testName !== "string" || !testName.trim()) {
    return "testEvidence.testName must be nonblank";
  }
  if (
    requireIdentity &&
    (!testName.includes(cardNo) || !testName.includes(behavior))
  ) {
    return "testEvidence.testName must name this card and declared behavior";
  }
  const titles = discoveredTestTitles.get(testRef);
  if (!titles) {
    return `test evidence file was not discovered by Vitest: ${testRef}`;
  }
  if (
    ![...titles].some(
      (title) => title === testName || title.endsWith(` > ${testName}`)
    )
  ) {
    return `testEvidence does not identify a discovered non-skip Vitest case: ${testRef}`;
  }
  return null;
}

function ruleRefFailure(ruleRef) {
  const match =
    typeof ruleRef === "string"
      ? /^(manual\/ai-reference\/10_rules\/[A-Za-z0-9._-]+\.md):(\d+)(?:-(\d+))?$/.exec(
          ruleRef
        )
      : null;
  if (!match) {
    return "ruleRef must identify a manual/ai-reference/10_rules/*.md line range";
  }
  const start = Number(match[2]);
  const end = Number(match[3] ?? match[2]);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end < start
  ) {
    return "ruleRef line range is invalid";
  }
  const rulesRoot = resolve(
    process.cwd(),
    "manual",
    "ai-reference",
    "10_rules"
  );
  const path = resolve(process.cwd(), match[1]);
  if (!path.startsWith(`${rulesRoot}${sep}`) || !existsSync(path)) {
    return `ruleRef source does not exist: ${ruleRef}`;
  }
  const lineCount = readFileSync(path, "utf8").split(/\r?\n/).length;
  return end <= lineCount
    ? null
    : `ruleRef line range is outside source: ${ruleRef}`;
}

function overrideToEntry({
  id,
  cardNo,
  face,
  text,
  override,
  testFileContents,
  discoveredTestTitles,
}) {
  const base = {
    id,
    text,
    textHash: sourceHash(text),
    source: "explicit_override",
    reason: override.reason ?? null,
  };
  if (override.kind === "structured_carrier") {
    const testRefs = Array.isArray(override.testRefs) ? override.testRefs : [];
    const missingTests = testRefs.filter((ref) => !testFileContents.has(ref));
    const printedOracle = [
      "printed_oracle",
      "printed_placement_oracle",
    ].includes(override.behavior);
    const carrier =
      readPath(face, override.carrierPath) &&
      (!printedOracle || hasExactPrintedOracleCarrier(face, text)) &&
      (override.behavior !== "printed_normal_oracle" ||
        hasExactPrintedOracleCarrier(face, text, { normalOnly: true })) &&
      (override.behavior !== "printed_blue_magic_domain" ||
        hasExactBlueMagicDomainCarrier(face, text));
    const evidenceFailure = testEvidenceFailure({
      cardNo,
      behavior: override.behavior,
      testRefs,
      testEvidence: override.testEvidence,
      discoveredTestTitles,
      requireIdentity: true,
    });
    return {
      ...base,
      status:
        missingTests.length || !carrier || evidenceFailure
          ? "invalid_override"
          : "carrier_contract",
      carrierPath: override.carrierPath ?? null,
      testRefs,
      behavior: override.behavior ?? null,
      testEvidence: override.testEvidence ?? null,
      semanticStatus: "carrier_contract_with_executable_identity_behavior_test",
      invalidReason:
        !override.carrierPath ||
        !override.reason ||
        !override.behavior ||
        testRefs.length === 0 ||
        !override.testEvidence
          ? "structured_carrier override requires carrierPath, reason, behavior, testRefs, and testEvidence"
          : missingTests.length
            ? `test file not found: ${missingTests.join(", ")}`
            : !carrier
              ? `structured carrier is absent or does not match the printed contract at ${override.carrierPath}`
              : evidenceFailure
                ? evidenceFailure
                : null,
    };
  }
  if (override.kind === "general_rule") {
    const testRefs = Array.isArray(override.testRefs) ? override.testRefs : [];
    const missingTests = testRefs.filter((ref) => !testFileContents.has(ref));
    const evidenceFailure = testEvidenceFailure({
      cardNo,
      behavior: override.behavior,
      testRefs,
      testEvidence: override.testEvidence,
      discoveredTestTitles,
      requireIdentity: true,
    });
    const invalidRuleRef = ruleRefFailure(override.ruleRef);
    return {
      ...base,
      status:
        missingTests.length || evidenceFailure || invalidRuleRef
          ? "invalid_override"
          : "general_rule",
      ruleRef: override.ruleRef ?? null,
      testRefs,
      behavior: override.behavior ?? null,
      testEvidence: override.testEvidence ?? null,
      semanticStatus: "rule_contract_with_executable_identity_behavior_test",
      invalidReason:
        !override.ruleRef ||
        !override.reason ||
        !override.behavior ||
        testRefs.length === 0 ||
        !override.testEvidence
          ? "general_rule override requires ruleRef, reason, behavior, testRefs, and testEvidence"
          : missingTests.length
            ? `test file not found: ${missingTests.join(", ")}`
            : invalidRuleRef
              ? invalidRuleRef
              : evidenceFailure
                ? evidenceFailure
                : null,
    };
  }
  if (override.kind === "exemption") {
    return {
      ...base,
      status: override.reason ? "exemption" : "invalid_override",
      exemptionReason: override.reason ?? null,
      semanticStatus: "out_of_runtime_scope",
      invalidReason: override.reason
        ? null
        : "exemption override requires a concrete reason",
    };
  }
  return {
    ...base,
    status: "invalid_override",
    invalidReason: `unsupported override kind: ${String(override.kind)}`,
  };
}

function cardSpecificTestRefs(cardNo, testFileContents) {
  return [...testFileContents]
    .filter(([, source]) => source.includes(cardNo))
    .map(([path]) => path)
    .sort();
}

/**
 * 全 nonblank textLines の ledger を生成する。
 *
 * baseline は既知の legacy unclaimed line だけを許容する。baseline の作り直しは
 * 明示 command に限るので、新規/変更された未参照本文を黙って既知扱いにできない。
 */
export function buildTextAccountabilityLedger({
  cards,
  allCards = cards,
  baseline = { legacyUnclaimed: {} },
  overrides = { accounts: {} },
  testFileContents = new Map(),
  discoveredTestTitles = new Map(),
}) {
  const entries = [];
  const invalidOverrides = [];
  const seenIds = new Set();
  const accountOverrides = overrides.accounts ?? {};
  const legacyUnclaimed = baseline.legacyUnclaimed ?? {};

  for (const card of cards) {
    for (const { cardNo, face, parentFace } of collectCardFaces(card)) {
      const lines = face.textLines ?? [];
      const byLine = effectPathsByTextLine(face);
      const cardTestRefs = cardSpecificTestRefs(cardNo, testFileContents);

      lines.forEach((rawLine, lineIndex) => {
        const text = String(rawLine ?? "");
        if (!text.trim()) return;
        const id = lineId(cardNo, lineIndex);
        seenIds.add(id);
        const override = accountOverrides[id];
        if (override) {
          const entry = overrideToEntry({
            id,
            cardNo,
            face,
            text,
            override,
            testFileContents,
            discoveredTestTitles,
          });
          if (entry.invalidReason) invalidOverrides.push({ id, ...entry });
          entries.push(entry);
          return;
        }

        const directEffectPaths = byLine.get(lineIndex) ?? [];
        if (directEffectPaths.length > 0) {
          entries.push({
            id,
            text,
            textHash: sourceHash(text),
            source: "effects.textRef",
            status: "structural_only",
            effectPaths: directEffectPaths,
            testRefs: cardTestRefs,
            semanticStatus:
              cardTestRefs.length > 0
                ? "card_test_reference_present_not_proven_by_textRef"
                : "not_assessed",
          });
          return;
        }

        const carrier = findStructuredCarrier(
          face,
          text,
          parentFace,
          lineIndex,
          allCards
        );
        if (carrier) {
          const missingTests = carrier.testRefs.filter(
            (testRef) => !testFileContents.has(testRef)
          );
          const evidenceFailure = testEvidenceFailure({
            behavior: carrier.behavior,
            testRefs: carrier.testRefs,
            testEvidence: carrier.testEvidence,
            discoveredTestTitles,
            requireIdentity: false,
          });
          const entry = {
            id,
            text,
            textHash: sourceHash(text),
            source: "structured_carrier",
            status:
              missingTests.length || evidenceFailure
                ? "invalid_carrier"
                : "carrier_contract",
            carrierPath: carrier.carrierPath,
            testRefs: carrier.testRefs,
            behavior: carrier.behavior,
            testEvidence: carrier.testEvidence,
            semanticStatus: "carrier_contract_with_executable_behavior_test",
            invalidReason: missingTests.length
              ? `carrier test file not found: ${missingTests.join(", ")}`
              : evidenceFailure,
          };
          if (entry.invalidReason) invalidOverrides.push({ id, ...entry });
          entries.push(entry);
          return;
        }

        const generalRule = findGeneralRule(text);
        if (generalRule) {
          const missingTests = generalRule.testRefs.filter(
            (testRef) => !testFileContents.has(testRef)
          );
          const evidenceFailure = testEvidenceFailure({
            behavior: generalRule.behavior,
            testRefs: generalRule.testRefs,
            testEvidence: generalRule.testEvidence,
            discoveredTestTitles,
            requireIdentity: false,
          });
          const invalidRuleRef = ruleRefFailure(generalRule.ruleRef);
          const entry = {
            id,
            text,
            textHash: sourceHash(text),
            source: "general_rule",
            status:
              missingTests.length || evidenceFailure || invalidRuleRef
                ? "invalid_rule"
                : "general_rule",
            ruleId: generalRule.ruleId,
            ruleRef: generalRule.ruleRef,
            testRefs: generalRule.testRefs,
            behavior: generalRule.behavior,
            testEvidence: generalRule.testEvidence,
            semanticStatus: "rule_contract_with_executable_behavior_test",
            invalidReason: missingTests.length
              ? `general-rule test file not found: ${missingTests.join(", ")}`
              : (invalidRuleRef ?? evidenceFailure),
          };
          if (entry.invalidReason) invalidOverrides.push({ id, ...entry });
          entries.push(entry);
          return;
        }

        const known = legacyUnclaimed[id];
        const hash = sourceHash(text);
        const legacyMatches = known?.textHash === hash;
        entries.push({
          id,
          text,
          textHash: hash,
          source: "unclaimed",
          status: legacyMatches
            ? "legacy_actionable"
            : known
              ? "changed_unaccounted"
              : "new_unaccounted",
          // 全未帰属行は明示的な backlog に載せる。語彙判定は優先度の補助情報であり、
          // actionability を下げて実行的な制約文を出力から落とす根拠にはしない。
          actionable: true,
          executionLike: isExecutionLike(text),
          reason:
            "No effects.textRef, audited structured carrier, general rule, or justified exemption maps this source line.",
        });
      });
    }
  }

  // 原文訂正は immutable baseline を書き換えず、訂正前後の本文と実行証拠を固定する。
  const correctedSourceIds = new Set();
  for (const id of Object.keys(accountOverrides)) {
    if (!seenIds.has(id)) {
      invalidOverrides.push({
        id,
        status: "invalid_override",
        invalidReason:
          "override does not identify a current nonblank source line",
      });
    }
    const correction = accountOverrides[id]?.sourceCorrection;
    if (correction !== undefined) {
      const known = legacyUnclaimed[id];
      const current = entries.find((entry) => entry.id === id);
      if (
        known &&
        current?.source === "explicit_override" &&
        current.status === "carrier_contract" &&
        correction?.previousTextHash === known.textHash &&
        correction?.correctedTextHash === current.textHash &&
        current.textHash !== known.textHash &&
        typeof correction?.reason === "string" &&
        correction.reason.trim()
      ) {
        correctedSourceIds.add(id);
      } else {
        invalidOverrides.push({
          id,
          status: "invalid_override",
          invalidReason:
            "sourceCorrection requires exact baseline/current text hashes, a reason, and an executable structured-carrier override",
        });
      }
    }
  }

  const staleBaselineEntries = [];
  const resolvedBaselineEntries = [];
  for (const [id, known] of Object.entries(legacyUnclaimed)) {
    const current = entries.find((entry) => entry.id === id);
    if (!current) {
      staleBaselineEntries.push({
        id,
        status: "stale_baseline",
        reason: "baseline source line was removed",
      });
    } else if (
      current.textHash !== known.textHash &&
      !correctedSourceIds.has(id)
    ) {
      staleBaselineEntries.push({
        id,
        status: "stale_baseline",
        reason: "baseline source line text changed",
      });
    } else if (current.source !== "unclaimed") {
      resolvedBaselineEntries.push({
        id,
        source: current.source,
        status: current.status,
        ...(correctedSourceIds.has(id)
          ? { sourceCorrection: accountOverrides[id].sourceCorrection }
          : {}),
      });
    }
  }

  const byStatus = Object.groupBy(entries, ({ status }) => status);
  const unclaimed = entries.filter((entry) =>
    ["legacy_actionable", "changed_unaccounted", "new_unaccounted"].includes(
      entry.status
    )
  );
  const actionable = unclaimed.filter((entry) => entry.actionable);
  const failures = [
    ...entries.filter((entry) =>
      [
        "new_unaccounted",
        "changed_unaccounted",
        "invalid_carrier",
        "invalid_rule",
        "invalid_override",
      ].includes(entry.status)
    ),
    ...invalidOverrides.filter(
      (entry) =>
        !entries.some((line) => line.id === entry.id && line.invalidReason)
    ),
    ...staleBaselineEntries,
  ];

  return {
    schemaVersion: 2,
    generatedBy: "scripts/card-text-accountability-audit.mjs",
    sourceManifestHash: sourceManifestHash(entries),
    totals: {
      nonblank: entries.length,
      structuralOnly: (byStatus.structural_only ?? []).length,
      carrierContract: (byStatus.carrier_contract ?? []).length,
      generalRule: (byStatus.general_rule ?? []).length,
      exemption: (byStatus.exemption ?? []).length,
      legacyActionable: (byStatus.legacy_actionable ?? []).length,
      actionableLegacy: actionable.filter(
        (entry) => entry.status === "legacy_actionable"
      ).length,
      executionLikeLegacy: actionable.filter(
        (entry) =>
          entry.status === "legacy_actionable" && entry.executionLike === true
      ).length,
      newUnaccounted: (byStatus.new_unaccounted ?? []).length,
      changedUnaccounted: (byStatus.changed_unaccounted ?? []).length,
      invalid: failures.length,
    },
    gate: {
      clean: failures.length === 0,
      failures: failures.map((entry) => ({
        id: entry.id,
        status: entry.status,
        reason: entry.invalidReason ?? entry.reason,
      })),
    },
    entries,
    actionable,
    staleBaselineEntries,
    resolvedBaselineEntries,
  };
}

export function createLegacyBaseline(report) {
  const legacyUnclaimed = {};
  for (const entry of report.entries) {
    if (entry.source !== "unclaimed") continue;
    legacyUnclaimed[entry.id] = {
      textHash: entry.textHash,
      actionable: Boolean(entry.actionable),
      reason: entry.reason,
    };
  }
  return {
    schemaVersion: 2,
    sourceManifestHash: report.sourceManifestHash,
    note: "既存の未帰属 textLines を可視の actionable backlog として固定する baseline。新規または変更済みの未帰属本文は baseline 化せず gate failure にする。",
    legacyUnclaimed,
  };
}

/**
 * main に初めて導入する baseline の健全性を検査する。
 *
 * 初期 seed は「現時点で未帰属の行」以外を予約できない。main 導入後の
 * baseline 変更は CLI gate 側で拒否するため、この検査と組み合わせて
 * future line の二段階 preseed を防ぐ。
 */
export function validateInitialLegacyBaseline(
  report,
  baseline,
  { expectedSourceGitBase } = {}
) {
  const failures = [];
  const known = baseline.legacyUnclaimed ?? {};
  const currentUnclaimed = new Map(
    report.entries
      .filter((entry) => entry.source === "unclaimed")
      .map((entry) => [entry.id, entry])
  );

  if (baseline.schemaVersion !== 2) {
    failures.push("baseline schemaVersion must be 2");
  }
  if (baseline.sourceManifestHash !== report.sourceManifestHash) {
    failures.push("baseline sourceManifestHash does not match current source");
  }
  if (
    expectedSourceGitBase &&
    baseline.sourceGitBase !== expectedSourceGitBase
  ) {
    failures.push("baseline sourceGitBase does not match main");
  }

  for (const [id, entry] of Object.entries(known)) {
    const current = currentUnclaimed.get(id);
    if (!current || current.textHash !== entry.textHash) {
      failures.push(
        `baseline entry is not a current unclaimed source line: ${id}`
      );
    }
  }
  for (const id of currentUnclaimed.keys()) {
    if (!known[id]) {
      failures.push(
        `current unclaimed source line is absent from baseline: ${id}`
      );
    }
  }
  return failures;
}
