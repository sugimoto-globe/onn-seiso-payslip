// Cloudflare Worker (with static assets) serving the SHOGUN HOUSE OSAKA
// guest registration form.
//
// Static files under guest-form/ (index.html, etc.) are served automatically
// by Cloudflare's asset handling before this fetch handler ever runs — this
// script only needs to handle the one dynamic route: /api/submit.
//
// Guest browsers only ever talk to this same-origin endpoint. The relay to
// Google Apps Script happens server-side here, on Cloudflare's network, so
// guests in regions that block Google domains (e.g. mainland China) can
// still submit the form.
//
// Requires a secret named GAS_WEBAPP_URL, set via:
//   npx wrangler secret put GAS_WEBAPP_URL
// or in the dashboard under Workers & Pages > (this project) > Settings >
// Variables and Secrets. It should point at the deployed Apps Script Web
// App URL (https://script.google.com/macros/s/xxxxx/exec).

const MAX_BODY_BYTES = 8 * 1024 * 1024; // 8MB safety limit (covers a passport photo)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/submit') {
      if (request.method === 'POST') return handleSubmit(request, env);
      if (request.method === 'GET') {
        return jsonResponse({ result: 'ok', message: 'SHOGUN HOUSE OSAKA guest form relay is running' });
      }
    }

    return new Response('Not found', { status: 404 });
  },
};

async function handleSubmit(request, env) {
  if (!env.GAS_WEBAPP_URL) {
    return jsonResponse({ result: 'error', message: 'GAS_WEBAPP_URL is not configured' }, 500);
  }

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return jsonResponse({ result: 'error', message: 'payload too large' }, 413);
  }

  try {
    const gasResp = await fetch(env.GAS_WEBAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const text = await gasResp.text();
    return new Response(text, {
      status: gasResp.ok ? 200 : 502,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return jsonResponse({ result: 'error', message: String(err) }, 502);
  }
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
