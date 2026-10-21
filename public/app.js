import { mountCommerceAgent } from './commerce-agent.js';
const $ = selector => document.querySelector(selector);
const money = amount => new Intl.NumberFormat('en-IN', { style:'currency', currency:'INR', maximumFractionDigits:0 }).format(amount);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let cart, catalog = [], categories = [], activeCategory = '', toastTimer, searchTimer, requestNumber = 0, checkoutKey, cartRequest;
async function api(path, method = 'GET', body, headers = {}) {
  const response = await fetch(`/api${path}`, {method, headers:{'Content-Type':'application/json', ...headers}, ...(body === undefined ? {} : {body:JSON.stringify(body)})});
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error?.message || 'Something went wrong. Please try again.'); error.code = data.error?.code; throw error; } return data;
}
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3500); }
function openDialog(id) { const dialog = $(id); if (!dialog.open) dialog.showModal(); }
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } }));
async function ensureCart() {
  return cartRequest ??= (async () => { cart = await api('/website/cart'); renderCount(); })().finally(() => { cartRequest = null; });
}
function notifyCartChanged() { window.dispatchEvent(new Event('store:cart-changed')); }
function renderCount() { $('#cart-count').textContent = cart?.itemCount || 0; $('#bag-heading-count').textContent = `(${cart?.itemCount || 0})`; }
function renderCategories() { $('#categories').innerHTML = ['', ...categories].map(c => `<button class="category-button ${activeCategory === c ? 'active' : ''}" data-category="${escape(c)}" aria-pressed="${activeCategory === c}">${escape(c || 'All products')}<span>${c ? catalog.filter(p=>p.category===c).length : catalog.length}</span></button>`).join(''); }
async function loadProducts() {
  const n = ++requestNumber, params = new URLSearchParams({limit:100, sort:$('#sort').value});
  if ($('#search').value.trim()) params.set('q',$('#search').value.trim());
  if (activeCategory) params.set('category', activeCategory);
  if ($('#min-price').value) params.set('minPrice',$('#min-price').value);
  if ($('#max-price').value) params.set('maxPrice',$('#max-price').value);
  if ($('#in-stock').checked) params.set('inStock','true');
  try {
    const data = await api(`/products?${params}`); if (n !== requestNumber) return;
    $('#results-count').textContent = `Showing ${data.total} ${data.total===1?'essential':'essentials'}`;
    $('#products').innerHTML = data.products.length ? data.products.map(p => `<article class="product-card" data-product-id="${p.id}"><div class="product-image" style="--tile:${p.background}"><button data-detail="${p.id}" aria-label="View ${escape(p.name)}"><img src="${p.image}" alt="${escape(p.name)}"></button>${p.badge?`<span class="badge">${escape(p.stock ? p.badge : 'Sold out')}</span>`:''}<button class="quick-add" data-add="${p.id}" aria-label="Add ${escape(p.name)} to bag" ${!p.stock?'disabled':''}>+</button></div><div class="card-meta"><span>${escape(p.category)}</span><span class="rating"><span>★</span> ${p.rating.toFixed(1)}</span></div><button class="product-name" data-detail="${p.id}">${escape(p.name)}</button><div class="price">${money(p.price)}<span class="old-price">${money(p.compareAtPrice)}</span></div></article>`).join('') : '<div class="empty"><h3>No finds just yet.</h3>Try another search or reset your filters.</div>';
  } catch(e) { if (n !== requestNumber) return; $('#results-count').textContent='Could not load products'; $('#products').innerHTML=`<p class="error">${escape(e.message)}</p>`; }
}
async function refreshCatalog() { catalog = (await api('/products?limit=100')).products; renderCategories(); await loadProducts(); }
async function addToCart(id, button) {
  if (button) button.disabled = true;
  try { await ensureCart(); cart = await api(`/carts/${cart.id}/items`, 'POST', {productId:id, quantity:1}); checkoutKey = null; renderCount(); notifyCartChanged(); toast('Added to your bag'); if ($('#bag-dialog').open) renderBag(); }
  catch(e) { toast(e.message); } finally { if (button) button.disabled = false; }
}
async function showProduct(id) {
  try { const p = await api(`/products/${id}`); $('#product-detail').innerHTML = `<div class="detail-art" style="--tile:${p.background}"><img src="${p.image}" alt="${escape(p.name)}"></div><div class="detail-copy"><div class="eyebrow">${escape(p.category)}</div><h2>${escape(p.name)}</h2><span class="rating">★ ${p.rating.toFixed(1)} / 5</span><p>${escape(p.description)}</p><div class="price">${money(p.price)}<span class="old-price">${money(p.compareAtPrice)}</span></div><span class="stock-label">${p.stock?`${p.stock} in stock`:'Currently sold out'}</span><button class="primary" data-add="${p.id}" ${!p.stock?'disabled':''}>${p.stock?'Add to bag':'Sold out'} <span>+</span></button><p>Free standard delivery on orders over ₹2,500.</p></div>`; openDialog('#product-dialog'); } catch(e) { toast(e.message); }
}
function totals(shipping = cart.shipping) { return `<div class="totals"><div><span>Subtotal</span><span>${money(cart.subtotal)}</span></div>${cart.discount?`<div><span>Discount (${escape(cart.coupon)})</span><span>−${money(cart.discount)}</span></div>`:''}<div><span>Delivery</span><span>${shipping?money(shipping):'Free'}</span></div><div class="grand-total"><span>Total</span><span>${money(cart.subtotal-cart.discount+shipping)}</span></div></div>`; }
function renderBag() {
  renderCount();
  if (!cart.items.length) { $('#bag-content').innerHTML='<div class="empty"><h3>A little room for good things.</h3>Your bag is empty. Find something you love.<p><button class="primary" id="continue-shopping">Explore the collection ↗</button></p></div>'; return; }
  $('#bag-content').innerHTML = cart.items.map(i=>`<div class="bag-item"><img style="--tile:${i.product.background}" src="${i.product.image}" alt="${escape(i.product.name)}"><div><h3>${escape(i.product.name)}</h3><span class="price">${money(i.product.price)}</span><div><div class="quantity-control"><button data-quantity="${i.productId}" data-value="${i.quantity-1}" aria-label="Decrease ${escape(i.product.name)} quantity">−</button><span aria-label="Quantity">${i.quantity}</span><button data-quantity="${i.productId}" data-value="${i.quantity+1}" aria-label="Increase ${escape(i.product.name)} quantity" ${i.quantity>=i.product.stock||i.quantity>=99?'disabled':''}>+</button></div></div></div><div><span class="price">${money(i.lineTotal)}</span><button class="remove-button" data-remove="${i.productId}">Remove</button></div></div>`).join('') + `<form class="coupon-form" id="coupon-form"><input name="coupon" aria-label="Coupon code" placeholder="Discount code" value="${escape(cart.coupon || '')}" required maxlength="40"><button class="secondary" type="submit">Apply</button>${cart.coupon?'<button class="text-button" type="button" id="remove-coupon">Remove</button>':''}</form><p class="muted">Try WELCOME10 for 10% off, or FREESHIP for free standard delivery.</p>${totals()}<button id="checkout-button" class="primary full-width">Continue to checkout <span>→</span></button><p class="muted">All payments are simulated. No account required.</p>`;
}
async function mutateCart(path, method, body) { cart = await api(`/carts/${cart.id}${path}`,method,body); checkoutKey=null; renderBag(); notifyCartChanged(); }
function updateCheckoutTotals() { $('#checkout-totals').innerHTML = totals($('#shipping-method').value === 'express' ? 199 : cart.shipping); }
document.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.add) return addToCart(button.dataset.add,button);
  if (button.dataset.detail) return showProduct(button.dataset.detail);
  if (button.dataset.category !== undefined) { activeCategory=button.dataset.category; renderCategories(); return loadProducts(); }
  try {
    if (button.dataset.quantity) { button.disabled=true; const q=Number(button.dataset.value); await mutateCart(`/items/${button.dataset.quantity}`,q?'PATCH':'DELETE',q?{quantity:q}:undefined); }
    if (button.dataset.remove) await mutateCart(`/items/${button.dataset.remove}`,'DELETE');
    if (button.id==='remove-coupon') await mutateCart('/coupon','DELETE');
    if (button.id==='continue-shopping') $('#bag-dialog').close();
    if (button.id==='checkout-button') { await ensureCart(); renderBag(); if(!cart.items.length)return; checkoutKey=null; $('#checkout-error').textContent=''; updateCheckoutTotals(); openDialog('#checkout-dialog'); }
    if (button.dataset.cancel) { button.disabled=true; await api(`/orders/${button.dataset.cancel}/cancel`,'POST',{}); toast('Order cancelled. Stock restored.'); await showOrders(); await refreshCatalog(); }
  } catch(e) { toast(e.message); button.disabled=false; }
});
$('#cart-button').addEventListener('click',async()=>{try{await ensureCart();renderBag();openDialog('#bag-dialog');}catch(e){toast(e.message);}});
$('#bag-content').addEventListener('submit',async event=>{if(event.target.id!=='coupon-form')return;event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;try{await mutateCart('/coupon','PUT',{code:new FormData(event.target).get('coupon')});toast('Discount applied');}catch(e){toast(e.message);button.disabled=false;}});
$('#shipping-method').addEventListener('change',updateCheckoutTotals);
$('#checkout-form').addEventListener('submit',async event=>{
  event.preventDefault(); const button=$('#place-order'); button.disabled=true; $('#checkout-error').textContent='';
  const f=Object.fromEntries(new FormData(event.target));
  const body={cartId:cart.id,customer:{name:f.name,email:f.email},address:{line1:f.line1,city:f.city,postalCode:f.postalCode,country:f.country},shippingMethod:f.shippingMethod,paymentMethod:f.paymentMethod,simulatePaymentFailure:!!f.simulatePaymentFailure};
  const signature=JSON.stringify(body); if(!checkoutKey||checkoutKey.signature!==signature) checkoutKey={signature,key:crypto.randomUUID()};
  try { const order=await api('/checkout','POST',body,{'Idempotency-Key':checkoutKey.key}); checkoutKey=null; notifyCartChanged(); $('#order-email').value=order.customer.email; $('#checkout-dialog').close(); $('#bag-dialog').close(); $('#product-dialog').close(); cart=await api(`/carts/${cart.id}`);renderCount();await refreshCatalog();$('#orders-content').innerHTML=`<div class="order-success"><div class="success-mark">✓</div><h3>Good things are on their way.</h3><p class="muted">Thanks, ${escape(order.customer.name)}. Your demo order is confirmed.<br>No real payment was taken.</p>${orderCard(order)}<button class="primary" id="back-to-shopping">Keep exploring ↗</button></div>`;openDialog('#orders-dialog');event.target.reset(); }
  catch(e) { $('#checkout-error').textContent=e.message; } finally { button.disabled=false; }
});
function orderCard(o) { return `<article class="order-card" data-order-id="${o.id}"><h3>${escape(o.id)}<span class="order-status ${o.status}">${escape(o.status)}</span></h3><p>${new Date(o.createdAt).toLocaleString('en-IN')} · ${escape(o.paymentMethod==='test_card'?'Test payment':'Cash on delivery')}<br>${escape(o.customer.email)}</p><ul>${o.items.map(i=>`<li>${escape(i.product.name)} × ${i.quantity} · ${money(i.lineTotal)}</li>`).join('')}</ul><p>${escape(o.address.line1)}, ${escape(o.address.city)}, ${escape(o.address.postalCode)}, ${escape(o.address.country)}<br>${o.shippingMethod==='express'?'Express delivery · 1–2 days':'Standard delivery · 3–5 days'}</p><strong>Total ${money(o.total)}</strong>${o.status==='confirmed'?`<br><button class="secondary" data-cancel="${o.id}">Cancel demo order</button>`:'<p>Cancelled. Inventory restored.</p>'}</article>`; }
async function showOrders() { const email=$('#order-email').value.trim(); const data=await api(`/orders${email?`?email=${encodeURIComponent(email)}`:''}`);$('#orders-content').innerHTML=data.orders.length?data.orders.map(orderCard).join(''):'<div class="empty"><h3>No orders yet.</h3>Your everyday finds will appear here.</div>'; }
$('#orders-button').addEventListener('click',async()=>{try{await showOrders();openDialog('#orders-dialog');}catch(e){toast(e.message);}});
$('#order-search').addEventListener('submit',async event=>{event.preventDefault();try{await showOrders();}catch(e){toast(e.message);}});
$('#orders-content').addEventListener('click',event=>{if(event.target.closest('#back-to-shopping'))$('#orders-dialog').close();});
$('#search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(loadProducts,200);});
['#min-price','#max-price'].forEach(selector=>$(selector).addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(loadProducts,300);}));
['#sort','#in-stock'].forEach(selector=>$(selector).addEventListener('change',loadProducts));
$('#clear-filters').addEventListener('click',()=>{activeCategory='';$('#search').value='';$('#min-price').value='';$('#max-price').value='';$('#in-stock').checked=false;$('#sort').value='featured';renderCategories();loadProducts();});
window.addEventListener('agent:cart-changed', async () => {
  try {
    await ensureCart(); checkoutKey = null;
    if ($('#bag-dialog').open) renderBag();
    if ($('#checkout-dialog').open) {
      if (!cart.items.length) $('#checkout-dialog').close(); else updateCheckoutTotals();
    }
    await refreshCatalog();
    // Re-rendering an agent change must not notify the agent again.
  } catch (error) { toast(error.message); }
});
try { categories=(await api('/categories')).categories;await refreshCatalog();await ensureCart();renderCount(); } catch(e) { toast(`Could not connect to the store: ${e.message}`); }
mountCommerceAgent().catch(error => console.warn(error.message));
