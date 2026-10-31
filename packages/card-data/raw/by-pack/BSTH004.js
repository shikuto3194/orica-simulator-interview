// BSTH004 東方幻想郷
const cardData = [
  {
    id: 53,
    name: "幻月",
    color: ["赤"],
    cost: 8,
    reduction: ["赤", "赤", "赤", "赤", "赤"],
    type: "スピリット",
    tribe: "幻想・夜族",
    symbol: ["赤", "赤"],
    rarity: "X",
    pack: "BSTH004 東方幻想郷",
    cardNumber: "BSTH004-X03",
    levels: [
      {
        level: "Lv1",
        cost: 1,
        bp: 10000,
      },
      {
        level: "Lv2",
        cost: 2,
        bp: 16000,
      },
      {
        level: "Lv3",
        cost: 4,
        bp: 24000,
      },
    ],
    effect:
      "【転召：3／幻想＆コスト6以上／ボイド】\n召喚コスト支払い後、対象の自分のスピリット1体の上のコアすべて（最低3個）をボイドに置かなければならない。\n\nLv1-Lv2-Lv3\n自分の「夢月」がいるとき、このスピリットは相手の効果を受けない。\n\nLv2-Lv3『このスピリットのアタック時』\n自分の創界神ネクサス/導界者ネクサスがなければ、相手の転醒ネクサス/創界神ネクサス1つを破壊する。この効果で相手は転醒できない。さらに、自分のカウント0のとき、このスピリットは回復する。",
    image: "images/BSTH004-X03.png",
    maxDeckCount: 0,
  },
];
export default cardData;
