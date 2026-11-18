/**
 * Extract the source phrase and repetition mode of quantified effect text.
 * This intentionally recognises both Japanese word orders:
 * - 「この効果を X 1につき（追加で）1回発揮…」
 * - 「X 1につき、この効果を（追加で）1回発揮…」
 *
 * Unknown measures remain extracted. Consumers must leave them for review
 * rather than crediting an unrelated repeat carrier.
 */
const DIGITS = "[0-9]+";
// 量化する対象には「つ」「個」だけでなく、カード/ユニットの「枚」「体」等が
// 普通に現れる。本文全体を NFKC 化してから照合するので数字は ASCII でよい。
const UNIT = "(?:つ|個|枚|体|回|種類|色|コア)?";
const CLAUSE_SEPARATOR = "(?:、|,)?";
const EXECUTION = `(?:追加で(?:${DIGITS}回|もう1度)?|${DIGITS}回)`;

const PATTERNS = [
  new RegExp(
    `この効果を${CLAUSE_SEPARATOR}([^、。\\n]{1,80}?)(${DIGITS})${UNIT}につき${CLAUSE_SEPARATOR}(${EXECUTION})発揮(?:できる|する|し)`,
    "g"
  ),
  new RegExp(
    `([^、。\\n]{1,80}?)(${DIGITS})${UNIT}につき${CLAUSE_SEPARATOR}この効果を${CLAUSE_SEPARATOR}(${EXECUTION})発揮(?:できる|する|し)`,
    "g"
  ),
];

// 「X の数まで追加」は基本分に最大 X 回を任意で加える別の語順。
// 未知の X も抽出して consumer に review を残す。回数の上限を普通の
// 強制反復へ縮約しないよう optional を明示する。
const MAXIMUM_ADDITIONAL_PATTERN = new RegExp(
  `この効果を${CLAUSE_SEPARATOR}([^、。\\n]{1,80}?)の数まで${CLAUSE_SEPARATOR}(追加で(?:${DIGITS}回|もう1度)?)発揮(?:できる|する|し)`,
  "g"
);

const normalized = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "");

function executionCount(value) {
  const number = normalized(value).match(/[0-9]+(?=回)/)?.[0];
  return number === undefined ? 1 : Number(number);
}

/**
 * Returns exact source clauses in textual order. `measure` deliberately remains
 * natural language so the detector can require a known DSL source before it
 * considers a carrier correct.
 */
export function extractQuantifiedEffectRepeats(text) {
  // 量化句の全角数字と半角数字を区別しない。返す clause も同じ正規化形にして、
  // verifier の本文対応表と安定に突合できるようにする。
  const source = String(text ?? "").normalize("NFKC");
  const matches = [];
  for (const pattern of PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const execution = match[3];
      matches.push({
        text: match[0],
        index: match.index ?? 0,
        measure: normalized(match[1]).replace(/^、/, ""),
        perMeasure: Number(normalized(match[2])),
        count: executionCount(execution),
        additional: normalized(execution).startsWith("追加で"),
      });
    }
  }
  for (const match of source.matchAll(MAXIMUM_ADDITIONAL_PATTERN)) {
    matches.push({
      text: match[0],
      index: match.index ?? 0,
      measure: normalized(match[1]).replace(/^、/, ""),
      perMeasure: 1,
      count: executionCount(match[2]),
      additional: true,
      optional: true,
    });
  }
  return matches
    .filter(
      (entry, index, all) =>
        all.findIndex(
          (other) => other.index === entry.index && other.text === entry.text
        ) === index
    )
    .sort((left, right) => left.index - right.index);
}

/** Map known dynamic quantities to their DSL carrier; unknown text stays review-only. */
export function quantifiedRepeatMeasureKind(measure) {
  switch (normalized(measure)) {
    case "自分のカウント":
      return "count_value";
    case "このスピリットのブレイヴ":
      return "braves_on_source";
    case "減らしたカウント":
      return "decreased_count";
    default:
      return "unknown";
  }
}
