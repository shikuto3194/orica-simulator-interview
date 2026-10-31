# アルドノアの召喚時・純化シナリオ

`?scenario=kanjuden` に以下の `mode` を指定する。

- `aldnoah-summon`: C10のただちに下置き後にC03の召喚時を発揮し、コアが1個増える。
- `aldnoah-summon&drive=hand&oracle=1`: 手札C10を3枚、X04を場に追加。宣言前後の画像・本文を確認し、下置き後に神託とC03召喚時へ進む。`drive=field`は場の3枚で確認する。
- `pure-aldnoah`: 表向きのC10を下に持つC03を純化し、分離選択なしで双方が独立した裏向きカード状態になる。
- `pure-aldnoah-facedown`: 既に裏向きの下カードも、親の純化で重なりが解除される。

各 `owner=alice` はGUI、`owner=bob&viewer=alice&manualOpponent=1` はREST操作とAlice側への表示反映を確認する。手札3枚のケースは両者それぞれの視点で非公開宣言の画像を確認する。検査は `e2e/scenario-kanjuden.spec.ts` の「アルドノア」「ドライブ3枚」。既存の `pure-brave` / `pure-contract` では合体ブレイヴの分離・契約カードの魂状態の選択を維持する。

[裁定根拠](../00_meta/source-findings-aldnoah.md) / [カード回帰一覧](10c_scenario-test-reference-card-regressions.md)

`?scenario=aldnoah-no-combine`: 適格なホストがいる盤面からC10を通常召喚する。`owner=alice`のGUI召喚／Bob REST応答と、`owner=bob`のREST召喚／Alice GUI応答で、窓後の合体候補・直接合体モーダル・一時attach・SBA強制分離が発生せず独立したスピリット状態で場入りすることを確認する。`e2e/scenario-aldnoah-no-combine.spec.ts`で状態遷移とDOMを記録する。正源: `10_rules/07b_card-observed-mechanics.md`の【合体条件：合体不可】。

`mars-effects&mode=trash-leave`: ニロケラスの召喚時効果で自分のアリューシアを破壊し、3枚ドロー後にトラッシュの眠れる月の少女を回収。`owner=bob&viewer=bob`でREST操作。`e2e/scenario-mars-effects.spec.ts`。

`mars-effects&mode=moon-girl`: 眠れる月の少女の実効果で火星ネクサス1枚を配置し、後段の「発揮する／発揮しない」へ進む。フィールド通常コア1個とリザーブ通常コア1個を用意。`empty=1`は配置0枚、`owner=bob&viewer=bob`はREST操作。`e2e/scenario-moon-girl.spec.ts`が辞退・両コア源からライフへの移動・後段なしをGUIとRESTで検査する。発揮宣言・マジックのコスト支払いはこのシナリオの範囲外。
