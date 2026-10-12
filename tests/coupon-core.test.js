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
