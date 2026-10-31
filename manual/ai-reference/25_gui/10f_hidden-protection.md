# 耐性・導託・転醒の回帰シナリオ

[シナリオ索引](10c_scenario-test-reference-card-regressions.md)

- `hidden-protection`: 針妙丸のネクサス/ミラージュ/バーストを合計0〜3選択。耐性バーストの証明公開と残置。Alice GUI / `owner=bob&viewer=bob` REST。
- `oracle-continuation`: 打ち出の小槌の3巡配置で、同一効果内の導託が各1回。Alice GUI / `owner=bob&viewer=bob` REST。
- `rebirth-combined-layout`: 柱斧の転醒合体待ちを通信し、B面で合体。900×540の疲労合体と魂状態/クォーツの間隔。Alice GUI / `owner=bob&viewer=bob` REST、`owner=bob&combined=1`で相手側へ反転した合体後の画面。

各 `e2e/scenario-<シナリオ名>.spec.ts` が操作と解決後の盤面を検査する。

関連する既存シナリオ `mars-effects` はスレインの配置。`mode=dioscuria` はヘラス取得、`mode=queue` は導託18件。Alice GUI / `owner=bob` REST。`e2e/scenario-mars-effects.spec.ts`。

- `?scenario=blazing-star-oracle`: 添付盤面の宵越しの銭・ブレイジングスター・小町を配置時導託で破棄。小町で1コア、ブレイジングスターの任意回収でさらに1コア。Alice GUI / `owner=bob` のBob RESTで合計2個と画面への同期を確認する。

- `?scenario=oracle-trigger-kinds`: BSTH03-X02の盤面でC03のアクセルを使い導託が発生しないことを確認。`mode=explicit-accel`はBSTH08.5-X03/C20で印字されたアクセル神託を確認。`owner=bob`でREST側を比較。
