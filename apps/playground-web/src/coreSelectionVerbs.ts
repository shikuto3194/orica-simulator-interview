/**
 * Core Selection HUD の動詞辞書 + 表示テンプレートビルダー。
 *
 * 仕様正源: `manual/ai-reference/25_gui/11_core-selection-hud.md`
 *
 * 役割:
 * - HUD モード × phase から `<動作文>` / `<希望文>` を返す純粋関数群。
 * - 表示テンプレート `{ <動作文> n / <希望文> m  - 通常 a ソウル b - }` を組み立てる。
 * - 省略規則 (希望文省略 / `n /` 省略) を適用する。
 *
 * React 非依存 (pure module)。テストは `apps/playground-web/test/core-selection-verbs.test.ts`。
 */

/** HUD が扱う論理モード。`coreSelectionFacade` の `DraftCorePurpose` とは別概念で、
 *  単体 vs 複数体 placement、自由 vs 固定 core_move のように UI 表記の分岐単位で定義する。 */
export type HudMode =
  | "card_cost"
  | "shoot"
  | "placement_single"
  | "placement_multi"
  | "separation"
  | "core_move_free"
  | "core_move_fixed"
  | "trash_distribution"
  | "core_distribute_any_self"
  | "count_decrease"
  | "core_split"
  | "core_source_allocation";

/** grab (1) → place (2) の 2 phase。1-phase mode は phase=1 のみ使う。 */
export type HudPhase = 1 | 2;

/** 希望文の種類。`null` は省略 (任意 / 上限下限なし)。 */
export type HudHopeVerb = "残り" | "最低" | "必要" | "上限" | null;

/** HUD 表示状態 (mapper への入力)。 */
export interface HudInputs {
  readonly mode: HudMode;
  readonly phase: HudPhase;
  /** 現在掴んでいる / 置いている合計 = a + b */
  readonly n: number;
  /** 必要数 / 下限 / 上限。希望文省略時は無視される */
  readonly m: number;
  /** 通常コア数 */
  readonly a: number;
  /** ソウルコア数 */
  readonly b: number;
}

/** mapper が返す表示要素 (テンプレート組み立て前の中間構造)。 */
export interface HudLabels {
  readonly actionVerb: string;
  readonly hopeVerb: HudHopeVerb;
  /** `n /` を省略するか (典型: phase 2 place phase で n と m が常に同値) */
  readonly omitN: boolean;
}

/**
 * mode + phase + n + m → 表示要素を返す純粋 mapper。
 * placement_single の希望文は n と m に依存して切り替わる
 * (n<min: "最低 m" / n≥min: 省略)。
 */
export function getHudLabels(input: HudInputs): HudLabels {
  const { mode, phase, n, m } = input;

  switch (mode) {
    case "card_cost":
      // 仕様改訂 (2026-05-06): 固定総コストは「必要 m」で常に固定表示。
      // n / 残り m の両動表示は進捗が読みにくい (n+m=固定 を頭算する必要あり)。
      return { actionVerb: "コストを支払う", hopeVerb: "必要", omitN: false };

    case "shoot":
      // 仕様改訂 (2026-05-06): 固定取得数は「必要 m」で常に固定表示 (card_cost 同様)。
      return {
        actionVerb: "コアを掴む",
        hopeVerb: "必要",
        omitN: false,
      };

    case "placement_single":
      // 単体配置: n が min を満たすまで "最低 m"、満たしたら希望文省略。
      if (n < m) {
        return { actionVerb: "コアを置く", hopeVerb: "最低", omitN: false };
      }
      return { actionVerb: "コアを置く", hopeVerb: null, omitN: false };

    case "placement_multi":
      if (phase === 1) {
        return { actionVerb: "コアを掴む", hopeVerb: "必要", omitN: false };
      }
      return { actionVerb: "コアを置く", hopeVerb: "残り", omitN: true };

    case "separation":
      if (phase === 1) {
        return { actionVerb: "コアを掴む", hopeVerb: "必要", omitN: false };
      }
      return { actionVerb: "コアを置く", hopeVerb: "残り", omitN: true };

    case "core_move_free":
      // 自由 core_move: phase 1 は任意 (希望文省略)、phase 2 は "残り"。
      if (phase === 1) {
        return { actionVerb: "コアを掴む", hopeVerb: null, omitN: false };
      }
      return { actionVerb: "コアを置く", hopeVerb: "残り", omitN: true };

    case "core_move_fixed":
      if (phase === 1) {
        return { actionVerb: "コアを掴む", hopeVerb: "必要", omitN: false };
      }
      return { actionVerb: "コアを置く", hopeVerb: "残り", omitN: true };

    case "trash_distribution":
      // 1-phase mode: trash 全コアが事前確定、UI は place phase のみ。
      return { actionVerb: "コアを置く", hopeVerb: "残り", omitN: true };

    case "core_distribute_any_self":
      if (phase === 1) {
        return { actionVerb: "コアを掴む", hopeVerb: "必要", omitN: false };
      }
      return { actionVerb: "コアを置く", hopeVerb: "残り", omitN: true };

    case "count_decrease":
      return {
        actionVerb: "カウントを掴む",
        hopeVerb: "上限",
        omitN: false,
      };

    case "core_split":
      return {
        actionVerb: "コアを置く",
        hopeVerb: "必要",
        omitN: false,
      };

    case "core_source_allocation":
      return {
        actionVerb: "コアを掴む",
        hopeVerb: "必要",
        omitN: false,
      };
  }
}

/**
 * `{ <動作文> n / <希望文> m  - 通常 a ソウル b - }` の主文部分を生成する。
 * 省略規則:
 * - hopeVerb=null → `/<希望文> m` を全省略 → `<動作文> n`
 * - omitN=true → `n /` を省略 → `<動作文> <希望文> m`
 */
export function formatHudHeading(input: HudInputs): string {
  const labels = getHudLabels(input);
  const { actionVerb, hopeVerb, omitN } = labels;
  const { n, m } = input;

  if (hopeVerb === null) {
    return `${actionVerb} ${n}`;
  }
  if (omitN) {
    return `${actionVerb} ${hopeVerb} ${m}`;
  }
  return `${actionVerb} ${n} / ${hopeVerb} ${m}`;
}

/** 補足部分 `通常 a ソウル b` を生成する。 */
export function formatHudCoreCounts(a: number, b: number): string {
  return `通常 ${a} ソウル ${b}`;
}

/** フロート要素全体のテキスト `{ <主文> - <補足> - }` を生成する。 */
export function formatHudText(input: HudInputs): string {
  const heading = formatHudHeading(input);
  const counts = formatHudCoreCounts(input.a, input.b);
  return `{ ${heading} - ${counts} - }`;
}
