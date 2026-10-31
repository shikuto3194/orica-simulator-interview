/**
 * 制約の意味監査（pure / cardNo 非依存）。正源:
 * 10_rules/03e §回数制限、03a §余分コスト、2026-09-13 fidelity audit。
 *
 * violation: 静的な上下限矛盾、所属が一意な明示制約との矛盾。
 * review: 複数手順/分岐/条件付き回数や閾値で本文との対応が確定しないもの。
 * 対象外: 任意の自然文を完全解析すること、別Effect/エンジン側の補完の証明。
 * textRef が無ければ本文照合はしない。内側Effectの制約で外側を充足させない。
 * 結果pathは入力Effectを根とするJSONPath（$）。入力は変更しない。
 */
import { effectBodyText } from "./effect-optionality-detector.mjs";
import {
  extractQuantifiedEffectRepeats,
  quantifiedRepeatMeasureKind,
} from "./quantified-effect-repeat.mjs";

const PERIOD = {
  ターン: "turn",
  ゲーム: "game",
  ステップ: "step",
  バトル: "battle",
};
const RANGE_PAIRS = [
  ["min", "max"],
  ["minCount", "maxCount"],
  ["minCost", "maxCost"],
  ["minBp", "maxBp"],
  ["minCores", "maxCores"],
];
const LIMIT_KINDS = new Set(["per_instance", "per_card_name", "per_group"]);
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const normalize = (text) =>
  String(text ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "");
const display = (value) => JSON.stringify(value) ?? "未指定";
const list = (value) =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/**
 * 同じ textRef を共有する sibling Effect の step.prompt.sourceText は、その sibling
 * が本文のどの節を所有するかを明示する構造 carrier である。共有 textRef の先頭
 * Effect を検査する際、その節を残すと、後段だけに掛かる制限を先頭 Effect の
 * 制限欠落として誤検出する。cardNo ではなく、同一 textRef + action を持つ prompt
 * という一般形だけを対象にする。
 */
function siblingOwnedSourceTexts(effect, siblingEffects, text) {
  if (!Array.isArray(siblingEffects) || !object(effect)) return [];
  const textRef = JSON.stringify(effect.textRef ?? []);
  return siblingEffects.flatMap((sibling) => {
    if (
      sibling === effect ||
      !object(sibling) ||
      JSON.stringify(sibling.textRef ?? []) !== textRef
    )
      return [];
    return collectScope(sibling, "$.sibling")
      .nodes.filter(
        ({ node }) =>
          object(node.action) && typeof node.prompt?.sourceText === "string"
      )
      .map(({ node }) => normalize(node.prompt.sourceText))
      .filter(
        (sourceText) =>
          sourceText.length > 0 &&
          sourceText.length <= text.length &&
          text.includes(sourceText)
      );
  });
}
const costBoundPositions = new WeakMap();
const FREE_PAYMENT_RE = /コスト(?:を)?(?:支払わず|支払うことなく)/g;
const FREE_FIELD_ENTRY_RE =
  /コスト(?:を)?(?:支払わず|支払うことなく)(?:に)?(?:召喚|配置)/g;

/**
 * 「コストを支払わずに…使えない」は無償実行を指示する文ではなく、無償になった
 * カード使用を禁止する継続制約である。FREE_PAYMENT_RE は両方の表層を拾うため、
 * 支払い carrier の要求は文末まで禁止形と確定するものに限って除外する。
 *
 * 不明な動詞や肯定形は従来どおり review を残す。禁止対象を勝手に free carrier と
 * みなして静かに解消しないため、除外対象は「…できない」で閉じる同一文だけに絞る。
 */
function isFreePaymentProhibition(text, offset) {
  const sentenceEnd = text.indexOf("。", offset);
  const sentence = text.slice(
    offset,
    sentenceEnd === -1 ? text.length : sentenceEnd
  );
  return /^コスト(?:を)?(?:支払わず|支払うことなく)(?:に)?[^。]*(?:使えない|使用できない|召喚できない|配置できない|セットできない)$/.test(
    sentence
  );
}

/**
 * A single sentence can contain several free-payment clauses.  Keep the
 * textual verb and the unambiguous target wording with each occurrence so
 * that distinct carriers in the same effect are not made mutually
 * ambiguous merely because they share the same sentence/textRef.
 *
 * This is deliberately narrow: an absent or unsupported hint leaves the
 * full candidate list intact and therefore continues to produce a review.
 */
function freePaymentContext(text, offset) {
  const sentenceStart = text.lastIndexOf("。", offset) + 1;
  const beforeSentence = text.slice(sentenceStart, offset);
  // 「Aを…召喚するか、Bを…召喚する」では、A 枝の「このカード」は B 枝へ
  // 継承しない。直前の明示的な選択肢境界より前の対象語で carrier を絞ると、
  // B 枝の別対象 free carrier 欠落を self carrier が隠してしまう。対象語を
  // 識別できない枝は絞り込まず review を残す（fail-closed）。
  const choiceBoundary = beforeSentence.lastIndexOf("か、");
  const before =
    choiceBoundary >= 0
      ? beforeSentence.slice(choiceBoundary + "か、".length)
      : beforeSentence;
  const after = text.slice(offset);
  const verb = after.match(
    /^コスト(?:を)?(?:支払わず|支払うことなく)[^。]*?(召喚|配置|セット|使用)(?:する|できる)/
  )?.[1];
  return {
    actionKind: verb === "召喚" ? "summon" : verb === "セット" ? "set" : null,
    targetKind: /除外した対象/.test(before)
      ? "ref"
      : /このカード/.test(before)
        ? "self"
        : null,
    tribes: tribesBeforeOffsetInClause(text, offset),
    targetCount: cardCountBeforeOffsetInClause(text, offset),
  };
}

function narrowFreePaymentCandidates(candidates, mode) {
  let narrowed = candidates;
  if (mode.actionKind) {
    const actionMatches = narrowed.filter(({ node }) =>
      mode.actionKind === "set"
        ? [
            "quartz_set",
            "set_self_as_mirage",
            "deck_reveal",
            "search_zone",
          ].includes(node.kind)
        : mode.actionKind === "summon"
          ? node.kind === "summon" ||
            (node.kind === "brave_combine_effect" &&
              node.asSummon === true &&
              node.source === undefined)
          : node.kind === mode.actionKind
    );
    // Set has a fixed, enumerated set of carriers. If none matches, do not
    // fall back to an unrelated summon carrier. "summon" intentionally
    // retains that fallback for specialised free-entry carriers such as
    // reverse_rebirth.
    if (mode.actionKind === "set" || actionMatches.length > 0)
      narrowed = actionMatches;
  }
  if (mode.targetKind) {
    const targetMatches = narrowed.filter(
      ({ node }) => node.target?.kind === mode.targetKind
    );
    if (targetMatches.length > 0) narrowed = targetMatches;
  }
  return narrowed;
}

function boundsBeforeOffsetInSentence(text, bounds, offset) {
  const sentenceStart = text.lastIndexOf("。", offset) + 1;
  return bounds.filter((bound) => {
    const position = costBoundPositions.get(bound);
    return (
      position !== undefined &&
      position.start >= sentenceStart &&
      position.end <= offset
    );
  });
}

function boundBelongsToFreeFieldEntry(text, bound) {
  const position = costBoundPositions.get(bound);
  if (!position) return false;
  return [...text.matchAll(FREE_FIELD_ENTRY_RE)].some(
    (match) =>
      position.end <= (match.index ?? 0) &&
      boundsBeforeOffsetInSentence(text, [bound], match.index ?? 0).length === 1
  );
}

function cardNameBeforeOffsetInSentence(text, offset) {
  const sentenceStart = text.lastIndexOf("。", offset) + 1;
  const prefix = text.slice(sentenceStart, offset);
  const matches = [
    ...prefix.matchAll(/(カード名:)?「([^」]+)」(?:[0-9]+)?枚(?:まで)?を?$/g),
  ];
  const match = matches.at(-1);
  if (!match) return null;
  return {
    kind: match[1] ? "exact" : "contains",
    value: match[2],
  };
}

/**
 * 「カード名:『A』、または系統:『B』を持つ…をコストを支払わずに配置する」型の
 * 前半の名前指定を読む。後半の系統指定は `tribesBeforeOffsetInClause` が担当する。
 *
 * 通常の `cardNameBeforeOffsetInSentence` は無償文の直前にある単一対象だけを拾う。
 * ここでは明示された「または」だけを受け入れ、DeckRevealPick.filterOr の別枝と
 * 同一 pick 内で対応づける。任意の前方カード名を拾って別 pick に誤帰属させない。
 */
function alternativeCardNameBeforeOffsetInSentence(text, offset) {
  const sentenceStart = text.lastIndexOf("。", offset) + 1;
  const prefix = normalize(text.slice(sentenceStart, offset));
  const matches = [
    ...prefix.matchAll(
      /カード名:「([^」]+)」(?:[0-9]+)?枚?(?:まで)?、?または/g
    ),
  ];
  const match = matches.at(-1);
  return match ? { kind: "exact", value: match[1] } : null;
}

const CARD_CATEGORY_BY_TEXT = {
  スピリット: "spirit",
  アルティメット: "ultimate",
  ブレイヴ: "brave",
  ネクサス: "nexus",
  マジック: "magic",
};

/**
 * 「〜カード1枚をコストを支払わずに召喚/配置する」の直近対象カテゴリを読む。
 *
 * deck_reveal は、同一文の前半で別カードを手札へ加える pick を持てる。そのため
 * 文全体ではなく、free 文言の直前の読点区間だけを見る。カテゴリと field pick が
 * 一致すれば、数値コスト境界やカード名が無い本文でも対象を一意に結び付けられる。
 * DSL の category 配列は OR なので、単一カテゴリ本文には単一要素の完全一致を要求する。
 */
function categoryBeforeOffsetInClause(text, offset) {
  const sentenceStart = text.lastIndexOf("。", offset) + 1;
  const clauseStart = Math.max(
    sentenceStart,
    text.lastIndexOf("、", offset) + 1,
    text.lastIndexOf("，", offset) + 1
  );
  const prefix = text.slice(clauseStart, offset);
  const matches = [
    ...prefix.matchAll(
      /(スピリット|アルティメット|ブレイヴ|ネクサス|マジック)カード(?:[0-9０-９]+)?枚?(?:まで)?を?/g
    ),
  ];
  const match = matches.at(-1);
  return match ? CARD_CATEGORY_BY_TEXT[match[1]] : null;
}

/**
 * 「系統：「CB」を持つカード3枚までをコストを支払わずに召喚する」の対象系統を読む。
 *
 * カテゴリ本文が無い、または複数カテゴリを正しく許す deck_reveal field pick でも、
 * 直前の系統指定が filter と完全一致すれば対象を一意に結び付けられる。直近節末尾の
 * 「系統:…を持つ [カテゴリ]カードN枚」だけを認め、別対象を誤帰属させない。
 */
function tribesBeforeOffsetInClause(text, offset) {
  const sentenceStart = text.lastIndexOf("。", offset) + 1;
  const clauseStart = Math.max(
    sentenceStart,
    text.lastIndexOf("、", offset) + 1,
    text.lastIndexOf("，", offset) + 1
  );
  const prefix = normalize(text.slice(clauseStart, offset));
  const matches = [
    ...prefix.matchAll(
      /系統:((?:「[^」]+」(?:[/／・])?)+)を持つ(?:[赤紫緑白黄青](?:[/／・][赤紫緑白黄青])*)?の?(?:スピリット|アルティメット|ブレイヴ|ネクサス|マジック)?カード(?:[0-9]+)?枚?(?:まで)?を?$/g
    ),
  ];
  const match = matches.at(-1);
  return match
    ? [...match[1].matchAll(/「([^」]+)」/g)].map((tribe) => tribe[1])
    : [];
}

/**
 * 直近節末尾の「[カテゴリ]カードN枚までを」から、無償 field entry の選択上限を読む。
 * 対象を単数化した壊れた deck_reveal pick を、系統/filter 一致だけで見逃さない。
 * 数を一意に読めない本文は null を返し、既存どおり review を残す。
 */
function cardCountBeforeOffsetInClause(text, offset) {
  const sentenceStart = text.lastIndexOf("。", offset) + 1;
  const clauseStart = Math.max(
    sentenceStart,
    text.lastIndexOf("、", offset) + 1,
    text.lastIndexOf("，", offset) + 1
  );
  const prefix = normalize(text.slice(clauseStart, offset));
  const match = prefix.match(
    /(?:スピリット|アルティメット|ブレイヴ|ネクサス|マジック)?カード([0-9]+)枚?(?:まで)?を?$/
  );
  return match ? Number(match[1]) : null;
}

const CARD_COLOR_BY_TEXT = {
  赤: "red",
  紫: "purple",
  緑: "green",
  白: "white",
  黄: "yellow",
  青: "blue",
};

/** 無償文の直前にある「緑/青のカード」型の色集合を、正確な対象 filter と照合する。 */
function colorsBeforeOffsetInSentence(text, offset) {
  const sentenceStart = text.lastIndexOf("。", offset) + 1;
  const prefix = text.slice(sentenceStart, offset);
  const color = "赤紫緑白黄青";
  const matches = [
    ...prefix.matchAll(
      new RegExp(
        `([${color}](?:[/／・][${color}])*)の(?:スピリット|アルティメット|ブレイヴ|ネクサス|マジック)?カード(?:[0-9０-９]+)?枚?(?:まで)?を?$`,
        "g"
      )
    ),
  ];
  const match = matches.at(-1);
  return match
    ? match[1].split(/[/／・]/).map((value) => CARD_COLOR_BY_TEXT[value])
    : [];
}

const SOURCE_ZONE_BY_TEXT = {
  手札: "hand",
  トラッシュ: "trash",
  手元: "set_aside",
  デッキ: "deck",
  ライフ: "life",
};

/** 無償文の直前にある「自分の手札/トラッシュにある」型の検索元を照合する。 */
function sourceZoneScopeBeforeOffsetInSentence(text, offset) {
  const sentenceStart = text.lastIndexOf("。", offset) + 1;
  const prefix = text.slice(sentenceStart, offset);
  const zone = "手札|トラッシュ|手元|デッキ|ライフ";
  const matches = [
    ...prefix.matchAll(
      new RegExp(
        `(?<owner>自分|相手)の(?<zones>(?:${zone})(?:[/／・](?:${zone}))*)にある[^。]*$`,
        "g"
      )
    ),
  ];
  const match = matches.at(-1);
  return match
    ? {
        player: match.groups.owner === "自分" ? "self" : "opponent",
        zones: match.groups.zones
          .split(/[/／・]/)
          .map((value) => SOURCE_ZONE_BY_TEXT[value]),
      }
    : null;
}

const sameDistinctMemberSet = (actual, expected) =>
  actual.length === expected.length &&
  new Set(actual).size === actual.length &&
  new Set(expected).size === expected.length &&
  actual.every((value) => expected.includes(value));

const isExactSingleCardNameFilter = (value, expected) => {
  const filters = list(value);
  return (
    filters.length === 1 &&
    object(filters[0]) &&
    Object.keys(filters[0]).length === 1 &&
    filters[0][expected.kind] === expected.value
  );
};

// `search_zone` の1枚選択は、呼び出し側の executionMode で任意性を持つ
// `count:1` と、action 自身が任意範囲を表す `{min:0,max:1}` の双方がある。
// いずれも「1枚」を超えないが、max:2 などの拡張は carrier として許可しない。
const isSingleCard = (value) =>
  value === 1 || (object(value) && value.min === 0 && value.max === 1);

/** 親Effectのscope内だけを歩く。独立した内側Effectは別scopeで解析する。 */
function collectScope(effect, path) {
  const nodes = [];
  const nested = [];
  function visit(value, currentPath, parents = [], step = null) {
    if (!value || typeof value !== "object" || parents.includes(value)) return;
    if (Array.isArray(value)) {
      value.forEach((child, index) =>
        visit(child, `${currentPath}[${index}]`, [...parents, value], step)
      );
      return;
    }
    if (
      value !== effect &&
      object(value.timing) &&
      Array.isArray(value.steps)
    ) {
      // `grant_effect` 等の内側 Effect は、親の textRef を継承すると引用句の
      // 回数制限まで親と同じ本文として検査してしまう。親 step が sourceText で
      // 内側 Effect の原文範囲を明示した場合だけ、その範囲を子 Effect に渡す。
      // 任意の nested Effect へ親の prompt を広げないよう、直下の grantedEffect
      // と同一参照であることを要求する。
      const mappedText =
        step?.node?.action?.grantedEffect === value &&
        typeof step.node.prompt?.sourceText === "string"
          ? step.node.prompt.sourceText
          : "";
      const inheritedGrantTarget =
        step?.node?.action?.grantedEffect === value &&
        object(step.node.action.target)
          ? {
              target: step.node.action.target,
              path: `${step.path}.action.target`,
            }
          : null;
      nested.push({
        effect: value,
        path: currentPath,
        mappedText,
        inheritedGrantTarget,
      });
      return;
    }
    const ownerStep = object(value.action)
      ? { node: value, path: currentPath }
      : step;
    nodes.push({ node: value, path: currentPath, parents, step: ownerStep });
    for (const [key, child] of Object.entries(value)) {
      visit(child, `${currentPath}.${key}`, [...parents, value], ownerStep);
    }
  }
  visit(effect, path);
  return { nodes, nested };
}

function parseLimits(text) {
  const expected = [];
  const occupied = [];
  const add = (match, kind, duration, count, group) => {
    expected.push({
      kind,
      duration,
      maxCount: Number(count),
      ...(group ? { group } : {}),
      text: match[0],
      index: match.index,
    });
    occupied.push([match.index, match.index + match[0].length]);
  };
  for (const match of text.matchAll(/〔重複不可〕|この効果は重複しない/g))
    add(match, "no_duplicate", "event", 1);
  // keyword共有制限は任意のkeyword名を受け付ける（03e: per_group）。
  for (const match of text.matchAll(
    /[〔[【](ターン|ゲーム|ステップ|バトル)(?:中)?に?([0-9]+)回(?:(?::|：)?(同名)|(?::|：)(【[^】]+】))?[〕\]】]/g
  )) {
    const group = match[4]?.startsWith("【")
      ? match[4].slice(1, -1)
      : undefined;
    add(
      match,
      group
        ? "per_group"
        : match[3] === "同名"
          ? "per_card_name"
          : "per_instance",
      PERIOD[match[1]],
      match[2],
      group
    );
  }
  for (const match of text.matchAll(
    /(ターン|ゲーム|ステップ|バトル)(?:中)?に?([0-9]+)回(?!目)(しか(?:使えない|使用できない|発揮できない))?/g
  )) {
    if (
      occupied.some(([start, end]) => start <= match.index && match.index < end)
    )
      continue;
    // 「〜回目」は使用回数制限ではなく発生順序の条件であり、occurrenceGate が
    // 担当する。「ずつ」も観測対象ごとの制限等があるため通常の個体制限に決め打ちしない。
    if (text.slice(match.index + match[0].length).startsWith("ずつ")) continue;
    add(
      match,
      match[3] ? "per_card_name" : "per_instance",
      PERIOD[match[1]],
      match[2]
    );
  }
  return expected.sort((a, b) => a.index - b.index);
}

/**
 * 『この効果をLvと〔ターンに1回:同名〕を無視して発揮できる』のように、本文が
 * 明示して bypass する usageLimit は、再発揮側へ要求する制限ではない。括弧内の
 * 制限を通常の発揮制限として数えると、正しい reactivation DSL を欠落扱いにする。
 */
function excludesExplicitlyBypassedUsageLimit(text, limit) {
  const afterLimit = text.slice(limit.index + limit.text.length);
  return /^\s*を無視して(?:発揮|使用|解決)できる/.test(afterLimit);
}

/**
 * 「ターンに2回目に」のような発生順序は、宣言回数の上限ではない。これは
 * `usageLimit` ではなく、検出成功ごとの tally と厳密一致する occurrenceGate が
 * 担当する。本文に複数の順序条件がある場合は、単一 Effect の gate に畳めないため
 * 後段の照合で review を残す。
 */
function parseOccurrenceGates(text) {
  return [
    ...text.matchAll(/(ターン|ゲーム|ステップ|バトル)(?:中)?に?([0-9]+)回目/g),
  ].map((match) => ({
    duration: PERIOD[match[1]],
    targetCount: Number(match[2]),
    text: match[0],
    index: match.index ?? 0,
  }));
}

export function collectUsageLimitCarriers(owner, path) {
  return list(owner?.usageLimit)
    .filter(object)
    .map((limit, index) => {
      const overrides = list(limit.maxCountOverrides);
      const hasAdditionalDynamic =
        limit.maxCountAdditionalDynamic !== undefined;
      const entry = {
        kind: limit.kind,
        duration:
          limit.kind === "no_duplicate" ? "event" : (limit.duration ?? "turn"),
        maxCount: limit.maxCount ?? 1,
        group: limit.kind === "per_group" ? owner.limitGroupId : undefined,
        dynamic: hasAdditionalDynamic || overrides.length > 0,
        path: `${path}.usageLimit${Array.isArray(owner.usageLimit) ? `[${index}]` : ""}`,
      };
      // Evidence JSON は従来のコンパクトな制約表示を維持しつつ、条件付き上書きを
      // 本文と照合するための DSL を非列挙プロパティで保持する。
      Object.defineProperty(entry, "maxCountOverrides", {
        value: overrides,
        enumerable: false,
      });
      Object.defineProperty(entry, "hasAdditionalDynamic", {
        value: hasAdditionalDynamic,
        enumerable: false,
      });
      return entry;
    });
}
const usageAt = collectUsageLimitCarriers;

const sameAxis = (a, b) => a.kind === b.kind && a.duration === b.duration;
const isCombinedCondition = (when) =>
  Array.isArray(when) && when.length === 1 && when[0]?.kind === "combined";

function parseConditionalUsageOverrides(text, expected) {
  const overrides = [];
  for (const match of text.matchAll(
    /合体中(?:、|,)?この効果を(?:〔|\[)?(ターン|ゲーム|ステップ|バトル)(?:中)?に?([0-9]+)回(?::(同名|【[^】]+】))?(?:〕|\])?に変更する/g
  )) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const matchingLimit = expected.find(
      (limit) => limit.index >= start && limit.index < end
    );
    if (!matchingLimit) continue;
    // maxCountOverrides は既存 usageLimit の最大回数だけを置き換える。角括弧内に
    // 共有範囲が書かれない場合も、個体/同名/グループを新たに解釈してはならない。
    // 同じ期間の基礎制限が一意に定まるときだけ、その scope を継承する。
    const candidates = expected.filter((limit) => {
      if (limit.index >= start || limit.duration !== matchingLimit.duration)
        return false;
      if (match[3] === undefined) return true;
      return (
        sameAxis(limit, matchingLimit) &&
        (limit.kind !== "per_group" || limit.group === matchingLimit.group)
      );
    });
    if (candidates.length !== 1) continue;
    overrides.push({
      ...candidates[0],
      maxCount: matchingLimit.maxCount,
      text: matchingLimit.text,
      index: matchingLimit.index,
      condition: "combined",
    });
  }
  return overrides;
}

/**
 * 「自分のカウントN以上のとき、この効果をゲーム中に発揮できる回数を+Mする」型は、
 * 直前の同一期間の使用制限の上限を条件付きで置き換える。本文に共有scopeを書き直さ
 * ないため、新しいper_instance/per_card_nameを推測せず、先行する一意な制限から継承
 * する。印字の「中にに」のような重複助詞も原文のまま許容する。
 */
function parseCountValueUsageOverrides(text, expected) {
  const overrides = [];
  for (const match of text.matchAll(
    /自分のカウント([0-9]+)以上のとき、?この効果を(ターン|ゲーム|ステップ|バトル)(?:中)?に+?(?:発揮|使用|使)できる回数を[+＋]([0-9]+)する/g
  )) {
    const start = match.index ?? 0;
    const candidates = expected.filter(
      (limit) =>
        limit.index < start &&
        limit.duration === PERIOD[match[2]] &&
        finite(limit.maxCount)
    );
    if (candidates.length !== 1) continue;
    const base = candidates[0];
    overrides.push({
      ...base,
      maxCount: base.maxCount + Number(match[3]),
      text: match[0],
      index: start,
      condition: {
        kind: "count_value",
        player: "self",
        min: Number(match[1]),
      },
    });
  }
  return overrides;
}

const matchesConditionalUsageOverride = (limit, expected) =>
  list(limit.maxCountOverrides).some(
    (override) =>
      finite(override?.maxCount) &&
      override.maxCount === expected.maxCount &&
      ((expected.condition === "combined" &&
        isCombinedCondition(override.when)) ||
        (object(expected.condition) &&
          expected.condition.kind === "count_value" &&
          expected.condition.player === "self" &&
          finite(expected.condition.min) &&
          Array.isArray(override.when) &&
          override.when.length === 1 &&
          override.when[0]?.kind === "count_value" &&
          override.when[0]?.player === "self" &&
          override.when[0]?.min === expected.condition.min))
  );

/**
 * step.prompt.sourceText が root の usageLimit を所有する本文節を明示するとき、
 * root の残余本文へ同じ制限を再帰的に押し付けない。mapped step 側で同じcarrierを
 * 厳密に照合できる場合だけ成立するため、単に本文を隠して余分な制限を黙殺しない。
 */
function mappedUsageScopeCoversOwnUsage(own, mappedSteps) {
  if (own.length === 0 || !Array.isArray(mappedSteps)) return false;
  return own.every((actual) =>
    mappedSteps.some((step) => {
      const expected = parseLimits(step.text);
      const conditionalOverrides = [
        ...parseConditionalUsageOverrides(step.text, expected),
        ...parseCountValueUsageOverrides(step.text, expected),
      ];
      return expected.some(
        (limit) =>
          sameAxis(actual, limit) &&
          satisfies([actual], limit, conditionalOverrides)
      );
    })
  );
}

const satisfies = (actual, expected, conditionalOverrides = []) => {
  const onAxis = actual.filter((limit) => sameAxis(limit, expected));
  const relevantOverrides = conditionalOverrides.filter((override) =>
    sameAxis(override, expected)
  );
  const hasDynamic = onAxis.some((limit) => limit.dynamic);
  return (
    onAxis.length > 0 &&
    (hasDynamic
      ? onAxis.length === 1 &&
        finite(onAxis[0].maxCount) &&
        onAxis[0].maxCount === expected.maxCount &&
        relevantOverrides.length > 0 &&
        relevantOverrides.every((override) =>
          matchesConditionalUsageOverride(onAxis[0], override)
        )
      : onAxis.every((limit) => finite(limit.maxCount)) &&
        Math.min(...onAxis.map((limit) => limit.maxCount)) ===
          expected.maxCount) &&
    (expected.kind !== "per_group" ||
      onAxis.every(
        (limit) => typeof limit.group === "string" && limit.group.length > 0
      ))
  );
};

/**
 * `noop` の named gate が usageLimit を消費し、同一 effect 内の後続 action が
 * `ref_succeeded` でその gate に従属する形は、step ごとの制限分裂を防ぐ共通 carrier。
 * 本文が「さらに、ターンに1回、…」のように後段だけを明示した場合は、任意 gate の
 * 実行事実を参照する `ref_executed` の逐次後続も同じ carrier として扱う。後者を常に
 * 許すと、無関係な条件付き処理へ制限を誤帰属できるため、呼び出し側が本文位置を確認
 * した場合に限る。gate 自体が有効な action を持つ、または従属 action がない場合は
 * 所属を推定しない。
 */
function usageGateLimits(steps, path, { allowRefExecuted = false } = {}) {
  return steps.flatMap((step, index) => {
    if (
      !object(step) ||
      typeof step.id !== "string" ||
      step.id.length === 0 ||
      step.action?.kind !== "noop" ||
      step.usageLimit === undefined
    )
      return [];
    const hasDependentAction = steps.some((candidate) => {
      if (
        candidate === step ||
        !object(candidate?.action) ||
        candidate.stepCondition?.stepId !== step.id
      )
        return false;
      if (candidate.stepCondition.kind === "ref_succeeded") return true;
      return (
        allowRefExecuted &&
        candidate.connector === "sequential" &&
        candidate.stepCondition.kind === "ref_executed"
      );
    });
    return hasDependentAction ? usageAt(step, `${path}.steps[${index}]`) : [];
  });
}

function singleSelfSummon(effect) {
  if (
    !object(effect) ||
    !Array.isArray(effect.steps) ||
    effect.steps.length !== 1
  )
    return null;
  const [step] = effect.steps;
  if (
    !object(step) ||
    step.choice !== undefined ||
    step.choices !== undefined ||
    step.branches !== undefined ||
    !object(step.action) ||
    step.action.kind !== "summon" ||
    step.action.target?.kind !== "self"
  )
    return null;
  return step.action;
}

function sameActivationDeclaration(left, right) {
  return (
    JSON.stringify({
      timing: left.timing ?? null,
      timingScope: left.timingScope ?? null,
      applicability: left.applicability ?? null,
      executionMode: left.executionMode ?? null,
    }) ===
    JSON.stringify({
      timing: right.timing ?? null,
      timingScope: right.timingScope ?? null,
      applicability: right.applicability ?? null,
      executionMode: right.executionMode ?? null,
    })
  );
}

/**
 * 「召喚できる。〔ターンに1回:同名〕このとき、コストを支払わずに召喚できる」型は、
 * 通常支払いと無料の選択肢を同じ宣言窓に並べるため、同じ textRef の兄弟 Effect に
 * 分ける。回数制限と無料指定は後者だけに所属し、前者に重ねると通常支払い経路まで
 * 不当に制限する。原文・起動宣言・self summon・兄弟 usageLimit を全て一致させた
 * 場合だけ、この分割を正しい carrier と認識する。
 */
function hasPairedFreeSelfSummonVariant(unit) {
  const expected = parseLimits(unit.text);
  const paid = singleSelfSummon(unit.node);
  if (
    expected.length !== 1 ||
    !/(?:〔|\[)(?:ターン|ゲーム|ステップ|バトル)[^〕\]]*(?:〕|\])(?:このとき、?)?コスト(?:を)?(?:支払わず|支払うことなく)[^。]*召喚/.test(
      unit.text
    ) ||
    unit.node.timing?.kind !== "activated" ||
    !paid ||
    paid.costModifier !== undefined ||
    usageAt(unit.node, unit.path).length !== 0 ||
    !Array.isArray(unit.siblingEffects)
  )
    return false;
  const textRef = JSON.stringify(unit.node.textRef ?? []);
  return unit.siblingEffects.some((sibling) => {
    const free = singleSelfSummon(sibling);
    return (
      JSON.stringify(sibling.textRef ?? []) === textRef &&
      sameActivationDeclaration(unit.node, sibling) &&
      free?.costModifier === "free" &&
      satisfies(usageAt(sibling, "$.sibling"), expected[0])
    );
  });
}

/**
 * 「このスピリットは相手の効果を受けず、バトル終了時、ターンに1回、回復する」型は、
 * 攻撃中だけの耐性とバトル終了時の回復を別 Effect に分離する。
 *
 * 耐性を同じ deferred Effect に畳むと battle scope が pending battle-end 解決より先に
 * 失効するため、正しい DSL は (1) attack 時の self battle-immunity と、(2) 同じ
 * 印字文の attack→battle_end self-recover を兄弟 Effect にする形である。本文、
 * timing、対象、duration、単一 recovery step がすべて一致する場合だけ、後者の
 * usageLimit を前者の本文上の「ターンに1回」の carrier として認める。
 *
 * これにより、同じカードの別の attack effect や異なる対象への回復を無関係に
 * 横断しない。壊れた usageLimit は候補として可視化したまま通常の mismatch/review
 * 経路に流す。
 */
function siblingBattleEndRecoverUsageLimits(unit) {
  const immunity = unit.node;
  if (
    immunity?.timing?.kind !== "card_event" ||
    immunity.timing.event !== "attack" ||
    immunity.timing.deferredTo !== undefined ||
    !Array.isArray(immunity.steps) ||
    immunity.steps.length !== 1 ||
    immunity.steps[0]?.action?.kind !== "effect_immunity" ||
    immunity.steps[0].action.target?.kind !== "self" ||
    immunity.steps[0].action.duration?.scope !== "battle" ||
    !Array.isArray(unit.siblingEffects) ||
    !/この(?:スピリット|アルティメット)は、?相手の効果を受けず、?バトル終了時、?(?:〔)?ターンに[0-9０-９]+回(?:〕)?、?回復/.test(
      unit.text
    )
  )
    return [];

  const candidates = unit.siblingEffects.filter(
    (sibling) =>
      JSON.stringify(sibling.textRef ?? []) ===
        JSON.stringify(immunity.textRef ?? []) &&
      sibling.timing?.kind === "card_event" &&
      sibling.timing.event === "attack" &&
      sibling.timing.deferredTo === "battle_end" &&
      Array.isArray(sibling.steps) &&
      sibling.steps.length === 1 &&
      sibling.steps[0]?.action?.kind === "recover" &&
      sibling.steps[0].action.target?.kind === "self"
  );
  if (candidates.length !== 1) return [];
  const siblingIndex = unit.siblingEffects.indexOf(candidates[0]);
  return usageAt(candidates[0], `${unit.path}.siblingEffects[${siblingIndex}]`);
}

/**
 * 「〜できる。自分のカウントN以上のとき、ターンに1回、このスピリット/アルティメットは
 * 回復する」型では、任意の先行 action と条件付き自己回復を別 Effect に分ける。
 *
 * 回数制限は後段の回復だけに属する。先行 action 側へ usageLimit を昇格すると、本文に
 * ない回数制限を付与してしまう。一方で同一カードの任意の兄弟 Effect を横断すると誤帰属
 * になるため、共有 textRef・同一 attack timing・基礎条件の完全継承・count 条件の一つだけの
 * 追加・自己回復一手順を全て満たす唯一の sibling だけを carrier として認める。
 */
function siblingConditionalSelfRecoverUsageLimits(unit) {
  const source = unit.node;
  const expected = parseLimits(unit.text);
  const clause = unit.text.match(
    /自分のカウント([0-9]+)以上のとき、?\s*(?:〔|\[)?ターンに([0-9]+)回(?:〕|\])?、?\s*この(?:スピリット|アルティメット)は回復(?:する|できる)/
  );
  if (
    expected.length !== 1 ||
    !clause ||
    source?.timing?.kind !== "card_event" ||
    source.timing.event !== "attack" ||
    source.timing.deferredTo !== undefined ||
    source.executionMode !== "optional" ||
    usageAt(source, unit.path).length !== 0 ||
    !Array.isArray(source.steps) ||
    source.steps.length !== 1 ||
    !object(source.steps[0]?.action) ||
    !Array.isArray(unit.siblingEffects)
  )
    return [];

  const countThreshold = Number(clause[1]);
  const sourceConditions = list(source.condition);
  const textRef = JSON.stringify(source.textRef ?? []);
  if (textRef === "[]") return [];
  const candidates = unit.siblingEffects.filter((sibling) => {
    if (
      sibling === source ||
      JSON.stringify(sibling?.textRef ?? []) !== textRef ||
      sibling?.timing?.kind !== "card_event" ||
      sibling.timing.event !== "attack" ||
      sibling.timing.deferredTo !== undefined ||
      JSON.stringify(sibling?.applicability ?? null) !==
        JSON.stringify(source.applicability ?? null) ||
      sibling.executionMode !== undefined ||
      !Array.isArray(sibling.steps) ||
      sibling.steps.length !== 1 ||
      sibling.steps[0]?.action?.kind !== "recover" ||
      sibling.steps[0].action.target?.kind !== "self"
    )
      return false;

    const siblingConditions = list(sibling.condition);
    if (siblingConditions.length !== sourceConditions.length + 1) return false;
    const remaining = [...siblingConditions];
    for (const condition of sourceConditions) {
      const index = remaining.findIndex(
        (candidate) => JSON.stringify(candidate) === JSON.stringify(condition)
      );
      if (index === -1) return false;
      remaining.splice(index, 1);
    }
    return (
      remaining[0]?.kind === "count_value" &&
      remaining[0]?.player === "self" &&
      remaining[0]?.min === countThreshold
    );
  });
  if (candidates.length !== 1) return [];
  const siblingIndex = unit.siblingEffects.indexOf(candidates[0]);
  return usageAt(candidates[0], `${unit.path}.siblingEffects[${siblingIndex}]`);
}

/**
 * 手札での恒久的な性質と、同じ本文行の「〜したとき、コストを支払わずに使用できる」
 * を別 Effect に分けるカードがある。後者は game_event 起点の
 * use_magic_without_cost という実行 carrier を持つが、前者（例: 手札で相手の効果を
 * 受けない）を本文照合の起点にすると親 scope 内だけを見る通常規約では見つからない。
 *
 * 同一 card 内で textRef と source zone が一致し、恒久 effect と game_event effect
 * が明確に分離されている場合だけ sibling の単一 free-use step を拾う。単なる同カードの
 * 別 Effect 横断は行わず、本文や zone が異なる候補を誤帰属させない。
 */
function siblingConditionalFreeMagicUseCandidates(unit) {
  if (
    unit.node?.timing?.kind !== "continuous" ||
    !Array.isArray(unit.node?.steps) ||
    !Array.isArray(unit.siblingEffects)
  )
    return [];
  const textRef = JSON.stringify(unit.node.textRef ?? []);
  if (textRef === "[]") return [];
  const zoneScope = JSON.stringify(
    [...list(unit.node.applicability?.zone)].sort()
  );
  if (zoneScope === "[]") return [];
  return unit.siblingEffects.flatMap((sibling, siblingIndex) => {
    if (
      sibling === unit.node ||
      sibling?.timing?.kind !== "game_event" ||
      JSON.stringify(sibling.textRef ?? []) !== textRef ||
      JSON.stringify([...list(sibling.applicability?.zone)].sort()) !==
        zoneScope
    )
      return [];
    const freeUse = collectScope(
      sibling,
      `$.siblingEffects[${siblingIndex}]`
    ).nodes.filter(({ node }) => node.kind === "use_magic_without_cost");
    return freeUse.length === 1 ? freeUse : [];
  });
}

/**
 * 手札などでの恒久的な性質と、同じ本文行の「〜することで、コストを支払わずに
 * 配置できる」通常行動許可を別 Effect に分けるカードがある。後者は summon の
 * normalActionPermission と costModifier が一体の実行 carrier だが、前者を本文照合の
 * 起点にすると親 scope 内だけを見る通常規約では見つからない。
 *
 * 同一 card 内で textRef と source zone が一致する継続 Effect に限り、兄弟の単一
 * normalActionPermission/free self summon を拾う。これにより本文行を共有する別効果を
 * 無差別に横断せず、無償の配置許可そのものだけを支払い carrier として認識する。
 */
function siblingNormalActionFreePlacementCandidates(unit) {
  if (
    unit.node?.timing?.kind !== "continuous" ||
    !Array.isArray(unit.node?.steps) ||
    !Array.isArray(unit.siblingEffects)
  )
    return [];
  const textRef = JSON.stringify(unit.node.textRef ?? []);
  if (textRef === "[]") return [];
  const zoneScope = JSON.stringify(
    [...list(unit.node.applicability?.zone)].sort()
  );
  if (zoneScope === "[]") return [];
  return unit.siblingEffects.flatMap((sibling, siblingIndex) => {
    const siblingZones = [...list(sibling?.applicability?.zone)].sort();
    if (
      sibling === unit.node ||
      sibling?.timing?.kind !== "continuous" ||
      JSON.stringify(sibling.textRef ?? []) !== textRef ||
      JSON.stringify(siblingZones) !== zoneScope
    )
      return [];
    const freePlacement = collectScope(
      sibling,
      `$.siblingEffects[${siblingIndex}]`
    ).nodes.filter(
      ({ node }) =>
        node.kind === "summon" &&
        node.normalActionPermission === true &&
        node.target?.kind === "self" &&
        sameDistinctMemberSet(list(node.target.zone), siblingZones) &&
        node.costModifier === "free"
    );
    return freePlacement.length === 1 ? freePlacement : [];
  });
}

/**
 * 同一の印字文を「対象を絞る常時効果」と「対象マジックを無料化する常時効果」に
 * 分けるカードがある。後者の `cost_modify` は、通常の自身召喚/配置と違って
 * `target` を持たず `player + cardFilter` で適用先を表す。
 *
 * 無条件の「自分は、系統…を持つマジックカードを…使用できる」という一文と、
 * 単一直下 step の永続無料化だけを対応させる。追加の本文修飾・DSL 制約・分岐は
 * この carrier では証明できないため review に残す。category と系統も完全一致させ、
 * 同じ textRef の単一候補だけを受理する（カード番号には依存しない）。
 */
function siblingContinuousFreeMagicCostModifyCandidates(unit, mode) {
  if (
    unit.node?.timing?.kind !== "continuous" ||
    mode.category !== "magic" ||
    !Array.isArray(unit.siblingEffects)
  )
    return [];
  const textRef = JSON.stringify(unit.node.textRef ?? []);
  if (textRef === "[]") return [];
  const expectedTribes = list(mode.tribes);
  const sentenceStart = unit.text.lastIndexOf("。", mode.offset) + 1;
  const sentenceEnd = unit.text.indexOf("。", mode.offset);
  const sentence = unit.text.slice(
    sentenceStart,
    sentenceEnd < 0 ? undefined : sentenceEnd
  );
  if (
    !/^自分は、系統:「[^」]+」(?:[/・]「[^」]+」)*を持つマジックカードをコストを支払わずに使用できる$/.test(
      sentence
    )
  )
    return [];
  const hasOnlyKeys = (value, keys) =>
    object(value) && Object.keys(value).every((key) => keys.includes(key));
  const matches = unit.siblingEffects.flatMap((sibling, siblingIndex) => {
    if (
      sibling?.timing?.kind !== "continuous" ||
      JSON.stringify(sibling.textRef ?? []) !== textRef ||
      !hasOnlyKeys(sibling, ["timing", "textRef", "steps"]) ||
      !hasOnlyKeys(sibling.timing, ["kind"]) ||
      !Array.isArray(sibling.steps) ||
      sibling.steps.length !== 1 ||
      !hasOnlyKeys(sibling.steps[0], ["action"])
    )
      return [];
    const node = sibling.steps[0].action;
    if (
      !hasOnlyKeys(node, [
        "kind",
        "player",
        "cardFilter",
        "modifier",
        "duration",
      ]) ||
      node.kind !== "cost_modify" ||
      node.player !== "self" ||
      node.modifier !== "free" ||
      !hasOnlyKeys(node.duration, ["scope"]) ||
      node.duration.scope !== "permanent" ||
      !hasOnlyKeys(node.cardFilter, ["category", "tribes"]) ||
      !sameDistinctMemberSet(list(node.cardFilter.category), [mode.category]) ||
      !sameDistinctMemberSet(list(node.cardFilter.tribes), expectedTribes)
    )
      return [];
    return [
      { node, path: `$.siblingEffects[${siblingIndex}].steps[0].action` },
    ];
  });
  return matches.length === 1 ? matches : [];
}

/**
 * 手札の activated effect が自己召喚を開始し、同じ原文・条件を持つ continuous
 * effect が `cost_modify` と代替支払いを担う場合がある。前者へ `costModifier:
 * "free"` を重ねると、代替支払いの carrier を二重化してしまう。そのため、本文参照・
 * 発揮元ゾーン・条件・時期範囲・自己対象・代替支払いをすべて一致させた兄弟だけを、
 * 無償召喚の唯一の支払い carrier として認識する。
 *
 * `useCostPayment` のない一般的な継続コスト修飾はここで横断しない。起動効果の
 * 手札自己召喚に結び付く明示的な代替支払いだけを許可し、曖昧な同一カード内参照は
 * review のまま残す。
 */
function activatedTimingScope(effect) {
  if (object(effect.timingScope)) return effect.timingScope;
  switch (effect.timing?.mode) {
    case "main":
      return { player: "self", period: "main" };
    case "flash":
      return { player: "both", period: "attack" };
    default:
      return null;
  }
}

function continuousScopeCoversActivatedScope(continuous, activated) {
  if (continuous === undefined) return true;
  if (!object(continuous) || !object(activated)) return false;
  const playerCovers =
    continuous.player === "both" || continuous.player === activated.player;
  const periodCovers =
    continuous.period === undefined ||
    continuous.period === "turn" ||
    continuous.period === activated.period;
  const subPhaseCovers =
    continuous.subPhase === undefined ||
    (activated.subPhase !== undefined &&
      continuous.subPhase === activated.subPhase);
  return playerCovers && periodCovers && subPhaseCovers;
}

function trashCoreMovePaymentMatchesText(payment, text) {
  const match = text.match(
    /トラッシュのコア\s*(\d+)個以上をフィールド\s*\/\s*リザーブに置くことで/
  );
  return (
    match !== null &&
    payment?.kind === "core_move" &&
    payment.sourceZone === "trash" &&
    payment.minCount === Number(match[1])
  );
}

function siblingActivatedHandSummonFreePaymentCandidates(unit) {
  const activatedSummon = singleSelfSummon(unit.node);
  const scope = activatedTimingScope(unit.node);
  if (
    unit.node?.timing?.kind !== "activated" ||
    !activatedSummon ||
    activatedSummon.costModifier !== undefined ||
    !list(unit.node.applicability?.zone).includes("hand") ||
    scope === null ||
    !Array.isArray(unit.siblingEffects)
  )
    return [];
  const textRef = JSON.stringify(unit.node.textRef ?? []);
  if (textRef === "[]") return [];
  const condition = JSON.stringify(unit.node.condition ?? []);
  return unit.siblingEffects.flatMap((sibling, siblingIndex) => {
    const applicability = sibling?.applicability;
    const siblingCanApplyInHand =
      !object(applicability) ||
      ((applicability.zone === undefined ||
        list(applicability.zone).includes("hand")) &&
        applicability.level === undefined &&
        applicability.combined === undefined &&
        applicability.imaginDualCombined === undefined &&
        applicability.soulState === undefined &&
        applicability.adventSourceHostVariants === undefined);
    if (
      sibling === unit.node ||
      sibling?.timing?.kind !== "continuous" ||
      JSON.stringify(sibling.textRef ?? []) !== textRef ||
      JSON.stringify(sibling.condition ?? []) !== condition ||
      !siblingCanApplyInHand ||
      !continuousScopeCoversActivatedScope(sibling.timingScope, scope)
    )
      return [];
    const payment = collectScope(
      sibling,
      `$.siblingEffects[${siblingIndex}]`
    ).nodes.filter(
      ({ node }) =>
        node.kind === "cost_modify" &&
        node.target?.kind === "self" &&
        node.modifier === "free" &&
        trashCoreMovePaymentMatchesText(node.useCostPayment, unit.text)
    );
    return payment.length === 1 ? payment : [];
  });
}

/**
 * 「Aする。その後、ターンに1回、Bできる」型では、末尾のB stepだけの
 * usageLimit が本文どおりである。prompt.sourceText を付けずとも、文の接続詞と
 * 直接stepの順序が両方一致する場合だけその所属を認める。途中stepや「その後」を
 * 持たない本文へは広げず、異なるscopeの壊れた制限は引き続き検出する。
 */
function trailingClauseUsageLimits(steps, path, text, expected) {
  if (!Array.isArray(steps) || steps.length < 2)
    return { limits: [], expected: [] };
  const usageSteps = steps
    .map((step, index) => ({ step, index }))
    .filter(
      ({ step }) => object(step?.action) && step.usageLimit !== undefined
    );
  const first = usageSteps[0];
  if (!first || first.step.connector !== "sequential")
    return { limits: [], expected: [] };
  const trailingExpected = expected.filter((limit) =>
    /(?:。|．)その後、?$/.test(text.slice(0, limit.index).replace(/\s/g, ""))
  );
  if (trailingExpected.length !== 1) return { limits: [], expected: [] };
  const carriedSuffix = steps.slice(first.index + 1).every((step) => {
    if (!object(step) || !object(step.action)) return false;
    if (step.usageLimit !== undefined)
      return (
        typeof first.step.usageGroupId === "string" &&
        first.step.usageGroupId.length > 0 &&
        step.usageGroupId === first.step.usageGroupId
      );
    return (
      typeof first.step.id === "string" &&
      step.stepCondition?.kind === "ref_succeeded" &&
      step.stepCondition.stepId === first.step.id
    );
  });
  if (!carriedSuffix) return { limits: [], expected: [] };
  return {
    limits: usageSteps.flatMap(({ step, index }) =>
      usageAt(step, `${path}.steps[${index}]`)
    ),
    expected: trailingExpected,
  };
}

/**
 * 「Aする。さらに、ステップに1回、Bできる」型では、B step だけの
 * usageLimit が本文どおりである。先行 action と後段 action は同じ発揮で解決するが、
 * 回数文は「さらに」以後の B だけを修飾する。effect 自身に制限を置くと A まで
 * 不当に制限するため、末尾 step が唯一の制限所有者である場合だけ認める。
 * 「さらに」は同じ発揮内の後段を導くため、DSL では同時解決を表す simultaneous
 * だけでなく、前段の盤面変更を後段 action に渡す sequential でも表現できる。
 * 接続詞、step 順序、末尾性のいずれかを失う形は review に残す。
 */
function additionalClauseUsageLimits(steps, path, text, expected) {
  if (!Array.isArray(steps) || steps.length < 2)
    return { limits: [], expected: [] };
  const candidates = steps
    .map((step, index) => ({ step, index }))
    .filter(
      ({ step, index }) =>
        index > 0 && object(step?.action) && step.usageLimit !== undefined
    );
  if (candidates.length !== 1) return { limits: [], expected: [] };
  const [{ step, index }] = candidates;
  if (
    index !== steps.length - 1 ||
    (step.connector !== "simultaneous" && step.connector !== "sequential") ||
    !steps
      .slice(0, index)
      .every((prior) => object(prior?.action) && prior.usageLimit === undefined)
  )
    return { limits: [], expected: [] };
  const additionalExpected = expected.filter((limit) =>
    // 「さらに、条件のとき、ターンに1回、Bする」も、前段 A ではなく
    // 条件付きの後段 B だけを制限する。条件節をまたぐ場合でも、文頭から次の
    // 句点までを横断してはいけないため、直前の「さらに、」と「とき、」だけを
    // 同一文内で許可する。
    /(?:。|．)さらに、(?:[^。．]*とき、)?$/.test(
      text.slice(0, limit.index).replace(/\s/g, "")
    )
  );
  if (additionalExpected.length !== 1) return { limits: [], expected: [] };
  return {
    limits: usageAt(step, `${path}.steps[${index}]`),
    expected: additionalExpected,
  };
}

/**
 * 「Aし、ターンに1回、このスピリットは回復する」型では、読点以後の自己回復
 * だけが回数制限を所有する。A と回復は同じ発揮で順に解決するが、制限を Effect
 * 全体へ置くと本文にない A の回数制限になる。
 *
 * 「その後」「さらに」と違い、独立した文節を示す語がないため、自己回復の主語・
 * 末尾性・直接の sequential step をすべて確認する。これにより、読点だけを根拠に
 * 任意の後段 action へ制限を誤帰属させない。
 */
function commaSelfRecoverClauseUsageLimits(steps, path, text, expected) {
  if (!Array.isArray(steps) || steps.length < 2)
    return { limits: [], expected: [] };
  const candidates = steps
    .map((step, index) => ({ step, index }))
    .filter(
      ({ step, index }) =>
        index > 0 &&
        step?.action?.kind === "recover" &&
        step.action.target?.kind === "self" &&
        step.usageLimit !== undefined
    );
  if (candidates.length !== 1) return { limits: [], expected: [] };
  const [{ step, index }] = candidates;
  if (
    index !== steps.length - 1 ||
    step.connector !== "sequential" ||
    !steps
      .slice(0, index)
      .every((prior) => object(prior?.action) && prior.usageLimit === undefined)
  )
    return { limits: [], expected: [] };
  const selfRecoverExpected = expected.filter((limit) => {
    const before = normalize(text.slice(0, limit.index));
    const after = normalize(text.slice(limit.index + limit.text.length));
    return (
      /、$/.test(before) &&
      /^、?この(?:スピリット|アルティメット)は回復(?:する|できる)[。．]?$/.test(
        after
      )
    );
  });
  if (selfRecoverExpected.length !== 1) return { limits: [], expected: [] };
  return {
    limits: usageAt(step, `${path}.steps[${index}]`),
    expected: selfRecoverExpected,
  };
}

/**
 * 「Aする。さらに、この効果発揮後、ターンに1回、Bできる」型では、B を
 * `after_triggers` へ送る step の usageLimit だけが本文の回数文を所有する。
 * 「この効果発揮後」は A による誘発を先に解決してから B へ戻る接続詞なので、
 * `sequential` ではその carrier を認めない。親 Effect に制限を置くと、本文に
 * 制限のない A まで制限してしまう。
 */
function afterTriggeredClauseUsageLimits(steps, path, text, expected) {
  if (!Array.isArray(steps) || steps.length < 2)
    return { limits: [], expected: [] };
  const candidates = steps
    .map((step, index) => ({ step, index }))
    .filter(
      ({ step, index }) =>
        index > 0 &&
        object(step?.action) &&
        step.connector === "after_triggers" &&
        step.usageLimit !== undefined
    );
  if (candidates.length !== 1) return { limits: [], expected: [] };
  const afterTriggeredExpected = expected.filter((limit) =>
    // 「この効果発揮後」の直後に Lv / バトル中などの条件句を挟んでから
    // 回数制限を書くカードがある。先行 action を先に解決して待機誘発を処理してから
    // 後段 action へ戻るという接続詞そのものは変わらないため、当該文節内で
    // 句点をまたがずに制限まで到達する形を同じ after_triggers carrier として扱う。
    // 句点をまたぐ別文の制限には広げず、後段 step とその従属 suffix の構造確認も
    // 引き続き必須にする。
    /(?:さらに|また|。)、?この効果発揮後、?[^。]*$/.test(
      normalize(text.slice(0, limit.index))
    )
  );
  if (afterTriggeredExpected.length !== 1) return { limits: [], expected: [] };
  const [{ step, index }] = candidates;
  if (!steps.slice(0, index).some(({ action } = {}) => object(action)))
    return { limits: [], expected: [] };
  // after_triggers に送る先頭 step だけが後段節を所有するのは、後続の action 群も
  // その step の解決結果に従属すると構造から確認できる場合だけ。無関係な
  // after_triggers + usageLimit の後ろに無制限 action が続く形を受理しない。
  const carriedStepIds = new Set(typeof step.id === "string" ? [step.id] : []);
  const carriedSuffix = steps.slice(index + 1).every((suffix) => {
    if (!object(suffix) || !object(suffix.action)) return false;
    const stepId = suffix.stepCondition?.stepId;
    if (typeof stepId !== "string" || !carriedStepIds.has(stepId)) return false;
    if (typeof suffix.id === "string") carriedStepIds.add(suffix.id);
    return true;
  });
  if (!carriedSuffix) return { limits: [], expected: [] };
  return {
    limits: usageAt(step, `${path}.steps[${index}]`),
    expected: afterTriggeredExpected,
  };
}

/**
 * 「Aできる。そうしたとき、Bし、ターンに1回、Cする」型は、A の成功を
 * stepCondition で参照する C step だけに usageLimit を置く。親 Effect の
 * usageLimit では A/B まで不当に制限するため、条件節内の制限としては認めない。
 *
 * 「そうしたとき」は直後の B と、その成功に従う C を同じ条件節に含める。本文を
 * prompt.sourceText へ過剰に分割しなくても、条件元 stepId と末尾 action の対応が
 * 一意な場合だけ carrier を認識する。
 */
function conditionalResultClauseUsageLimits(steps, path, text, expected) {
  if (!Array.isArray(steps) || steps.length < 2)
    return { limits: [], expected: [] };
  const candidates = steps
    .map((step, index) => ({ step, index }))
    .filter(
      ({ step, index }) =>
        index > 0 &&
        object(step?.action) &&
        step.connector === "sequential" &&
        step.stepCondition?.kind === "ref_succeeded" &&
        typeof step.stepCondition.stepId === "string" &&
        steps
          .slice(0, index)
          .some((prior) => prior?.id === step.stepCondition.stepId)
    );
  if (candidates.length !== 1) return { limits: [], expected: [] };
  const conditionalIndex = text.lastIndexOf("そうしたとき");
  if (conditionalIndex < 0) return { limits: [], expected: [] };
  const trailingExpected = expected.filter(
    (limit) => limit.index > conditionalIndex
  );
  if (trailingExpected.length !== 1) return { limits: [], expected: [] };
  const [{ step, index }] = candidates;
  return {
    limits: usageAt(step, `${path}.steps[${index}]`),
    expected: trailingExpected,
  };
}

/**
 * 「コストを払うことで、Aし、ターンに1回、Bできる」型では、conditional_cost の
 * 代替 step である B だけが usageLimit を所有する。A と B は同じコスト成立を
 * 前提にする兄弟の結果であり、Effect 全体に制限を置くと本文にない A まで止める。
 *
 * `conditionalCostAlternativeStepIds` と `ref_executed` の対応が一意で、末尾の
 * step が回数文を所有し、本文でも読点直後に回数文が置かれる形だけを受理する。
 * 単に後段へ usageLimit があるだけの表現は、所属不明の review のままにする。
 */
function conditionalCostAlternativeUsageLimits(steps, path, text, expected) {
  if (!Array.isArray(steps) || steps.length < 2)
    return { limits: [], expected: [] };
  const candidates = steps
    .map((step, index) => ({ step, index }))
    .filter(
      ({ step, index }) =>
        index === steps.length - 1 &&
        object(step?.action) &&
        step.stepCondition?.kind === "ref_executed" &&
        typeof step.stepCondition.stepId === "string"
    );
  if (candidates.length !== 1) return { limits: [], expected: [] };
  const [{ step, index }] = candidates;
  if (typeof step.id !== "string" || step.id.length === 0)
    return { limits: [], expected: [] };
  const alternativeAnchor = steps.find(
    (prior) =>
      object(prior?.action) &&
      prior.connector === "conditional_cost" &&
      Array.isArray(prior.conditionalCostAlternativeStepIds) &&
      prior.conditionalCostAlternativeStepIds.includes(step.id) &&
      prior.stepCondition?.kind === "ref_executed" &&
      prior.stepCondition.stepId === step.stepCondition.stepId
  );
  if (!alternativeAnchor) return { limits: [], expected: [] };
  const alternativeExpected = expected.filter((limit) =>
    /(?:、|，)\s*$/.test(text.slice(0, limit.index))
  );
  if (alternativeExpected.length !== 1) return { limits: [], expected: [] };
  return {
    limits: usageAt(step, `${path}.steps[${index}]`),
    expected: alternativeExpected,
  };
}

/**
 * 「Aを1体以上破壊したとき、ターンに1回、Bできる」型では、B の step だけに
 * usageLimit を置く。親 Effect に置くと、本文に制限のない A 自体まで制限してしまう。
 *
 * `after_triggers` / `after_state_check` + `ref_count` は、直前の選択的な A が実際に
 * 指定数以上成功したときだけ B を続行する実行 carrier である。両 connector は state
 * based action を確定してから後段へ進むが、前者だけが途中の誘発解決も挟む。本文の
 * 回数文がその条件節の末尾にあり、stepId が前段を参照する一意の形だけを認める。
 * 単なる兄弟 step の usageLimit や、条件を持たない後段へは広げない。
 */
function refCountResultClauseUsageLimits(steps, path, text, expected) {
  if (!Array.isArray(steps) || steps.length < 2)
    return { limits: [], expected: [] };
  const candidates = steps
    .map((step, index) => ({ step, index }))
    .filter(
      ({ step, index }) =>
        index > 0 &&
        object(step?.action) &&
        ["after_triggers", "after_state_check"].includes(step.connector) &&
        step.stepCondition?.kind === "ref_count" &&
        typeof step.stepCondition.stepId === "string" &&
        finite(step.stepCondition.min) &&
        step.stepCondition.min >= 1 &&
        steps
          .slice(0, index)
          .some((prior) => prior?.id === step.stepCondition.stepId)
    );
  if (candidates.length !== 1) return { limits: [], expected: [] };
  const triggeredExpected = expected.filter((limit) =>
    /(?:[0-9０-９]+(?:体|枚|個)?以上)?[^。]*したとき、?$/.test(
      text.slice(0, limit.index).replace(/\s/g, "")
    )
  );
  if (triggeredExpected.length !== 1) return { limits: [], expected: [] };
  const [{ step, index }] = candidates;
  return {
    limits: usageAt(step, `${path}.steps[${index}]`),
    expected: triggeredExpected,
  };
}

/**
 * 「Nコストまで支払うことで、支払ったコストにより以下の効果を発揮する。…
 * Nコスト：〔ターンに1回：同名〕Bする」型では、Nコストを選んだ後段だけが
 * 回数制限を所有する。Effect 全体に置くと 1〜N-1 コストの段まで不当に制限する。
 *
 * choiceIndex=0 が不払い、1..N が各 pay_cost choice を表す段階支払い carrier と、
 * 同じ choice 成功を要求する usageLimit step、その成功に従属する後続 action を
 * 一組として検証する。本文上の閾値、支払い額、stepCondition の3点が一致する
 * 場合だけ認識し、任意の step usageLimit を後段節へ誤帰属させない。
 */
function paidCostThresholdClauseUsageLimits(steps, path, text, expected) {
  if (!Array.isArray(steps) || steps.length < 3 || expected.length !== 1)
    return { limits: [], expected: [] };
  const wanted = expected[0];
  const normalized = normalize(text);
  if (!normalized.includes("支払ったコストにより以下の効果を発揮する"))
    return { limits: [], expected: [] };
  const thresholdMatch = /([0-9]+)コスト:$/.exec(
    normalize(text.slice(0, wanted.index))
  );
  if (!thresholdMatch) return { limits: [], expected: [] };
  const threshold = Number(thresholdMatch[1]);
  const candidates = steps
    .map((step, index) => ({ step, index }))
    .filter(({ step, index }) => {
      if (
        index === 0 ||
        !object(step?.action) ||
        step.usageLimit === undefined ||
        typeof step.id !== "string" ||
        step.stepCondition?.kind !== "all" ||
        !Array.isArray(step.stepCondition.conditions)
      )
        return false;
      const choiceCondition = step.stepCondition.conditions.find(
        (condition) =>
          condition?.kind === "ref_choice" &&
          typeof condition.stepId === "string" &&
          Number.isInteger(condition.choiceIndex) &&
          condition.choiceIndex >= 1
      );
      const succeededCondition = step.stepCondition.conditions.find(
        (condition) =>
          condition?.kind === "ref_succeeded" &&
          condition.stepId === choiceCondition?.stepId
      );
      if (!choiceCondition || !succeededCondition) return false;
      const choiceStep = steps.find(
        (candidate) =>
          candidate?.id === choiceCondition.stepId &&
          Array.isArray(candidate.choice)
      );
      const selectedChoice =
        choiceStep?.choice?.[choiceCondition.choiceIndex - 1];
      if (
        selectedChoice?.action?.kind !== "pay_cost" ||
        selectedChoice.action.amount !== threshold
      )
        return false;
      return steps.slice(index + 1).some((suffix) => {
        if (!object(suffix?.action)) return false;
        if (
          suffix.stepCondition?.kind === "ref_succeeded" &&
          suffix.stepCondition.stepId === step.id
        )
          return true;
        return (
          suffix.stepCondition?.kind === "all" &&
          suffix.stepCondition.conditions?.some(
            (condition) =>
              condition?.kind === "ref_succeeded" &&
              condition.stepId === step.id
          )
        );
      });
    });
  if (candidates.length !== 1) return { limits: [], expected: [] };
  const [{ step, index }] = candidates;
  return {
    limits: usageAt(step, `${path}.steps[${index}]`),
    expected: [wanted],
  };
}

/**
 * Root usageLimit が effect 全体を制限すると確定できるのは、回数文が本文の実処理
 * より前に置かれているときだけ。Lv/メイン/フラッシュ、発揮見出しは宣言ヘッダなので
 * 許可するが、選択肢や「その後」などの本文を通過した後の制限は別 step に属し得る。
 */
function hasOnlyEffectHeadersBeforeLimit(text, limit) {
  let prefix = normalize(text.slice(0, limit.index));
  while (prefix.length > 0) {
    // 〔ターンに1回、このネクサスのコア2個を…〕のように、回数制限が
    // 宣言コストと同じ角括弧に入る場合がある。制限より前が開き括弧だけなら
    // 本文の実処理を通過したことにはならない。一方、括弧内に実処理が先行する
    // 場合は次の反復で header に一致せず、従来どおり別 scope として扱う。
    if (prefix.startsWith("〔")) {
      prefix = prefix.slice(1);
      continue;
    }
    const header =
      /^(?:Lv[0-9]+(?:-Lv[0-9]+)*[：:]?|メイン|フラッシュ|スタック|【[^】]*】|『[^』]*』)/.exec(
        prefix
      );
    if (!header) return false;
    prefix = prefix.slice(header[0].length);
  }
  return true;
}

/**
 * 「Aできる。または、〔ゲームに1回:同名〕Bできる」型では、後者の選択肢だけが
 * 回数制限を所有する。Effect 全体へ置くと、本文に制限のない A まで不当に制限する。
 *
 * `choice` は先頭 action と配列内の action の排他的な二択を表す。本文の制限直前に
 * 接続詞があり、単一 step / 単一 choice / 単一制約という構造まで一致する場合だけ、
 * choice 側の carrier を親本文の制約として認識する。単に子へ usageLimit があるだけの
 * 複雑な選択・複数分岐には適用しない。
 */
function alternativeChoiceUsageLimits(steps, path, text, expected) {
  if (
    !Array.isArray(steps) ||
    steps.length < 1 ||
    expected.length !== 1 ||
    !object(steps[0]?.action) ||
    !Array.isArray(steps[0]?.choice) ||
    steps[0].choice.length !== 1 ||
    !object(steps[0].choice[0]?.action)
  )
    return { limits: [], expected: [] };
  const wanted = expected[0];
  const prefix = normalize(text.slice(0, wanted.index));
  const suffix = normalize(text.slice(wanted.index + wanted.text.length));
  if (!/(?:または|もしくは|あるいは)、?$/.test(prefix) || suffix.length === 0)
    return { limits: [], expected: [] };
  // choice 自身の結果に従う後段 step がある場合も、回数制限は同じ choice 枝に
  // 所属する。親Effectへ置くと既定 action まで止まるため、後段が当該 choiceIndex を
  // 明示参照する一般形だけを受理する。
  const [first] = steps;
  const branchChoiceIndex = 1;
  const continuation = steps.slice(1);
  if (
    continuation.length > 0 &&
    (typeof first.id !== "string" ||
      !continuation.every(
        (step) =>
          object(step?.action) &&
          step.stepCondition?.kind === "ref_choice" &&
          step.stepCondition.stepId === first.id &&
          step.stepCondition.choiceIndex === branchChoiceIndex
      ))
  )
    return { limits: [], expected: [] };
  return {
    limits: usageAt(steps[0].choice[0], `${path}.steps[0].choice[0]`),
    expected: [wanted],
  };
}

/**
 * 「その後、Xしなかったとき、〔回数〕Bできる」型では、B の後段 step だけが
 * 制限を所有する。X の失敗/非選択を表す StepCondition が先行 step を正しく参照
 * している場合だけ認識し、単なる末尾 usageLimit を成功条件の代用にしない。
 */
function fallbackResultClauseUsageLimits(steps, path, text, expected) {
  if (!Array.isArray(steps) || steps.length < 2)
    return { limits: [], expected: [] };
  const candidates = steps
    .map((step, index) => ({ step, index }))
    .filter(
      ({ step, index }) =>
        index > 0 && object(step?.action) && step.usageLimit !== undefined
    );
  if (candidates.length !== 1) return { limits: [], expected: [] };
  const [{ step, index }] = candidates;
  if (
    index !== steps.length - 1 ||
    (step.connector !== undefined && step.connector !== "sequential")
  )
    return { limits: [], expected: [] };
  const wanted = expected.find((limit) => {
    const prefix = normalize(text.slice(0, limit.index));
    return /(?:。|．)その後、(?:手札に加えなかった|ドローしなかった)とき、[^。]*$/.test(
      prefix
    );
  });
  if (!wanted) return { limits: [], expected: [] };
  const prefix = normalize(text.slice(0, wanted.index));
  const preceding = steps.slice(0, index);
  const sourceStep = (stepId) =>
    preceding.find((candidate) => candidate?.id === stepId);
  const handAddedFallback =
    /(?:。|．)その後、手札に加えなかったとき、[^。]*$/.test(prefix) &&
    step.stepCondition?.kind === "ref_count" &&
    step.stepCondition.result === "hand_added" &&
    step.stepCondition.min === 0 &&
    step.stepCondition.max === 0 &&
    sourceStep(step.stepCondition.stepId)?.action?.kind === "deck_reveal";
  const choiceFallback =
    /(?:。|．)その後、ドローしなかったとき、[^。]*$/.test(prefix) &&
    step.stepCondition?.kind === "all" &&
    step.stepCondition.not === true &&
    Array.isArray(step.stepCondition.conditions) &&
    (() => {
      const choice = step.stepCondition.conditions.find(
        (condition) =>
          condition?.kind === "ref_choice" && condition.choiceIndex === 0
      );
      const succeeded = step.stepCondition.conditions.find(
        (condition) => condition?.kind === "ref_succeeded"
      );
      return (
        typeof choice?.stepId === "string" &&
        succeeded?.stepId === choice.stepId &&
        sourceStep(choice.stepId)?.action?.kind === "draw"
      );
    })();
  if (!handAddedFallback && !choiceFallback)
    return { limits: [], expected: [] };
  return {
    limits: usageAt(step, `${path}.steps[${index}]`),
    expected: [wanted],
  };
}

/**
 * 「この効果を X 1につき1回発揮」「X 1につき、この効果を追加で発揮」および
 * 「この効果を X の数まで追加で発揮」型を、発揮可否の
 * `condition` / `usageLimit` だけへ縮約していないかを検査する。これは通常の
 * ターン回数制限とは別の、解決中に同じ一連を何巡するかという制約である。
 *
 * 現時点で静的に完全照合できるのは count 1 につき 1 回の一般形だけ。その他の
 * 係数・除算を伴う形は、carrier の有無を review に残して原文確認へ送る。
 */
function hasCountAtLeastOneGate(value) {
  for (const entry of list(value)) {
    if (!object(entry)) continue;
    if (
      entry.kind === "count_value" &&
      entry.player === "self" &&
      finite(entry.min) &&
      entry.min >= 1
    )
      return true;
    if (hasCountAtLeastOneGate(entry.conditions ?? entry.all ?? []))
      return true;
  }
  return false;
}

function matchesQuantifiedRepeat(step, expected) {
  const repeat = step?.repeat;
  if (!object(repeat) || !object(repeat.additional)) return false;
  const additional = repeat.additional;
  const measureKind = quantifiedRepeatMeasureKind(expected.measure);
  if (expected.optional === true) {
    // 「数まで追加」の未印字の倍率・下限・実行時上書き・条件を信用すると、
    // 登録上限または実際の追加回数が N から変わる。明示された恒等値だけを
    // 許し、将来の未知の modifier も fail-closed にする。
    const repeatKeys = new Set([
      "additional",
      "optional",
      "executionAdditional",
      "condition",
      "allowDuplicateTargets",
    ]);
    const countKeys = new Set([
      "source",
      "preOffset",
      "multiplier",
      "divisor",
      "groupMultiplier",
      "offset",
      "cap",
      "minValue",
      "subtract",
    ]);
    const sourceKeys = new Set(
      measureKind === "count_value" ? ["kind", "player"] : ["kind"]
    );
    const neutral = (value, identity) =>
      value === undefined || value === identity;
    if (
      repeat.optional !== true ||
      Object.keys(repeat).some((key) => !repeatKeys.has(key)) ||
      repeat.executionAdditional !== undefined ||
      (repeat.condition !== undefined &&
        (!Array.isArray(repeat.condition) || repeat.condition.length !== 0)) ||
      !neutral(repeat.allowDuplicateTargets, true) ||
      Object.keys(additional).some((key) => !countKeys.has(key)) ||
      !object(additional.source) ||
      Object.keys(additional.source).some((key) => !sourceKeys.has(key)) ||
      !neutral(additional.preOffset, 0) ||
      !neutral(additional.multiplier, 1) ||
      !neutral(additional.divisor, 1) ||
      !neutral(additional.groupMultiplier, 1) ||
      !neutral(additional.offset, 0) ||
      !neutral(additional.minValue, 0) ||
      additional.cap !== undefined ||
      additional.subtract !== undefined
    )
      return false;
  }
  // `repeat.additional` は基本1回に加える回数。追加なしの「1につき1回」は
  // count N を N 回にするため offset:-1、追加構文は N 回をそのまま加える。
  const expectedOffset = expected.additional ? 0 : -1;
  if (measureKind === "count_value") {
    return (
      additional.source?.kind === "count_value" &&
      additional.source?.player === "self" &&
      (additional.offset ?? 0) === expectedOffset
    );
  }
  if (measureKind === "braves_on_source") {
    return (
      additional.source?.kind === "braves_on_source" &&
      (additional.offset ?? 0) === expectedOffset
    );
  }
  if (measureKind === "decreased_count") {
    // 「減らしたカウント」はこの反復の対象選択と一対一で対応する。任意の
    // selected_targets や offset を許すと、回数も支払いも異なる carrier を
    // 正例として通してしまうため、BSGE01-C08 型の基本巡を除く -1 と自身の
    // step id を両方固定する。
    return (
      additional.source?.kind === "count_value" &&
      additional.source?.player === "self" &&
      (additional.offset ?? 0) === -1 &&
      object(repeat.executionAdditional) &&
      repeat.executionAdditional.source?.kind === "selected_targets" &&
      repeat.executionAdditional.source?.stepId === step.id &&
      (repeat.executionAdditional.offset ?? 0) === -1
    );
  }
  return false;
}

/**
 * 「カウント-1することで、対象1体をBP-Nする。追加でカウントを減らすことで、
 * 減らしたカウント1につき、この効果を追加で1回発揮する。その後、BP0になった
 * 対象を破壊する」型は、支払い・反復対象・後続のBP0破壊を別 step に置く。
 *
 * カード番号ではなく、(1) 反復対象と同じ step を選択数だけ前払いする count_decrease、
 * (2) conditional_cost の任意 BP 修正反復、(3) その step の正確な
 * executionAdditional、(4) 同じ結果だけを一度破壊する finalizer の全てが揃う形だけを
 * 正例にする。任意の複数 step を許すと、反復外の手順や任意性を落とした DSL まで通して
 * しまうため、この既知の完結した carrier に限定する。
 */
function hasCompleteDecreasedCountRepeatCarrier(actionSteps, repeatStep) {
  if (!repeatStep || actionSteps.length !== 3 || actionSteps[1] !== repeatStep)
    return false;
  const [costStep, repeatedStep, finalizerStep] = actionSteps.map(
    ({ node }) => node
  );
  const stepId = repeatedStep.id;
  const repeat = repeatedStep.repeat;
  const costAmount = costStep.action?.amount;
  const finalizerTarget = finalizerStep.action?.target;
  return (
    typeof stepId === "string" &&
    costStep.action?.kind === "count_decrease" &&
    costStep.action?.player === "self" &&
    object(costAmount) &&
    costAmount.source?.kind === "selected_targets" &&
    costAmount.source?.stepId === stepId &&
    (costAmount.offset ?? 0) === 0 &&
    repeatedStep.connector === "conditional_cost" &&
    repeatedStep.action?.kind === "bp_modify" &&
    object(repeat) &&
    repeat.optional === true &&
    finalizerStep.connector === "sequential" &&
    finalizerStep.action?.kind === "destroy" &&
    finalizerTarget?.kind === "ref" &&
    finalizerTarget.stepId === stepId &&
    finalizerTarget.result === "bp_became_zero"
  );
}

function expectedQuantifiedCarrier(quantifier) {
  switch (quantifiedRepeatMeasureKind(quantifier.measure)) {
    case "count_value":
      return `repeat.additional=count_value(offset:${quantifier.additional ? 0 : -1})${quantifier.additional ? "" : " + count>=1 gate"}${quantifier.optional ? " + repeat.optional:true" : ""}`;
    case "braves_on_source":
      return `repeat.additional=braves_on_source(offset:${quantifier.additional ? 0 : -1})`;
    case "decreased_count":
      return "repeat.additional=count_value(offset:-1) + repeat.executionAdditional=selected_targets(stepId:self, offset:-1)";
    default:
      return "量化対象に対応する repeat/continuation carrier";
  }
}

function checkQuantifiedEffectRepeats(unit, emit) {
  const expected = extractQuantifiedEffectRepeats(unit.text);
  if (expected.length === 0) return;
  const actionSteps = unit.nodes.filter(({ node }) => object(node.action));
  const unambiguous =
    unit.hasOwnText === true &&
    unit.hasNestedEffects !== true &&
    unit.hasMappedSteps !== true &&
    actionSteps.length === 1;
  const hasCountGate = hasCountAtLeastOneGate(unit.node.condition);
  for (const quantifier of expected) {
    const exactShape = quantifier.perMeasure === 1 && quantifier.count === 1;
    // 係数・除算を含む形は source / offset だけでは一般に式を検証できない。
    // 任意の repeat を見つけて正解扱いにせず、必ず原文レビューを残す。
    if (!exactShape) {
      emit(
        "quantified_effect_repeat_review",
        `${unit.path}.steps`,
        "係数・除算を含む量化反復は静的に式の対応を確定できない",
        `本文=${quantifier.text}; 実値=${display(
          actionSteps.map(({ node, path }) => ({
            path,
            repeat: node.repeat ?? null,
          }))
        )}`,
        "review"
      );
      continue;
    }
    const measureKind = quantifiedRepeatMeasureKind(quantifier.measure);
    if (measureKind === "unknown") {
      emit(
        "quantified_effect_repeat_review",
        `${unit.path}.steps`,
        "量化対象の DSL carrier を静的に一意に対応付けられない",
        `本文=${quantifier.text}; 実値=${display(
          actionSteps.map(({ node, path }) => ({
            path,
            repeat: node.repeat ?? null,
          }))
        )}`,
        "review"
      );
      continue;
    }
    const repeatStep = actionSteps.find(({ node }) =>
      matchesQuantifiedRepeat(node, quantifier)
    );
    const exactMultiStepCarrier =
      measureKind === "decreased_count" &&
      hasCompleteDecreasedCountRepeatCarrier(actionSteps, repeatStep);
    if (
      (actionSteps.length === 1 || exactMultiStepCarrier) &&
      repeatStep &&
      (quantifier.additional || (measureKind === "count_value" && hasCountGate))
    )
      continue;
    const actual = actionSteps.map(({ node, path }) => ({
      path,
      repeat: node.repeat ?? null,
      conditionOnly: node.condition ?? unit.node.condition ?? null,
      usageLimit: node.usageLimit ?? unit.node.usageLimit ?? null,
    }));
    emit(
      "quantified_effect_repeat_missing",
      `${unit.path}.steps`,
      "量化された追加/反復解決を条件/使用回数制限へ縮約している可能性がある",
      `本文=${quantifier.text}; 期待=${expectedQuantifiedCarrier(quantifier)}; 実値=${display(actual)}`,
      unambiguous ? "violation" : "review"
    );
  }
}

function checkUsage(unit, emit) {
  if (unit.node.timing?.kind === "continuous") return;
  const expectedOccurrenceGates = parseOccurrenceGates(unit.text);
  if (expectedOccurrenceGates.length > 0) {
    const actual = unit.node.occurrenceGate;
    const matchesExactly =
      expectedOccurrenceGates.length === 1 &&
      object(actual) &&
      actual.duration === expectedOccurrenceGates[0].duration &&
      actual.targetCount === expectedOccurrenceGates[0].targetCount;
    if (!matchesExactly)
      emit(
        "occurrence_gate_mismatch",
        `${unit.path}.occurrenceGate`,
        "本文の『N回目』発生順条件を occurrenceGate が満たしていない",
        `本文=${expectedOccurrenceGates.map((gate) => gate.text).join(" + ")}; 期待=${display(expectedOccurrenceGates.map(({ duration, targetCount }) => ({ duration, targetCount })))}; 実値=${display(actual ?? null)}`,
        "review"
      );
  }
  const expected = hasPairedFreeSelfSummonVariant(unit)
    ? []
    : parseLimits(unit.text).filter(
        (limit) => !excludesExplicitlyBypassedUsageLimit(unit.text, limit)
      );
  const parsedConditionalOverrides = parseConditionalUsageOverrides(
    unit.text,
    expected
  );
  const countValueOverrides = parseCountValueUsageOverrides(
    unit.text,
    expected
  );
  const conditionalOverrides = [
    ...parsedConditionalOverrides,
    ...countValueOverrides,
  ];
  const conditionalOverrideIndexes = new Set(
    parsedConditionalOverrides.map((limit) => limit.index)
  );
  const baseExpected = expected.filter(
    (limit) => !conditionalOverrideIndexes.has(limit.index)
  );
  // 「ゲート中」は一般語彙にしない。誤記の裁定はカード個別なので原文確認へ送る。
  if (/ゲート中に?[0-9]+回/.test(unit.text)) {
    emit(
      "usage_unrecognized_period",
      unit.path,
      "回数制限の期間語を確定できない",
      `本文=${unit.text}; 期待=確定裁定に基づく期間; 実値=${display(usageAt(unit.node, unit.path))}`,
      "review"
    );
  }
  // 後段を prompt.sourceText で切り出した場合、親unitの本文からは後段の回数文が
  // 除かれる。親自身に残った usageLimit の根拠が本文に無いなら、それを子の継承制約と
  // みなして黙って除外してはならない。外側 carrier 由来の可能性があるため violation
  // にはせず review として残す。
  const own = usageAt(unit.node, unit.path);
  // 外側の神技 carrier は、この Effect の本文と初めて照合する制約である。
  // 親本文で既に照合した制約の継承とは分け、未印字の追加制限を見逃さない。
  const uncheckedInherited = unit.inheritedLimitsChecked
    ? []
    : unit.inheritedLimits;
  if (expected.length === 0) {
    const constrainedOwn = own.filter((limit) => LIMIT_KINDS.has(limit.kind));
    const unmatched = [
      ...(unit.hasMappedSteps &&
      !mappedUsageScopeCoversOwnUsage(constrainedOwn, unit.mappedSteps)
        ? constrainedOwn
        : []),
      ...uncheckedInherited.filter((limit) => LIMIT_KINDS.has(limit.kind)),
    ];
    if (unmatched.length > 0)
      emit(
        "usage_extra_constraint_review",
        `${unit.path}.usageLimit`,
        "参照本文に対応の見つからない追加回数制限がある",
        `本文=${unit.text}; 期待=[]; 追加実値=${display(unmatched)}`,
        "review"
      );
    return;
  }
  const childOwners = unit.nodes.filter(
    ({ node }) => node !== unit.node && node.usageLimit !== undefined
  );
  const children = childOwners.flatMap(({ node, path }) => usageAt(node, path));
  const directSteps = unit.node.steps ?? [];
  // 本文先頭の制限を effect 自身が正しく所有し、内側の独立 Effect / prompt
  // 分離 / 子の使用制限が無いなら、choice は一回の発揮の選択肢である。その場合に
  // choice の存在だけを理由に親の usageLimit を未確認扱いにしない。
  // 子に usageLimit がある、本文を別 step に分けた、または内側 Effect がある場合は
  // 引き続き scope が曖昧なので review のまま残す。
  const rootChoiceScopeIsUnambiguous =
    unit.hasOwnText === true &&
    unit.hasChoiceBranching === true &&
    unit.hasNestedEffects !== true &&
    unit.hasMappedSteps !== true &&
    children.length === 0 &&
    expected.every(
      (limit) =>
        hasOnlyEffectHeadersBeforeLimit(unit.text, limit) &&
        // DivineSkillEntry.turnLimit は子 Effect に重複させない正規の宣言
        // carrier である。選択肢は同じ神技を一度発揮した後の分岐なので、外側
        // carrier が満たす本文先頭の制限を未確認扱いにしてはならない。
        satisfies(
          [...unit.inheritedLimits, ...own],
          limit,
          conditionalOverrides
        )
    );
  const soleStep =
    directSteps.length === 1 &&
    !unit.nodes.some(
      ({ node }) => node.choice || node.choices || node.branches
    );
  const trailingClause = trailingClauseUsageLimits(
    directSteps,
    unit.path,
    unit.text,
    expected
  );
  const trailingClauseLimits = trailingClause.limits;
  const additionalClause = additionalClauseUsageLimits(
    directSteps,
    unit.path,
    unit.text,
    expected
  );
  const additionalClauseLimits = additionalClause.limits;
  const commaSelfRecoverClause = commaSelfRecoverClauseUsageLimits(
    directSteps,
    unit.path,
    unit.text,
    expected
  );
  const commaSelfRecoverClauseLimits = commaSelfRecoverClause.limits;
  const afterTriggeredClause = afterTriggeredClauseUsageLimits(
    directSteps,
    unit.path,
    unit.text,
    expected
  );
  const afterTriggeredClauseLimits = afterTriggeredClause.limits;
  const alternativeChoiceClause = alternativeChoiceUsageLimits(
    directSteps,
    unit.path,
    unit.text,
    expected
  );
  const alternativeChoiceClauseLimits = alternativeChoiceClause.limits;
  const fallbackResultClause = fallbackResultClauseUsageLimits(
    directSteps,
    unit.path,
    unit.text,
    expected
  );
  const fallbackResultClauseLimits = fallbackResultClause.limits;
  const conditionalResultClause = conditionalResultClauseUsageLimits(
    directSteps,
    unit.path,
    unit.text,
    expected
  );
  const conditionalResultClauseLimits = conditionalResultClause.limits;
  const conditionalCostAlternativeClause =
    conditionalCostAlternativeUsageLimits(
      directSteps,
      unit.path,
      unit.text,
      expected
    );
  const conditionalCostAlternativeClauseLimits =
    conditionalCostAlternativeClause.limits;
  const refCountResultClause = refCountResultClauseUsageLimits(
    directSteps,
    unit.path,
    unit.text,
    expected
  );
  const refCountResultClauseLimits = refCountResultClause.limits;
  const paidCostThresholdClause = paidCostThresholdClauseUsageLimits(
    directSteps,
    unit.path,
    unit.text,
    expected
  );
  const paidCostThresholdClauseLimits = paidCostThresholdClause.limits;
  const inlineUsageClause = expected.some((limit) =>
    /(?:さらに|また)、?\s*$/.test(unit.text.slice(0, limit.index))
  );
  const siblingBattleEndRecoverLimits =
    siblingBattleEndRecoverUsageLimits(unit);
  const siblingConditionalSelfRecoverLimits =
    siblingConditionalSelfRecoverUsageLimits(unit);
  const baseActual = [
    ...unit.inheritedLimits,
    ...own,
    ...(soleStep ? usageAt(directSteps[0], `${unit.path}.steps[0]`) : []),
    ...usageGateLimits(directSteps, unit.path, {
      allowRefExecuted: inlineUsageClause,
    }),
    ...siblingBattleEndRecoverLimits,
    ...siblingConditionalSelfRecoverLimits,
  ];
  const actualForExpected = (expectedLimit) => [
    ...(conditionalResultClause.expected.includes(expectedLimit)
      ? conditionalResultClauseLimits
      : conditionalCostAlternativeClause.expected.includes(expectedLimit)
        ? conditionalCostAlternativeClauseLimits
        : refCountResultClause.expected.includes(expectedLimit)
          ? refCountResultClauseLimits
          : paidCostThresholdClause.expected.includes(expectedLimit)
            ? paidCostThresholdClauseLimits
            : fallbackResultClause.expected.includes(expectedLimit)
              ? fallbackResultClauseLimits
              : [
                  ...baseActual,
                  ...(trailingClause.expected.includes(expectedLimit)
                    ? trailingClauseLimits
                    : []),
                  ...(additionalClause.expected.includes(expectedLimit)
                    ? additionalClauseLimits
                    : []),
                  ...(commaSelfRecoverClause.expected.includes(expectedLimit)
                    ? commaSelfRecoverClauseLimits
                    : []),
                  ...(afterTriggeredClause.expected.includes(expectedLimit)
                    ? afterTriggeredClauseLimits
                    : []),
                  ...(alternativeChoiceClause.expected.includes(expectedLimit)
                    ? alternativeChoiceClauseLimits
                    : []),
                ]),
  ];
  const actual = [
    ...baseActual,
    ...trailingClauseLimits,
    ...additionalClauseLimits,
    ...commaSelfRecoverClauseLimits,
    ...afterTriggeredClauseLimits,
    ...alternativeChoiceClauseLimits,
    ...fallbackResultClauseLimits,
    ...conditionalResultClauseLimits,
    ...conditionalCostAlternativeClauseLimits,
    ...refCountResultClauseLimits,
    ...paidCostThresholdClauseLimits,
  ];
  const unexplainedChildren = children.filter(
    (limit) => !actual.some((known) => known.path === limit.path)
  );
  const conflictingText = baseExpected.some((limit, index) =>
    baseExpected.some(
      (other, otherIndex) =>
        index !== otherIndex &&
        sameAxis(limit, other) &&
        limit.maxCount !== other.maxCount
    )
  );
  const dynamicFullyExplained = actual
    .filter((limit) => limit.dynamic)
    .every((limit) => {
      if (limit.hasAdditionalDynamic) return false;
      const expectedForAxis = conditionalOverrides.filter((override) =>
        sameAxis(override, limit)
      );
      const actualOverrides = list(limit.maxCountOverrides);
      return (
        expectedForAxis.length > 0 &&
        actualOverrides.length > 0 &&
        actualOverrides.every((override) =>
          expectedForAxis.some(
            (expectedOverride) =>
              finite(override?.maxCount) &&
              override.maxCount === expectedOverride.maxCount &&
              matchesConditionalUsageOverride(
                { maxCountOverrides: [override] },
                expectedOverride
              )
          )
        ) &&
        expectedForAxis.every((override) =>
          matchesConditionalUsageOverride(limit, override)
        )
      );
    });
  // 支払い段階は choice を持つため通常は scope を確定できない。しかし本文の閾値・
  // pay_cost・同一選択成功条件・従属後続を揃えた carrier は、その選択枝だけの
  // usageLimit 所属を一意に示す。
  const paidCostThresholdScopeIsUnambiguous =
    paidCostThresholdClause.expected.length > 0;
  const uncertain =
    (unit.uncertain &&
      !rootChoiceScopeIsUnambiguous &&
      alternativeChoiceClause.expected.length === 0 &&
      fallbackResultClause.expected.length === 0 &&
      !paidCostThresholdScopeIsUnambiguous) ||
    conflictingText ||
    (actual.some((limit) => limit.dynamic) && !dynamicFullyExplained) ||
    // 「コア1個ずつ」のような処理量の配分を、回数制限の「ターンに1回ずつ」と
    // 同一視しない。後者だけが usageLimit の scope を曖昧にする。
    (/(?:ターン|ゲーム|ステップ|バトル)(?:中)?に?[0-9０-９]+回ずつ|増や|回数.*\+/.test(
      unit.text
    ) &&
      countValueOverrides.length === 0);
  const fragment =
    expected
      .reduce((text, limit) => text.replace(limit.text, ""), unit.text)
      .replace(/[\p{P}\p{S}]/gu, "").length === 0;
  const noOwnedActions = !unit.nodes.some(({ node }) => object(node.action));
  const inheritedScopeBroader =
    unit.inheritedScopeBroader &&
    baseExpected.some(
      (limit) =>
        satisfies(unit.inheritedLimits, limit, conditionalOverrides) &&
        !satisfies(own, limit, conditionalOverrides)
    );
  // 成功数条件の後段だけに本文の制限が属すると確定した場合、その同じ制限を親
  // Effect にも置くと、前段 action まで不当に制限される。後段 step は actual として
  // 照合済みでも、親 carrier が同じ軸を満たすなら scope が広すぎるため review に残す。
  const refCountScopeBroader = refCountResultClause.expected.some((limit) =>
    baseActual.some((candidate) =>
      satisfies([candidate], limit, conditionalOverrides)
    )
  );
  // conditional_cost の A/B は同じコストの成立に従う別結果である。本文が B だけを
  // 回数制限すると明示したとき、親 Effect の同一制限は A まで不当に止める。
  const conditionalCostAlternativeScopeBroader =
    conditionalCostAlternativeClause.expected.some((limit) =>
      baseActual.some((candidate) =>
        satisfies([candidate], limit, conditionalOverrides)
      )
    );
  // 「Aする。または、〔ゲームに1回:同名〕Bする」の制限を B の choice と親 Effect
  // の両方へ置くと、親carrierがchoice変種で共有されるため、本文に制限のない A まで
  // 同名ゲーム1回へ縮む。alternativeChoiceUsageLimits は枝に属するcarrierを照合する
  // だけで、親への重複を許容するものではない。
  const alternativeChoiceScopeBroader = alternativeChoiceClause.expected.some(
    (limit) =>
      baseActual.some((candidate) =>
        satisfies([candidate], limit, conditionalOverrides)
      )
  );
  const fallbackResultScopeBroader = fallbackResultClause.expected.some(
    (limit) =>
      baseActual.some((candidate) =>
        satisfies([candidate], limit, conditionalOverrides)
      )
  );
  // 「この効果発揮後」の制限を after_triggers step と親 Effect の両方へ置くと、
  // 前段 A まで本文にない回数制限を受ける。後段の carrier を認識しても、親の
  // 同一制限を代替表現として受理してはいけない。
  const afterTriggeredScopeBroader = afterTriggeredClause.expected.some(
    (limit) =>
      baseActual.some((candidate) =>
        satisfies([candidate], limit, conditionalOverrides)
      )
  );
  // 「Aする。さらに、ターンに1回、Bできる」の制限を末尾 step と親 Effect の
  // 両方へ置くと、本文に制限のない A まで回数制限を受ける。additional の末尾
  // carrier を認識しても、親の同一制限は代替表現ではないため review に残す。
  const additionalClauseScopeBroader = additionalClause.expected.some((limit) =>
    baseActual.some((candidate) =>
      satisfies([candidate], limit, conditionalOverrides)
    )
  );
  // 「Aし、ターンに1回、このスピリットは回復する」の制限を末尾の自己回復と
  // 親 Effect の両方に置くと、本文に制限のない A まで回数制限を受ける。
  const commaSelfRecoverClauseScopeBroader =
    commaSelfRecoverClause.expected.some((limit) =>
      baseActual.some((candidate) =>
        satisfies([candidate], limit, conditionalOverrides)
      )
    );
  // 支払い閾値の後段だけが回数制限を持つと確定した場合、親Effectへ同じ制限を
  // 置くと、それより低い支払い段まで回数制限に巻き込んでしまう。
  const paidCostThresholdScopeBroader = paidCostThresholdClause.expected.some(
    (limit) =>
      baseActual.some((candidate) =>
        satisfies([candidate], limit, conditionalOverrides)
      )
  );
  const missing = [
    ...baseExpected.filter(
      (limit) =>
        !satisfies(actualForExpected(limit), limit, conditionalOverrides)
    ),
    ...conditionalOverrides.filter(
      (override) =>
        !actual.some(
          (limit) =>
            sameAxis(limit, override) &&
            matchesConditionalUsageOverride(limit, override)
        )
    ),
  ];
  if (missing.length > 0) {
    const scoped =
      unexplainedChildren.length === 0 &&
      (!unit.node.steps ||
        soleStep ||
        expected[0].index === 0 ||
        alternativeChoiceClause.expected.length > 0 ||
        fallbackResultClause.expected.length > 0 ||
        trailingClauseLimits.length > 0 ||
        commaSelfRecoverClauseLimits.length > 0 ||
        afterTriggeredClauseLimits.length > 0 ||
        conditionalResultClause.expected.length > 0 ||
        conditionalCostAlternativeClause.expected.length > 0 ||
        refCountResultClause.expected.length > 0 ||
        paidCostThresholdClause.expected.length > 0);
    // 欠落だけでは外側carrier・別Effectの制限を否定できない。
    // 同じownerに明記された異なる共有軸/期間/回数だけを高信頼の矛盾とする。
    const explicitContradiction = actual.some(
      (limit) =>
        !expected.some((wanted) => sameAxis(limit, wanted)) ||
        missing.some(
          (wanted) =>
            sameAxis(limit, wanted) &&
            ((finite(limit.maxCount) && limit.maxCount !== wanted.maxCount) ||
              (wanted.kind === "per_group" && !limit.group))
        ) ||
        (conditionalResultClause.expected.some((wanted) =>
          baseActual.some((limit) =>
            satisfies([limit], wanted, conditionalOverrides)
          )
        ) &&
          conditionalResultClause.expected.some(
            (wanted) =>
              !satisfies(
                conditionalResultClauseLimits,
                wanted,
                conditionalOverrides
              )
          )) ||
        (refCountResultClause.expected.some((wanted) =>
          baseActual.some((limit) =>
            satisfies([limit], wanted, conditionalOverrides)
          )
        ) &&
          refCountResultClause.expected.some(
            (wanted) =>
              !satisfies(
                refCountResultClauseLimits,
                wanted,
                conditionalOverrides
              )
          ))
    );
    emit(
      "usage_constraint_mismatch",
      `${unit.path}.usageLimit`,
      "本文の共有範囲・期間・回数制限を同じ所属で満たしていない",
      `本文=${expected.map((limit) => limit.text).join(" + ")}; 期待AND=${display(expected.map(({ kind, duration, maxCount, group }) => ({ kind, duration, maxCount, group })))}; 実値=${display(actual)}; 別手順=${display(unexplainedChildren)}`,
      uncertain ||
        !scoped ||
        fragment ||
        noOwnedActions ||
        !explicitContradiction
        ? "review"
        : "violation"
    );
  } else if (
    unexplainedChildren.length > 0 ||
    uncertain ||
    fragment ||
    noOwnedActions ||
    inheritedScopeBroader ||
    refCountScopeBroader ||
    conditionalCostAlternativeScopeBroader ||
    alternativeChoiceScopeBroader ||
    fallbackResultScopeBroader ||
    afterTriggeredScopeBroader ||
    additionalClauseScopeBroader ||
    commaSelfRecoverClauseScopeBroader ||
    paidCostThresholdScopeBroader
  ) {
    emit(
      "usage_scope_review",
      `${unit.path}.usageLimit`,
      "本文と手順別・条件付き回数制限の対応を確認する",
      `本文=${unit.text}; 期待AND=${display(expected)}; 実値=${display(actual)}; 別手順=${display(unexplainedChildren)}; 親の制限が他の手順にも及ぶ=${Boolean(inheritedScopeBroader || refCountScopeBroader || conditionalCostAlternativeScopeBroader || alternativeChoiceScopeBroader || afterTriggeredScopeBroader || additionalClauseScopeBroader || commaSelfRecoverClauseScopeBroader || paidCostThresholdScopeBroader)}`,
      "review"
    );
  }
  // 同じdurationでも per_instance と per_card_name は代替ではない。余分な制約は原文確認へ。
  // prompt.sourceText で後段へ本文を帰属させた unit では、親Effectの使用制限も
  // inheritedLimits として可視化される。しかしこれは当該後段の独自制限ではなく、
  // 親本文を別 unit として照合済みの制約であるため「追加制限」には数えない。
  // 子自身の usageLimit は path が inheritedLimits と異なるので、引き続き本文との
  // 対応を厳密に検査する。
  const extras = actual.filter(
    (limit) =>
      LIMIT_KINDS.has(limit.kind) &&
      !unit.inheritedLimits.some(
        (inherited) =>
          inherited.path === limit.path &&
          !uncheckedInherited.some((unchecked) => unchecked.path === limit.path)
      ) &&
      !expected.some((wanted) => sameAxis(limit, wanted))
  );
  if (extras.length > 0)
    emit(
      "usage_extra_constraint_review",
      `${unit.path}.usageLimit`,
      "参照本文に対応の見つからない追加回数制限がある",
      `本文=${unit.text}; 期待=${display(expected)}; 追加実値=${display(extras)}`,
      "review"
    );
}

function checkPayments(unit, emit, costBounds = []) {
  const pairedFreeSelfSummon = hasPairedFreeSelfSummonVariant(unit);
  const isAdventCostOverrideText = /自分が【煌臨】するとき/.test(unit.text);
  const adventCostOverrideMinimumLevel = (() => {
    // `unit.text` is normalized before detection, so source-line boundaries
    // are intentionally unavailable here.  Bind the level header to the
    // same sentence as the advent-cost clause instead of accepting an
    // unrelated Lv header elsewhere on the card.
    const match = unit.text.match(
      /Lv([0-9]+)(?:-Lv[0-9]+)?[^。]*自分が【煌臨】するとき/
    );
    return match ? Number(match[1]) : null;
  })();
  const hasAdventCostOverrideScope = () =>
    isAdventCostOverrideText &&
    unit.node?.timing?.kind === "continuous" &&
    (adventCostOverrideMinimumLevel === null ||
      list(unit.node.condition).some(
        (condition) =>
          condition?.kind === "min_level" &&
          condition.value === adventCostOverrideMinimumLevel
      ) ||
      unit.node.applicability?.level?.min === adventCostOverrideMinimumLevel);
  const modes = [];
  if (
    /(?:召喚|配置|使用)?コスト(?:すべて|全て|全額)を?支払ったもの/.test(
      unit.text
    )
  )
    modes.push({ kind: "paid", expected: "useCostPayment.fullCostPaid:true" });
  for (const match of unit.text.matchAll(FREE_PAYMENT_RE)) {
    if (isFreePaymentProhibition(unit.text, match.index ?? 0)) continue;
    modes.push({
      kind: "free",
      expected: 'modifier/costModifier:"free"',
      costBounds: boundsBeforeOffsetInSentence(
        unit.text,
        costBounds,
        match.index ?? 0
      ),
      cardName: cardNameBeforeOffsetInSentence(unit.text, match.index ?? 0),
      alternativeCardName: alternativeCardNameBeforeOffsetInSentence(
        unit.text,
        match.index ?? 0
      ),
      category: categoryBeforeOffsetInClause(unit.text, match.index ?? 0),
      colors: colorsBeforeOffsetInSentence(unit.text, match.index ?? 0),
      offset: match.index ?? 0,
      sourceZoneScope: sourceZoneScopeBeforeOffsetInSentence(
        unit.text,
        match.index ?? 0
      ),
      ...freePaymentContext(unit.text, match.index ?? 0),
    });
  }
  const dynamicExtraPaymentRanges = [];
  for (const match of unit.text.matchAll(
    /(自分|相手)のカウント([0-9]+)につき、?([0-9]+)コスト(?:を)?余分に(?:支払|払)/g
  )) {
    const start = match.index ?? 0;
    dynamicExtraPaymentRanges.push([start, start + match[0].length]);
    modes.push({
      kind: "extra",
      amount: Number(match[3]),
      dynamicAmount: {
        source: {
          kind: "count_value",
          player: match[1] === "自分" ? "self" : "opponent",
        },
        divisor: Number(match[2]),
      },
      expected: `additionalPayment:true, additionalCostValue:count_value/${match[1]}/${Number(match[2])}*${Number(match[3])}`,
    });
  }
  for (const match of unit.text.matchAll(
    /([0-9]+)コスト(?:を)?余分に(?:支払|払)/g
  )) {
    const start = match.index ?? 0;
    if (
      dynamicExtraPaymentRanges.some(
        ([rangeStart, rangeEnd]) => start >= rangeStart && start < rangeEnd
      )
    )
      continue;
    modes.push({
      kind: "extra",
      amount: Number(match[1]),
      expected: `additionalPayment:true, additionalCostValue:${Number(match[1])}`,
    });
  }
  const override = [
    ...unit.text.matchAll(/コスト(?:を)?([0-9]+)(?:として|にして)/g),
  ];
  if (override.length === 1)
    modes.push({
      kind: "override",
      amount: Number(override[0][1]),
      expected: `override:${Number(override[0][1])}`,
    });
  if (modes.length === 0) return;
  // ドローステップの「手札を破棄することで +N ドロー」には、破棄したカードを
  // トラッシュではなくフィールドへ直接置く共通 carrier がある。この移動は通常の
  // 配置宣言/コスト支払いを経由しないため、`コストを支払わずに配置する` の free を
  // `cost_modify` に要求してはいけない。
  //
  // `move_instead -> field` に限定することで、通常の破棄や別 destination を無償配置と
  // 誤認しない。本文が「破棄したカードが『X』のとき」と名指しする場合は、条件 filter の
  // CardNameMatch も同じ表記規約（「X」= contains / カード名：「X」= exact）で照合する。
  const discardDispositionName = (() => {
    const match = normalize(unit.text).match(
      /破棄したカードが、?(カード名:)?「([^」]+)」のとき/
    );
    if (!match) return null;
    return {
      kind: match[1] ? "exact" : "contains",
      value: match[2],
    };
  })();
  const hasMatchingDiscardDispositionName = (disposition) => {
    if (!discardDispositionName) return true;
    return list(disposition.ifCardFilter?.cardName).some(
      (cardName) =>
        object(cardName) &&
        cardName[discardDispositionName.kind] === discardDispositionName.value
    );
  };
  const isDiscardToFieldWithoutCost = (node) =>
    node.kind === "draw_modify" &&
    node.prepaidCost?.kind === "discard_hand" &&
    node.prepaidCost?.discardDisposition?.kind === "move_instead" &&
    node.prepaidCost.discardDisposition.destination === "field" &&
    hasMatchingDiscardDispositionName(node.prepaidCost.discardDisposition);
  // 「手札にあるこのカードをコストを支払わずに使用することで、ライフは減らない」
  // は通常の magic 使用や cost_modify ではない。life_damage_interception の
  // useCostGate が、ライフ減少を置換するために手札カードそのものを使用する共通
  // primitive であり、ここでの使用には通常コストを支払う経路がない。
  // 親 effect の applicability / timingScope と action の player / cause、さらに参照先
  // effectIndex が flash activated であることまで要求する。これにより、似た文言の
  // ダメージ軽減や別プレイヤーの使用、使用後に何も発揮しない carrier を無償使用と
  // 誤認しない。
  const isLifeDamageInterceptionUseWithoutCost = (node) =>
    node.kind === "life_damage_interception" &&
    node.player === "self" &&
    node.cause === "opponent_effect" &&
    node.mode === "replace" &&
    object(node.useCostGate) &&
    list(node.useCostGate.zones).includes("hand") &&
    Number.isInteger(node.useCostGate.effectIndex) &&
    unit.node?.timing?.kind === "continuous" &&
    (Array.isArray(unit.node?.applicability?.zone)
      ? unit.node.applicability.zone
      : [unit.node?.applicability?.zone]
    ).includes("hand") &&
    unit.node?.timingScope?.period === "attack" &&
    unit.node?.timingScope?.player === "both" &&
    unit.containerEffects?.[node.useCostGate.effectIndex]?.timing?.kind ===
      "activated" &&
    unit.containerEffects?.[node.useCostGate.effectIndex]?.timing?.mode ===
      "flash" &&
    /コスト(?:を)?(?:支払わず|支払うことなく)に?使用することで[^。]*ライフ[^。]*(?:減らない|減少しない)/.test(
      unit.text
    );
  // deck_reveal の pick.destination:"field" は、通常の召喚/配置宣言や
  // コスト支払いを経ずに共通 field-entry primitive へ渡す。これはカード固有の
  // shortcut ではなく、DeckRevealPick の正準 carrier である。ただし本文に
  // 対象を一意に結び付けるコスト境界・カード名・直近カテゴリのいずれもなければ、
  // 別の無償召喚を同じ pick に誤帰属し得るため、payment review を残す。
  const isDeckRevealToFieldWithoutCost = (
    node,
    freeCostBounds,
    freeCardName,
    freeAlternativeCardName,
    freeCategory,
    freeColors,
    freeTribes,
    freeTargetCount
  ) => {
    if (node.kind !== "deck_reveal") return false;
    const filtersForPick = (pick) => {
      if (!object(pick)) return [];
      const nestedAlternatives = object(pick.filter)
        ? list(pick.filter.filterOr).filter(object)
        : [];
      const directAlternatives = list(pick.filterOr).filter(object);
      const hasDirectFilterOr = Array.isArray(pick.filterOr);
      // DeckRevealPick.filterOr と CardFilter.filterOr はどちらも OR 枝だけで候補を
      // 評価し、外側の filter fields を AND 合成しない。両階層の併用、または
      // filterOr と同階層の条件を「共通条件」と解釈すると engine と違う候補を
      // carrier と誤認するので fail-closed にする。
      if (hasDirectFilterOr) {
        if (nestedAlternatives.length > 0) return [];
        return !object(pick.filter) || Object.keys(pick.filter).length === 0
          ? directAlternatives
          : [];
      }
      if (nestedAlternatives.length > 0) {
        const { filterOr: _ignored, ...outerFilter } = pick.filter;
        return Object.keys(outerFilter).length === 0 ? nestedAlternatives : [];
      }
      return object(pick.filter) ? [pick.filter] : [];
    };
    const matchesFilter = (
      filter,
      { cardName = freeCardName, tribes = freeTribes } = {}
    ) =>
      object(filter) &&
      (freeCostBounds.length === 0 ||
        freeCostBounds.some((bound) =>
          Object.entries(bound.values).every(
            ([key, value]) => filter[key] === value
          )
        )) &&
      (!cardName ||
        list(filter.cardName).some(
          (candidate) =>
            object(candidate) && candidate[cardName.kind] === cardName.value
        )) &&
      (!freeCategory ||
        (list(filter.category).length === 1 &&
          list(filter.category)[0] === freeCategory)) &&
      (freeColors.length === 0 ||
        sameDistinctMemberSet(list(filter.colors), freeColors)) &&
      (tribes.length === 0 ||
        sameDistinctMemberSet(list(filter.tribes), tribes));
    return list(node.picks).some((pick) => {
      if (
        !object(pick) ||
        pick.destination !== "field" ||
        (freeTargetCount !== null && pick.count !== freeTargetCount) ||
        (freeCostBounds.length === 0 &&
          freeCardName === null &&
          freeAlternativeCardName === null &&
          freeCategory === null &&
          freeColors.length === 0 &&
          freeTribes.length === 0)
      )
        return false;
      const filters = filtersForPick(pick);
      if (!filters.some((filter) => matchesFilter(filter))) return false;
      // 原文が「名前または系統」のとき、後半の系統だけを満たす branch では
      // 前半の名前対象が欠けても見逃してしまう。明示された別枝が同じ共通条件を
      // 満たして名前指定にも一致することを必須にする。
      return (
        freeAlternativeCardName === null ||
        filters.some((filter) =>
          matchesFilter(filter, {
            cardName: freeAlternativeCardName,
            tribes: [],
          })
        )
      );
    });
  };
  // deck_reveal の destination:"mirage_set" も効果の解決中に直接セットする
  // 正準 carrier であり、通常のミラージュセット宣言・支払いを通らない。本文が
  // 「その中のミラージュ効果を持つ…カードをコストを支払わずにセット」と明示し、
  // 同じ deck_reveal に mirage_set pick が一つだけある場合に限り対応付ける。
  // これにより、別 pick や自己ミラージュセットを無関係に拾わない。
  const isDeckRevealToMirageSetWithoutCost = (
    node,
    freeColors,
    freePaymentOffset
  ) => {
    // 「その中」の対象は無償文より前で最も近い deck owner にのみ結び付ける。
    // 後続文の別 deck 操作や owner が特定できない文を generic carrier として
    // 扱うと誤った player の reveal を無償セットへ帰属してしまうため、fail closed。
    const deckOwner = [
      ...unit.text
        .slice(0, freePaymentOffset)
        .matchAll(/(自分|相手)のデッキ(?:を|の上から)/g),
    ].at(-1);
    const deckPlayer = deckOwner
      ? deckOwner[1] === "自分"
        ? "self"
        : "opponent"
      : null;
    if (
      node.kind !== "deck_reveal" ||
      deckPlayer === null ||
      (node.player ?? "self") !== deckPlayer ||
      !/その中のミラージュ(?:効果)?を持つ[^。]*コスト(?:を)?(?:支払わず|支払うことなく)(?:に)?セット/.test(
        unit.text
      )
    )
      return false;
    return (
      list(node.picks).filter(
        (pick) =>
          object(pick) &&
          pick.destination === "mirage_set" &&
          pick.count === 1 &&
          !Array.isArray(pick.filterOr) &&
          !Array.isArray(pick.filter?.filterOr) &&
          sameDistinctMemberSet(list(pick.filter?.hasMechanic), ["mirage"]) &&
          (freeColors.length === 0 ||
            sameDistinctMemberSet(list(pick.filter?.colors), freeColors))
      ).length === 1
    );
  };
  // search_zone の field 行きも、通常の配置宣言やコスト支払いを経由しない
  // 共通 field-entry primitive である。無償文の直前に対象名・カテゴリ・コスト境界の
  // いずれかがあり、同じ filter へ一意に結び付けられる場合だけ認識する。
  const isSearchZoneToFieldWithoutCost = (
    node,
    freeCostBounds,
    freeCardName,
    freeCategory,
    freeSourceZoneScope
  ) =>
    node.kind === "search_zone" &&
    node.destination === "field" &&
    !Array.isArray(node.filter?.filterOr) &&
    (freeCostBounds.length === 0 ||
      freeCostBounds.some(
        (bound) =>
          object(node.filter) &&
          Object.entries(bound.values).every(
            ([key, value]) => node.filter[key] === value
          )
      )) &&
    (!freeCardName ||
      isExactSingleCardNameFilter(node.filter?.cardName, freeCardName)) &&
    (!freeCategory ||
      (list(node.filter?.category).length === 1 &&
        list(node.filter?.category)[0] === freeCategory)) &&
    (freeSourceZoneScope === null ||
      (sameDistinctMemberSet(list(node.zone), freeSourceZoneScope.zones) &&
        (node.player ?? "self") === freeSourceZoneScope.player)) &&
    isSingleCard(node.count) &&
    (freeCostBounds.length > 0 ||
      freeCardName !== null ||
      freeCategory !== null);
  // デッキから破棄した集合を stepId で限定し、そのまま field へ移動する場合も、
  // 通常の配置宣言・コスト支払いを通らない共通 field-entry primitive である。
  // `fromZone:"deck"` の discard と同じ `stepId` を必須にして、単にトラッシュから
  // field へ移す別効果や、手札破棄を無償配置と誤認しない。さらに本文の「自分/相手の
  // デッキを破棄」から一意に読める owner と discard/target/from/to を一致させる。
  // owner を本文から一意に定められない複数破棄文は review に残す。
  const discardedDeckCollectionContext = (() => {
    const discardMatches = [
      ...unit.text.matchAll(/(自分|相手)のデッキ(?:を|の上から)[^。]*?破棄/g),
    ];
    const freeEntryMatches = [...unit.text.matchAll(FREE_FIELD_ENTRY_RE)];
    if (discardMatches.length !== 1 || freeEntryMatches.length !== 1)
      return null;
    const discard = discardMatches[0];
    const freeEntry = freeEntryMatches[0];
    const discardEnd = (discard.index ?? -1) + discard[0].length;
    const freeEntryStart = freeEntry.index ?? -1;
    const linkToFreeEntry = unit.text.slice(discardEnd, freeEntryStart);
    const collectionTargetClause = linkToFreeEntry.slice(
      linkToFreeEntry.lastIndexOf("。") + 1
    );
    const collectionReferenceStart =
      collectionTargetClause.lastIndexOf("その中");
    const collectionTarget = collectionTargetClause.slice(
      collectionReferenceStart
    );
    const isDirectCollectionTarget = /^その中の(?:[^を]|を持つ)*を$/.test(
      collectionTarget
    );
    // 「その中」が途中の別処理を指すだけでは collection と field entry が結び付かない。
    // `その中の…を` が直接 free-entry を導く単一選択句の場合だけ、破棄集合の直接配置
    // と扱う。属性の「〜を持つ」は対象 filter の一部として許可し、その他の中間 action /
    // zone 操作や曖昧な並列文は review に残す。
    if (
      freeEntryStart <= discardEnd ||
      collectionReferenceStart < 0 ||
      !isDirectCollectionTarget
    )
      return null;
    return discard[1] === "自分" ? "self" : "opponent";
  })();
  const isDiscardedDeckCardsToFieldWithoutCost = (node) => {
    if (
      node.kind !== "move_card" ||
      node.target?.kind !== "filter" ||
      node.target.zone !== "trash" ||
      node.from?.zone !== "trash" ||
      node.to?.zone !== "field" ||
      typeof node.target?.stepId !== "string"
    )
      return false;
    if (!discardedDeckCollectionContext) return false;
    const targetPlayer = node.target.player ?? "self";
    const fromPlayer = node.from.player ?? "self";
    const toPlayer = node.to.player ?? fromPlayer;
    return unit.nodes.some(
      ({ node: candidate }) =>
        candidate.id === node.target.stepId &&
        candidate.action?.kind === "discard" &&
        candidate.action.fromZone === "deck" &&
        (candidate.action.player ?? "self") ===
          discardedDeckCollectionContext &&
        targetPlayer === discardedDeckCollectionContext &&
        targetPlayer === fromPlayer &&
        fromPlayer === toPlayer
    );
  };
  // card_event で自身を field へ移す先頭 step は、通常の配置宣言・コスト支払いを
  // 経由せず cardEventDisposition の共通 field-entry 経路へ渡される。明示された
  // disposition がある場合は interpreter がそちらを優先するため、field 行きと一致
  // することも確認する。disposition 省略時も first step から同じ行き先を推論する
  // 後方互換経路なので、正しい move_self carrier を review に残さない。
  const isCardEventSelfFieldEntryWithoutCost = (node) => {
    if (
      node.kind !== "move_self" ||
      node.destination !== "field" ||
      unit.node?.timing?.kind !== "card_event" ||
      unit.node?.steps?.[0]?.action !== node
    )
      return false;
    const disposition = unit.node.cardEventDisposition;
    return (
      !disposition ||
      (disposition.kind === "move" && disposition.destination === "field")
    );
  };
  const candidates = unit.nodes.filter(
    ({ node }) =>
      node.kind === "cost_modify" ||
      // 「自分が【煌臨】するとき、コストNとしても扱う」は通常の支払い額を
      // 書き換える cost_modify ではなく、煌臨条件の minCost 判定だけに作用する
      // advent_cost_override が正規 carrier である。payment audit は本文の
      // 「コストNとして」を検出するため、ここでも候補として扱い、下の一致判定で
      // 煌臨文脈にこの primitive を必須にする。
      (node.kind === "advent_cost_override" && isAdventCostOverrideText) ||
      (node.kind === "summon" && object(node.target)) ||
      // quartz_set is the direct field-entry carrier for an effect that
      // says a Quartz is set without paying its count cost.  It does not
      // travel through the normal summon/cost_modify pipeline.
      (node.kind === "quartz_set" && node.free === true) ||
      // 条件付きの「コストを支払わずに使用できる」は、cost_modify ではなく
      // この専用の共通 primitive が使用処理そのものを無償化する。例えば
      // BSAZ01-C03/C05 の game_event 起点の手札マジック使用がこの形になる。
      node.kind === "use_magic_without_cost" ||
      // 効果の解決中にミラージュをセットするこの共通 primitive は、通常の
      // set_mirage 宣言/支払い経路を通らない。したがって「コストを支払わずに
      // セットする」の実行 carrier は cost_modify ではなくこれ自身になる
      // (BSDB01-R04)。
      node.kind === "set_self_as_mirage" ||
      // 「裏返してコストを支払わずに配置/召喚する」は、単純な面反転ではなく
      // reverse_rebirth の summon パイプラインで処理する。withoutCost は支払いだけを
      // bypass し、維持コア配置と新規 instance 化は残る（08a §逆転醒）。
      (node.kind === "reverse_rebirth" && node.mode === "summon") ||
      // effect 内の brave_combine_effect は通常の summon/cost_modify
      // パイプラインを通らない。asSummon:true かつ source 省略は、発動元の
      // このブレイヴ自身を field 外から直接合体召喚する正準 carrier であり、
      // native handler が minimumCoreCount:0 で配置を開始するため、本文の
      // 「このカードをコストを支払わずに直接合体するように召喚」に対応する。
      // source 指定は別ブレイヴを合体元にするので「このカード」とは対応付けず、
      // review を残す。
      (node.kind === "brave_combine_effect" &&
        node.asSummon === true &&
        node.source === undefined) ||
      // 「破棄したカードをトラッシュのかわりにコストを支払わず配置する」は
      // draw_modify の prepaidCost.discardDisposition が配置そのものを置換する。
      isDiscardToFieldWithoutCost(node) ||
      // life_damage_interception の useCostGate は、手札カードを無償で使用して
      // ライフ減少を置換する共通 carrier である。
      isLifeDamageInterceptionUseWithoutCost(node) ||
      isDiscardedDeckCardsToFieldWithoutCost(node) ||
      isCardEventSelfFieldEntryWithoutCost(node)
  );
  for (const mode of modes) {
    const siblingContinuousCostModifiers =
      mode.kind === "extra" || mode.kind === "override"
        ? unit.siblingEffects.flatMap((sibling, siblingIndex) => {
            if (
              sibling?.timing?.kind !== "continuous" ||
              unit.node?.timing?.kind !== "continuous" ||
              JSON.stringify(sibling.textRef ?? []) !==
                JSON.stringify(unit.node.textRef ?? []) ||
              JSON.stringify({
                timingScope: sibling.timingScope ?? null,
                applicability: sibling.applicability ?? null,
                condition: sibling.condition ?? null,
              }) !==
                JSON.stringify({
                  timingScope: unit.node.timingScope ?? null,
                  applicability: unit.node.applicability ?? null,
                  condition: unit.node.condition ?? null,
                })
            )
              return [];
            return collectScope(
              sibling,
              `$.siblingEffects[${siblingIndex}]`
            ).nodes.filter(({ node }) => node.kind === "cost_modify");
          })
        : [];
    // 通常召喚許可と、その宣言時の代替支払いは同じ印字文を別の継続 Effect に
    // 分けることがある。`normalActionPermissionEffectIndex` は後者が前者へ
    // 明示的に接続している共通 DSL carrier なので、同じ本文を参照する兄弟から
    // 支払い候補を拾う。単に同じ cardNo の別 Effect を横断するのではなく、
    // self cost_modify + 現在の permission Effect index への一致リンクを必須にして
    // 誤帰属を防ぐ。実行系もこの index 不一致を代替支払い候補から除外する。
    const siblingNormalPermissionPayments =
      mode.kind === "paid" &&
      Number.isInteger(unit.normalActionPermissionEffectIndex) &&
      unit.nodes.some(
        ({ node }) =>
          node.kind === "summon" &&
          node.normalActionPermission === true &&
          node.target?.kind === "self"
      )
        ? unit.siblingEffects.flatMap((sibling, siblingIndex) =>
            collectScope(
              sibling,
              `$.siblingEffects[${siblingIndex}]`
            ).nodes.filter(
              ({ node }) =>
                node.kind === "cost_modify" &&
                node.target?.kind === "self" &&
                node.useCostPayment?.normalActionPermissionEffectIndex ===
                  unit.normalActionPermissionEffectIndex
            )
          )
        : [];
    // 同一原文の兄弟 Effect に分けた無料 self summon は、通常コスト経路から
    // 回数制限・無料指定を剥がしている。兄弟側が正しい carrier であることは
    // hasPairedFreeSelfSummonVariant で厳密に確認済みなので、ここでは通常経路へ
    // free modifier を要求しない。
    if (pairedFreeSelfSummon && mode.kind === "free") continue;
    const deckRevealFreeCandidates =
      mode.kind === "free"
        ? unit.nodes.filter(
            ({ node }) =>
              // deck_reveal の field pick も同じく効果による直接 field entry であり、
              // 選ばれたカードの通常コストを支払う経路はない。本文のコスト境界が
              // 無償文より前の同一文にあれば、その境界・カード名・直近カテゴリを持つ
              // 同じ pick が field 行きであることまで要求する。どれも無ければ同一対象を
              // 確定できないので、この generic carrier だけでは free を充足させない。
              isDeckRevealToFieldWithoutCost(
                node,
                mode.costBounds,
                mode.cardName,
                mode.alternativeCardName,
                mode.category,
                mode.colors,
                mode.tribes,
                mode.targetCount
              ) ||
              isDeckRevealToMirageSetWithoutCost(node, mode.colors, mode.offset)
          )
        : [];
    const searchZoneFreeCandidates =
      mode.kind === "free"
        ? unit.nodes.filter(({ node }) =>
            isSearchZoneToFieldWithoutCost(
              node,
              mode.costBounds,
              mode.cardName,
              mode.category,
              mode.sourceZoneScope
            )
          )
        : [];
    const siblingFreeMagicCandidates =
      mode.kind === "free"
        ? siblingConditionalFreeMagicUseCandidates(unit)
        : [];
    const siblingFreeNormalActionCandidates =
      mode.kind === "free"
        ? siblingNormalActionFreePlacementCandidates(unit)
        : [];
    const siblingActivatedHandSummonFreePayments =
      mode.kind === "free"
        ? siblingActivatedHandSummonFreePaymentCandidates(unit)
        : [];
    const siblingContinuousFreeMagicCostModify =
      mode.kind === "free"
        ? siblingContinuousFreeMagicCostModifyCandidates(unit, mode)
        : [];
    const candidatesForMode =
      mode.kind === "free"
        ? [
            ...candidates,
            ...deckRevealFreeCandidates,
            ...searchZoneFreeCandidates,
            ...siblingFreeMagicCandidates,
            ...siblingFreeNormalActionCandidates,
            ...siblingActivatedHandSummonFreePayments,
            ...siblingContinuousFreeMagicCostModify,
          ]
        : candidates;
    const scopedCandidates =
      mode.kind === "free" &&
      siblingActivatedHandSummonFreePayments.length === 1
        ? siblingActivatedHandSummonFreePayments
        : mode.kind === "free"
          ? narrowFreePaymentCandidates(candidatesForMode, mode)
          : candidatesForMode;
    const relevantCandidates =
      mode.kind === "extra" || mode.kind === "paid"
        ? [
            ...scopedCandidates.filter(
              ({ node }) => node.kind === "cost_modify"
            ),
            ...siblingContinuousCostModifiers,
            ...siblingNormalPermissionPayments,
          ]
        : scopedCandidates;
    // EffectStep.action と EffectStep.choice[].action は、同じ発揮宣言の後で
    // 選ぶ排他的な分岐である（02_turn-flow-and-timing:179）。両枝が同じ self
    // summon を costModifier:"free" で実行するなら、本文の無償召喚は二重でなく
    // 一つの支払い carrier に対応する。片方でも free でなければ畳み込まず review を
    // 残すので、branch ごとの無償性欠落は隠さない。
    const relevant = (() => {
      if (mode.kind !== "free") return relevantCandidates;
      const choiceVariantRoot = (path) =>
        path.replace(/\.choice\[\d+\]\.action$/, "");
      const canonicalPaths = new Set(
        relevantCandidates
          .filter(
            ({ node, path }) =>
              node.kind === "summon" &&
              node.target?.kind === "self" &&
              node.costModifier === "free" &&
              /\.action$/.test(path)
          )
          .map(({ path }) => choiceVariantRoot(path))
          .filter(
            (root) =>
              relevantCandidates.some(
                ({ path }) => path === `${root}.action`
              ) &&
              relevantCandidates.some(
                ({ node, path }) =>
                  /^\.choice\[\d+\]\.action$/.test(path.slice(root.length)) &&
                  node.kind === "summon" &&
                  node.target?.kind === "self" &&
                  node.costModifier === "free"
              )
          )
      );
      return relevantCandidates.filter(({ path }) => {
        const root = choiceVariantRoot(path);
        return !canonicalPaths.has(root) || path === `${root}.action`;
      });
    })();
    if (relevant.length !== 1) {
      emit(
        "payment_scope_review",
        unit.path,
        "支払い文とコスト処理の対応が一意でない",
        `本文=${unit.text}; 期待=${mode.expected}; 実値=${display(relevant.map(({ node, path }) => ({ path, kind: node.kind, modifier: node.modifier ?? node.costModifier })))}`,
        "review"
      );
      continue;
    }
    const { node, path } = relevant[0];
    const certain =
      !unit.uncertain && modes.length === 1 && candidatesForMode.length === 1;
    const modifier =
      node.kind === "cost_modify"
        ? node.modifier
        : node.kind === "advent_cost_override"
          ? { override: node.costTreatedAs }
          : node.kind === "use_magic_without_cost"
            ? "free"
            : node.kind === "set_self_as_mirage"
              ? "free"
              : node.kind === "reverse_rebirth" && node.withoutCost === true
                ? "free"
                : isDiscardToFieldWithoutCost(node)
                  ? "free"
                  : isLifeDamageInterceptionUseWithoutCost(node)
                    ? "free"
                    : node.kind === "quartz_set" && node.free === true
                      ? "free"
                      : isDiscardedDeckCardsToFieldWithoutCost(node)
                        ? "free"
                        : isCardEventSelfFieldEntryWithoutCost(node)
                          ? "free"
                          : node.kind === "brave_combine_effect" &&
                              node.asSummon === true &&
                              node.source === undefined
                            ? "free"
                            : isDeckRevealToFieldWithoutCost(
                                  node,
                                  mode.costBounds ?? [],
                                  mode.cardName,
                                  mode.alternativeCardName,
                                  mode.category,
                                  mode.colors ?? [],
                                  mode.tribes,
                                  mode.targetCount
                                )
                              ? "free"
                              : isDeckRevealToMirageSetWithoutCost(
                                    node,
                                    mode.colors ?? [],
                                    mode.offset
                                  ) ||
                                  isSearchZoneToFieldWithoutCost(
                                    node,
                                    mode.costBounds ?? [],
                                    mode.cardName,
                                    mode.category,
                                    mode.sourceZoneScope ?? null
                                  )
                                ? "free"
                                : node.costModifier;
    const matchesDynamicExtraAmount = (value, expected) =>
      object(value) &&
      object(value.source) &&
      value.source.kind === expected.source.kind &&
      value.source.player === expected.source.player &&
      value.divisor === expected.divisor &&
      (value.preOffset ?? 0) === 0 &&
      (value.multiplier ?? 1) === 1 &&
      (value.groupMultiplier ?? 1) === mode.amount &&
      (value.offset ?? 0) === 0 &&
      value.minValue === undefined &&
      value.subtract === undefined &&
      value.cap === undefined;
    const matched =
      mode.kind === "paid"
        ? node.useCostPayment?.fullCostPaid === true
        : mode.kind === "free"
          ? modifier === "free"
          : mode.kind === "extra"
            ? node.additionalPayment === true &&
              (mode.dynamicAmount
                ? matchesDynamicExtraAmount(
                    modifier?.additionalCostValue,
                    mode.dynamicAmount
                  )
                : modifier?.additionalCostValue === mode.amount)
            : object(modifier) &&
              modifier.override === mode.amount &&
              (isAdventCostOverrideText
                ? node.kind === "advent_cost_override" &&
                  hasAdventCostOverrideScope()
                : node.kind !== "advent_cost_override");
    if (matched) continue;
    // modifier省略は別Effectの常時cost_modifyで補われることがある（ベル等）。
    const explicitContradiction =
      mode.kind === "extra"
        ? node.additionalPayment !== true
          ? node.modifier !== undefined
          : finite(modifier?.additionalCostValue)
        : mode.kind === "paid"
          ? node.useCostPayment !== undefined && modifier !== undefined
          : modifier !== undefined;
    emit(
      "payment_constraint_mismatch",
      path,
      "本文の支払い方式とDSLの方式が一致しない",
      `本文=${unit.text}; 期待=${mode.expected}; 実値=${display({ modifier: modifier ?? "未指定", additionalPayment: node.additionalPayment ?? false, useCostPayment: node.useCostPayment ?? "未指定" })}`,
      certain && explicitContradiction ? "violation" : "review"
    );
  }
}

function parseCostBounds(text) {
  // NFKC後の全角チルダは~、波ダッシュは〜のまま。両方を含める。
  return [
    ...text.matchAll(
      /(本来の?コストを含むコスト|本来の?コスト|コスト)(?:が)?([0-9]+)(?:([~〜～–—−-]|から)([0-9]+)(?:まで)?|(以下|以上|未満))/g
    ),
  ].map((match) => {
    const bound = {
      text: match[0],
      basis: match[1].includes("含む")
        ? "both"
        : match[1].startsWith("本来")
          ? "printed"
          : "effective_or_additional",
      values: match[3]
        ? { minCost: Number(match[2]), maxCost: Number(match[4]) }
        : {
            [match[5] === "以上" ? "minCost" : "maxCost"]:
              Number(match[2]) - (match[5] === "未満" ? 1 : 0),
          },
    };
    const start = match.index ?? 0;
    costBoundPositions.set(bound, { start, end: start + match[0].length });
    return bound;
  });
}

const sameCostBound = (left, right) =>
  left.basis === right.basis &&
  JSON.stringify(left.values) === JSON.stringify(right.values);

/**
 * 「相手のコストN以下の効果を受けない」のコストは、受け手の target ではなく
 * effect_immunity.sourceScope に属する。直後の「効果を受けない」だけで判定し、
 * 「コストN以下のスピリットは効果を受けない」を誤って発生源扱いしない。
 */
function isSourceEffectCostBound(text, bound) {
  const position = costBoundPositions.get(bound);
  if (!position) return false;
  return /^(?:の(?:相手|自分)の|の)?効果を受けない/.test(
    text.slice(position.end)
  );
}

/**
 * 「コストN以上の自分のスピリットの効果で相手がフィールドを離れる」型は、
 * 離脱した相手カードではなく、離脱を起こした効果の source を絞る。
 * triggerFilter と triggerSourceFilter を取り違えると、相手側の離脱対象に
 * コスト条件を誤適用してしまうため、本文の「〜の効果で…離れる」構文だけを
 * 保守的に source filter へ帰属させる。
 */
function isTriggerSourceCostBound(text, bound) {
  const position = costBoundPositions.get(bound);
  if (!position) return false;
  return /^の(?:自分|相手)の[^。]*?の(?:「[^」]+」状態ではない)?効果で[^。]*?フィールドを離れ/.test(
    text.slice(position.end)
  );
}

/**
 * game_event の triggerFilter は、イベントを起こした主体に対する本文上の
 * コスト条件だけを表す。後段 action の「コストN以上の相手の…を破壊する」を
 * triggerFilter で満たしたものとして扱うと、action.target の境界欠落を見逃す。
 * そのため「コストN…の自分/相手の <主体> が…とき/場合」または
 * 「コストN…の自分/相手の <主体> のバトル/ターン/ステップ終了時」という、
 * 主体と時点が読点を挟まずに連続する構文だけを保守的に認める。後段 action を
 * 実行した後の「〜、バトル終了時」は triggerFilter の根拠にしない。
 */
function isTriggerSubjectCostBound(text, bound) {
  const position = costBoundPositions.get(bound);
  if (!position) return false;
  const beforeBound = text.slice(0, position.start);
  const afterBound = text.slice(position.end);
  // 所有者は「コストN…の自分のスピリット」のように後ろに来る場合だけでなく、
  // 「系統:『X』を持つ自分のコストN…のスピリット」のようにコスト句の前に
  // 置かれる場合がある。いずれも「主体が…とき/場合」または主体直後の
  // 「…のバトル/ターン/ステップ終了時」と連続しているときだけ triggerFilter の
  // 条件として認め、後段 target の境界とは混同しない。
  const hasOwnerBeforeBound = /(?:自分|相手)の$/.test(beforeBound);
  const hasOwnerAfterBound = /^の(?:自分|相手)の/.test(afterBound);
  return (
    (hasOwnerBeforeBound || hasOwnerAfterBound) &&
    /^の(?:(?:自分|相手)の)?[^、。]*?(?:が[^。]*?(?:とき|場合)|の(?:この)?(?:バトル|ターン|ステップ)終了時)/.test(
      afterBound
    )
  );
}

/**
 * 「コストN以上の相手のスピリット/アルティメットのアタックでは」型の
 * コスト条件は、効果の通常 target ではなくライフ減少を発生させる
 * アタッカーに属する。life_damage_interception.attackerFilter はこの
 * ライフ減少の発生カードを表す正準 carrier なので、本文が明示的に
 * 「〜のアタックで」または「〜によって自分/相手のライフは減らない」と
 * 結ぶ場合にだけ対象コスト監査へ含める。
 */
function isAttackerCostBound(text, bound) {
  const position = costBoundPositions.get(bound);
  if (!position) return false;
  return /^の(?:自分|相手)の[^。]*?(?:のアタック(?:で|では)|によって(?:自分|相手)のライフは[^。]*?減ら)/.test(
    text.slice(position.end)
  );
}

/**
 * 「コストN以上の自分のスピリットをスタックタイミング元にして、スタック効果を
 * 使用できない」型のコスト条件は、通常の target ではなく restrict_stack の効果
 * 発生元を絞る sourceCardFilter に帰属する。「スタックタイミング元にして」と
 * 「スタック効果を使用できない」が連続する本文だけをこの carrier で認識し、他の
 * コスト条件を発生元フィルタと取り違えない。
 */
function isStackSourceCostBound(text, bound) {
  const position = costBoundPositions.get(bound);
  if (!position) return false;
  return /^の(?:(?:自分|相手)の)?[^。]*?をスタックタイミング元にして、スタック効果を使用できない/.test(
    text.slice(position.end)
  );
}

function stackSourceRestrictedPlayer(text, bound) {
  if (!isStackSourceCostBound(text, bound)) return null;
  const position = costBoundPositions.get(bound);
  if (!position) return null;
  const sentenceStart = Math.max(
    text.lastIndexOf("。", position.start),
    text.lastIndexOf("\n", position.start)
  );
  const leading = text.slice(sentenceStart + 1, position.start);
  if (/(?:^|、)相手は[^。]*$/.test(leading)) return "opponent";
  if (/(?:^|、)自分は[^。]*$/.test(leading)) return "self";
  return null;
}

function isCostBoundInHeader(text, bound) {
  const position = costBoundPositions.get(bound);
  if (!position) return false;
  const headerStart = text.lastIndexOf("【", position.start);
  const headerEnd = text.indexOf("】", position.start);
  return headerStart >= 0 && headerEnd >= position.end;
}

function checkSourceEffectCost(unit, emit, bounds) {
  const directSourceBounds = bounds.filter((bound) =>
    isSourceEffectCostBound(unit.text, bound)
  );
  if (directSourceBounds.length === 0) return bounds;
  const sourceBounds = new Set(directSourceBounds);
  for (const source of directSourceBounds) {
    for (const candidate of bounds) {
      if (
        candidate !== source &&
        sameCostBound(candidate, source) &&
        isCostBoundInHeader(unit.text, candidate)
      ) {
        // 【弾幕：コストN以下】など、直後の発生源制約を補強する見出しだけを
        // 同じsourceScopeに帰属させる。本文中の同値な対象コストは除外しない。
        sourceBounds.add(candidate);
      }
    }
  }

  const sourceActions = unit.nodes.filter(
    ({ node }) => node.kind === "effect_immunity"
  );
  const examined = [];
  for (const bound of directSourceBounds) {
    if (examined.some((known) => sameCostBound(known, bound))) continue;
    examined.push(bound);
    const matchingTextBounds = [...sourceBounds].filter((candidate) =>
      sameCostBound(candidate, bound)
    );
    if (sourceActions.length !== 1) {
      emit(
        "source_effect_cost_scope_review",
        unit.path,
        "効果発生源のコスト条件とeffect_immunityの対応を確定できない",
        `本文=${matchingTextBounds.map(({ text }) => text).join(" + ")}; 期待=effect_immunity.sourceScope:${display(bound.values)}; 実値=${display(sourceActions.map(({ node, path }) => ({ path, sourceScope: node.sourceScope })))}`,
        "review"
      );
      continue;
    }
    const { node, path } = sourceActions[0];
    const sourceScope = object(node.sourceScope) ? node.sourceScope : {};
    const matches = Object.entries(bound.values).every(
      ([key, value]) => sourceScope[key] === value
    );
    if (matches) continue;
    const certain =
      !unit.uncertain &&
      examined.length === 1 &&
      sourceActions.length === 1 &&
      Object.keys(bound.values).every((key) => key === "maxCost");
    emit(
      "source_effect_cost_bound_mismatch",
      `${path}.sourceScope`,
      "本文の効果発生源コスト境界がeffect_immunity.sourceScopeに一致しない",
      `本文=${matchingTextBounds.map(({ text }) => text).join(" + ")}; 期待=${display(bound.values)}; 実値=${display(sourceScope)}`,
      certain ? "violation" : "review"
    );
  }

  return bounds.filter((bound) => !sourceBounds.has(bound));
}

/**
 * 「本来を含む」の確定裁定は印字AND実効。既存CardFilterの正準表現は
 * 実効側min/maxに、印字の範囲外をexclude(filterOr)する交差を加える。
 * 複雑な同値変形は証明せずreviewへ。costBasisの既定は両基準のANDではない。
 */
function hasPrintedIntersection(filter, values) {
  if (filter.costBasis === "printed" || filter.filterOr?.length) return false;
  if (!Object.entries(values).every(([key, value]) => filter[key] === value))
    return false;
  const outside = [];
  if (finite(values.minCost)) outside.push(["maxCost", values.minCost - 1]);
  if (finite(values.maxCost)) outside.push(["minCost", values.maxCost + 1]);
  if (
    filter.exclude?.filterOr &&
    Object.keys(filter.exclude).some((key) => key !== "filterOr")
  )
    return false;
  const branches = filter.exclude?.filterOr ?? list(filter.exclude);
  return (
    branches.length === outside.length &&
    outside.every(([key, value]) =>
      branches.some(
        (branch) =>
          object(branch) &&
          branch.costBasis === "printed" &&
          branch[key] === value &&
          Object.keys(branch).every(
            (field) => field === key || field === "costBasis"
          )
      )
    )
  );
}

/**
 * 「コストN以上の自分のXがいるとき」の境界は、後段 action の対象ではなく
 * 発揮条件の field_has に属する。field_has が同じ主体・単純な対象種別または
 * カード名・境界・基準を実装しているときだけ対象監査から除外する。対象の修飾
 * （系統/色/状態など）を本文から確定できない形は安全側で review を残す。条件
 * carrier が欠ける/ずれるなら従来どおり review を残し、本文に別の対象コストが
 * あればその別 bound は監査を続ける。
 */
const SIMPLE_FIELD_HAS_CATEGORY = new Map([
  ["スピリット", "spirit"],
  ["アルティメット", "ultimate"],
  ["ネクサス", "nexus"],
  ["ブレイヴ", "brave"],
  ["マジック", "magic"],
]);

function parseSimpleFieldHasSubject(subject) {
  const parts = subject.split(/[／/]/).map((part) => part.trim());
  const categories = parts.map((part) => SIMPLE_FIELD_HAS_CATEGORY.get(part));
  if (categories.every(Boolean)) return { categories };

  const cardNames = parts.map((part) =>
    /^(カード名[：:]?)?「([^」]+)」$/.exec(part)
  );
  if (cardNames.every(Boolean)) {
    return {
      cardNames: cardNames.map((match) => ({
        kind: match[1] ? "exact" : "contains",
        value: match[2],
      })),
    };
  }
  return null;
}

function sameMembers(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((value) => expected.includes(value))
  );
}

/**
 * `sameMembers` intentionally remains a loose comparison for legacy callers.
 * A filterOr category union, however, is a proof that every printed category
 * is present exactly once.  Duplicate branches must not stand in for a
 * missing category.
 */
function sameDistinctMembers(actual, expected) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return (
    actual.length === actualSet.size &&
    expected.length === expectedSet.size &&
    actualSet.size === expectedSet.size &&
    [...actualSet].every((value) => expectedSet.has(value))
  );
}

function isMatchingFieldHasConditionBound(unit, bound) {
  const position = costBoundPositions.get(bound);
  if (!position) return false;
  const trailing = unit.text.slice(position.end);
  const fieldHasText =
    /^の(?<owner>自分|相手)の(?<subject>[^。]*?)(?:が|は)(?:いる|ある)とき/.exec(
      trailing
    );
  if (!fieldHasText?.groups) {
    return false;
  }
  const subject = parseSimpleFieldHasSubject(fieldHasText.groups.subject);
  if (!subject) return false;
  const player = fieldHasText.groups.owner === "自分" ? "self" : "opponent";
  return list(unit.node?.condition).some((condition) => {
    if (!object(condition) || condition.kind !== "field_has") return false;
    if (condition.player !== player) return false;
    const conditionCardNames = list(condition.cardNames);
    const conditionCategories = list(condition.category);
    if (
      Object.entries(condition).some(
        ([key, value]) =>
          value !== undefined &&
          ![
            "kind",
            "player",
            "category",
            "cardNames",
            "minCost",
            "maxCost",
            "costBasis",
          ].includes(key)
      ) ||
      (subject.categories
        ? !sameMembers(conditionCategories, subject.categories) ||
          conditionCardNames.length > 0
        : conditionCategories.length > 0 ||
          conditionCardNames.length === 0 ||
          !subject.cardNames.every(({ kind, value }) =>
            conditionCardNames.some(
              (match) => object(match) && match[kind] === value
            )
          ) ||
          !conditionCardNames.every(
            (match) =>
              object(match) &&
              subject.cardNames.some(({ kind, value }) => match[kind] === value)
          )) ||
      !["minCost", "maxCost"].every(
        (key) => condition[key] === bound.values[key]
      )
    ) {
      return false;
    }
    if (
      !Object.entries(bound.values).every(
        ([key, value]) => condition[key] === value
      )
    ) {
      return false;
    }
    if (bound.basis === "printed") return condition.costBasis === "printed";
    if (bound.basis === "both") return false;
    return condition.costBasis !== "printed";
  });
}

const REFERENCED_COST_EFFECTS = {
  cost_destroy: { text: "コスト破壊", actionKind: "destroy" },
  cost_vanish: { text: "コスト消滅", actionKind: "vanish" },
  cost_bounce: { text: "コストバウンス", actionKind: "bounce" },
  cost_exhaust: { text: "コスト疲労", actionKind: "exhaust" },
  cost_prevent_battle: { actionKind: "prevent_battle" },
};

function filterMatchesCostBound(filter, bound) {
  if (
    !Object.entries(bound.values).every(([key, value]) => filter[key] === value)
  )
    return false;
  if (bound.basis === "printed") return filter.costBasis === "printed";
  if (bound.basis === "effective_or_additional")
    return filter.costBasis !== "printed";
  // 「本来のコストを含むコスト」は印字・実効の両方を別 carrier で持つため、
  // 単一の effect_param_modify の参照先に縮約してはいけない。
  return false;
}

function hasOnlyDirectCostBoundFields(filter) {
  return Object.entries(filter).every(
    ([key, value]) =>
      value === undefined ||
      ["category", "tribes", "minCost", "maxCost", "costBasis"].includes(key)
  );
}

/**
 * A directly following category makes a cost bound belong to that one target
 * branch.  For example, in "BP8000以下のスピリット/コスト4以下のネクサス",
 * the latter bound must not be required on the spirit branch.
 *
 * Keep this intentionally narrow: modifiers between the bound and the
 * category remain review-worthy rather than being guessed from prose.
 */
function categoriesDirectlyFollowingCostBound(text, bound) {
  const position = costBoundPositions.get(bound);
  if (!position) return null;
  const match =
    /^の(?:(?:相手|自分)の)?(?<categories>(?:スピリット|アルティメット|ブレイヴ|ネクサス|マジック)(?:カード)?(?:[/／・](?:スピリット|アルティメット|ブレイヴ|ネクサス|マジック)(?:カード)?)*)(?=[0-9０-９]*?(?:体|つ|枚)|すべて|を|は|が|に)/.exec(
      text.slice(position.end)
    );
  if (!match?.groups?.categories) return null;
  const categories = match.groups.categories
    .split(/[/／・]/)
    .map((value) => CARD_CATEGORY_BY_TEXT[value.replace(/カード$/, "")]);
  return categories.every(Boolean) ? categories : null;
}

function parseJapaneseNumber(value) {
  return Number.parseInt(
    value.replace(/[０-９]/g, (digit) =>
      String.fromCharCode(digit.charCodeAt(0) - 0xfee0)
    ),
    10
  );
}

/**
 * A cost carrier may coexist with an OR branch only when that branch has its
 * own, directly stated target restriction. This deliberately recognizes the
 * narrow BP form used by the split "BP8000以下のスピリット/コスト4以下の
 * ネクサス" syntax; any other extra branch remains review-worthy.
 */
function isMatchingDirectBpTargetBranch(text, bound, branch) {
  if (!object(branch) || !Array.isArray(branch.category)) return false;
  const costPosition = costBoundPositions.get(bound);
  if (!costPosition) return false;
  const definedKeys = Object.entries(branch)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
  if (
    definedKeys.some((key) => !["category", "minBp", "maxBp"].includes(key)) ||
    (branch.minBp === undefined && branch.maxBp === undefined)
  ) {
    return false;
  }
  const pattern =
    /BP(?<value>[0-9０-９]+)(?<direction>以下|以上)の(?:(?:相手|自分)の)?(?<categories>(?:スピリット|アルティメット|ブレイヴ|ネクサス|マジック)(?:カード)?(?:[/／・](?:スピリット|アルティメット|ブレイヴ|ネクサス|マジック)(?:カード)?)*)(?=[/／]|[0-9０-９]*?(?:体|つ|枚)|すべて|を|は|が|に)/g;
  for (const match of text.matchAll(pattern)) {
    if (text.slice(Math.max(0, match.index - 3), match.index) === "本来の") {
      continue;
    }
    const separatorToCost = text.slice(
      match.index + match[0].length,
      costPosition.start
    );
    if (!/^[\s/／]+$/.test(separatorToCost)) continue;
    const categories = match.groups.categories
      .split(/[/／・]/)
      .map((value) => CARD_CATEGORY_BY_TEXT[value.replace(/カード$/, "")]);
    if (
      !categories.every(Boolean) ||
      !sameDistinctMembers(branch.category, categories)
    ) {
      continue;
    }
    const value = parseJapaneseNumber(match.groups.value);
    if (
      (match.groups.direction === "以下" &&
        branch.maxBp === value &&
        branch.minBp === undefined) ||
      (match.groups.direction === "以上" &&
        branch.minBp === value &&
        branch.maxBp === undefined)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The cost-bearing alternative may itself carry an immediately preceding
 * tribe restriction, while an earlier `か、` alternative has its own explicit
 * tribe/category restriction.  For example, this accepts only the narrow
 * form `系統：「A」を持つネクサス1枚か、系統：「A」/「B」を持つコスト4以上の
 * スピリット1枚`; it does not infer restrictions from unrelated prose.
 */
function isMatchingDirectTribeTargetBranch(text, bound, branch) {
  if (!object(branch) || !Array.isArray(branch.category)) return false;
  const definedKeys = Object.entries(branch)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
  if (
    definedKeys.some((key) => !["category", "tribes"].includes(key)) ||
    !Array.isArray(branch.tribes)
  ) {
    return false;
  }
  const costPosition = costBoundPositions.get(bound);
  if (!costPosition) return false;
  const targetPattern =
    /系統[：:](?<tribes>(?:「[^」]+」)(?:[/／・](?:「[^」]+」))*)を持つ(?<categories>(?:スピリット|アルティメット|ブレイヴ|ネクサス|マジック)(?:カード)?(?:[/／・](?:スピリット|アルティメット|ブレイヴ|ネクサス|マジック)(?:カード)?)*)(?:[0-9０-９]+)?(?:体|つ|枚)か、/g;
  for (const match of text.matchAll(targetPattern)) {
    const betweenBranchAndCost = text.slice(
      match.index + match[0].length,
      costPosition.start
    );
    if (
      !/^系統[：:](?:「[^」]+」)(?:[/／・](?:「[^」]+」))*を持つ$/.test(
        betweenBranchAndCost
      )
    ) {
      continue;
    }
    const categories = match.groups.categories
      .split(/[/／・]/)
      .map((value) => CARD_CATEGORY_BY_TEXT[value.replace(/カード$/, "")]);
    const tribes = [...match.groups.tribes.matchAll(/「([^」]+)」/g)].map(
      (tribeMatch) => tribeMatch[1]
    );
    if (
      categories.every(Boolean) &&
      sameDistinctMembers(branch.category, categories) &&
      sameDistinctMembers(branch.tribes, tribes)
    ) {
      return true;
    }
  }
  return false;
}

function tribesDirectlyPrecedingCostBound(text, bound) {
  const costPosition = costBoundPositions.get(bound);
  if (!costPosition) return null;
  const prefix = text.slice(
    text.lastIndexOf("。", costPosition.start) + 1,
    costPosition.start
  );
  const match =
    /系統[：:](?<tribes>(?:「[^」]+」)(?:[/／・](?:「[^」]+」))*)を持つ$/.exec(
      prefix
    );
  if (!match?.groups?.tribes) return null;
  return [...match.groups.tribes.matchAll(/「([^」]+)」/g)].map(
    (tribeMatch) => tribeMatch[1]
  );
}

/**
 * A leading tribe clause can govern both sides of a slash-separated target
 * alternative. The form is intentionally limited to the printed
 * `導界者ネクサス/コストN以上のスピリット` wording: `導界者ネクサス`
 * has a canonical CardFilter representation (`guided` plus the explicit
 * grandwalker opt-in), so accepting a merely similar nexus branch would hide
 * a target-lock regression.
 */
function sharedTribesBeforeGuidedNexusCostAlternative(text, bound) {
  const costPosition = costBoundPositions.get(bound);
  if (!costPosition) return null;
  const prefix = text.slice(
    text.lastIndexOf("。", costPosition.start) + 1,
    costPosition.start
  );
  const match =
    /系統[：:](?<tribes>(?:「[^」]+」)(?:[/／・](?:「[^」]+」))*)を持つ(?:(?:自分|相手)の)?導界者ネクサス[/／]$/.exec(
      prefix
    );
  if (!match?.groups?.tribes) return null;
  return [...match.groups.tribes.matchAll(/「([^」]+)」/g)].map(
    (tribeMatch) => tribeMatch[1]
  );
}

function isMatchingSharedTribeGuidedNexusBranch(text, bound, branch, tribes) {
  if (!object(branch)) return false;
  const sharedTribes = sharedTribesBeforeGuidedNexusCostAlternative(
    text,
    bound
  );
  if (!sharedTribes || !sameDistinctMembers(sharedTribes, tribes)) return false;
  const definedKeys = Object.entries(branch)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
  return (
    definedKeys.every((key) =>
      ["category", "tribes", "targetsGrandwalker", "hasMechanic"].includes(key)
    ) &&
    sameDistinctMembers(branch.category, ["nexus"]) &&
    sameDistinctMembers(branch.tribes, tribes) &&
    branch.targetsGrandwalker === true &&
    sameDistinctMembers(branch.hasMechanic, ["guided"])
  );
}

function filterOrBranchesMatchingDirectCostBound(filter, bound, text) {
  const categories = categoriesDirectlyFollowingCostBound(text, bound);
  if (!categories || !Array.isArray(filter.filterOr)) return null;
  const directTribes = tribesDirectlyPrecedingCostBound(text, bound);
  const sharedTribes = sharedTribesBeforeGuidedNexusCostAlternative(
    text,
    bound
  );
  const expectedTribes = directTribes ?? sharedTribes;
  const boundedBranches = filter.filterOr
    .map((branch, index) => ({ branch, index }))
    .filter(
      ({ branch }) =>
        object(branch) &&
        Array.isArray(branch.category) &&
        hasOnlyDirectCostBoundFields(branch) &&
        (expectedTribes
          ? sameDistinctMembers(branch.tribes, expectedTribes)
          : branch.tribes === undefined) &&
        ["minCost", "maxCost", "costBasis"].some(
          (key) => branch[key] !== undefined
        )
    );
  // A direct category list can be represented as one CardFilter branch, or as
  // a union of one category branch per printed category.  The latter is the
  // canonical form when category-specific filters are required.  Do not
  // accept a partial/extra union: every branch must be one printed category
  // and the branch categories must cover that set exactly.  This preserves a
  // review for an unbounded extra category instead of silently accepting it.
  const boundedBranchIndexes = new Set(
    boundedBranches.map(({ index }) => index)
  );
  const hasUnsupportedAdditionalBranch = filter.filterOr.some(
    (branch, index) =>
      !boundedBranchIndexes.has(index) &&
      !isMatchingDirectBpTargetBranch(text, bound, branch) &&
      !isMatchingDirectTribeTargetBranch(text, bound, branch) &&
      !isMatchingSharedTribeGuidedNexusBranch(
        text,
        bound,
        branch,
        expectedTribes ?? []
      )
  );
  if (
    boundedBranches.length === 1 &&
    !hasUnsupportedAdditionalBranch &&
    sameDistinctMembers(boundedBranches[0].branch.category, categories)
  ) {
    return boundedBranches;
  }
  if (
    boundedBranches.length !== filter.filterOr.length ||
    boundedBranches.length !== categories.length ||
    !boundedBranches.every(
      ({ branch }) =>
        branch.category.length === 1 && categories.includes(branch.category[0])
    ) ||
    !sameDistinctMembers(
      boundedBranches.map(({ branch }) => branch.category[0]),
      categories
    )
  ) {
    return null;
  }
  return boundedBranches;
}

function hasSiblingTargetForReferencedCostEffect(unit, bounds) {
  const references = unit.nodes
    .filter(({ node }) => node.kind === "effect_param_modify")
    .map(({ node }) => REFERENCED_COST_EFFECTS[node.effectClass])
    .filter(
      (reference) =>
        reference && unit.text.includes(`この「${reference.text}効果」の上限`)
    );
  if (references.length === 0 || !Array.isArray(unit.siblingEffects))
    return false;

  return references.some(({ actionKind }) =>
    unit.siblingEffects.some((sibling) => {
      if (!object(sibling) || sibling.stub) return false;
      const { nodes } = collectScope(sibling, "$.sibling");
      return nodes.some(
        ({ node, path, step }) =>
          path.endsWith(".target") &&
          object(node.filter) &&
          step?.node?.action?.kind === actionKind &&
          bounds.length === 1 &&
          filterMatchesCostBound(node.filter, bounds[0])
      );
    })
  );
}

/**
 * 同じ原文行を共有する継続効果と game_event 効果を分ける場合、
 * 「コストN…の <主体> が…とき」の条件は後者の triggerFilter に属する。
 *
 * 継続効果自身の target にコスト carrier が無く、同一 textRef の兄弟にただ一つ
 * 一致する triggerFilter がある場合だけ、その継続効果へコストを誤帰属させない。
 * 兄弟の境界が欠落・不一致・複数候補なら false のまま review を残す。カード番号
 * ではなく、本文の trigger 主体構文・timing・共有 textRef を全て照合する。
 */
function hasSiblingTriggerSubjectForCostBound(unit, bounds) {
  const bound = bounds.length === 1 ? bounds[0] : null;
  if (
    !bound ||
    unit.node?.timing?.kind !== "continuous" ||
    !isTriggerSubjectCostBound(unit.text, bound) ||
    !Array.isArray(unit.siblingEffects)
  )
    return false;

  const textRef = JSON.stringify(unit.node.textRef ?? []);
  return (
    unit.siblingEffects.filter(
      (sibling) =>
        object(sibling) &&
        !sibling.stub &&
        sibling.timing?.kind === "game_event" &&
        JSON.stringify(sibling.textRef ?? []) === textRef &&
        object(sibling.timing.triggerFilter) &&
        filterMatchesCostBound(sibling.timing.triggerFilter, bound)
    ).length === 1
  );
}

/**
 * 「このスピリットと〜コストN以上の〜すべてに…を与える」型では、自己対象と
 * 条件付きの対象集合を、同じ本文を参照する二つの continuous effect に分けることがある。
 *
 * 自己対象側には CardFilter がないため、そこだけを監査すると後者の min/maxCost を
 * 見失う。ここでは effect_immunity に限り、共有 textRef・continuous timing・本文の
 * 集合付与構文・target 以外の action payload がすべて一致し、かつ sibling の filter が
 * 境界を一意に満たす場合だけ、その分割を正しい carrier と認める。境界や sourceScope /
 * duration を壊した場合、または sibling が複数ある場合は従来どおり review に残す。
 */
function hasSiblingSharedImmunityTargetForCostBound(unit, bounds) {
  const bound = bounds.length === 1 ? bounds[0] : null;
  if (
    !bound ||
    unit.node?.timing?.kind !== "continuous" ||
    !Array.isArray(unit.siblingEffects) ||
    !/この(?:スピリット|アルティメット|ブレイヴ|ネクサス)と.*コスト[0-9]+(?:以上|以下|未満).*すべてに/.test(
      unit.text
    ) ||
    !/を与える/.test(unit.text)
  )
    return false;

  const selfActions = unit.nodes
    .filter(
      ({ node, path }) =>
        path.endsWith(".action") &&
        node.kind === "effect_immunity" &&
        node.target?.kind === "self"
    )
    .map(({ node }) => node);
  if (selfActions.length !== 1) return false;

  const { target: _selfTarget, ...selfPayload } = selfActions[0];
  const textRef = JSON.stringify(unit.node.textRef ?? []);
  const matchingSiblings = unit.siblingEffects.flatMap((sibling, index) => {
    if (
      !object(sibling) ||
      sibling.stub ||
      sibling.timing?.kind !== "continuous" ||
      JSON.stringify(sibling.textRef ?? []) !== textRef
    )
      return [];
    return collectScope(sibling, `$.siblingEffects[${index}]`)
      .nodes.filter(
        ({ node, path }) =>
          path.endsWith(".action") &&
          node.kind === "effect_immunity" &&
          node.target?.kind === "filter" &&
          object(node.target.filter) &&
          filterMatchesCostBound(node.target.filter, bound)
      )
      .filter(({ node }) => {
        const { target: _filterTarget, ...filterPayload } = node;
        return JSON.stringify(filterPayload) === JSON.stringify(selfPayload);
      });
  });
  return matchingSiblings.length === 1;
}

/**
 * 「このブレイヴの効果の条件を『本来のコストN以下』に変更する」型は、変更する
 * effect_param_modify 自身に target を持たない。scope:"self" の数値 delta と、同一
 * effect container 内のただ1つの元 action を合わせて初めて本文の N を表せる。
 *
 * 対象 action の種別・印字コスト基準・元の上限 + delta をすべて照合する。兄弟を広く
 * 探しても、この構文と scope が揃わない限りは従来どおり review を残す。
 */
function hasReferencedCostConditionChangeTarget(unit, bounds) {
  const bound = bounds.length === 1 ? bounds[0] : null;
  if (
    !bound ||
    !finite(bound.values.maxCost) ||
    Object.keys(bound.values).length !== 1 ||
    !/この(?:カード|ブレイヴ|スピリット|ネクサス|マジック)の効果の条件を[「『]?本来の?コスト[0-9]+(?:以下|以上|未満)[」』]?に変更/.test(
      unit.text
    ) ||
    !Array.isArray(unit.referencedEffects)
  )
    return false;

  const candidates = unit.nodes.flatMap(({ node }) => {
    if (
      node.kind !== "effect_param_modify" ||
      node.scope !== "self" ||
      !finite(node.addLimitAmount)
    )
      return [];
    const reference = REFERENCED_COST_EFFECTS[node.effectClass];
    if (!reference) return [];
    return unit.referencedEffects.flatMap((effect, effectIndex) => {
      if (!object(effect) || effect.stub) return [];
      return collectScope(effect, `$.referencedEffects[${effectIndex}]`)
        .nodes.filter(
          ({ node: candidate, path, step }) =>
            path.endsWith(".target") &&
            object(candidate.filter) &&
            step?.node?.action?.kind === reference.actionKind &&
            finite(candidate.filter.maxCost) &&
            candidate.filter.maxCost + node.addLimitAmount ===
              bound.values.maxCost &&
            (bound.basis === "printed"
              ? candidate.filter.costBasis === "printed"
              : bound.basis === "effective_or_additional"
                ? candidate.filter.costBasis !== "printed"
                : false)
        )
        .map(({ path }) => path);
    });
  });
  return candidates.length === 1;
}

function checkTargetCost(unit, emit, bounds) {
  bounds = bounds.filter(
    (bound) => !isMatchingFieldHasConditionBound(unit, bound)
  );
  if (bounds.length === 0) return;
  const directTargets = [
    ...unit.nodes.flatMap(({ node, path }) =>
      // CardFilter を持つ target は kind:"filter" に限らない。from_zone も
      // 同じ filter を使うため、action.target 自身にある filter を共通で読む。
      object(node.filter) && path.endsWith(".target")
        ? [
            {
              filter: node.filter,
              path,
              filterPath: `${path}.filter`,
              destination: node.destination,
            },
          ]
        : []
    ),
    // `discard` は TargetSpec ではなく action.filter 自身で手札の候補を絞る。
    // 手札公開後の「その中のコストN以下のカードを破棄する」型では、この
    // CardFilter が本文のコスト句を実際に適用する正準 carrier である。ほかの
    // action-level filter は検索・公開などの対象範囲にも使われるため、ここでは
    // ゾーン移動を起こす discard だけを明示的に扱い、過剰な帰属はしない。
    ...unit.nodes.flatMap(({ node, path }) =>
      node.kind === "discard" && object(node.filter)
        ? [
            {
              filter: node.filter,
              path,
              filterPath: `${path}.filter`,
            },
          ]
        : []
    ),
    // grantedEffect 自身に textRef/sourceText がなく、外側の本文だけを継承して
    // 解析する場合、本文のコスト条件は「付与された効果」ではなく grant_effect の
    // 対象群を修飾する。外側 target を同じ path の carrier として再利用する。
    ...(object(unit.inheritedGrantTarget?.target?.filter)
      ? [
          {
            filter: unit.inheritedGrantTarget.target.filter,
            path: unit.inheritedGrantTarget.path,
            filterPath: `${unit.inheritedGrantTarget.path}.filter`,
          },
        ]
      : []),
  ];
  // negate は通常の ActionTarget を持たない。opponent_burst の targetFilter は
  // バーストカードを、summon/place の targetFilter はスタックに積まれた
  // 召喚/配置元カードをそれぞれ絞る。いずれも本文が直接指定するコスト条件の
  // 正準 carrier である。ほかの negate target は行動そのものを絞る用途もあるため
  // ここには含めない。
  const negateCardTargets = unit.nodes.flatMap(({ node, path }) =>
    node.kind === "negate" &&
    ["opponent_burst", "summon", "place"].includes(node.negateTarget) &&
    object(node.targetFilter)
      ? [
          {
            filter: node.targetFilter,
            path,
            filterPath: `${path}.targetFilter`,
            negateTarget: node.negateTarget,
          },
        ]
      : []
  );
  // deck_reveal の pick filter は、効果が直接フィールドへ出すカードを選ぶための
  // CardFilter である。通常 target と同じ境界監査に載せる。pick ごとに path を
  // 保持し、複数候補を安易に一意と扱わない。
  const deckRevealTargets = unit.nodes.flatMap(({ node, path }) => {
    if (node.kind !== "deck_reveal" || !Array.isArray(node.picks)) return [];
    return node.picks.flatMap((pick, index) =>
      object(pick?.filter)
        ? [
            {
              filter: pick.filter,
              path: `${path}.picks[${index}]`,
              filterPath: `${path}.picks[${index}].filter`,
              destination: pick.destination,
            },
          ]
        : []
    );
  });
  // game_event の triggerFilter は、後段 action の対象ではなくイベントを
  // 起こしたカードそのものを絞る CardFilter である。ただし本文が「コストN…の
  // 自分/相手の <主体> が…とき/場合」と明示するときだけ、そのコスト条件を
  // triggerFilter の所属と認める。後段 target の境界とは混同しない。
  const triggerSubjects =
    object(unit.node?.timing?.triggerFilter) &&
    bounds.some((bound) => isTriggerSubjectCostBound(unit.text, bound))
      ? [
          {
            filter: unit.node.timing.triggerFilter,
            path: `${unit.path}.timing.triggerFilter`,
            // triggerFilter itself is a CardFilter.  Unlike action.target,
            // there is no intervening `.filter` carrier in the DSL path.
            filterPath: `${unit.path}.timing.triggerFilter`,
          },
        ]
      : [];
  const triggerSourceSubjects =
    object(unit.node?.timing?.triggerSourceFilter) &&
    bounds.some((bound) => isTriggerSourceCostBound(unit.text, bound))
      ? [
          {
            filter: unit.node.timing.triggerSourceFilter,
            path: `${unit.path}.timing.triggerSourceFilter`,
            // triggerSourceFilter is likewise the CardFilter itself.
            filterPath: `${unit.path}.timing.triggerSourceFilter`,
          },
        ]
      : [];
  // life_damage_interception は通常 target を選ばず、battle 中にライフ減少を
  // 発生させたアタッカーを attackerFilter で絞る。本文が明示的にアタックの
  // コスト条件を持つときだけ、他の target/filter と同じ境界照合へ載せる。
  const attackerTargets = bounds.some((bound) =>
    isAttackerCostBound(unit.text, bound)
  )
    ? unit.nodes.flatMap(({ node, path }) =>
        node.kind === "life_damage_interception" && object(node.attackerFilter)
          ? [
              {
                filter: node.attackerFilter,
                path: `${path}.attackerFilter`,
                filterPath: `${path}.attackerFilter`,
              },
            ]
          : []
      )
    : [];
  // restrict_stack の targetScope:"effect_source" は、通常の target ではなく
  // 「スタックタイミング元」とするカード自身を sourceCardFilter で絞る正準 carrier である。
  // 本文がその発生元を明示するときだけ、コスト境界の照合先に含める。
  const expectedStackSourcePlayer =
    bounds.length === 1
      ? stackSourceRestrictedPlayer(unit.text, bounds[0])
      : null;
  const stackSourceTargets =
    expectedStackSourcePlayer !== null
      ? unit.nodes.flatMap(({ node, path }) =>
          node.kind === "restrict_stack" &&
          node.targetScope === "effect_source" &&
          object(node.sourceCardFilter)
            ? [
                {
                  filter: node.sourceCardFilter,
                  path: path + ".sourceCardFilter",
                  filterPath: path + ".sourceCardFilter",
                  expectedPlayer: expectedStackSourcePlayer,
                  restrictedPlayer: node.player,
                },
              ]
            : []
        )
      : [];
  const onlyAttackerBound =
    bounds.length === 1 && isAttackerCostBound(unit.text, bounds[0]);
  // ライフ減少の発生カードを修飾するコスト句と、同じ effect / textRef 内の
  // 別節（例: 自分のデッキへの効果耐性）の target は別の意味を持つ。
  // attackerFilter がその句の唯一の carrier なので、直接 target を混ぜない。
  // これにより、attackerFilter 自体から minCost を落とした壊れた定義も
  // target_cost_bound_mismatch として確実に検知する。
  let targets = onlyAttackerBound
    ? attackerTargets
    : [
        ...directTargets,
        ...negateCardTargets,
        ...deckRevealTargets,
        ...triggerSubjects,
        ...triggerSourceSubjects,
        ...attackerTargets,
        ...stackSourceTargets,
      ];
  // 「コストN以下のスピリットカード/ネクサスカードの召喚/配置を無効にする」型は、
  // summon と place が別の negate action なので、同じ一つの本文境界を二つの
  // targetFilter が分担する。種別と上限の両方が本文の直結カテゴリ句を完全被覆する
  // 場合だけ受理し、片枝の境界欠落・別種別・追加枝は scope review として残す。
  const hasOnlySplitSummonPlaceNegateTargets =
    bounds.length === 1 &&
    targets.length === 2 &&
    targets.filter(({ negateTarget }) => negateTarget === "summon").length ===
      1 &&
    targets.filter(({ negateTarget }) => negateTarget === "place").length === 1;
  const splitSummonPlaceNegateTargets = hasOnlySplitSummonPlaceNegateTargets
    ? filterOrBranchesMatchingDirectCostBound(
        { filterOr: targets.map(({ filter }) => filter) },
        bounds[0],
        unit.text
      )
    : null;
  if (splitSummonPlaceNegateTargets) {
    const bound = bounds[0];
    const certain =
      !unit.uncertain &&
      !/つき|合計|上限|変更|増や|加算/.test(unit.text) &&
      (unit.node.steps?.length ?? 1) === 1;
    for (const { branch, index } of splitSummonPlaceNegateTargets) {
      const { filterPath, negateTarget } = targets[index];
      // 「スピリットカード/ネクサスカード1枚の召喚/配置を無効にする」は、
      // category の和集合だけでなく、召喚=スピリット、配置=ネクサスの action
      // ごとの対応も本文の一部である。両 action の filter を入れ替えると実際に
      // 無効化できる対象が変わるため、共有 union として沈黙して受理してはならない。
      const expectedCategory = negateTarget === "summon" ? "spirit" : "nexus";
      if (!sameDistinctMembers(branch.category, [expectedCategory]))
        emit(
          "target_cost_scope_review",
          `${filterPath}.category`,
          "召喚/配置の対象種別が本文の action 対応と一致しない",
          `本文=${bound.text}; ${negateTarget} 期待=category:${expectedCategory}; 実値=${display(branch.category)}`,
          "review"
        );
      for (const [key, expected] of Object.entries(bound.values)) {
        if (branch[key] !== expected)
          emit(
            "target_cost_bound_mismatch",
            `${filterPath}.${key}`,
            "本文のコスト境界が対象filterに一致しない",
            `本文=${bound.text}; 期待=${key}:${expected}; 実値=${display(branch)}`,
            certain ? "violation" : "review"
          );
      }
      if (bound.basis === "printed" && branch.costBasis !== "printed")
        emit(
          "target_cost_basis_mismatch",
          `${filterPath}.costBasis`,
          "本来のコストを実効/追加コストで判定している",
          `本文=${bound.text}; 期待=costBasis:printed; 実値=${display(branch.costBasis ?? "effective_or_additional")}`,
          certain ? "violation" : "review"
        );
      if (
        bound.basis === "effective_or_additional" &&
        branch.costBasis === "printed"
      )
        emit(
          "target_cost_basis_mismatch",
          `${filterPath}.costBasis`,
          "通常のコスト条件を印字だけへ限定している",
          `本文=${bound.text}; 期待=effective_or_additional; 実値=printed（印字が範囲外・追加コストが範囲内の対象を除く）`,
          "review"
        );
    }
    return;
  }
  // 1つの deck_reveal にコスト条件を伴わない pick も混在できる。本文の単一
  // コスト境界に対しては、境界を明示した pick が一意ならその pick を照合する。
  // 境界の欠落や複数候補は review のまま残し、沈黙して通さない。
  if (bounds.length === 1 && !hasOnlySplitSummonPlaceNegateTargets) {
    const explicitlyBound = targets.filter(({ filter }) =>
      ["minCost", "maxCost", "costBasis"].some(
        (key) => filter[key] !== undefined
      )
    );
    if (explicitlyBound.length === 1) targets = explicitlyBound;
  }
  // 共有 textRef の継続効果が持つ通常 target は、同じ文中の「〜が召喚された
  // とき」という兄弟 game_event の主体を表さない。現在の target 側に境界が無く、
  // 兄弟 triggerFilter が境界を一意に担うときだけ、継続効果への誤帰属を避ける。
  // sibling の境界を壊せば helper が false となり、ここで review が復活する。
  if (
    targets.length === 1 &&
    !["minCost", "maxCost", "costBasis"].some(
      (key) => targets[0].filter[key] !== undefined
    ) &&
    hasSiblingTriggerSubjectForCostBound(unit, bounds)
  )
    return;
  if (bounds.length !== 1 || targets.length !== 1) {
    // 「この『コスト破壊効果』の上限を+Nする」型は、メタ修飾自身に target
    // を持たない。一方で同一印字文を共有する兄弟 effect に、修飾元となる
    // destroy target の本来コスト境界がある。兄弟の action 種別・costBasis・
    // 境界が全て一致した場合だけ、その carrier を本文の帰属先として認める。
    // これを確認せずに review を消すと、maxCost/costBasis を落とした壊れた
    // destroy effect まで見逃すため、対象なしの場合に限定して照合する。
    if (
      targets.length === 0 &&
      (hasSiblingTargetForReferencedCostEffect(unit, bounds) ||
        hasSiblingSharedImmunityTargetForCostBound(unit, bounds) ||
        hasReferencedCostConditionChangeTarget(unit, bounds))
    )
      return;
    emit(
      "target_cost_scope_review",
      unit.path,
      "本文のコスト条件と対象filterの対応を確定できない",
      `本文=${unit.text}; 期待=${display(bounds)}; 実値=${display(targets.map(({ path, filter }) => ({ path, filter })))}`,
      "review"
    );
    return;
  }
  const bound = bounds[0];
  let {
    filter,
    filterPath,
    path,
    destination,
    expectedPlayer,
    restrictedPlayer,
  } = targets[0];
  if (
    expectedPlayer !== undefined &&
    expectedPlayer !== null &&
    restrictedPlayer !== expectedPlayer
  ) {
    emit(
      "target_cost_scope_review",
      path.replace(/\.sourceCardFilter$/, ".player"),
      "スタックタイミング元を制限するプレイヤーが本文に一致しない",
      `本文=${bound.text}; 期待=restrict_stack.player:${expectedPlayer}; 実値=${display(restrictedPlayer)}`,
      "review"
    );
    return;
  }
  if (
    destination !== undefined &&
    destination !== "field" &&
    boundBelongsToFreeFieldEntry(unit.text, bound)
  ) {
    emit(
      "target_cost_scope_review",
      `${path}.destination`,
      "コスト条件付きの無償召喚/配置がfield entryのpickに対応していない",
      `本文=${bound.text}; 期待=destination:field; 実値=${display(destination)}`,
      "review"
    );
    return;
  }
  let filters = [{ filter, filterPath }];
  if (filter.filterOr?.length) {
    // CardFilter.filterOr は直接の min/max 等を無視する。ただし、コスト句の直後に
    // 対象カテゴリが明記され、その集合と一致する1枝、または各カテゴリを尽くす
    // 1カテゴリ枝の和集合なら、その全枝が正準 carrier である。曖昧な OR は
    // 従来どおり review に残す。
    const matchingBranches = filterOrBranchesMatchingDirectCostBound(
      filter,
      bound,
      unit.text
    );
    if (!matchingBranches) {
      emit(
        "target_cost_scope_review",
        filterPath,
        "OR分岐のコスト条件を本文と照合する必要がある",
        `本文=${bound.text}; 期待=${display(bound)}; 実値=${display(filter)}`,
        "review"
      );
      return;
    }
    filters = matchingBranches.map(({ branch, index }) => ({
      filter: branch,
      filterPath: `${filterPath}.filterOr[${index}]`,
    }));
  }
  const dynamic =
    filters.some(
      ({ filter: candidate }) => candidate.maxCostSource !== undefined
    ) ||
    unit.nodes.some(
      ({ node: candidate }) => candidate.kind === "effect_param_modify"
    ) ||
    /つき|合計|上限|変更|増や|加算/.test(unit.text);
  const certain =
    !unit.uncertain &&
    !dynamic &&
    filters.every(({ filter: candidate }) => !candidate.exclude) &&
    !/とき|なら|場合|いる|ある/.test(unit.text) &&
    (unit.node.steps?.length ?? 1) === 1;
  for (const { filter: candidate, filterPath: candidatePath } of filters) {
    for (const [key, expected] of Object.entries(bound.values)) {
      if (candidate[key] !== expected)
        emit(
          "target_cost_bound_mismatch",
          `${candidatePath}.${key}`,
          "本文のコスト境界が対象filterに一致しない",
          `本文=${bound.text}; 期待=${key}:${expected}; 実値=${display(candidate)}`,
          certain ? "violation" : "review"
        );
    }
    if (
      bound.basis === "both" &&
      !hasPrintedIntersection(candidate, bound.values)
    )
      emit(
        "target_cost_basis_mismatch",
        candidatePath,
        "本来のコストを含む範囲条件の印字AND実効を確認できない",
        `本文=${bound.text}; 期待=印字AND実効の各基準で${display(bound.values)}; 実値=${display(candidate)}; costBasisの省略はeffective_or_additional、printed単独も両基準ANDではない`,
        "review"
      );
    if (bound.basis === "printed" && candidate.costBasis !== "printed")
      emit(
        "target_cost_basis_mismatch",
        `${candidatePath}.costBasis`,
        "本来のコストを実効/追加コストで判定している",
        `本文=${bound.text}; 期待=costBasis:printed; 実値=${display(candidate.costBasis ?? "effective_or_additional")}`,
        certain ? "violation" : "review"
      );
    if (
      bound.basis === "effective_or_additional" &&
      candidate.costBasis === "printed"
    )
      emit(
        "target_cost_basis_mismatch",
        `${candidatePath}.costBasis`,
        "通常のコスト条件を印字だけへ限定している",
        `本文=${bound.text}; 期待=effective_or_additional; 実値=printed（印字が範囲外・追加コストが範囲内の対象を除く）`,
        "review"
      );
  }
}

/**
 * `inheritedUsageLimits` is a carrier-level usage restriction that owns the
 * supplied Effect container rather than an individual Effect node.  For
 * example, DivineSkillEntry.turnLimit limits every effect in that one divine
 * skill.  Nested granted effects remain an independent scope and intentionally
 * do not inherit this context.
 */
export function findConstraintFidelityIssues(effect, textLines, options = {}) {
  const rootInheritedLimits = Array.isArray(options.inheritedUsageLimits)
    ? options.inheritedUsageLimits.filter(object)
    : [];
  const rootSiblingEffects = Array.isArray(options.siblingEffects)
    ? options.siblingEffects.filter(object)
    : [];
  const rootReferencedEffects = Array.isArray(options.referencedEffects)
    ? options.referencedEffects.filter(object)
    : [];
  const rootContainerEffects = Array.isArray(options.containerEffects)
    ? options.containerEffects.filter(object)
    : [];
  const issues = [];
  const seen = new Set();
  const emit = (kind, path, message, evidence, severity) => {
    const id = `${kind}:${path}:${evidence}`;
    if (seen.has(id)) return;
    seen.add(id);
    issues.push({ kind, path, message, evidence, severity });
  };
  const visitedEffects = new Set();
  function analyze(
    current,
    path,
    inheritedText = "",
    inheritedLimits = rootInheritedLimits,
    mappedText = "",
    inheritedGrantTarget = null
  ) {
    if (!object(current) || current.stub || visitedEffects.has(current)) return;
    visitedEffects.add(current);
    const { nodes, nested } = collectScope(current, path);
    const ownText = normalize(effectBodyText(textLines, current.textRef));
    const scopedText = normalize(mappedText);
    const text = ownText || scopedText || inheritedText;
    // `grant_effect` などの内側 Effect が自身の textRef を持つ場合、その文は親の
    // 使用制限ではなく内側の起動/誘発効果に属する。親が独自または carrier 由来の
    // usageLimit を持たないときだけ、内側が明示的に所有する部分文を親 scope から
    // 除く。これにより「対象は、このターン中に1回…できる」型を親の制限欠落と
    // 誤認せず、内側の usageLimit 欠落は内側 path で引き続き検出する。
    const delegatedNestedTexts = [
      ...(usageAt(current, path).length === 0 && inheritedLimits.length === 0
        ? nested
            .map(({ effect: nestedEffect }) => ({
              text: normalize(effectBodyText(textLines, nestedEffect.textRef)),
              ownsDistinctText:
                Array.isArray(nestedEffect.textRef) &&
                JSON.stringify(nestedEffect.textRef) !==
                  JSON.stringify(current.textRef),
            }))
            .filter(
              ({ text: nestedText, ownsDistinctText }) =>
                ownsDistinctText &&
                nestedText.length > 0 &&
                nestedText.length <= text.length &&
                text.includes(nestedText)
            )
            .map(({ text: nestedText }) => nestedText)
        : []),
      // step.prompt.sourceText が内側 Effect の本文を直接指定するときは、親に
      // usageLimit があってもその引用句を親の期待制限へ混ぜない。textRef だけの
      // 委譲と違い、nested Effect との参照同一性を collectScope で確認済み。
      ...nested
        .map(({ mappedText: childMappedText }) => normalize(childMappedText))
        .filter(
          (nestedText) =>
            nestedText.length > 0 &&
            nestedText.length <= text.length &&
            text.includes(nestedText)
        ),
    ];
    for (const entry of nodes) {
      for (const [min, max] of RANGE_PAIRS) {
        if (
          !finite(entry.node[min]) ||
          !finite(entry.node[max]) ||
          entry.node[min] <= entry.node[max]
        )
          continue;
        const conditional = [entry.node, ...entry.parents].some(
          (node) =>
            node?.not === true || node?.kind === "not" || node?.filterOr?.length
        );
        emit(
          "constraint_empty_range",
          entry.path,
          "静的な下限が上限を超えている",
          `期待=${min}<=${max}; 実値=${min}:${entry.node[min]},${max}:${entry.node[max]}; 本文=${text || "textRefなし"}`,
          conditional ? "review" : "violation"
        );
      }
    }
    const mappedSteps = [];
    let remainingText = text;
    // 同じ本文を共有する別 Effect が sourceText で文節を明示所有している場合、
    // その節は current の期待制約には含めない。carrier を消すとここでは除外されず、
    // 引き続き review として残る。
    for (const siblingText of new Set(
      siblingOwnedSourceTexts(current, rootSiblingEffects, text)
    ))
      remainingText = remainingText.replace(siblingText, "");
    for (const nestedText of new Set(delegatedNestedTexts))
      remainingText = remainingText.replace(nestedText, "");
    for (const entry of nodes.filter(
      ({ node }) =>
        object(node.action) &&
        node.prompt?.sourceText &&
        // grant_effect の prompt は内側 Effect の本文を指定する carrier であり、
        // 親 step 自身の usageLimit を表すものではない。親stepを別unitとして
        // 検査すると、継承した外側制限を内側本文へ誤対応付けしてしまう。
        !nested.some(
          ({ effect: nestedEffect, mappedText: childMappedText }) =>
            node.action?.grantedEffect === nestedEffect &&
            typeof childMappedText === "string" &&
            childMappedText.length > 0
        )
    )) {
      const stepText = normalize(entry.node.prompt.sourceText);
      if (!stepText || !text.includes(stepText)) continue;
      mappedSteps.push({ ...entry, text: stepText });
      remainingText = remainingText.replace(stepText, "");
    }
    const rootNodes = nodes.filter(
      (entry) =>
        !mappedSteps.some(
          (step) =>
            entry.path === step.path || entry.path.startsWith(`${step.path}.`)
        )
    );
    const rootOwnUsage = usageAt(current, path);
    const rootHasAction = rootNodes.some(({ node }) => object(node.action));
    const mapsOnlyParentheticalClause = mappedSteps.some((step) =>
      text.includes(`(${step.text})`)
    );
    // すべてのactionがsourceTextへ対応付け済みなら、残余本文はこのEffectの実行
    // carrierではない。root自身のusageLimitがある場合は、mapped stepの本文でその
    // carrierを実際に満たせるときだけ残余を外す。usageLimit無しでも、sourceText
    // 自身が丸括弧内なら、その注記だけを実行するEffectであり、括弧外の制限は同じ
    // textRefを持つ別Effectのものとして扱う。単なる後段sourceTextでは外さない。
    const rootText =
      rootHasAction ||
      (rootOwnUsage.length > 0 &&
        !mappedUsageScopeCoversOwnUsage(rootOwnUsage, mappedSteps)) ||
      (rootOwnUsage.length === 0 && !mapsOnlyParentheticalClause)
        ? remainingText
        : "";
    // 複数の action が同一 sourceText を共有し、他に未帰属 action がない場合は、
    // それらは一つの本文節を共同で解決する。Effect 親の usageLimit はその節全体を
    // 一度だけ制限するので、各 step に「親の制限が他手順にも及ぶ」review を出さない。
    // sourceText を欠く/異なる文節を持つ step があれば従来どおり review を維持する。
    const mappedStepsShareOneSourceScope =
      mappedSteps.length > 1 &&
      new Set(mappedSteps.map((step) => step.text)).size === 1 &&
      !rootHasAction;
    const units = [
      {
        node: current,
        path,
        nodes: rootNodes,
        text: rootText,
        hasOwnText: ownText.length > 0 || scopedText.length > 0,
        hasNestedEffects: nested.some(
          ({ mappedText: childMappedText }) =>
            normalize(childMappedText).length === 0
        ),
        hasChoiceBranching: rootNodes.some(
          ({ node }) => node.choice || node.choices || node.branches
        ),
        inheritedLimits,
        inheritedLimitsChecked: false,
        siblingEffects: rootSiblingEffects,
        referencedEffects: rootReferencedEffects,
        containerEffects: rootContainerEffects,
        mappedSteps,
        normalActionPermissionEffectIndex:
          path === "$" ? options.normalActionPermissionEffectIndex : undefined,
        hasMappedSteps: mappedSteps.length > 0,
        inheritedGrantTarget:
          ownText.length === 0 && scopedText.length === 0
            ? inheritedGrantTarget
            : null,
        uncertain:
          (!ownText && !scopedText) ||
          nested.some(
            ({ mappedText: childMappedText }) =>
              normalize(childMappedText).length === 0
          ) ||
          rootNodes.some(
            ({ node }) => node.choice || node.choices || node.branches
          ),
      },
      ...mappedSteps.map((step) => ({
        node: step.node,
        path: step.path,
        nodes: nodes.filter(
          (entry) =>
            entry.path === step.path || entry.path.startsWith(`${step.path}.`)
        ),
        text: step.text,
        hasOwnText: ownText.length > 0 || scopedText.length > 0,
        hasNestedEffects: false,
        hasChoiceBranching: false,
        inheritedLimits: [...inheritedLimits, ...usageAt(current, path)],
        inheritedLimitsChecked:
          rootText.length > 0 ||
          mappedUsageScopeCoversOwnUsage(
            [...inheritedLimits, ...usageAt(current, path)],
            mappedSteps
          ),
        siblingEffects: rootSiblingEffects,
        referencedEffects: rootReferencedEffects,
        containerEffects: rootContainerEffects,
        normalActionPermissionEffectIndex:
          path === "$" ? options.normalActionPermissionEffectIndex : undefined,
        inheritedScopeBroader:
          (current.steps?.length ?? 0) > 1 && !mappedStepsShareOneSourceScope,
        uncertain: !ownText && !scopedText,
      })),
    ];
    for (const unit of units) {
      if (!unit.text) continue;
      checkUsage(unit, emit);
      checkQuantifiedEffectRepeats(unit, emit);
      const allCostBounds = parseCostBounds(unit.text);
      checkPayments(unit, emit, allCostBounds);
      const targetBounds = checkSourceEffectCost(unit, emit, allCostBounds);
      checkTargetCost(unit, emit, targetBounds);
    }
    for (const child of nested)
      analyze(
        child.effect,
        child.path,
        text,
        [],
        child.mappedText,
        child.inheritedGrantTarget
      );
  }
  analyze(effect, "$");
  return issues;
}
