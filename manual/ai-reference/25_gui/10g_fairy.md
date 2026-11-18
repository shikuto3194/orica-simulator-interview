# 妖精の召喚元・コスト回帰

`?scenario=fairy-use-origin` はBSTH07.8-XX01のLv2導域を確認する盤面。通常召喚後に導域を選択・解決し、相手の応答後に手札+1・デッキ-1を確認する。

- `mode=cost`: 妖精3体が同時アタック中。手札のBSTH07.8-X01で界放し、必要コスト0・導界者からコア3個移動・召喚後の導域を確認する。
- `owner=bob&viewer=bob`: Bob側へ反転。省略時はAlice側。
- `manualOpponent=1`: 相手の応答を手動化。

回帰テスト: `e2e/scenario-fairy-use-origin.spec.ts`（Alice GUI / Bob REST、通常召喚・界放の4シナリオ）。

`?scenario=cirno-divine-release-payment`: Telegram 629905089の最小盤面。妖精2体が攻撃中、導・緑の2軽減、リザーブ0、リリーブラックに3コア。通常スピリットの1コアでチルノの召喚コストを払い、支払い元の消滅待機を終えても界放の3コアだけで召喚完了する。`owner=bob&viewer=bob&manualOpponent=1`で反転。`e2e/scenario-cirno-divine-release-payment.spec.ts`はAliceの手札選択・支払いとBob REST、界放コア・導界者を支払い元に指定した不正入力の拒否と盤面不変を検証する。

同じシナリオで途中合流も検証する。召喚成立→神託・召喚時効果と派生処理→「アタックしますか？」の順で、相手のフラッシュパスを待たずに選ぶ。参加宣言への相手のスタック応答後、チルノが疲労し同じ攻撃groupへ参加する。辞退なら回復状態を保ち、その参加機会を消費する。いずれも元のフラッシュ優先権・連続パス数を維持する。Alice GUI / Bob RESTで参加・辞退の4ケースを確認する。候補は維持コア確定後の共通召喚イベントから記録し、場入り保留・取消・合体部品を含めない。裁定正源: [05b](../10_rules/05b_multi-attack-designated-attack-lifecap.md#召喚後の即時アタック参加bsth078-xx01)。

複数候補は個体ごとに参加・辞退を選択できる。`e2e/scenario-immediate-attack-join-order.spec.ts`はAlice・Bobの両側で後方の候補を先に参加させ、残った個体の選択権と元のフラッシュ状態を確認する。Playwright実行時は`--tsconfig tsconfig.base.json`を指定する。

[カード回帰一覧](10c_scenario-test-reference-card-regressions.md)
