# 公開用 dist の境界

GitHub への push は開発ソース・テスト・資料も含めて従来どおり行う。
公開対象は `pnpm build` が生成する `apps/playground-web/dist/` のみ。
ルートや他パッケージの `dist/` を配信先に指定しない。

## URL を知っている人向けの公開

- 検索結果への掲載を抑止し、URL から利用する運用とする。
  `index.html` の robots meta に `noindex, nofollow` を指定する。
- Netlify は `public/_headers` から dist にコピーされた設定で、画像・音源を含む
  全公開ファイルに `X-Robots-Tag: noindex, nofollow` を付ける。
  このファイルも含めて dist を再配備する。別ホストへ移す場合は同じヘッダーを設定する。
- `robots.txt` の `Disallow: /` は追加しない。クロールを遮断すると検索エンジンが
  `noindex` を読めず、URL が検索結果に残ることがある。
- これはアクセス認証ではなく、URL の直接入力・ブックマーク・共有リンクは利用できる。
  既存の検索結果からの除外は検索エンジンの再クロール後に反映される。
- 再配備後は `/` と `/images/ForGUI/card-back.jpg` のレスポンスヘッダー、
  HTML の robots meta、URL からのタイトル画面表示を確認する。
  ローカルの成果物確認だけでは公開先への反映完了とは扱わない。

出典（2026-09-19確認、信頼度A、運用に採用）:
[Google noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing)、
[Netlify custom headers](https://docs.netlify.com/manage/routing/headers/)。

## 含める機能と素材

- タイトル、ログイン、カード検索、デッキ構築、対戦ルーム、観戦。
- 1人バトルとその簡易対戦ロジック、ランダムデッキ生成。
- バグ報告用スナップショットの保存・読み込みと盤面の復元。
- [棋譜保存・読み込み・操作再現と選択デッキでの再戦](../25_gui/19_replay-and-rematch.md)。
- 1人バトル・復元盤面はブラウザ内で動作し、開発用 `/api/game` 同期を行わない。
- カード定義に参照される表裏の画像、GUI 素材、登録アバターのアイコンと全身WebP、属性アイコン。
- `WORKS` 登録作品のタイトル背景と BGM。素材は従来の事前キャッシュ対象にも含む。

## タイトル背景・BGM の配備前提

- `images/title/**/*.webp` と `sounds/music/**/*.m4a` は Git 管理し、clone だけで揃う。
  JPG/PNG/MP3の編集元は手元に残し、公開・Git管理・事前保存の対象から除く。
- 追加・更新は `pnpm bgm:prepare`（FFmpeg / ffprobe が必要）。背景は解像度を維持した
  WebP品質88、音源はAAC 128kbps / M4A faststartへ変換する。元音源の不要なタグ・
  ゼロ埋めを除去し、全曲の長さ・チャンネル数・復号成功と全画像の寸法を検証する。
  曲をカットしたり音量を変更したりはしない。変換記録は `artifacts/bgm-prepare/report.json`。
  元素材の復元が必要な場合だけ `pnpm fetch-bgm-assets` を使う。通常のbuildにFFmpegは不要。
- 公開ビルドは `WORKS` の各作品に背景・音源が最低1件ずつ存在するか検査し、
  空の作品があれば失敗する。部分復元も検出する。
- dev・CI・Netlifyすべて同じ圧縮素材を使う。Git連携は通常の `pnpm build` で一式を配備できる。
- 配備後の `/bgm-manifest.json` と `/asset-manifest.json` に背景・曲が収録され、
  素材URLが画像・音声として応答すること、ログイン後に背景・曲名・曲送りが動くことを確認する。

## カード画像の保存と配信

- `images/BS*.webp` は Git 管理し、clone だけでカード画像が揃う。
  解像度を変えない可逆 WebP とし、元 PNG は Git 管理外で手元に残す。
- 追加・更新は `pnpm images:prepare`。表示画素と透明度を全件照合し、
  WebP とカード定義の `image` を一緒に更新する。編集元の復元は `pnpm fetch-images`。
- dev / 公開ともカード表示には WebP を使う。元 PNG は事前保存の一覧にも含めない。
  公開ビルドは表裏を含む参照画像が欠けると失敗する。
- 公開先の `/images/…webp` から配信し、既存の素材保存・差分更新を利用する。
  外部の画像 CDN は不要。タイトル背景・BGMもGit管理の圧縮素材を使う。

## 含めないもの

- `?scenario=` / `roomHarness` の検証用入口・シナリオデータ。
- `packages/ai` の LLM 基盤、CLI、学習・自己対戦・MCTS・AI 観測エンコード。
- テスト、開発スクリプト、資料、source map。
- 参考画像、アバター元素材（立ち絵・元PNG・制作記録）、未登録・未参照の画像や音源。全身画像は登録20体のWebPだけを公開する。

## 実装と変更時の確認

- `main.tsx` は Vite の `DEV` 時だけ `development.ts` を読み込む。
  `NODE_ENV=development` でのビルドは拒否する。開発機能は正準 dev server で利用する。
- 本番の rules-core alias は `src/runtime.ts` を参照する。
  従来の `src/index.ts` は runtime と AI の両方を再公開し、既存の開発 API を維持する。
  `randomDeck` は `card/random-deck.ts` を共通正源にし、1人バトルと学習で共有する。
  支払い・対象・配置などの入力候補は `action-input-choices.ts` を共有し、簡易AIも必須入力を補完する。学習専用の分割選択・観測・探索はruntimeへ含めない。
- `server/public-build.ts` が公開素材を選び、実際の JS 出力に開発/AI モジュールが
  残っていれば build を失敗させる。`public/` への無審査のファイル追加も拒否する。
- `server/image-assets.ts` は公開素材だけを manifest に載せ、同じ一覧から dist へコピーする。
  dev server は従来どおり開発素材も扱う。ビルド時に古い dist を空にしてから再生成する。
- `pnpm build` の TypeScript 処理では開発パッケージも検証・生成するが、
  それらの成果物は公開用 `apps/playground-web/dist/` に入らない。
- `vite.config.ts` は dev server 起動時だけサーバー用 `.env` と Game API を順に読み込む。
  静的 build / preview は `SUPABASE_SERVICE_ROLE_KEY` 不要。Netlify は build command を
  `pnpm build`、publish directory を `apps/playground-web/dist` にする。
  秘密キー未設定での設定読み込みは `test/vite-config.test.ts` で回帰検証する。
  [Supabase の秘密キー](https://supabase.com/docs/guides/getting-started/api-keys) は
  サーバー専用であり、`VITE_` 接頭辞でフロントエンドへ渡さない。
- `pnpm build` 後、`pnpm exec playwright test e2e/public-build.spec.ts` で実際の dist を
  静的配信し、開発入口の無効化、1人バトル、スナップショット入出力を確認する。
  CI の scenario gate にも含む。dev の GUI/REST は `scenario-four-of-a-kind.spec.ts` で検証する。

この境界は機能の公開可否を自動判定するものではない。新しい未完成機能は
`development.ts` 側へ置き、公開へ追加するときにビルド検査と GUI 動作を確認する。
対戦ルーム等のサーバー API は静的 dist に含まれず、公開時には別途サーバーが必要。
