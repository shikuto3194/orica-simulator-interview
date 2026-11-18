# 対応済み依頼の受入証跡

既存follow-up queueとharnessの成功履歴を使い、同じ内容の依頼確認で共通検証を繰り返さない。
依頼の選択・回転・通常検証は維持する。P2-15の未コミット作業自動引継ぎは対象外。
検証全体の正源は [harness-validation](harness-validation.md)。

## 作業者が確認すること

1. `supervisor-followup.mjs summary --repo <hub>` と受付原本を読み、依頼IDごとに原文・解釈・添付・後続条件を確認する。
2. 各受入条件と修正commitを列挙し、現行コードと実際の回帰assertionの対応を確認する。文言の類似、別の依頼の完了、process exit 0だけでは代用しない。
3. 同じcheckoutの `logs/harness/runs/` から必要な成功gateを確認する。有効な証拠があれば再実行しない。証拠不足・新条件・コードや依存変更・影響不明なら通常の必要検証へ戻す。既存のfinish/push/merge/CIの契約は変更しない。
4. 修正後は通常のgate・独立verifier・commitを終え、cleanなcommitを対象に下記の受入記録を登録する。公開前は閉じず、親への統合要求を継続する。既修正の場合も公開mainへの採用確認を必須とする。

自然言語の要件とテストの意味対応は作業者の責任である。機械判定は全文同一性・明示した全条件の検査証拠・公開採用を照合する。
指定テストが原文の一部分しか扱わない場合、残りを省いて記録してはいけない。UIや実稼働条件をunitの成功だけで満たしたと扱わない。

## 登録と一括解消

入力JSONは `.codex-temp/` 等の既存成果物領域に保存する。次は書式例であり、実際のID・40桁commit・原文に対応するテストへ置き換える。

```json
{
  "schemaVersion": 1,
  "requests": [{
    "id": "followup-0123456789abcdef0123",
    "fixCommit": "0000000000000000000000000000000000000000",
    "coverageReview": "受付原文と添付の全条件を照合した根拠と、下記assertionが各条件を満たす理由",
    "conditions": [{
      "requirement": "原文に対応する観測可能な受入条件",
      "coverage": [{
        "gate": "vitest",
        "testFile": "packages/rules-core/test/example.test.ts",
        "assertion": "実際の成功テスト名",
        "titlePath": ["describeの名前", "実際の成功テスト名"]
      }]
    }]
  }]
}
```

```sh
node scripts/supervisor-followup.mjs record-acceptance --repo <hub> --worktree <checkout> --input <input.json>
node scripts/supervisor-followup.mjs reconcile-acceptance --repo <hub> --worktree <checkout>
```

同じ成功gateが別IDの全条件も覆う場合、各原本を個別確認して同じ `requests` へ含める。
登録はpendingを消さない。reconcileは公開mainとlocal mainとcheckout HEADの一致、修正commit包含、証拠の有効性を確認したIDだけをまとめて解消する。
不一致のIDは理由付きでpendingを保持する。結果の `validationRuns: 0` は照合中に検査を起動していない意味であり、新しい実検証の成功件数ではない。

定期runnerは既存排他・同期の後、通常の依頼選択より先にreconcileを実行する。
有効な証拠のあるIDはworkerに再配分せず、証拠のないIDは従来どおり選択する。同じIDに受付原本が複数あっても1件と数え、全原本を参照する。
旧 `resolvedNote` や過去の自然文報告を機械的に受入証跡へ変換しない。

## 証拠の条件

- 記録は `logs/codex-supervisor-followups/acceptance/<ID>.json`。解消時には条件・修正・検証ログhash・公開SHAと確認時刻をresolved記録にも保持する。
- 依頼本体と受付原本全体を固定し、添付の実bytesを受付時hashと照合する。再wakeの `supervisorRequest` だけは要件ではないので除く。原文・添付・出現回数・他の未知フィールドの変更は失効する。
- 写真は取得した実bytesのSHA-256を受付時に保存し、受付原本まで保持する。hashのない旧受付は自動登録・解消しない。実CLIと写真取得→受付原本→受入登録の回帰で、関数単体だけでなくこの接続も検証する。
- ソースtree・全source・Node/OS/CPU・依存・環境ファイル・監査入力・検証に関わる環境を固定する。checkoutをまたぐ成功ログ移植は認めない。
- 通常検証と受付確認は `isVerificationEnvironment` の共通入力ポリシーを使い、workerとcronで変わる既知の配送・LLM起動メタデータを除く。データ参照先、未知の `ORICA_*`、計算・テスト設定は保持する。通常finish・push・mergeは、同一checkoutで対応する入力・比較範囲が一致する元のfresh成功を再利用できる。full・CI・`--fresh` はfreshのまま。受付証拠の新規登録は次項の条件を満たす元の実行を要求し、再利用だけから作らない。詳細は [harness-validation.md](harness-validation.md) を参照する。
- 専用fingerprintのない旧ログ、失敗・実行中・再利用のみの成功、diff範囲限定gate、常にfreshなgateを根拠にしない。後続失敗・未完了runは以前の成功を無効化する。ログ欠落・変更も失効する。
- 通常runnerはVitest/PlaywrightのJSON結果を同じ `logs/harness/output/` に保存する。テストファイル・`titlePath`全階層・成功statusを完全一致で照合し、Playwrightは `project` も指定する。Vitestは既存JSON reporterを拡張して実runnerの `retryCount` を保存し、0だけを受理する。通常のretry設定は維持し、回数欠落の旧JSON・skip・flaky・同名重複や部分一致は受理しない。絞り込みVitestは実際に成功した個別条件だけに使い、全件成功や通常push/mergeのcacheへ昇格させない。
- `it.each` やtemplateで生成したテスト名も、同じsource fingerprintの実JSONにある完成形の `titlePath` で照合する。完成名がソースの文字列リテラルにあることは要求しない。未実行の展開、別suite/file/project、skip・retryは従来どおり拒否する。運用回帰のsummaryは次項のソース・実出力照合を維持する。
- 運用回帰は登録gateの実在するGit管理下の参照から到達するテストの `[test-*] passed:` 行とソースを照合する。fixture用の架空script文字列は実importとして辿らない。
- 未対応の証拠形式では自動解消しない。必要な検証を実行して証拠形式を整えるか、従来の手動確認で根拠を残す。無関係なgate名や存在しないassertionで機能要件を閉じない。

## 書込み中断の復旧

enqueueとresolveはID単位の `writes/<ID>.lock` で短い書込みを直列化する。新しい受付を古い証拠で削除しない。
通常終了はtokenを確認して自分のmarkerだけを削除する。異常終了やtoken不一致はmarkerと依頼を保持し、診断に対象pathを出す。

残留時は `pid`・`token`・`startedAt` と対象IDを保存し、記録ownerと同じIDへのqueue書込み処理が終了していることを確認する。
情報不足・生存中・権限拒否なら保持する。確認できた場合だけそのmarkerを証拠保全後に除き、同じreconcile/受付操作を再試行する。
queue全体・他のmarker・lane lock・検証leaseの削除や、生存プロセスの停止は行わない。
resolved作成後の中断でもpendingは保全されるため、証拠を再照合して同じIDの処理を完了できる。
