// BSTH04.5 東方文花帖
const cardData = [
  {
    id: 135,
    name: "射命丸 文",
    type: "スピリット",
    cost: 6,
    color: ["緑"],
    reduction: ["緑", "緑", "導"],
    tribe: "幻想・風神・天狗",
    symbol: ["緑"],
    rarity: "X",
    pack: "BSTH04.5 東方文花帖",
    cardNumber: "BSTH04.5-X01",
    levels: [
      {
        level: "Lv1",
        cost: 1,
        bp: 7000,
      },
      {
        level: "Lv2",
        cost: 3,
        bp: 10000,
      },
      {
        level: "Lv3",
        cost: 5,
        bp: 14000,
      },
    ],
    effect:
      "Lv1-Lv2-Lv3『このスピリットの召喚時』\n相手のスピリット/アルティメット3体を疲労させる。相手は、この効果を2体以上防げない。\n\nLv2-Lv3『このスピリットのアタック時』\nコア4個以上の自分の緑の導界者ネクサス/創界神ネクサスがある間、相手は手札のフラッシュ効果を使用できない。\n\nLv3『このスピリットのアタック時』\nバトル終了時、自分の緑の創界神ネクサスのコア2個をボイドに置くことで、このスピリットは回復する。",
    image: "images/BSTH04.5-X01.png",
    maxDeckCount: 3,
  },
];
export default cardData;
