(function () {
  'use strict';

  const SUBMIT_ENDPOINT = '/api/submit';
  const CFG = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);
  const DEBUG = new URLSearchParams(location.search).has('debug'); // 読み取り結果（氏名行）を画面に出す調整用

  /* ---------------- 言語 ---------------- */
  function detectLang() {
    const n = (navigator.language || 'en').toLowerCase();
    if (n.startsWith('ja')) return 'ja';
    if (n.startsWith('ko')) return 'ko';
    if (n.startsWith('zh')) return /hant|tw|hk|mo/.test(n) ? 'zh-Hant' : 'zh-Hans';
    return 'en';
  }
  let lang = detectLang();
  const t = (key, ...args) => {
    const v = window.I18N[lang][key];
    return typeof v === 'function' ? v(...args) : v;
  };
  const countryName = (code, l) => window.Countries.countryName(code, l);

  /* ---------------- 宿泊期間 ---------------- */
  const dayNumber = (s) => Date.parse(s + 'T00:00:00Z') / 86400000;

  function updateNights() {
    const a = $('checkin').value;
    const b = $('checkout').value;
    const n = a && b ? Math.round(dayNumber(b) - dayNumber(a)) : 0;
    $('nights').textContent = n > 0 ? t('nights', n) : '';
    if (a) {
      const min = new Date((dayNumber(a) + 1) * 86400000).toISOString().slice(0, 10);
      $('checkout').min = min;
    }
  }
  ['checkin', 'checkout'].forEach((id) => {
    $(id).addEventListener('change', () => {
      updateNights();
      document.querySelector(`[data-field="${id}"]`).classList.remove('invalid');
    });
  });

  /* ---------------- 宿泊者カード ---------------- */
  const guests = [];

  function fieldHtml(key, type, required) {
    return `<div class="field${required ? ' req' : ''}" data-field="${key}">
      <label data-t="${key}"></label><input type="${type}" data-f="${key}" autocomplete="off"></div>`;
  }

  function createGuest(isRep) {
    const el = document.createElement('div');
    el.className = 'guest';
    el.innerHTML = `
      <div class="guest-head">
        <span class="guest-label"></span>
        ${isRep ? '' : '<button type="button" class="link-btn" data-role="remove"></button>'}
      </div>
      <label class="check"><input type="checkbox" data-role="jp"><span data-t="japanese"></span></label>
      <div class="scan-block" data-role="scanBlock">
        <input type="file" accept="image/*" capture="environment" hidden data-role="file">
        <button type="button" class="btn-scan" data-role="scanBtn"></button>
        <p class="tip" data-role="tip"></p>
        <div class="scan-status" data-role="status" aria-live="polite"></div>
      </div>
      <div class="grid">
        ${fieldHtml('familyName', 'text', true)}
        ${fieldHtml('givenName', 'text', true)}
        ${fieldHtml('birth', 'date', true)}
        ${fieldHtml('nationality', 'text', true)}
        <div data-role="passportNoWrap">${fieldHtml('passportNo', 'text', true)}</div>
      </div>
      ${isRep ? `<div class="grid" style="margin-top:8px">
        ${fieldHtml('address', 'text', true)}
        ${fieldHtml('phone', 'tel', true)}
        ${fieldHtml('email', 'email', false)}
      </div>` : ''}`;

    const q = (sel) => el.querySelector(sel);
    const input = (key) => q(`[data-f="${key}"]`);
    const wrap = (key) => q(`[data-field="${key}"]`);

    // 撮影した画像そのものは保持しない。保持するのは読み取り結果と、設定で許可した場合の旅券の写し（圧縮コピー）のみ。
    // autoFilled: 読み取り結果を入力欄に反映済みか / attempted: 撮影を試みたか
    const state = { isRep, code: '', autoNat: '', original: '', autoFilled: false, attempted: false, status: null, debugLine: '' };

    const g = { el, state };

    function setStatus(kind, key, subKey) {
      state.status = kind ? { kind, key, subKey } : null;
      renderStatus();
    }
    function renderStatus() {
      const box = q('[data-role="status"]');
      if (!state.status) { box.className = 'scan-status'; box.textContent = ''; return; }
      const { kind, key, subKey } = state.status;
      box.className = 'scan-status ' + kind;
      box.textContent = t(key);
      if (subKey) {
        const sub = document.createElement('span');
        sub.className = 'sub';
        sub.textContent = t(subKey);
        box.appendChild(sub);
      }
      if (DEBUG && state.debugLine) {
        const dbg = document.createElement('code');
        dbg.className = 'sub';
        dbg.textContent = 'OCR: ' + state.debugLine;
        box.appendChild(dbg);
      }
    }

    g.render = function () {
      el.querySelectorAll('[data-t]').forEach((n) => { n.textContent = t(n.dataset.t); });
      q('.guest-label').textContent = isRep ? t('guestRep') : t('guestN') + ' ' + (guests.indexOf(g) + 1);
      const rm = q('[data-role="remove"]');
      if (rm) rm.textContent = t('remove');
      q('[data-role="tip"]').textContent = CFG.keepOriginalPassportImage ? t('scanTipKeep') : t('scanTip');
      q('[data-role="scanBtn"]').textContent = state.attempted ? t('rescanBtn') : t('scanBtn');
      // 自動入力した国名は、表示言語を切り替えたらその言語の表記に直す
      if (state.code && input('nationality').value === state.autoNat) {
        const name = countryName(state.code, lang);
        if (name) { input('nationality').value = name; state.autoNat = name; }
      }
      renderStatus();
    };

    /* 日本国籍: 撮影欄・旅券番号を隠す */
    const jp = q('[data-role="jp"]');
    jp.addEventListener('change', () => {
      q('[data-role="scanBlock"]').hidden = jp.checked;
      q('[data-role="passportNoWrap"]').hidden = jp.checked;
      const nat = input('nationality');
      if (jp.checked) {
        state.code = 'JPN';
        state.autoNat = countryName('JPN', lang);
        nat.value = state.autoNat;
      } else if (nat.value === state.autoNat) {
        nat.value = ''; state.code = ''; state.autoNat = '';
      }
    });

    /* 撮影 → 端末内で読み取り */
    const file = q('[data-role="file"]');
    const scanBtn = q('[data-role="scanBtn"]');
    scanBtn.addEventListener('click', () => {
      window.PassportScan.warmup(); // カメラが開いている間に読み取りエンジンを先読み
      file.click();
    });
    file.addEventListener('change', async () => {
      const picked = file.files && file.files[0];
      if (!picked) return;
      scanBtn.disabled = true;
      setStatus('busy', 'scanning');
      let result;
      try {
        result = await window.PassportScan.scan(picked, { keepOriginal: CFG.keepOriginalPassportImage });
      } finally {
        file.value = ''; // 選択された元画像への参照を手放す
        scanBtn.disabled = false;
      }
      applyScan(result);
    });

    function setField(key, value, uncertain) {
      if (value) input(key).value = value;
      wrap(key).classList.toggle('uncertain', !!uncertain);
      wrap(key).classList.remove('invalid');
    }

    function applyScan(res) {
      state.attempted = true;
      state.original = res.original || '';
      const mrz = res.mrz;
      const usable = mrz && (mrz.score >= 2 || (mrz.fields.surname && mrz.fields.passportNo));

      state.autoFilled = !!usable;
      if (!usable) {
        setStatus('err', res.error === 'ocr' ? 'scanUnavailable' : 'scanFail');
        g.render();
        return;
      }
      state.debugLine = mrz.raw ? mrz.raw.line1 : '';
      const f = mrz.fields;
      const bad = (k) => mrz.uncertain.includes(k);
      setField('familyName', f.surname, bad('name'));
      setField('givenName', f.givenNames, bad('name'));
      setField('birth', f.birth, bad('birth'));
      setField('passportNo', f.passportNo, bad('passportNo'));

      const name = countryName(f.nationality, lang);
      state.code = name ? f.nationality : '';
      state.autoNat = name || '';
      setField('nationality', name || f.nationality, !name || bad('nationality'));
      // 日本国籍のチェックは外す（旅券を撮影した＝旅券番号を入力する宿泊者）
      jp.checked = false;
      q('[data-role="scanBlock"]').hidden = false;
      q('[data-role="passportNoWrap"]').hidden = false;

      setStatus(mrz.uncertain.length ? 'warn' : 'ok', 'scanOk', mrz.uncertain.length ? 'scanCheck' : null);
      g.render();
    }

    // 手で直した項目の「要確認」表示は消す
    el.querySelectorAll('input[data-f]').forEach((i) => {
      i.addEventListener('input', () => {
        const w = i.closest('.field');
        w.classList.remove('uncertain', 'invalid');
      });
    });
    const rm = q('[data-role="remove"]');
    if (rm) rm.addEventListener('click', () => {
      guests.splice(guests.indexOf(g), 1);
      el.remove();
      guests.forEach((x) => x.render());
    });

    // 入力チェック。問題のある項目に invalid を付け、最初の1つを返す
    g.validate = function () {
      let first = null;
      const need = ['familyName', 'givenName', 'birth', 'nationality'];
      if (!jp.checked) need.push('passportNo');
      if (isRep) need.push('address', 'phone');
      need.forEach((k) => {
        const empty = !input(k).value.trim();
        wrap(k).classList.toggle('invalid', empty);
        if (empty && !first) first = wrap(k);
      });
      return first;
    };

    g.address = () => (input('address') ? input('address').value.trim() : '');

    g.toPayload = function (repAddress) {
      const natText = input('nationality').value.trim();
      const unchanged = state.code && natText === state.autoNat;
      return {
        isRepresentative: isRep,
        familyName: input('familyName').value.trim(),
        givenName: input('givenName').value.trim(),
        birth: input('birth').value,
        nationality: natText,
        // 自動入力した国名はこちらで日本語名にしておく（手入力の場合はサーバー側で翻訳）
        nationalityJa: unchanged ? countryName(state.code, 'ja') || '' : '',
        nationalityCode: unchanged ? state.code : '',
        passportNo: jp.checked ? '' : input('passportNo').value.trim(),
        address: repAddress,
        phone: isRep ? input('phone').value.trim() : '',
        email: isRep ? input('email').value.trim() : '',
        autoFilled: state.autoFilled,
        passportImage: state.original,
      };
    };

    return g;
  }

  function addGuest(isRep) {
    const g = createGuest(isRep);
    guests.push(g);
    $('guestList').appendChild(g.el);
    g.render();
  }

  /* ---------------- 言語切り替え ---------------- */
  function applyI18n() {
    document.documentElement.lang = lang;
    document.title = CFG.hotelName + '｜' + t('title');
    document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
    document.querySelectorAll('.lang-btn').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
    guests.forEach((g) => g.render());
    updateNights();
    renderFormStatus();
  }
  $('langBar').addEventListener('click', (e) => {
    const b = e.target.closest('.lang-btn');
    if (!b) return;
    lang = b.dataset.lang;
    applyI18n();
  });

  /* ---------------- 送信 ---------------- */
  // 送信欄のメッセージは言語を切り替えても追従するよう、文言そのものではなくキーを持つ
  let formStatus = null; // { key, err }
  function renderFormStatus() {
    const s = $('formStatus');
    s.className = 'status-msg' + (formStatus && formStatus.err ? ' err' : '');
    s.textContent = formStatus ? t(formStatus.key) : '';
  }
  function showStatus(key, err) {
    formStatus = key ? { key, err: !!err } : null;
    renderFormStatus();
  }
  const showError = (key) => showStatus(key, true);

  $('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    showStatus(null);

    let first = null;
    const mark = (id, bad) => {
      const w = document.querySelector(`[data-field="${id}"]`);
      w.classList.toggle('invalid', bad);
      if (bad && !first) first = w;
    };
    const a = $('checkin').value;
    const b = $('checkout').value;
    mark('checkin', !a);
    mark('checkout', !b);
    guests.forEach((g) => { const bad = g.validate(); if (bad && !first) first = bad; });
    if (first) {
      first.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return showError('errRequired');
    }
    if (dayNumber(b) <= dayNumber(a)) {
      mark('checkout', true);
      $('checkout').scrollIntoView({ block: 'center', behavior: 'smooth' });
      return showError('errDates');
    }
    if (!$('consent').checked) return showError('errConsent');

    const btn = $('submit');
    btn.disabled = true;
    const label = btn.textContent;
    showStatus('sending', false);

    try {
      const repAddress = guests[0].address();
      const payload = {
        lang,
        checkin: a,
        checkout: b,
        guests: guests.map((g) => g.toPayload(repAddress)),
      };
      const res = await fetch(SUBMIT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json().catch(() => ({ result: 'success' }));
      if (data.result === 'error') throw new Error(data.message || 'error');

      // 送信済みの旅券の写しをメモリから消す
      guests.forEach((g) => { g.state.original = ''; });
      $('guestList').textContent = '';
      $('form').hidden = true;
      $('done').hidden = false;
    } catch (err) {
      showError('errSubmit');
      btn.disabled = false;
      btn.textContent = label;
    }
  });

  $('addGuest').addEventListener('click', () => addGuest(false));

  /* ---------------- 起動 ---------------- */
  $('hotelName').textContent = CFG.hotelName;
  $('hotelAddr').textContent = CFG.hotelAddress;
  addGuest(true);
  applyI18n();
})();
