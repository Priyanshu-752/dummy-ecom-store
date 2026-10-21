import { createHash, createHmac, randomBytes } from 'node:crypto';

export const CART_COOKIE = 'everyday_shop_session';
const sessionLifetime = 30 * 24 * 60 * 60;
export function agentSettings(env = process.env) {
  const serviceUrl = env.COMMERCE_AGENT_SERVICE_URL || 'http://127.0.0.1:5199';
  const url = new URL(serviceUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('COMMERCE_AGENT_SERVICE_URL must be HTTPS or local loopback HTTP.');
  return {
    installationId: env.COMMERCE_AGENT_INSTALLATION_ID || 'avxXbN6qieNtdT8kT8B8Vh1b0wp5h7tU',
    serviceUrl: url.origin,
    bridgeSecret: env.COMMERCE_AGENT_BRIDGE_SECRET || '',
    storeOrigin: env.STORE_PUBLIC_URL || env.RENDER_EXTERNAL_URL || ''
  };
}
export function websiteOrigin(req, settings) {
  return settings.storeOrigin ? new URL(settings.storeOrigin).origin : new URL(`${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`).origin;
}
export function websiteCartSession(state, cookieHeader, createCart, secure, now = Date.now()) {
  state.websiteSessions ??= {};
  const cookie = (cookieHeader || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${CART_COOKIE}=`))?.slice(CART_COOKIE.length + 1);
  const digest = token => createHash('sha256').update(token).digest('hex');
  const known = cookie && /^[A-Za-z0-9_-]{43}$/.test(cookie) ? state.websiteSessions[digest(cookie)] : null;
  if (known && known.expiresAt > now && Object.hasOwn(state.carts, known.cartId)) return { cart: state.carts[known.cartId] };
  for (const [id, session] of Object.entries(state.websiteSessions)) if (session.expiresAt <= now) delete state.websiteSessions[id];
  const token = randomBytes(32).toString('base64url');
  const cart = createCart();
  state.websiteSessions[digest(token)] = { cartId: cart.id, expiresAt: now + sessionLifetime * 1000 };
  return { cart, cookie: `${CART_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionLifetime}${secure ? '; Secure' : ''}` };
}
export function signCartProof({ challenge, cartId, settings, now = Math.floor(Date.now() / 1000) }) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const value = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ aud: settings.installationId, iat: now, exp: now + 300, challenge, cart_id: cartId })}`;
  return `${value}.${createHmac('sha256', settings.bridgeSecret).update(value).digest('base64url')}`;
}
