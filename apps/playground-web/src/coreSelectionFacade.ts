import { useCallback, useMemo, useState } from "react";
import {
  applyDraftCoreMoves,
  type CardDefinition,
  type DraftCoreMove,
  type DraftCorePurpose,
  type GameState,
  type NormalCoreContainer,
  type SoulCoreContainer,
} from "@orica/rules-core";

export type CardDefinitionLookup = (
  definitionId: string
) => CardDefinition | undefined;

/**
 * facade が扱う選択モード。`DraftCorePurpose` と一対一対応する。
 * Phase 2 では `core_move` のみ実利用。Phase 3 で残りを順次有効化する。
 */
export type CoreSelectionMode = DraftCorePurpose;

/**
 * P3-49: 2-phase 「掴む → 置く」UX 用の held buffer エントリ。
 * Phase 1 で `addHeldCore` で蓄積し、Phase 2 で `takeHeldCore` で pop する。
 */
export interface HeldCoreEntry {
  /** 通常コア / ソウルコア の区別 */
  readonly kind: "normal" | "soul";
  /** ソース location。normal は `NormalCoreContainer`、soul は `SoulCoreContainer`。 */
  readonly from: NormalCoreContainer | SoulCoreContainer;
  /**
   * ソウルコア用の所有プレイヤー ID (Phase 2 で `to: SoulCoreContainer` を組み立てる際に使う)。
   * normal kind では不要。
   */
  readonly playerId?: string;
}

/** 2-phase mode の grab(1) / place(2) phase。1-phase mode は常に 1。 */
export type CoreSelectionPhase = 1 | 2;

/* -------- Pure helpers for held buffer (testable without React rendering) -------- */

/**
 * Phase 1 のとき held buffer の末尾に entry を追加した新配列を返す。
 * Phase 2 のときは buffer を変更しない (caller は phase 1 でしか呼ばない契約だが、
 *   spec violation を no-op にする防御策)。
 */
export function addHeldCoreToBuffer(
  buffer: readonly HeldCoreEntry[],
  entry: HeldCoreEntry,
  phase: CoreSelectionPhase
): HeldCoreEntry[] {
  if (phase !== 1) return buffer.slice();
  return [...buffer, entry];
}

/**
 * `index` が範囲内なら index 位置の entry を取り除いた新配列を返す。
 * 範囲外なら現状維持。
 */
export function removeHeldCoreFromBuffer(
  buffer: readonly HeldCoreEntry[],
  index: number
): HeldCoreEntry[] {
  if (index < 0 || index >= buffer.length) return buffer.slice();
  const next = buffer.slice();
  next.splice(index, 1);
  return next;
}

/**
 * Phase 2 で 1 件 pop。`matcher` 指定時はマッチした最初、未指定時は先頭。
 * 戻り値は `popped` (取り出したエントリ or null) と `remaining` (残った buffer)。
 */
export function takeHeldCoreFromBuffer(
  buffer: readonly HeldCoreEntry[],
  matcher?: (e: HeldCoreEntry) => boolean
): { popped: HeldCoreEntry | null; remaining: HeldCoreEntry[] } {
  if (buffer.length === 0) return { popped: null, remaining: buffer.slice() };
  let idx = 0;
  if (matcher) {
    idx = buffer.findIndex(matcher);
    if (idx < 0) return { popped: null, remaining: buffer.slice() };
  }
  const remaining = buffer.slice();
  const [popped] = remaining.splice(idx, 1);
  return { popped: popped ?? null, remaining };
}

export interface UseCoreSelectionApi {
  /** 何らかの選択モードに入っている、または draft が積まれている */
  readonly isActive: boolean;
  /** 現在のモード (start で設定。end でクリア) */
  readonly mode: CoreSelectionMode | null;
  /** 蓄積中の draft 一覧 (読み取り専用) */
  readonly draftMoves: readonly DraftCoreMove[];
  /** `state` に draft を順次適用した projection。draft 空なら `state` 同一参照 */
  readonly previewState: GameState;

  /**
   * P3-49: 2-phase の現在 phase。1-phase mode (card_cost / shoot 等) では常に 1。
   * `enterPlacePhase()` で 2 に遷移、`end()` / `start()` で 1 に戻る。
   */
  readonly phase: CoreSelectionPhase;
  /**
   * P3-49: Phase 1 で掴まれて、まだ Phase 2 で place されていない held buffer。
   * Phase 2 へ遷移後は `takeHeldCore` で pop されると徐々に減る。
   */
  readonly heldCores: readonly HeldCoreEntry[];

  /** 選択モード開始。同じモードを再入する場合は draft を維持する */
  start(
    mode: CoreSelectionMode,
    destinations?: readonly NormalCoreContainer[]
  ): void;
  readonly fixedDestination: NormalCoreContainer | null;
  readonly grabbedCores: readonly HeldCoreEntry[];
  /**
   * mode のみを切り替え、draft はそのまま保持する (stage 跨ぎ用)。
   * 例: 召喚で `card_cost` → `placement` に移る際、card_cost の draft を
   * 削除せずに placement draft を append し、`previewState` がコスト支払い + 配置の
   * 両方を反映できるようにする。
   * `start` と異なり、draft 一覧は purge されない。
   */
  transitionMode(mode: CoreSelectionMode): void;
  /** draft を末尾に追加 */
  addMove(move: DraftCoreMove): void;
  /** index 指定で 1 件削除 */
  removeMove(index: number): void;
  /** 特定 purpose の draft をすべて削除 (stage 戻り用) */
  removeMovesByPurpose(purpose: DraftCorePurpose): void;
  /** draft のみクリア (mode は維持) */
  reset(): void;
  /** mode 終了 + draft 全クリア (キャンセル / 確定後の後始末) */
  end(): void;

  /* -------- P3-49: held buffer / phase API -------- */

  /** Phase 1: held buffer に 1 エントリ append。Phase 2 では何もしない (pre-condition violation)。 */
  addHeldCore(entry: HeldCoreEntry): void;
  /** Phase 1: index 指定で held buffer から 1 件削除 */
  removeHeldCore(index: number): void;
  /**
   * Phase 1 → Phase 2 遷移。「コアを置く」主ボタン用。
   * 現 held buffer を snapshot として保存し、Phase 2 reset 時に復元できるようにする。
   * 既に Phase 2 の場合は no-op。
   */
  enterPlacePhase(): void;
  /**
   * Phase 2: held buffer から 1 件 pop して返す。`matcher` 指定時はマッチした最初の 1 件、
   * 未指定時は先頭。pop 後 caller が `addMove(...)` で対応する DraftCoreMove を生成する。
   * Phase 1 / 空 buffer / 未マッチの場合は `null`。
   */
  takeHeldCore(matcher?: (e: HeldCoreEntry) => boolean): HeldCoreEntry | null;
  /**
   * Phase 2 リセット: 指定 purpose の draft を消去し、held buffer を Phase 1 終了時の
   * snapshot に復元する。Phase 1 の場合は held buffer を空にし、snapshot もクリア。
   */
  resetPhase(purpose: DraftCorePurpose): void;
}

export function computeCoreSelectionPreviewState(
  state: GameState,
  draftMoves: readonly DraftCoreMove[],
  getCardDefinitionById?: CardDefinitionLookup,
  onError?: (error: unknown) => void
): GameState {
  try {
    return applyDraftCoreMoves(state, draftMoves, getCardDefinitionById);
  } catch (e) {
    onError?.(e);
    return state;
  }
}

/**
 * GUI 側のコア配置 draft を一元管理する facade フック。
 *
 * - 純粋に「draft 配列の保持 + projection 計算」のみを担う薄いラッパー。
 *   commit (確定処理) は呼び出し側が `applyLegalAction` または `applyDraftCoreMoves` を
 *   直接呼ぶ。確定後に `end()` を呼んで draft をクリアする運用。
 * - `state` を依存に持つので、対戦相手の操作で state が差し変わると preview も
 *   自動的に再計算される。draft 自体は state を保持しないため、state shape 変化に
 *   対しては既存 primitive (`moveNormalCores` / `moveSoulCore`) のバリデーションが
 *   そのまま走る (preview 計算時に invalid なら例外)。
 */
/** 配置先が実際に1か所なら place 操作を省略する（pending の型名に依存しない）。 */
export function getFixedCoreDestination(
  destinations: readonly NormalCoreContainer[]
): NormalCoreContainer | null {
  const first = destinations[0];
  if (!first) return null;
  return destinations.every(
    (d) =>
      d.kind === first.kind &&
      (d.kind === "card" && first.kind === "card"
        ? d.instanceId === first.instanceId
        : "playerId" in d &&
          "playerId" in first &&
          d.playerId === first.playerId)
  )
    ? first
    : null;
}

export function createGrabbedCoreMove(
  entry: HeldCoreEntry,
  to: NormalCoreContainer,
  purpose: DraftCorePurpose
): DraftCoreMove {
  if (entry.kind === "normal")
    return {
      kind: "normal",
      from: entry.from as NormalCoreContainer,
      to,
      amount: 1,
      purpose,
    };
  if (to.kind === "void") throw new Error("ソウルコアはボイドに置けません");
  return {
    kind: "soul",
    from: entry.from as SoulCoreContainer,
    to,
    playerId: entry.playerId!,
    purpose,
  };
}

export function useCoreSelection(
  state: GameState,
  getCardDefinitionById?: CardDefinitionLookup
): UseCoreSelectionApi {
  const [mode, setMode] = useState<CoreSelectionMode | null>(null);
  const [fixedDestination, setFixedDestination] =
    useState<NormalCoreContainer | null>(null);
  const [draftMoves, setDraftMoves] = useState<DraftCoreMove[]>([]);
  // P3-49: held buffer + phase。phase=1 は grab、2 は place。
  const [heldCores, setHeldCores] = useState<HeldCoreEntry[]>([]);
  const [phase, setPhase] = useState<CoreSelectionPhase>(1);
  // Phase 2 reset 時に Phase 1 終了時 (= enterPlacePhase 呼び出し直前) の held を
  // 復元するための snapshot。Phase 1 では null、enterPlacePhase で確定する。
  const [heldSnapshot, setHeldSnapshot] = useState<HeldCoreEntry[] | null>(
    null
  );

  // 対戦相手の操作で state が差し替わると draft の source container が
  // 無効化される場合がある (例: bob のフラッシュ効果で alice のリザーブから
  // コアが消える)。`applyDraftCoreMoves` 内の primitive validation が throw
  // すると React render が落ちるため、ここで catch して旧 state を返す。
  // 次の useEffect で draft を reset する責務は呼び出し側 (BattleScreen の
  // pending 同期 useEffect) が持つ。
  const previewState = useMemo(() => {
    return computeCoreSelectionPreviewState(
      state,
      draftMoves,
      getCardDefinitionById,
      (e) =>
        console.warn(
          "[coreSelection] applyDraftCoreMoves threw; falling back to state. " +
            "draft may reference invalid container after state replacement.",
          e
        )
    );
  }, [state, draftMoves, getCardDefinitionById]);

  const start = useCallback(
    (
      next: CoreSelectionMode,
      destinations: readonly NormalCoreContainer[] = []
    ) => {
      setFixedDestination(getFixedCoreDestination(destinations));
      setMode((prev) => {
        if (prev === next) return prev;
        // モード切り替え時は draft / held / phase をクリア (異なる purpose の draft が
        // 残ったまま新モードに入ると recompose 不整合の元になる)
        setDraftMoves([]);
        setHeldCores([]);
        setHeldSnapshot(null);
        setPhase(1);
        return next;
      });
    },
    []
  );

  const transitionMode = useCallback((next: CoreSelectionMode) => {
    // draft を保持したまま mode のみ更新 (stage 跨ぎ用)。
    // 既存の card_cost → placement 遷移は 1-phase 同士なので held / phase は触らない。
    setMode(next);
  }, []);

  const addMove = useCallback((move: DraftCoreMove) => {
    setDraftMoves((prev) => [...prev, move]);
  }, []);

  const removeMove = useCallback((index: number) => {
    setDraftMoves((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const next = prev.slice();
      next.splice(index, 1);
      return next;
    });
  }, []);

  const removeMovesByPurpose = useCallback((purpose: DraftCorePurpose) => {
    setDraftMoves((prev) => prev.filter((m) => m.purpose !== purpose));
  }, []);

  const reset = useCallback(() => {
    setDraftMoves([]);
  }, []);

  const end = useCallback(() => {
    setMode(null);
    setFixedDestination(null);
    setDraftMoves([]);
    setHeldCores([]);
    setHeldSnapshot(null);
    setPhase(1);
  }, []);

  /* -------- P3-49: held buffer / phase API -------- */

  const addHeldCore = useCallback(
    (entry: HeldCoreEntry) => {
      if (phase !== 1) return;
      if (fixedDestination && mode) {
        setDraftMoves((prev) => [
          ...prev,
          createGrabbedCoreMove(entry, fixedDestination, mode),
        ]);
      } else setHeldCores((prev) => addHeldCoreToBuffer(prev, entry, phase));
    },
    [phase, fixedDestination, mode]
  );

  const removeHeldCore = useCallback((index: number) => {
    setHeldCores((prev) => removeHeldCoreFromBuffer(prev, index));
  }, []);

  const enterPlacePhase = useCallback(() => {
    if (phase === 2 || fixedDestination) return;
    setHeldSnapshot(heldCores.slice());
    setPhase(2);
  }, [phase, heldCores, fixedDestination]);

  const takeHeldCore = useCallback(
    (matcher?: (e: HeldCoreEntry) => boolean): HeldCoreEntry | null => {
      const { popped, remaining } = takeHeldCoreFromBuffer(heldCores, matcher);
      if (popped) setHeldCores(remaining);
      return popped;
    },
    [heldCores]
  );

  const resetPhase = useCallback(
    (purpose: DraftCorePurpose) => {
      if (phase === 1) {
        // Phase 1 reset: held buffer を空にし、対象 purpose の draft も消去。
        setHeldCores([]);
        setHeldSnapshot(null);
        setDraftMoves((prev) => prev.filter((m) => m.purpose !== purpose));
      } else {
        // Phase 2 reset: 該当 purpose の draft を消去 + held を snapshot から復元。
        setDraftMoves((prev) => prev.filter((m) => m.purpose !== purpose));
        setHeldCores(heldSnapshot ? heldSnapshot.slice() : []);
      }
    },
    [phase, heldSnapshot]
  );

  const grabbedCores = useMemo(
    () => [
      ...heldCores,
      ...draftMoves
        .filter((d) => d.purpose === mode)
        .flatMap((d) =>
          Array.from({ length: d.kind === "normal" ? d.amount : 1 }, () => ({
            kind: d.kind,
            from: d.from,
            ...(d.kind === "soul" ? { playerId: d.playerId } : {}),
          }))
        ),
    ],
    [heldCores, draftMoves, mode]
  );

  const isActive =
    mode !== null || draftMoves.length > 0 || heldCores.length > 0;

  return {
    isActive,
    fixedDestination,
    grabbedCores,
    mode,
    draftMoves,
    previewState,
    phase,
    heldCores,
    start,
    transitionMode,
    addMove,
    removeMove,
    removeMovesByPurpose,
    reset,
    end,
    addHeldCore,
    removeHeldCore,
    enterPlacePhase,
    takeHeldCore,
    resetPhase,
  };
}

/* ---------- 補助コンバータ (BattleScreen の locationId 文字列との橋渡し) ---------- */

/**
 * 既存 GUI コードは container を `"reserve"` または `instanceId` 文字列で扱う。
 * 新 facade では `NormalCoreContainer` を扱うので、両者を変換するヘルパーを提供する。
 * Phase 3 で旧 string 表現が消えれば本ヘルパーも撤去予定。
 */
export function locationIdToNormalContainer(
  locationId: string,
  viewingPlayer: string
): NormalCoreContainer {
  if (locationId === "reserve")
    return { kind: "reserve", playerId: viewingPlayer };
  if (locationId === "trash") return { kind: "trash", playerId: viewingPlayer };
  if (locationId === "life") return { kind: "life", playerId: viewingPlayer };
  if (locationId === "void") return { kind: "void", playerId: viewingPlayer };
  return { kind: "card", instanceId: locationId };
}

export function locationIdToSoulContainer(
  locationId: string,
  viewingPlayer: string
): SoulCoreContainer {
  if (locationId === "reserve")
    return { kind: "reserve", playerId: viewingPlayer };
  if (locationId === "trash") return { kind: "trash", playerId: viewingPlayer };
  if (locationId === "life") return { kind: "life", playerId: viewingPlayer };
  return { kind: "card", instanceId: locationId };
}

/**
 * `NormalCoreContainer` を locationId 文字列に戻す (legacy lookup 用)。
 * P3-47 F-5: trash / life も locationId に往復可能。void は core_move 系では発生
 * しないので null を返す。
 */
export function normalContainerToLocationId(
  container: NormalCoreContainer
): string | null {
  if (container.kind === "reserve") return "reserve";
  if (container.kind === "trash") return "trash";
  if (container.kind === "life") return "life";
  if (container.kind === "void") return "void";
  if (container.kind === "card") return container.instanceId;
  return null;
}
