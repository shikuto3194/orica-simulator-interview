/**
 * アバター ID と表示名のマスタ。
 * アイコンは `/images/avater/${id}-icon.png`、ホーム全身は `fullbody/${id}.webp`。
 * 新キャラ追加時は二つ名の内部出典、アイコン、全身画像を同時に追加する。
 */
export interface AvatarDef {
  id: string;
  name: string;
  /** 出典は manual/ai-reference/25_gui/18_home-lobby.md に記録。 */
  epithet: string;
}

export const AVATARS: readonly AvatarDef[] = [
  { id: "reimu", name: "霊夢", epithet: "楽園の素敵な巫女" },
  { id: "marisa", name: "魔理沙", epithet: "普通の魔法使い" },
  { id: "sakuya", name: "咲夜", epithet: "完全で瀟洒な従者" },
  { id: "remilia", name: "レミリア", epithet: "永遠に紅い幼き月" },
  { id: "flandre", name: "フランドール", epithet: "悪魔の妹" },
  { id: "patchouli", name: "パチュリー", epithet: "知識と日陰の少女" },
  { id: "alice", name: "アリス", epithet: "七色の人形遣い" },
  { id: "youmu", name: "妖夢", epithet: "半分幻の庭師" },
  { id: "sanae", name: "早苗", epithet: "祀られる風の人間" },
  { id: "suwako", name: "諏訪子", epithet: "土着神の頂点" },
  { id: "cirno", name: "チルノ", epithet: "湖上の氷精" },
  { id: "reisen", name: "鈴仙", epithet: "狂気の月の兎" },
  { id: "tenshi", name: "天子", epithet: "非想非非想天の娘" },
  { id: "suika", name: "萃香", epithet: "萃まる夢、幻、そして百鬼夜行" },
  { id: "satori", name: "さとり", epithet: "怨霊も恐れ怯む少女" },
  { id: "koishi", name: "こいし", epithet: "閉じた恋の瞳" },
  { id: "kokoro", name: "心", epithet: "表情豊かなポーカーフェイス" },
  { id: "miko", name: "神子", epithet: "聖徳道士" },
  { id: "eiki", name: "映姫", epithet: "楽園の最高裁判長" },
  { id: "akyuu", name: "阿求", epithet: "幻想郷の記憶" },
];

export const DEFAULT_SELF_AVATAR_ID = "reimu";
export const DEFAULT_OPPONENT_AVATAR_ID = "marisa";

const AVATAR_IDS = new Set(AVATARS.map((a) => a.id));

export function isValidAvatarId(id: string | null | undefined): id is string {
  return typeof id === "string" && AVATAR_IDS.has(id);
}

export function avatarSrc(
  id: string | null | undefined,
  fallback: string = DEFAULT_SELF_AVATAR_ID
): string {
  const safe = isValidAvatarId(id) ? id : fallback;
  return `/images/avater/${safe}-icon.png`;
}

/** ホームでは切り抜かず全身を表示する。公開画像はこのマスタの ID のみ。 */
export function avatarFullBodySrc(id: string | null | undefined): string {
  const safe = isValidAvatarId(id) ? id : DEFAULT_SELF_AVATAR_ID;
  return `/images/avater/fullbody/${safe}.webp`;
}
