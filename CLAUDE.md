# oneshotcal (oneshot2.9) — プロジェクト状況メモ

最終更新: 2026-07-05（このファイルは新セッションでの状況把握用。大きな変更をしたら更新すること）

## プロジェクト概要

画像から予定を抽出して Google カレンダーに登録するWebアプリ（oneshotcal.com）。
- 本番: Cloud Run サービス `oneshot`（GCPプロジェクト `oneshot-rebuild`、us-central1）
- デプロイ: `gcloud run deploy oneshot --source . --region us-central1 --project oneshot-rebuild`
- 構成: `worker.js`（Express、全バックエンド）/ `db.js`（Firestore + Stripe課金。**変更時は要注意**）/ `db-grid.js`（グリッド機能専用DB）/ `public/js/app.js`（全ページ共通フロント）/ `public/index*.html`（5言語 × 同一構造）
- 課金: Stripe（月額$1、無料3回/月・プレミアム30回/月）。利用回数は `users/{subId}.history` 配列を `premiumSince` 以降でカウント。月次リセットは `invoice.paid` Webhook が `premiumSince` を更新することで実現
- 多言語: ja/en/de/fr/es。サーバーは Accept-Language、フロントは navigator.language。i18n文字列は app.js 内の巨大オブジェクト

## 2026-07-02〜04 の作業内容（すべて本番反映済み）

### 1. グリッドモード（月間予定表一括登録）新機能
- 幼稚園・保育園の「日付×クラス列」形式の画像/PDFに対応。既存の1画像1予定フロー（`/upload`）とは完全に独立
- エンドポイント: `POST /grid/columns`（列見出し検出）→ `POST /grid/extract`（構造化抽出、登録なし）→ `POST /grid/register`（ユーザー確認済みのみ一括登録、ここで利用回数1消費）→ `POST /grid/undo`（直近バッチの取り消し）
- 画像はサーバーに保持せず、フロントが各ステップで再送信（プライバシーポリシー整合）
- クラス選択は Firestore `users/{subId}.gridClassPrefs` に保存、次回自動適用（再選択導線あり）
- 取り消し: `gridBatches/{batchId}` にイベントID保存（24h TTL用の expireAt あり、TTLポリシー自体は未設定）。所有者チェックあり。回数は返却しない（悪用防止）
- 解析中は4段階ステップUI（列確認→3本バーの読み取り→突き合わせ→準備）。フロントの追加UIはすべて app.js で動的生成（HTML 6ファイルは骨組みのみ）

### 2. 抽出の設計方針（重要・変更時は経緯を踏まえること）
- **画像/PDFを Gemini にマルチモーダル直接入力**（Vision OCRテキストでは列・帯・矢印・点線の空間情報が失われるため）。幅1800px未満の画像は2倍アップスケール
- **3ラン多数決コンセンサス**: 同一画像で温度・プロンプト微差の3並列抽出 → 2ラン以上一致のみ high、他は「未検証」(low) としてレビューに全候補提示。1ランの結果はランごとに行ズレ等で揺らぐため、揺らぎを silent な誤登録ではなく確認対象として顕在化させる設計
- **曜日検算**: 表に印字された曜日を書き写させ、dateの実曜日と不一致なら自動で low へ降格（行ズレ検出）
- **矢印の二分岐**（仕様の核心）:
  - 両端に明示テキストがある矢印 → 両端をそれぞれ独立予定として登録
  - 終点にテキストがない継続矢印 → 予定にせず notices（「◯月◯日〜◯月◯日ごろ、内容をご確認ください」）のみ。予定名の捏造は厳禁
- **notices 厳格化の経緯**: 初期実装は3ランの和集合で採用していたため9件に膨張（脚注・選択外列・幻視の混入）。現在は「実在する矢印が物理的に描かれている場合のみ」をプロンプトで強制＋notices も多数決（2/3ラン、日付範囲の実重なりでグルーピング、採用日付は中央値、連鎖マージ防止のためグループ代表とのみ照合）。**精度優先のトレードオフとして、実在矢印を拾い損ねるラン（0件になる）もある**。多数決閾値を1に下げれば recall 側に振れる
- **セル内複数予定**: 改行のみ・アイコン付き・括弧書きグループ名付き（例: 身体測定(つくし)）も分離。「点線はセル内区切りであって日付境界ではない」を明示（初期は点線を行境界と誤解して前日に繰り上げる誤りが頻発した）

### 3. インフラ・課金まわりの是正
- Gemini モデル: `gemini-2.0-flash-001`（提供終了・404）→ `gemini-2.5-flash` に移行（worker.js:74）
- **秘密情報ローテーション後の Cloud Run 環境変数の取り残しが3連発**: GOOGLE_CLIENT_SECRET（invalid_clientでログイン全断）、STRIPE_SECRET_KEY（Expired）、STRIPE_WEBHOOK_SECRET（署名400）。すべて更新済み。**「昨日まで動いていた認証系が突然失敗」を見たら、まず Cloud Run 環境変数と発行元の現在値の一致を疑うこと**。恒久対策の Secret Manager 移行は未実施
- Webhook: Stripe エンドポイント（`we_1T1vh0…`）の購読に `invoice.paid` を追加（従来 checkout.session.completed のみで月次リセットが機能していなかった）。さらに新Stripe API（2025-03-31以降）では invoice の subId が `parent.subscription_details.metadata` に移動しており、worker.js の Webhook ハンドラに参照パスを追加済み。べき等性は `processedEvents/{event.id}`（db.js）で担保
- **二重課金防止ガード**: プレミアムで30回到達時は checkout を作らず「次回リセット: ◯/◯」案内のみ返す（`premiumLimit: true`）。無料ユーザーの checkout 導線は従来どおり
- premiumSince は 2026-07-04 に Webhook 経由で正常更新済み（0/30）。次の自動更新は8月4日ごろ → 失敗していたら Webhook配信ログを調査

## 2026-07-05 の作業内容（**本番反映済み**: revision oneshot-00471-clw、スモーク合格）

### 一括登録モード（グリッドモードの汎用化・改名）
- UI上の名称を「月間予定表モード（β）」→「**一括登録モード（β）**」に改名（5言語）。既存ユーザー向けの案内ツールチップはスコープ外と判断（導線・クラス自動適用は不変のため）
- 新エンドポイント（worker.js 末尾の BULK セクション）:
  - `POST /bulk/triage` … Stage1+2統合（書類タイプ判定＋年月＋列＋質問生成）を Gemini 1回で実施。ガードは /grid/columns と同一（回数消費なし）。docTypes enum: grid_monthly / weekly_schedule / list_schedule / menu_monthly / single_flyer / shift_table / other。docTypes が other 単独なら notSchedule エラー＋BANカウント
  - `POST /bulk/extract` … 非対称ルーティング。**docTypes 上位2件に grid_monthly があり、かつ列回答あり**→ 既存3ラン多数決（`runGridExtraction`）、isGrid:false なら汎用へ内部フォールバック。それ以外→ 汎用1ラン（`runGenericExtraction`、temp 0、evidence要求＋曜日検算は日英対応）。ガード・回数消費なしは /grid/extract と同一
- **質問型ホワイトリスト**: column_select（クラス選択の一般化、gridClassPrefs 自動適用は従来どおり）/ region_select / **date_confirm（年・月どちらが欠けても「2026年7月」形式の年月一体候補・単一選択。フロントは先頭候補を既定選択）** / target_select / free（最大1問・選択肢必須）。全質問chip選択式・最大3問・1ターンのみ
- リファクタ: 旧 /grid/extract のハンドラー本体を `runGridExtraction(filePart, opts)` に切り出し（**プロンプト・多数決ロジックはHEAD比でバイト同一**を機械検証済み。`extraPrompt` 引数は旧経路では常に空）。旧 /grid/columns・/grid/extract は旧フロントのキャッシュ対策で当面残す（**次々回のデプロイで削除予定**）
- フロント（app.js）: gridDetectColumns→bulkTriage、renderClassStep→renderQuestionsStep（汎用chipレンダラー・質問ゼロなら readyTitle 表示で即抽出可）。進捗UIは likelyMode=grid なら従来4段階、generic はローダー＋一文。レビュー/登録/undo は既存流用（汎用は className に target を載せる）。HTML 6ファイルは変更ゼロ
- ローカル検証結果: レナ7月号→triage(grid_monthly/5列/column_select 1問)・grid抽出33件、献立PDF→menu_monthly・region_select発火・26件(1日1件終日・分量ノイズなし)、年なしチラシ→date_confirm発火・回答反映、風景画像→notSchedule、gridヒント強制→内部フォールバック発火、未ログイン401
- ブラウザ実操作（D項）も完了: puppeteer-core＋Chrome、`x-forwarded-proto: https` を付ける8081プロキシで trust proxy + secure cookie を本番同等に再現し、偽造セッションCookieで実施。S1 レナ7月号（自動適用/変更導線/4段階UI/レビュー37件）、S2 献立PDF（質問chip＋簡略進捗＋26件。**triageの質問内容はランごとに揺れる**: region_select だったり target_select「昼/午後」だったり質問ゼロだったり—いずれもUIは正常系）、S3 date_confirm既定選択＋単一選択の選び直し、S4 質問ゼロ→readyTitle→即抽出5件、S5 実アカウントで register 2件（残り29回表示）→ undo 2件、全PASS。テストユーザー・gridBatches 掃除済み
- コスト: 一括登録1回 = triage 1 + (grid 3 or 汎用 1) = 最大4呼び出し（現行と同数、汎用は2で安い）

### 自動除外フィルタ（2026-07-05 追加実装。ローカル検証済み・**デプロイ承認待ち**）
- 背景: 本番でレナ7月号の19日/20日に「休園」「海の日」が重複・日付ズレして出る報告。切り分けの結果、デプロイとは無関係の既存の行ズレ弱点（土日祝の帯の境界）と判明。方針を「精度を直す」から「登録不要な自明情報を除外する」に転換
- 実装: worker.js の後処理フィルタのみ（`bulkAutoExcludeReason`、runGridExtraction / runGenericExtraction の正規化ループ先頭で continue）。**プロンプト・3ラン多数決・notices 生成は無変更**。多数決は (予定名|列|日付) キーの独立カウントなので、後処理除外が他イベントの票数に影響しないことを確認済み
- 除外対象: ①国民の祝日名の完全一致（正規化: 空白・行頭記号・末尾の（祝）(休園)等を剥がす。**日付ズレしていても名前で消える**）②素の休園（休園/休園日/休み/お休み/閉園の完全一致）×単日×時刻なし×note空×「日曜または祝日の日付」
- 祝日日付は決定的計算（固定日＋ハッピーマンデー＋振替休日＋国民の休日。春分/秋分のみ2025〜2031テーブル、**範囲外の年は素通し＝安全側**）。祝日名は日本語のみ（v1スコープ）
- 残すもの: 土曜の休園（土曜日保育休園含む）・臨時休園・複数日帯の休園・時刻/note付き・夏休み等の期間もの
- 検証: 単体テスト38件全PASS（scratchpadのfilter-test.mjs方式: worker.jsからマーカーで切り出して実行）。レナ7月号リグレッションで両経路とも海の日・日曜/祝日の素の休園が消え、7/25土曜日保育休園・第1保育期終了式・夏休みは残存

## 保留中の既知issue（対応未定）

- **「夏休み」が7/18と7/19に別イベントとして重複出現する**（18=high、19=low等）。複数日帯を単日イベント2つとして抽出するランがあるための揺れ。自動除外の対象外（夏休みは残す情報）。多数決でlow側に落ちるため実害は限定的だが、帯の複数日抽出の安定化はいずれ検討（2026-07-05記録）

## 既知の制約・注意点

- **抽出精度の検証はレナようちえん7月号ベース**（`test-images.PNG` がプロジェクト直下にある。iPhone スクショ、5クラス列＋帯＋矢印＋セル内複数予定を含む良質なテストケース）。他園のフォーマットは未検証。列名はハードコードしていないので原理上は動くが、密度の高い実画像では行ズレ・列混入が起き得る（→未検証フラグで吸収する設計）
- グリッド1回= Gemini 3呼び出し（列検出含め4）。`/grid/columns` は回数消費なし（BANガードのみ）→ 利用が伸びたらコスト・レート制限を再検討
- 非日本語圏の LP（`/`）は **lp-en/de/fr/es.html が存在せず404**（2月から続く既存問題、未対応）
- 決済・認証コード（webhook、/portal、/auth、db.js）の変更はユーザーに事前通知してから行う約束
- ローカル実行: `$env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\gcloud\application_default_credentials.json'` 必須（ADCが標準パスにない）。ブラウザからのローカルAPIテストは `$env:ALLOWED_ORIGINS` に `http://localhost:8080` を追加して起動
- サーバーAPIのテスト手法: `.env` の SESSION_KEY + keygrip で署名済みセッションCookieを偽造（テスト用subId）。カレンダー書込み前の401で必ず止まり安全。**テスト後は Firestore の users テストドキュメントを削除すること**
- Webhook のローカル/本番テスト: 実イベントを Stripe API で取得し、whsec でHMAC署名を自作して POST すれば再送信と等価
- デプロイ時に「Container import failed」が連発したら Google 側の一時障害の可能性（2026-07-03に約1時間発生、時間を置いて解消）。ビルド成功・IAM正常なら待って再試行

## 運用フロー（このプロジェクトでの約束事）

1. 実装 → ローカルで実際に動かして検証（構文チェックだけで済ませない）
2. 検証結果を報告 → **デプロイはユーザーの承認後**
3. デプロイ後は本番スモークテスト（LP 200 / 認証ガード401 / 新アセット配信確認）まで行う
