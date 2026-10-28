/**
 * パスポート写真の読み取り（すべてゲストの端末内で完結する）。
 *   1. 下部の MRZ（2行の英数字）を OCR（Tesseract.js）で読み、mrz.js で解析・検算
 *   2. 顔写真の位置を検出（face-api の Tiny Face Detector）して切り抜く
 * 撮影した画像はこのファイルの中だけで扱う。呼び出し側に返すのは「解析結果」「顔の切り抜き」と、
 * 設定（keepOriginal）で許可した場合のみ、旅券の写しとして保存するための圧縮コピーだけ。
 */
(function (root) {
  'use strict';

  const VENDOR = '/vendor/';
  const OCR_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<';

  // 試行順: 下部だけ → 下半分 → 全体 → 90°/270°回転した全体（パスポートを横向きに撮った場合）
  const ATTEMPTS = [
    { top: 0.62, rot: 0, width: 1800 },
    { top: 0.45, rot: 0, width: 2200 },
    { top: 0.0, rot: 0, width: 2400 },
    { top: 0.0, rot: 90, width: 2400 },
    { top: 0.0, rot: 270, width: 2400 },
  ];

  const FACE_OUT_W = 240;
  const FACE_OUT_H = 300; // 縦長 4:5

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

  let facePromise = null;
  function getFaceApi() {
    if (!facePromise) {
      facePromise = (async () => {
        await loadScript(VENDOR + 'face/face-api.js');
        await root.faceapi.nets.tinyFaceDetector.loadFromUri(VENDOR + 'face');
        return root.faceapi;
      })().catch((e) => { facePromise = null; throw e; });
    }
    return facePromise;
  }

  /** 撮影ボタンが押された時点（カメラが開いている間）に先読みしておく */
  function warmup() {
    getOcr().catch(() => {});
    getFaceApi().catch(() => {});
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

  /* ---------- 1. MRZ の読み取り ---------- */
  async function readMrz(bitmap, onStage, opts) {
    const worker = await getOcr();
    let best = null;
    let bestRot = 0;
    for (let i = 0; i < ATTEMPTS.length; i++) {
      const a = ATTEMPTS[i];
      // 回転しての再試行は、ここまでで何も読めていないときだけ
      if (a.rot !== 0 && best && best.score >= 2) break;
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
      if (parsed && (!best || parsed.score > best.score)) { best = parsed; bestRot = a.rot; }
      if (best && best.score >= 3 && best.uncertain.length === 0) break;
    }
    return { mrz: best, rot: bestRot };
  }

  /* ---------- 2. 顔写真の切り抜き ---------- */
  async function cropFace(bitmap, rot) {
    const faceapi = await getFaceApi();
    const detectCanvas = render(bitmap, { rot, width: 1100 });
    const detectW = detectCanvas.width;
    let found;
    try {
      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.3 });
      found = (await faceapi.detectAllFaces(detectCanvas, options)).map((d) => ({ box: d.box, score: d.score }));
    } finally {
      release(detectCanvas);
    }
    if (!found.length) return null;

    // 確度が十分な候補の中で最も大きい顔を採用する（パスポートには薄く小さい透かし写真もある。
    // 確度の低い巨大な誤検出は除外する）。確度の高い候補が無ければ最高スコアを使う。
    const confident = found.filter((f) => f.score >= 0.5);
    const face = (confident.length
      ? confident.reduce((a, b) => (b.box.width * b.box.height > a.box.width * a.box.height ? b : a))
      : found.reduce((a, b) => (b.score > a.score ? b : a))).box;

    // 切り抜きは高解像度の画像から行う（検出時の縮小率で座標を戻す）
    const full = render(bitmap, { rot, width: 2400 });
    const k = full.width / detectW;
    const cx = (face.x + face.width / 2) * k;
    const cy = (face.y + face.height / 2) * k + face.height * k * 0.08;
    const cropH = face.height * k * 1.75;
    const cropW = cropH * (FACE_OUT_W / FACE_OUT_H);
    const x = Math.max(0, Math.min(full.width - cropW, cx - cropW / 2));
    const y = Math.max(0, Math.min(full.height - cropH, cy - cropH / 2));

    const out = document.createElement('canvas');
    out.width = FACE_OUT_W;
    out.height = FACE_OUT_H;
    out.getContext('2d').drawImage(full, x, y, cropW, cropH, 0, 0, FACE_OUT_W, FACE_OUT_H);
    release(full);
    const dataUrl = out.toDataURL('image/jpeg', 0.85);
    release(out);
    return dataUrl;
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
   * 戻り値: { mrz, face, original, error }
   */
  async function scan(file, options) {
    const opts = options || {};
    const onStage = opts.onStage || function () {};
    const result = { mrz: null, face: null, original: null, error: null };
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

      onStage('face');
      try {
        result.face = await cropFace(bitmap, rot);
      } catch (e) {
        result.face = null;
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
