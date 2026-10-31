import { useEffect, useRef, useState } from "react";

/** ループ時、2 連結コピーの間に挟むギャップ (px)。period 計算と margin で共有する。 */
const LOOP_GAP_PX = 36;
/** スクロール速度 (px/秒)。 */
const SPEED_PX_PER_SEC = 36;

/**
 * 再生中 BGM (作品名・曲名) の HUD ラベル。
 *
 * 横幅が限られた HUD では従来 `text-overflow: ellipsis` で末尾を「…」に切っており
 * フル曲名が読めなかった。本コンポーネントは内容がビューポート幅を超えるときだけ
 * **左方向への一方向ループ**でスクロールし、収まる短い曲名は静止させる。
 *
 * - 動かすかどうかは実測 (コピー幅 > ビューポート内容幅) で判定。
 * - ループ時はテキストを 2 連結し、1 周ぶん (テキスト幅 + ギャップ) を線形に
 *   流して折り返す → 継ぎ目のないシームレスループ。
 * - `prefers-reduced-motion` 時は CSS 側でアニメーションを無効化 (先頭静止 + title 補完)。
 */
export function BgmMarquee({ label }: { label: string }) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const copyRef = useRef<HTMLSpanElement>(null);
  /** 1 周のスクロール距離 (px)。0 のとき静止。 */
  const [period, setPeriod] = useState(0);

  useEffect(() => {
    const vp = viewportRef.current;
    const copy = copyRef.current;
    if (!vp || !copy) return;
    const measure = () => {
      const style = getComputedStyle(vp);
      const contentWidth =
        vp.clientWidth -
        parseFloat(style.paddingLeft || "0") -
        parseFloat(style.paddingRight || "0");
      const single = copy.offsetWidth;
      // 内容幅に収まるなら静止。超えるぶんだけ一方向ループする。
      setPeriod(single > contentWidth + 0.5 ? single + LOOP_GAP_PX : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    ro.observe(copy);
    return () => ro.disconnect();
  }, [label]);

  const scrolling = period > 0;
  const duration = scrolling ? Math.max(6, period / SPEED_PX_PER_SEC) : 0;

  return (
    <span
      ref={viewportRef}
      className={`hud-bgm${scrolling ? " is-scrolling" : ""}`}
      data-testid="hud-bgm"
      title={label}
    >
      <span
        className="hud-bgm-track"
        style={
          scrolling
            ? ({
                animationDuration: `${duration}s`,
                "--hud-bgm-period": `-${period}px`,
              } as React.CSSProperties)
            : undefined
        }
      >
        <span ref={copyRef} className="hud-bgm-copy">
          ♪{label}
        </span>
        {scrolling && (
          <span
            className="hud-bgm-copy"
            aria-hidden="true"
            style={{ marginLeft: `${LOOP_GAP_PX}px` }}
          >
            ♪{label}
          </span>
        )}
      </span>
    </span>
  );
}
