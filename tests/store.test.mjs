import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, unlinkSync, rmdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStoreServer } from '../backend/server.mjs';

async function setup(t, options={dataFile:null}) {
  const server=createStoreServer(options);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(route,method='GET',body,headers={})=>{const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};};
  const newCart=async()=> (await request('/api/carts','POST',{})).data;
  return {request,newCart,base,server};
}
const checkout=(cartId,extra={})=>({cartId,customer:{name:'Test Agent',email:'agent@example.com'},address:{line1:'12 Test Road',city:'Bengaluru',postalCode:'560001',country:'India'},...extra});

test('catalog search, category, sort, pagination, stock filters and invalid inputs',async t=>{
  const {request}=await setup(t);
  assert.equal((await request('/api/health')).data.status,'ok');
  assert.equal((await request('/api/products')).data.total,12);
  assert.equal((await request('/api/products?q=headphones')).data.products[0].id,'p-001');
  const electronics=(await request('/api/products?category=Electronics&sort=price_asc')).data;
  assert.deepEqual(electronics.products.map(p=>p.price),[1799,3499,3999]);
  assert.equal((await request('/api/products?inStock=true')).data.total,11);
  assert.equal((await request('/api/products?minPrice=3000&maxPrice=4000')).data.total,2);
  assert.equal((await request('/api/products?limit=5&page=3')).data.products.length,2);
  for(const query of ['page=0','limit=101','minPrice=no','minPrice=100&maxPrice=1','sort=bad','inStock=maybe']) assert.equal((await request(`/api/products?${query}`)).status,400);
  assert.equal((await request('/api/products/missing')).status,404);
  assert.equal((await request('/api/carts/__proto__')).status,404);
});
test('cart operations maintain quantities, reject invalid stock, remove and clear',async t=>{
  const {request,newCart}=await setup(t), c=await newCart(), route=`/api/carts/${c.id}`;
  assert.equal((await request(`${route}/items`,'POST',{productId:'p-003',quantity:2})).data.total,1097);
  assert.equal((await request(`${route}/items`,'POST',{productId:'p-003',quantity:1})).data.itemCount,3);
  assert.equal((await request(`${route}/items/p-003`,'PATCH',{quantity:5})).data.itemCount,5);
  for(const quantity of [0,-1,1.5,'2',100]) assert.equal((await request(`${route}/items/p-003`,'PATCH',{quantity})).status,400);
  assert.equal((await request(`${route}/items`,'POST',{productId:'p-012'})).status,409);
  assert.equal((await request(`${route}/items`,'POST',{productId:'p-011',quantity:4})).status,409);
  assert.equal((await request(`${route}/items/p-003`,'DELETE')).data.total,0);
  await request(`${route}/items`,'POST',{productId:'p-001'});
  await request(`${route}/coupon`,'PUT',{code:'WELCOME10'});
  const empty=(await request(route,'DELETE')).data;assert.equal(empty.itemCount,0);assert.equal(empty.coupon,null);
});
test('coupons, discount rounding and shipping thresholds use backend totals',async t=>{
  const {request,newCart}=await setup(t), c=await newCart(), route=`/api/carts/${c.id}`;
  await request(`${route}/items`,'POST',{productId:'p-002'});
  const discounted=(await request(`${route}/coupon`,'PUT',{code:'welcome10'})).data;
  assert.equal(discounted.discount,190);assert.equal(discounted.total,1808);
  assert.equal((await request(`${route}/coupon`,'PUT',{code:'bad'})).status,400);
  const free=(await request(`${route}/coupon`,'PUT',{code:'FREESHIP'})).data;assert.equal(free.shipping,0);assert.equal(free.discount,0);
  await request(`${route}/coupon`,'DELETE');await request(`${route}/items`,'POST',{productId:'p-003',quantity:2});
  assert.equal((await request(route)).data.shipping,0);
});
test('checkout snapshots price, clears cart, decrements stock and supports idempotent retry',async t=>{
  const {request,newCart}=await setup(t), c=await newCart();
  await request(`/api/carts/${c.id}/items`,'POST',{productId:'p-001',quantity:2});
  const payload=checkout(c.id),headers={'Idempotency-Key':'test-checkout'};
  const result=await request('/api/checkout','POST',payload,headers);assert.equal(result.status,201);assert.equal(result.data.total,6998);assert.equal(result.data.paymentStatus,'paid_test');
  assert.equal((await request(`/api/carts/${c.id}`)).data.itemCount,0);
  assert.equal((await request('/api/products/p-001')).data.stock,16);
  const retry=await request('/api/checkout','POST',payload,headers);assert.equal(retry.status,200);assert.equal(retry.data.id,result.data.id);
  assert.equal((await request('/api/products/p-001')).data.stock,16);
  assert.equal((await request('/api/checkout','POST',checkout(c.id,{shippingMethod:'express'}),headers)).status,409);
  assert.equal((await request(`/api/orders/${result.data.id}`)).data.items[0].product.price,3499);
  assert.equal((await request('/api/orders?email=AGENT%40example.com')).data.orders.length,1);
});
test('failed payment, empty cart and invalid customer leave inventory unchanged',async t=>{
  const {request,newCart}=await setup(t), c=await newCart();
  assert.equal((await request('/api/checkout','POST',checkout(c.id))).data.error.code,'EMPTY_CART');
  await request(`/api/carts/${c.id}/items`,'POST',{productId:'p-003'});
  assert.equal((await request('/api/checkout','POST',checkout(c.id,{simulatePaymentFailure:true}))).status,402);
  assert.equal((await request(`/api/carts/${c.id}`)).data.itemCount,1);
  assert.equal((await request('/api/products/p-003')).data.stock,36);
  assert.equal((await request('/api/checkout','POST',checkout(c.id,{customer:{name:'Test',email:'bad'}}))).status,400);
  assert.equal((await request('/api/orders')).data.orders.length,0);
});
test('checkout rechecks shared stock and does not oversell',async t=>{
  const {request,newCart}=await setup(t), a=await newCart(),b=await newCart();
  for(const c of [a,b]) await request(`/api/carts/${c.id}/items`,'POST',{productId:'p-011',quantity:3});
  const results=await Promise.all([a,b].map(c=>request('/api/checkout','POST',checkout(c.id))));
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);assert.equal((await request('/api/products/p-011')).data.stock,0);
});
test('express checkout and cancellation restore stock exactly once',async t=>{
  const {request,newCart}=await setup(t), c=await newCart();await request(`/api/carts/${c.id}/items`,'POST',{productId:'p-003'});
  const o=(await request('/api/checkout','POST',checkout(c.id,{shippingMethod:'express',paymentMethod:'cash_on_delivery'}))).data;
  assert.equal(o.shipping,199);assert.equal(o.total,698);assert.equal(o.paymentStatus,'pending');
  for(let i=0;i<2;i++){const cancelled=await request(`/api/orders/${o.id}/cancel`,'POST',{});assert.equal(cancelled.data.status,'cancelled');}
  assert.equal((await request('/api/products/p-003')).data.stock,36);
});
test('reset requires explicit body, deletes carts/orders and restores seeded inventory',async t=>{
  const {request,newCart}=await setup(t),c=await newCart();await request(`/api/carts/${c.id}/items`,'POST',{productId:'p-003'});
  await request('/api/checkout','POST',checkout(c.id));
  assert.equal((await request('/api/test/reset','POST',{})).status,400);
  assert.equal((await request('/api/test/reset','POST',{confirm:'RESET'})).status,200);
  assert.equal((await request(`/api/carts/${c.id}`)).status,404);assert.equal((await request('/api/orders')).data.orders.length,0);assert.equal((await request('/api/products/p-003')).data.stock,36);
});
test('state and idempotency records survive a server restart',async t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'everyday-test-')),dataFile=path.join(dir,'store.json');
  t.after(()=>{unlinkSync(dataFile);rmdirSync(dir);});
  const first=await setup(t,{dataFile}),c=await first.newCart();await first.request(`/api/carts/${c.id}/items`,'POST',{productId:'p-003'});
  const payload=checkout(c.id),headers={'Idempotency-Key':'persisted-key'},placed=await first.request('/api/checkout','POST',payload,headers);
  await new Promise(resolve=>{first.server.close(resolve);first.server.closeAllConnections();});
  const second=await setup(t,{dataFile});assert.equal((await second.request('/api/products/p-003')).data.stock,35);
  assert.equal((await second.request('/api/checkout','POST',payload,headers)).data.id,placed.data.id);
});
test('frontend and API description are served locally; every operation has a unique tool name',async t=>{
  const {base}=await setup(t);
  for(const route of ['/','/app.js','/styles.css','/assets/headphones.svg','/openapi.yaml','/openapi.json'])assert.equal((await fetch(base+route)).status,200);
  const spec=await(await fetch(base+'/openapi.json')).json();const names=[];
  for(const pathItem of Object.values(spec.paths))for(const [key,value]of Object.entries(pathItem))if(key!=='parameters')names.push(value.operationId);
  assert.equal(names.length,17);assert.equal(new Set(names).size,names.length);
  assert.equal(spec.openapi,'3.0.3');assert.ok(readFileSync(new URL('../openapi.yaml',import.meta.url),'utf8').includes('"checkout"'));
});
