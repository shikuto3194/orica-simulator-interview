# 契約煌臨のシナリオ回帰

[カード回帰一覧](10c_scenario-test-reference-card-regressions.md)から分離した契約煌臨の検証入口。

`contract-advent-leave`: BSTS01-C01リムルの契約煌臨を実行後、相手による破壊待機からBSTS01-CX01契約リムルを魂状態で残す／辞退する。Alice GUI / `owner=bob` REST対応。`e2e/scenario-contract-advent-leave.spec.ts`。

`contract-advent-charge`: BSDB01-CX01魂状態・C08通常4/ソウル1・リザーブ0・手札R01。通常/代替コストでC08から通常コア1個を掴み、R01へ置き、両配分payloadと最終盤面を確認する。0個配置も維持する。owner=bobでREST側を操作する。

`e2e/scenario-contract-advent-charge.spec.ts`のcore-distribution-evidenceには、pendingのallowedSources/sourceAvailable、実測HUD phase、実送信配分、source HEADと関連ファイルのhashを残す。認証header・全GameState・非公開カード定義はコピーしない。詳細は[受付調査](../30_plan/03_completed-milestones-phase-7-8-contract-advent-charge.md)。
