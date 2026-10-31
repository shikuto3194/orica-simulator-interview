import type { ReactNode } from "react";
import {
  SoulCoreConfirmation,
  type SoulCoreConfirmationProps,
} from "./SoulCoreConfirmation";
import { TargetFooterActions, TargetToast } from "./TargetSelectionController";
import type { TargetActionButton } from "./TargetSelectionController";
import {
  formatHudHeading,
  type HudInputs,
  type HudMode,
  type HudPhase,
} from "../coreSelectionVerbs";

/**
 * Core Selection HUD — 「掴む → 置く」2 phase 統一コンポーネント。
 *
 * 仕様正源: `manual/ai-reference/25_gui/11_core-selection-hud.md`
 *
 * 上部フロート要素 `{ <動作文> n / <希望文> m  - 通常 a ソウル b - }` と
 * 主ボタン / キャンセル / リセットの 3 ボタンを統一レンダリングする。
 *
 * 配置位置: `.battle-center` 内 (TargetToast / TargetFooterActions と同位置)。
 * 既存の散在 UI (pendingCostPayment / pendingPlacement / pendingCoreShoot 等) を
 * 段階的に本コンポーネントへ集約する (Step 3 で BattleScreen から差し替え)。
 */

export interface CoreSelectionHudProps {
  /** 表示モード (HUD 論理モード)。 */
  readonly mode: HudMode;
  /** 1=grab phase / 2=place phase。1-phase mode は 1 を渡す。 */
  readonly phase: HudPhase;
  /** 現在掴んでいる / 置いている合計 = a + b */
  readonly n: number;
  /** 必要数 / 下限 / 上限 */
  readonly m: number;
  /** 通常コア数 */
  readonly a: number;
  /** ソウルコア数 */
  readonly b: number;
  /**
   * カードや効果のサブタイトル (任意)。例: "凶界神イデア コスト支払い"。
   * 主文と並列に表示し、文脈を補足する。
   */
  readonly subTitle?: string | undefined;
  /**
   * 主ボタン (label / disabled / onClick)。仕様のボタン規則に従って caller が決める:
   * - card_cost: "支払う"
   * - shoot: "確定"
   * - 2-phase phase 1: "コアを置く" (→ phase 2 へ遷移)
   * - 2-phase phase 2 / 1-phase placement 系: "完了"
   */
  readonly primary: TargetActionButton;
  /**
   * キャンセル onClick。仕様: 1-phase / 2-phase いずれも全体 abort を実行する。
   * `core_distribute(even)` / `life_damage_interception` のように abort 経路が
   * 未実装のモードでは `undefined` を渡してボタン非表示にできる。
   */
  readonly onCancel?: (() => void) | undefined;
  /**
   * リセット onClick (常設)。同 phase 内の draft 数値を初期化する。
   * card_cost → placement 遷移後は placement draft のみクリア (caller 側で実装)。
   */
  readonly onReset: () => void;
  /**
   * 主ボタンの外に追加で並べたい補助ボタン (任意)。例: "ソウル配置先を選ぶ" 等。
   * 主ボタンとリセット・キャンセルの間に挿入される。
   */
  readonly extraActions?: ReadonlyArray<TargetActionButton>;
  /** 移動元の通常/ソウルを決める間は、通常召喚と同じ確認を表示する。 */
  readonly soulConfirmation?: SoulCoreConfirmationProps;
}

/**
 * 仕様: フッター順は [主ボタン, ...extraActions, リセット, キャンセル]。
 */
function buildActions(props: CoreSelectionHudProps): TargetActionButton[] {
  const actions: TargetActionButton[] = [props.primary];
  if (props.extraActions && props.extraActions.length > 0) {
    actions.push(...props.extraActions);
  }
  actions.push({
    label: "リセット",
    variant: "warn",
    onClick: props.onReset,
  });
  if (props.onCancel) {
    actions.push({
      label: "キャンセル",
      variant: "cancel",
      onClick: props.onCancel,
    });
  }
  return actions;
}

export function CoreSelectionHud(props: CoreSelectionHudProps): ReactNode {
  if (props.soulConfirmation)
    return <SoulCoreConfirmation {...props.soulConfirmation} />;
  const inputs: HudInputs = {
    mode: props.mode,
    phase: props.phase,
    n: props.n,
    m: props.m,
    a: props.a,
    b: props.b,
  };
  const heading = formatHudHeading(inputs);
  const title = props.subTitle ? `${props.subTitle} — ${heading}` : heading;
  // 「通常 / ソウル」のラベル文字をコア画像に差し替えて表示する。
  // 文字版は `formatHudCoreCounts` に残してあり、テスト/ログ用途で利用可能。
  const counts = (
    <span className="ac-toast-core-counts">
      <img
        className="ac-toast-core-icon"
        src="/images/ForGUI/core.png"
        alt="通常"
      />
      <span className="ac-toast-core-num">{props.a}</span>
      <img
        className="ac-toast-core-icon ac-toast-core-icon-soul"
        src="/images/ForGUI/soul-core.png"
        alt="ソウル"
      />
      <span className="ac-toast-core-num">{props.b}</span>
    </span>
  );
  return (
    <>
      <TargetToast title={title} subText={counts} />
      <TargetFooterActions actions={buildActions(props)} />
    </>
  );
}
