import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { seedProducts } from './catalog.mjs';
import { createFileStore, createPostgresStore, freshState } from './storage.mjs';
import { agentSettings, websiteOrigin, websiteCartSession, signCartProof } from './commerce-agent.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
try { process.loadEnvFile(path.join(root, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const fresh = () => freshState(seedProducts);
class ApiError extends Error { constructor(status, code, message) { super(message); Object.assign(this, { status, code }); } }
const fail = (status, code, message) => { throw new ApiError(status, code, message); };
const quantity = value => { if (!Number.isInteger(value) || value < 1 || value > 99) fail(400, 'INVALID_QUANTITY', 'Quantity must be an integer from 1 to 99.'); return value; };
const textField = (object, key, max = 200) => { const v = object?.[key]; if (typeof v !== 'string' || !v.trim() || v.length > max) fail(400, 'VALIDATION_ERROR', `${key} is required and must be at most ${max} characters.`); return v.trim(); };

export function createStoreServer({ dataFile = path.join(root, 'data/store.json'), storage = createFileStore(dataFile, fresh), commerceAgent = agentSettings(), upstreamOrigin = '', tls } = {}) {
  const createServer = tls ? handler => https.createServer(tls, handler) : handler => http.createServer(handler);
  const server = createServer(async (req, res) => {
    const send = (status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const method = req.method;
      if (upstreamOrigin && url.pathname.startsWith('/api/')) {
        const localOrigin = `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
        if (req.headers.origin && req.headers.origin !== localOrigin) fail(403, 'ORIGIN_NOT_ALLOWED', 'Use this storefront origin for API requests.');
        if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'ORIGIN_NOT_ALLOWED', 'Use this storefront origin for API requests.');
        const target = new URL(url.pathname + url.search, upstreamOrigin);
        const headers = { Accept: 'application/json', ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}), ...(req.headers.origin ? { Origin: target.origin } : {}), ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}), ...(req.headers['idempotency-key'] ? { 'Idempotency-Key': req.headers['idempotency-key'] } : {}) };
        let raw = '';
        if (!['GET', 'HEAD'].includes(method)) for await (const chunk of req) { raw += chunk; if (raw.length > 32768) fail(413, 'BODY_TOO_LARGE', 'Request body exceeds 32KB.'); }
        const remote = await fetch(target, { method, headers, ...(!['GET', 'HEAD'].includes(method) ? { body: raw } : {}), signal: AbortSignal.timeout(90000), redirect: 'error' });
        const cookies = remote.headers.getSetCookie();
        const loopback = ['localhost', '127.0.0.1'].includes(new URL(localOrigin).hostname);
        res.writeHead(remote.status, { 'Content-Type': remote.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store', ...(cookies.length ? { 'Set-Cookie': cookies.map(cookie => loopback && !req.socket.encrypted ? cookie.replace(/;\s*Secure/ig, '') : cookie) } : {}) });
        res.end(Buffer.from(await remote.arrayBuffer()));
        return;
      }
      if (method === 'OPTIONS') { res.writeHead(204, { 'Allow': 'GET, POST, PUT, PATCH, DELETE, OPTIONS' }); res.end(); return; }
      let body = {};
      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 32768) fail(413, 'BODY_TOO_LARGE', 'Request body exceeds 32KB.'); }
        try { body = raw ? JSON.parse(raw) : {}; } catch { fail(400, 'INVALID_JSON', 'Request body must be valid JSON.'); }
        if (!body || Array.isArray(body) || typeof body !== 'object') fail(400, 'INVALID_JSON', 'Request body must be a JSON object.');
      }
      if (p[0] === 'api') {
        const result = await storage.run(async session => {
        let state = session.state;
        const save = () => { session.state = state; session.save(); };
        const responseHeaders = {};
        // Buffer the HTTP response until the database transaction commits successfully.
        const send = (status, body) => ({ status, body, headers: responseHeaders });
        const product = id => state.products.find(p => p.id === id) || fail(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
        const cart = id => (Object.hasOwn(state.carts, id) && state.carts[id]) || fail(404, 'CART_NOT_FOUND', 'Cart not found. Create a new cart first.');
        const order = id => (Object.hasOwn(state.orders, id) && state.orders[id]) || fail(404, 'ORDER_NOT_FOUND', 'Order not found.');
        const newCart = () => {
          const c = { id: randomUUID(), items: [], coupon: null, createdAt: new Date().toISOString() };
          state.carts[c.id] = c;
          return c;
        };
        const websiteCart = () => {
          const result = websiteCartSession(state, req.headers.cookie, newCart, websiteOrigin(req, commerceAgent).startsWith('https:'));
          if (result.cookie) { responseHeaders['Set-Cookie'] = result.cookie; save(); }
          return result.cart;
        };
        function cartView(c) {
          const items = c.items.map(i => ({ ...i, product: product(i.productId), lineTotal: product(i.productId).price * i.quantity }));
          const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
          const discount = c.coupon === 'WELCOME10' ? Math.round(subtotal * .1) : 0;
          const shipping = !items.length || subtotal - discount >= 2500 || c.coupon === 'FREESHIP' ? 0 : 99;
          return { ...c, items, itemCount: items.reduce((s, i) => s + i.quantity, 0), subtotal, discount, shipping, total: subtotal - discount + shipping, currency: 'INR' };
        }
        if (p.length === 2 && p[1] === 'health' && method === 'GET') return send(200, { status: 'ok', service: 'everyday-demo-store', mode: 'sandbox', storage: storage.kind });
        if (url.pathname === '/api/commerce-agent/config' && method === 'GET') return send(200, { installationId: commerceAgent.installationId, serviceUrl: commerceAgent.serviceUrl, mode: 'bubble', bridgeConfigured: !!commerceAgent.bridgeSecret });
        if (url.pathname === '/api/website/cart' && method === 'GET') {
          if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'ORIGIN_NOT_ALLOWED', 'Read the website cart from this store.');
          return send(200, cartView(websiteCart()));
        }
        if (url.pathname === '/api/commerce-agent/cart-proof' && method === 'POST') {
          if (req.headers.origin !== websiteOrigin(req, commerceAgent)) fail(403, 'ORIGIN_NOT_ALLOWED', 'Cart proofs require a same-origin website request.');
          if (typeof body.challenge !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(body.challenge) || Object.keys(body).some(key => key !== 'challenge')) fail(400, 'INVALID_CHALLENGE', 'Send only the short-lived agent challenge. Cart IDs are resolved from the website session.');
          if (!commerceAgent.bridgeSecret) fail(503, 'BRIDGE_NOT_CONFIGURED', 'The store server signing secret is not configured.');
          return send(200, { token: signCartProof({ challenge: body.challenge, cartId: websiteCart().id, settings: commerceAgent }) });
        }
        if (p.length === 2 && p[1] === 'categories' && method === 'GET') return send(200, { categories: [...new Set(state.products.map(p => p.category))] });
        if (p.length === 2 && p[1] === 'products' && method === 'GET') {
          const q = (url.searchParams.get('q') || '').toLowerCase();
          const category = url.searchParams.get('category');
          const numeric = (key, fallback) => { const v = url.searchParams.get(key); if (v === null) return fallback; if (!v.trim() || !Number.isFinite(Number(v)) || Number(v) < 0) fail(400, 'INVALID_FILTER', `${key} must be a nonnegative number.`); return Number(v); };
          const min = numeric('minPrice', 0), max = numeric('maxPrice', Infinity);
          const page = numeric('page', 1), limit = numeric('limit', 12);
          if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100 || min > max) fail(400, 'INVALID_FILTER', 'Use page >= 1, limit 1–100, and minPrice <= maxPrice.');
          const sort = url.searchParams.get('sort') || 'featured';
          if (!['featured', 'price_asc', 'price_desc', 'rating', 'name'].includes(sort)) fail(400, 'INVALID_FILTER', 'Unknown sort option.');
          const inStock = url.searchParams.get('inStock');
          if (inStock !== null && !['true', 'false'].includes(inStock)) fail(400, 'INVALID_FILTER', 'inStock must be true or false.');
          let products = state.products.filter(p => `${p.name} ${p.description}`.toLowerCase().includes(q) && (!category || p.category === category) && p.price >= min && p.price <= max && (inStock !== 'true' || p.stock > 0));
          const sorts = { price_asc: (a,b) => a.price-b.price, price_desc: (a,b) => b.price-a.price, rating: (a,b) => b.rating-a.rating, name: (a,b) => a.name.localeCompare(b.name) };
          if (sorts[sort]) products.sort(sorts[sort]);
          return send(200, { products: products.slice((page-1)*limit, page*limit), total: products.length, page, limit, pages: Math.ceil(products.length/limit) });
        }
        if (p.length === 3 && p[1] === 'products' && method === 'GET') return send(200, product(p[2]));
        if (p.length === 2 && p[1] === 'carts' && method === 'POST') {
          const c = newCart(); save(); return send(201, cartView(c));
        }
        if (p[1] === 'carts' && p[2]) {
          const c = cart(p[2]);
          if (p.length === 3 && method === 'GET') return send(200, cartView(c));
          if (p.length === 3 && method === 'DELETE') { c.items = []; c.coupon = null; save(); return send(200, cartView(c)); }
          if (p.length === 4 && p[3] === 'items' && method === 'POST') {
            const prod = product(textField(body, 'productId')); const qty = quantity(body.quantity ?? 1); const item = c.items.find(i => i.productId === prod.id);
            const total = (item?.quantity || 0) + qty;
            if (total > prod.stock || total > 99) fail(409, 'INSUFFICIENT_STOCK', `Only ${prod.stock} units of ${prod.name} available (maximum 99 per cart).`);
            if (item) item.quantity = total; else c.items.push({ productId: prod.id, quantity: qty });
            save(); return send(200, cartView(c));
          }
          if (p.length === 5 && p[3] === 'items' && ['PATCH', 'DELETE'].includes(method)) {
            const item = c.items.find(i => i.productId === p[4]); if (!item) fail(404, 'ITEM_NOT_FOUND', 'Product is not in this cart.');
            if (method === 'DELETE') c.items = c.items.filter(i => i !== item);
            else { const qty = quantity(body.quantity); if (qty > product(item.productId).stock) fail(409, 'INSUFFICIENT_STOCK', 'Requested quantity exceeds current stock.'); item.quantity = qty; }
            save(); return send(200, cartView(c));
          }
          if (p.length === 4 && p[3] === 'coupon' && ['PUT', 'DELETE'].includes(method)) {
            if (method === 'DELETE') c.coupon = null;
            else { const code = textField(body, 'code', 40).toUpperCase(); if (!['WELCOME10', 'FREESHIP'].includes(code)) fail(400, 'INVALID_COUPON', 'Use WELCOME10 (10% off) or FREESHIP (free delivery).'); c.coupon = code; }
            save(); return send(200, cartView(c));
          }
        }
        if (p.length === 2 && p[1] === 'checkout' && method === 'POST') {
          const key = req.headers['idempotency-key'];
          if (key && (typeof key !== 'string' || key.length > 200)) fail(400, 'INVALID_KEY', 'Idempotency-Key must be at most 200 characters.');
          const signature = JSON.stringify(body);
          if (key && Object.hasOwn(state.idempotency, key)) { const record = state.idempotency[key]; if (record.signature !== signature) fail(409, 'IDEMPOTENCY_CONFLICT', 'This key was already used with a different request.'); return send(200, order(record.orderId)); }
          const c = cart(textField(body, 'cartId'));
          if (!c.items.length) fail(400, 'EMPTY_CART', 'Add at least one product before checkout.');
          const name = textField(body.customer, 'name', 100), email = textField(body.customer, 'email', 254);
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'VALIDATION_ERROR', 'Enter a valid email address.');
          const address = {}; for (const field of ['line1', 'city', 'postalCode', 'country']) address[field] = textField(body.address, field, 200);
          const shippingMethod = body.shippingMethod ?? 'standard'; if (!['standard', 'express'].includes(shippingMethod)) fail(400, 'VALIDATION_ERROR', 'shippingMethod must be standard or express.');
          const paymentMethod = body.paymentMethod ?? 'test_card'; if (!['test_card', 'cash_on_delivery'].includes(paymentMethod)) fail(400, 'VALIDATION_ERROR', 'paymentMethod must be test_card or cash_on_delivery.');
          if (body.simulatePaymentFailure !== undefined && typeof body.simulatePaymentFailure !== 'boolean') fail(400, 'VALIDATION_ERROR', 'simulatePaymentFailure must be a boolean.');
          for (const i of c.items) if (i.quantity > product(i.productId).stock) fail(409, 'INSUFFICIENT_STOCK', `${product(i.productId).name} no longer has enough stock.`);
          if (body.simulatePaymentFailure === true) fail(402, 'PAYMENT_DECLINED', 'Simulated payment declined. Cart and stock are unchanged.');
          const snapshot = cartView(c), shipping = shippingMethod === 'express' ? 199 : snapshot.shipping;
          const o = { id: `ORD-${randomUUID().slice(0,8).toUpperCase()}`, status: 'confirmed', customer: { name, email }, address, items: structuredClone(snapshot.items), subtotal: snapshot.subtotal, discount: snapshot.discount, coupon: snapshot.coupon, shipping, total: snapshot.subtotal - snapshot.discount + shipping, currency: 'INR', shippingMethod, paymentMethod, paymentStatus: paymentMethod === 'test_card' ? 'paid_test' : 'pending', createdAt: new Date().toISOString() };
          for (const i of c.items) product(i.productId).stock -= i.quantity;
          state.orders[o.id] = o; c.items = []; c.coupon = null;
          if (key) Object.defineProperty(state.idempotency, key, { value: { signature, orderId: o.id }, enumerable: true, configurable: true, writable: true });
          save(); return send(201, o);
        }
        if (p.length === 2 && p[1] === 'orders' && method === 'GET') { const email = url.searchParams.get('email'); return send(200, { orders: Object.values(state.orders).filter(o => !email || o.customer.email.toLowerCase() === email.toLowerCase()).sort((a,b) => b.createdAt.localeCompare(a.createdAt)) }); }
        if (p.length === 3 && p[1] === 'orders' && method === 'GET') return send(200, order(p[2]));
        if (p.length === 4 && p[1] === 'orders' && p[3] === 'cancel' && method === 'POST') {
          const o = order(p[2]); if (o.status === 'cancelled') return send(200, o);
          o.status = 'cancelled'; o.paymentStatus = o.paymentMethod === 'test_card' ? 'refunded_test' : 'cancelled';
          for (const i of o.items) product(i.productId).stock += i.quantity;
          save(); return send(200, o);
        }
        if (p.length === 3 && p[1] === 'test' && p[2] === 'reset' && method === 'POST') {
          if (body.confirm !== 'RESET') fail(400, 'CONFIRMATION_REQUIRED', 'Send {"confirm":"RESET"} to clear all carts/orders and restore stock.');
          state = fresh(); save(); return send(200, { message: 'Sandbox reset.', products: state.products.length });
        }
        return send(404, { error: { code: 'NOT_FOUND', message: 'API route not found.' } });
        });
        return send(result.status, result.body, result.headers);
      }
      if (method !== 'GET' && method !== 'HEAD') return send(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET for static resources.' } });
      const specRoutes = ['/openapi.yaml', '/openapi.json', '/openapi.render.yaml', '/openapi.render.json'];
      const staticPath = specRoutes.includes(url.pathname) ? path.join(root, url.pathname.slice(1)) : path.resolve(root, 'public', url.pathname === '/' ? 'index.html' : `.${decodeURIComponent(url.pathname)}`);
      if (!staticPath.startsWith(path.join(root, 'public') + path.sep) && !specRoutes.includes(url.pathname)) return send(404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
      let content; try { content = readFileSync(staticPath); } catch { return send(404, { error: { code: 'NOT_FOUND', message: 'Not found.' } }); }
      const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.yaml': 'application/yaml', '.json': 'application/json' };
      res.writeHead(200, { 'Content-Type': `${types[path.extname(staticPath)] || 'application/octet-stream'}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff' }); res.end(method === 'HEAD' ? undefined : content);
    } catch (err) { if (!(err instanceof ApiError)) console.error('Request failed:', err.name); send(err.status || 500, { error: { code: err instanceof ApiError ? err.code : 'INTERNAL_ERROR', message: err instanceof ApiError ? err.message : 'Unexpected server error.' } }); }
  });
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000), host = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
  if (process.env.RENDER && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is required on Render to preserve store data.');
  const storage = process.env.DATABASE_URL ? await createPostgresStore(process.env.DATABASE_URL, fresh) : createFileStore(process.env.DATA_FILE || path.join(root, 'data/store.json'), fresh);
  const server = createStoreServer({ storage, upstreamOrigin: process.env.STORE_API_UPSTREAM || '' });
  const servers = [server];
  server.on('error', err => { console.error(err.message); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`Everyday store listening on ${host}:${port} (${storage.kind})`));
  if (!process.env.RENDER && process.env.LOCAL_TLS_KEY && process.env.LOCAL_TLS_CERT) {
    const securePort = Number(process.env.LOCAL_HTTPS_PORT || 3443);
    const secureServer = createStoreServer({ storage, upstreamOrigin: process.env.STORE_API_UPSTREAM || '', tls: { key: readFileSync(path.resolve(root, process.env.LOCAL_TLS_KEY)), cert: readFileSync(path.resolve(root, process.env.LOCAL_TLS_CERT)) } });
    secureServer.on('error', err => { console.error(err.message); process.exitCode = 1; });
    secureServer.listen(securePort, host, () => console.log(`HTTPS agent test store: https://localhost:${securePort}`));
    servers.push(secureServer);
  }
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    Promise.all(servers.map(server => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }))).then(async () => { await storage.close(); process.exit(0); });
  });
}
