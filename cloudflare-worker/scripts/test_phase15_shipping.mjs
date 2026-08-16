/**
 * Phase 15 — Server-side Stock + Shipping unit tests.
 * Runs createOrder() against an in-memory mock D1 (no production data touched).
 * Usage:  node scripts/test_phase15_shipping.mjs
 */
const { createOrder, adminUpdateOrder } = await import('../src/handlers/orders.js');

let passCount = 0, failCount = 0;
function log(name, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name}${detail ? ' — ' + detail : ''}`);
  passed ? passCount++ : failCount++;
}

// ---------- In-memory mock D1 ----------
function makeDb(products, settings, orders) {
  return {
    prepare(sql) {
      const stmt = {
        args: [],
        bind(...args) { this.args = args; return this; },
        async all() {
          const low = sql.toLowerCase();
          if (low.includes('from products')) {
            const ids = this.args || [];
            const rows = products.filter(p => ids.includes(p.id));
            return { results: rows };
          }
          if (low.includes('from settings')) {
            const keys = this.args && this.args.length ? this.args : settings.map(s => s.key);
            const rows = settings.filter(s => keys.includes(s.key));
            return { results: rows };
          }
          if (low.includes('from orders')) {
            return { results: orders };
          }
          return { results: [] };
        },
        async first() {
          const low = sql.toLowerCase();
          if (low.includes('from coupons')) return null;
          if (low.includes('from orders')) return orders[0] || null;
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO orders')) {
            const [orderId, createdAt, name, phone, wilayaCode, wilayaAr, wilayaEn,
              municipality, deliveryType, itemsJson, subtotal, shippingCost,
              shippingNote, discount, couponCode, status, notes,
              utmSource, utmMedium, utmCampaign, customerId,
              deliveryCompany, trackingCode] = this.args;
            orders.push({ order_id: orderId, shipping_cost: shippingCost, shipping_note: shippingNote, delivery_company: deliveryCompany, tracking_code: trackingCode, subtotal, delivery_type: deliveryType });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE coupons')) return { meta: { changes: 1 } };
          if (sql.includes('UPDATE orders')) {
            const o = orders.find(x => x.order_id === this.args[this.args.length - 1]);
            if (o) Object.assign(o, { _updated: true });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        }
      };
      return stmt;
    }
  };
}

async function main() {
  const products = [
    { id: 1, name: 'Enzo Test', price: 13500, active: 1, stock: 5 },
    { id: 2, name: 'Sold Out', price: 1000, active: 1, stock: 0 },
    { id: 3, name: 'Low Stock', price: 2000, active: 1, stock: 2 },
    { id: 4, name: 'Inactive', price: 500, active: 0, stock: 10 },
    { id: 5, name: 'Unlimited', price: 999, active: 1, stock: -1 },
  ];
  const settings = [
    { key: 'shipping_home', value: '600' },
    { key: 'shipping_office', value: '400' },
    { key: 'shipping_remote', value: '300' },
  ];
  const orders = [];
  const env = { DB: makeDb(products, settings, orders) };
  const baseParams = (over) => Object.assign({
    name: 'Test User', phone: '0699123456',
    wilaya_code: '03', wilaya_ar: 'الأغواط', wilaya_en: 'Laghouat', municipality: 'الأغواط',
    delivery_type: 'Home',
    items_json: JSON.stringify([{ id: 1, qty: 1 }]),
  }, over || {});

  // 1. stock = 0 -> rejected
  let r = await createOrder(env, baseParams({ items_json: JSON.stringify([{ id: 2, qty: 1 }]) }), null, null, null);
  log('stock=0 rejected', !r.ok && r.error.includes('نفد'), r.error || 'order created!');

  // 2. qty > stock -> rejected
  r = await createOrder(env, baseParams({ items_json: JSON.stringify([{ id: 3, qty: 3 }]) }), null, null, null);
  log('qty>stock rejected', !r.ok && r.error.includes('تتجاوز المخزون'), r.error || 'order created!');

  // 3. qty <= stock -> accepted
  r = await createOrder(env, baseParams({ items_json: JSON.stringify([{ id: 3, qty: 2 }]) }), null, null, null);
  log('qty<=stock accepted', !!(r.ok && r.order_id), r.error || r.order_id);

  // 4. inactive -> rejected
  r = await createOrder(env, baseParams({ items_json: JSON.stringify([{ id: 4, qty: 1 }]) }), null, null, null);
  log('inactive rejected', !r.ok && r.error.includes('غير متوفر'), r.error || 'order created!');

  // 5. stock=-1 (unlimited) -> accepted
  r = await createOrder(env, baseParams({ items_json: JSON.stringify([{ id: 5, qty: 99 }]) }), null, null, null);
  log('unlimited stock accepted', !!(r.ok && r.order_id), r.error || r.order_id);

  // 6. shipping setting=0 -> phone confirmation (shipping_cost 0 + note)
  const orders2 = [];
  const env0 = { DB: makeDb(products, [{ key: 'shipping_home', value: '0' }], orders2) };
  r = await createOrder(env0, baseParams({ wilaya_code: '16' }), null, null, null);
  const o0 = orders2[0];
  log('shipping=0 -> phone confirm', o0 && o0.shipping_cost === 0 && o0.shipping_note.includes('بعد التأكيد'), JSON.stringify({ cost: o0 && o0.shipping_cost, note: o0 && o0.shipping_note }));

  // 7. shipping_home configured -> server-side cost (Home + wilaya 03, not remote)
  const o1 = orders.find(o => o.shipping_cost === 600);
  log('shipping_home=600 applied', !!o1, 'orders=' + orders.length + ' costs=' + orders.map(o => o.shipping_cost).join(',') + ' note=' + JSON.stringify(o1 && o1.shipping_note));

  // 8. remote wilaya (50 Bordj Badji Mokhtar) -> remote surcharge 600+300
  const orders3 = [];
  const envR = { DB: makeDb(products, settings, orders3) };
  r = await createOrder(envR, baseParams({ wilaya_code: '50', delivery_type: 'Home' }), null, null, null);
  const oR = orders3[0];
  log('remote wilaya adds surcharge', oR && oR.shipping_cost === 900, 'cost=' + (oR && oR.shipping_cost) + ' (600+300)');

  // 9. office cost
  const orders4 = [];
  const envOff = { DB: makeDb(products, settings, orders4) };
  r = await createOrder(envOff, baseParams({ delivery_type: 'Office', wilaya_code: '16' }), null, null, null);
  const oOff = orders4[0];
  log('shipping_office applied', oOff && oOff.shipping_cost === 400, 'cost=' + (oOff && oOff.shipping_cost));

  // 10. delivery_company defaults to yalidine
  log('delivery_company=yalidine', o1 && o1.delivery_company === 'yalidine', o1 && o1.delivery_company);

  // 11. tracking_code defaults empty
  log('tracking_code empty', o1 && o1.tracking_code === '', JSON.stringify(o1 && o1.tracking_code));

  // 12. price manipulated client-side -> server price wins
  r = await createOrder(env, baseParams({ items_json: JSON.stringify([{ id: 1, qty: 1, price: 1 }]) }), null, null, null);
  const oPrice = orders[orders.length - 1];
  log('server price wins', oPrice && oPrice.subtotal === 13500, 'subtotal=' + (oPrice && oPrice.subtotal));

  // 13. adminUpdateOrder persists shipping fields
  const upd = await adminUpdateOrder(env, { order_id: o1.order_id, shipping_cost: 700, delivery_company: 'yalidine', tracking_code: 'YL-123456' });
  log('adminUpdateOrder shipping fields', !!(upd && upd.ok) && orders.find(x => x.order_id === o1.order_id)._updated, JSON.stringify(upd));

  console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
  process.exit(failCount ? 1 : 0);
}

main().catch(e => { console.error('Test harness error:', e); process.exit(2); });
