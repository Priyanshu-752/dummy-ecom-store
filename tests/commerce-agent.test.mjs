import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { createStoreServer } from '../backend/server.mjs';

const settings = { installationId: 'test-installation', serviceUrl: 'http://127.0.0.1:5199', bridgeSecret: 'a-test-only-signing-secret', storeOrigin: '' };
async function setup(t, overrides = {}) {
  const server = createStoreServer({ dataFile: null, commerceAgent: { ...settings, ...overrides } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, { method = 'GET', body, cookie, origin = base, headers = {} } = {}) {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
  }
  return { request, base };
}
test('website cart uses an isolated HttpOnly session and survives reset with a fresh session', async t => {
  const { request } = await setup(t);
  const a = await request('/api/website/cart');
  assert.equal(a.status, 200); assert.match(a.cookie, /HttpOnly/); assert.match(a.cookie, /SameSite=Lax/);
  const cookie = a.cookie.split(';')[0];
  assert.equal((await request('/api/website/cart', { cookie })).data.id, a.data.id);
  const b = await request('/api/website/cart'); assert.notEqual(b.data.id, a.data.id);
  await request(`/api/carts/${a.data.id}/items`, { method: 'POST', body: { productId: 'p-003', quantity: 2 } });
  assert.equal((await request('/api/website/cart', { cookie })).data.itemCount, 2);
  await request('/api/test/reset', { method: 'POST', body: { confirm: 'RESET' } });
  assert.notEqual((await request('/api/website/cart', { cookie })).data.id, a.data.id);
});
test('cart proof binds the agent challenge to the server-resolved cart with the expected HMAC', async t => {
  const { request } = await setup(t);
  const website = await request('/api/website/cart'), cookie = website.cookie.split(';')[0];
  const challenge = 'challenge_for_agent_123456789';
  const result = await request('/api/commerce-agent/cart-proof', { method: 'POST', cookie, body: { challenge } });
  assert.equal(result.status, 200);
  const [header, payload, signature] = result.data.token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'HS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.aud, settings.installationId); assert.equal(claims.cart_id, website.data.id); assert.equal(claims.challenge, challenge); assert.equal(claims.exp - claims.iat, 300);
  assert.equal(signature, createHmac('sha256', settings.bridgeSecret).update(`${header}.${payload}`).digest('base64url'));
  const config = (await request('/api/commerce-agent/config')).data;
  assert.equal(config.installationId, settings.installationId); assert.equal(config.bridgeConfigured, true); assert.ok(!JSON.stringify(config).includes(settings.bridgeSecret));
});
test('proof endpoint rejects cross-origin requests, malformed challenges and client cart IDs', async t => {
  const { request } = await setup(t), route = '/api/commerce-agent/cart-proof';
  const body = { challenge: 'challenge_for_agent_123456789' };
  assert.equal((await request(route, { method: 'POST', origin: 'https://evil.example', body })).status, 403);
  assert.equal((await request(route, { method: 'POST', body: { challenge: 'short' } })).status, 400);
  assert.equal((await request(route, { method: 'POST', body: { ...body, cartId: 'other-shoppers-cart' } })).status, 400);
  assert.equal((await request('/api/website/cart', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
});
test('missing signing secret fails clearly; HTTPS store sessions use Secure cookies', async t => {
  const missing = await setup(t, { bridgeSecret: '' });
  assert.equal((await missing.request('/api/commerce-agent/cart-proof', { method: 'POST', body: { challenge: 'challenge_for_agent_123456789' } })).status, 503);
  const secure = await setup(t, { storeOrigin: 'https://store.example' });
  const website = await secure.request('/api/website/cart'); assert.match(website.cookie, /; Secure/);
  assert.equal((await secure.request('/api/commerce-agent/cart-proof', { method: 'POST', cookie: website.cookie.split(';')[0], origin: 'https://store.example', body: { challenge: 'challenge_for_agent_123456789' } })).status, 200);
});
test('local storefront proxy shares upstream cart state and preserves proof origin checks', async t => {
  const upstream = await setup(t);
  const proxy = createStoreServer({ dataFile: null, commerceAgent: settings, upstreamOrigin: upstream.base });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  t.after(() => new Promise(resolve => { proxy.close(resolve); proxy.closeAllConnections(); }));
  const base = `http://127.0.0.1:${proxy.address().port}`;
  const first = await fetch(base + '/api/website/cart');
  const cart = await first.json(), cookie = first.headers.get('set-cookie').split(';')[0];
  await upstream.request(`/api/carts/${cart.id}/items`, { method: 'POST', body: { productId: 'p-003', quantity: 2 } });
  const shared = await fetch(base + '/api/website/cart', { headers: { Cookie: cookie } });
  assert.equal((await shared.json()).itemCount, 2);
  for (const [origin, expected] of [[base, 200], ['https://evil.example', 403]]) {
    const proof = await fetch(base + '/api/commerce-agent/cart-proof', { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge: 'challenge_for_agent_123456789' }) });
    assert.equal(proof.status, expected);
    if (expected === 200) assert.equal(JSON.parse(Buffer.from((await proof.json()).token.split('.')[1], 'base64url')).cart_id, cart.id);
  }
});
