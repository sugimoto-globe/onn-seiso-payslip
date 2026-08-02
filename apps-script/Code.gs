/**
 * SHOGUN HOUSE OSAKA — 宿泊者名簿 受付スクリプト
 *
 * 使い方:
 *  1. Google ドライブの「天王寺区味原町」フォルダ内に、宿泊者名簿用の
 *     Google スプレッドシートを新規作成する。
 *  2. そのスプレッドシートで [拡張機能] > [Apps Script] を開き、
 *     このファイルの内容を丸ごと貼り付けて保存する。
 *  3. [デプロイ] > [新しいデプロイ] > 種類「ウェブアプリ」
 *       - 実行するユーザー: 自分
 *       - アクセスできるユーザー: 全員
 *     でデプロイし、発行された /exec URL を控える。
 *  4. Cloudflare Pages の環境変数 GAS_WEBAPP_URL にその URL を設定する
 *     （フォーム側から直接このURLを呼び出すことはない）。
 */

const SHEET_NAME = '宿泊者名簿';
const PASSPORT_FOLDER_NAME = 'パスポート画像';

const HEADERS = [
  'タイムスタンプ', 'チェックイン予定日', 'チェックアウト予定日', '宿泊人数',
  '代表者区分', '氏名', 'フリガナ', '生年月日', '国籍', '旅券番号',
  '住所', '電話番号', '職業', 'メールアドレス', 'パスポート画像URL',
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = getOrCreateSheet_();
    const timestamp = new Date();
    const guests = data.guests || [];

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
        g.isRepresentative ? '代表者' : '同行者',
        g.name || '',
        g.kana || '',
        g.birthday || '',
        g.nationality || '',
        g.passportNo || '',
        g.address || '',
        g.phone || '',
        g.occupation || '',
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

function doGet(e) {
  return ContentService
    .createTextOutput('SHOGUN HOUSE OSAKA 宿泊者名簿 受付スクリプト: OK')
    .setMimeType(ContentService.MimeType.TEXT);
}

function getOrCreateSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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
  const ssFile = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId());
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
