import { createHash } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_FUZZ_REGRESSION_SEEDS = [
  1, 2, 3, 4, 5, 1_558_434_724,
  // selfplay がリザーブのソウルコアを場入り維持コアへ渡せず stuck した再現 seed。
  1_558_620_687,
  // 追加ターンが別バーストの効果発揮 window を残したまま開始され stuck した再現 seed。
  1_558_635_057,
  // 手札取得の対価で通常＋ソウルを通常コアだけに配分して stuck した再現 seed。
  1_558_690_028,
  // 通常行動の支払い入力欠落からブレイヴ操作を反復し capped した再現 seed。
  1_558_703_219,
  // 通常行動が残るメインでステップ終了を選べず、合体・交換・分離を反復した再現 seed。
  1_558_703_230,
  // 対象開示の再開が外側の配置誘発/神託を待って stuck した再現 seed。
  1_558_703_246,
  // 場からのマジック使用許可を割引支払い検査へ渡さず例外になった再現 seed。
  1_558_703_276,
  // トークン維持コアに許可されたトラッシュ通常コアを生成せず stuck した再現 seed。
  1_558_704_452,
  // 相手のコア最終総数を追加移動量として渡し、二段階再配分で stuck した再現 seed。
  1_558_705_581,
  // inline ドロー後の任意トラッシュ回収が返却stateへ出ず stuck した再現 seed。
  1_558_706_828, 1_558_706_842,
  // 対象開示の継続と宣言確定が相互に待機して stuck した再現 seed。
  1_558_706_866,
  // 指定対象が逆転醒の新IDへ置き換わり、守備側を取得できず stuck した再現 seed。
  1_558_709_111,
  // 複数stepの確定対象を先頭stepへ狭め、耐性応答後に再開示して stuck した再現 seed。
  1_558_711_590,
  // primary破棄枚数に足りない手札を送信し、成立するalternateを選べなかったseed。
  1_558_712_826,
  // 可変枚数破棄の先頭不払候補で入力探索が止まり、支払前割込の再開がstuckしたseed。
  958_147_760,
  // 使用コストで唯一の対価対象が消滅待機となり、未選択groupの本体実行が例外になるseed。
  1_558_722_431,
  // 移動上限を超える最終総数候補だけで生成上限を使い切った二段階配分seed。
  1_558_723_490,
  // 宣言済み対象を任意手順の継続で再開示し、内側応答を再生成したseed。
  1_558_723_493,
  // 強制対象を含まない先頭候補を選び、対象入力を拒否され続けたseed。
  1_558_726_003,
  // 強制ブロック宣言確定前に追加ターンへ移り、閉じた宣言窓へ復帰したseed。
  926_912_505,
  // 休眠誘発を操作権側だけが数え、相手の単独解決に到達できずstuckしたseed。
  1_498_498_078,
  // メイン終了窓でステップ終了を選べず、合体・交換・分離を反復したseed。
  1_558_764_185,
  // 除外割引後の全額をリザーブだけに要求し、合法な場の支払い元を使えずstuckしたseed。
  1_558_775_056,
  // 外側召喚のコスト離脱と応答由来バーストが相互待機したseed。
  1_558_798_883,
  // 無効化応答後に先行burstの残りstackを別の待機cascadeで置き換えたseed。
  3_391_842_970,
];

function uint32(value) {
  return Number(value) >>> 0;
}

function initialSeedBase(head) {
  const digest = createHash("sha256").update(String(head)).digest();
  const value = digest.readUInt32LE(0) >>> 0;
  return Math.max(10_000, value);
}

export function buildFuzzSeedPlan({
  games,
  rotatingSeedBase,
  regressionSeeds = DEFAULT_FUZZ_REGRESSION_SEEDS,
}) {
  if (!Number.isInteger(games) || games <= 0) {
    throw new Error("games must be a positive integer");
  }
  const fixed = [...new Set(regressionSeeds.map(uint32))].slice(0, games);
  const used = new Set(fixed);
  const seeds = [...fixed];
  let candidate = uint32(rotatingSeedBase);
  while (seeds.length < games) {
    if (!used.has(candidate)) {
      seeds.push(candidate);
      used.add(candidate);
    }
    candidate = (candidate + 1) >>> 0;
  }
  return {
    seeds,
    regressionSeeds: fixed,
    discoverySeeds: seeds.slice(fixed.length),
  };
}

function releaseSeedLock(lock, lockFile, suppressErrors = false) {
  try {
    closeSync(lock);
    unlinkSync(lockFile);
  } catch (error) {
    if (!suppressErrors && error?.code !== "ENOENT") throw error;
  }
}

export function reserveFuzzSeedRange({ stateFile, games, head }) {
  if (!Number.isInteger(games) || games <= 0) {
    throw new Error("games must be a positive integer");
  }
  mkdirSync(dirname(stateFile), { recursive: true });
  const lockFile = `${stateFile}.lock`;
  const lock = openSync(lockFile, "wx");
  try {
    let state = null;
    try {
      state = JSON.parse(readFileSync(stateFile, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (
      state !== null &&
      (typeof state !== "object" ||
        Array.isArray(state) ||
        state.schemaVersion !== 1 ||
        !Number.isInteger(state.nextSeedBase) ||
        state.nextSeedBase < 0 ||
        state.nextSeedBase > 0xffffffff ||
        !Array.isArray(state.history))
    ) {
      throw new Error("invalid fuzz seed ledger");
    }
    const seedBase =
      state === null ? initialSeedBase(head) : uint32(state.nextSeedBase);
    const reserved = Math.max(games, 1);
    const nextSeedBase = (seedBase + reserved + 997) >>> 0;
    const record = {
      schemaVersion: 1,
      nextSeedBase,
      updatedAt: new Date().toISOString(),
      history: [
        ...(Array.isArray(state?.history) ? state.history : []),
        {
          head: String(head),
          seedBase,
          games,
          reservedAt: new Date().toISOString(),
        },
      ].slice(-128),
    };
    const tempFile = `${stateFile}.${process.pid}.tmp`;
    writeFileSync(tempFile, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    renameSync(tempFile, stateFile);
    releaseSeedLock(lock, lockFile);
    return seedBase;
  } catch (error) {
    releaseSeedLock(lock, lockFile, true);
    throw error;
  }
}
