# ICHZA KYOTO 宿泊者名簿（パスポート自動読み取り版）

ゲストがスマホでURLを開き、パスポートを撮影するだけで宿泊者名簿ができる仕組みです。
リポジトリ内の既存フォーム（`guest-form/`・`apps-script/`・ルートの `wrangler.jsonc`）とは**完全に独立**しており、互いに影響しません。

```
ゲストのスマホ
  ① 撮影 → 端末内で「文字の読み取り」と「顔写真の切り抜き」→ 元画像は破棄
  ② 文字情報＋顔写真の切り抜きだけを送信
        ↓
Cloudflare Worker（/api/submit） → Google Apps Script → スプレッドシート ＋ Googleドライブ
```

- パスポートの元画像は**端末の外に出ません**（読み取り後にメモリから解放）。保存されるのは文字情報と顔写真の切り抜きだけです。
- 読み取りはMRZ（パスポート下部の2行）の検算つき。検算が合わなかった項目は画面で黄色になり、ゲスト自身が確認・修正します。読み取れなくても手入力で続行できます。
- 日本国籍の方は「日本国籍」にチェックすれば撮影不要です。
- 日本語／英語／簡体字／繁体字／韓国語に対応（端末の言語で自動切替）。

## スプレッドシートの見え方

| チェックイン | チェックアウト | 泊数 | 顔写真 | 氏名 | 国籍 | 生年月日 | 旅券番号 | 区分 | 住所 … |
|---|---|---|---|---|---|---|---|---|---|
| 2026-11-01 | 2026-11-04 | 3泊 | （写真） | EXAMPLE JOHN MICHAEL | アメリカ合衆国 | 1988-01-15 | X12345678 | 代表者 | … |

「いつ・誰が・何泊・どこの国籍か」が左端に並びます。泊数は計算式なので、日付を直せば自動で更新されます。
顔写真はスプレッドシートと同じフォルダの「顔写真（ICHZA KYOTO）」にも保存されます。

## セットアップ

### 1. スプレッドシートと Apps Script
1. Googleドライブの「下京区若宮町」フォルダに、新しいスプレッドシートを作成（例: `ICHZA KYOTO 宿泊者名簿（自動）`）。
2. [拡張機能] → [Apps Script] を開き、`apps-script/Code.gs` の内容を丸ごと貼り付けて保存。
3. 関数 `setup` を選んで実行し、権限を承認（見出し・書式が整います）。
4. [デプロイ] → [新しいデプロイ] → 種類「ウェブアプリ」→ 実行するユーザー「自分」／アクセスできるユーザー「全員」。発行された `/exec` のURLを控える。

### 2. Cloudflare Workers
1. Cloudflare → Workers & Pages → Create → Import a repository → このリポジトリを選択。
2. **Root directory を `passport-registry`**、Project name を `ichza-passport-registry`（`wrangler.jsonc` の `name` と同じにする）、Build command は空欄、Deploy command は `npx wrangler deploy`。
3. デプロイ後、Settings → Variables and Secrets に `GAS_WEBAPP_URL`（Secret）として手順1-4のURLを登録。
4. Settings → Domains & Routes で公開するドメインを追加（例: `registry.ichza-kyoto.example`）。
5. Cloudflare は `main` ブランチを監視するため、このディレクトリが `main` に入るまで公開されません。

### 3. 動作確認
実際のパスポートを数冊（できれば複数の国のもの）、実機のスマホで撮影して、氏名・旅券番号・生年月日・国籍が正しく入るか、スプレッドシートに行と顔写真が入るかを確認してください。

## 運用前に必ず確認すること

**パスポートの写しの保存（法令）**
外国人宿泊者は旅券番号の記載に加えて旅券の写しの保存（3年）が求められており、写しを保存すれば名簿の氏名・国籍・旅券番号の記載を省略できるとする自治体の案内もあります。元画像を破棄して運用するには、管轄の保健所との協議が前提です（LINEの「保健所と協議の上」と同じ点）。

保管が必要と言われた場合は、`public/js/config.js` の `keepOriginalPassportImage` を `true` にしてください。圧縮した原本画像も「パスポート画像（ICHZA KYOTO）」フォルダに保存され、画面の案内文も自動で「写しとして保存します」に切り替わります。

**読み取り精度**
合成画像（傾き・ノイズ・影・横向き）では全項目を読み取れましたが、実物のパスポート（ホログラムの反射・湾曲・国ごとのフォント差）はこの環境では未検証です。現場投入前に実機で試し、精度が足りなければ `public/js/scan.js` の撮影・読み取り条件を調整します。

## 構成

```
passport-registry/
├─ public/            画面とOCR用ファイル（静的配信）
│  ├─ index.html
│  ├─ js/             app.js（画面）/ scan.js（端末内の読み取り）/ mrz.js（MRZ解析）/ i18n.js / config.js
│  └─ vendor/         Tesseract.js・face-api（自前配信。NOTICE.md 参照）
├─ worker/index.js    /api/submit を Apps Script へ中継
├─ apps-script/Code.gs
└─ test/              MRZ解析のテスト
```

OCRと顔検出のファイル（約13MB）は、ゲストが撮影ボタンを押した時点（カメラが開いている間）に読み込み始めます。自前配信のため、Googleや外部CDNに接続できない環境でも動きます。

## 開発

```bash
node --test passport-registry/test/*.test.mjs
```

```bash
cd passport-registry && npx wrangler dev --var GAS_WEBAPP_URL:http://127.0.0.1:9000/exec
```
