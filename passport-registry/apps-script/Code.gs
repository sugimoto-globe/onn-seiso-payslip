/**
 * ICHZA KYOTO 宿泊者名簿（パスポート自動読み取り版）受付スクリプト
 *
 * 使い方（詳しくは passport-registry/README.md）:
 *  1. 名簿にするスプレッドシートを開き、[拡張機能] > [Apps Script] にこのファイルを貼り付けて保存
 *  2. 関数 setup を1回実行（権限を承認）。シートの見出し・書式が整う
 *  3. [デプロイ] > [新しいデプロイ] > 種類「ウェブアプリ」
 *       実行するユーザー: 自分 / アクセスできるユーザー: 全員
 *     発行された /exec のURLを、Cloudflare Worker の GAS_WEBAPP_URL に設定する
 *
 * このスクリプトに届くのは、ゲストの端末で読み取り済みの「文字情報」と「顔写真の切り抜き」だけです。
 * パスポートの元画像は届かず、保存もされません
 * （フォーム側の keepOriginalPassportImage を true にした場合のみ、圧縮した原本を別フォルダに保存）。
 */

const TIMEZONE = 'Asia/Tokyo';
const SHEET_NAME = '宿泊者名簿';
const FACE_FOLDER_NAME = '顔写真（ICHZA KYOTO）';
const PASSPORT_FOLDER_NAME = 'パスポート画像（ICHZA KYOTO）';
const MAX_GUESTS = 20;

// 見出し（この順に1行ずつ書き込む）。
// 左側に「いつ・誰が・何泊・どこの国籍」が並ぶよう、読む頻度の高い列を先頭に置いている。
const HEADERS = [
  'チェックイン', 'チェックアウト', '泊数', '顔写真', '氏名', '国籍', '生年月日', '旅券番号', '区分',
  '住所', '住所（日本語訳）', '電話番号', 'メールアドレス', '職業', '職業（日本語訳）',
  '国籍コード', '国籍（入力原文）', '入力方法', '入力言語', '受付日時', '顔写真URL', '旅券画像URL',
];
const COL = {};
HEADERS.forEach((h, i) => { COL[h] = i + 1; });

const COLUMN_WIDTHS = {
  'チェックイン': 95, 'チェックアウト': 95, '泊数': 50, '顔写真': 80, '氏名': 170, '国籍': 120,
  '生年月日': 95, '旅券番号': 110, '区分': 60, '住所': 240, '住所（日本語訳）': 240,
  '電話番号': 120, 'メールアドレス': 180, '職業': 110, '職業（日本語訳）': 110,
  '国籍コード': 70, '国籍（入力原文）': 120, '入力方法': 110, '入力言語': 70, '受付日時': 130,
  '顔写真URL': 120, '旅券画像URL': 120,
};

// フォームの言語コード → LanguageApp.translate() の言語コード
const TRANSLATE_SOURCE_LANG = { ja: 'ja', en: 'en', 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-TW', ko: 'ko' };

/* ------------------------------------------------------------------ */

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = JSON.parse(e.postData.contents);
    const guests = (data.guests || []).slice(0, MAX_GUESTS);
    const sheet = getSheet_();
    const sourceLang = TRANSLATE_SOURCE_LANG[data.lang] || 'ja';
    const received = new Date();
    const checkin = parseDate_(data.checkin);
    const checkout = parseDate_(data.checkout);

    guests.forEach((g) => appendGuest_(sheet, g, { checkin, checkout, received, lang: data.lang, sourceLang }));
    return json_({ result: 'success', saved: guests.length });
  } catch (err) {
    return json_({ result: 'error', message: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return ContentService.createTextOutput('ICHZA KYOTO 宿泊者名簿 受付スクリプト: OK')
    .setMimeType(ContentService.MimeType.TEXT);
}

function appendGuest_(sheet, g, ctx) {
  const name = [g.familyName, g.givenName].filter(Boolean).join(' ');

  // 顔写真・原本画像をDriveに保存（失敗しても名簿の行は残す）
  const faceBlob = toImageBlob_(g.faceImage, `${formatDate_(ctx.checkin)}_${name}_face.jpg`);
  const faceUrl = faceBlob ? saveToDrive_(FACE_FOLDER_NAME, faceBlob) : '';
  const passportBlob = toImageBlob_(g.passportImage, `${formatDate_(ctx.checkin)}_${name}_passport.jpg`);
  const passportUrl = passportBlob ? saveToDrive_(PASSPORT_FOLDER_NAME, passportBlob) : '';

  // 国籍: 端末側で国名を日本語化済みならそれを使い、手入力なら入力言語から日本語へ翻訳する
  const natJa = g.nationalityJa || translateToJa_(g.nationality, ctx.sourceLang);

  const row = new Array(HEADERS.length).fill('');
  const put = (header, value) => { row[COL[header] - 1] = value; };
  put('チェックイン', ctx.checkin);
  put('チェックアウト', ctx.checkout);
  put('氏名', text_(name));
  put('国籍', text_(natJa));
  put('生年月日', parseDate_(g.birth));
  put('旅券番号', text_(g.passportNo));
  put('区分', g.isRepresentative ? '代表者' : '同行者');
  put('住所', text_(g.address));
  put('住所（日本語訳）', text_(translateToJa_(g.address, ctx.sourceLang)));
  put('電話番号', text_(g.phone));
  put('メールアドレス', text_(g.email));
  put('職業', text_(g.occupation));
  put('職業（日本語訳）', text_(translateToJa_(g.occupation, ctx.sourceLang)));
  put('国籍コード', text_(g.nationalityCode));
  put('国籍（入力原文）', text_(g.nationality));
  put('入力方法', g.autoFilled ? 'パスポート読み取り' : '手入力');
  put('入力言語', ctx.lang || '');
  put('受付日時', ctx.received);
  put('顔写真URL', faceUrl);
  put('旅券画像URL', passportUrl);
  sheet.appendRow(row);

  const r = sheet.getLastRow();
  // 泊数は計算式にしておく（後からスタッフが日付を直しても自動で追従する）
  sheet.getRange(r, COL['泊数'])
    .setFormulaR1C1(`=IF(AND(RC[${COL['チェックイン'] - COL['泊数']}]<>"",RC[${COL['チェックアウト'] - COL['泊数']}]<>""),RC[${COL['チェックアウト'] - COL['泊数']}]-RC[${COL['チェックイン'] - COL['泊数']}],"")`);
  sheet.getRange(r, 1, 1, HEADERS.length).setVerticalAlignment('middle');
  applyRowFormats_(sheet, r);

  if (faceBlob) {
    sheet.setRowHeight(r, 96);
    try {
      sheet.insertImage(faceBlob, COL['顔写真'], r, 4, 3).setWidth(72).setHeight(90);
    } catch (err) {
      // 埋め込みに失敗しても、Driveに保存した顔写真のURLは行に残っている
    }
  }
}

/* ---------------- シートの準備 ---------------- */

/** 最初に1回、エディタから実行する。何度実行しても安全。 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  ss.setSpreadsheetTimeZone(TIMEZONE); // 日付がずれないよう、日本時間に固定
  const sheet = getSheet_();

  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight('bold').setBackground('#2b3a55').setFontColor('#ffffff').setVerticalAlignment('middle');
  sheet.setFrozenRows(1);
  HEADERS.forEach((h, i) => sheet.setColumnWidth(i + 1, COLUMN_WIDTHS[h]));
  const rows = Math.max(sheet.getMaxRows() - 1, 1);
  ['チェックイン', 'チェックアウト', '生年月日'].forEach((h) =>
    sheet.getRange(2, COL[h], rows, 1).setNumberFormat('yyyy-mm-dd'));
  sheet.getRange(2, COL['受付日時'], rows, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  sheet.getRange(2, COL['泊数'], rows, 1).setNumberFormat('0"泊"').setHorizontalAlignment('center');
  Logger.log('準備完了: ' + ss.getUrl());
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_() {
  const ss = getSpreadsheet_();
  if (ss.getSpreadsheetTimeZone() !== TIMEZONE) ss.setSpreadsheetTimeZone(TIMEZONE); // 日付のずれ防止
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME, 0);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function applyRowFormats_(sheet, r) {
  ['チェックイン', 'チェックアウト', '生年月日'].forEach((h) => sheet.getRange(r, COL[h]).setNumberFormat('yyyy-mm-dd'));
  sheet.getRange(r, COL['受付日時']).setNumberFormat('yyyy-mm-dd hh:mm');
  sheet.getRange(r, COL['泊数']).setNumberFormat('0"泊"').setHorizontalAlignment('center');
}

/* ---------------- 部品 ---------------- */

// フォームは公開されているため、入力が「=」「+」「-」「@」で始まっても数式として実行されないようにする
function text_(v) {
  const s = String(v == null ? '' : v).trim().slice(0, 500);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function parseDate_(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return '';
  try {
    return Utilities.parseDate(String(s), TIMEZONE, 'yyyy-MM-dd');
  } catch (err) {
    return '';
  }
}

function formatDate_(d) {
  return d ? Utilities.formatDate(d, TIMEZONE, 'yyyyMMdd') : 'nodate';
}

function translateToJa_(value, sourceLang) {
  const s = String(value || '').trim();
  if (!s || sourceLang === 'ja') return s;
  try {
    return LanguageApp.translate(s, sourceLang, 'ja');
  } catch (err) {
    return ''; // 翻訳に失敗しても原文は別の列に残る
  }
}

function toImageBlob_(dataUrl, fileName) {
  const m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png));base64,(.+)$/);
  if (!m) return null;
  const safeName = fileName.replace(/[\\/:*?"<>|]/g, '_');
  return Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], safeName);
}

function saveToDrive_(folderName, blob) {
  try {
    return getFolder_(folderName).createFile(blob).getUrl();
  } catch (err) {
    return '';
  }
}

// スプレッドシートと同じフォルダ（例: 下京区若宮町）の中に作る
function getFolder_(name) {
  const file = DriveApp.getFileById(getSpreadsheet_().getId());
  const parents = file.getParents();
  const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
