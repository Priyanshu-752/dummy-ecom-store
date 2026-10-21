# Everyday demo store

A demo ecommerce sandbox for testing browser agents and API agents. No login or real payments. Requires Node.js 22 or newer. Local development uses a JSON file; Render uses PostgreSQL through the `pg` package.

## Run

```powershell
npm.cmd ci
npm.cmd start
```

Open **http://localhost:3000**. The same Node process serves `public/` and the backend REST API. On Windows, `npm.cmd` works even when PowerShell blocks `npm.ps1`. You can also run `node backend/server.mjs` directly. Stop with Ctrl+C. Set `$env:PORT = '3001'` before starting to change the port. The default host is `127.0.0.1`.

## Features

- 12 products, five categories, search, price and availability filters, sorting, product details.
- Anonymous carts, quantity changes, removal, calculated totals, and discount codes.
- `WELCOME10`: 10% off the subtotal, rounded to whole rupees. `FREESHIP`: free standard delivery. One coupon per cart.
- Standard delivery: ₹99; free when the subtotal after discount is at least ₹2,500. Express delivery: ₹199.
- Checkout with contact/address fields and simulated test payment or cash on delivery. No card details needed. No real emails or shipments are sent.
- Optional simulated payment decline, stock checks, checkout retry protection, order lookup, cancellation with stock restoration.
- Carts, orders, stock, and idempotency records persist in `data/store.json` locally, or PostgreSQL when `DATABASE_URL` is configured. The website identifies its cart through an anonymous HttpOnly session cookie. Separate API agents can still create independent carts.

All prices and totals use **INR rupees, not paise**. Cart contents do not reserve stock; checkout checks availability again. There are no product variants: clothing uses the demo size in its description. Tax is included in listed prices; no additional tax is added. Order states are `confirmed` and `cancelled`; delivery tracking is not simulated. This is an unauthenticated local sandbox, so order listing intentionally exposes all demo orders.

## Backend YAML / MCP integration

- **[openapi.yaml](./openapi.yaml)** — OpenAPI 3.0.3, with 17 named operations, request/response schemas, errors, and endpoint descriptions.
- **[openapi.json](./openapi.json)** — equivalent JSON, for tools that prefer JSON.
- Served at http://localhost:3000/openapi.yaml and http://localhost:3000/openapi.json.

Import either file into your OpenAPI-to-MCP adapter and use the server URL `http://localhost:3000`, with no authentication. The YAML describes the REST backend; it is not an MCP transport server by itself. A cloud-hosted agent cannot reach your computer's localhost directly. If the adapter runs in Docker Desktop, set the OpenAPI server URL to `http://host.docker.internal:3000` and configure `HOST` if necessary for connectivity.

Operation flow: `listProducts` → `createCart` → `addCartItem` → `getCart` → `applyCoupon` (optional) → `checkout` → `getOrder` / `cancelOrder`. Browser and API agents use the same backend. The website and its embedded commerce assistant share the cookie-resolved cart from `GET /api/website/cart`. Independent API-created carts are not automatically adopted by the website. The old `everyday-cart` localStorage value is no longer used.

Example in PowerShell:

```powershell
$base = 'http://localhost:3000'
$cart = Invoke-RestMethod "$base/api/carts" -Method Post
Invoke-RestMethod "$base/api/carts/$($cart.id)/items" -Method Post -ContentType 'application/json' -Body '{"productId":"p-001","quantity":1}'
$body = @{
  cartId = $cart.id
  customer = @{ name = 'Test Agent'; email = 'agent@example.com' }
  address = @{ line1 = '12 Test Road'; city = 'Bengaluru'; postalCode = '560001'; country = 'India' }
  shippingMethod = 'standard'
  paymentMethod = 'test_card'
} | ConvertTo-Json -Depth 5
Invoke-RestMethod "$base/api/checkout" -Method Post -ContentType 'application/json' -Headers @{ 'Idempotency-Key' = 'my-first-order' } -Body $body
```

Use a unique `Idempotency-Key` for each intended order; reuse the same key and identical JSON body when retrying. To test a declined payment, add `simulatePaymentFailure = $true` to the checkout body. This returns HTTP 402 without changing the cart or inventory.

## Repeatable tests

```powershell
npm.cmd test
```

Tests use isolated servers and state; they do not alter your running demo store. Coverage includes filtering, cart updates, invalid input, coupons, delivery charges, payment failure, stock contention, checkout retries, cancellation, resets, persistence, and static/API-spec routes.

Reset your running sandbox (removes all carts and orders and restores product stock):

```powershell
Invoke-RestMethod 'http://localhost:3000/api/test/reset' -Method Post -ContentType 'application/json' -Body '{"confirm":"RESET"}'
```

Reload the browser after resetting; it will create a fresh cart automatically.

## Project files

`backend/server.mjs` contains the HTTP server and store behavior. `backend/catalog.mjs` contains seed products. `public/` contains the frontend and local SVG product illustrations. `backend/openapi.mjs` generates the API descriptions (`npm.cmd run schema`). `scripts/generate-assets.mjs` regenerates the product illustrations (`node scripts/generate-assets.mjs`).

## Render deployment

Live store and API: **https://dummy-ecom-store.onrender.com**

Deployed API collections: [openapi.render.yaml](./openapi.render.yaml) and [openapi.render.json](./openapi.render.json). They are also downloadable at https://dummy-ecom-store.onrender.com/openapi.render.yaml and https://dummy-ecom-store.onrender.com/openapi.render.json. The localhost collections remain in `openapi.yaml` and `openapi.json`.

Render project: **Dummy Ecom / Production**. Web service: `dummy-ecom-store`; PostgreSQL: `dummy-ecom-db`. The free database expires **November 20, 2026**.

The frontend and API run together on one Node web service. A separate Render PostgreSQL database stores the sandbox state. `backend/storage.mjs` stores the state in a singleton JSONB row; every API operation runs inside a transaction with a row lock, so cart updates, checkout inventory, cancellation, and idempotency records commit together. Responses are sent only after commit. This is intended for a small agent-testing sandbox, not a high-throughput production store.

The deployment configuration is in `render.yaml`. It specifies free compute, Singapore for both resources, `npm ci && npm test && npm run schema` for builds, `npm start` to launch, and `/api/health` for health checks. Set `DATABASE_URL` to the database's internal connection URL in Render's Environment settings. Credentials must remain in Render, never in the repository. `NODE_VERSION` is pinned to 24.13.0. Render binds on `0.0.0.0` and supplies `PORT`.

The schema generator uses Render's `RENDER_EXTERNAL_URL` (or `PUBLIC_API_URL`) during builds. It serves the deployed OpenAPI at `/openapi.render.yaml` and `/openapi.render.json`, and also uses the deployed URL in the standard schema files on Render. To generate a separate deployed collection locally while keeping the localhost collection:

```powershell
node backend/openapi.mjs --server https://YOUR-SERVICE.onrender.com
```

Render's free web service sleeps after 15 minutes of inactivity; the first request can take about a minute. Free PostgreSQL expires 30 days after creation. See [Render's free-tier documentation](https://render.com/docs/free). Upgrade the database in Render before expiration if you need to keep testing beyond that period.

Run an end-to-end check against the deployed backend:

```powershell
node scripts/smoke-test.mjs https://dummy-ecom-store.onrender.com --expect-postgres
```

This creates demo carts and orders, exercises a coupon, payment failure, idempotent checkout and competing stock purchases, then cancels its orders and restores inventory. It leaves cancelled test orders available for inspection and does not reset unrelated sandbox data.

## Commerce agent integration

This store is plain HTML/JavaScript, so it uses the hosted loader rather than adding React solely for the widget. It mounts the same iframe and cart bridge as the supplied React/Next.js example. The original download is in `commerce-agent-installation/`; its examples incorrectly point at port 8000 for this setup. The working service URL supplied by the merchant console is `http://127.0.0.1:5199`.

### Configuration

The server reads `.env` automatically on startup. This ignored file should contain:

```dotenv
COMMERCE_AGENT_INSTALLATION_ID=avxXbN6qieNtdT8kT8B8Vh1b0wp5h7tU
COMMERCE_AGENT_SERVICE_URL=http://127.0.0.1:5199
COMMERCE_AGENT_BRIDGE_SECRET=PASTE_THE_SERVER_SIGNING_SECRET_HERE
```

Copy the real secret from the merchant console: **Test → Set up your shared website cart → Reveal server signing secret → Copy secret**. Restart the store after editing `.env`. On Render, put the same three settings in the web service's **Environment** page; do not commit `.env`. The signing secret is never returned by the public configuration route or included in frontend code.

Both the local and Render stores are intentionally configured to use the agent service on `127.0.0.1:5199`, as requested. The agent service must therefore run on the computer opening either storefront. This is a developer test setup. For customers on other computers, deploy the agent service to a public HTTPS origin and change `COMMERCE_AGENT_SERVICE_URL`; their `127.0.0.1` will refer to their own computer. Browser local-network permissions may also affect an HTTPS storefront connecting to loopback.

On the Render page, click **Connect shopping assistant** to initiate the local-service connection and allow Chrome's local-network/loopback permission for this store when prompted. This permission cannot be silently granted by the website. With a public HTTPS agent-service URL, the widget mounts automatically and this development-only connection button is not used. See [Chrome's Local Network Access documentation](https://developer.chrome.com/blog/local-network-access).

### What was added

1. `GET /api/website/cart` resolves or creates the shopper's cart from an opaque HttpOnly, SameSite cookie. HTTPS cookies also use Secure. The browser no longer chooses the authoritative cart ID from localStorage. Anonymous sessions persist with the store state in PostgreSQL on Render.
2. `POST /api/commerce-agent/cart-proof` accepts only `{ "challenge": "..." }`. It checks the request origin, resolves the cart from that cookie, and signs the exact JWT format in the supplied guide: HS256, installation audience, challenge, cart ID, and a five-minute expiration. Client-supplied cart IDs are rejected.
3. `public/cart-bridge.js` sends the challenge to that endpoint with the website cookie. The agent receives the signed token, not the signing secret.
4. `public/commerce-agent.js` fetches public settings from `/api/commerce-agent/config`, loads `/widget/v1/loader.js` from the agent service, and mounts one bubble with `cartBridge`.
5. Store additions, quantity changes, removal, coupons, and checkout dispatch `store:cart-changed`. The bridge notifies the assistant. An `agent:cart-changed` event makes the storefront re-read the current cart, update the badge, bag, and any open checkout totals. Re-rendering does not dispatch another store change, avoiding an event loop.

The proof endpoint and website-session helpers are browser integration endpoints, not general MCP tools. The existing OpenAPI commerce operations remain unchanged.

### Verify it yourself

1. Start the agent service on port 5199 and this store. For the published widget, open `https://localhost:3443`; the merchant console requires HTTPS storefront origins. The ordinary HTTP store remains at port 3000 for other tests.
2. In the merchant Test screen, verify the website cart using the live preview challenge and the token returned by the store proof endpoint in that shopper's browser session. Publish the installation once the merchant console reports successful verification. The storefront origin must be permitted by the installation.
3. Add a mug using the normal store button. Open the assistant and ask it to show your cart: the same mug and quantity should appear.
4. Ask the assistant to add a notebook. Open the normal store bag and confirm that it appears there immediately.
5. Increase or remove an item using the website controls, then confirm the assistant sees the updated cart. Reload the page to verify that the shared cart persists.
6. Repeat at `https://dummy-ecom-store.onrender.com` on the same computer. Keep the local agent service running. Its merchant-console allowed website already includes this Render origin.

The installation currently has no hosted-checkout tool mapped. This store's normal checkout still works; agent product/cart features can be verified and published without pretending that the order-placement API is a hosted checkout handoff.

The connected MCP server calls the Render API. For this integration test, the local `.env` also sets `STORE_API_UPSTREAM=https://dummy-ecom-store.onrender.com`. The local Node server forwards `/api/` requests to that backend, preserving the shopper's cart cookie and checking the local origin before forwarding proof requests. This keeps local storefront carts in the same database the MCP tools use. It means local browsing requires the Render service to be available. Remove this setting for the original standalone local backend; in that mode, the agent's MCP tools must also target that same local backend, otherwise they cannot find its cart IDs. Do not set `STORE_API_UPSTREAM` on the Render service itself.

The developer verification page is `/agent-setup.html` on either storefront. It reads the current cart and generates a proof for a pasted merchant preview challenge without exposing the server signing secret.

The optional HTTPS local listener uses `LOCAL_HTTPS_PORT`, `LOCAL_TLS_CERT`, and `LOCAL_TLS_KEY`. Its development certificate/key live under ignored `data/` and are never deployed. The current certificate is self-signed for localhost and 127.0.0.1; the user must approve the local certificate in their browser before opening the page. No global certificate store or browser security settings are changed. The installation permits `https://localhost:3443`, `https://127.0.0.1:3443`, and the Render origin. HTTP localhost is rejected by the merchant console's published-site origin policy.

### What other websites need

Use the loader for HTML sites, or the supplied copy-in `CommerceAgent.tsx` component for React/Next.js. The merchant console says the React packages are local build artifacts until published to your package registry, so do not assume `npm install @saastoagent/react` is available. In either case, use the correct service URL and installation ID, pass the cart bridge, implement the proof endpoint on the website's own backend, and resolve the actual shopper session there. For Next.js, the supplied proof handler can be adapted as an App Router POST route; `resolveWebsiteCart()` must call that application's real cart/session service.

Every website also needs the two cart-change event directions, allowed storefront origins, neutral MCP mappings for its own product/cart response formats, and a tested/published installation. Only the public installation ID and service URL belong in the browser; the bridge secret and MCP credentials belong on servers.
