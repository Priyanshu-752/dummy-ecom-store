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
- Carts, orders, stock, and idempotency records persist in `data/store.json` locally, or PostgreSQL when `DATABASE_URL` is configured. The browser keeps its cart ID in localStorage. Separate agents can create independent carts.

All prices and totals use **INR rupees, not paise**. Cart contents do not reserve stock; checkout checks availability again. There are no product variants: clothing uses the demo size in its description. Tax is included in listed prices; no additional tax is added. Order states are `confirmed` and `cancelled`; delivery tracking is not simulated. This is an unauthenticated local sandbox, so order listing intentionally exposes all demo orders.

## Backend YAML / MCP integration

- **[openapi.yaml](./openapi.yaml)** — OpenAPI 3.0.3, with 17 named operations, request/response schemas, errors, and endpoint descriptions.
- **[openapi.json](./openapi.json)** — equivalent JSON, for tools that prefer JSON.
- Served at http://localhost:3000/openapi.yaml and http://localhost:3000/openapi.json.

Import either file into your OpenAPI-to-MCP adapter and use the server URL `http://localhost:3000`, with no authentication. The YAML describes the REST backend; it is not an MCP transport server by itself. A cloud-hosted agent cannot reach your computer's localhost directly. If the adapter runs in Docker Desktop, set the OpenAPI server URL to `http://host.docker.internal:3000` and configure `HOST` if necessary for connectivity.

Operation flow: `listProducts` → `createCart` → `addCartItem` → `getCart` → `applyCoupon` (optional) → `checkout` → `getOrder` / `cancelOrder`. Browser and API agents use the same backend. To inspect an API-created cart in the browser, run `localStorage.setItem('everyday-cart', 'YOUR_CART_ID')` in the browser console and reload.

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

The frontend and API run together on one Node web service. A separate Render PostgreSQL database stores the sandbox state. `backend/storage.mjs` stores the state in a singleton JSONB row; every API operation runs inside a transaction with a row lock, so cart updates, checkout inventory, cancellation, and idempotency records commit together. Responses are sent only after commit. This is intended for a small agent-testing sandbox, not a high-throughput production store.

The deployment configuration is in `render.yaml`. It specifies free compute, Singapore for both resources, `npm ci && npm test && npm run schema` for builds, `npm start` to launch, and `/api/health` for health checks. Set `DATABASE_URL` to the database's internal connection URL in Render's Environment settings. Credentials must remain in Render, never in the repository. `NODE_VERSION` is pinned to 24.13.0. Render binds on `0.0.0.0` and supplies `PORT`.

The schema generator uses Render's `RENDER_EXTERNAL_URL` (or `PUBLIC_API_URL`) during builds. It serves the deployed OpenAPI at `/openapi.render.yaml` and `/openapi.render.json`, and also uses the deployed URL in the standard schema files on Render. To generate a separate deployed collection locally while keeping the localhost collection:

```powershell
node backend/openapi.mjs --server https://YOUR-SERVICE.onrender.com
```

Render's free web service sleeps after 15 minutes of inactivity; the first request can take about a minute. Free PostgreSQL expires 30 days after creation. See [Render's free-tier documentation](https://render.com/docs/free). Upgrade the database in Render before expiration if you need to keep testing beyond that period.
