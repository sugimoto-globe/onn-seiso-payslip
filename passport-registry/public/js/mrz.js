/**
 * パスポート下部の MRZ（機械読取領域・2行×44文字 / ICAO 9303 TD3）の解析。
 * OCRの誤読（O/0, I/1 など）をチェックディジットで補正し、
 * どの項目が検算で確認できたかを返す。ブラウザ（window.MRZ）と Node の両方で動く。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MRZ = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LINE_LEN = 44;

  // 見た目が似ていて OCR が取り違えやすい文字のグループ（補正の候補）
  const CONFUSABLE = [
    ['0', 'O', 'Q', 'D'], ['1', 'I', 'L'], ['2', 'Z'], ['5', 'S'], ['6', 'G'], ['8', 'B'],
  ];
  const TO_DIGIT = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', G: '6', B: '8' };
  const TO_ALPHA = { 0: 'O', 1: 'I', 2: 'Z', 5: 'S', 6: 'G', 8: 'B' };

  function charValue(c) {
    if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
    if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 55;
    return 0; // '<'
  }

  function checkDigit(str) {
    const w = [7, 3, 1];
    let sum = 0;
    for (let i = 0; i < str.length; i++) sum += charValue(str[i]) * w[i % 3];
    return String(sum % 10);
  }

  const toDigits = (s) => s.replace(/[A-Z]/g, (c) => TO_DIGIT[c] || c);
  const toAlpha = (s) => s.replace(/[0-9]/g, (c) => TO_ALPHA[c] || c);

  // 検算が合わないとき、取り違えやすい文字を「1文字だけ」入れ替えて検算が合う候補を探す。
  // 検算は10通りしかなく偶然合うことがあるため、候補がちょうど1つに定まる場合だけ採用し、
  // 補正した項目は呼び出し側で「要確認」として扱う。
  function repairByCheckDigit(str, expected) {
    if (checkDigit(str) === expected) return { value: str, status: 'ok' };
    const found = [];
    for (let i = 0; i < str.length; i++) {
      const group = CONFUSABLE.find((g) => g.includes(str[i]));
      if (!group) continue;
      for (const c of group) {
        if (c === str[i]) continue;
        const cand = str.slice(0, i) + c + str.slice(i + 1);
        if (checkDigit(cand) === expected) found.push(cand);
      }
    }
    return found.length === 1
      ? { value: found[0], status: 'repaired' }
      : { value: str, status: 'invalid' };
  }

  function formatDate(yymmdd, kind, now) {
    if (!/^\d{6}$/.test(yymmdd)) return '';
    const yy = Number(yymmdd.slice(0, 2));
    const mm = Number(yymmdd.slice(2, 4));
    const dd = Number(yymmdd.slice(4, 6));
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
    let year;
    if (kind === 'birth') {
      // 生年月日: 2000年代にして未来日になるなら1900年代とみなす
      year = 2000 + yy;
      const d = new Date(Date.UTC(year, mm - 1, dd));
      if (d.getTime() > now.getTime()) year = 1900 + yy;
    } else {
      year = 2000 + yy;
    }
    return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }

  // OCRで詰め文字 '<' が K/C/L などに化けることがあるため、氏名欄の末尾に残った
  // 「同じ文字の4回以上の繰り返し」だけを詰め文字として取り除く
  // （本物の '<' を先に除いてから判定する。MICHAEL のような語尾を削らないため）。
  function cleanNamesField(s) {
    const body = s.replace(/<+$/, '');
    const junk = body.replace(/([KCLSXE])\1{3,}$/, '');
    return junk;
  }

  /**
   * 2行（各44文字）を解析する。
   * 戻り値: { fields, checks, score, uncertain[] }
   *  score: 検算が合った数（旅券番号・生年月日・有効期限・全体）0〜4
 *  uncertain: 画面で「要確認」にする項目（検算が合わない／OCR補正をかけた項目）
   */
  function parseTD3(line1, line2, now) {
    now = now || new Date();
    const l1 = line1.padEnd(LINE_LEN, '<').slice(0, LINE_LEN);
    const l2 = line2.padEnd(LINE_LEN, '<').slice(0, LINE_LEN);

    const namesRaw = cleanNamesField(l1.slice(5));
    const sepAt = namesRaw.indexOf('<<');
    const surnameRaw = sepAt >= 0 ? namesRaw.slice(0, sepAt) : namesRaw;
    const givenRaw = sepAt >= 0 ? namesRaw.slice(sepAt + 2) : '';
    // 末尾に残った「詰め文字が化けただけの単語」（LLLLLLKL など）は取り除く
    const words = (s) => {
      const w = toAlpha(s).split('<').filter(Boolean);
      while (w.length > 1 && /^[KCLSXE]{5,}$/.test(w[w.length - 1])) w.pop();
      return w.join(' ');
    };

    // 2行目: 旅券番号(0-8) 検算(9) 国籍(10-12) 生年月日(13-18) 検算(19)
    //        性別(20) 有効期限(21-26) 検算(27) 任意(28-41) 検算(42) 全体検算(43)
    const pn = repairByCheckDigit(l2.slice(0, 9), toDigits(l2[9])[0]);
    const birthStr = toDigits(l2.slice(13, 19));
    const birthChk = toDigits(l2[19])[0];
    const expStr = toDigits(l2.slice(21, 27));
    const expChk = toDigits(l2[27])[0];
    const nationality = toAlpha(l2.slice(10, 13));
    const sexRaw = l2[20];
    const sex = sexRaw === 'M' || sexRaw === 'F' ? sexRaw : '';

    const checks = {
      passportNo: pn.status !== 'invalid',
      birth: checkDigit(birthStr) === birthChk,
      expiry: checkDigit(expStr) === expChk,
      composite: false,
    };
    // 全体の検算: 旅券番号+検算 / 生年月日+検算 / 有効期限+検算+任意データ+検算
    const composite = pn.value + l2[9] + birthStr + birthChk + expStr + expChk + l2.slice(28, 43);
    checks.composite = checkDigit(composite.replace(/[^A-Z0-9<]/g, '<')) === toDigits(l2[43])[0];

    const fields = {
      documentCode: l1.slice(0, 2).replace(/</g, ''),
      issuingCountry: toAlpha(l1.slice(2, 5)),
      surname: words(surnameRaw),
      givenNames: words(givenRaw),
      passportNo: pn.value.replace(/</g, ''),
      nationality,
      birth: formatDate(birthStr, 'birth', now),
      sex,
      expiry: formatDate(expStr, 'expiry', now),
    };

    const uncertain = [];
    if (pn.status !== 'ok') uncertain.push('passportNo'); // 補正した場合も要確認
    if (!checks.birth || !fields.birth) uncertain.push('birth');
    if (!/^[A-Z]{3}$/.test(nationality)) uncertain.push('nationality');
    if (!fields.surname) uncertain.push('name');

    const score = Object.values(checks).filter(Boolean).length;
    return { fields, checks, score, uncertain };
  }

  // OCR の生テキストから MRZ らしい行を拾い、44文字に整形して候補ペアを作る
  function findCandidates(text) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((l) => l.toUpperCase().replace(/[«‹〈＜]/g, '<').replace(/[^A-Z0-9<]/g, ''))
      .filter((l) => l.length >= 30 && l.length <= 52);

    const pairs = [];
    for (let i = 0; i + 1 < lines.length; i++) {
      if (lines[i][0] !== 'P' || lines[i + 1].length < 36) continue;
      pairs.push({ line1: lines[i].slice(0, LINE_LEN), line2: normalizeLine2(lines[i + 1]) });
    }
    return pairs;
  }

  // 2行目の長さが44でないとき、固定位置の項目(先頭28文字・末尾2文字)を守り、
  // 任意データ欄(14文字)の過不足だけを '<' で調整する
  function normalizeLine2(s) {
    if (s.length === LINE_LEN) return s;
    const head = s.slice(0, 28);
    const tail = s.slice(-2);
    const middle = s.slice(28, -2).slice(0, 14).padEnd(14, '<');
    return head + middle + tail;
  }

  /** OCRテキスト全体から最も検算が合う解析結果を返す（見つからなければ null） */
  function parseText(text, now) {
    let best = null;
    for (const c of findCandidates(text)) {
      const r = parseTD3(c.line1, c.line2, now);
      if (!best || r.score > best.score) best = r;
    }
    return best;
  }

  return { parseTD3, parseText, findCandidates, checkDigit };
});
