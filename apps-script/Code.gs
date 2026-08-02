/**
 * SHOGUN HOUSE OSAKA — 宿泊者名簿 受付スクリプト
 *
 * 使い方:
 *  1. 下の SPREADSHEET_ID を、書き込み先にしたいスプレッドシートのIDに書き換える
 *     （スプレッドシートのURL https://docs.google.com/spreadsheets/d/【ここがID】/edit の【ここ】部分）。
 *     どのスプレッドシートから Apps Script を開いてデプロイしても、
 *     常にこのIDのスプレッドシートに書き込まれる。
 *  2. Apps Script の編集画面（どのスプレッドシートに紐付けたものでも良い）で
 *     このファイルの内容を丸ごと貼り付けて保存する。
 *  3. [デプロイ] > [新しいデプロイ] > 種類「ウェブアプリ」
 *       - 実行するユーザー: 自分
 *       - アクセスできるユーザー: 全員
 *     でデプロイし、発行された /exec URL を控える。
 *  4. Cloudflare の環境変数（Secret） GAS_WEBAPP_URL にその URL を設定する
 *     （フォーム側から直接このURLを呼び出すことはない）。
 */

// 書き込み先スプレッドシートのID（西成区鶴見橋フォルダの「SHOGUN HOUSE 宿泊者名簿」）
const SPREADSHEET_ID = '1iUT5OKp8-nvxt9F5UcuqzAZLws_wPd6wkGttnUS81Vo';

const SHEET_NAME = '宿泊者名簿';
const PASSPORT_FOLDER_NAME = 'パスポート画像';

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

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = getOrCreateSheet_();
    const timestamp = new Date();
    const guests = data.guests || [];
    const sourceLang = TRANSLATE_SOURCE_LANG[data.lang] || 'ja';

    guests.forEach((g) => {
      let passportUrl = '';
      if (g.passportImageBase64) {
        passportUrl = savePassportImage_(g.passportImageBase64, g.passportImageName, data.checkin, g.name);
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
    });

    return jsonOutput_({ result: 'success', saved: guests.length });
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
  return ContentService
    .createTextOutput('SHOGUN HOUSE OSAKA 宿泊者名簿 受付スクリプト: OK')
    .setMimeType(ContentService.MimeType.TEXT);
}

function getOrCreateSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
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

function savePassportImage_(base64Data, fileName, checkinDate, guestName) {
  try {
    const mimeMatch = base64Data.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const pureBase64 = base64Data.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
    const safeName = `${checkinDate || 'unknown'}_${guestName || 'guest'}_${fileName || 'passport.jpg'}`;
    const blob = Utilities.newBlob(Utilities.base64Decode(pureBase64), mimeType, safeName);
    const folder = getOrCreatePassportFolder_();
    const file = folder.createFile(blob);
    return file.getUrl();
  } catch (err) {
    return '';
  }
}

function getOrCreatePassportFolder_() {
  const ssFile = DriveApp.getFileById(SPREADSHEET_ID);
  const parents = ssFile.getParents();
  const parentFolder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const existing = parentFolder.getFoldersByName(PASSPORT_FOLDER_NAME);
  if (existing.hasNext()) return existing.next();
  return parentFolder.createFolder(PASSPORT_FOLDER_NAME);
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
