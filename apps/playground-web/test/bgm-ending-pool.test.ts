import { describe, expect, it } from "vitest";
import { buildTrackPools } from "../src/bgm/manifest";
import { WORKS } from "../src/bgm/works";

describe("buildTrackPools (エンディング曲プール)", () => {
  it("エンディング曲は ending プールに入り、title/game プールから除外される", () => {
    const pools = buildTrackPools(
      [
        "東方原曲 紅魔郷 タイトル画面テーマ 赤より紅い夢.mp3",
        "東方原曲 紅魔郷 １面テーマ ほおずきみたいに紅い魂.mp3",
        "東方原曲 紅魔郷 エンディングテーマ 紅より儚い永遠.mp3",
        "東方原曲 紅魔郷 スタッフロールテーマ 紅楼 ～ Eastern Dream.mp3",
      ],
      "紅魔郷"
    );
    expect(pools.endingTracks.map((t) => t.songName)).toEqual([
      "紅より儚い永遠",
    ]);
    expect(pools.titleTracks.map((t) => t.songName)).toEqual(["赤より紅い夢"]);
    expect(pools.gameTracks.map((t) => t.songName)).toEqual([
      "ほおずきみたいに紅い魂",
    ]);
  });

  it("エンディング曲が無い作品はスタッフロール曲で代用する (風神録の「テーマ」無し表記も拾う)", () => {
    const pools = buildTrackPools(
      [
        "東方原曲 風神録 タイトル画面テーマ 封印されし神々.mp3",
        "東方原曲 風神録 スタッフロール 神は恵みの雨を降らす～Sylphid Dream.mp3",
      ],
      "風神録"
    );
    expect(pools.endingTracks.map((t) => t.filename)).toEqual([
      "東方原曲 風神録 スタッフロール 神は恵みの雨を降らす～Sylphid Dream.mp3",
    ]);
  });

  it("エンディングもスタッフロールも無い作品は ending プールが空 (再生側で title 代用)", () => {
    const pools = buildTrackPools(
      [
        "東方原曲 文花帖 タイトル画面テーマ 天狗の手帖 ～ Mysterious Note.mp3",
        "東方原曲 文花帖 撮影曲5 風神少女.mp3",
      ],
      "文花帖"
    );
    expect(pools.endingTracks).toEqual([]);
    expect(pools.gameTracks).toHaveLength(1);
  });

  it("タイトル曲が無い作品は最初のゲーム曲をタイトル扱いにする (既存 fallback 維持)", () => {
    const pools = buildTrackPools(
      [
        "東方原曲 緋想天 博麗神社(壊) 砕月.mp3",
        "東方原曲 緋想天 冥界 広有射怪鳥事 ～ Till When.mp3",
      ],
      "緋想天"
    );
    expect(pools.titleTracks).toHaveLength(1);
    expect(pools.titleTracks[0]!.filename).toBe(
      "東方原曲 緋想天 博麗神社(壊) 砕月.mp3"
    );
  });

  it("曲 URL は musicDir/ファイル名を encodeURIComponent した形式", () => {
    const pools = buildTrackPools(
      ["東方原曲 紅魔郷 エンディングテーマ 紅より儚い永遠.mp3"],
      "紅魔郷"
    );
    expect(pools.endingTracks[0]!.url).toBe(
      `/sounds/music/${encodeURIComponent("紅魔郷")}/${encodeURIComponent(
        "東方原曲 紅魔郷 エンディングテーマ 紅より儚い永遠.mp3"
      )}`
    );
  });

  it("天空璋を登録し、全角空白表記の曲ファイルを各プールへ分類する", () => {
    expect(WORKS).toContainEqual({
      id: "tenkuushou",
      imageDir: "tenkuushou",
      musicDir: "天空璋",
      label: "天空璋",
    });

    const pools = buildTrackPools(
      [
        "東方原曲　天空璋　タイトルテーマ　桜舞い散る天空.mp3",
        "東方原曲　天空璋　一面道中のテーマ　希望の星は青霄に昇る.mp3",
        "東方原曲　天空璋　六面ボス 摩多羅隠岐奈のテーマ　秘匿されたフォーシーズンズ.mp3",
        "東方原曲　天空璋　エンディングテーマ　不自然な自然.mp3",
        "東方原曲　天空璋　スタッフロールテーマ　白い旅人.mp3",
      ],
      "天空璋"
    );

    expect(pools.titleTracks.map((t) => t.songName)).toEqual([
      "桜舞い散る天空",
    ]);
    expect(pools.gameTracks.map((t) => t.songName)).toEqual([
      "希望の星は青霄に昇る",
      "秘匿されたフォーシーズンズ",
    ]);
    expect(pools.endingTracks.map((t) => t.songName)).toEqual(["不自然な自然"]);
  });
});
