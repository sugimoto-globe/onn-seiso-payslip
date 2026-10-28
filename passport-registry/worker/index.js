// ICHZA KYOTO 宿泊者名簿（パスポート自動読み取り版）の Cloudflare Worker。
//
// 画面（public/ 以下）は静的ファイルとして配信され、この Worker が処理するのは /api/submit のみ
// （wrangler.jsonc の assets.run_worker_first で /api/* だけ Worker を通している）。
// フォームから届いた JSON を Google Apps Script のウェブアプリへ中継する。
// ゲストの端末は Google のドメインに直接アクセスしないので、Google への接続が制限された地域からでも送信できる。
//
// 必要な設定（Secret）: GAS_WEBAPP_URL = Apps Script ウェブアプリの /exec URL
//   npx wrangler secret put GAS_WEBAPP_URL

// 顔写真（約20KB）・原本コピー（設定した場合のみ数百KB）を数人分含めても余裕のある上限
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/submit') return env.ASSETS.fetch(request);

    if (request.method === 'GET') return json({ result: 'ok', message: 'relay is running' });
    if (request.method !== 'POST') return json({ result: 'error', message: 'method not allowed' }, 405);
    return relay(request, env);
  },
};

async function relay(request, env) {
  if (!env.GAS_WEBAPP_URL) return json({ result: 'error', message: 'GAS_WEBAPP_URL is not configured' }, 500);

  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) return json({ result: 'error', message: 'payload too large' }, 413);
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return json({ result: 'error', message: 'payload too large' }, 413);

  try {
    const res = await fetch(env.GAS_WEBAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return new Response(await res.text(), {
      status: res.ok ? 200 : 502,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return json({ result: 'error', message: String(err) }, 502);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
