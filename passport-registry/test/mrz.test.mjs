// 実行: node --test passport-registry/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const MRZ = createRequire(import.meta.url)('../public/js/mrz.js');
const NOW = new Date(Date.UTC(2026, 9, 28));

// ICAO 9303 の公式サンプル
const L1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
const L2 = 'L898902C<3UTO6908061F9406236ZE184226B<<<<<14';

test('ICAOサンプルを解析し、4つの検算がすべて合う', () => {
  assert.equal(L1.length, 44);
  assert.equal(L2.length, 44);
  const r = MRZ.parseTD3(L1, L2, NOW);
  assert.equal(r.score, 4);
  assert.deepEqual(r.uncertain, []);
  assert.equal(r.fields.surname, 'ERIKSSON');
  assert.equal(r.fields.givenNames, 'ANNA MARIA');
  assert.equal(r.fields.passportNo, 'L898902C');
  assert.equal(r.fields.nationality, 'UTO');
  assert.equal(r.fields.birth, '1969-08-06');
  assert.equal(r.fields.sex, 'F');
  assert.equal(r.fields.expiry, '2094-06-23');
});

test('生年月日: 2000年代で未来日になる場合は1900年代とみなす', () => {
  const r = MRZ.parseTD3(L1, L2, NOW); // 690806 → 2069 は未来 → 1969
  assert.equal(r.fields.birth, '1969-08-06');
  const r2 = MRZ.parseTD3(L1, L2.replace('6908061', '0508061'), NOW);
  assert.equal(r2.fields.birth, '2005-08-06');
});

test('OCRの取り違え（旅券番号のO/0・日付欄の英字）を検算で補正する', () => {
  const noisy = 'L8989O2C<3UTO69O8O61F9406236ZE184226B<<<<<14';
  const r = MRZ.parseTD3(L1, noisy, NOW);
  assert.equal(r.fields.passportNo, 'L898902C');
  assert.equal(r.fields.birth, '1969-08-06');
  assert.equal(r.score, 4);
  assert.deepEqual(r.uncertain, ['passportNo']); // 補正した旅券番号は要確認にする
});

test('検算が偶然合うだけの入れ替え（L→1）では誤補正しない', () => {
  // 'L' と '1' は検算上の重みが同じ差になるため、補正候補に入れても検算は変わらない
  const r = MRZ.parseTD3(L1, L2, NOW);
  assert.equal(r.fields.passportNo, 'L898902C');
  assert.deepEqual(r.uncertain, []);
});

test('検算が合わない項目は uncertain に入り、補正された旅券番号も要確認になる', () => {
  const badBirth = MRZ.parseTD3(L1, L2.replace('6908061', '6908071'), NOW); // 日付の数字の誤読
  assert.ok(badBirth.uncertain.includes('birth'));
  assert.ok(badBirth.score < 4);

  const badPassportNo = MRZ.parseTD3(L1, L2.replace('L898902C<3', 'L898902K<3'), NOW); // C→K
  assert.ok(badPassportNo.uncertain.includes('passportNo'));
});

test('氏名欄の詰め文字 < が K に化けても氏名に混ざらない', () => {
  const noisyL1 = 'P<UTOERIKSSON<<ANNA<MARIAKKKKKKKKKKKKKKKKKKK';
  const r = MRZ.parseTD3(noisyL1, L2, NOW);
  assert.equal(r.fields.givenNames, 'ANNA MARIA');
});

test('語尾が E/L など詰め文字に似た文字でも氏名を削らない', () => {
  const l1 = 'P<USAEXAMPLE<<JOHN<MICHAEL<<<<<<<<<<<<<<<<<<';
  const r = MRZ.parseTD3(l1, L2, NOW);
  assert.equal(r.fields.givenNames, 'JOHN MICHAEL');
  const r2 = MRZ.parseTD3('P<USAWILLS<<ELLIS<<<<<<<<<<<<<<<<<<<<<<<<<<<<', L2, NOW);
  assert.equal(r2.fields.surname, 'WILLS');
  assert.equal(r2.fields.givenNames, 'ELLIS');
});

test('詰め文字が K/L の混在に化けて別の単語になっても取り除く', () => {
  const r = MRZ.parseTD3('P<USAEXAMPLE<<JOHN<MICHAEL<LLLLLLLLLLKL<<<<<<<', L2, NOW);
  assert.equal(r.fields.givenNames, 'JOHN MICHAEL');
});

test('姓名の区切り「<<」の2つ目が K に化けても（SUGIMOTO<KTAKUMI）、姓・名に分けて要確認にする', () => {
  const l1 = 'P<JPNSUGIMOTO<KTAKUMI<<<<<<<<<<<<<<<<<<<<<<<'.padEnd(44, '<');
  const r = MRZ.parseTD3(l1, L2, NOW);
  assert.equal(r.fields.surname, 'SUGIMOTO');
  assert.equal(r.fields.givenNames, 'TAKUMI');
  assert.ok(r.uncertain.includes('name'));
});

test('詰め文字の途中に読み違いが1文字混ざっても（<<<<L<<<）、名として拾わない', () => {
  const clean = MRZ.parseTD3('P<JPNSUGIMOTO<<TAKUMI<<<<<K<<<L<<<<<<<<<<<<<<'.slice(0, 44), L2, NOW);
  assert.equal(clean.fields.surname, 'SUGIMOTO');
  assert.equal(clean.fields.givenNames, 'TAKUMI');
  assert.ok(!clean.uncertain.includes('name'));
  const broken = MRZ.parseTD3('P<JPNSUGIMOTO<KTAKUMI<<<<<L<<<<<<<<<<<<<<<<<'.slice(0, 44), L2, NOW);
  assert.equal(broken.fields.surname, 'SUGIMOTO');
  assert.equal(broken.fields.givenNames, 'TAKUMI');
  assert.ok(broken.uncertain.includes('name'));
});

test('区切りの片方が欠けて2語だけに見える場合（SUGIMOTO<TAKUMI）は姓・名とみなし、要確認にする', () => {
  const r = MRZ.parseTD3('P<JPNSUGIMOTO<TAKUMI<<<<<<<<<<<<<<<<<<<<<<<<<<', L2, NOW);
  assert.equal(r.fields.surname, 'SUGIMOTO');
  assert.equal(r.fields.givenNames, 'TAKUMI');
  assert.ok(r.uncertain.includes('name'));
});

test('区切りが正しく読めているときは、そのまま姓・名にし、要確認にしない（K で始まる名も壊さない）', () => {
  for (const [line, sur, given] of [
    ['P<JPNSUGIMOTO<<TAKUMI', 'SUGIMOTO', 'TAKUMI'],
    ['P<JPNKOBAYASHI<<KENJI', 'KOBAYASHI', 'KENJI'],
    ['P<JPNSATO<<KAORI<KEI', 'SATO', 'KAORI KEI'],
  ]) {
    const r = MRZ.parseTD3(line.padEnd(44, '<'), L2, NOW);
    assert.equal(r.fields.surname, sur);
    assert.equal(r.fields.givenNames, given);
    assert.ok(!r.uncertain.includes('name'), line);
  }
});

test('区切りが読めず3語以上で判断できないときは、姓にまとめて名を空にし、要確認にする', () => {
  const r = MRZ.parseTD3('P<D<<VAN<DER<BERG'.replace('D<<', 'NLD') + '<'.repeat(30), L2, NOW);
  assert.equal(r.fields.givenNames, '');
  assert.ok(r.uncertain.includes('name'));
});

test('調整用に、1行目（氏名）の読み取り結果だけを返す（旅券番号を含む2行目は返さない）', () => {
  const r = MRZ.parseTD3(L1, L2, NOW);
  assert.equal(r.raw.line1, L1);
  assert.ok(!JSON.stringify(r.raw).includes('L898902C'));
});

test('実機で起きた読み違い（SUBIMOTO<TAKUMI<<CC）: 末尾の CC を名として拾わず、姓・名に分けて要確認にする', () => {
  const r = MRZ.parseTD3('P<JPNSUBIMOTO<TAKUMI<<CC<<<<<<<<<<<<<<<<<<<<<<<<', L2, NOW);
  assert.equal(r.fields.surname, 'SUBIMOTO');
  assert.equal(r.fields.givenNames, 'TAKUMI');
  assert.ok(r.uncertain.includes('name'));
});

test('子音だけの短い塊を落とす規則が、実在の名前（母音を含む）を壊さない', () => {
  for (const [line, sur, given] of [
    ['P<CHNLI<<LEE', 'LI', 'LEE'],
    ['P<KORKIM<<SEEK', 'KIM', 'SEEK'],
    ['P<GBRSMITH<<ELSE<KEL', 'SMITH', 'ELSE KEL'],
  ]) {
    const r = MRZ.parseTD3(line.padEnd(44, '<'), L2, NOW);
    assert.equal(r.fields.surname, sur, line);
    assert.equal(r.fields.givenNames, given, line);
  }
});

test('複数回の読み取りをまとめる: 氏名は多数決、旅券番号などの数字は検算が最もよく合ったもの', () => {
  const mk = (line1, line2 = L2) => MRZ.parseTD3(line1.padEnd(44, '<'), line2, NOW);
  const wrong = mk('P<JPNSUBIMOTO<TAKUMI<<CC');                       // 1回目: G→B と区切りの読み違い
  const right1 = mk('P<JPNSUGIMOTO<<TAKUMI');
  const right2 = mk('P<JPNSUGIMOTO<<TAKUMI<<K');
  const c = MRZ.combine([wrong, right1, right2]);
  assert.equal(c.mrz.fields.surname, 'SUGIMOTO');
  assert.equal(c.mrz.fields.givenNames, 'TAKUMI');
  assert.equal(c.agreed, true);
  assert.ok(!c.mrz.uncertain.includes('name'));
  assert.deepEqual(c.mrz.raw.all.length, 3);

  // 1回しか読めていない／食い違うときは、補正が必要だった氏名だけを要確認にする
  const one = MRZ.combine([wrong]);
  assert.equal(one.agreed, false);
  assert.ok(one.mrz.uncertain.includes('name'));
  const cleanOne = MRZ.combine([right1]);
  assert.equal(cleanOne.agreed, false);
  assert.ok(!cleanOne.mrz.uncertain.includes('name'));

  // 数字: 検算が合わない読み取りより、合う読み取りを採用
  const badNo = mk('P<JPNSUGIMOTO<<TAKUMI', L2.replace('L898902C<3', 'L898902K<3'));
  const c2 = MRZ.combine([badNo, right1]);
  assert.equal(c2.mrz.fields.passportNo, 'L898902C');
  assert.equal(MRZ.combine([]), null);
});

test('OCRテキスト全体から MRZ 行を拾う（余計な行・空白・2行目の長さ違いに耐える）', () => {
  const text = [
    'PASSPORT / PASAPORTE',
    'ERIKSSON ANNA MARIA',
    ' ' + L1.slice(0, 20) + ' ' + L1.slice(20),
    L2.slice(0, 43), // 1文字欠け（末尾の '<' 1つ分）
    '',
  ].join('\n');
  const r = MRZ.parseText(text, NOW);
  assert.ok(r);
  assert.equal(r.fields.passportNo, 'L898902C');
  assert.equal(r.fields.surname, 'ERIKSSON');
});

test('MRZ が無いテキストでは null', () => {
  assert.equal(MRZ.parseText('HELLO WORLD\nNOT A PASSPORT', NOW), null);
  assert.equal(MRZ.parseText('', NOW), null);
});
