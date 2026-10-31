import { createGrabbedCoreMove } from "../coreSelectionFacade";
import { useLayoutEffect, useMemo, useState, useRef } from "react";
import type { NormalCoreContainer } from "@orica/rules-core";
import type { CoreSelectionHudProps } from "../components/CoreSelectionHud";
import type {
  HeldCoreEntry,
  UseCoreSelectionApi,
} from "../coreSelectionFacade";
import {
  coreContainerTapId,
  getPendingCoreSourceRemaining,
  type PendingCoreHud,
} from "../utils/core-hud-pending";

export function usePendingCoreHud(
  pending: PendingCoreHud | null,
  selection: UseCoreSelectionApi,
  dispatch: (choice: ReturnType<PendingCoreHud["confirm"]>) => void,
  resetKey?: unknown
) {
  const [soulChoiceSource, setSoulChoiceSource] = useState<string | null>(null);
  const [declinedSoulSources, setDeclinedSoulSources] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const previousKey = useRef<string | null>(null);
  const previousResetKey = useRef(resetKey);
  useLayoutEffect(() => {
    if (
      previousKey.current === (pending?.key ?? null) &&
      previousResetKey.current === resetKey
    )
      return;
    if (pending) {
      selection.end();
      selection.start("card_cost");
    } else if (previousKey.current) selection.end();
    previousKey.current = pending?.key ?? null;
    previousResetKey.current = resetKey;
    setSoulChoiceSource(null);
    setDeclinedSoulSources(new Set());
  }, [pending, selection, resetKey]);

  const placed = useMemo(
    () =>
      pending
        ? selection.draftMoves.filter((d) => d.purpose === "card_cost")
        : [],
    [pending, selection.draftMoves]
  );
  const cores: HeldCoreEntry[] = [
    ...placed.flatMap((d) =>
      Array.from({ length: d.kind === "normal" ? d.amount : 1 }, () => ({
        kind: d.kind,
        from: d.from,
        ...(d.kind === "soul" ? { playerId: d.playerId } : {}),
      }))
    ),
    ...(pending ? selection.heldCores : []),
  ];
  const destination =
    pending?.destination ?? (placed[0]?.to as NormalCoreContainer | undefined);
  const requiresPlace = !!pending?.destinations && !pending.destination;
  const choosingDestination = requiresPlace && selection.phase === 2;
  const valid =
    !!pending &&
    cores.length >= pending.min &&
    cores.length <= pending.max &&
    (!requiresPlace || selection.heldCores.length === 0);
  const sourceRemaining = (id: string, kind: "normal" | "soul") =>
    kind === "soul" && declinedSoulSources.has(id)
      ? 0
      : getPendingCoreSourceRemaining(pending, cores, id, kind);
  const targetIds = new Set<string>();
  if (pending && !soulChoiceSource) {
    if (choosingDestination) {
      if (selection.heldCores.length > 0)
        for (const dest of pending.destinations ?? [])
          targetIds.add(coreContainerTapId(dest));
    } else if (cores.length < pending.max) {
      for (const src of pending.sources)
        if (
          sourceRemaining(src.id, "normal") > 0 ||
          sourceRemaining(src.id, "soul") > 0
        )
          targetIds.add(src.id);
    }
  }
  const place = (entry: HeldCoreEntry, to: NormalCoreContainer) =>
    selection.addMove(createGrabbedCoreMove(entry, to, "card_cost"));
  const selectCore = (id: string, kind: "normal" | "soul") => {
    if (
      !pending ||
      cores.length >= pending.max ||
      sourceRemaining(id, kind) <= 0
    )
      return;
    const src = pending.sources.find((s) => s.id === id)!;
    const entry: HeldCoreEntry = {
      kind,
      from: src.from,
      playerId: pending.action.actingPlayerId,
    };
    if (pending.destination) place(entry, pending.destination);
    else selection.addHeldCore(entry);
  };
  const answerSoulChoice = (kind: "normal" | "soul") => {
    if (!soulChoiceSource) return;
    if (kind === "normal")
      setDeclinedSoulSources((previous) =>
        new Set(previous).add(soulChoiceSource)
      );
    selectCore(soulChoiceSource, kind);
    setSoulChoiceSource(null);
  };
  const tap = (id: string) => {
    if (!pending || !targetIds.has(id)) return;
    if (choosingDestination) {
      const to = pending.destinations!.find(
        (d) => coreContainerTapId(d) === id
      )!;
      if (pending.distribute) {
        const core = selection.heldCores[0];
        if (core) {
          place(core, to);
          selection.removeHeldCore(0);
        }
      } else {
        for (const core of selection.heldCores) place(core, to);
        for (let i = selection.heldCores.length - 1; i >= 0; i--)
          selection.removeHeldCore(i);
      }
      return;
    }
    const normal = sourceRemaining(id, "normal");
    const soul = sourceRemaining(id, "soul");
    if (
      pending.chooseSoul &&
      normal > 0 &&
      soul > 0 &&
      !declinedSoulSources.has(id)
    ) {
      setSoulChoiceSource(id);
      return;
    }
    // 種類を選ばない数選択は従来どおり通常優先。片方しか残らない場合も確認不要。
    selectCore(id, soul > 0 && normal <= 0 ? "soul" : "normal");
  };
  const reset = () => {
    selection.resetPhase("card_cost");
    setSoulChoiceSource(null);
    setDeclinedSoulSources(new Set());
  };
  const submit = () => {
    if (!pending || !valid) return;
    dispatch(
      pending.confirm(
        cores,
        destination,
        pending.distribute ? placed : undefined
      )
    );
  };
  const props: CoreSelectionHudProps | null = pending
    ? {
        mode: pending.payment
          ? "card_cost"
          : choosingDestination
            ? "core_move_fixed"
            : "core_source_allocation",
        phase: choosingDestination ? 2 : 1,
        n: cores.length,
        m: choosingDestination ? selection.heldCores.length : pending.max,
        a: cores.filter((c) => c.kind === "normal").length,
        b: cores.filter((c) => c.kind === "soul").length,
        subTitle:
          pending.title +
          (pending.min !== pending.max
            ? "（" + pending.min + "〜" + pending.max + "個）"
            : ""),
        primary:
          requiresPlace && selection.phase === 1
            ? {
                label: "コアを置く",
                variant: "ok",
                disabled: cores.length < pending.min,
                onClick: () => selection.enterPlacePhase(),
              }
            : {
                label:
                  pending.confirmLabel ?? (pending.payment ? "支払う" : "確定"),
                variant: "ok",
                disabled: !valid,
                onClick: submit,
              },
        onReset: reset,
        ...(soulChoiceSource
          ? {
              soulConfirmation: {
                message: pending.payment
                  ? "ソウルコアをコストに含みますか？"
                  : "ソウルコアを含みますか？",
                onYes: () => answerSoulChoice("soul"),
                onNo: () => answerSoulChoice("normal"),
                onReset: reset,
              },
            }
          : {}),
        extraActions: [
          ...(pending.decline
            ? [
                {
                  label: pending.decline.label,
                  variant: "cancel" as const,
                  onClick: () =>
                    dispatch({
                      action: pending.action,
                      payload: pending.decline!.payload,
                    }),
                },
              ]
            : []),
        ],
      }
    : null;
  return { props, targetIds, tap };
}
