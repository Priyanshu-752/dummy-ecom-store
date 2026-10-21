const $ = selector => document.querySelector(selector);
async function json(route, options) {
  const response = await fetch(route, { credentials: 'same-origin', ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Request failed.');
  return data;
}
async function refresh() {
  try {
    const config = await json('/api/commerce-agent/config');
    const cart = await json('/api/website/cart');
    $('#connection-status').textContent = JSON.stringify({ storefront: location.origin, ...config, websiteCartId: cart.id, itemCount: cart.itemCount, items: cart.items.map(i => ({ name: i.product.name, quantity: i.quantity })) }, null, 2);
  } catch (error) { $('#connection-status').textContent = error.message; }
}
$('#check-connection').addEventListener('click', refresh);
$('#proof-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#generate-proof').disabled = true; $('#proof-result').value = ''; $('#proof-status').textContent = '';
  try {
    const result = await json('/api/commerce-agent/cart-proof', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge: $('#challenge').value.trim() }) });
    $('#proof-result').value = result.token;
    $('#proof-status').textContent = 'Proof generated. Paste it into the merchant preview now.';
    $('#proof-status').className = '';
  } catch (error) { $('#proof-status').textContent = error.message; $('#proof-status').className = 'error'; }
  finally { $('#generate-proof').disabled = false; }
});
refresh();
