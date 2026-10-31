/**
 * タイトル背景画像の顔バウンディングボックス + 目位置メタデータ。
 *
 * 値は画像座標 0..1 で正規化。
 * - cx, cy: 顔の中心
 * - size: 顔のおおよその直径 (正規化基準は画像の長辺)
 * - eyes (任意): 主顔の各目の中心。指定無き場合は前向き顔と仮定し
 *   `(cx ± 0.20·faceLong, cy − 0.10·faceLong)` から自動生成。
 * - secondaryEyes (任意): 複数キャラ画像の追加の目位置。画面内に収められる時だけ制約に足す。
 *
 * BgmBackdrop はこれを使って `background-position` を動的算出する。
 * - フォーカルポイントは中央 (50%,50%) を理想とする
 * - 顔全体 + 両者の目 → 両者の目 → 主顔全体 + 主顔の目 → 主顔の目、の順に優先
 * - 複数キャラ画像の追加目位置は、目の周囲に顔径の 25% の余白を付けて採用
 * - 上記を満たす範囲で 50% に最も近い位置にシフト
 *
 * 2026-09-11: ローカル全46枚を目視監査。横顔・傾いた顔・複数人物は目座標を明示。
 * shinreibyou/38716068_p0.jpg は顔のない風景なので中央表示。
 * エントリ無し or 顔ナシ画像 (e.g. 風景) は中央のまま。
 */
export interface FaceBox {
  cx: number;
  cy: number;
  size: number;
  /** 任意の明示的な目座標 (image-normalized 0..1)。1 点 (横顔) または 2 点 (両目)。背面など目が見えない場合は空配列。 */
  eyes?: ReadonlyArray<readonly [number, number]>;
  /** 複数キャラ画像の追加目座標。主顔の目と同時に収められる時に採用する。 */
  secondaryEyes?: ReadonlyArray<readonly [number, number]>;
}

/** Key: `<work>/<filename without extension>`; originals and WebP share framing. */
export const IMAGE_FACE_BOXES: Record<string, FaceBox> = {
  "bunkachou/31067277_p0": {
    cx: 0.37,
    cy: 0.32,
    size: 0.13,
  },
  "bunkachou/62762432_p0": {
    cx: 0.33,
    cy: 0.13,
    size: 0.06,
  },
  "chireiden/12490103_p0": {
    cx: 0.6,
    cy: 0.245,
    size: 0.12,
    eyes: [
      [0.57, 0.215],
      [0.61, 0.24],
    ],
  },
  "chireiden/43893825_p0_master1200": {
    cx: 0.69,
    cy: 0.28,
    size: 0.13,
    eyes: [
      [0.67, 0.24],
      [0.725, 0.25],
    ],
  },
  "chireiden/81558284_p0": {
    cx: 0.63,
    cy: 0.29,
    size: 0.16,
    eyes: [
      [0.58, 0.219],
      [0.657, 0.294],
    ],
  },
  "eiyashou/50353643_p5": {
    cx: 0.65,
    cy: 0.27,
    size: 0.13,
  },
  "eiyashou/62264491_p0": {
    cx: 0.4,
    cy: 0.26,
    size: 0.14,
    eyes: [
      [0.387, 0.229],
      [0.354, 0.279],
    ],
  },
  "eiyashou/63000601_p0": {
    cx: 0.5,
    cy: 0.24,
    size: 0.13,
    eyes: [
      [0.455, 0.2],
      [0.53, 0.19],
    ],
  },
  "hisouten/28342536_p0_master1200": {
    cx: 0.5,
    cy: 0.3,
    size: 0.12,
    eyes: [
      [0.47, 0.29],
      [0.535, 0.28],
    ],
  },
  "hisouten/32282320_p0": {
    cx: 0.5,
    cy: 0.13,
    size: 0.05,
  },
  "hisouten/49755794_p0_master1200": {
    cx: 0.54,
    cy: 0.275,
    size: 0.14,
    eyes: [[0.548, 0.251]],
  },
  "hisouten/66a2b2a617dd9de6846805b1c412fd31": {
    cx: 0.66,
    cy: 0.28,
    size: 0.13,
  },
  "huujinnroku/17ece6bb1b32dbd9ef05358705755289": {
    cx: 0.255,
    cy: 0.205,
    size: 0.14,
    eyes: [
      [0.228, 0.19],
      [0.297, 0.162],
    ],
  },
  "huujinnroku/59280317_p0_master1200": {
    cx: 0.56,
    cy: 0.35,
    size: 0.14,
    eyes: [
      [0.537, 0.332],
      [0.574, 0.335],
    ],
  },
  "huujinnroku/be822656-595e-464b-b3c5-80bee977040c": {
    cx: 0.428,
    cy: 0.353,
    size: 0.038,
    eyes: [[0.434, 0.346]],
  },
  "kaeiduka/37523603_p0_master1200": {
    cx: 0.5,
    cy: 0.3,
    size: 0.13,
  },
  "kaeiduka/42046542_p0": {
    cx: 0.56,
    cy: 0.307,
    size: 0.105,
    eyes: [
      [0.544, 0.303],
      [0.577, 0.271],
    ],
  },
  "kaeiduka/75887724_p0": {
    cx: 0.52,
    cy: 0.24,
    size: 0.17,
    eyes: [
      [0.485, 0.21],
      [0.54, 0.19],
    ],
    secondaryEyes: [
      [0.727, 0.315],
      [0.756, 0.336],
    ],
  },
  // 紺珠伝: 2026-09-23 に4枚を目視確認。傾いた顔・横顔は目位置を明示。
  "kanjuden/60684541_p1": {
    cx: 0.641,
    cy: 0.839,
    size: 0.13,
    eyes: [
      [0.663, 0.818],
      [0.619, 0.859],
    ],
  },
  "kanjuden/84807906_p0": {
    cx: 0.59,
    cy: 0.28,
    size: 0.075,
    eyes: [
      [0.57, 0.266],
      [0.592, 0.263],
    ],
    // 霊夢を主顔とし、画面に収まる場合は早苗・鈴仙・魔理沙の目も含める。
    secondaryEyes: [
      [0.425, 0.109],
      [0.447, 0.107],
      [0.221, 0.306],
      [0.775, 0.502],
    ],
  },
  "kanjuden/98988172_p0": {
    cx: 0.502,
    cy: 0.267,
    size: 0.14,
    eyes: [
      [0.445, 0.256],
      [0.555, 0.245],
    ],
  },
  "kanjuden/thumb-1920-703788": {
    cx: 0.357,
    cy: 0.452,
    size: 0.05,
    eyes: [
      [0.35, 0.453],
      [0.364, 0.439],
    ],
  },
  "kishinjou/40487399_p0_restored": {
    cx: 0.73,
    cy: 0.6,
    size: 0.115,
    eyes: [
      [0.708, 0.623],
      [0.751, 0.568],
    ],
    secondaryEyes: [
      [0.849, 0.145],
      [0.884, 0.159],
    ],
  },
  "kishinjou/43342740_p0": {
    cx: 0.48,
    cy: 0.3,
    size: 0.085,
    eyes: [
      [0.45, 0.286],
      [0.51, 0.262],
    ],
    secondaryEyes: [
      [0.152, 0.358],
      [0.205, 0.343],
      [0.88, 0.32],
      [0.915, 0.342],
    ],
  },
  "kishinjou/48507999_p0": {
    cx: 0.18,
    cy: 0.6,
    size: 0.045,
    eyes: [],
  },
  "koumakyo/41382219_p0 (1)": {
    cx: 0.44,
    cy: 0.22,
    size: 0.12,
  },
  "koumakyo/65857378_p0_master1200": {
    cx: 0.66,
    cy: 0.29,
    size: 0.14,
  },
  "koumakyo/68911666_p0_master1200": {
    cx: 0.51,
    cy: 0.33,
    size: 0.13,
  },
  "kubunshiki/63471622_p0": {
    cx: 0.49,
    cy: 0.175,
    size: 0.1,
    eyes: [
      [0.46, 0.158],
      [0.526, 0.132],
    ],
  },
  "seirensen/34577007_p0": {
    cx: 0.922,
    cy: 0.32,
    size: 0.045,
    eyes: [
      [0.91, 0.3],
      [0.927, 0.3],
    ],
  },
  "seirensen/54089405_p0": {
    cx: 0.49,
    cy: 0.32,
    size: 0.14,
    eyes: [
      [0.44, 0.294],
      [0.545, 0.303],
    ],
  },
  "seirensen/60684150_p1": {
    cx: 0.78,
    cy: 0.19,
    size: 0.1,
    eyes: [
      [0.765, 0.16],
      [0.795, 0.173],
    ],
  },
  "shinkirou/v0r5o75mi2b21": {
    cx: 0.47,
    cy: 0.23,
    size: 0.085,
    eyes: [
      [0.43, 0.216],
      [0.495, 0.2],
    ],
  },
  "shinreibyou/24443524_p0": {
    cx: 0.45,
    cy: 0.3,
    size: 0.2,
  },
  "shinreibyou/58328150_p0": {
    cx: 0.55,
    cy: 0.3,
    size: 0.1,
    eyes: [
      [0.522, 0.281],
      [0.578, 0.287],
    ],
  },
  "tenkuushou/66408700_p0_master1200": {
    cx: 0.52,
    cy: 0.37,
    size: 0.15,
    eyes: [
      [0.48, 0.37],
      [0.55, 0.34],
    ],
  },
  "tenkuushou/66408700_p1_master1200": {
    cx: 0.78,
    cy: 0.29,
    size: 0.19,
    eyes: [
      [0.745, 0.277],
      [0.8, 0.25],
    ],
    secondaryEyes: [
      [0.18, 0.258],
      [0.25, 0.203],
    ],
  },
  "tenkuushou/87868184_p0": {
    cx: 0.58,
    cy: 0.38,
    size: 0.11,
    eyes: [
      [0.55, 0.36],
      [0.6, 0.35],
    ],
  },
  "youseidaisensou/2013-02-21-559578": {
    cx: 0.49,
    cy: 0.33,
    size: 0.13,
    eyes: [
      [0.43, 0.303],
      [0.541, 0.313],
    ],
  },
  "youseidaisensou/28919349_p0": {
    cx: 0.47,
    cy: 0.56,
    size: 0.14,
  },
  "youseidaisensou/64751942_p0_master1200": {
    cx: 0.24,
    cy: 0.32,
    size: 0.22,
    eyes: [
      [0.18, 0.3],
      [0.27, 0.32],
    ],
  },
  "youyoumu/__yakumo_yukari_touhou_drawn_by_stari__sample-bfcaac7c2b3392154b2485f8ab1bc754":
    {
      cx: 0.5,
      cy: 0.285,
      size: 0.11,
      eyes: [
        [0.46, 0.276],
        [0.54, 0.282],
      ],
    },
  "youyoumu/33026830_p0": {
    cx: 0.73,
    cy: 0.3,
    size: 0.13,
    secondaryEyes: [
      [0.208, 0.215],
      [0.232, 0.22],
    ],
  },
  "youyoumu/33686836_p0_master1200": {
    cx: 0.685,
    cy: 0.335,
    size: 0.1,
    eyes: [[0.689, 0.313]],
  },
  "youyoumu/35666868_p0_master1200": {
    cx: 0.285,
    cy: 0.29,
    size: 0.11,
    eyes: [
      [0.29, 0.27],
      [0.33, 0.255],
    ],
  },
  "youyoumu/58250973_p0_master1200": {
    cx: 0.435,
    cy: 0.29,
    size: 0.14,
    eyes: [
      [0.4, 0.263],
      [0.467, 0.279],
    ],
  },
  "youyoumu/72199641_p0_master1200": {
    cx: 0.45,
    cy: 0.15,
    size: 0.13,
    eyes: [
      [0.44, 0.12],
      [0.485, 0.17],
    ],
  },
  "youyoumu/Kirisame.Marisa.full.1423406": {
    cx: 0.6,
    cy: 0.37,
    size: 0.12,
    eyes: [
      [0.56, 0.35],
      [0.64, 0.34],
    ],
  },
  "yumetagaekagakuseiki/50262912_p0": {
    cx: 0.5,
    cy: 0.26,
    size: 0.12,
    eyes: [
      [0.465, 0.245],
      [0.537, 0.238],
    ],
    secondaryEyes: [
      [0.54, 0.625],
      [0.598, 0.637],
    ],
  },
  "yumetagaekagakuseiki/61269686_p0": {
    cx: 0.43,
    cy: 0.48,
    size: 0.1,
    eyes: [[0.428, 0.479]],
  },
  "yumetagaekagakuseiki/78166169_p0": {
    cx: 0.62,
    cy: 0.55,
    size: 0.12,
    eyes: [
      [0.603, 0.536],
      [0.65, 0.545],
    ],
  },
};

/**
 * 画像 URL (`/images/title/<work>/<file>` 形式) から face box を引く。
 * URL は encodeURIComponent されているので decode してから lookup する。
 */
export function getFaceBox(imageUrl: string): FaceBox | null {
  const m = imageUrl.match(/\/images\/title\/([^?#]+)$/);
  if (!m) return null;
  const key = decodeURIComponent(m[1]!).replace(/\.(?:png|jpe?g|webp)$/i, "");
  return IMAGE_FACE_BOXES[key] ?? null;
}

/** 顔の cx,cy,size から「正面顔・両目」を仮定して目位置を導出する。 */
function deriveDefaultEyes(
  face: FaceBox,
  image: { w: number; h: number }
): Array<[number, number]> {
  const longEdge = Math.max(image.w, image.h);
  const offsetXNorm = (0.2 * face.size * longEdge) / image.w;
  const offsetYNorm = (0.1 * face.size * longEdge) / image.h;
  return [
    [face.cx - offsetXNorm, face.cy - offsetYNorm],
    [face.cx + offsetXNorm, face.cy - offsetYNorm],
  ];
}

/** [min, max] (% units) 制約。範囲 `[-Infinity, +Infinity]` は無制約。 */
interface Range {
  min: number;
  max: number;
}

function intersect(a: Range, b: Range): Range {
  return { min: Math.max(a.min, b.min), max: Math.min(a.max, b.max) };
}

/**
 * `background-size: cover` 時に face box が画面内に min_in_view 割合以上収まり、
 * かつ主顔の全ての目が viewport 内 (顔サイズに応じた目の余白込み) に収まるよう、中央 (50%, 50%) を基準に
 * できる限り近い `background-position` を返す。secondaryEyes は同時に満たせる時だけ採用する。
 *
 * 顔制約と目制約が同時に満たせない場合は目制約を優先する (顔は多少切れても可)。
 *
 * @param viewport ブラウザの可視ピクセル数
 * @param image    画像の natural サイズ (pixel)
 * @param face     顔バウンディングボックス (0..1 正規化)
 * @param minInView 顔のうち最低でも画面内に収めたい割合 (0..1)。既定は 1 (顔全体)。
 */
export function computeBackgroundPosition(
  viewport: { w: number; h: number },
  image: { w: number; h: number },
  face: FaceBox,
  minInView = 1
): string {
  const scale = Math.max(viewport.w / image.w, viewport.h / image.h);
  const scaledW = image.w * scale;
  const scaledH = image.h * scale;
  const overflowW = scaledW - viewport.w;
  const overflowH = scaledH - viewport.h;

  // 顔半径と「画面内に収めたい量」
  const faceLong = face.size * Math.max(image.w, image.h) * scale;
  const faceR = faceLong / 2;
  const allowOutside = faceR * (1 - minInView) * 2;
  const requiredFaceMargin = Math.max(0, faceR - allowOutside);

  // 顔中心制約: face center が viewport から requiredFaceMargin 内側
  function faceRange(
    pScaled: number,
    viewportDim: number,
    overflowDim: number
  ): Range {
    if (overflowDim <= 0) return { min: 50, max: 50 };
    const minPct =
      ((pScaled - (viewportDim - requiredFaceMargin)) / overflowDim) * 100;
    const maxPct = ((pScaled - requiredFaceMargin) / overflowDim) * 100;
    return { min: minPct, max: maxPct };
  }

  // 目制約: eye point が viewport 内
  // 目の中心だけでなく周囲も残す。最低 2px は出力丸めの誤差を吸収する。
  const EYE_MARGIN_PX = Math.max(2, faceLong * 0.25);
  function eyeRange(
    pScaled: number,
    viewportDim: number,
    overflowDim: number
  ): Range {
    if (overflowDim <= 0) return { min: 50, max: 50 };
    const minPct =
      ((pScaled - (viewportDim - EYE_MARGIN_PX)) / overflowDim) * 100;
    const maxPct = ((pScaled - EYE_MARGIN_PX) / overflowDim) * 100;
    return { min: minPct, max: maxPct };
  }

  const primaryEyesNorm = face.eyes ?? deriveDefaultEyes(face, image);

  // X/Y 軸: 顔中心 + 主顔の目レンジを交差。secondaryEyes は best-effort。
  const faceCx = face.cx * scaledW;
  const faceCy = face.cy * scaledH;
  const xRange = faceRange(faceCx, viewport.w, overflowW);
  const yRange = faceRange(faceCy, viewport.h, overflowH);

  function eyeRanges(points: ReadonlyArray<readonly [number, number]>): {
    x: Range;
    y: Range;
  } {
    let x: Range = { min: -Infinity, max: +Infinity };
    let y: Range = { min: -Infinity, max: +Infinity };
    for (const [ex, ey] of points) {
      x = intersect(x, eyeRange(ex * scaledW, viewport.w, overflowW));
      y = intersect(y, eyeRange(ey * scaledH, viewport.h, overflowH));
    }
    return { x, y };
  }

  const primaryEyeRange = eyeRanges(primaryEyesNorm);
  const secondaryEyeRange =
    face.secondaryEyes !== undefined ? eyeRanges(face.secondaryEyes) : null;

  function chooseRange(
    faceRange: Range,
    primaryRange: Range,
    secondaryRange: Range | null
  ): Range {
    const primaryCombined = intersect(faceRange, primaryRange);
    const withSecondary =
      secondaryRange === null
        ? primaryCombined
        : intersect(primaryCombined, secondaryRange);
    if (withSecondary.min <= withSecondary.max) return withSecondary;
    // 顔全体が収まらなくても、両者の目と余白が収まるならそちらを優先する。
    const allEyes =
      secondaryRange === null
        ? primaryRange
        : intersect(primaryRange, secondaryRange);
    if (secondaryRange !== null && allEyes.min <= allEyes.max) return allEyes;
    // 複数キャラの目も同時に入らない時は、主顔制約まで戻す。
    if (primaryCombined.min <= primaryCombined.max) return primaryCombined;
    // 顔+主目で交差不能なら主目制約のみ採用 (顔は多少切れても可)。
    return primaryRange;
  }

  const xFinal = chooseRange(
    xRange,
    primaryEyeRange.x,
    secondaryEyeRange?.x ?? null
  );
  const yFinal = chooseRange(
    yRange,
    primaryEyeRange.y,
    secondaryEyeRange?.y ?? null
  );

  function clamp(range: Range): number {
    if (range.min > range.max) {
      // 目だけでも交差不能 → 中点
      return Math.max(0, Math.min(100, (range.min + range.max) / 2));
    }
    return Math.max(
      0,
      Math.min(100, Math.max(range.min, Math.min(range.max, 50)))
    );
  }

  const xPct = clamp(xFinal);
  const yPct = clamp(yFinal);
  return `${xPct.toFixed(1)}% ${yPct.toFixed(1)}%`;
}
