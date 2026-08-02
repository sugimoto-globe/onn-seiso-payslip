// Cloudflare Pages Function
// Guest browsers only ever talk to this same-origin endpoint (/api/submit).
// The relay to Google Apps Script happens server-side here, on Cloudflare's
// network, so guests in regions that block Google domains (e.g. mainland
// China) can still submit the form.
//
// Requires an environment variable / secret named GAS_WEBAPP_URL set in the
// Cloudflare Pages project settings, pointing at the deployed Apps Script
// Web App URL (https://script.google.com/macros/s/xxxxx/exec).

const MAX_BODY_BYTES = 8 * 1024 * 1024; // 8MB safety limit (covers a passport photo)

export async function onRequestPost(context) {
  const { request, env } = context;

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

export async function onRequestGet() {
  return jsonResponse({ result: 'ok', message: 'SHOGUN HOUSE OSAKA guest form relay is running' });
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
