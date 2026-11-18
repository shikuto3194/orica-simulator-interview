# I0 receiptの検査契約

[controller入口](i0-controller.md)のreceipt最終化・失効検査の詳細。
CLIと各OSの受入境界は入口を参照し、本書の形だけで成功を認定しない。

receiptは既存harnessの実行済みfinish/full reportと`ismcts-program` gateの
正確なcommand/argv、開始/終了、exit、テスト件数、結合stdout/stderrログとSHA256を参照する。
必須gate集合の欠落・再利用gate・0件・partial・未来時刻・別root・後続同条件失敗を受理しない。
仕様/コード/テスト/設定/lockとruntimeを照合し、未追跡の新しいISMCTSコードも失効要因とする。
wrapperのplanはworker起動前に行うため、通知先/ticket、browser session trust、Codex起動用の
CLI/model/effort/verbosity/full-run/ref、lane、cluster/hubの配送先という明示キーは
Node受入回帰のruntimeから除外する。値だけでなく親側での未設定も同じ計算環境として扱う。
未知のORICA設定やNODE_OPTIONS、OMP/MKL/OpenBLASなど実行条件の変更は失効させる。
OMP/MKL/OpenBLASを含む環境判定は
既存harnessと共通化し、runからreceipt記録までの変更も実行時fingerprintで拒否する。
後続acceptance失敗はrun固有変数でharness hashが違っても保守的に失効させる。
scopeとruntimeの失効理由を区別し、旧記録を書換えず現環境の新規実runからreceiptを作り直す。
当該gateを含む検証が実行中なら先行成功を採用せず、失敗履歴を保持して新receiptで修復する。
acceptance到達前の後続失敗も失効させ、後続finish/fullの完走gate集合・時刻・exitを検査する。
履歴は新旧比較前に時刻型とharnessのファイル名を照合し、blockedのprofile/requestedAtも結合する。
blocked名のprofileはharnessの`selectGates`を正源に検査し、正規の`scenario-blocked`も保持したまま読める。
未知profile・profile/名前の不一致・開始/要求時刻の改変は従来どおり拒否する。未実行waitと実行済み失敗の区別も維持する。
時刻を壊して古い履歴へ見せる入力を拒否し、元run開始後の失敗をgate到達前でも失効理由とする。
実行開始時のtreeとdiff baseを固定保存して行限定scopeを選定する。
履歴の変更パスは固定tree/baseの実Git差分に一致する必要があり、空/docsへの改変で関連失敗を隠せない。
後の編集や取り消しで過去runのscopeを変えず、navigation専用finishは失効理由にしない。
merge/pushの正規再利用は元のfresh実行へ結合し、新規完走receiptとして数えない。
既存verifierのcommit auditを検査し、元の検証tree・context/report/result・親ticket・
main/origin-main祖先を照合してから有効化する。独立したgate台帳や自己参照commitは作らない。
receiptのUUID・完走後の記録時刻とarchiveの包含を先に検査し、識別不能な古い破損記録も隠さない。
archiveを共有rootへコピーする前に既存`check-commit --evidence`で埋め込みreportとの一致を検査する。
反証のない`items: []`も、全差分・6観点・未確認0の共通verifier検査を通れば有効である。
itemsの件数を査読coverageの代用にしない。coverage欠落・未確認・refute・hash/commit/ticket不一致は拒否する。

