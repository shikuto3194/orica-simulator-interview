import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { useAuth } from "../AuthContext";
import { AVATARS, avatarFullBodySrc, avatarSrc } from "../avatars";

interface HomeAvatarPickerProps {
  avatarId: string | null | undefined;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}

/** Preview is local. Only 決定 updates the shared profile. */
export function HomeAvatarPicker({
  avatarId,
  editing,
  onEditingChange,
}: HomeAvatarPickerProps) {
  const { updateProfile } = useAuth();
  const savedIndex = Math.max(
    0,
    AVATARS.findIndex((a) => a.id === avatarId)
  );
  const [draftIndex, setDraftIndex] = useState(savedIndex);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selectedIndex = editing ? draftIndex : savedIndex;
  const avatar = AVATARS[selectedIndex]!;
  const railRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const savePending = useRef(false);
  const selectedRef = useRef(selectedIndex);
  const suppressClick = useRef(false);
  const dragRef = useRef<{
    id: number;
    x: number;
    y: number;
    dx: number;
    scrollLeft: number;
    moved: boolean;
    rail: boolean;
  } | null>(null);

  const centerIcon = (index: number) => {
    const rail = railRef.current;
    const button = rail?.children[index] as HTMLElement | undefined;
    if (!rail?.clientWidth || !button) return;
    const railBox = rail.getBoundingClientRect();
    const buttonBox = button.getBoundingClientRect();
    rail.scrollTo({
      left:
        rail.scrollLeft +
        buttonBox.left -
        railBox.left -
        (rail.clientWidth - buttonBox.width) / 2,
      behavior: "instant",
    });
  };

  useLayoutEffect(() => {
    selectedRef.current = selectedIndex;
  }, [selectedIndex]);

  useLayoutEffect(() => {
    if (!pickerOpen || !editing) return;
    const rail = railRef.current!;
    const center = () => centerIcon(selectedRef.current);
    center();
    const observer = new ResizeObserver(center);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [pickerOpen, editing]);

  useLayoutEffect(() => {
    if (editing) stageRef.current?.focus({ preventScroll: true });
  }, [editing]);

  const select = (index: number, center = true) => {
    if (!editing || savePending.current) return;
    const next = Math.max(0, Math.min(AVATARS.length - 1, index));
    selectedRef.current = next;
    setDraftIndex(next);
    setError("");
    if (center) centerIcon(next);
  };

  const nearestIcon = () => {
    const rail = railRef.current;
    if (!rail?.clientWidth) return selectedRef.current;
    const middle = rail.getBoundingClientRect().left + rail.clientWidth / 2;
    let nearest = selectedRef.current;
    let distance = Infinity;
    Array.from(rail.children).forEach((button, index) => {
      const box = button.getBoundingClientRect();
      const delta = Math.abs(box.left + box.width / 2 - middle);
      if (delta < distance) {
        nearest = index;
        distance = delta;
      }
    });
    return nearest;
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>, rail: boolean) => {
    if (
      !editing ||
      saving ||
      event.button !== 0 ||
      (!rail && (event.target as HTMLElement).closest("button"))
    )
      return;
    suppressClick.current = false;
    dragRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dx: 0,
      scrollLeft: railRef.current?.scrollLeft ?? 0,
      moved: false,
      rail,
    };
    if (rail && railRef.current) railRef.current.style.scrollSnapType = "none";
  };
  const clearDrag = () => {
    dragRef.current = null;
    if (imageRef.current) imageRef.current.style.transform = "";
    if (railRef.current) railRef.current.style.scrollSnapType = "";
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) > Math.abs(dx) + 8) {
      clearDrag();
      return;
    }
    if (Math.abs(dx) > 6) {
      drag.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    drag.dx = dx;
    if (drag.rail && railRef.current)
      railRef.current.scrollLeft = drag.scrollLeft - dx;
    else if (imageRef.current)
      imageRef.current.style.transform = `translateX(${Math.max(-60, Math.min(60, dx))}px)`;
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    suppressClick.current = drag.moved;
    clearDrag();
    if (drag.rail) {
      if (drag.moved) select(nearestIcon());
    } else if (Math.abs(drag.dx) > 35)
      select(selectedRef.current + (drag.dx < 0 ? 1 : -1));
  };

  const close = () => {
    clearDrag();
    setPickerOpen(false);
    setError("");
    onEditingChange(false);
    editButtonRef.current?.focus({ preventScroll: true });
  };
  const confirm = async () => {
    if (savePending.current) return;
    savePending.current = true;
    setSaving(true);
    setError("");
    try {
      await updateProfile({ avatar_id: AVATARS[selectedRef.current]!.id });
      close();
    } catch (cause) {
      setError(
        `保存に失敗しました: ${cause instanceof Error ? cause.message : String(cause)}`
      );
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  };

  return (
    <figure
      className="home-avatar"
      data-testid="home-avatar"
      aria-busy={saving}
      data-swipe-owner={editing ? "avatar" : undefined}
    >
      <div
        ref={stageRef}
        className={`home-avatar-stage${editing ? " is-editing" : ""}`}
        role="group"
        aria-label={
          editing ? "アバターを左右にスワイプして選択" : "全身アバター"
        }
        tabIndex={editing ? 0 : undefined}
        onPointerDown={(event) => startDrag(event, false)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={clearDrag}
        onKeyDown={(event) => {
          if (editing && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
            event.preventDefault();
            select(selectedIndex + (event.key === "ArrowRight" ? 1 : -1));
          }
        }}
      >
        <img
          ref={imageRef}
          src={avatarFullBodySrc(avatar.id)}
          alt={`${avatar.name}の全身アバター`}
          draggable={false}
          fetchPriority="high"
        />
        {editing && (
          <>
            <button
              type="button"
              className="home-avatar-arrow home-avatar-prev"
              aria-label="前のアバター"
              disabled={saving || selectedIndex === 0}
              onClick={() => select(selectedIndex - 1)}
            >
              ‹
            </button>
            <button
              type="button"
              className="home-avatar-arrow home-avatar-next"
              aria-label="次のアバター"
              disabled={saving || selectedIndex === AVATARS.length - 1}
              onClick={() => select(selectedIndex + 1)}
            >
              ›
            </button>
          </>
        )}
      </div>
      <figcaption>
        <span className="home-epithet">{avatar.epithet}</span>
        <strong aria-live="polite">{avatar.name}</strong>
        {editing && pickerOpen && (
          <div className="home-avatar-picker" id="home-avatar-picker">
            <div className="home-avatar-picker-label">
              <span>スワイプ、またはアイコンで選択</span>
              <span>
                {selectedIndex + 1} / {AVATARS.length}
              </span>
            </div>
            <div
              ref={railRef}
              className="home-avatar-rail"
              aria-label="キャラクター一覧"
              onScroll={() => select(nearestIcon(), false)}
              onPointerDown={(event) => startDrag(event, true)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={clearDrag}
              onKeyDown={(event) => {
                if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
                  event.preventDefault();
                  select(selectedIndex + (event.key === "ArrowRight" ? 1 : -1));
                  (
                    railRef.current?.children[
                      selectedRef.current
                    ] as HTMLElement
                  )?.focus({ preventScroll: true });
                }
              }}
            >
              {AVATARS.map((entry, index) => (
                <button
                  key={entry.id}
                  type="button"
                  className="home-avatar-icon"
                  data-testid={`home-avatar-${entry.id}`}
                  aria-label={`${entry.name}を選択`}
                  aria-pressed={index === selectedIndex}
                  disabled={saving}
                  onClick={(event) => {
                    if (event.detail === 0 || !suppressClick.current)
                      select(index);
                  }}
                >
                  <img src={avatarSrc(entry.id)} alt="" draggable={false} />
                  <span>{entry.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="home-avatar-toolbar">
          <button
            ref={editButtonRef}
            type="button"
            className={editing ? "ui-primary" : ""}
            disabled={saving}
            onClick={() => {
              if (editing) void confirm();
              else {
                setDraftIndex(savedIndex);
                selectedRef.current = savedIndex;
                setPickerOpen(false);
                setError("");
                onEditingChange(true);
              }
            }}
          >
            {saving ? "保存中…" : editing ? "決定" : "アバター変更"}
          </button>
          {editing && (
            <>
              <button
                type="button"
                disabled={saving}
                aria-expanded={pickerOpen}
                aria-controls="home-avatar-picker"
                onClick={() => setPickerOpen(!pickerOpen)}
              >
                キャラを選択
              </button>
              <button
                type="button"
                className="ui-link"
                disabled={saving}
                onClick={close}
              >
                キャンセル
              </button>
            </>
          )}
        </div>
        {error && (
          <p className="home-avatar-error" role="alert">
            {error}
          </p>
        )}
      </figcaption>
    </figure>
  );
}
