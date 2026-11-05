/**
 * パスポート写真の読み取り（すべてゲストの端末内で完結する）。
 * 下部の MRZ（2行の英数字）を OCR（Tesseract.js）で読み、mrz.js で解析・検算する。
 * 撮影した画像はこのファイルの中だけで扱う。呼び出し側に返すのは「解析結果」と、
 * 設定（keepOriginal）で許可した場合のみ、旅券の写しとして保存するための圧縮コピーだけ。
 */
(function (root) {
  'use strict';

  const VENDOR = '/vendor/';
  const OCR_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<';

  // 試行順: 下部だけ → 下半分 → 全体 → 90°/270°回転した全体（パスポートを横向きに撮った場合）
  const ATTEMPTS = [
    { top: 0.62, rot: 0, width: 1800 },
    { top: 0.62, rot: 0, width: 2800 }, // 同じ範囲を大きめに（読み違いが起きる箇所を変えて、多数決に使う）
    { top: 0.45, rot: 0, width: 2200 },
    { top: 0.0, rot: 0, width: 2400 },
    { top: 0.0, rot: 90, width: 2400 },
    { top: 0.0, rot: 270, width: 2400 },
  ];

  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => { delete loaded[src]; reject(new Error('load failed: ' + src)); };
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  }

  /* ---------- 読み込み（最初に使われたときだけ・1回だけ） ---------- */
  let ocrPromise = null;
  function getOcr() {
    if (!ocrPromise) {
      ocrPromise = (async () => {
        await loadScript(VENDOR + 'tesseract/tesseract.min.js');
        const worker = await root.Tesseract.createWorker('eng', 1, {
          workerPath: VENDOR + 'tesseract/worker.min.js',
          corePath: VENDOR + 'tesseract/core',
          langPath: VENDOR + 'tesseract/lang',
          gzip: true,
        }, {
          // 辞書による「単語らしい補正」は MRZ では逆効果なので切る
          load_system_dawg: '0',
          load_freq_dawg: '0',
        });
        await worker.setParameters({
          tessedit_char_whitelist: OCR_WHITELIST,
          tessedit_pageseg_mode: '6', // 1つの文字ブロックとして読む
          preserve_interword_spaces: '0',
        });
        return worker;
      })().catch((e) => { ocrPromise = null; throw e; });
    }
    return ocrPromise;
  }

  /** 撮影ボタンが押された時点（カメラが開いている間）に先読みしておく */
  function warmup() {
    getOcr().catch(() => {});
  }

  /* ---------- 画像の扱い ---------- */
  async function loadBitmap(file) {
    try {
      // EXIFの向き（スマホの縦横）を反映して読み込む
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return await createImageBitmap(img);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }

  // bitmap の一部（上端から top の割合以下）を回転・縮小して canvas に描く
  function render(bitmap, { top = 0, rot = 0, width }) {
    const rotated = rot === 90 || rot === 270;
    const srcW = rotated ? bitmap.height : bitmap.width; // 回転後の幅・高さ
    const srcH = rotated ? bitmap.width : bitmap.height;
    const cropY = Math.round(srcH * top);
    const cropH = srcH - cropY;
    const scale = Math.min(width / srcW, 1.6); // 小さい画像を拡大しすぎない
    const outW = Math.max(1, Math.round(srcW * scale));
    const outH = Math.max(1, Math.round(cropH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(0, -cropY);
    if (rot === 90) { ctx.translate(srcW, 0); ctx.rotate(Math.PI / 2); }
    else if (rot === 270) { ctx.translate(0, srcH); ctx.rotate(-Math.PI / 2); }
    ctx.drawImage(bitmap, 0, 0);
    ctx.restore();
    return canvas;
  }

  // グレースケール化＋コントラスト伸長（照明ムラのある写真でも文字を読みやすくする）
  function enhance(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
      d[i] = y;
      hist[y]++;
    }
    const total = d.length / 4;
    let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.02) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.02) { hi = v; break; } }
    const range = Math.max(1, hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / range));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function release(canvas) { canvas.width = canvas.height = 0; }

  /* ---------- MRZ の読み取り ---------- */
  // 切り抜き・大きさを変えて複数回読み、結果をまとめる。氏名は検算できないため、
  // 2回の読み取りで氏名が一致するまで続けて、多数決で採用する（mrz.js の combine）。
  async function readMrz(bitmap, onStage, opts) {
    const worker = await getOcr();
    const parses = [];
    let combined = null;
    for (let i = 0; i < ATTEMPTS.length; i++) {
      const a = ATTEMPTS[i];
      // 回転しての再試行は、ここまでで何も読めていないときだけ
      if (a.rot !== 0 && combined && combined.mrz.score >= 2) break;
      onStage('reading', i + 1, ATTEMPTS.length);
      const canvas = enhance(render(bitmap, a));
      let text = '';
      try {
        text = (await worker.recognize(canvas)).data.text;
      } finally {
        release(canvas);
      }
      if (opts.onText) opts.onText(text); // 開発・調整用
      const parsed = root.MRZ.parseText(text, new Date());
      if (parsed) {
        parsed.rot = a.rot; // この向きで読めた（保存する写しを正しい向きにするため）
        parses.push(parsed);
        combined = root.MRZ.combine(parses);
      }
      // 数字が検算で確認でき、氏名も2回の読み取りで一致したら終了
      if (combined && combined.mrz.score >= 3 && combined.agreed && !combined.mrz.uncertain.length) break;
    }
    return { mrz: combined ? combined.mrz : null, rot: combined ? combined.mrz.rot : 0 };
  }

  /** 旅券の写しとして保存する圧縮コピー（読み取りで分かった向きに直し、文字が読める解像度を保つ） */
  function compressOriginal(bitmap, rot) {
    const canvas = render(bitmap, { rot, width: 2000 });
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    release(canvas);
    return dataUrl;
  }

  /**
   * file: カメラで撮影した画像ファイル
   * options: { keepOriginal: boolean, onStage(stage, i, n) }
   * 戻り値: { mrz, original, error }
   */
  async function scan(file, options) {
    const opts = options || {};
    const onStage = opts.onStage || function () {};
    const result = { mrz: null, original: null, error: null };
    let bitmap = null;
    try {
      onStage('loading');
      bitmap = await loadBitmap(file);

      let rot = 0;
      try {
        const r = await readMrz(bitmap, onStage, opts);
        result.mrz = r.mrz;
        rot = r.rot;
      } catch (e) {
        result.error = 'ocr';
      }

      if (opts.keepOriginal) result.original = compressOriginal(bitmap, rot);
    } catch (e) {
      result.error = result.error || 'image';
    } finally {
      if (bitmap && bitmap.close) bitmap.close(); // 元画像のメモリを解放
    }
    return result;
  }

  root.PassportScan = { scan, warmup };
})(self);
