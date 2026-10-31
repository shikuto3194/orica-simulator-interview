import { useState, useCallback, useMemo } from "react";
import type { CardDefinition, GameState } from "@orica/rules-core";
import { setFirstPlayer } from "@orica/rules-core";

type Hand = "rock" | "scissors" | "paper";

const HAND_EMOJI: Record<Hand, string> = {
  rock: "✊",
  scissors: "✌️",
  paper: "🖐️",
};

const HAND_LABEL: Record<Hand, string> = {
  rock: "グー",
  scissors: "チョキ",
  paper: "パー",
};

function getResult(player: Hand, opponent: Hand): "win" | "lose" | "draw" {
  if (player === opponent) return "draw";
  if (
    (player === "rock" && opponent === "scissors") ||
    (player === "scissors" && opponent === "paper") ||
    (player === "paper" && opponent === "rock")
  )
    return "win";
  return "lose";
}

interface JankenScreenProps {
  /** 手札配布済みの GameState（先攻未確定） */
  initialState?: GameState;
  cardDefs?: CardDefinition[];
  onDecided: (finalState: GameState) => void;
  onBack: () => void;
}

export function JankenScreen({
  initialState,
  cardDefs,
  onDecided,
  onBack,
}: JankenScreenProps) {
  const [phase, setPhase] = useState<"hand" | "choose" | "result" | "pick">(
    initialState ? "hand" : "choose"
  );
  const [playerHand, setPlayerHand] = useState<Hand | null>(null);
  const [opponentHand, setOpponentHand] = useState<Hand | null>(null);
  const [resultText, setResultText] = useState("");

  // プレイヤーの手札を取得
  const myHand = useMemo(() => {
    if (!initialState) return [];
    return initialState.cardInstances.filter(
      (c) => c.ownerPlayerId === "alice" && c.zone === "hand"
    );
  }, [initialState]);

  const myHandCardDefs = useMemo(() => {
    if (!cardDefs || myHand.length === 0) return [];
    const defMap = new Map(cardDefs.map((d) => [d.cardNo, d]));
    return myHand
      .map((c) => defMap.get(c.definitionId))
      .filter(Boolean) as CardDefinition[];
  }, [cardDefs, myHand]);

  const play = useCallback(
    (hand: Hand) => {
      const hands: Hand[] = ["rock", "scissors", "paper"];
      const opp = hands[Math.floor(Math.random() * 3)]!;
      const result = getResult(hand, opp);

      setPlayerHand(hand);
      setOpponentHand(opp);

      if (result === "draw") {
        setResultText("あいこ！ もう一度");
        setTimeout(() => {
          setPhase("choose");
          setPlayerHand(null);
          setOpponentHand(null);
        }, 1500);
      } else if (result === "win") {
        setResultText("勝ち！ 先攻/後攻を選んでください");
        setPhase("pick");
      } else {
        setResultText("負け！ 相手が選択中...");
        setPhase("result");
        setTimeout(() => {
          if (!initialState) return;
          // CPUがランダムで先後選択
          const cpuGoesFirst = Math.random() < 0.5;
          const firstId = cpuGoesFirst ? "bob" : "alice";
          setResultText(
            cpuGoesFirst ? "相手が先攻を選びました" : "相手が後攻を選びました"
          );
          setTimeout(
            () => onDecided(setFirstPlayer(initialState, firstId)),
            1500
          );
        }, 1500);
      }
    },
    [initialState, onDecided]
  );

  const pickOrder = useCallback(
    (playerGoesFirst: boolean) => {
      if (!initialState) return;
      setResultText(
        playerGoesFirst ? "先攻を選びました！" : "後攻を選びました！"
      );
      setPhase("result");
      const firstId = playerGoesFirst ? "alice" : "bob";
      setTimeout(() => onDecided(setFirstPlayer(initialState, firstId)), 1500);
    },
    [initialState, onDecided]
  );

  return (
    <div className="janken-screen">
      <div className="janken-card">
        {/* 手札確認フェーズ */}
        {phase === "hand" && (
          <>
            <h1 className="janken-title">手札確認</h1>
            <p className="janken-sub">手札を確認してからじゃんけんに進みます</p>
            {myHandCardDefs.length > 0 ? (
              <div className="janken-hand-cards">
                {myHandCardDefs.map((card, i) => (
                  <div key={i} className="janken-hand-card">
                    {card.image ? (
                      <img
                        src={`/${card.image}`}
                        alt={card.name}
                        className="janken-hand-card-img"
                      />
                    ) : (
                      <div className="janken-hand-card-placeholder">
                        {card.name}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: "#888" }}>手札情報なし</p>
            )}
            <button
              className="janken-proceed-btn"
              onClick={() => setPhase("choose")}
            >
              じゃんけんへ
            </button>
          </>
        )}

        {/* じゃんけんフェーズ */}
        {phase !== "hand" && (
          <>
            <h1 className="janken-title">じゃんけん</h1>
            <p className="janken-sub">勝った方が先攻/後攻を選べます</p>
          </>
        )}

        {phase === "choose" && (
          <div className="janken-hands">
            {(["rock", "scissors", "paper"] as Hand[]).map((hand) => (
              <button
                key={hand}
                className="janken-btn"
                onClick={() => play(hand)}
              >
                <span className="janken-emoji">{HAND_EMOJI[hand]}</span>
                <span className="janken-label">{HAND_LABEL[hand]}</span>
              </button>
            ))}
          </div>
        )}

        {playerHand && opponentHand && (
          <div className="janken-result">
            <div className="janken-matchup">
              <div className="janken-player">
                <span className="janken-emoji-large">
                  {HAND_EMOJI[playerHand]}
                </span>
                <span>あなた</span>
              </div>
              <span className="janken-vs">対</span>
              <div className="janken-player">
                <span className="janken-emoji-large">
                  {HAND_EMOJI[opponentHand]}
                </span>
                <span>相手</span>
              </div>
            </div>
            <p className="janken-result-text">{resultText}</p>
          </div>
        )}

        {phase === "pick" && (
          <div className="janken-pick">
            <button className="janken-pick-btn" onClick={() => pickOrder(true)}>
              先攻
            </button>
            <button
              className="janken-pick-btn"
              onClick={() => pickOrder(false)}
            >
              後攻
            </button>
          </div>
        )}

        {phase !== "hand" && (
          <button className="janken-back" onClick={onBack}>
            戻る
          </button>
        )}
      </div>
    </div>
  );
}
