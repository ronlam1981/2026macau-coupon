const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../coupon-core');
const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');

function setup() {
  let app;
  const planWatchers = [];
  const FixedDate = class extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-21T04:00:00Z'])); } };
  const Vue = { ref: value => ({ value }), computed: get => ({ get value() { return get(); } }),
    onMounted() {}, onBeforeUnmount() {}, watch(source, callback) { if (Array.isArray(source)) planWatchers.push(callback); }, createApp: options => ({ mount() { app = options.setup(); } }) };
  vm.runInNewContext(html.match(/<script>\s*const \{ createApp[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g,''),
    { Vue, CouponCore: core, Date: FixedDate, localStorage: { getItem: () => null }, console });
  app.refreshSuggestions = () => planWatchers.forEach(callback => callback());
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


function governmentFixture() {
  return [200, 100, 50, 20, 20, 10].map((amount, i) => ({
    id: 'gov-' + i, type: 'government', amount, platform: 'MPay 澳門通', status: 'active'
  }));
}

test('manual selection permits lower, middle, equal-value and non-prefix combinations in either display order', () => {
  for (const order of ['asc', 'desc']) {
    for (const ids of [['gov-5'], ['gov-2'], ['gov-4'], ['gov-1', 'gov-5'], ['gov-3', 'gov-4']]) {
      const app = setup();
      app.sortOrder.value = order;
      app.coupons.value = governmentFixture();
      ids.forEach(id => app.toggleCouponSelection(id));
      const required = ids.reduce((sum, id) => sum + app.coupons.value.find(c => c.id === id).amount * 3, 0);
      assert.equal(app.totalSelectedRequired.value, required);
      app.spendAmount.value = String(required);
      app.handlePreRedeem();
      assert.equal(app.redeemErrorMsg.value, '');
      assert.ok(app.confirmDialog.value, order + ': ' + ids);
      assert.ok(app.coupons.value.every(c => c.status === 'active'));
      const confirm = app.confirmDialog.value.onConfirm;
      confirm(); confirm();
      assert.equal(app.logs.value.length, ids.length);
      assert.deepEqual(Array.from(app.coupons.value.filter(c => c.status === 'used'), c => c.id).sort(), ids.slice().sort());
      assert.ok(app.coupons.value.filter(c => !ids.includes(c.id)).every(c => c.status === 'active'));
    }
  }
});

test('lower-denomination selection supports optional spend, cancellation, deselection and later confirmation', () => {
  const app = setup();
  app.coupons.value = governmentFixture();
  app.goToRedeem('gov-5');
  app.handlePreRedeem();
  const cancelled = app.confirmDialog.value.onConfirm;
  app.confirmDialog.value = null;
  cancelled();
  assert.equal(app.logs.value.length, 0);
  assert.ok(app.coupons.value.every(c => c.status === 'active'));
  app.toggleCouponSelection('gov-5');
  assert.equal(app.selectedCouponIds.value.length, 0);
  app.toggleCouponSelection('gov-4');
  app.handlePreRedeem();
  app.confirmDialog.value.onConfirm();
  assert.equal(app.coupons.value.find(c => c.id === 'gov-4').status, 'used');
  assert.equal(app.coupons.value.find(c => c.id === 'gov-5').status, 'active');
});

test('manual selection keeps insufficient-spend and multiple-wallet safeguards', () => {
  const app = setup();
  app.coupons.value = governmentFixture();
  app.selectedCouponIds.value = ['gov-5'];
  app.spendAmount.value = '29';
  app.handlePreRedeem();
  assert.match(app.redeemErrorMsg.value, /金額不足/);
  assert.equal(app.confirmDialog.value, null);
  app.spendAmount.value = '30';
  app.handlePreRedeem();
  assert.ok(app.confirmDialog.value);
  app.confirmDialog.value = null;
  app.coupons.value.push({id:'other', amount:10, platform:'BOC 中銀', status:'active'});
  app.selectedCouponIds.value = ['gov-5', 'other'];
  app.spendAmount.value = '60';
  app.handlePreRedeem();
  assert.match(app.redeemErrorMsg.value, /每次只選一個錢包/);
  assert.equal(app.confirmDialog.value, null);
  assert.equal(app.logs.value.length, 0);
});

test('suggestions skip unaffordable large coupons in single and split modes without changing records', () => {
  for (const mode of ['single', 'split']) {
    for (const spend of [29, 30, 90]) {
      const app = setup();
      app.coupons.value = governmentFixture();
      app.suggestMode.value = mode;
      app.suggestSpend.value = String(spend);
      const before = JSON.stringify(app.coupons.value);
      app.refreshSuggestions();
      assert.equal(app.totalSuggestSaving.value, spend < 30 ? 0 : spend / 3);
      assert.ok(app.totalSuggestUsedSpend.value <= spend);
      assert.equal(JSON.stringify(app.coupons.value), before);
      if (spend >= 30) {
        app.handleBatchRedeem();
        assert.equal(app.logs.value.length, 0);
        assert.equal(JSON.stringify(app.coupons.value), before);
        app.handlePreRedeem();
        assert.ok(app.confirmDialog.value);
        assert.equal(app.redeemErrorMsg.value, '');
      }
    }
  }
});

test('the help text no longer claims a mandatory denomination order', () => {
  assert.doesNotMatch(html, /同一錢包必須先用較高面額券|請由最大面額開始選|同一錢包按大面額優先/);
  assert.match(html, /任何面額都可以選/);
});
