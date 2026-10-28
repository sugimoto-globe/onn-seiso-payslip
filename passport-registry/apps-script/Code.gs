/**
 * ICHZA KYOTO 宿泊者名簿（パスポート自動読み取り版）受付スクリプト
 *
 * 使い方（詳しくは passport-registry/README.md）:
 *  1. 名簿にするスプレッドシートを開き、[拡張機能] > [Apps Script] にこのファイルを貼り付けて保存
 *  2. 関数 setup を1回実行（権限を承認）。シートの見出し・書式が整う
 *  3. [デプロイ] > [新しいデプロイ] > 種類「ウェブアプリ」
 *       実行するユーザー: 自分 / アクセスできるユーザー: 全員
 *     発行された /exec のURLを、Cloudflare Worker の GAS_WEBAPP_URL に設定する
 *  4. このファイルを更新したときは、貼り替えて setup を実行し、
 *     [デプロイ] > [デプロイを管理] > 鉛筆 > バージョン「新しいバージョン」> [デプロイ]（URLは変わらない）
 *
 * 書き込み先の列は、シート1行目の「見出しの文字」で決めます。
 * そのため、列の削除・並べ替えは自由にできます（見出しの文字は変えないでください）。
 *
 * 届くのは、ゲストの端末で読み取り済みの「文字情報」と、旅券の写しとして保存する
 * パスポート画像（フォーム側 config.js の keepOriginalPassportImage が true の場合）です。
 * パスポート画像はGoogleドライブに保存し、そのURLを「旅券画像URL」列に記録します。
 */

const SCRIPT_VERSION = '2026-10-28.3'; // 動いている版の確認用（応答にも含まれる）
const TIMEZONE = 'Asia/Tokyo';
const SHEET_NAME = '宿泊者名簿';
const PASSPORT_FOLDER_NAME = 'パスポート画像（ICHZA KYOTO）';
const MAX_GUESTS = 20;

// 見出し。新しいシートはこの順で作る。
// 左側に「いつ・誰が・何泊・どこの国籍」が並ぶよう、読む頻度の高い列を先頭に置いている。
const HEADERS = [
  'チェックイン', 'チェックアウト', '泊数', '氏名', '国籍', '生年月日', '旅券番号', '区分',
  '住所', '住所（日本語訳）', '電話番号', 'メールアドレス',
  '国籍コード', '国籍（入力原文）', '入力方法', '入力言語', '受付日時', '旅券画像URL',
];
// 名簿として欠かせない列。誤って消されていたら、送信を受け付けたときに右端へ戻す。
// （これ以外の列は、消してあれば書き込まずに飛ばす）
const ESSENTIAL_HEADERS = ['チェックイン', 'チェックアウト', '氏名', '国籍', '生年月日', '旅券番号', '旅券画像URL'];
// 以前の版にあった列。setup を実行すると取り除く。
const LEGACY_HEADERS = ['顔写真', '顔写真URL'];

const DATE_HEADERS = ['チェックイン', 'チェックアウト', '生年月日'];
const COLUMN_WIDTHS = {
  'チェックイン': 95, 'チェックアウト': 95, '泊数': 50, '氏名': 170, '国籍': 120,
  '生年月日': 95, '旅券番号': 110, '区分': 60, '住所': 240, '住所（日本語訳）': 240,
  '電話番号': 120, 'メールアドレス': 180,
  '国籍コード': 70, '国籍（入力原文）': 120, '入力方法': 110, '入力言語': 70, '受付日時': 130,
  '旅券画像URL': 200,
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
    ensureHeaders_(sheet, ESSENTIAL_HEADERS);
    const cols = readColumns_(sheet);
    const ctx = {
      cols,
      checkin: parseDate_(data.checkin),
      checkout: parseDate_(data.checkout),
      received: new Date(),
      lang: data.lang,
      sourceLang: TRANSLATE_SOURCE_LANG[data.lang] || 'ja',
    };

    guests.forEach((g) => appendGuest_(sheet, g, ctx));
    return json_({ result: 'success', saved: guests.length, version: SCRIPT_VERSION });
  } catch (err) {
    return json_({ result: 'error', message: String(err), version: SCRIPT_VERSION });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return ContentService.createTextOutput('ICHZA KYOTO 宿泊者名簿 受付スクリプト: OK (' + SCRIPT_VERSION + ')')
    .setMimeType(ContentService.MimeType.TEXT);
}

function appendGuest_(sheet, g, ctx) {
  const cols = ctx.cols;
  const name = [g.familyName, g.givenName].filter(Boolean).join(' ');

  // パスポート画像をDriveに保存してURLを記録する（保存に失敗しても名簿の行は残し、失敗が分かる印を付ける）
  const passportBlob = toImageBlob_(g.passportImage, `${formatDate_(ctx.checkin)}_${name}_passport.jpg`);
  const passportUrl = passportBlob
    ? (saveToDrive_(PASSPORT_FOLDER_NAME, passportBlob) || '（Drive保存に失敗）')
    : '';

  // 国籍: 端末側で国名を日本語化済みならそれを使い、手入力なら入力言語から日本語へ翻訳する
  const natJa = g.nationalityJa || translateToJa_(g.nationality, ctx.sourceLang);

  // 見出しの文字から列を探して書き込む（無い見出しは飛ばす）
  const row = new Array(sheet.getLastColumn()).fill('');
  const put = (header, value) => { if (cols[header]) row[cols[header] - 1] = value; };
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
  put('国籍コード', text_(g.nationalityCode));
  put('国籍（入力原文）', text_(g.nationality));
  put('入力方法', g.autoFilled ? 'パスポート読み取り' : '手入力');
  put('入力言語', ctx.lang || '');
  put('受付日時', ctx.received);
  put('旅券画像URL', passportUrl);
  sheet.appendRow(row);

  const r = sheet.getLastRow();
  // 泊数は計算式にしておく（後からスタッフが日付を直しても自動で追従する）
  if (cols['泊数'] && cols['チェックイン'] && cols['チェックアウト']) {
    const inCol = cols['チェックイン'];
    const outCol = cols['チェックアウト'];
    sheet.getRange(r, cols['泊数'])
      .setFormulaR1C1(`=IF(AND(RC${inCol}<>"",RC${outCol}<>""),RC${outCol}-RC${inCol},"")`);
  }
  applyFormats_(sheet, cols, r, 1);
}

/* ---------------- シートの準備 ---------------- */

/** 最初に1回、エディタから実行する。何度実行しても安全。 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  ss.setSpreadsheetTimeZone(TIMEZONE); // 日付がずれないよう、日本時間に固定
  const sheet = getSheet_();

  const removed = removeLegacyColumns_(sheet);
  const added = ensureHeaders_(sheet, HEADERS);
  const cols = readColumns_(sheet);
  const lastCol = sheet.getLastColumn();

  sheet.getRange(1, 1, 1, lastCol)
    .setFontWeight('bold').setBackground('#2b3a55').setFontColor('#ffffff').setVerticalAlignment('middle');
  sheet.setFrozenRows(1);
  Object.keys(cols).forEach((h) => { if (COLUMN_WIDTHS[h]) sheet.setColumnWidth(cols[h], COLUMN_WIDTHS[h]); });
  applyFormats_(sheet, cols, 2, Math.max(sheet.getMaxRows() - 1, 1));

  Logger.log('準備完了 (' + SCRIPT_VERSION + '): ' + ss.getUrl()
    + (removed.length ? ' / 取り除いた列: ' + removed.join('、') : '')
    + (added.length ? ' / 右端に追加した列: ' + added.join('、') : ''));
}

// 1行目の見出し → 列番号（1始まり）
function readColumns_(sheet) {
  const cols = {};
  const last = sheet.getLastColumn();
  if (last === 0) return cols;
  sheet.getRange(1, 1, 1, last).getValues()[0].forEach((h, i) => {
    const key = String(h).trim();
    if (key) cols[key] = i + 1;
  });
  return cols;
}

// 足りない見出しを右端に追加する。追加した見出しの一覧を返す。
function ensureHeaders_(sheet, names) {
  const cols = readColumns_(sheet);
  const missing = names.filter((h) => !cols[h]);
  if (missing.length) {
    sheet.getRange(1, Math.max(sheet.getLastColumn(), 0) + 1, 1, missing.length).setValues([missing]);
  }
  return missing;
}

// 以前の版にあった列（顔写真・顔写真URL）を取り除く。列を消すと番号が詰まるので、見つかるたびに探し直す。
// 顔写真のサムネイル画像と、それ用に広げた行の高さも元に戻す。列が無ければ何もしない。
function removeLegacyColumns_(sheet) {
  const removed = [];
  for (let guard = 0; guard < LEGACY_HEADERS.length; guard++) {
    const cols = readColumns_(sheet);
    const name = LEGACY_HEADERS.find((h) => cols[h]);
    if (!name) break;
    sheet.deleteColumn(cols[name]);
    removed.push(name);
  }
  if (removed.length) {
    sheet.getImages().forEach((img) => img.remove());
    const rows = sheet.getLastRow() - 1;
    if (rows > 0) sheet.setRowHeights(2, rows, 21);
  }
  return removed;
}

// 日付・泊数などの表示形式（見出しの文字で列を探す）
function applyFormats_(sheet, cols, firstRow, numRows) {
  DATE_HEADERS.forEach((h) => {
    if (cols[h]) sheet.getRange(firstRow, cols[h], numRows, 1).setNumberFormat('yyyy-mm-dd');
  });
  if (cols['受付日時']) sheet.getRange(firstRow, cols['受付日時'], numRows, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  if (cols['泊数']) {
    sheet.getRange(firstRow, cols['泊数'], numRows, 1).setNumberFormat('0"泊"').setHorizontalAlignment('center');
  }
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
