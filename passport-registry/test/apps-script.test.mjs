// 実行: node --test passport-registry/test/*.test.mjs
// Google の SpreadsheetApp / DriveApp などを最小限のモックにして Code.gs を動かし、
// 列の削除・並べ替えがあるシートでも見出しどおりの列に書き込まれることを確認する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

// ※ vm 内で作られた配列は、こちらの配列とは種類が違うため、比較の前に [...x] で作り直している
function makeEnv({ grid = [], failDrive = false, images = 0 } = {}) {
  const files = []; const rec = { formulas: [], rowHeights: [], removedImages: 0, deleted: [] };
  let imgs = Array.from({ length: images }, () => ({ remove() { rec.removedImages++; } }));
  const lastCol = () => grid.reduce((m, r) => Math.max(m, r.length), 0);
  const range = (r, c, nr = 1, nc = 1) => ({
    getValues() { return [Array.from({ length: nc }, (_, i) => (grid[r - 1] || [])[c - 1 + i] ?? '')]; },
    setValues(v) { grid[r - 1] = grid[r - 1] || []; v[0].forEach((x, i) => { grid[r - 1][c - 1 + i] = x; }); return this; },
    setFormulaR1C1(f) { rec.formulas.push({ r, c, f }); return this; },
    setNumberFormat() { return this; }, setHorizontalAlignment() { return this; }, setFontWeight() { return this; },
    setBackground() { return this; }, setFontColor() { return this; }, setVerticalAlignment() { return this; },
  });
  const sheet = {
    appendRow(v) { grid.push(v.slice()); }, getLastRow: () => grid.length, getLastColumn: lastCol, getMaxRows: () => 100,
    deleteColumn(c) { rec.deleted.push(c); grid.forEach((row) => row.splice(c - 1, 1)); },
    getImages: () => imgs, setRowHeights(a, n, h) { rec.rowHeights.push([a, n, h]); }, setFrozenRows() {}, setColumnWidth() {},
    getRange: (r, c, nr, nc) => range(r, c, nr, nc),
  };
  const ss = { getSpreadsheetTimeZone: () => 'Asia/Tokyo', setSpreadsheetTimeZone() {}, getSheetByName: () => sheet, getId: () => 'SSID', getUrl: () => 'u', insertSheet: () => sheet };
  const ctx = {
    console, Logger: { log() {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: {}, createTextOutput: (s) => ({ s, setMimeType() { return this; } }) },
    LanguageApp: { translate: (s) => '訳:' + s },
    DriveApp: { getFileById: () => ({ getParents: () => ({ hasNext: () => false }) }), getRootFolder: () => ({
      getFoldersByName: () => ({ hasNext: () => false }),
      createFolder: (n) => ({ createFile: (b) => { if (failDrive) throw new Error('quota'); files.push({ folder: n, name: b.name }); return { getUrl: () => 'https://drive.google.com/file/d/ID123/view' }; } }) }) },
    Utilities: { base64Decode: (s) => Buffer.from(s, 'base64'), newBlob: (bytes, type, name) => ({ bytes, type, name }),
      parseDate: (s) => new Date(s + 'T00:00:00+09:00'),
      formatDate: (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '') },
  };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  return { ctx, grid, rec, files, HEADERS: [...vm.runInContext('HEADERS', ctx)], post: (p) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(p) } }).s) };
}
const jpg = 'data:image/jpeg;base64,' + Buffer.from('jpegbytes').toString('base64');
const payload = { lang: 'en', checkin: '2026-11-01', checkout: '2026-11-04', guests: [{
  isRepresentative: true, familyName: 'EXAMPLE', givenName: 'JOHN', birth: '1988-01-15', nationality: 'United States', nationalityJa: 'アメリカ合衆国',
  nationalityCode: 'USA', passportNo: 'X12345678', address: '1 Main St', phone: '+1 555', email: 'a@b.c', autoFilled: true, passportImage: jpg }] };
const byHeader = (grid, r) => Object.fromEntries(grid[0].map((h, i) => [h, grid[r][i]]).filter(([h]) => h));
const expectRow = (row) => {
  assert.equal(row['氏名'], 'EXAMPLE JOHN'); assert.equal(row['国籍'], 'アメリカ合衆国'); assert.equal(row['旅券番号'], 'X12345678');
  assert.equal(row['区分'] ?? '代表者', '代表者'); assert.match(row['旅券画像URL'], /drive\.google\.com/);
  assert.equal(row['チェックイン'].toISOString(), '2026-10-31T15:00:00.000Z'); assert.equal(row['チェックアウト'].toISOString(), '2026-11-03T15:00:00.000Z');
  assert.equal(row['生年月日'].toISOString(), '1988-01-14T15:00:00.000Z');
};


test('新しいシートに、標準の見出し順で書き込む', () => {
  const t = makeEnv();
  const res = t.post(payload);
  assert.equal(res.result, 'success');
  assert.deepEqual([...t.grid[0]], t.HEADERS);
  expectRow(byHeader(t.grid, 1));
  assert.equal(byHeader(t.grid, 1)['電話番号'], "'+1 555"); // 「+」始まりは数式にならないよう文字扱い
});

test('列を削除・並べ替え・追加したシートでも、見出しの文字どおりの列に入る', () => {
  const scrambled = ['氏名', '旅券画像URL', 'メモ', 'チェックイン', 'チェックアウト', '泊数', '国籍', '旅券番号', '生年月日', '住所', '受付日時'];
  const t = makeEnv({ grid: [scrambled.slice()] });
  t.post(payload);
  const row = byHeader(t.grid, 1);
  expectRow(row);
  assert.equal(row['メモ'], '');
  assert.equal(t.grid[0].length, scrambled.length); // 余計な列は増えない
  assert.equal(t.rec.formulas[0].f, '=IF(AND(RC4<>"",RC5<>""),RC5-RC4,"")'); // 泊数の式は列の並びに合わせる
});

test('欠かせない列（氏名）を消されていたら、受付時に右端へ戻す', () => {
  const noName = ['旅券画像URL', 'チェックイン', 'チェックアウト', '国籍', '旅券番号', '生年月日'];
  const t = makeEnv({ grid: [noName.slice()] });
  t.post(payload);
  assert.equal(t.grid[0][t.grid[0].length - 1], '氏名');
  expectRow(byHeader(t.grid, 1));
});

test('旧版のシート: setup で「顔写真」「顔写真URL」を取り除き、データの対応は保つ（何度実行しても同じ）', () => {
  const legacy = ['チェックイン', 'チェックアウト', '泊数', '顔写真', '氏名', '国籍', '生年月日', '旅券番号', '区分', '住所', '住所（日本語訳）', '電話番号', 'メールアドレス',
    '国籍コード', '国籍（入力原文）', '入力方法', '入力言語', '受付日時', '顔写真URL', '旅券画像URL'];
  const t = makeEnv({ grid: [legacy.slice(), legacy.map((h) => 'v:' + h)], images: 2 });
  t.ctx.setup();
  assert.deepEqual([...t.grid[0]], t.HEADERS);
  assert.equal(byHeader(t.grid, 1)['旅券画像URL'], 'v:旅券画像URL');
  assert.equal(byHeader(t.grid, 1)['氏名'], 'v:氏名');
  assert.equal(t.rec.removedImages, 2);
  assert.deepEqual(t.rec.rowHeights, [[2, 1, 21]]);
  t.ctx.setup();
  assert.equal(t.rec.deleted.length, 2);
});

test('「顔写真」列を手で消した旧シートでも、以前のように列がずれない', () => {
  const noFace = ['チェックイン', 'チェックアウト', '泊数', '氏名', '国籍', '生年月日', '旅券番号', '区分', '住所', '住所（日本語訳）', '電話番号', 'メールアドレス',
    '国籍コード', '国籍（入力原文）', '入力方法', '入力言語', '受付日時', '旅券画像URL'];
  const t = makeEnv({ grid: [noFace.slice()] });
  t.post(payload);
  expectRow(byHeader(t.grid, 1));
});

test('Driveへの保存に失敗しても行は残り、URL欄に印が付く', () => {
  const t = makeEnv({ failDrive: true });
  t.post(payload);
  assert.equal(byHeader(t.grid, 1)['旅券画像URL'], '（Drive保存に失敗）');
  assert.equal(byHeader(t.grid, 1)['氏名'], 'EXAMPLE JOHN');
});
