# Source-text Accountability Ledger

カード本文の網羅性と、意味的な実装済み主張を混同しないための監査契約。
DSL の `textRef` 自体の仕様は
[12_dsl-specification.md](./12_dsl-specification.md) を正源とする。

## 実行

`pnpm cards:text-ledger --gate` は、表裏を含む全 nonblank `textLines` に機械可読な
accountability result を作る。結果 JSON はローカルの `text-accountability-audit.json`。

各行は次のいずれかとして記録する。

- `structural_only`: 当該行を直接含む `effects[].textRef` に対応する。
  これはカード固有の意味的同値を主張しない。
- `carrier_contract`: `adventData` などの structured carrier と、対応付けた実行可能な
  `it` / `test` case に対応する。
  carrier test は個別カードの全意味差分を自動的に証明するものではない。
- `general_rule`: ルール正源と runtime test に対応する。
- `exemption`: runtime 対象外である理由を明記する。
- `legacy_actionable`: 既存の未帰属行。語彙にかかわらず全件を `actionable` として後続作業に出す。

見出しの有無で本文を skip しない。別行の effect や同じ非空ブロックの存在だけでは、見出し・
タイミング・Lv 条件を対応済みにしない。`keywordTags` / effect object の存在だけで、原文と意味的に
等価と判定してはいけない。実行テストはカード/effect identity、対象・条件、最終状態を踏み、
ランダム対戦回数を semantic evidence の代替にしない。

## Legacy baseline と変更検出

初回に確認した既存ギャップは
`scripts/card-text-accountability-baseline.json` に source hash 付きで固定する。baseline と異なる
本文、または新規の未帰属本文は gate を fail する。baseline の再作成は明示的な
`--write-baseline` で main 導入前の初期 seed にだけ行える。初期 seed は current unclaimed line を hash まで完全照合し、
source manifest hash と main revision も照合する。main に導入された後の baseline 差分は gate が
常に拒否する。初期化時に main と差分のある `packages/card-data/src` も拒否するため、baseline 差分と
カード本文差分を同じ変更、または二段階の予約で bless できない。

legacy 未帰属行は、文言の語彙にかかわらず全件を actionable backlog とする。baseline 行を削除・
変更して消すことは gate failure であり、同じ id/hash の行を `textRef` / carrier / rule / exemption で
明示的に解消した場合だけ、解消根拠を ledger に残して許可する。
`executionLike` は着手優先度を補助するヒューリスティックであり、制約・禁止・回数制限などを
出力から除外する判定には使わない。

個別の carrier / general rule / exemption は
`scripts/card-text-accountability-overrides.json` に理由、behavior、`testRefs`、および
`testEvidence`（そのうちの実ファイルと実行可能な `it` / `test` case title）を添えて登録する。
個別 override の case title は card identity と behavior を明記し、コメント内の文字列一致では通らない。
ledger gate は source 正規表現ではなく `vitest list` が実際に発見した non-skip case を照合するため、
文字列リテラル・到達不能分岐・`it.skip` は evidence にならない。
general rule はさらに `manual/ai-reference/10_rules/*.md:<開始行>-<終了行>` の実在する rule source を
指定する。組み込み carrier / general rule も、同じく behavior と実行可能 test evidence を manifest に
持つ。carrier override は指定 path に実在する carrier を解決できなければ無効であり、空の test file、
任意の path、またはコメントだけでは contract にならない。

## coverage / fidelity と表裏

- 面の列挙は監査コアの `collectCardFaces()` を共用する。デッキ用の `ALL_CARDS` は変更せず、
  coverage の `totals` / `sets` はA面・B面を別々に数える。`todoCards` に未実装面の番号を出す。
- `cards:coverage` はB面と nested effects も集計する。転醒の共通説明だけの面は vanilla。
- `cards:fidelity` は表裏ごとに本文と textRef を照合する。タイミング見出し（Lv付き・合体中・セット中を含む）も
  `uncovered_line` の対象。A面の textRef でB面を対応済みにしない。nested effects の textRef は当該面で合算する。
- 神技などの専用carrierの帰属は本台帳が検証する。nested effects に textRef が無いだけで孤立effect扱いにしない。
  直接の effects で textRef が無い・空なら fidelity の `no_textref`。
- フルランは coverage todo を cards lane、fidelity violations を engine lane の既存入力として扱う。
  本台帳の legacy baseline に入っていても、coverage / fidelity の検出を免除しない。
