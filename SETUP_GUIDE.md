# SHOGUN HOUSE OSAKA 宿泊者名簿フォーム セットアップ手順

ゲストがチェックイン前にスマホ等で入力し、送信するとGoogleドライブ「天王寺区味原町」フォルダ内のスプレッドシートに自動で記録される仕組みです。

構成:

```
ゲスト（中国本土含む） → 独自ドメインのフォーム（Cloudflare Workers）
                        → /api/submit（同じWorker内で処理）
                        → Google Apps Script（サーバー間通信）
                        → Googleスプレッドシート（天王寺区味原町フォルダ）
```

ゲストの端末はGoogleのドメインに一切アクセスしないため、Googleサービスが制限されている地域（中国本土など）からでも入力・送信できます。

---

## 1. Googleスプレッドシートを準備する

1. Googleドライブの「天王寺区味原町」フォルダを開く。
2. [新規] > [Google スプレッドシート] を作成し、名前を「SHOGUN HOUSE OSAKA_宿泊者名簿」などに変更する。
3. メニューの [拡張機能] > [Apps Script] を開く。
4. デフォルトの `Code.gs` の中身を全て削除し、このリポジトリの `apps-script/Code.gs` の内容を貼り付けて保存する。
5. 画面右上の [デプロイ] > [新しいデプロイ] を選択。
   - 種類の選択で歯車アイコン → 「ウェブアプリ」を選ぶ。
   - 「次のユーザーとして実行」: **自分**
   - 「アクセスできるユーザー」: **全員**
   - [デプロイ] をクリックし、Googleアカウントの承認を行う。
6. 発行された **ウェブアプリのURL**（`https://script.google.com/macros/s/xxxxx/exec` の形式）をコピーして控えておく（手順3で使用）。

> スプレッドシートの1行目には、初回送信時に自動でヘッダー（タイムスタンプ／チェックイン予定日／氏名／国籍／旅券番号など）が入ります。
>
> 国籍・住所・職業は「原文」と「日本語訳」を隣り合う列に自動で書き込みます（Google翻訳をApps Script内で呼び出しており追加費用はかかりません）。翻訳が不自然な場合は、そのセルを直接上書き修正できます。デプロイ時の権限承認画面で「外部サービスへの接続」への同意を求められることがありますが、翻訳機能のためのものなので許可してください。

---

## 2. 独自ドメインを用意する

まだお持ちでない場合は、Cloudflareでのドメイン取得が最もシンプルです（DNS・Pages・Workersが同じ管理画面で完結するため）。

1. https://dash.cloudflare.com/ でCloudflareアカウントを作成。
2. 左メニュー [ドメイン登録] からドメインを検索・購入する（例: `shogunhouse-osaka.com` や、既にお持ちのドメインがあればそのサブドメイン `guest.（既存ドメイン）` でも可）。
3. 既存ドメインを他社で取得済みの場合は、Cloudflareに追加してネームサーバーをCloudflareのものに変更する（Cloudflareの案内に従う）。

---

## 3. Cloudflare Workersでフォームを公開する

Cloudflareの現行UIでは「Pages」ではなく統合された「Workers」からのGit連携デプロイになります。このリポジトリには、それに対応した `wrangler.jsonc`（設定ファイル）と `worker/index.js`（`/api/submit` の中継処理）を既に用意してあります。

1. Cloudflareダッシュボード → [Compute] → [Workers & Pages] → 右上 [Create application]。
2. 「Import a repository」からGitHubと連携し、このリポジトリ（`sugimoto-globe/onn-seiso-payslip`）を選択。
3. 「Set up your application」画面:
   - **Project name**: `shogunhouse-osaka-guest-form`（`wrangler.jsonc` の `name` と合わせる）
   - **Build command**: 空欄のまま
   - **Deploy command**: `npx wrangler deploy`（自動入力されているはずなのでそのまま）
   - ルートディレクトリの指定項目は無し（リポジトリ直下の `wrangler.jsonc` がそのまま使われる）
4. [Deploy] を実行。
5. デプロイ完了後、プロジェクトの [Settings] → [Variables and Secrets] を開き、以下を追加:
   - 名前: `GAS_WEBAPP_URL`
   - 値: 手順1-6で控えたApps ScriptのウェブアプリURL
   - 種類: **Secret**
   - 保存すると自動的に再デプロイされる。
6. プロジェクトの [Settings] → [Domains & Routes]（またはCustom Domains）から手順2のドメイン（例: `shogunhouse-osaka.com` や そのサブドメイン）を追加する。

---

## 4. 動作確認

1. 発行されたURL（独自ドメイン）にスマホでアクセスし、フォームが正しく表示されるか確認する。
2. テストデータを1件送信し、Googleドライブのスプレッドシートに行が追加されるか確認する。
3. パスポート画像を添付した場合、「天王寺区味原町」フォルダ内に「パスポート画像」フォルダが自動作成され、画像が保存されていることを確認する。
4. 可能であれば、中国国内の知人やVPN経由でアクセステストを行うと安心です。

---

## 5. 運用

- 宿泊予定者には、独自ドメインのフォームURL（例: `https://guest.shogunhouse-osaka.com/`）をチェックイン前にメールやメッセージアプリで送付する。
- 役所（大阪市）への提出が必要な場合は、スプレッドシートをそのまま共有、またはCSV/PDFとして出力して提出できる。
- スプレッドシートの列構成はそのまま旅館業法上の宿泊者名簿の必須項目（氏名・住所・職業・国籍・旅券番号・宿泊日）を満たす形になっている。役所への提出時は「日本語訳」列を使うと、外国語で入力された住所・職業もそのまま日本語の名簿として提出できる。

---

## ファイル構成

- `guest-form/index.html` … ゲスト向け入力フォーム本体（日本語／英語／簡体字中国語／繁体字中国語／韓国語の5言語対応）
- `worker/index.js` … Cloudflare Worker（`/api/submit` を受けてApps Scriptへ中継、それ以外は静的ファイルを配信）
- `wrangler.jsonc` … Cloudflare Workersのデプロイ設定
- `apps-script/Code.gs` … スプレッドシートへの書き込み・パスポート画像保存スクリプト
