/**
 * タイトル背景/BGM の作品レジストリ。
 * imageDir: images/title/<id>/ 配下のフォルダ名
 * musicDir: sounds/music/<id>/ 配下のフォルダ名
 * 画像と音楽の両方が揃っている作品のみここに載せる。
 */
export interface Work {
  id: string;
  imageDir: string;
  musicDir: string;
  label: string;
  /**
   * タイトル曲をファイル名 (部分一致) で明示指定する。
   * CD アルバム等で「タイトル」を含む曲が無く自動判定できない場合に、
   * アルバム収録順 1 曲目などを指定する。未指定なら従来の自動判定/fallback。
   */
  titleTrack?: string;
}

export const WORKS: Work[] = [
  { id: "koumakyo", imageDir: "koumakyo", musicDir: "紅魔郷", label: "紅魔郷" },
  { id: "youyoumu", imageDir: "youyoumu", musicDir: "妖々夢", label: "妖々夢" },
  { id: "eiyashou", imageDir: "eiyashou", musicDir: "永夜抄", label: "永夜抄" },
  {
    id: "kaeiduka",
    imageDir: "kaeiduka",
    musicDir: "花映塚",
    label: "花映塚",
  },
  {
    id: "huujinnroku",
    imageDir: "huujinnroku",
    musicDir: "風神録",
    label: "風神録",
  },
  { id: "hisouten", imageDir: "hisouten", musicDir: "緋想天", label: "緋想天" },
  {
    id: "chireiden",
    imageDir: "chireiden",
    musicDir: "地霊殿",
    label: "地霊殿",
  },
  {
    id: "seirensen",
    imageDir: "seirensen",
    musicDir: "星蓮船",
    label: "星蓮船",
  },
  {
    id: "youseidaisensou",
    imageDir: "youseidaisensou",
    musicDir: "妖精大戦争",
    label: "妖精大戦争",
  },
  {
    id: "shinreibyou",
    imageDir: "shinreibyou",
    musicDir: "神霊廟",
    label: "神霊廟",
  },
  {
    id: "shinkirou",
    imageDir: "shinkirou",
    musicDir: "心綺楼",
    label: "心綺楼",
  },
  {
    id: "kishinjou",
    imageDir: "kishinjou",
    musicDir: "輝針城",
    label: "輝針城",
  },
  {
    id: "kanjuden",
    imageDir: "kanjuden",
    musicDir: "紺珠伝",
    label: "紺珠伝",
  },
  {
    id: "tenkuushou",
    imageDir: "tenkuushou",
    musicDir: "天空璋",
    label: "天空璋",
  },
  {
    id: "yumetagaekagakuseiki",
    imageDir: "yumetagaekagakuseiki",
    musicDir: "夢違科学世紀",
    label: "夢違科学世紀",
    // アルバム収録順 1 曲目 (童祭 ～ Innocent Treasures) をタイトル曲にする。
    titleTrack: "童祭",
  },
];
