# Custom Extension Policy

この文書は、**公式バトスピをベースにしつつ、ユーザー独自カード/独自裁定を安全に engine へ乗せるための設計方針**をまとめる。

## 基本方針

- 公式バトスピの既存設計を捨てない。
- custom mechanic は、既存 core の上に extension として積む。
- 公式ルールで説明できる部分は、まず公式モデルへ寄せる。
- 公式で説明できない部分だけ、新しい keyword / window / host model を足す。

## カスタムソースの優先順

1. ユーザーサイトの Q&A / 裁定
2. ユーザーサイトのカード本文
3. ユーザーサイトの errata
4. ユーザー確認

補足:

- 実装判断に使った custom source は、`00_meta/source-map.md` と必要な `source-findings-custom.md` に必ず残す。
- あいまいなら `00_meta/open-questions.md` へ逃がし、推測で固定しない。
- errata は基本的にカード本文へ反映済みの更新履歴として読む。
- サイト内ソースだけでは閉じない場合は、既存の確認済み裁定を探し、不足する判断をユーザーに確認する。回答と適用範囲は同ターンで関連ルール章・調査記録へ反映する。

## 拡張の分類

### 1. enum / subtype 追加で済むもの

例:

- `導界者ネクサス`
- `導シンボル`
- `黒`
- `七色`

推奨:

- `keywordTags`
- subtype
- color / symbol enum 拡張
- 判定 helper

### 2. timing layer 追加が必要なもの

例:

- `スタック`

推奨:

- `window` 追加
- priority loop 追加
- trigger / interrupt の構造化

禁止:

- `flash` の特例分岐だけで無理やり吸収すること

### 3. host-subcard / set model が必要なもの

例:

- `クォーツ`
- `星霊衣`
- `アルドノアドライブ`

推奨:

- host と subcard を分ける
- slot / limit / set cost / inherited effects を構造化する
- cardNo 直書きではなく generic host model を先に作る

### 4. state / mode 拡張が必要なもの

例:

- `タイプ：作戦`
- `分身スピリット`

推奨:

- `zone` 追加だけで済ませず、`mode` / `proxy` / `temporary treated-as` を検討する

補足:

- `魂状態` は custom mechanic ではなく、公式側の `state / mode` 先例として参照する。
- `待機状態` は、既存の `pendingLeaveKind` で表現している公式 leave-field 待機であり、custom extension とは分けて扱う。

## 実装の入口

custom card を追加するとき、まず次を判定する。

1. 既存 official model だけで表現できるか
2. `keywordTags` / subtype / enum 拡張で足りるか
3. timing layer が必要か
4. host-subcard model が必要か
5. source precedence に errata / Q&A が絡むか

## 実装状況と着手順

現在の作業は [ToDo](../30_plan/02_detailed-todo.md) と [issue索引](../../../issues/00_index.md)、機構ごとの根拠は [特殊メカニクス索引](../10_rules/08_advanced-mechanics.md) を参照する。
本書に「未着手」「全対応」や次のギミックを別管理しない。型があること、実行経路があること、対象カード・GUIを検証したことを分けて判断する。

新規カードは [カード追加判断表](04_card-addition-decision-table.md) に従い、既存DSL・汎用機構で表現する。機構が足りない場合は原文の意味を保つ共通拡張を先に検討する。

## ユーザー確認が必要な条件

次のどれかに当たったら、実装を進める前にユーザーへ確認する。

- 用語の一般ルールがサイト内で見つからない
- カード本文と Q&A のどちらを優先すべきか不明
- 1つの mechanic が pack 固有なのか汎用なのか不明
- official rule と custom rule が衝突している
