// BSTH005 東方怪綺談
const cardData = [
  {
    id: 472,
    name: "魔界／［創造の魔界神］神綺",
    isDoubleSided: true,
    front: {
      name: "魔界",
      type: "ネクサス",
      cost: 3,
      color: ["黄"],
      reduction: ["黄", "黄"],
      tribe: "幻想・導魔・四道",
      rarity: "TX",
      symbol: ["黄"],
      pack: "BSTH005 東方怪綺談",
      cardNumber: "BSTH005-TX01(A)",
      image: "images/BSTH005-TX01(A).png",
      levels: [
        {
          level: "Lv1",
          cost: 0,
        },
      ],
      effect:
        "Lv1【転醒：自分のカウント9以下（転醒は同時に使えない）】\n自分のライフが増えた/減ったか、このネクサスが相手によってフィールドを離れるとき、このネクサスに自分の《ソウルコア》を置いて裏返せる。\n\nLv1『このネクサスの配置時』\nこのターンの間、相手のスピリット/アルティメット1体をBP-8000でき、BPが0になった対象を破壊できる。\n\nLv1『お互いのアタックステップ』\nターンに1回、自分が黄1色のカードを召喚/使用したとき、自分の手札が5枚以下なら、自分はデッキの上から1枚ドローできる。",
    },
    back: {
      name: "［創造の魔界神］神綺",
      type: "スピリット",
      cost: 6,
      color: ["黄"],
      reduction: [],
      tribe: "起幻・幻想・導魔",
      rarity: "TX",
      symbol: ["黄"],
      pack: "BSTH005 東方怪綺談",
      cardNumber: "BSTH005-TX01(B)",
      image: "images/BSTH005-TX01(B).png",
      levels: [
        {
          level: "Lv1",
          cost: 1,
          bp: 7000,
        },
        {
          level: "Lv2",
          cost: 2,
          bp: 10000,
        },
      ],
      effect:
        "この面に裏返ったとき、フィールドに残り、カウント+1する。\n\nLv1-Lv2『このスピリットの転醒時』\nこのターンの間、自分のカウント1につき、相手のスピリット/アルティメット1体はアタック/ブロックできない。\n\nLv1-Lv2『根幻回帰』\n相手の効果でフィールドを離れるとき、裏返して配置できる。\n\nLv1-Lv2\n自分の黄のスピリット/アルティメットがアタックしたとき、このターンの間、相手のスピリット/アルティメット1体をBP-8000でき、BP0になった対象を破壊できる。",
    },
    maxDeckCount: 3,
  },
];
export default cardData;
