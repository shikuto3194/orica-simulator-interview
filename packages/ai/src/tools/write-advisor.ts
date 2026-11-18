/**
 * write_file / apply_edit 実行前に CLAUDE.md Cross-cutting Rule に反する書き込みを検出する。
 *
 * 設計方針: 「heuristic で warn する」ではなく「明確な signature にだけ throw する」。
 * 偽陽性を出すと LLM がタスクを途中放棄する原因になる。`ORICA_AI_WRITE_ADVISOR_OFF=true`
 * で全部無効化できる (ユーザーが意図的に違反したい場合の脱出ハッチ)。
 *
 * 検出する 4 つの signature:
 *   1. (Item 1) `packages/rules-core/src/effects/types.ts` 系で新規 `kind: "..."`
 *      リテラルを追加 → Cross-cutting Rule「Effect 型に専用フィールド追加禁止」違反候補
 *   2. (Item 2) `manual/ai-reference/20_design/` 配下に <30 行の新規 .md を作る
 *      → reference は 18KB / 250 行が target。短文は issues/ 行き
 *   3. (Item 11) 新規ファイルが <5 行かつ末尾が "TODO" / "required" / "未実装" / "後で"
 *      → 「LLM が途中で投げた」signature。完成させるか別所へ
 *   4. (SSOT) 表示層で「ゾーン三つ組判別 ＋ overrides 構築 ＋ 正源非経由」の表示キー並行
 *      写像を新規追加 → coreContainerDisplayKey() に集約させる。エンジン機構・他レイヤ・
 *      tap 制御フローは scope/co-signal で除外し、必要な分散は阻害しない
 */

const EFFECT_TYPE_PATHS = [
  /^packages[\\/]rules-core[\\/]src[\\/].*[\\/](types|kinds|model)\.ts$/,
  /^packages[\\/]rules-core[\\/]src[\\/]effects[\\/].*\.ts$/,
];

const DESIGN_DIR_RE = /^manual[\\/]ai-reference[\\/]20_design[\\/][^\\/]+\.md$/;

const ABANDONED_TAIL_RE =
  /\b(TODO|FIXME|required|未実装|未対応|未完成|後で|あとで)\s*[.。]?\s*$/i;

// 「discriminant kind の値リテラル」を拾う。`kind: "x"` でも `"kind": "x"` でも
// `'kind': 'x'` でも拾える。型定義内では `kind: "x"` 形式が一般的。
const KIND_LITERAL_RE =
  /(?:["']kind["']|\bkind)\s*:\s*["']([a-z][a-z0-9_-]*)["']/g;

// SSOT guard: 「コア所在ゾーン (reserve/trash/life) → 表示オーバーライドキー」の写像の
// 正源は coreContainerDisplayKey() のみ。ただし *ゾーンを判別するすべて* を禁じると、
// エンジン (rules-core) のコンテナ機構・他レイヤ・tap 制御フロー等「必要な分散」まで
// 阻害してしまう。そこで 3 条件すべてで初めて発火する:
//   (a) playground-web 表示層 scope (正源が属するレイヤ)
//   (b) ゾーン三つ組の判別 (.kind === / case / kind:) を含む
//   (c) overrides 構築の co-signal を含み、かつ正源 coreContainerDisplayKey を経由しない
// (a)〜(c) を満たさない制御フロー・別関心事は対象外。
const SSOT_ZONE_TRIO = ["reserve", "trash", "life"];
const SSOT_DISPLAY_SCOPE = /apps[\\/]playground-web[\\/]src[\\/]/;
const SSOT_ZONE_ALLOW = [
  /coreDisplayOverrides\.ts$/,
  /coreSelectionFacade\.ts$/,
];
function hasZoneTrioDiscrimination(txt: string | undefined): boolean {
  if (!txt) return false;
  return SSOT_ZONE_TRIO.every((z) =>
    new RegExp(
      `(?:\\.kind\\s*===\\s*|\\bcase\\s+|["']kind["']\\s*:\\s*)["']${z}["']`
    ).test(txt)
  );
}
/** ゾーン三つ組判別 ＋ overrides 構築 ＋ 正源非経由 = 表示キーの並行写像 (制御フローは除外)。 */
function isParallelZoneDisplayMapping(txt: string | undefined): boolean {
  if (!txt) return false;
  return (
    hasZoneTrioDiscrimination(txt) &&
    /[Oo]verrides\b/.test(txt) &&
    !/coreContainerDisplayKey/.test(txt)
  );
}

export interface AdvisorInput {
  rel: string;
  content: string;
  /** apply_edit の場合は元のファイル内容、write_file 新規作成の場合は undefined */
  previousContent?: string;
}

export class WriteAdvisorError extends Error {
  constructor(
    message: string,
    public rule: string
  ) {
    super(message);
    this.name = "WriteAdvisorError";
  }
}

/**
 * write_file / apply_edit の content を検査し、Cross-cutting Rule 違反 signature を
 * 検出したら `WriteAdvisorError` を throw する。
 */
export function assertWriteCompliance(
  input: AdvisorInput,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (env.ORICA_AI_WRITE_ADVISOR_OFF === "true") return;
  const { rel, content, previousContent } = input;
  const normRel = rel.replaceAll("\\", "/");

  // 1. Effect 型への kind 追加
  const isEffectFile = EFFECT_TYPE_PATHS.some((re) =>
    re.test(rel.replaceAll("/", "\\"))
  );
  if (isEffectFile) {
    const beforeKinds = new Set<string>();
    if (previousContent !== undefined) {
      for (const m of previousContent.matchAll(KIND_LITERAL_RE)) {
        beforeKinds.add(m[1]!);
      }
    }
    const afterKinds = new Set<string>();
    for (const m of content.matchAll(KIND_LITERAL_RE)) {
      afterKinds.add(m[1]!);
    }
    const added = [...afterKinds].filter((k) => !beforeKinds.has(k));
    if (added.length > 0) {
      throw new WriteAdvisorError(
        `Cross-cutting Rule 違反候補: ${rel} に新規 kind ${added
          .map((k) => `"${k}"`)
          .join(", ")} を追加しようとしている。` +
          `CLAUDE.md「Effect 型への専用フィールド追加は原則禁止」「専用ハンドラを書く前に既存の汎用パイプラインで表現できないか検討する」を再確認。` +
          `既存 action / evaluateCondition / 共通プリミティブで表現できないか先に検討すること。` +
          `本当に追加が必要なら env ORICA_AI_WRITE_ADVISOR_OFF=true で advisor を無効化できる。`,
        "no-new-effect-kind"
      );
    }
  }

  // 2. 20_design/ への短文ドキュメント作成
  if (DESIGN_DIR_RE.test(normRel.replaceAll("/", "\\"))) {
    const isNew = previousContent === undefined;
    const lineCount = content.split(/\r?\n/).length;
    if (isNew && lineCount < 30) {
      throw new WriteAdvisorError(
        `${rel} は manual/ai-reference/20_design/ (reference 配置、target 18KB/250 行) に ${lineCount} 行で作成しようとしている。` +
          `短文 TODO / 設計メモは issues/<ID>.md または issues/<ID>/index.md に書く規約 (CLAUDE.md ドキュメント管理 / 課題管理セクション参照)。` +
          `継続して reference として育てる確証があるなら 30 行以上の構造で書き直すか、env ORICA_AI_WRITE_ADVISOR_OFF=true で無効化。`,
        "no-design-stub"
      );
    }
  }

  // 3. 投げ捨て signature: <5 行かつ末尾が TODO / required 系
  if (previousContent === undefined) {
    const trimmed = content.trim();
    const lineCount = trimmed.split(/\r?\n/).length;
    if (
      lineCount < 5 &&
      trimmed.length > 0 &&
      ABANDONED_TAIL_RE.test(trimmed)
    ) {
      throw new WriteAdvisorError(
        `${rel} は ${lineCount} 行で末尾が TODO / required / 未実装 系の言葉で終わっている。` +
          `「LLM が途中で投げた中間ファイル」の signature。完成させてから書くか、issues/ に書くか、env ORICA_AI_WRITE_ADVISOR_OFF=true で無効化。`,
        "no-abandoned-write"
      );
    }
  }

  // 4. SSOT 違反: コア所在ゾーン→表示オーバーライドキーの「並行写像」を表示層に新規追加
  //    (エンジン機構 / 別レイヤ / tap 制御フロー / 正源経由は対象外 — 必要な分散は阻害しない)
  const winRel = normRel.replaceAll("/", "\\");
  if (
    SSOT_DISPLAY_SCOPE.test(winRel) &&
    !SSOT_ZONE_ALLOW.some((re) => re.test(winRel)) &&
    isParallelZoneDisplayMapping(content) &&
    !isParallelZoneDisplayMapping(previousContent)
  ) {
    throw new WriteAdvisorError(
      `SSOT 違反候補: ${rel} がコア所在→表示キー写像を正源 coreContainerDisplayKey() を介さず独自実装しようとしている (ゾーン三つ組判別 ＋ overrides 構築を検出)。` +
        `apps/playground-web/src/coreDisplayOverrides.ts の coreContainerDisplayKey() を共有 / 拡張すること (CLAUDE.md「同じ列挙の判別・写像を 2 箇所に実装しない」)。` +
        `ゾーン制御フロー等の正当な別実装なら env ORICA_AI_WRITE_ADVISOR_OFF=true で無効化できる。`,
      "no-parallel-zone-mapping"
    );
  }
}
