# 修正途中の単体確認

実装運用ルールの正源は [CLAUDE.md](../../../CLAUDE.md)。最終受入は [検証運用](harness-validation.md) に従う。

修正途中のVitest単体回帰は、repo相対の実ファイルを指定する。

```sh
pnpm test:unit packages/rules-core/test/example.test.ts
```

- `packages/**/test/**/*.test.ts` または `apps/**/test/**/*.test.ts` にある実ファイルを列挙する。未stageの新規テストも対象にできる。
- 無指定・ディレクトリ・glob・オプション・ignored/外部/リンク経由のファイルは拒否する。空白を含むファイル名は引用符で囲む。
- 共有leaseと通常FIFO待機を使い、最大2forkで実行する。待機と実処理の時間は通常harnessログで分けて記録する。
- 指定全ファイルの実行と成功を照合し、失敗・0件・全skip・実行漏れは非zero終了とする。

単体成功は完了証跡や全件Vitest成功の代わりに再利用しない。後発の単体失敗は同じ入力の古いVitest成功を無効化する。最終finish・push・merge・CIの検査選択、独立査読、ledger、fuzz、別tree/rootの統合検証は従来どおり維持する。

## 従来入口の引数

運用回帰も同時に確認する `pnpm test <pattern>` は維持する。テスト名やVitestの追加引数はこの入口で指定する。full/finish/push/merge/CIは追加のVitest引数を拒否する。絞り込みは登録済みscopeで選び、テスト名の指定ミス・収集0件は失敗。無条件の `--passWithNoTests` は使用しない。
