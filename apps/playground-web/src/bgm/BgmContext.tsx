import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { fetchWorkAssets, type WorkAssets } from "./manifest";
import { useAuth } from "../AuthContext";
import { useAssetPreparation } from "../assets/AssetPreparation";
import { IS_INTERVIEW_BUILD } from "../interview-mode";

export type BgmMode = "outside" | "ingame";

interface BgmContextValue {
  works: WorkAssets[];
  currentWorkIndex: number;
  currentImage: string | null;
  /** 現在再生中のトラック URL (audio.src と一致)。未ロード時は null。 */
  currentTrackUrl: string | null;
  /** 現在再生中の曲名 (抽出済み)。未ロード時は null。 */
  currentSongName: string | null;
  mode: BgmMode;
  volume: number;
  muted: boolean;
  unlocked: boolean;
  /** 初回ロード完了。マニフェスト + 最初の画像 + 最初の曲が揃った時点で true。
   * 一度 true になると false に戻らない (作品切替中の loading 再表示を避ける)。 */
  initialReady: boolean;
  setMode: (mode: BgmMode) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  unlock: () => void;
  skipTrack: () => void;
  /** 勝敗決定時の演出: 現在の曲をフェードアウトし、エンディング曲に切り替える。
   * 返り値はエンディング曲が鳴り始めた時点で resolve する (再生不可・中断時も
   * タイムアウトで resolve)。勝敗表示をこの resolve に合わせて出すことで
   * 「表示と同時に鳴る」を実現する。多重呼び出しは即 resolve。 */
  transitionToEnding: () => Promise<void>;
  /** エンディング再生状態を解除して ingame プールの曲に戻す (「もう一度プレイ」用)。
   * エンディング再生中でなければ no-op。 */
  resumeFromEnding: () => void;
}

const BgmContext = createContext<BgmContextValue | null>(null);

const VOLUME_KEY = "orica-bgm-volume";
const MUTED_KEY = "orica-bgm-muted";
const SLIDESHOW_INTERVAL_MS = 30_000;
/** 勝敗決定時のフェードアウト時間。 */
const ENDING_FADE_OUT_MS = 1_500;
const ENDING_FADE_TICK_MS = 50;
/** エンディング曲の playing イベント待ちタイムアウト。
 * autoplay block やロード失敗で鳴らないときも勝敗表示を止めない。 */
const ENDING_START_TIMEOUT_MS = 2_500;

function loadVolume(): number {
  if (IS_INTERVIEW_BUILD) return 0.25;
  const raw = localStorage.getItem(VOLUME_KEY);
  if (raw == null) return 0.25;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.25;
}
function loadMuted(): boolean {
  if (IS_INTERVIEW_BUILD) return false;
  return localStorage.getItem(MUTED_KEY) === "1";
}

function pickRandomIndex(len: number, exclude: number): number {
  if (len <= 1) return 0;
  let i = Math.floor(Math.random() * len);
  if (i === exclude) i = (i + 1) % len;
  return i;
}

function pickInitialImageIndex(work: WorkAssets | undefined): number {
  const len = work?.imageUrls.length ?? 0;
  if (len <= 1) return 0;
  return Math.floor(Math.random() * len);
}

export function BgmProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const hasUser = Boolean(user);
  const { ready: assetsReady, catalogVersion } = useAssetPreparation();
  const loadedCatalog = useRef(false);
  const [works, setWorks] = useState<WorkAssets[]>([]);
  const [currentWorkIndex, setCurrentWorkIndex] = useState(0);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [currentTrackUrl, setCurrentTrackUrl] = useState<string | null>(null);
  const [mode, setModeState] = useState<BgmMode>("outside");
  const [volume, setVolumeState] = useState(() => loadVolume());
  const [muted, setMuted] = useState(() => loadMuted());
  const [unlocked, setUnlocked] = useState(false);
  const [lastWorkIndexForImageReset, setLastWorkIndexForImageReset] =
    useState(currentWorkIndex);
  // Phase B: 初回ロード同期。manifest 到着 + 最初の画像 decode + 最初の曲 canplay
  // が全部揃うまで App 側で「読み込み中…」を表示する。BGM 資産が無い場合は
  // 「BGM なし」として完了扱いにし、ゲーム操作を恒久的に覆わない。一度 ready
  // になったら戻さない。
  const [audioReady, setAudioReady] = useState(IS_INTERVIEW_BUILD);
  const [imageReady, setImageReady] = useState(false);
  const [initialReady, setInitialReady] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // muted を ref でも参照する (retry-on-interaction が closure の stale 値で
  // 復元しないように)。
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  // volume も ref で参照する (エンディング遷移のフェードが audio.volume を直接
  // 操作するため、復元時に stale 値を使わないように)。
  const volumeRef = useRef(volume);
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);
  // エンディング遷移状態。true の間は通常のトラック選択を凍結する
  // (audio.loop=true でエンディングをループ再生)。
  const endingActiveRef = useRef(false);
  // 進行中のエンディング遷移 (フェード/playing 待ち) を中断する関数。
  // モード切替・リセットで通常再生に戻るときに呼ぶ。
  const endingAbortRef = useRef<(() => void) | null>(null);
  // 「強制 muted」フラグ。autoplay block 回避のため audio.muted=true を
  // 強制したかどうかを保持。次のユーザー操作で audio.muted を mutedRef.current に
  // 復元する。
  const forceMutedRef = useRef(false);

  // 作品が変わったら画像 index をランダムで初期化 (store-previous-prop パターン)。
  // 0 固定にすると、ランダム選択された作品でも常に 1 枚目が最初に出てしまう。
  if (lastWorkIndexForImageReset !== currentWorkIndex) {
    setLastWorkIndexForImageReset(currentWorkIndex);
    setCurrentImageIndex(pickInitialImageIndex(works[currentWorkIndex]));
  }

  // マニフェスト取得。
  useEffect(() => {
    if (!hasUser || !assetsReady) return;
    let cancelled = false;
    fetchWorkAssets().then((list) => {
      if (cancelled) return;
      setWorks(list);
      if (loadedCatalog.current) {
        // A newly registered work can occupy the same list index with fewer images.
        setCurrentImageIndex(0);
        setCurrentWorkIndex((index) =>
          Math.max(0, Math.min(index, list.length - 1))
        );
        return;
      }
      loadedCatalog.current = true;
      // CI や初回セットアップでは manifest 自体は応答しても、BGM/画像の実体が
      // 一切無く list が空になる。その場合は canplay/image decode が発生しないため、
      // 初期ロードを待ち続けず BGM なしの UI へフォールバックする。
      if (list.length === 0) {
        setAudioReady(true);
        setImageReady(true);
        return;
      }
      if (list.length > 0) {
        const wi = Math.floor(Math.random() * list.length);
        setCurrentWorkIndex(wi);
        // 初期作品が偶然 index 0 のとき store-previous-prop の reset が
        // 走らないので、ここでも画像 index をランダム化しておく。
        setCurrentImageIndex(pickInitialImageIndex(list[wi]));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [hasUser, assetsReady, catalogVersion]);

  // audio 要素の初期化 + canplay リスナ。
  // canplay で audioReady=true (sticky 用) + play() 試行。autoplay block で失敗したら
  // audio.muted=true で再試行 (muted autoplay は browser policy で許容される)。
  // 次のユーザー操作で audio.muted を復元する (forceMutedRef 経由)。
  useEffect(() => {
    const audio = new Audio();
    audio.preload = IS_INTERVIEW_BUILD ? "none" : "auto";
    audioRef.current = audio;
    const tryPlayWithMutedFallback = () => {
      audio.play().catch(() => {
        // 1 回目失敗 → muted=true で再試行 (Chromium / Safari いずれも
        // muted autoplay は user gesture なしで許容)。ユーザーには音が
        // 聞こえないが、次の操作で復元される。
        if (!audio.muted) {
          audio.muted = true;
          forceMutedRef.current = true;
          void audio.play().catch(() => {
            /* それでも失敗したら諦める (autoplay block 完全遮断) */
          });
        }
      });
    };
    const onCanPlay = () => {
      setAudioReady(true);
      if (!IS_INTERVIEW_BUILD && audio.paused) {
        tryPlayWithMutedFallback();
      }
    };
    // manifest に曲名だけ残り、個別ファイルが取得できない場合も初期 overlay を
    // 閉じる。再生失敗は BGM 機能に限定し、ゲーム本体の操作可能性を阻害しない。
    const onError = () => setAudioReady(true);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("error", onError);
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
  }, []);

  // ボリューム/ミュート反映。
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = muted;
    if (!IS_INTERVIEW_BUILD) {
      localStorage.setItem(VOLUME_KEY, String(volume));
      localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
    }
  }, [volume, muted]);

  // 現在再生すべき track URL を決定して audio.src に流す (imperative; state 更新なし)。
  // play() は呼ばない — canplay リスナで一元的に発火する。
  // currentTrackUrl の追従は別 effect で audio の loadstart イベントから行う。
  const startTrackForCurrentState = useCallback(
    (workIndex: number, currentMode: BgmMode) => {
      const audio = audioRef.current;
      if (!audio || works.length === 0 || !hasUser) return;
      // 勝敗確定後 (エンディング遷移中/再生中) は ingame の通常トラック選択を
      // 凍結する (決着済み state でマウントした場合の outside→ingame 切替が
      // エンディングを上書きしないように)。
      if (currentMode === "ingame" && endingActiveRef.current) return;
      // outside への切替 (ホームに戻る・タイトルへ等) はエンディング再生状態を
      // 解除する (フェード途中なら中断して音量を戻す)。
      endingAbortRef.current?.();
      endingActiveRef.current = false;
      audio.loop = false;
      const work = works[workIndex];
      if (!work) return;
      let url: string | null;
      if (currentMode === "outside") {
        url =
          work.titleTracks[Math.floor(Math.random() * work.titleTracks.length)]
            ?.url ?? null;
      } else {
        const pool =
          work.gameTracks.length > 0 ? work.gameTracks : work.titleTracks;
        url = pool[Math.floor(Math.random() * pool.length)]?.url ?? null;
      }
      if (!url) return;
      if (audio.src.endsWith(url)) return;
      audio.src = url;
    },
    [works, hasUser]
  );

  // audio.src 変更を購読して currentTrackUrl を React state に反映する。
  // loadstart は src がセットされた直後に必ず発火するため、
  // imperative な src 更新 (startTrackForCurrentState / onEnded / skipTrack) を
  // 一括で拾える。state 更新は外部イベントのコールバック内なので
  // react-hooks/set-state-in-effect には触れない。
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onLoadStart = () => {
      const relative = audio.src.replace(location.origin, "");
      setCurrentTrackUrl(relative || null);
    };
    audio.addEventListener("loadstart", onLoadStart);
    return () => audio.removeEventListener("loadstart", onLoadStart);
  }, []);

  // works ロード後/モード/作品切替で再生開始。
  useEffect(() => {
    if (!hasUser) {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      return;
    }
    startTrackForCurrentState(currentWorkIndex, mode);
  }, [currentWorkIndex, mode, works, startTrackForCurrentState, hasUser]);

  // 曲終端ハンドラ。outside は次作品へ、ingame は同作品の別曲へ。
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      if (mode === "outside") {
        setCurrentWorkIndex((i) => {
          const next = works.length > 0 ? (i + 1) % works.length : 0;
          return next;
        });
        // 画像 index は store-previous-prop パターン側で
        // 作品変更を検知してランダム化される。
      } else {
        // エンディング遷移中 (フェード中に曲が自然終了したケース) は
        // 通常プールの選曲をしない。エンディングはループ再生なのでここに来ない。
        if (endingActiveRef.current) return;
        const work = works[currentWorkIndex];
        if (!work) return;
        const pool =
          work.gameTracks.length > 0 ? work.gameTracks : work.titleTracks;
        if (pool.length === 0) return;
        const currentRelativeUrl = audio.src.replace(location.origin, "");
        const currentIdx = pool.findIndex((t) => t.url === currentRelativeUrl);
        const nextIdx = pickRandomIndex(pool.length, currentIdx);
        const next = pool[nextIdx];
        if (!next) return;
        audio.src = next.url;
        // play() は canplay リスナ、currentTrackUrl は loadstart リスナが拾う
      }
    };
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, [mode, works, currentWorkIndex]);

  // unlock 後に保留中の曲を再生開始する。canplay が既に発火していたケース用。
  // readyState >= 2 (HAVE_CURRENT_DATA) なら play() を試みる。
  useEffect(() => {
    if (!unlocked) return;
    const audio = audioRef.current;
    if (!audio || !audio.src) return;
    if (audio.paused && audio.readyState >= 2) {
      void audio.play().catch(() => {});
    }
  }, [unlocked]);

  // 任意のユーザー操作 (fresh activation) で:
  // (a) 強制 muted (autoplay block 回避用) を復元
  // (b) audio が paused のままなら play() 再試行
  // を行う。unlock 前/後関係なく登録 (canplay の muted-autoplay fallback で既に再生中の
  // 場合も muted 復元が必要)。
  useEffect(() => {
    const restoreAndRetry = () => {
      const audio = audioRef.current;
      if (!audio) return;
      // (a) 強制 muted を解除してユーザー設定に復元
      if (forceMutedRef.current) {
        forceMutedRef.current = false;
        audio.muted = mutedRef.current;
      }
      // (b) paused なら再生試行 (fresh activation を活用)
      if (audio.src && audio.paused) {
        void audio.play().catch(() => {});
      }
    };
    const events: Array<keyof WindowEventMap> = [
      "pointerdown",
      "keydown",
      "touchstart",
      "wheel",
      "click",
    ];
    for (const e of events) {
      window.addEventListener(e, restoreAndRetry, { passive: true });
    }
    return () => {
      for (const e of events) {
        window.removeEventListener(e, restoreAndRetry);
      }
    };
  }, []);

  // Phase B: 現在画像の preload。decode 成功/失敗どちらでも imageReady=true (sticky) に倒す。
  // imageReady はリセットしない (initialReady promotion 用の one-way latch)。
  useEffect(() => {
    const url = works[currentWorkIndex]?.imageUrls[currentImageIndex] ?? null;
    if (!url) return;
    let cancelled = false;
    const img = new Image();
    img.src = url;
    const finalize = () => {
      if (!cancelled) setImageReady(true);
    };
    img.decode().then(finalize).catch(finalize);
    return () => {
      cancelled = true;
    };
  }, [works, currentWorkIndex, currentImageIndex]);

  // Phase B: initialReady は audioReady + imageReady の AND を render body で one-way latch。
  // ingame で直接起動した場合は画像 dir が無いので imageReady を待たない。
  // store-previous-prop パターン (effect 内 setState を避けてリント rule に準拠)。
  if (!initialReady) {
    const imageGate = mode === "ingame" ? true : imageReady;
    if ((audioReady || !hasUser) && imageGate) setInitialReady(true);
  }

  // 最初のユーザー操作で autoplay unlock。
  useEffect(() => {
    if (unlocked) return;
    const onFirstInteraction = () => {
      setUnlocked(true);
      window.removeEventListener("pointerdown", onFirstInteraction);
      window.removeEventListener("keydown", onFirstInteraction);
      window.removeEventListener("touchstart", onFirstInteraction);
    };
    window.addEventListener("pointerdown", onFirstInteraction, { once: false });
    window.addEventListener("keydown", onFirstInteraction, { once: false });
    window.addEventListener("touchstart", onFirstInteraction, { once: false });
    return () => {
      window.removeEventListener("pointerdown", onFirstInteraction);
      window.removeEventListener("keydown", onFirstInteraction);
      window.removeEventListener("touchstart", onFirstInteraction);
    };
  }, [unlocked]);

  // スライドショー: outside でのみ動作、interval で画像送り。
  useEffect(() => {
    if (mode !== "outside" || !hasUser) return;
    const work = works[currentWorkIndex];
    if (!work || work.imageUrls.length <= 1) return;
    const t = setInterval(() => {
      setCurrentImageIndex((i) => (i + 1) % work.imageUrls.length);
    }, SLIDESHOW_INTERVAL_MS);
    return () => clearInterval(t);
  }, [mode, works, currentWorkIndex, hasUser]);

  const setMode = useCallback((next: BgmMode) => {
    setModeState((prev) => (prev === next ? prev : next));
  }, []);

  const setVolume = useCallback((v: number) => {
    setVolumeState(Math.max(0, Math.min(1, v)));
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => !m);
  }, []);

  const unlock = useCallback(() => {
    setUnlocked(true);
  }, []);

  const skipTrack = useCallback(() => {
    if (mode === "outside") {
      setCurrentWorkIndex((i) =>
        works.length > 0 ? (i + 1) % works.length : 0
      );
    } else {
      // エンディング遷移中/再生中はスキップ不可 (勝敗演出を優先)。
      if (endingActiveRef.current) return;
      const work = works[currentWorkIndex];
      const audio = audioRef.current;
      if (!work || !audio) return;
      const pool =
        work.gameTracks.length > 0 ? work.gameTracks : work.titleTracks;
      if (pool.length === 0) return;
      const currentRelativeUrl = audio.src.replace(location.origin, "");
      const currentIdx = pool.findIndex((t) => t.url === currentRelativeUrl);
      const next = pool[pickRandomIndex(pool.length, currentIdx)];
      if (!next) return;
      audio.src = next.url;
      // play() は canplay リスナ、currentTrackUrl は loadstart リスナが拾う
    }
  }, [mode, works, currentWorkIndex]);

  const transitionToEnding = useCallback((): Promise<void> => {
    if (endingActiveRef.current) return Promise.resolve();
    endingActiveRef.current = true;
    const audio = audioRef.current;
    const work = works[currentWorkIndex];
    // エンディング曲が無い作品 (manifest 側で staff_roll 代用済み) はタイトル曲で代用。
    const pool =
      work == null
        ? []
        : work.endingTracks.length > 0
          ? work.endingTracks
          : work.titleTracks;
    const track = pool[Math.floor(Math.random() * pool.length)];
    if (!audio || !track) return Promise.resolve();

    return new Promise<void>((resolve) => {
      let settled = false;
      let fadeTimer: ReturnType<typeof setInterval> | undefined;
      let startTimeout: ReturnType<typeof setTimeout> | undefined;
      const onPlaying = () => finish();
      const finish = () => {
        if (settled) return;
        settled = true;
        if (fadeTimer !== undefined) clearInterval(fadeTimer);
        if (startTimeout !== undefined) clearTimeout(startTimeout);
        audio.removeEventListener("playing", onPlaying);
        if (endingAbortRef.current === abort) endingAbortRef.current = null;
        resolve();
      };
      // モード切替等での中断: src には触らず音量だけ戻して resolve する
      // (呼び出し側が直後に次のトラックを src へ流す)。
      const abort = () => {
        audio.volume = volumeRef.current;
        finish();
      };
      endingAbortRef.current = abort;

      const startEnding = () => {
        audio.loop = true; // 勝敗画面の滞在時間は不定なのでループ
        audio.src = track.url;
        audio.volume = volumeRef.current;
        // play() は canplay リスナが発火する。実際に鳴り始めた playing で resolve。
        audio.addEventListener("playing", onPlaying);
        startTimeout = setTimeout(finish, ENDING_START_TIMEOUT_MS);
      };

      // 停止中 (autoplay block 等) はフェード不要で即切替。
      if (audio.paused || !audio.src) {
        startEnding();
        return;
      }
      const startVolume = audio.volume;
      const fadeStart = performance.now();
      fadeTimer = setInterval(() => {
        const k = Math.min(
          1,
          (performance.now() - fadeStart) / ENDING_FADE_OUT_MS
        );
        audio.volume = startVolume * (1 - k);
        if (k >= 1) {
          clearInterval(fadeTimer);
          fadeTimer = undefined;
          startEnding();
        }
      }, ENDING_FADE_TICK_MS);
    });
  }, [works, currentWorkIndex]);

  const resumeFromEnding = useCallback(() => {
    if (!endingActiveRef.current) return;
    endingAbortRef.current?.();
    endingActiveRef.current = false;
    const audio = audioRef.current;
    if (!audio) return;
    audio.loop = false;
    const work = works[currentWorkIndex];
    if (!work) return;
    const pool =
      work.gameTracks.length > 0 ? work.gameTracks : work.titleTracks;
    const next = pool[Math.floor(Math.random() * pool.length)];
    if (!next) return;
    audio.src = next.url;
    // play() は canplay リスナ、currentTrackUrl は loadstart リスナが拾う
  }, [works, currentWorkIndex]);

  const currentImage = useMemo(() => {
    const work = works[currentWorkIndex];
    if (!work) return null;
    return work.imageUrls[currentImageIndex] ?? null;
  }, [works, currentWorkIndex, currentImageIndex]);

  // 現在の曲名は currentTrackUrl + works から派生する。
  // 該当 work の title/game プールから URL マッチで引く。
  const currentSongName = useMemo(() => {
    if (!currentTrackUrl) return null;
    const work = works[currentWorkIndex];
    if (!work) return null;
    const all = [...work.titleTracks, ...work.gameTracks, ...work.endingTracks];
    return all.find((t) => t.url === currentTrackUrl)?.songName ?? null;
  }, [currentTrackUrl, works, currentWorkIndex]);

  const value: BgmContextValue = {
    works,
    currentWorkIndex,
    currentImage,
    currentTrackUrl,
    currentSongName,
    mode,
    volume,
    muted,
    unlocked,
    initialReady,
    setMode,
    setVolume,
    toggleMute,
    unlock,
    skipTrack,
    transitionToEnding,
    resumeFromEnding,
  };

  return <BgmContext.Provider value={value}>{children}</BgmContext.Provider>;
}

export function useBgm(): BgmContextValue {
  const ctx = useContext(BgmContext);
  if (!ctx) throw new Error("useBgm must be used within BgmProvider");
  return ctx;
}
