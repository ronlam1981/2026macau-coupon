const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../coupon-core');
const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');

function setup() {
  let app;
  const FixedDate = class extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-21T04:00:00Z'])); } };
  const Vue = { ref: value => ({ value }), computed: get => ({ get value() { return get(); } }),
    onMounted() {}, onBeforeUnmount() {}, watch() {}, createApp: options => ({ mount() { app = options.setup(); } }) };
  vm.runInNewContext(html.match(/<script>\s*const \{ createApp[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g,''),
    { Vue, CouponCore: core, Date: FixedDate, localStorage: { getItem: () => null }, console });
  return app;
}

test('actual form handler passes mixed counts and source App through to storage model', () => {
  const app = setup();
  app.selectedPlatform.value = 'BOC 中銀';
  app.drawCounts.value[10] = 1;
  app.merchantForm.value = { discountCount: 2, giftCount: 1 };
  app.handlePreSave();
  assert.equal(app.coupons.value.length, 0);
  const confirm = app.confirmDialog.value.onConfirm;
  confirm(); confirm();
  assert.equal(app.coupons.value.length, 3);
  assert.ok(app.coupons.value.every(c => c.platform === 'BOC 中銀'));
  assert.equal(app.coupons.value[1].quantity, 2);
  assert.equal(app.logs.value.length, 1);
});

test('actual unified confirmation cancels safely and ignores stale or repeated callbacks', () => {
  const app = setup();
  app.coupons.value = [{id:'m',type:'merchant_discount',quantity:3,status:'active',platform:'MPay'},
    {id:'g',type:'merchant_gift',quantity:2,status:'active'}];
  app.selectedCouponIds.value = ['m','g'];
  app.handlePreRedeem();
  const cancelled = app.confirmDialog.value.onConfirm;
  app.confirmDialog.value = null;
  cancelled();
  assert.equal(app.logs.value.length, 0);
  assert.equal(core.getMerchantCounts(app.coupons.value[0]).remaining, 3);
  app.handlePreRedeem();
  const confirmed = app.confirmDialog.value.onConfirm;
  confirmed(); confirmed(); cancelled();
  assert.equal(app.logs.value.length, 2);
  assert.equal(core.getMerchantCounts(app.coupons.value[0]).remaining, 2);
  assert.equal(core.getMerchantCounts(app.coupons.value[1]).remaining, 1);
  assert.equal(app.activeTab.value, 'history');
});
