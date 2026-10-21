/**
 * 宿泊者名簿 受付スクリプト（複数物件対応）
 *
 * 使い方:
 *  1. 下の PROPERTIES に、物件ごとの書き込み先スプレッドシートIDを登録する
 *     （スプレッドシートのURL https://docs.google.com/spreadsheets/d/【ここがID】/edit の【ここ】部分）。
 *     物件を追加するときは、この PROPERTIES にエントリを1つ足すだけでよい。
 *  2. Apps Script の編集画面（どのスプレッドシートに紐付けたものでも良い）で
 *     このファイルの内容を丸ごと貼り付けて保存する。
 *  3. [デプロイ] > [新しいデプロイ] > 種類「ウェブアプリ」
 *       - 実行するユーザー: 自分
 *       - アクセスできるユーザー: 全員
 *     でデプロイし、発行された /exec URL を控える。
 *     （既存の物件を追加しただけの更新であれば、[デプロイを管理] から既存の
 *       デプロイを編集して「新しいバージョン」を選べば、URLは変わらない）
 *  4. Cloudflare の環境変数（Secret） GAS_WEBAPP_URL にその URL を設定する
 *     （フォーム側から直接このURLを呼び出すことはない）。
 *     全物件のフォームが同じ GAS_WEBAPP_URL を共有し、フォームが送ってくる
 *     property（物件ID）で書き込み先スプレッドシートを振り分ける。
 *  5. 過去に送信済みで、まだスプレッドシートに写真が埋め込まれていない分を
 *     反映したい場合は、Apps Scriptエディタ上部の関数選択ドロップダウンで
 *     backfillPassportImageThumbnails を選び、実行ボタンを押す（一度だけでよい）。
 */

const PROPERTIES = {
  'shogun-house-osaka': {
    hotelName: 'SHOGUN HOUSE OSAKA',
    // 西成区鶴見橋フォルダの「SHOGUN HOUSE 宿泊者名簿」
    spreadsheetId: '1iUT5OKp8-nvxt9F5UcuqzAZLws_wPd6wkGttnUS81Vo',
  },
  'ichiza-kyoto': {
    hotelName: 'ICHZA KYOTO',
    // 下京区若宮町フォルダの「ICHZA KYOTO 宿泊者名簿」
    spreadsheetId: '16upi1NEMOME2gHsh3s2ks0IxHbtqHMYRppZ-iE9aLk0',
  },
};
const DEFAULT_PROPERTY_ID = 'shogun-house-osaka'; // property未指定の古いフォームとの互換用

const SHEET_NAME = '宿泊者名簿';

const JAPAN_NATIONALITY_LABEL = '日本';

// フォームの言語コード → LanguageApp.translate() が受け付ける言語コード
const TRANSLATE_SOURCE_LANG = {
  ja: 'ja',
  en: 'en',
  'zh-Hans': 'zh-CN',
  'zh-Hant': 'zh-TW',
  ko: 'ko',
};

const HEADERS = [
  'タイムスタンプ', 'チェックイン予定日', 'チェックアウト予定日', '宿泊人数', '入力言語',
  '代表者区分', '氏名', 'フリガナ', '生年月日',
  '国籍（原文）', '国籍（日本語訳）',
  '旅券番号',
  '住所（原文）', '住所（日本語訳）',
  '電話番号',
  '職業（原文）', '職業（日本語訳）',
  'メールアドレス', 'パスポート画像URL',
];
const PASSPORT_IMAGE_COLUMN = HEADERS.length; // 常にパスポート画像URL列（末尾）と一致させる

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = JSON.parse(e.postData.contents);
    const property = PROPERTIES[data.property] ? data.property : DEFAULT_PROPERTY_ID;
    const sheet = getOrCreateSheet_(property);
    const timestamp = new Date();
    const guests = data.guests || [];
    const sourceLang = TRANSLATE_SOURCE_LANG[data.lang] || 'ja';

    guests.forEach((g) => {
      let passportUrl = '';
      let passportBlob = null;
      if (g.passportImageBase64) {
        passportBlob = base64ToBlob_(g.passportImageBase64, g.passportImageName, data.checkin, g.name);
        passportUrl = savePassportImageToDrive_(property, passportBlob);
      }
      sheet.appendRow([
        timestamp,
        data.checkin || '',
        data.checkout || '',
        data.guestCount || guests.length,
        data.lang || '',
        g.isRepresentative ? '代表者' : '同行者',
        g.name || '',
        g.kana || '',
        g.birthday || '',
        g.nationality || '',
        // 国籍で「日本」を選んだ場合、フォーム側は入力言語に関わらず常に日本語表記
        // 「日本」を送ってくるため、その場合は翻訳を呼ばずそのまま使う。
        (g.nationality === JAPAN_NATIONALITY_LABEL) ? g.nationality : translateToJa_(g.nationality, sourceLang),
        g.passportNo || '',
        g.address || '',
        translateToJa_(g.address, sourceLang),
        g.phone || '',
        g.occupation || '',
        translateToJa_(g.occupation, sourceLang),
        g.email || '',
        passportUrl,
      ]);
      // Driveのリンクを開かなくても、スプレッドシート上でそのまま写真を確認できるように
      // セルへサムネイルを埋め込む（埋め込みに失敗してもDriveへの保存・URL記録は既に
      // 完了しているため、処理全体は失敗させない）。
      if (passportBlob) {
        insertPassportImageThumbnail_(sheet, sheet.getLastRow(), passportBlob);
      }
    });

    return jsonOutput_({ result: 'success', saved: guests.length, property });
  } catch (err) {
    return jsonOutput_({ result: 'error', message: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// 自由記述項目（国籍・住所・職業）を日本語に自動翻訳する。
// 管理者はスプレッドシート上でこの翻訳セルをそのまま閲覧・修正できる。
function translateToJa_(text, sourceLang) {
  if (!text) return '';
  if (sourceLang === 'ja') return text; // 既に日本語入力の場合は翻訳不要
  try {
    return LanguageApp.translate(text, sourceLang, 'ja');
  } catch (err) {
    return ''; // 翻訳に失敗しても原文は別列に残っているため空欄のまま許容する
  }
}

function doGet(e) {
  const property = (e && e.parameter && PROPERTIES[e.parameter.property]) ? e.parameter.property : null;
  const label = property ? PROPERTIES[property].hotelName : Object.keys(PROPERTIES).map((id) => PROPERTIES[id].hotelName).join(' / ');
  return ContentService
    .createTextOutput(`${label} 宿泊者名簿 受付スクリプト: OK`)
    .setMimeType(ContentService.MimeType.TEXT);
}

function getOrCreateSheet_(property) {
  const ss = SpreadsheetApp.openById(PROPERTIES[property].spreadsheetId);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function base64ToBlob_(base64Data, fileName, checkinDate, guestName) {
  const mimeMatch = base64Data.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const pureBase64 = base64Data.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
  const safeName = `${checkinDate || 'unknown'}_${guestName || 'guest'}_${fileName || 'passport.jpg'}`;
  return Utilities.newBlob(Utilities.base64Decode(pureBase64), mimeType, safeName);
}

function savePassportImageToDrive_(property, blob) {
  try {
    const folder = getOrCreatePassportFolder_(property);
    const file = folder.createFile(blob);
    return file.getUrl();
  } catch (err) {
    return '';
  }
}

function insertPassportImageThumbnail_(sheet, row, blob) {
  try {
    const img = sheet.insertImage(blob, PASSPORT_IMAGE_COLUMN, row);
    img.setWidth(120).setHeight(90);
  } catch (err) {
    // 埋め込みに失敗した行はスキップする（Drive上のファイル自体は残っている）
  }
}

// 過去にDriveへ保存済みだがスプレッドシートに画像が埋め込まれていない分を、
// 一度だけ手動で反映するための関数。Apps Scriptエディタの関数選択で
// backfillPassportImageThumbnails を選び、「実行」すればよい。
function backfillPassportImageThumbnails() {
  Object.keys(PROPERTIES).forEach((property) => {
    const hotelName = PROPERTIES[property].hotelName;
    const ss = SpreadsheetApp.openById(PROPERTIES[property].spreadsheetId);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      Logger.log(`[${hotelName}] シート「${SHEET_NAME}」が見つかりません`);
      return;
    }
    const lastRow = sheet.getLastRow();
    let embedded = 0;
    let skippedNoUrl = 0;
    let failed = 0;
    for (let row = 2; row <= lastRow; row++) {
      const url = sheet.getRange(row, PASSPORT_IMAGE_COLUMN).getDisplayValue();
      const fileId = extractDriveFileId_(url);
      if (!fileId) { skippedNoUrl++; continue; }
      try {
        const blob = DriveApp.getFileById(fileId).getBlob();
        insertPassportImageThumbnail_(sheet, row, blob);
        embedded++;
      } catch (err) {
        failed++;
        Logger.log(`[${hotelName}] ${row}行目で失敗: ${err}`);
      }
    }
    Logger.log(`[${hotelName}] 完了: 対象${lastRow - 1}行 / 埋め込み${embedded}件 / URLなし${skippedNoUrl}件 / 失敗${failed}件`);
  });
}

function extractDriveFileId_(url) {
  const m = String(url || '').match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function getOrCreatePassportFolder_(property) {
  // 物件名を含めることで、複数物件のパスポート画像フォルダが同じ名前になって
  // Googleドライブ上で見分けがつかなくなるのを防ぐ。
  const folderName = `パスポート画像（${PROPERTIES[property].hotelName}）`;
  const ssFile = DriveApp.getFileById(PROPERTIES[property].spreadsheetId);
  const parents = ssFile.getParents();
  const parentFolder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const existing = parentFolder.getFoldersByName(folderName);
  if (existing.hasNext()) return existing.next();
  return parentFolder.createFolder(folderName);
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
