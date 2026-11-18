# アプリアイコン

採用原本は `icon.png` の1枚。104×104の透過PNGをそのまま保存し、配信用サイズだけを生成する。

リポジトリのルートで再生成:

```powershell
node scripts/generate-app-icons.mjs
```

生成先は `apps/playground-web/public/`:

- `pwa-192.png` / `pwa-512.png`: 透過を保持。ブラウザーとPWAの通常アイコン。
- `apple-touch-icon.png`: 180×180。アプリの背景色で透過部分を埋める。
- `pwa-maskable-512.png`: 512×512。図柄を320×320に収め、端末のマスクで欠けない余白を設ける。

`index.html` と `vite.config.ts` はこの配信用ファイルを参照する。
原本の解像度を超えるサイズは拡大版であり、絵柄の描き直しは行わない。
