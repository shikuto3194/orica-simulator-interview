# Audio Asset Pipeline

ゲーム用 BGM / SE の生成・管理パイプラインの設計例。記載コマンド/APIは現在の環境での実行証跡がなく、動作確認済み手順として扱わない。
ACE-Step 1.5 をローカル AI 音源生成エンジンとして使用する。

---

## 1. ACE-Step 1.5 概要

- **ローカル AI 音楽生成エンジン**（テキスト → 音楽）
- 歌詞付き楽曲 / インストゥルメンタル両対応
- 最大 10 分の長尺生成可能
- LoRA 学習で世界観に特化したスタイル固定が可能
- GitHub: https://github.com/ACE-Step/ACE-Step-1.5

### 1.1 ハードウェア要件

速度・VRAMはモデル版、生成秒数、精度、batch、GPUと同時負荷で変わる。条件不明の「秒/曲」を容量保証に使わない。
導入時は使用commit/設定と短い試行の出力・時間・ピーク資源を記録し、APIの要求/応答もその版で確認する。

### 1.2 インストール

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
git clone https://github.com/ACE-Step/ACE-Step-1.5.git
cd ACE-Step-1.5 && uv sync

# Gradio UI 起動（手動確認用）
uv run acestep

# REST API サーバー起動（Claude Code 連携用）
uv run acestep-api
# → http://localhost:8001

# ハイブリッドモード（UI + API 同時）
uv run acestep --port 8001 --enable-api --backend pt
```

モデルは初回起動時に自動ダウンロードされる。

---

## 2. Claude Code 連携

### 2.1 REST API 経由（推奨）

`acestep-api` を起動した状態で、Claude Code の Bash ツールから直接呼び出す。

```python
import requests, shutil

res = requests.post("http://localhost:8001/generate", json={
    "prompt": "dark dungeon ambient, orchestral, tense, minor key, loop-ready",
    "duration": 60,
    "instrumental": True
})
shutil.copy(res.json()["audio_path"], "assets/audio/bgm_dungeon.wav")
```

### 2.2 CLAUDE.md への記載例

```markdown
# 音源生成
BGM や SE を生成する場合は ACE-Step REST API (localhost:8001) を使うこと。
生成ファイルは必ず assets/audio/ に保存する。
```

---

## 3. ゲーム用途の活用機能

| 機能 | 用途 |
|------|------|
| Repaint モード | 特定時間セグメントだけ再生成（サビ差し替え等） |
| 楽器トラック抽出 | BGM からドラム/ベース/ボーカル等を分離 → SE 流用 |
| LoRA 学習 | 数曲で世界観スタイルを固定 → 全 BGM が同じトーンに |
| 10 分生成 | 長いフィールド BGM も 1 回で生成 |

### 3.1 抽出可能トラック

vocals, backing_vocals, drums, bass, guitar, keyboard, percussion, strings, synth, fx, brass, woodwinds

---

## 4. ファイル構成

```
assets/
  audio/
    bgm/           # BGM ファイル
      title.wav
      battle.wav
      field.wav
    se/             # 効果音
      summon.wav
      attack.wav
      damage.wav
    prompts/        # 生成時のプロンプト記録
      title.txt
      battle.txt
```

### 4.1 命名規則

- BGM: `bgm_{シーン名}.wav` (例: `bgm_title.wav`, `bgm_battle.wav`)
- SE: `se_{アクション名}.wav` (例: `se_summon.wav`, `se_attack.wav`)
- プロンプト: 同名の `.txt` に生成プロンプトを保存（再現性のため）

---

## 5. GUI 統合

### 5.1 BGM 再生

- タイトル画面: `bgm_title.wav` をループ再生
- バトル画面: `bgm_battle.wav` をループ再生
- 結果画面: 勝利 / 敗北で分岐

### 5.2 SE 再生

- 召喚時: `se_summon.wav`
- アタック宣言: `se_attack.wav`
- ダメージ: `se_damage.wav`
- バースト発動: `se_burst.wav`

### 5.3 実装方法

Web Audio API または `<audio>` タグで再生。
音量コントロールとミュート設定を UI に追加する。

```typescript
// 最小実装例
const bgm = new Audio("/assets/audio/bgm/battle.wav");
bgm.loop = true;
bgm.volume = 0.5;
bgm.play();
```

---

## 6. LoRA 学習による世界観統一

1. 3〜5 曲の参考楽曲を用意（ゲームの世界観に合うもの）
2. ACE-Step の LoRA 学習機能で学習
3. 以降の全 BGM 生成にそのスタイルを適用
4. 「東方風」「ダークファンタジー風」等のスタイル固定が可能
