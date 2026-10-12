(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CouponCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MACAU_TIME_ZONE = 'Asia/Macau';
  const CAMPAIGN_START = '2026-10-09';
  const CAMPAIGN_END = '2026-12-17';
  const DRAW_DAYS = new Set([0, 5, 6]);

  const macauFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: MACAU_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  function getMacauDateKey(date) {
    const parts = macauFormatter.formatToParts(date).reduce((result, part) => {
      if (part.type !== 'literal') result[part.type] = part.value;
      return result;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function parseDateKey(dateKey, hour = 12, minute = 0, second = 0, millisecond = 0) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
    const date = new Date(`${dateKey}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.${String(millisecond).padStart(3, '0')}+08:00`);
    return Number.isNaN(date.getTime()) || getMacauDateKey(date) !== dateKey ? null : date;
  }

  function shiftDateKey(dateKey, days) {
    const date = parseDateKey(dateKey);
    if (!date) return null;
    date.setUTCDate(date.getUTCDate() + days);
    return getMacauDateKey(date);
  }

  function getMacauWeekday(dateKey) {
    const date = parseDateKey(dateKey);
    return date ? date.getUTCDay() : null;
  }

  function isCampaignDate(dateKey) {
    return typeof dateKey === 'string' && dateKey >= CAMPAIGN_START && dateKey <= CAMPAIGN_END;
  }

  function isDrawDate(dateKey) {
    return isCampaignDate(dateKey) && DRAW_DAYS.has(getMacauWeekday(dateKey));
  }

  function getMostRecentDrawDate(now) {
    let dateKey = getMacauDateKey(now);
    for (let i = 0; i < 8; i += 1) {
      if (isDrawDate(dateKey)) return dateKey;
      dateKey = shiftDateKey(dateKey, -1);
    }
    return null;
  }

  function getDrawPeriodStart(dateKey) {
    const weekday = getMacauWeekday(dateKey);
    if (!DRAW_DAYS.has(weekday)) return null;
    const daysSinceFriday = weekday === 5 ? 0 : weekday === 6 ? 1 : 2;
    return shiftDateKey(dateKey, -daysSinceFriday);
  }

  function getExpiryISOString(dateKey) {
    const weekday = getMacauWeekday(dateKey);
    if (!DRAW_DAYS.has(weekday)) return null;
    const daysUntilThursday = weekday === 5 ? 6 : weekday === 6 ? 5 : 4;
    return parseDateKey(shiftDateKey(dateKey, daysUntilThursday), 23, 59, 59, 999).toISOString();
  }

  function validateBackfillDate(dateKey, now) {
    if (!isDrawDate(dateKey)) return '補登日期必須係活動期間內嘅星期五、六或日。';
    if (dateKey > getMacauDateKey(now)) return '補登日期唔可以遲過澳門今日日期。';
    return '';
  }

  function commitDrawEntry({ coupons, logs, platform, drawCounts, noWinCount, drawDateKey, recordedAt, drawTime, entryId }) {
    const safeCoupons = Array.isArray(coupons) ? coupons : [];
    const safeLogs = Array.isArray(logs) ? logs : [];
    if (!entryId || safeLogs.some(log => log && log.entryId === entryId) || safeCoupons.some(coupon => coupon && coupon.entryId === entryId)) {
      return { coupons: safeCoupons, logs: safeLogs, added: false };
    }

    const parsedDrawDate = drawTime instanceof Date && !Number.isNaN(drawTime.getTime()) && getMacauDateKey(drawTime) === drawDateKey
      ? drawTime
      : parseDateKey(drawDateKey);
    const expiryDate = getExpiryISOString(drawDateKey);
    if (!parsedDrawDate || !expiryDate) {
      return { coupons: safeCoupons, logs: safeLogs, added: false };
    }
    const drawDate = parsedDrawDate.toISOString();
    const summary = [];
    const newCoupons = [];
    [10, 20, 50, 100, 200].forEach(amount => {
      const count = Number(drawCounts[amount]) || 0;
      if (count > 0) summary.push(`${count}張 $${amount}`);
      for (let i = 0; i < count; i += 1) {
        newCoupons.push({
          id: `${entryId}-coupon-${amount}-${i}`,
          entryId,
          amount,
          platform,
          drawDate,
          expiryDate,
          status: 'active'
        });
      }
    });
    if (noWinCount > 0) summary.push(`${noWinCount}次未有中獎`);

    return {
      coupons: [...safeCoupons, ...newCoupons],
      logs: [{
        id: `${entryId}-log`,
        entryId,
        type: 'draw',
        date: recordedAt.toISOString(),
        drawDate,
        desc: `喺 ${platform} 抽券: ${summary.join(', ')}`
      }, ...safeLogs],
      added: true
    };
  }

  return {
    MACAU_TIME_ZONE,
    CAMPAIGN_START,
    CAMPAIGN_END,
    getMacauDateKey,
    isDrawDate,
    getMostRecentDrawDate,
    getDrawPeriodStart,
    getExpiryISOString,
    validateBackfillDate,
    commitDrawEntry
  };
});
