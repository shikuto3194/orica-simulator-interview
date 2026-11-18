import { describe, expect, it } from "vitest";
import {
  assertPublicBgmAssets,
  assertPublicCardImages,
  isDevelopmentModule,
  isPublicMedia,
  publicBuildPlugin,
} from "../server/public-build";
import { ALL_CARDS } from "../../../packages/card-data/src/generated-index";
import { expandCardDefinitionsWithBackFaces } from "@orica/rules-core";
import { WORKS } from "../src/bgm/works";

describe("public build boundary", () => {
  it("rejects missing or partially restored BGM media instead of publishing an empty title", () => {
    const images = Object.fromEntries(
      WORKS.map((work) => [work.imageDir, ["title.webp"]])
    );
    const music = Object.fromEntries(
      WORKS.map((work) => [work.musicDir, ["title.m4a"]])
    );
    expect(() => assertPublicBgmAssets(images, music)).not.toThrow();
    expect(() => assertPublicBgmAssets({}, {})).toThrow(
      "pnpm fetch-bgm-assets"
    );
    const work = WORKS[0]!;
    expect(() =>
      assertPublicBgmAssets({ ...images, [work.imageDir]: [] }, music)
    ).toThrow(`images/title/${work.imageDir}`);
    expect(() =>
      assertPublicBgmAssets(images, { ...music, [work.musicDir]: [] })
    ).toThrow(`sounds/music/${work.musicDir}`);
  });

  it("fails when a card face is absent from the deployment inventory", () => {
    const images = [
      ...new Set(
        expandCardDefinitionsWithBackFaces(ALL_CARDS).flatMap((card) =>
          card.image ? [card.image] : []
        )
      ),
    ];
    expect(images.every((file) => file.endsWith(".webp"))).toBe(true);
    expect(() => assertPublicCardImages(images)).not.toThrow();
    expect(() => assertPublicCardImages(images.slice(1))).toThrow(images[0]);
  });

  it("retains every card face, runtime GUI media, avatars and registered music", () => {
    for (const card of expandCardDefinitionsWithBackFaces(ALL_CARDS)) {
      if (card.image) expect(isPublicMedia(card.image), card.cardNo).toBe(true);
    }
    for (const file of [
      "images/ForGUI/card-back.jpg",
      "images/ForGUI/core.png",
      "images/avater/satori-icon.png",
      "images/zokuseichi/hi.png",
      "images/title/koumakyo/title.webp",
      "sounds/music/紅魔郷/曲.m4a",
    ])
      expect(isPublicMedia(file), file).toBe(true);
  });

  it("does not copy reference images, originals, unknown folders or unreferenced cards", () => {
    for (const file of [
      "images/reference/board.png",
      "images/avater/satori立ち絵.png",
      "images/avater/fullbody/satori.png",
      "images/ForGUI/draft.png",
      "images/unfinished.png",
      "images/title/experiment/draft.png",
      "images/title/koumakyo/source.psd",
      "images/title/koumakyo/title.jpg",
      "sounds/music/紅魔郷/曲.mp3",
      "sounds/music/experiment/draft.mp3",
      "sounds/training/debug.wav",
    ])
      expect(isPublicMedia(file), file).toBe(false);
  });

  it("rejects emitted AI, scenarios and development tools but keeps single play and snapshots", () => {
    const blocked = [
      "packages/ai/src/index.ts",
      "apps/cli/src/self-play.ts",
      "packages/rules-core/src/training-policy-value.ts",
      "packages/rules-core/src/ai-observation.ts",
      "apps/playground-web/src/scenarios.ts",
      "apps/playground-web/src/scenario-effect-immunity.ts",
      "apps/playground-web/src/development.ts",
      "apps/playground-web/src/components/DevelopmentReplayViewer.tsx",
      "scripts/lib/replay-delta.mjs",
    ];
    for (const file of blocked)
      expect(
        isDevelopmentModule(`C:\\repo\\${file.replaceAll("/", "\\")}`),
        file
      ).toBe(true);
    for (const file of [
      "packages/rules-core/src/snapshot.ts",
      "apps/playground-web/src/replayViewer.ts",
      "apps/playground-web/src/components/ReplayViewer.tsx",
      "packages/replay-codec/replay-delta.mjs",
      "apps/playground-web/src/components/BattleSetup.tsx",
      "apps/playground-web/src/components/BattleScreen.tsx",
    ])
      expect(isDevelopmentModule(`/repo/${file}`), file).toBe(false);

    const hook = publicBuildPlugin().generateBundle;
    if (typeof hook !== "function") throw new Error("Missing bundle guard");
    const run = (length: number) =>
      hook.call(
        {
          error: (message: string) => {
            throw new Error(message);
          },
        } as never,
        {} as never,
        {
          "app.js": {
            type: "chunk",
            modules: {
              "/repo/packages/ai/src/index.ts": { renderedLength: length },
            },
          },
        } as never,
        false
      );
    expect(() => run(30)).toThrow("Development code in public bundle");
    expect(() => run(0)).not.toThrow();
  });
});
