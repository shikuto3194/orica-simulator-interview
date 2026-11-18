import { describe, expect, it } from "vitest";
import { extractSongName } from "../src/bgm/classify";

describe("extractSongName", () => {
  it("テーマ + 空白 で曲名を切り出す (紅魔郷 EXTRA)", () => {
    expect(
      extractSongName(
        "東方原曲 紅魔郷 EXTRAテーマ 魔法少女達の百年祭.mp3",
        "紅魔郷"
      )
    ).toBe("魔法少女達の百年祭");
  });

  it("テーマ が無い役割でも最初の空白で分割する (紅魔郷 EXTRA ボス)", () => {
    expect(
      extractSongName(
        "東方原曲 紅魔郷 EXTRAボスフランドール U.N.オーエンは彼女なのか？.mp3",
        "紅魔郷"
      )
    ).toBe("U.N.オーエンは彼女なのか？");
  });

  it("役割中に空白を含むケースは テーマ アンカーで分割する (妖々夢)", () => {
    expect(
      extractSongName(
        "東方原曲 妖々夢 ５面ボス魂魄 妖夢のテーマ 広有射怪鳥事～Till When.mp3",
        "妖々夢"
      )
    ).toBe("広有射怪鳥事～Till When");
  });

  it("テーマ + 数字 を 1 つの境界として扱う (妖々夢 ６面ボス)", () => {
    expect(
      extractSongName(
        "東方原曲 妖々夢 ６面ボス西行寺幽々子テーマ２ ボーダーオブライフ.mp3",
        "妖々夢"
      )
    ).toBe("ボーダーオブライフ");
  });

  it("テーマ も BGM も無い場合は最初の空白で分割する (妖々夢 ６面ボス幽々子)", () => {
    expect(
      extractSongName(
        "東方原曲 妖々夢 ６面ボス幽々子 幽雅に咲かせ墨染の桜 ～ Border of Life.mp3",
        "妖々夢"
      )
    ).toBe("幽雅に咲かせ墨染の桜 ～ Border of Life");
  });

  it("緋想天: 役割 (場所名) と曲名が空白だけで区切られるケース", () => {
    expect(
      extractSongName(
        "東方原曲 緋想天 紅魔館大図書館 ラクトガール ～ 少女密室.mp3",
        "緋想天"
      )
    ).toBe("ラクトガール ～ 少女密室");
  });

  it("緋想天: 全角空白の区切りを許容する", () => {
    expect(
      extractSongName(
        "東方原曲 緋想天 オープニングタイトル　緋想天.mp3",
        "緋想天"
      )
    ).toBe("緋想天");
  });

  it("緋想天: 鉤括弧付きの役割でも分割できる", () => {
    expect(
      extractSongName(
        "東方原曲 緋想天 「全人類の緋想天」 幼心地の有頂天.mp3",
        "緋想天"
      )
    ).toBe("幼心地の有頂天");
  });

  it("神霊廟: 【東方原曲】プレフィックス + BGM - 区切りを処理する", () => {
    expect(
      extractSongName(
        "【東方原曲】 東方神霊廟 EXボスBGM - 佐渡の二ッ岩.mp3",
        "神霊廟"
      )
    ).toBe("佐渡の二ッ岩");
  });

  it("神霊廟: 番号付き (16.) を曲名アンカーとして扱う", () => {
    expect(extractSongName("東方神霊廟 16.神社の新しい風.mp3", "神霊廟")).toBe(
      "神社の新しい風"
    );
  });

  it("神霊廟: 英題 + Theme - 区切りを処理する", () => {
    expect(
      extractSongName(
        "【東方神霊廟】 Touhou Ten Desires Phantasm Stage Theme - Divine Spirits Evening Bell Road.mp3",
        "神霊廟"
      )
    ).toBe("Divine Spirits Evening Bell Road");
  });

  it("妖精大戦争: 東方原曲プレフィックスが無い作品でも作品名を見つけて分割する", () => {
    expect(
      extractSongName(
        "妖精大戦争 タイトル画面テーマ 春の氷精.mp3",
        "妖精大戦争"
      )
    ).toBe("春の氷精");
  });

  it("作品名が見つからないケース (ルート直下のファイル) は元のファイル名を返す", () => {
    expect(extractSongName("童祭～Ｉnnocent Treasures.mp3", "風神録")).toBe(
      "童祭～Ｉnnocent Treasures"
    );
  });

  it("文花帖: 撮影曲<数字> も最初の空白で分割される", () => {
    expect(
      extractSongName(
        "東方原曲 文花帖 撮影曲２ 風の循環 ～ Wind Tour.mp3",
        "文花帖"
      )
    ).toBe("風の循環 ～ Wind Tour");
  });

  it("風神録: スタッフロール (役割が単独) でも曲名を取り出す", () => {
    expect(
      extractSongName(
        "東方原曲 風神録 スタッフロール 神は恵みの雨を降らす～Sylphid Dream.mp3",
        "風神録"
      )
    ).toBe("神は恵みの雨を降らす～Sylphid Dream");
  });

  it("風神録: ゲームオーバーテーマ も処理する", () => {
    expect(
      extractSongName(
        "東方原曲 風神録 ゲームオーバーテーマ プレイヤーズスコア.mp3",
        "風神録"
      )
    ).toBe("プレイヤーズスコア");
  });
});
