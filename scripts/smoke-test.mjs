import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = new URL(process.argv[2] || 'http://localhost:3000').origin;
const email = `smoke-${randomUUID()}@example.com`;
async function request(route, method = 'GET', body, headers = {}) {
  const response = await fetch(`${base}${route}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(90000) });
  const data = await response.json();
  return { status: response.status, data };
}
function checkout(cartId, extra = {}) {
  return { cartId, customer: { name: 'Deployment Smoke Test', email }, address: { line1: '12 Test Road', city: 'Bengaluru', postalCode: '560001', country: 'India' }, ...extra };
}
const health = await request('/api/health');
assert.equal(health.status, 200);
if (process.argv.includes('--expect-postgres')) assert.equal(health.data.storage, 'postgres');
console.log(`Health OK (${health.data.storage}).`);
const listed = await request('/api/products?limit=100');
assert.equal(listed.status, 200); assert.equal(listed.data.total, 12);
const p = listed.data.products.find(product => product.id === 'p-003');
assert.ok(p.stock >= 2, 'Smoke test requires two mugs in stock.');
assert.equal((await fetch(base + p.image)).status, 200);
const schema = (await request('/openapi.json')).data;
assert.ok(schema.paths['/api/checkout']);
if (process.argv.includes('--expect-postgres')) assert.equal(schema.servers[0].url, base);
const c = (await request('/api/carts', 'POST', {})).data;
assert.equal((await request(`/api/carts/${c.id}/items`, 'POST', { productId: p.id, quantity: 2 })).status, 200);
const discounted = (await request(`/api/carts/${c.id}/coupon`, 'PUT', { code: 'WELCOME10' })).data;
assert.equal(discounted.discount, Math.round(p.price * 2 * .1));
assert.equal((await request('/api/checkout', 'POST', checkout(c.id, { simulatePaymentFailure: true }))).status, 402);
assert.equal((await request(`/api/products/${p.id}`)).data.stock, p.stock);
const payload = checkout(c.id), headers = { 'Idempotency-Key': randomUUID() };
const placed = await request('/api/checkout', 'POST', payload, headers);
assert.equal(placed.status, 201); assert.equal(placed.data.total, discounted.total);
const replay = await request('/api/checkout', 'POST', payload, headers);
assert.equal(replay.status, 200); assert.equal(replay.data.id, placed.data.id);
assert.equal((await request(`/api/products/${p.id}`)).data.stock, p.stock - 2);
assert.equal((await request(`/api/carts/${c.id}`)).data.itemCount, 0);
assert.equal((await request(`/api/orders?email=${encodeURIComponent(email)}`)).data.orders.length, 1);
for (let i = 0; i < 2; i++) assert.equal((await request(`/api/orders/${placed.data.id}/cancel`, 'POST', {})).data.status, 'cancelled');
assert.equal((await request(`/api/products/${p.id}`)).data.stock, p.stock);
console.log(`Cart, coupon, payment decline, checkout retry, order lookup and cancellation OK (${placed.data.id}).`);

const scarce = listed.data.products.find(product => product.id === 'p-011');
assert.ok(scarce.stock >= 1 && scarce.stock <= 99, 'Smoke test requires keyboard inventory.');
const competingCarts = [];
for (let i = 0; i < 2; i++) {
  const created = (await request('/api/carts', 'POST', {})).data;
  assert.equal((await request(`/api/carts/${created.id}/items`, 'POST', { productId: scarce.id, quantity: scarce.stock })).status, 200);
  competingCarts.push(created);
}
const competing = await Promise.all(competingCarts.map(c => request('/api/checkout', 'POST', checkout(c.id))));
assert.deepEqual(competing.map(r => r.status).sort(), [201, 409]);
const winner = competing.find(r => r.status === 201).data;
await request(`/api/orders/${winner.id}/cancel`, 'POST', {});
for (const c of competingCarts) await request(`/api/carts/${c.id}`, 'DELETE');
assert.equal((await request(`/api/products/${scarce.id}`)).data.stock, scarce.stock);
console.log('Concurrent checkouts did not oversell. Test orders cancelled and stock restored.');
console.log(`Smoke test passed: ${base}`);
