/**
 * 曲名からトラック種別を判定する。
 * - title: タイトル画面用 (作品アイドル曲)
 * - ending: エンディング
 * - staff_roll: スタッフロール
 * - game: 上記以外。バトル中のランダム再生プールとして使う。
 */
export type TrackKind = "title" | "ending" | "staff_roll" | "game";

export function classifyTrack(filename: string): TrackKind {
  // 「スタッフロール」「エンディング」を先にチェック (タイトル誤判定回避)。
  if (filename.includes("スタッフロール")) return "staff_roll";
  if (filename.includes("エンディング")) return "ending";
  // 「タイトル画面テーマ」「タイトルテーマ」「タイトルBGM」を包括的に拾う。
  if (filename.includes("タイトル")) return "title";
  return "game";
}

/**
 * ファイル名から曲名だけを抽出する。
 * 作品名・「東方原曲」プレフィックス・ステージ/役割 (例: "５面ボス", "EXTRAテーマ", "BGM -")
 * を取り除き、純粋な曲名を返す。
 *
 * 想定パターン:
 *  - "東方原曲 紅魔郷 ５面ボス十六夜咲夜テーマ 月時計～ルナ・ダイアル.mp3"
 *  - "東方原曲 紅魔郷 EXTRAボスフランドール U.N.オーエンは彼女なのか？.mp3"
 *  - "東方原曲 妖々夢 ６面ボス幽々子 幽雅に咲かせ墨染の桜 ～ Border of Life.mp3"
 *  - "東方原曲 緋想天 紅魔館大図書館 ラクトガール ～ 少女密室.mp3"
 *  - "【東方原曲】 東方神霊廟 EXボスBGM - 佐渡の二ッ岩.mp3"
 *  - "東方神霊廟 16.神社の新しい風.mp3"
 *  - "妖精大戦争 タイトル画面テーマ 春の氷精.mp3"
 *  - "童祭～Ｉnnocent Treasures.mp3" (作品名なし → そのまま返す)
 */
// 半角空白 + 全角空白 (U+3000) を含む空白クラス。
// \s には U+3000 が含まれないので明示する。eslint の no-irregular-whitespace
// 回避のため Unicode エスケープで書く。
const WS = "[\\s\\u3000]";

export function extractSongName(filename: string, workName: string): string {
  // 1. 拡張子を除去
  let s = filename.replace(/\.[a-zA-Z0-9]+$/, "");

  // 2. 先頭の【...】を除去 (例: 【東方原曲】, 【東方神霊廟】)
  s = s.replace(new RegExp(`^【[^】]*】${WS}*`), "");

  // 3. 先頭の "東方原曲" を除去
  s = s.replace(new RegExp(`^東方原曲${WS}*`), "");

  // 4. 作品名 (または "東方<workName>") を探して、その直後の文字列を取り出す。
  //    どちらも見つからなければ workFound=false。"<役割> <曲名>" 構造が
  //    確定できないので最後の generic split (e) は適用しない。
  const variants = [`東方${workName}`, workName];
  const wsPrefix = new RegExp(`^${WS}+`);
  let after = s;
  let workFound = false;
  for (const w of variants) {
    const idx = s.indexOf(w);
    if (idx >= 0) {
      after = s.slice(idx + w.length).replace(wsPrefix, "");
      workFound = true;
      break;
    }
  }

  // 5. 役割 | 曲名 を分割する。

  // (a) "テーマ" + 任意の数字 + 空白 → その直後が曲名
  const themeMatch = after.match(new RegExp(`^(.*?テーマ\\d*)${WS}+(.+)$`));
  if (themeMatch) {
    return stripLeadingDash(themeMatch[2]!.trim());
  }

  // (b) "BGM" + 空白 → その直後が曲名 (先頭の "-" は剥がす)
  const bgmMatch = after.match(new RegExp(`^(.*?BGM)${WS}+(.+)$`));
  if (bgmMatch) {
    return stripLeadingDash(bgmMatch[2]!.trim());
  }

  // (c) "Theme" + " - " → 英題向け
  const englishMatch = after.match(new RegExp(`^(.*?Theme)${WS}*-${WS}*(.+)$`));
  if (englishMatch) {
    return englishMatch[2]!.trim();
  }

  // (d) "<数字>." プレフィックス (例: "16.神社の新しい風")
  const numDotMatch = after.match(/^\d+\.(.+)$/);
  if (numDotMatch) {
    return numDotMatch[1]!.trim();
  }

  // (e) 最初の空白 (半角/全角) で分割。
  //     作品名が見つからなかった場合は "<役割> <曲名>" 構造が確定できないので
  //     適用しない (曲名内の空白を誤分割しないため)。
  if (workFound) {
    const spaceMatch = after.match(
      new RegExp(`^([^${WS.slice(1, -1)}]+)${WS}+(.+)$`)
    );
    if (spaceMatch) {
      return stripLeadingDash(spaceMatch[2]!.trim());
    }
  }

  return after.trim();
}

function stripLeadingDash(s: string): string {
  return s.replace(new RegExp(`^[-\\u2014\\u2015\\uFF0D]${WS}*`), "");
}
