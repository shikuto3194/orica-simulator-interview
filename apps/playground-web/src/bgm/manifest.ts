import { WORKS, type Work } from "./works";
import { classifyTrack, extractSongName } from "./classify";
import { BGM_MANIFEST_URL } from "../assets/asset-contract";
import { readLocalAsset } from "../assets/local-asset-store";
import { waitForAssetPreparation } from "../assets/prepare-assets";

interface RawManifest {
  imagesByDir: Record<string, string[]>;
  musicByDir: Record<string, string[]>;
}

export interface BgmTrack {
  url: string;
  filename: string;
  songName: string;
}

export interface WorkAssets {
  work: Work;
  imageUrls: string[];
  titleTracks: BgmTrack[];
  gameTracks: BgmTrack[];
  /** 勝敗決定時に流すエンディング曲プール。
   * エンディング曲が無い作品はスタッフロール曲で代用し、どちらも無ければ空
   * (再生側で titleTracks にフォールバックする)。 */
  endingTracks: BgmTrack[];
}

const enc = (s: string) => encodeURIComponent(s);

export interface TrackPools {
  titleTracks: BgmTrack[];
  gameTracks: BgmTrack[];
  endingTracks: BgmTrack[];
}

/** 曲ファイル名一覧を種別ごとのプールに分類する (純関数; テスト対象)。
 * titleTrackHint が指定された曲はタイトル曲として固定し (ゲーム/エンディング
 * プールには入れない)。CD アルバムの収録順 1 曲目など。 */
export function buildTrackPools(
  music: string[],
  musicDir: string,
  titleTrackHint?: string
): TrackPools {
  const titleTracks: BgmTrack[] = [];
  const gameTracks: BgmTrack[] = [];
  const endingTracks: BgmTrack[] = [];
  const staffRollTracks: BgmTrack[] = [];
  for (const f of music) {
    const track: BgmTrack = {
      url: `/sounds/music/${enc(musicDir)}/${enc(f)}`,
      filename: f,
      songName: extractSongName(f, musicDir),
    };
    if (titleTrackHint && f.includes(titleTrackHint)) {
      titleTracks.push(track);
      continue;
    }
    const kind = classifyTrack(f);
    if (kind === "title") titleTracks.push(track);
    else if (kind === "game") gameTracks.push(track);
    else if (kind === "ending") endingTracks.push(track);
    else staffRollTracks.push(track);
  }
  // タイトル曲が無い作品は最初のゲーム曲をタイトル扱いにする (fallback)。
  if (titleTracks.length === 0 && gameTracks.length > 0) {
    titleTracks.push(gameTracks[0]!);
  }
  return {
    titleTracks,
    gameTracks,
    endingTracks: endingTracks.length > 0 ? endingTracks : staffRollTracks,
  };
}

export async function fetchWorkAssets(): Promise<WorkAssets[]> {
  try {
    await waitForAssetPreparation();
    const saved = await readLocalAsset(BGM_MANIFEST_URL);
    const res =
      saved ??
      (await fetch(BGM_MANIFEST_URL, { signal: AbortSignal.timeout(5000) }));
    if (!res.ok) return [];
    const works = buildWorkAssets((await res.json()) as RawManifest);
    if (works.length || !saved) return works;
    // The earlier deployment saved an empty catalog. Recover immediately without
    // waiting for the entire media library to download or deleting users' storage.
    // A query bypasses the service worker's local-asset route.
    const latest = await fetch(`${BGM_MANIFEST_URL}?refresh=empty-catalog`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    return latest.ok
      ? buildWorkAssets((await latest.json()) as RawManifest)
      : [];
  } catch {
    return [];
  }
}

function buildWorkAssets(raw: RawManifest): WorkAssets[] {
  const out: WorkAssets[] = [];
  for (const work of WORKS) {
    const images = raw.imagesByDir[work.imageDir] ?? [];
    const music = raw.musicByDir[work.musicDir] ?? [];
    if (images.length === 0 || music.length === 0) continue;
    const imageUrls = images.map(
      (f) => `/images/title/${enc(work.imageDir)}/${enc(f)}`
    );
    const pools = buildTrackPools(music, work.musicDir, work.titleTrack);
    if (pools.titleTracks.length === 0) continue;
    out.push({ work, imageUrls, ...pools });
  }
  return out;
}
