// BSTH02.5 東方萃夢想
const cardData = [
  {
    id: 96,
    name: "伊吹 萃香",
    color: ["緑"],
    cost: 6,
    reduction: ["緑", "赤"],
    type: "スピリット",
    tribe: "幻想・遊精・皇獣・地霊",
    symbol: ["緑"],
    rarity: "X",
    pack: "BSTH02.5 東方萃夢想",
    cardNumber: "BSTH02.5-X01",
    levels: [
      {
        level: "Lv1",
        cost: 1,
        bp: 7000,
      },
      {
        level: "Lv2",
        cost: 3,
        bp: 9000,
      },
      {
        level: "Lv3",
        cost: 5,
        bp: 13000,
      },
    ],
    effect:
      "このカード/スピリットは、系統：「地霊」を持ち、2コスト以上支払わなければ召喚できない。\n\nLv1-Lv2-Lv3『このスピリットの召喚時』\nボイドからコア1個ずつを系統：「遊精」/「皇獣」を持つ自分のスピリットすべてに置ける。\n\nLv2-Lv3【三歩壊廃】『このスピリットのアタック時』\nゲーム中に1回、相手のスピリット/アルティメット/ネクサス/創界神ネクサス3つを破壊する。\n\nLv3『このスピリットのアタック時』\nこのスピリットは、ブロックされない。",
    image: "images/BSTH02.5-X01.png",
    maxDeckCount: 3,
  },
];
export default cardData;
