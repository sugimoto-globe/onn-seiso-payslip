# 同梱しているサードパーティのファイル

npm で配布されている版を、そのまま `public/vendor/` に置いています（改変なし）。

| 場所 | 内容 | 版 | ライセンス |
|---|---|---|---|
| `tesseract/tesseract.min.js`, `tesseract/worker.min.js` | [tesseract.js](https://github.com/naptha/tesseract.js) | 7.0.0 | Apache-2.0 |
| `tesseract/core/*.wasm.js` | [tesseract.js-core](https://github.com/naptha/tesseract.js-core)（LSTMのみの3種: relaxedsimd / simd / 汎用） | 7.0.0 | Apache-2.0 |
| `tesseract/lang/eng.traineddata.gz` | [@tesseract.js-data/eng](https://www.npmjs.com/package/@tesseract.js-data/eng) の `4.0.0_best_int` | 1.0.0 | MIT（データは Apache-2.0） |

更新するときは `npm pack <パッケージ>@<版>` で取得し、上記のファイルを置き換えてください。
tesseract.js と tesseract.js-core は同じメジャーバージョンを組み合わせる必要があります。
