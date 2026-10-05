// Cloudflare Worker serving the guest registration forms for every property
// under guest-form/ (currently SHOGUN HOUSE OSAKA at the root, ICHZA KYOTO
// under guest-form/ichiza-kyoto/). Which property's static files are served
// is chosen by request hostname — see HOST_PROPERTY_PREFIX below. Adding a
// new property later means: add its folder under guest-form/, add one line
// here, and add its custom domain in the Cloudflare dashboard.
//
// `assets.run_worker_first: true` in wrangler.jsonc makes every request hit
// this fetch handler first (instead of Cloudflare's default "serve a
// matching static file automatically"), so the hostname-based rewrite below
// can run before any static file is served.
//
// Guest browsers only ever talk to the same-origin /api/submit endpoint.
// The relay to Google Apps Script happens server-side here, on Cloudflare's
// network, so guests in regions that block Google domains (e.g. mainland
// China) can still submit the form. All properties share one Apps Script
// deployment (one GAS_WEBAPP_URL secret) — the JSON body's `property` field
// tells Apps Script which spreadsheet to write to.
//
// Requires a secret named GAS_WEBAPP_URL, set via:
//   npx wrangler secret put GAS_WEBAPP_URL
// or in the dashboard under Workers & Pages > (this project) > Settings >
// Variables and Secrets. It should point at the deployed Apps Script Web
// App URL (https://script.google.com/macros/s/xxxxx/exec).

// Passport photos are compressed client-side to ~1600px/JPEG before upload,
// so this only needs headroom for a few compressed images per submission.
const MAX_BODY_BYTES = 20 * 1024 * 1024;

// hostname -> guest-form/ subfolder to serve at that hostname's "/".
// A hostname not listed here (e.g. the primary domain, *.workers.dev) serves
// guest-form/ itself, i.e. the SHOGUN HOUSE OSAKA form.
const HOST_PROPERTY_PREFIX = {
  'ichiza-kyoto.shogunhouse-osaka.com': 'ichiza-kyoto',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/submit') {
      if (request.method === 'POST') return handleSubmit(request, env);
      if (request.method === 'GET') {
        return jsonResponse({ result: 'ok', message: 'Guest form relay is running' });
      }
      return new Response('Not found', { status: 404 });
    }

    const prefix = HOST_PROPERTY_PREFIX[url.hostname];
    if (prefix) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = assetUrl.pathname === '/' ? `/${prefix}/` : `/${prefix}${assetUrl.pathname}`;
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    return env.ASSETS.fetch(request);
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
