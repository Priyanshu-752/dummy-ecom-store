export const seedProducts = [
  ['p-001', 'Studio Headphones', 'Electronics', 3499, 4499, 18, 4.8, 'Wireless over-ear headphones with soft cushions, active noise cancellation, and 40-hour battery life.', 'headphones', '#d9e2e1', 'Bestseller'],
  ['p-002', 'Everyday Backpack', 'Accessories', 1899, 2499, 24, 4.7, 'A water-resistant 20L backpack with a padded 15-inch laptop sleeve and thoughtful everyday pockets.', 'backpack', '#e8dfd4', 'Popular'],
  ['p-003', 'Ceramic Coffee Mug', 'Home & Living', 499, 699, 36, 4.9, 'A hand-finished 350ml stoneware mug. Microwave and dishwasher safe. Made for slower mornings.', 'mug', '#e9e2d7', ''],
  ['p-004', 'Classic Sneakers', 'Clothing', 2299, 2999, 15, 4.6, 'Comfortable everyday sneakers with a canvas upper, cushioned footbed, and durable rubber sole. Universal demo size: UK 8.', 'shoe', '#e3e5db', 'New'],
  ['p-005', 'Portable Speaker', 'Electronics', 1799, 2299, 12, 4.5, 'Compact Bluetooth speaker with rich sound, splash resistance, and up to 12 hours of playtime.', 'speaker', '#e2ddd4', ''],
  ['p-006', 'Desk Lamp', 'Home & Living', 1499, 1999, 9, 4.7, 'An adjustable reading lamp with warm LED light and a weighted metal base. Includes a USB power cable.', 'lamp', '#e5e6d9', ''],
  ['p-007', 'Cotton Essential Tee', 'Clothing', 799, 999, 30, 4.6, 'A relaxed-fit t-shirt made from breathable 100% cotton. Pre-shrunk for a consistent fit. Demo size: M.', 'shirt', '#e5dfd9', ''],
  ['p-008', 'Insulated Water Bottle', 'Accessories', 899, 1199, 20, 4.8, 'A 750ml stainless steel bottle that keeps drinks cold for 24 hours or hot for 12 hours. Leakproof lid.', 'bottle', '#dde5df', 'Bestseller'],
  ['p-009', 'Pocket Notebook Set', 'Stationery', 349, 449, 50, 4.5, 'Three A6 notebooks with dotted, lined, and blank pages. Recycled paper and durable stitched binding.', 'notebook', '#e9dfd3', ''],
  ['p-010', 'Minimal Wristwatch', 'Accessories', 2499, 3299, 6, 4.7, 'A clean 38mm analogue watch with a vegan leather strap, quartz movement, and splash-resistant case.', 'watch', '#e1e0da', ''],
  ['p-011', 'Mechanical Keyboard', 'Electronics', 3999, 4999, 3, 4.9, 'A compact wired mechanical keyboard with tactile switches, warm white backlighting, and USB-C connectivity.', 'keyboard', '#dedee4', 'Low stock'],
  ['p-012', 'Linen Cushion', 'Home & Living', 699, 899, 0, 4.4, 'A textured linen-blend cushion with a removable washable cover and soft recycled filling. 40 × 40cm.', 'cushion', '#e7ded9', 'Sold out'],
].map(([id, name, category, price, compareAtPrice, stock, rating, description, illustration, background, badge]) => ({ id, name, category, price, compareAtPrice, stock, rating, description, illustration, background, badge, currency: 'INR', image: `/assets/${illustration}.svg` }));
