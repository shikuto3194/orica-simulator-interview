# シチュエーションテスト リファレンス — 追加シナリオ

`10_scenario-test-reference.md` からのサイズ超過分割。使い方・視点切替・追加ルールは正源側を参照。

## スタック窓 / 効果内選択

| パラメータ | シナリオ名 | 内容 |
|-----------|-----------|------|
| `post-stack-step-choice-bsge01-c01` | BSGE01-C01 窓後 choice | alice がティアーストーンを1回だけ使用宣言→bob のスタック応答窓→窓後に2枚ドロー / 契約カード回収を選択 |
| `effect-entry-core-choice` | BSTH09-TR01(B) 維持コア選択 | カウント2で公開選択→維持コア選択→残札を2巡。`mode=separation` はBSAZ03-C01の分離。Alice GUI / `owner=bob&viewer=bob` REST。`e2e/scenario-effect-entry-core-choice.spec.ts` |

## P3-56 フィールドオーバーフロー (横スクロール)

| パラメータ | シナリオ名 | 内容 |
|-----------|-----------|------|
| `field-overflow-self` | P3-56 自分側オーバーフロー | alice spirit 12 + nexus 6 / bob 標準。自分側 `.field-center-scroll` 横スクロール起動 / combined-first sort で先頭左端可視 |
| `field-overflow-opp` | P3-56 相手側オーバーフロー | bob spirit 12 + nexus 6 / alice 標準。相手側 rtl 横スクロール / combined 右端固定 |
| `field-overflow-both` | P3-56 両者オーバーフロー | 両者 spirit 10 + nexus 4。自分↔相手 scroll 独立性確認 |
| `field-overflow-with-setaside` | P3-56 オーバーフロー+手元 | alice spirit 8 + nexus 6 + 手元 3。手元有時のネクサス行早期 scroll 起動 / `.set-aside-phantom` 機能確認 |
| `field-card-state` | フィールドのカード状態 | BSAZ03-C01使用後・BSAZ01-C04破棄後の配置をAlice GUI/Bob RESTで確認。`owner=bob`で相手起点、`layout=1`で両側に通常12体/ネクサス4枚/カード状態5枚/手元3枚、`noSetAside=1`で手元なし、`flash=1`で重なった作戦カードの一覧からの使用を確認 |
| `field-overflow-with-combined` | P3-56 オーバーフロー+合体 | alice 合体 2 + solo 6 + nexus 4。combined 端固定 / 隣接 sibling shift (`margin-inline-start`) / nexus 行 selector 非マッチ確認 |
| `field-overflow-combined-only` | P3-56 合体のみオーバーフロー | alice 合体 5 体 (solo / nexus 無)。合体連続 shift / combined-only overflow 時の自然 scroll 挙動確認 |
| `combined-nexus-layout` | 合体ネクサスの外側整列 | 両者の合体魅魔。`pose=exhausted/heavily_exhausted`、`braves=2`、`under=1`、`soul=1`。`mode=divine/spirit/ultimate`で中央線側への切替を確認 |
| `quartz-layout` | クォーツと通常2行の高さ | 報告盤面のENIGMA＋中央クォーツを両者へ配置。`full=1`で左右各3枚、`overflow=1`で通常各10枚。サイズ維持・縦見切れ防止・横方向だけの自動追従を確認 |

## バーストからのクォーツ位置選択

`?scenario=quartz-replacement&mode=burst`はR05の実発動→スタック→セット枝→位置HUDから開始する。中央/右追加と占有右交換、後続破壊・ドロー・カウントを確認。`owner=bob`でREST反転。裁定は[07g](../10_rules/07g_quartz-replacement.md)、回帰は`scenario-burst-quartz-placement.spec.ts`。
