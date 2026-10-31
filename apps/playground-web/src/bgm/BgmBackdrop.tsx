import { useEffect, useRef, useState } from "react";
import { useBgm } from "./BgmContext";
import {
  computeBackgroundPosition,
  getFaceBox,
  type FaceBox,
} from "./image-focus";

interface Props {
  /** ブラー強度 (px)。タイトル画面では 0、それ以外は 2 等を指定。 */
  blur?: number;
  /** 暗色オーバーレイの不透明度 (0-1)。0.4 推奨。 */
  overlayOpacity?: number;
}

interface Layer {
  url: string;
  key: number;
  face: FaceBox | null;
  natural: { w: number; h: number } | null;
}

const FADE_MS = 1400;
const DEFAULT_POSITION = "50% 50%";

/**
 * 現在作品のスライドショー画像を fixed 全画面背景として描画する。
 * 画像切替時は新レイヤを上に追加してフェードイン、完了後に旧レイヤを削除する。
 * ゲーム画面ではこのコンポーネントを置かない (背景なし)。
 *
 * 顔バウンディングボックス (image-focus.ts) がある画像は、`cover` 後に
 * 顔全体が画面内に収まるよう background-position を動的算出する。
 * 中央 50%/50% を理想とし、必要分だけシフトする。
 */
export function BgmBackdrop({ blur = 0, overlayOpacity = 0 }: Props) {
  const { currentImage } = useBgm();
  const [layers, setLayers] = useState<Layer[]>([]);
  const [lastImage, setLastImage] = useState<string | null>(null);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window === "undefined" ? 1920 : window.innerWidth,
    h: typeof window === "undefined" ? 1080 : window.innerHeight,
  }));

  // viewport 変化 (回転・リサイズ) を追跡し、background-position を再計算。
  useEffect(() => {
    const onResize = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  // currentImage が変わったら新レイヤを push。
  // 自然サイズは Image() を先読みして得る (一度ロード済なら同期的に取れる)。
  if (currentImage !== lastImage) {
    setLastImage(currentImage);
    if (currentImage) {
      setLayers((prev) => {
        const last = prev[prev.length - 1];
        if (last?.url === currentImage) return prev;
        const next: Layer[] = [
          ...prev,
          {
            url: currentImage,
            key: Date.now(),
            face: getFaceBox(currentImage),
            natural: null,
          },
        ];
        return next.slice(-2);
      });
    }
  }

  // 自然サイズロード (新規レイヤぶんだけ非同期で取得)
  const naturalCache = useRef<Map<string, { w: number; h: number }>>(new Map());
  useEffect(() => {
    for (const layer of layers) {
      if (layer.natural || !layer.url) continue;
      const cached = naturalCache.current.get(layer.url);
      if (cached) {
        setLayers((ls) =>
          ls.map((l) => (l.url === layer.url ? { ...l, natural: cached } : l))
        );
        continue;
      }
      const img = new Image();
      img.onload = () => {
        const dim = { w: img.naturalWidth, h: img.naturalHeight };
        naturalCache.current.set(layer.url, dim);
        setLayers((ls) =>
          ls.map((l) => (l.url === layer.url ? { ...l, natural: dim } : l))
        );
      };
      img.src = layer.url;
    }
  }, [layers]);

  // フェード完了後に古いレイヤを掃除。
  useEffect(() => {
    if (layers.length <= 1) return;
    const t = setTimeout(() => {
      setLayers((l) => l.slice(-1));
    }, FADE_MS + 100);
    return () => clearTimeout(t);
  }, [layers]);

  if (layers.length === 0) return null;

  const baseStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: -1,
    backgroundSize: "cover",
    backgroundRepeat: "no-repeat",
    pointerEvents: "none",
    willChange: "opacity",
  };

  return (
    <>
      {layers.map((l, i) => {
        const isTopLayer = i === layers.length - 1;
        const isFadingIn = layers.length > 1 && isTopLayer;
        const position =
          l.face && l.natural
            ? computeBackgroundPosition(viewport, l.natural, l.face)
            : DEFAULT_POSITION;
        return (
          <div
            key={l.key}
            aria-hidden
            data-testid={isTopLayer ? "bgm-backdrop" : undefined}
            data-bgpos={position}
            style={{
              ...baseStyle,
              backgroundImage: `url("${l.url}")`,
              backgroundPosition: position,
              animation: isFadingIn
                ? `bgm-bg-fade-in ${FADE_MS}ms ease forwards`
                : "none",
            }}
          />
        );
      })}
      {/* 背景画像は拡大せず、暗幕越しにぼかす。画面端の透けと遷移時の位置ずれを防ぐ。 */}
      {(blur > 0 || overlayOpacity > 0) && (
        <div
          aria-hidden
          style={{
            position: "fixed",
            inset: 0,
            zIndex: -1,
            background: `rgba(0,0,0,${overlayOpacity})`,
            backdropFilter: blur > 0 ? `blur(${blur}px)` : "none",
            WebkitBackdropFilter: blur > 0 ? `blur(${blur}px)` : "none",
            pointerEvents: "none",
          }}
        />
      )}
    </>
  );
}
