import { writeFileSync } from 'node:fs';
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const string = (description, extra={}) => ({ type:'string', ...(description?{description}:{}), ...extra });
const number = description => ({type:'number',description});
const object = (properties, required=Object.keys(properties)) => ({type:'object',properties,required});
const array = items => ({type:'array',items});
const json = schema => ({'application/json':{schema}});
const response = (schema,description='Success') => ({description,content:json(schema)});
const body = schema => ({required:true,content:json(schema)});
const pathParam = name => ({name,in:'path',required:true,schema:{type:'string'}});
const query = (name,schema,description) => ({name,in:'query',required:false,schema,...(description?{description}:{})});
const errors = {'400':response(ref('Error'),'Invalid request'),'404':response(ref('Error'),'Resource not found'),'409':response(ref('Error'),'Insufficient stock or idempotency conflict'),'500':response(ref('Error'),'Unexpected server error')};
const op = (operationId,summary,tag,schema,extra={}) => ({operationId,summary,tags:[tag],responses:{'200':response(schema),...errors},...extra});
const price = number('Amount in INR rupees, not paise.');
const quantity = {type:'integer',minimum:1,maximum:99};
const product = object({id:string(),name:string(),category:string(),description:string(),price,compareAtPrice:price,currency:{type:'string',enum:['INR']},stock:{type:'integer',minimum:0},rating:{type:'number'},image:string('Relative URL of a local SVG illustration.'),illustration:string(),background:string(),badge:string()});
const cartItem = object({productId:string(),quantity,product:ref('Product'),lineTotal:price});
const totals = {subtotal:price,discount:price,shipping:price,total:price,currency:{type:'string',enum:['INR']}};
const customer = object({name:string(null,{minLength:1,maxLength:100}),email:string(null,{format:'email',maxLength:254})});
const address = object(Object.fromEntries(['line1','city','postalCode','country'].map(k=>[k,string(null,{minLength:1,maxLength:200})])));
const shippingMethod = {type:'string',enum:['standard','express'],default:'standard',description:'Standard costs INR 99, waived when subtotal after discount is >= INR 2500 or FREESHIP is applied. Express always costs INR 199.'};
const paymentMethod = {type:'string',enum:['test_card','cash_on_delivery'],default:'test_card',description:'Both methods are simulated. No real card details or payment processor.'};
export const spec = {
  openapi:'3.0.3',
  info:{title:'Everyday Demo Store API',version:'1.1.0',description:'Ecommerce sandbox for testing agents. No authentication or real payments. Create a cart, add products, optionally apply a coupon, then checkout. All prices are INR rupees. Carts, orders, inventory and checkout idempotency records persist in PostgreSQL when DATABASE_URL is configured, or data/store.json locally. OpenAPI can be imported by an OpenAPI-to-MCP adapter; this file is not itself an MCP server. Reset removes all carts/orders and restores seeded inventory.'},
  servers:[{url:'http://localhost:3000',description:'Local Node server (change URL if using another PORT or an adapter in Docker).'}],
  tags:['Catalog','Cart','Checkout','Orders','Testing'].map(name=>({name})),
  paths:{
    '/api/health':{get:op('getHealth','Check the store and its storage connection','Testing',object({status:string(),service:string(),mode:string(),storage:{type:'string',enum:['file','memory','postgres']}}))},
    '/api/categories':{get:op('listCategories','List product categories','Catalog',object({categories:array(string())}))},
    '/api/products':{get:op('listProducts','Search, filter and sort products','Catalog',object({products:array(ref('Product')),total:{type:'integer'},page:{type:'integer'},limit:{type:'integer'},pages:{type:'integer'}}),{parameters:[query('q',string(),'Case-insensitive search in product name and description.'),query('category',string(),'Exact category name from listCategories.'),query('minPrice',{type:'number',minimum:0}),query('maxPrice',{type:'number',minimum:0}),query('inStock',{type:'boolean',default:false}),query('sort',{type:'string',enum:['featured','price_asc','price_desc','rating','name'],default:'featured'}),query('page',{type:'integer',minimum:1,default:1}),query('limit',{type:'integer',minimum:1,maximum:100,default:12})]})},
    '/api/products/{productId}':{parameters:[pathParam('productId')],get:op('getProduct','Get product details and current stock','Catalog',ref('Product'))},
    '/api/carts':{post:op('createCart','Create an anonymous cart; keep its returned id','Cart',ref('Cart'),{responses:{'201':response(ref('Cart'),'Cart created'),...errors}})},
    '/api/carts/{cartId}':{parameters:[pathParam('cartId')],get:op('getCart','Get cart items, coupon and calculated totals','Cart',ref('Cart')),delete:op('clearCart','Remove all cart items and its coupon','Cart',ref('Cart'))},
    '/api/carts/{cartId}/items':{parameters:[pathParam('cartId')],post:op('addCartItem','Add a product; quantity is added to an existing line','Cart',ref('Cart'),{description:'Adding to a cart does not reserve stock. Stock is checked again at checkout. Maximum 99 units per product per cart.',requestBody:body(object({productId:string(null,{example:'p-001'}),quantity:{...quantity,default:1}},['productId']))})},
    '/api/carts/{cartId}/items/{productId}':{parameters:[pathParam('cartId'),pathParam('productId')],patch:op('updateCartItem','Set an existing cart item quantity (absolute, not incremental)','Cart',ref('Cart'),{requestBody:body(object({quantity}))}),delete:op('removeCartItem','Remove one product from a cart','Cart',ref('Cart'))},
    '/api/carts/{cartId}/coupon':{parameters:[pathParam('cartId')],put:op('applyCoupon','Apply WELCOME10 or FREESHIP; replaces any existing coupon','Cart',ref('Cart'),{description:'WELCOME10 gives 10% off subtotal, rounded to the nearest whole rupee. FREESHIP waives standard shipping. Codes are case-insensitive. One coupon at a time.',requestBody:body(object({code:{type:'string',enum:['WELCOME10','FREESHIP']}}))}),delete:op('removeCoupon','Remove a cart coupon','Cart',ref('Cart'))},
    '/api/checkout':{post:op('checkout','Place a simulated order and clear the cart','Checkout',ref('Order'),{description:'Rechecks stock and reduces inventory only on success. Empty carts are rejected. Use Idempotency-Key for safe retries of exactly the same JSON request. A repeated key returns the original order; a different body with that key returns 409. After a test reset, idempotency records are removed.',parameters:[{name:'Idempotency-Key',in:'header',required:false,schema:{type:'string',maxLength:200},description:'A unique key per intended checkout; reuse it when retrying the same request.'}],requestBody:body(ref('CheckoutRequest')),responses:{'201':response(ref('Order'),'New order confirmed'),'200':response(ref('Order'),'Original order returned for an idempotent retry'),'402':response(ref('Error'),'Simulated payment decline; cart and inventory are unchanged'),...errors}})},
    '/api/orders':{get:op('listOrders','List sandbox orders, optionally filtered by email','Orders',object({orders:array(ref('Order'))}),{parameters:[query('email',string(null,{format:'email'}),'Case-insensitive exact customer email; omitted lists all sandbox orders.')]})},
    '/api/orders/{orderId}':{parameters:[pathParam('orderId')],get:op('getOrder','Get a confirmed or cancelled order','Orders',ref('Order'))},
    '/api/orders/{orderId}/cancel':{parameters:[pathParam('orderId')],post:op('cancelOrder','Cancel an order and restore inventory once','Orders',ref('Order'),{description:'Repeated cancellation is safe. Test payments become refunded_test; simulated cash-on-delivery becomes cancelled.'})},
    '/api/test/reset':{post:op('resetSandbox','Delete all carts/orders and restore the seeded catalog','Testing',object({message:string(),products:{type:'integer'}}),{description:'Destructive sandbox operation for repeatable tests. All previous cart and order IDs become invalid.',requestBody:body(object({confirm:{type:'string',enum:['RESET']}}))})},
  },
  components:{schemas:{
    Error:object({error:object({code:string(),message:string()})}),Product:product,
    Cart:object({id:string(),items:array(cartItem),coupon:{type:'string',nullable:true,enum:['WELCOME10','FREESHIP',null]},createdAt:string(null,{format:'date-time'}),itemCount:{type:'integer'},...totals}),
    CheckoutRequest:object({cartId:string(),customer,address,shippingMethod,paymentMethod,simulatePaymentFailure:{type:'boolean',default:false,description:'true returns 402 PAYMENT_DECLINED with no changes to cart or stock.'}},['cartId','customer','address']),
    Order:object({id:string(),status:{type:'string',enum:['confirmed','cancelled']},customer,address,items:array(cartItem),...totals,coupon:{type:'string',nullable:true},shippingMethod,paymentMethod,paymentStatus:{type:'string',enum:['paid_test','pending','refunded_test','cancelled']},createdAt:string(null,{format:'date-time'})})
  }}
};
// Emit readable YAML without a package installation. JSON-quoted strings are YAML scalars.
function yaml(value, depth=0) {
  const pad='  '.repeat(depth);
  if (Array.isArray(value)) return value.length?value.map(v=>`${pad}- ${typeof v==='object'&&v!==null?'\n'+yaml(v,depth+1):JSON.stringify(v)}`).join('\n'):`${pad}[]`;
  if (value&&typeof value==='object') return Object.entries(value).map(([k,v])=>`${pad}${JSON.stringify(k)}:${typeof v==='object'&&v!==null?'\n'+yaml(v,depth+1):' '+JSON.stringify(v)}`).join('\n');
  return `${pad}${JSON.stringify(value)}`;
}
const serverFlag = process.argv.indexOf('--server');
const deployedUrl = serverFlag >= 0 ? process.argv[serverFlag + 1] : process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL;
let deployed;
if (deployedUrl) {
  const url = new URL(deployedUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('The server URL must use HTTP or HTTPS.');
  deployed = structuredClone(spec);
  deployed.servers = [{ url: url.origin, description: 'Deployed Render sandbox; no authentication required.' }];
}
const primary = process.env.RENDER && deployed ? deployed : spec;
writeFileSync(new URL('../openapi.yaml',import.meta.url), yaml(primary)+'\n');
writeFileSync(new URL('../openapi.json',import.meta.url), JSON.stringify(primary,null,2)+'\n');
if (deployed) {
  writeFileSync(new URL('../openapi.render.yaml',import.meta.url), yaml(deployed)+'\n');
  writeFileSync(new URL('../openapi.render.json',import.meta.url), JSON.stringify(deployed,null,2)+'\n');
}
console.log(`Generated OpenAPI YAML and JSON: ${Object.keys(spec.paths).length} paths.${deployed ? ' Render collection generated.' : ''}`);
