# 探索入力の可視カード参照（I1分割）

親仕様: [AI観測contract](16_ai-observation-contract.md)、[観測履歴](16a_ai-search-history.md)。
実行計画は [I1](../30_plan/ismcts-full-run/tasks.md#i1-観測からの探索入力と仮想世界)。

`projectAiSearchCards(AiObservation)` は `buildAiObservation` のplayer mode出力から
現在可視なカードcomponentを射影する。raw GameState・debug/full観測は受け取らない。
本番探索への接続、完全な `AiSearchRequest/SearchPublicState`、samplerは未実装。

## 参照と配送範囲

- 観測内の可視token順に `cardRef: 0..N-1` を付け、親/子参照を同じ番号へ変換する。
  raw instance ID・元tokenId・player ID・deck位置・未知fieldは配送しない。
- owner/controllerは既存player bindingからme/oppへ変換する。履歴componentも同じbinding検査を使う。
- 公開カード、本人手札、裏向き公開slotの未知tokenを保持し、同じ定義の別カードを統合しない。
  ゾーン・表裏・疲労・コア数・実効Lv/BP/色/系統とシンボルbundleの色集合/個数を保持する。
- 共通player観測は未知素性の印刷由来roleをゾーン名へ、最低維持コアを0 paddingへ射影する。
  後者は `identityVisibility: unknown` と組で扱い、ルール上の最低値0を意味しない。
  本人可視の素性とdebug/fullの値、公開された物理コア数・疲労は保持する。
- 裏向きfieldの未知素性は、合法対象取得と共通のnull-identity定義で中央実効resolverへ渡す。
  sanitize後に残る公開付与のLv/BP/色/系統/シンボルを保持し、秘密印字defを復元しない。
  公開sourceのlive参照にも追従する。sanitizeが除いた秘密sourceの付与は復元しない。
- 共通global CE対象filterでも、実在する裏向きfieldだけに同じnull-identityを渡す。
  公開付与でスピリットとなった対象の全体BP加算を保持し、既存の色・controller・耐性・対象取得gateを通す。
  全体耐性のfilterも同じnull-identityで評価し、公開耐性の欠落によるBPの過大観測を防ぐ。
  未知hand/deck・実体不在・スピリット付与なしを、この補完でスピリットにしない。
- 全体耐性のBP/Lv/物理シンボル数条件は、条件が参照する実効getterから注入する。
  複合色シンボルもbundleの個数で数える。`cards_in_zone`/`field_bp_total`も公開付与を参照する。
- 裏向きfieldのfilterには、所有者が知る場合も秘密印字defを渡さない。
  名前条件（OR・除外を含む）がある場合だけ、同じnull定義に共通getterの公開付与名を載せる。
  全体BP・耐性・動的枚数/BP参照で同じ定義を使い、公開名の欠落と秘密印字名の混入を防ぐ。
  OR免疫が既存のsnapshot対象取得へ戻る場合も、同じ定義と公開実効系統を渡す。
  この既存分岐を動的な全体免疫へ変更するものではない。
- `field_colors_present`の実効シンボル色の供給源にも同じnull定義を使う。
  付与色の異なる裏向きスピリットが、defのmaskだけで公開の色集合から消えないようにする。
  UI/軽減用の`getFieldSymbolSources`も同じ定義を使い、`_hidden_card_`で例外を起こさず
  物理シンボルentryを保持する。その他の未知defは従来の拒否を維持する。
- 素性を捨てる境界は裏向きfieldに限る。通常のengine投影は、明示されたB面等の定義を維持し、
  元stateのA面を取り直して置換しない。転醒のA/B独立情報は[08a](../10_rules/08a_advent-rebirth-contract.md)を参照。
- 全体シンボル付与は、共通の作用免疫と`include_all`対象取得gateの両方を通す。
  `symbols`限定免疫を区別し、登録時のbypassを保持して消費する。
  通常の「防げない」・作用だけのblanket・`all_effects`で、対象ロックへの貫通を混同しない。
  正源は[効果防止](../10_rules/04b2_effect-prevention-priority.md)とP3-105の共通gateとする。
- BP変更は全体CEの消費時にも`bp`の作用種別を渡す。登録時に対象を固定するBP変更と
  シンボル付与も、共通対象取得へそれぞれ`bp`/`symbols`を渡して部分免疫を照合する。
  `self`指定も同じ免疫判定を通し、自己対象を一律に免疫対象外にしない。
  「一切の効果を受けない」は自分の効果も含む（[04b2](../10_rules/04b2_effect-prevention-priority.md)）。
  対象のhostと効果源のproviderを分け、`self`/`any`/`opponent`の作用範囲を共通adapterで判定する。
  シンボル付与の対象取得と追加数制限は、共通の発揮元resolverでtext providerと合体hostを
  区別する。nativeから提供元とbypassを渡し、全体CEには作用と対象ロックのprofileを保持する。
  旧CEの作用profile省略時は従来の対象ロックprofileを使う。
- 相対最低/最高Lv条件は、公開`act_as_spirit`の実効Lv表を同mechanicsのgetterから得る。
  `atOwnMaximumLevel:false`、OR、除外もLv依存として扱い、global filterもlookupを共有する。
  この表をplaceholderの印字`levelDefs`へ混ぜず、`bpBasis:printed`等の判定を変えない。
- BP/シンボル修飾の入力評価は、当該CEだけを除くread-only viewで自身への再入を防ぎ、他CEを保持する。
  既存global Lv filterの自己除外に倣う依存解決の実装規約。BP加減算順は
  [公式エターナルQ31529](https://www.battlespirits.com/faq/list.php?format=eternal&category=「BP%2B」や「BP-」の効果について)（根拠A）で再確認した。
  このQ&Aが直接述べるのは発揮順の加減算で、自己除外viewの選択は実装設計の判断とする。
- 観測に含まれない秘密hand/deckの実体を補完しない。deck token・未知hand tokenが混入した場合は拒否する。
  相手手札の枚数や既知deck位置は別componentから受け取り、この配列から推測しない。
- 参照不在・重複・dangling親子参照は拒否する。元カードを黙って削除して参照を成立させない。
- nested vector/bundleは新しい配列/objectへ複製し、allowlist値のaccessor/object/非有限数値を拒否する。
  toJSONや追加fieldは参照しない。任意の敵対的JS objectに対する完全な入力validatorではない。

番号はこの観測に局所的で、raw IDの字句順やhashに依存しない。観測中の公開slot順を維持する。
可視token配列自体の置換に対するgraph同型正準化や、時点を跨ぐ同一性/追跡を保証しない。
[可視性正源](../10_rules/01b_information-visibility.md)の
「非公開ゾーンへ入った時点で live card instance との対応は切る」に従い、履歴とのlive対応は追加しない。
現在カード間の親子参照と、過去履歴から秘密カードを追跡することを分ける。

## 検証と残条件

`ai-search-cards.test.ts` は実state→sanitize→player観測→本componentで、相手秘密素性・
本人未知deck素性・deck順・raw ID/player IDのrenameによる非干渉を検査する。
親子参照の変換、同名別実体、シンボルbundle、複製後の変異非伝播、異常入力拒否も検査する。
`ai-observation-hidden-card-attributes.test.ts` は実通常burst-set後の秘密category/最低維持コアを変え、
観測・本component・NN入力/同seed予測の非干渉と、本人/full観測・公開物理値の保持を検査する。
`ai-observation-public-grants.test.ts` は実登録→sanitize→観測→本component/既存NN経路で、
静的付与と公開sourceのlive追従、公開BP変更の伝播、秘密印字変更の非干渉、付与除去と秘密sourceの遮断を検査する。
実global BP登録の所有者/相手観測一致と対象自身のNN特徴、加算除去、色/controller filterと補完対象の境界も検査する。
実global耐性登録のself/any/opponent scope、耐性除去、global cannot_includeによるBP加算除外も検査する。
条件付き耐性、複合シンボルとglobal加算の再入、シンボル条件付きglobal系統付与、
動的な公開対象数/BP総和/シンボル個数、公開値変更と除去も検査する。
場のシンボル色供給は直接/全体の実登録、固定複合シンボルとの現在値比較、公開色の追加/除去、
既存NNの供給元カード特徴、masked field供給取得と複合色の片側使用による軽減量も検査する。
公開名条件は単一の実付与を前提assertionで確認し、名前なし・秘密印字・OR/除外・発生源と同名、
全体BP・動的枚数/BP合計でも所有者/相手の一致と既存NN入力を検査する。
全体シンボル付与の対象ロック・aspect限定免疫・qa-020型免疫とbypass、付与除去を、
実登録から所有者/相手観測・component・既存NN特徴・masked軽減供給まで検査する。
実nativeの全体/snapshotでBP加減算・シンボルの部分免疫と非一致aspect、qa-020/bypassを検査する。
宣言済みslotと有効なtext_role providerを前提assertionで確認し、host/providerの色を入れ替えて
免疫と追加数制限の両方を検査する。最終CE、両viewer観測、componentと既存NN入力/予測を照合する。
自己対象も、`self`指定と同じhostを選ぶfilterを対照に、BP/symbolsの作用種別と
`self`/`any`/`opponent`免疫範囲を実native登録から照合する。非一致aspectと免疫なしも対照にする。
相対最高Lvは通常/公開付与、true/false、OR/除外、static/liveと公開sourceのLv変化を扱い、
最低Lv表の公開上書きと印字BP条件の非混同も検査する。
GUIの実分身生成・RESTパスに加え、既存room harnessで実登録→REST保存/取得→相手sanitize→BP表示と加算除去を確認する。
公開名による免疫も、通常filterと既存OR snapshotの双方で7000→免疫除去8000を同じ経路で確認する。
シンボル表示も直接/全体付与の双方で所有者/相手の物理bundleと一致し、
公開付与色がある間の「赤2 赤青1」から付与除去後の「赤3」への変化を確認する。
実nativeの全体/snapshot、部分免疫、qa-020/bypassも同じGUI/REST経路で確認する。
実カード定義のバレットエディット資格をassertした提供元の色差も、免疫・追加数制限の両方で確認する。
自己対象の同じ範囲/aspect対照も、hostのBPと物理シンボル・最終CE・両viewer値をGUI/RESTで確認する。
この提供元の確認は共通primitiveへ渡すテスト用actionを使い、当該カードの印字効果全体の受入とは分ける。
これはローカル開発GUIの経路検証で、本番配備・自律学習・探索の強さ改善の証拠ではない。
探索root候補・tree統計・responseを通すH1-H3の証明ではない。

BP/symbolsの作用種別は共有resolverから通常登録・対象group・choice変種・on_stepへ渡し、
候補と作用の共通免疫adapterへ接続する。所有者/相手/両者の範囲とtext providerも維持する。
native対象取得のsource限定lockも同じ効果源resolverへ接続する。text_roleはprovider、
合体ブレイヴはhostを使い、`cannot_be_targeted`と`cannot_include`のselector/bypassを分ける。
`provider-target-acquisition.test.ts`は通常宣言→実stack pass→最終盤面と両観測、
実BSTH10-C04の印字耐性を照合する。hostのself参照・対象数参照をproviderへ置換しない。
開発GUI/RESTでも実host/providerの発揮資格と同耐性を確認し、青providerの許可と赤providerの
除外を選択から最終値まで照合する。source側の付与actionは検査用で、印字効果全体の受入と分ける。
`effect-aspect-target-candidates.test.ts`は通常合法行動から最終盤面、空撃ちとことで構文、
宣言後に免疫を得た一部対象だけを除く処理を検査する。対象0の通常効果を使用禁止にしない。
開発GUIの4構成は実on_step→REST保存→共通sanitize→画面選択→実REST actionと完全状態読戻しを通す。
room harnessのactor/完全応答bridgeを用いた共通primitive検証であり、本番認証・印字効果全体の受入ではない。

pending/stack/usage、公開履歴と現在カードの許可された対応、既知deck制約、要求/decisionと候補の正準化、
仮想世界の再構築と再project、observer別探索は残る。このcomponentだけでengineを再開しない。
I0の全体会計・旧予約安全回収・固定8実走/校正は未達で、最初の未完了項目はI0を維持する。
資源gate前のコード実装だけを進め、本番学習更新・配備・監視移行・強さ改善は認定しない。

通常の手動対象候補も共通の公開名resolverを使う。裏向きfieldの秘密印字名を変更し、
公開名/秘密名/それぞれの除外について実stateと両viewerの候補を照合する。
選択後の共通TargetSpec再検証も同じresolverを使い、chooserのsanitize viewと実stateで
on_step選択を完走する。相手に伏せられたpending入力を相手viewから生成しない。
星霊衣のB面資格は物理カード定義で照合し、専用の種類判定以外のfieldフィルタは公開値を使う。
これは通常fieldへ印字名を復元する経路ではない。配置/入替と印字名の非一致を対照にする。
on_stepの初回候補と継続候補にも発揮元の合体カード/B面資格の条件を渡す。
core_moveもfield_card源候補・作用直前の共通filter・配置先で同じ公開identityを使う。
公開名/秘密名/除外の両viewer一致と、源/配置先の最終コア数を照合する。
disclosureが保存する対象変更候補は通常解決と同じprovider identityで対象lockを判定する。
hostを使う自己参照条件とproviderを使う耐性判定を区別し、text_roleと合体ブレイヴの
色差を対照に、対象変更可否・誘発解決・再開後の最終BPを検査する。
追加巡のdisclosureにもproviderを渡す。反応chainとpending IDは基本巡も含めstep/巡で区別し、
本文再開chainを維持する。1/2step×追加0/1/2の各開示・redirect・誘発・最終BPと全待機解消を照合する。
