const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../coupon-core.js');

function fixtureInput(overrides = {}) {
  return {
    coupons: [],
    logs: [],
    platform: 'Tai Fung 大豐',
    drawCounts: { 10: 1, 20: 0, 50: 0, 100: 0, 200: 0 },
    noWinCount: 0,
    drawDateKey: '2026-10-11',
    recordedAt: new Date('2026-10-12T04:00:00.000Z'),
    entryId: 'fixture-entry',
    ...overrides
  };
}

test('non-draw-day warning cancellation leaves records unchanged', () => {
  const coupons = [{ id: 'existing', status: 'active' }];
  const logs = [{ id: 'existing-log' }];
  assert.equal(core.isDrawDate(core.getMacauDateKey(new Date('2026-10-12T04:00:00Z'))), false);
  assert.deepEqual(coupons, [{ id: 'existing', status: 'active' }]);
  assert.deepEqual(logs, [{ id: 'existing-log' }]);
});

test('confirmed backfill stores the selected draw date, period and expiry', () => {
  const result = core.commitDrawEntry(fixtureInput());
  assert.equal(result.added, true);
  assert.equal(result.coupons[0].drawDate, '2026-10-11T04:00:00.000Z');
  assert.equal(result.coupons[0].expiryDate, '2026-10-15T15:59:59.999Z');
  assert.equal(core.getDrawPeriodStart('2026-10-11'), '2026-10-09');
  assert.equal(result.logs[0].drawDate, '2026-10-11T04:00:00.000Z');
});

test('repeating the same confirmation does not create duplicates', () => {
  const first = core.commitDrawEntry(fixtureInput());
  const second = core.commitDrawEntry(fixtureInput({ coupons: first.coupons, logs: first.logs }));
  assert.equal(second.added, false);
  assert.equal(second.coupons.length, 1);
  assert.equal(second.logs.length, 1);
});

test('ordinary draw day remains the selected Macau calendar day', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  assert.equal(core.getMacauDateKey(now), '2026-10-10');
  assert.equal(core.isDrawDate(core.getMacauDateKey(now)), true);
  assert.equal(core.getMostRecentDrawDate(now), '2026-10-10');
  const result = core.commitDrawEntry(fixtureInput({ drawDateKey: '2026-10-10', recordedAt: now, drawTime: now }));
  assert.equal(result.coupons[0].drawDate, now.toISOString());
});

test('Macau timezone boundary uses Macau date rather than host date', () => {
  assert.equal(core.getMacauDateKey(new Date('2026-10-08T16:30:00Z')), '2026-10-09');
  assert.equal(core.isDrawDate(core.getMacauDateKey(new Date('2026-10-08T16:30:00Z'))), true);
  assert.equal(core.getMacauDateKey(new Date('2026-10-11T16:30:00Z')), '2026-10-12');
  assert.equal(core.getMostRecentDrawDate(new Date('2026-10-11T16:30:00Z')), '2026-10-11');
});

test('invalid or future backfill dates are rejected', () => {
  const monday = new Date('2026-10-12T04:00:00Z');
  assert.match(core.validateBackfillDate('2026-10-12', monday), /星期五、六或日/);
  assert.match(core.validateBackfillDate('2026-10-16', monday), /唔可以遲過/);
});

test('Macau Thursday-to-Friday midnight changes draw-day state', () => {
  const before = core.getMacauTemporalState(new Date('2026-10-15T15:59:59.999Z'));
  const after = core.getMacauTemporalState(new Date('2026-10-15T16:00:00.000Z'));
  assert.deepEqual(before, {
    dateKey: '2026-10-15',
    isDrawDay: false,
    suggestedDrawDate: '2026-10-11',
    campaignStatus: 'active'
  });
  assert.deepEqual(after, {
    dateKey: '2026-10-16',
    isDrawDay: true,
    suggestedDrawDate: '2026-10-16',
    campaignStatus: 'active'
  });
});

test('Macau Sunday-to-Monday midnight returns to backfill mode', () => {
  const before = core.getMacauTemporalState(new Date('2026-10-18T15:59:59.999Z'));
  const after = core.getMacauTemporalState(new Date('2026-10-18T16:00:00.000Z'));
  assert.equal(before.dateKey, '2026-10-18');
  assert.equal(before.isDrawDay, true);
  assert.equal(after.dateKey, '2026-10-19');
  assert.equal(after.isDrawDay, false);
  assert.equal(after.suggestedDrawDate, '2026-10-18');
});

test('Friday coupon expires at the end of the following Macau Thursday', () => {
  assert.equal(core.getExpiryISOString('2026-10-16'), '2026-10-22T15:59:59.999Z');
});

test('usage plans keep wallets separate, use larger coupons first and show spend and self-pay', () => {
  const coupons = [
    { id: 'a10', amount: 10, platform: 'Wallet A', status: 'active' },
    { id: 'b20', amount: 20, platform: 'Wallet B', status: 'active' },
    { id: 'a50', amount: 50, platform: 'Wallet A', status: 'active' },
    { id: 'used', amount: 200, platform: 'Wallet A', status: 'used' }
  ];
  const result = core.buildUsagePlans(coupons, new Date('2026-10-15T00:00:00Z'));
  assert.deepEqual(result.totals, { faceValue: 80, requiredSpend: 240, outOfPocket: 160 });
  assert.equal(result.options[0].transactionCount, 2);
  assert.deepEqual(result.options[0].transactions[0].coupons.map(coupon => coupon.amount), [50, 10]);
  assert.equal(result.options[1].transactionCount, 3);
  assert.deepEqual(result.options[1].transactions.map(item => item.requiredSpend), [150, 30, 60]);
});

test('expired and merchant offers do not enter the government usage plan', () => {
  const coupons = [
    { id: 'expired', amount: 50, platform: 'Wallet A', status: 'active', expiryDate: '2026-10-14T15:59:59.999Z' },
    { id: 'merchant', type: 'merchant_discount', amount: 12, platform: 'Wallet A', status: 'active' },
    { id: 'active', amount: 20, platform: 'Wallet A', status: 'active', expiryDate: '2026-10-16T15:59:59.999Z' }
  ];
  const result = core.buildUsagePlans(coupons, new Date('2026-10-15T00:00:00Z'));
  assert.equal(result.totals.faceValue, 20);
});

test('unknown merchant terms are excluded from automatic optimisation', () => {
  assert.equal(core.isMerchantOfferEligibleForAutoPlan({ type: 'merchant_discount', status: 'active', termsVerified: false, stackability: 'unknown' }), false);
  assert.equal(core.isMerchantOfferEligibleForAutoPlan({ type: 'merchant_gift', status: 'active', termsVerified: true, stackability: 'verified' }), true);
});

test('merchant count registration validates quantity and dates without inventing terms', () => {
  for (const quantity of [0, -1, 1.5, '', 'abc', 10000, Infinity]) {
    assert.throws(() => core.createMerchantBatch({type:'merchant_discount', quantity}));
  }
  assert.throws(() => core.createMerchantBatch({type:'government', quantity:1}));
  assert.throws(() => core.createMerchantBatch({type:'merchant_gift', quantity:1, drawDateKey:'2026-02-30'}));
  const batch = core.createMerchantBatch({type:'merchant_gift', quantity:'3', id:'batch', drawDateKey:'2026-10-16', now:new Date('2026-10-20T00:00:00Z')});
  assert.equal(batch.expiryDate, '2026-10-22T15:59:59.999Z');
  assert.equal(batch.merchant, undefined);
  assert.equal(batch.benefit, undefined);
  assert.equal(batch.termsVerified, false);
  assert.deepEqual(core.getMerchantCounts(batch), {quantity:3, used:0, remaining:3});
  assert.throws(() => core.createMerchantBatch({type:'merchant_discount', quantity:2}));
});

test('partial use, full use and undo preserve quantity and legacy details', () => {
  const now = new Date('2026-10-20T00:00:00Z');
  const original = core.createMerchantBatch({type:'merchant_discount', quantity:2, id:'new', drawDateKey:'2026-10-16', now:new Date('2026-10-20T00:00:00Z')});
  const partial = core.changeMerchantUsage(original,1,now);
  assert.equal(original.usedCount,0);
  assert.deepEqual(core.getMerchantCounts(partial),{quantity:2,used:1,remaining:1});
  const used=core.changeMerchantUsage(partial,1,now);
  assert.equal(used.status,'used');
  assert.equal(core.changeMerchantUsage(used,1,now),used);
  assert.equal(core.changeMerchantUsage(used,-1,now).status,'active');
  const legacy={id:'old',type:'merchant_gift',merchant:'舊商戶',benefit:'舊禮遇',terms:'舊條款',status:'used',expiryDate:'2026-10-22T15:59:59.999Z'};
  assert.deepEqual(core.getMerchantCounts(legacy),{quantity:1,used:1,remaining:0});
  const undone=core.changeMerchantUsage(legacy,-1,now);
  assert.equal(undone.merchant,legacy.merchant);
  assert.equal(undone.benefit,legacy.benefit);
  assert.equal(undone.terms,legacy.terms);
  assert.equal(undone.expiryDate,legacy.expiryDate);
  assert.equal(legacy.status,'used');
});

test('expired batches cannot be consumed; undo retains expiry and government plans exclude batches', () => {
  const now=new Date('2026-10-23T00:00:00Z');
  const expired={id:'expired',type:'merchant_discount',quantity:3,usedCount:1,status:'active',expiryDate:'2026-10-22T15:59:59.999Z'};
  assert.equal(core.changeMerchantUsage(expired,1,now),expired);
  const undone=core.changeMerchantUsage(expired,-1,now);
  assert.equal(core.getCouponStatus(undone,now),'expired');
  assert.equal(core.getMerchantCounts(undone).used,0);
  const government={id:'gov',amount:20,platform:'Wallet A',status:'active'};
  assert.equal(core.changeMerchantUsage(government,1,now),government);
  const records=[government,expired,core.createMerchantBatch({type:'merchant_gift',quantity:5,drawDateKey:'2026-10-16',now})];
  const before=JSON.stringify(records);
  assert.equal(core.buildUsagePlans(records,now).totals.faceValue,20);
  assert.equal(JSON.stringify(records),before);
});


test('merchant batches share government expiry across Thursday, Friday and backfill boundaries', () => {
  for (const type of ['merchant_discount', 'merchant_gift']) {
    const thursday=new Date('2026-10-15T15:59:59.999Z');
    const friday=new Date('2026-10-15T16:00:00Z');
    assert.throws(() => core.createMerchantBatch({type,quantity:1,drawDateKey:'2026-10-15',now:thursday}));
    assert.throws(() => core.createMerchantBatch({type,quantity:1,drawDateKey:'2026-10-16',now:thursday}));
    const next=core.createMerchantBatch({type,quantity:2,drawDateKey:'2026-10-16',now:friday});
    assert.equal(next.expiryDate,core.getExpiryISOString('2026-10-16'));
    assert.equal(next.expiryDate,'2026-10-22T15:59:59.999Z');
    const backfill=core.createMerchantBatch({type,quantity:3,drawDateKey:'2026-10-11',now:thursday});
    assert.equal(backfill.expiryDate,'2026-10-15T15:59:59.999Z');
    assert.equal(core.getCouponStatus(backfill,thursday),'active');
    assert.equal(core.getCouponStatus(backfill,friday),'expired');
    assert.throws(() => core.createMerchantBatch({type,quantity:1,drawDateKey:'2026-10-08',now:friday}));
    assert.throws(() => core.createMerchantBatch({type,quantity:1,drawDateKey:'2026-12-18',now:new Date('2026-12-20')}));
  }
});

test('merchant redemption is atomic, preserves old records and deduplicates confirmation', () => {
  const now = new Date('2026-10-21T04:00:00Z');
  for (const type of ['merchant_discount','merchant_gift']) {
    const original = {id:'offer',type,quantity:2,usedCount:0,status:'active',expiryDate:'2026-10-22T15:59:59.999Z',merchant:'舊商戶',terms:'舊條款'};
    const coupons=[{id:'gov',amount:50,status:'active'},original];
    const logs=[{id:'old-log',desc:'舊紀錄'}];
    const first=core.commitMerchantRedemption({coupons,logs,couponId:'offer',entryId:'confirm-1',now});
    assert.equal(first.added,true);
    assert.equal(core.getMerchantCounts(first.coupons[1]).remaining,1);
    assert.deepEqual(first.coupons[0],coupons[0]);
    assert.equal(original.usedCount,0);
    assert.equal(first.coupons[1].merchant,original.merchant);
    assert.equal(first.coupons[1].expiryDate,original.expiryDate);
    assert.equal(first.logs[0].couponType,type);
    assert.equal(first.logs[0].quantity,1);
    assert.equal(first.logs[0].date,now.toISOString());
    assert.deepEqual(first.logs[1],logs[0]);
    const again=core.commitMerchantRedemption({...first,couponId:'offer',entryId:'confirm-1',now});
    assert.equal(again.added,false);
    assert.strictEqual(again.coupons,first.coupons);
    const last=core.commitMerchantRedemption({...first,couponId:'offer',entryId:'confirm-2',now});
    assert.equal(last.coupons[1].status,'used');
    assert.equal(core.getMerchantCounts(last.coupons[1]).remaining,0);
    assert.equal(core.commitMerchantRedemption({...last,couponId:'offer',entryId:'confirm-3',now}).added,false);
  }
});

test('expired, missing and government coupons cannot enter merchant redemption', () => {
  for (const offer of [{id:'x',type:'merchant_gift',status:'expired'},{id:'x',type:'government',status:'active'},null]) {
    const coupons=[offer],logs=[];
    const result=core.commitMerchantRedemption({coupons,logs,couponId:'x',entryId:'test'});
    assert.equal(result.added,false);
    assert.strictEqual(result.coupons,coupons);
    assert.strictEqual(result.logs,logs);
  }
});
