/**
 * resolution-items: 解決待ち効果の正準データ構造。
 *
 * `state.pendingTriggeredEffects` / `state.battleImmediateEffects` /
 * `state.stackWindow` / `state.preDeclarationStackWindow` を
 * 単一のリストに統合し、各項目に「対応するソースカード候補」を予め解決した
 * 状態で返す。
 *
 * 設計目的:
 *   - 効果解決キュー (UI: EffectQueueOverlay) と前面カードの choice ボタンで
 *     ソースカード情報の出所を一致させる。
 *   - 従来 EffectQueueOverlay は `pte.relatedInstanceId` 直読みのため、
 *     step_transition + applicability=hand 系 (例: パチュリー BSTH01-M01 の
 *     スタートステップ召喚) を取りこぼしていた。本モジュールは
 *     `getAvailableTriggeredEffectSourceChoices` を再利用し、
 *     legal-actions と同じスキャン結果を queue 側にも提供する。
 *
 * UI 表示用のメタ (画像パス先頭の `/`、 timing ラベル、 効果テキスト抽出) は
 * UI 側で行う。本モジュールは「どの state 項目」と「どのカード候補」かの
 * 構造のみを返す。
 */

import type {
  BattleImmediateEffect,
  GameState,
  BattleFlashWindowState,
  StackWindow,
  PendingTriggeredEffect,
  PreDeclarationStackWindow,
} from "../model";
import type { CardDefinition } from "../model";
import type { TriggeredEffectActionRegistrationLookup } from "./trigger-system";
import { getAvailableTriggeredEffectSourceChoices } from "./trigger-system";
import { isTriggeredSourceUsageAvailable } from "./triggered-source-usage";
import { getTriggeredMechanicActivationState } from "./triggered-mechanic-eligibility";

export type ResolutionItemKind =
  | "battle_immediate"
  | "triggered"
  | "stack_battle_flash"
  | "stack"
  | "stack_pre_declaration";

export interface ResolutionSource {
  /** 効果解決主体のカードインスタンス ID */
  instanceId: string;
  /** 効果解決主体のカード定義 ID */
  definitionId: string;
  /**
   * 表示/効果識別に使う印字効果提供元。通常は上の instance/definition と同一のため省略。
   * 合体中ブレイヴや星霊衣のように host が解決主体で、別カードの印字効果を発揮する
   * 場合だけ分離して保持する。
   */
  effectInstanceId?: string;
  effectDefinitionId?: string;
  /** 同一 source の何番目の効果登録か (triggered のみ) */
  registrationIndex?: number;
  /** field / hand / burst / system 等 */
  sourceKind?: string;
}

export type ResolutionItemRef =
  | { kind: "battle_immediate"; effect: BattleImmediateEffect }
  | { kind: "triggered"; pendingEffect: PendingTriggeredEffect }
  | { kind: "stack_battle_flash"; window: BattleFlashWindowState }
  | { kind: "stack"; window: StackWindow }
  | { kind: "stack_pre_declaration"; window: PreDeclarationStackWindow };

export interface ResolutionItem {
  /** UI key 用の安定した識別子 */
  id: string;
  kind: ResolutionItemKind;
  /** 解決の主体プレイヤー */
  actingPlayerId: string;
  /**
   * 解決対象のソースカード候補。
   *   - battle_immediate / stack: 単一 (state 由来で確定済み)
   *   - triggered: 1 件以上 (applicability スキャン結果)
   *   - 解決不能 (life_reduced 等のシステムイベントで対象カード無し): 空配列
   */
  sources: ResolutionSource[];
  /** state 上の元データへの参照 */
  ref: ResolutionItemRef;
  /** 同時誘発グループ ID (triggered のみ) */
  simultaneousGroupId?: string;
}

export interface BuildResolutionItemsOptions {
  state: GameState;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
}

/**
 * state から ResolutionItem[] を構築する。
 *
 * 並び順:
 *   1. battleImmediateEffects (state 配列順)
 *   2. pendingTriggeredEffects (state 配列順)
 *   3. activeAttack.flashWindowState.pendingStackAction (1 件)
 *   4. stackWindow.pendingStackAction (1 件)
 *   5. preDeclarationStackWindow.pendingStackAction (1 件)
 */
export function buildResolutionItems(
  options: BuildResolutionItemsOptions
): ResolutionItem[] {
  const { state } = options;
  const items: ResolutionItem[] = [];

  // 1. battleImmediateEffects: ソースは state 上で確定済み
  for (const effect of state.battleImmediateEffects) {
    items.push({
      id: `bie-${effect.promptId}`,
      kind: "battle_immediate",
      actingPlayerId: effect.actingPlayerId,
      sources: [
        {
          instanceId: effect.sourceInstanceId,
          definitionId: effect.sourceDefinitionId,
          ...(effect.sourceEffectInstanceId !== undefined
            ? { effectInstanceId: effect.sourceEffectInstanceId }
            : {}),
          ...(effect.sourceEffectDefinitionId !== undefined ||
          effect.sourceCardNo !== effect.sourceDefinitionId
            ? {
                effectDefinitionId:
                  effect.sourceEffectDefinitionId ?? effect.sourceCardNo,
              }
            : {}),
          sourceKind: "field",
        },
      ],
      ref: { kind: "battle_immediate", effect },
    });
  }

  // 2. pendingTriggeredEffects: applicability スキャンで候補を解決
  for (const pte of state.pendingTriggeredEffects) {
    const sources: ResolutionSource[] = [];

    // (a) 私的宣言 (declaredFromPrivateZone) で確定したソースのみここで使う。
    //
    //   resolvedSourceInstanceIds は 2 つの意味で使われる:
    //     1. 私的宣言の確定ソース (declaredFromPrivateZone=true): 表示対象
    //     2. multi-responder で既に解決済みの responder: 表示**除外**対象
    //   両者を区別せず resolvedSourceInstanceIds[0] を表示ソースにすると、
    //   1 イベント複数 responder の途中 (例: 紅魔館を解決済み、レミリア本体が残る)
    //   で「解決済みの紅魔館」を誤表示し、残る legal action (レミリア) と source が
    //   食い違って前面カードの操作ボタンが消える。direct-path は (b) のスキャンに委ね、
    //   解決済みを除外した「残りの responder」を出す。
    if (pte.declaredFromPrivateZone && pte.declaredSourceInstanceId) {
      const inst = state.cardInstances.find(
        (c) => c.instanceId === pte.declaredSourceInstanceId
      );
      if (inst) {
        sources.push({
          instanceId: inst.instanceId,
          definitionId: pte.declaredSourceDefinitionId ?? inst.definitionId,
          ...(pte.declaredRegistrationIndex !== undefined
            ? { registrationIndex: pte.declaredRegistrationIndex }
            : {}),
          ...(pte.declaredSourceKind
            ? { sourceKind: pte.declaredSourceKind }
            : {}),
        });
      }
    }

    // (b) 未確定なら applicability スキャンで実トリガ保持カードを検索する。
    //     `relatedInstanceId` (= 誘発原因のカード, 例: 召喚されたスピリット) を
    //     そのまま source 扱いするとカード自身がトリガを持たない場合に誤った
    //     画像で queue が表示される (BSTH01-X04 の召喚で BSTH01-R21 のトリガが
    //     乗ったケース等)。スキャン結果を優先することで実 source = 実画像にする。
    if (sources.length === 0) {
      const choices = getAvailableTriggeredEffectSourceChoices({
        state,
        pendingEffect: pte,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
      });
      for (const choice of choices) {
        if (
          !isTriggeredSourceUsageAvailable({
            state,
            pendingEffect: pte,
            choice,
            getCardDefinitionById: options.getCardDefinitionById,
          })
        )
          continue;
        sources.push({
          instanceId: choice.sourceCard.instanceId,
          definitionId: choice.sourceCard.definitionId,
          ...(choice.sourceEffectInstanceId !== undefined
            ? { effectInstanceId: choice.sourceEffectInstanceId }
            : {}),
          ...(choice.sourceEffectDefinitionId !== undefined
            ? { effectDefinitionId: choice.sourceEffectDefinitionId }
            : {}),
          registrationIndex: choice.registrationIndex,
          sourceKind: choice.sourceKind,
        });
      }
      // 実リスナーが全て使用済みなら、誘発原因カードへの表示フォールバックはしない。
      if (choices.length > 0 && sources.length === 0) continue;
    }

    // (c) 神託等は登録効果のスキャン対象外。機構の発揮元を共通判定から得る。
    // 通常誘発で候補がなければ原因カードへ代替しない。「ただちに」待ちで
    // 条件未達の召喚時は内部で保持し、条件成立後に (b) で表示する。
    if (sources.length === 0 && pte.mechanic) {
      const { sourceCard, sourceDefinition } =
        getTriggeredMechanicActivationState(
          state,
          pte.mechanic,
          options.getCardDefinitionById
        );
      if (sourceCard && sourceDefinition) {
        sources.push({
          instanceId: sourceCard.instanceId,
          definitionId: sourceDefinition.cardNo,
        });
      }
    }

    if (sources.length === 0) {
      continue; // 真にソース不在 (life_reduced 等のシステムイベント)
    }

    const item: ResolutionItem = {
      id: `pte-${pte.pendingId}`,
      kind: "triggered",
      actingPlayerId: pte.actingPlayerId,
      sources,
      ref: { kind: "triggered", pendingEffect: pte },
    };
    if (pte.simultaneousGroupId) {
      item.simultaneousGroupId = pte.simultaneousGroupId;
    }
    items.push(item);
  }

  // 3. activeAttack.flashWindowState.pendingStackAction
  const bfw = state.activeAttack?.flashWindowState;
  if (bfw?.pendingStackAction) {
    const sa = bfw.pendingStackAction;
    items.push({
      id: `bfw-${sa.stackId}`,
      kind: "stack_battle_flash",
      actingPlayerId: sa.actingPlayerId,
      sources: [
        {
          instanceId: sa.cardInstanceId,
          definitionId: sa.cardDefinitionId,
          ...(sa.effectSourceInstanceId !== undefined
            ? { effectInstanceId: sa.effectSourceInstanceId }
            : {}),
          ...(sa.effectSourceDefinitionId !== undefined
            ? { effectDefinitionId: sa.effectSourceDefinitionId }
            : {}),
          sourceKind: sa.actionKind,
        },
      ],
      ref: { kind: "stack_battle_flash", window: bfw },
    });
  }

  // 4. stackWindow.pendingStackAction
  const sw = state.stackWindow;
  if (sw?.pendingStackAction) {
    const sa = sw.pendingStackAction;
    items.push({
      id: `sw-${sa.stackId}`,
      kind: "stack",
      actingPlayerId: sa.actingPlayerId,
      sources: [
        {
          instanceId: sa.cardInstanceId,
          definitionId: sa.cardDefinitionId,
          ...(sa.effectSourceInstanceId !== undefined
            ? { effectInstanceId: sa.effectSourceInstanceId }
            : {}),
          ...(sa.effectSourceDefinitionId !== undefined
            ? { effectDefinitionId: sa.effectSourceDefinitionId }
            : {}),
          sourceKind: sa.actionKind,
        },
      ],
      ref: { kind: "stack", window: sw },
    });
  }

  // 5. preDeclarationStackWindow.pendingStackAction
  const pdsw = state.preDeclarationStackWindow;
  if (pdsw?.pendingStackAction) {
    const sa = pdsw.pendingStackAction;
    items.push({
      id: `pdsw-${sa.stackId}`,
      kind: "stack_pre_declaration",
      actingPlayerId: sa.actingPlayerId,
      sources: [
        {
          instanceId: sa.cardInstanceId,
          definitionId: sa.cardDefinitionId,
          ...(sa.effectSourceInstanceId !== undefined
            ? { effectInstanceId: sa.effectSourceInstanceId }
            : {}),
          ...(sa.effectSourceDefinitionId !== undefined
            ? { effectDefinitionId: sa.effectSourceDefinitionId }
            : {}),
          sourceKind: sa.actionKind,
        },
      ],
      ref: { kind: "stack_pre_declaration", window: pdsw },
    });
  }

  return items;
}
