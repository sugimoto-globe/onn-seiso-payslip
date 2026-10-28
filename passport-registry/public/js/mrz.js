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

  // OCRで詰め文字 '<' が K/C/L などに化けることがあるため、氏名欄の末尾に残った詰め文字の読み違いを取り除く。
  //   - 同じ文字の4回以上の繰り返し（MARIAKKKKK）
  //   - 末尾の「'<' のあとに続く、K/C/L/S/X/E だけの1文字、または5文字以上の塊」（<<L、<<LLLLKL など）
  // 本物の '<' を先に除いてから判定するので、MICHAEL のような語尾（E・L）は削らない。
  function cleanNamesField(s) {
    let body = s.replace(/<+$/, '').replace(/([KCLSXE])\1{3,}$/, '');
    for (let i = 0; i < 8; i++) {
      const next = body.replace(/<+(?:[KCLSXE]{5,}|[KCLSXE])$/, '').replace(/<+$/, '');
      if (next === body) break;
      body = next;
    }
    return body;
  }

  // 氏名欄の単語を取り出す。末尾に残った「詰め文字が化けただけの単語」（LLLLLLKL など）は取り除く。
  function toWords(s) {
    const w = toAlpha(s).split('<').filter(Boolean);
    while (w.length > 1 && /^[KCLSXE]{5,}$/.test(w[w.length - 1])) w.pop();
    return w;
  }

  // 氏名欄（姓<<名）を姓と名に分ける。区切りの '<<' が正しく読めていないときは補正を試み、
  // 補正した（または名が空の）場合は repaired を立てて、画面で「要確認」にできるようにする。
  function splitNames(body) {
    let sepAt = body.indexOf('<<');
    let repaired = false;
    if (sepAt < 0) {
      // 区切りの2つ目の '<' が K/C/L などに化けた場合（SUGIMOTO<KTAKUMI → SUGIMOTO<<TAKUMI）
      const m = body.search(/<[KCLSXE](?=[A-Z])/);
      if (m >= 0) {
        body = body.slice(0, m) + '<<' + body.slice(m + 2);
        sepAt = m;
        repaired = true;
      }
    }
    if (sepAt >= 0) {
      return { surname: toWords(body.slice(0, sepAt)).join(' '), givenNames: toWords(body.slice(sepAt + 2)).join(' '), repaired };
    }
    const w = toWords(body);
    // 区切りが読めておらず2語だけなら、「姓 名」とみなす（'<<' の片方が欠けた場合）
    if (w.length === 2) return { surname: w[0], givenNames: w[1], repaired: true };
    return { surname: w.join(' '), givenNames: '', repaired: false };
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

    const names = splitNames(cleanNamesField(l1.slice(5)));

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
      surname: names.surname,
      givenNames: names.givenNames,
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
    if (!fields.surname || !fields.givenNames || names.repaired) uncertain.push('name'); // 名が空・区切りを補正した場合も要確認

    const score = Object.values(checks).filter(Boolean).length;
    return { fields, checks, score, uncertain, raw: { line1 } }; // raw: 調整用（1行目＝氏名のみ。旅券番号を含む2行目は返さない）
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
      pairs.push({ line1: lines[i], line2: normalizeLine2(lines[i + 1]) });
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
