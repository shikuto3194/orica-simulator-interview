import { describe, expect, it } from "vitest";
import { computeBackgroundPosition, getFaceBox } from "../src/bgm/image-focus";

describe("image-focus title backdrop metadata", () => {
  it("keeps identical framing after converting original images to WebP", () => {
    for (const source of [
      "youyoumu/Kirisame.Marisa.full.1423406.jpg",
      "kishinjou/40487399_p0_restored.png",
      "tenkuushou/66408700_p1_master1200.jpg",
    ]) {
      const original = getFaceBox(`/images/title/${source}`);
      expect(original).not.toBeNull();
      expect(
        getFaceBox(`/images/title/${source.replace(/\.[^.]+$/, ".webp")}`)
      ).toEqual(original);
    }
  });
  // 元画像で確認した目の位置。登録値が帽子や背景を指す退行も検出する。
  it.each([
    [
      "seirensen/54089405_p0.jpg",
      714,
      1000,
      [
        [0.44, 0.294],
        [0.545, 0.303],
      ],
    ],
    [
      "kaeiduka/42046542_p0.jpg",
      1180,
      1299,
      [
        [0.544, 0.303],
        [0.577, 0.271],
      ],
    ],
    [
      "huujinnroku/be822656-595e-464b-b3c5-80bee977040c.png",
      1055,
      1491,
      [[0.434, 0.346]],
    ],
    [
      "youyoumu/Kirisame.Marisa.full.1423406.jpg",
      1240,
      1753,
      [
        [0.56, 0.35],
        [0.64, 0.34],
      ],
    ],
    [
      "tenkuushou/66408700_p1_master1200.jpg",
      1200,
      1157,
      [
        [0.745, 0.277],
        [0.8, 0.25],
        [0.18, 0.258],
        [0.25, 0.203],
      ],
    ],
    [
      "kishinjou/40487399_p0_restored.png",
      2000,
      1022,
      [
        [0.708, 0.623],
        [0.751, 0.568],
        [0.849, 0.145],
        [0.884, 0.159],
      ],
    ],
  ] as const)(
    "keeps the actual eyes visible in landscape: %s",
    (key, w, h, eyes) => {
      const face = getFaceBox(`/images/title/${key}`);
      expect(face).not.toBeNull();
      const viewport = { w: 712, h: 356 };
      const [x, y] = computeBackgroundPosition(viewport, { w, h }, face!)
        .split(" ")
        .map((v) => Number.parseFloat(v) / 100);
      const scale = Math.max(viewport.w / w, viewport.h / h);
      for (const [ex, ey] of eyes) {
        const screenX = ex * w * scale - (w * scale - viewport.w) * x!;
        const screenY = ey * h * scale - (h * scale - viewport.h) * y!;
        expect(screenX).toBeGreaterThanOrEqual(4);
        expect(screenX).toBeLessThanOrEqual(viewport.w - 4);
        expect(screenY).toBeGreaterThanOrEqual(4);
        expect(screenY).toBeLessThanOrEqual(viewport.h - 4);
      }
    }
  );

  it("registers face boxes for all 天空璋 title images", () => {
    expect(
      getFaceBox("/images/title/tenkuushou/66408700_p0_master1200.jpg")
    ).not.toBeNull();
    expect(
      getFaceBox("/images/title/tenkuushou/66408700_p1_master1200.jpg")
    ).not.toBeNull();
    expect(
      getFaceBox("/images/title/tenkuushou/87868184_p0.jpg")
    ).not.toBeNull();
  });

  it("keeps the primary face in the two-character 天空璋 image on narrow screens", () => {
    const face = getFaceBox(
      "/images/title/tenkuushou/66408700_p1_master1200.jpg"
    );
    expect(face).not.toBeNull();
    expect(face?.secondaryEyes).toHaveLength(2);

    const position = computeBackgroundPosition(
      { w: 390, h: 844 },
      { w: 1200, h: 1157 },
      face!
    );
    const [x] = position.split(" ").map((v) => Number.parseFloat(v));

    expect(x).toBeGreaterThan(60);
  });
});

const AUDITED_IMAGES = [
  ["koumakyo/41382219_p0 (1).jpg", 746, 1200],
  ["koumakyo/65857378_p0_master1200.jpg", 1200, 868],
  ["koumakyo/68911666_p0_master1200.jpg", 1200, 883],
  ["youyoumu/33026830_p0.jpg", 2000, 1428],
  ["youyoumu/33686836_p0_master1200.jpg", 1200, 849],
  ["youyoumu/35666868_p0_master1200.jpg", 750, 1000],
  ["youyoumu/58250973_p0_master1200.jpg", 636, 900],
  ["youyoumu/72199641_p0_master1200.jpg", 873, 1200],
  ["youyoumu/Kirisame.Marisa.full.1423406.jpg", 1240, 1753],
  [
    "youyoumu/__yakumo_yukari_touhou_drawn_by_stari__sample-bfcaac7c2b3392154b2485f8ab1bc754.jpg",
    850,
    1201,
  ],
  ["eiyashou/50353643_p5.jpg", 1000, 1500],
  ["eiyashou/62264491_p0.jpg", 1106, 1546],
  ["eiyashou/63000601_p0.jpg", 1080, 1465],
  ["kaeiduka/37523603_p0_master1200.jpg", 1200, 960],
  ["kaeiduka/42046542_p0.jpg", 1180, 1299],
  ["kaeiduka/75887724_p0.jpg", 1024, 630],
  ["huujinnroku/17ece6bb1b32dbd9ef05358705755289.jpg", 1660, 1240],
  ["huujinnroku/59280317_p0_master1200.jpg", 1200, 1200],
  ["huujinnroku/be822656-595e-464b-b3c5-80bee977040c.png", 1055, 1491],
  ["hisouten/28342536_p0_master1200.jpg", 952, 1200],
  ["hisouten/32282320_p0.png", 1873, 1095],
  ["hisouten/49755794_p0_master1200.jpg", 849, 1200],
  ["hisouten/66a2b2a617dd9de6846805b1c412fd31.png", 1600, 1504],
  ["chireiden/12490103_p0.jpg", 796, 750],
  ["chireiden/43893825_p0_master1200.jpg", 1000, 717],
  ["chireiden/81558284_p0.png", 1231, 1284],
  ["seirensen/34577007_p0.jpg", 1250, 800],
  ["seirensen/54089405_p0.jpg", 714, 1000],
  ["seirensen/60684150_p1.jpg", 1700, 1000],
  ["youseidaisensou/2013-02-21-559578.jpeg", 900, 1200],
  ["youseidaisensou/28919349_p0.png", 700, 988],
  ["youseidaisensou/64751942_p0_master1200.jpg", 1200, 1200],
  ["shinreibyou/24443524_p0.png", 1000, 940],
  ["shinreibyou/38716068_p0.jpg", 1920, 1080],
  ["shinreibyou/58328150_p0.jpg", 1300, 1733],
  ["shinkirou/v0r5o75mi2b21.jpg", 1286, 2080],
  ["kishinjou/40487399_p0_restored.png", 2000, 1022],
  ["kishinjou/43342740_p0.png", 1200, 1935],
  ["kishinjou/48507999_p0.jpg", 1462, 800],
  ["tenkuushou/66408700_p0_master1200.jpg", 1200, 1157],
  ["tenkuushou/66408700_p1_master1200.jpg", 1200, 1157],
  ["tenkuushou/87868184_p0.jpg", 2000, 1335],
  ["yumetagaekagakuseiki/50262912_p0.jpg", 749, 1000],
  ["yumetagaekagakuseiki/61269686_p0.jpg", 1827, 1000],
  ["yumetagaekagakuseiki/78166169_p0.jpg", 2000, 1202],
  ["kubunshiki/63471622_p0.jpg", 1000, 1347],
] as const;
const VIEWPORTS = [
  { w: 712, h: 356 },
  { w: 844, h: 390 },
  { w: 1280, h: 720 },
  { w: 390, h: 844 },
  { w: 768, h: 1024 },
  { w: 2560, h: 720 },
];

describe("audited title images at responsive sizes", () => {
  it.each(AUDITED_IMAGES)(
    "%s has metadata and keeps primary eyes inside the crop",
    (key, w, h) => {
      const face = getFaceBox(`/images/title/${encodeURIComponent(key)}`);
      if (key === "shinreibyou/38716068_p0.jpg") {
        expect(face).toBeNull(); // 風景画は中央表示
        return;
      }
      expect(face).not.toBeNull();
      const longEdge = Math.max(w, h) * face!.size;
      const eyes = face!.eyes ?? [
        [face!.cx - (0.2 * longEdge) / w, face!.cy - (0.1 * longEdge) / h],
        [face!.cx + (0.2 * longEdge) / w, face!.cy - (0.1 * longEdge) / h],
      ];
      for (const viewport of VIEWPORTS) {
        const position = computeBackgroundPosition(viewport, { w, h }, face!);
        const [x, y] = position
          .split(" ")
          .map((v) => Number.parseFloat(v) / 100);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(1);
        const scale = Math.max(viewport.w / w, viewport.h / h);
        for (const [ex, ey] of eyes) {
          expect(
            ex! * w * scale - (w * scale - viewport.w) * x!
          ).toBeGreaterThanOrEqual(0);
          expect(
            ex! * w * scale - (w * scale - viewport.w) * x!
          ).toBeLessThanOrEqual(viewport.w);
          expect(
            ey! * h * scale - (h * scale - viewport.h) * y!
          ).toBeGreaterThanOrEqual(0);
          expect(
            ey! * h * scale - (h * scale - viewport.h) * y!
          ).toBeLessThanOrEqual(viewport.h);
        }
      }
    }
  );

  it("keeps both characters in the 輝針城 image even on a narrow screen", () => {
    const face = getFaceBox(
      "/images/title/kishinjou/40487399_p0_restored.png"
    )!;
    const viewport = { w: 390, h: 844 };
    const image = { w: 2000, h: 1022 };
    const [x, y] = computeBackgroundPosition(viewport, image, face)
      .split(" ")
      .map((v) => Number.parseFloat(v) / 100);
    const scale = Math.max(viewport.w / image.w, viewport.h / image.h);
    for (const [ex, ey] of [...face.eyes!, ...face.secondaryEyes!]) {
      expect(
        ex * image.w * scale - (image.w * scale - viewport.w) * x!
      ).toBeGreaterThan(4);
      expect(
        ex * image.w * scale - (image.w * scale - viewport.w) * x!
      ).toBeLessThan(viewport.w - 4);
      expect(
        ey * image.h * scale - (image.h * scale - viewport.h) * y!
      ).toBeGreaterThan(4);
      expect(
        ey * image.h * scale - (image.h * scale - viewport.h) * y!
      ).toBeLessThan(viewport.h - 4);
    }
  });
});

describe("face framing constraints", () => {
  it("keeps the full face box by default instead of leaving only the eyes at the edge", () => {
    const face = { cx: 0.5, cy: 0.18, size: 0.16 };
    const [, y] = computeBackgroundPosition(
      { w: 800, h: 400 },
      { w: 800, h: 1200 },
      face
    )
      .split(" ")
      .map((v) => Number.parseFloat(v) / 100);
    const faceTop = face.cy * 1200 - (face.size * 1200) / 2;
    expect(faceTop - 800 * y!).toBeGreaterThanOrEqual(-1);
  });
});
