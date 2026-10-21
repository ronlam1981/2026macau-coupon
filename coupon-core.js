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
  const GOVERNMENT_COUPON = 'government';
  const MERCHANT_DISCOUNT = 'merchant_discount';
  const MERCHANT_GIFT = 'merchant_gift';

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

  function getMacauTemporalState(now) {
    const safeNow = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    const dateKey = getMacauDateKey(safeNow);
    return {
      dateKey,
      isDrawDay: isDrawDate(dateKey),
      suggestedDrawDate: getMostRecentDrawDate(safeNow) || dateKey,
      campaignStatus: dateKey < CAMPAIGN_START ? 'upcoming' : dateKey > CAMPAIGN_END ? 'ended' : 'active'
    };
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

  function commitDrawEntry({ coupons, logs, platform, drawCounts, noWinCount, drawDateKey, recordedAt, drawTime, entryId, merchantCounts = {} }) {
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
          type: GOVERNMENT_COUPON,
          faceValue: amount,
          threshold: amount * 3,
          platform,
          drawDate,
          expiryDate,
          status: 'active'
        });
      }
    });
    for (const [type, key, label] of [[MERCHANT_DISCOUNT, 'discountCount', '商戶滿減券'], [MERCHANT_GIFT, 'giftCount', '消費禮遇券']]) {
      const quantity = Number(merchantCounts[key] || 0);
      if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 9999) return { coupons: safeCoupons, logs: safeLogs, added: false };
      if (quantity > 0) {
        const offer = createMerchantBatch({ type, quantity, platform, drawDateKey, now: recordedAt, id: entryId + '-' + type });
        newCoupons.push({ ...offer, entryId });
        summary.push(quantity + '張' + label);
      }
    }
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

  function getCouponType(coupon) {
    if (!coupon || typeof coupon !== 'object') return GOVERNMENT_COUPON;
    if ([GOVERNMENT_COUPON, MERCHANT_DISCOUNT, MERCHANT_GIFT].includes(coupon.type)) return coupon.type;
    return GOVERNMENT_COUPON;
  }

  function getCouponStatus(coupon, now = new Date()) {
    if (!coupon || typeof coupon !== 'object') return 'unknown';
    if (coupon.status === 'used') return 'used';
    if (coupon.status === 'expired') return 'expired';
    if (coupon.expiryDate) {
      const expiry = new Date(coupon.expiryDate);
      if (!Number.isNaN(expiry.getTime()) && expiry < now) return 'expired';
    }
    return coupon.status === 'active' ? 'active' : 'unknown';
  }

  function buildUsagePlans(coupons, now = new Date()) {
    const activeGovernment = (Array.isArray(coupons) ? coupons : [])
      .filter(coupon => getCouponType(coupon) === GOVERNMENT_COUPON && getCouponStatus(coupon, now) === 'active')
      .filter(coupon => Number(coupon.amount) > 0 && coupon.platform);
    const wallets = new Map();
    activeGovernment.forEach(coupon => {
      if (!wallets.has(coupon.platform)) wallets.set(coupon.platform, []);
      wallets.get(coupon.platform).push(coupon);
    });

    const walletGroups = [...wallets.entries()].map(([wallet, walletCoupons]) => {
      const ordered = [...walletCoupons].sort((a, b) => Number(b.amount) - Number(a.amount));
      const faceValue = ordered.reduce((sum, coupon) => sum + Number(coupon.amount), 0);
      return {
        wallet,
        coupons: ordered,
        faceValue,
        requiredSpend: faceValue * 3,
        outOfPocket: faceValue * 2
      };
    }).sort((a, b) => b.faceValue - a.faceValue || a.wallet.localeCompare(b.wallet));

    const totals = walletGroups.reduce((result, group) => ({
      faceValue: result.faceValue + group.faceValue,
      requiredSpend: result.requiredSpend + group.requiredSpend,
      outOfPocket: result.outOfPocket + group.outOfPocket
    }), { faceValue: 0, requiredSpend: 0, outOfPocket: 0 });

    const byWallet = {
      id: 'by-wallet',
      title: '每個錢包一次用完',
      transactionCount: walletGroups.length,
      transactions: walletGroups.map(group => ({ ...group })),
      ...totals
    };
    const oneByOneTransactions = walletGroups.flatMap(group => group.coupons.map(coupon => ({
      wallet: group.wallet,
      coupons: [coupon],
      faceValue: Number(coupon.amount),
      requiredSpend: Number(coupon.amount) * 3,
      outOfPocket: Number(coupon.amount) * 2
    })));
    const oneByOne = {
      id: 'one-by-one',
      title: '每張券分開一次',
      transactionCount: oneByOneTransactions.length,
      transactions: oneByOneTransactions,
      ...totals
    };
    return { walletGroups, totals, options: walletGroups.length ? [byWallet, oneByOne] : [] };
  }

  function getMerchantCounts(offer) {
    const quantity = Number.isSafeInteger(offer.quantity) && offer.quantity > 0 ? offer.quantity : 1;
    const used = offer.status === 'used' ? quantity
      : Math.min(quantity, Math.max(0, Number.isSafeInteger(offer.usedCount) ? offer.usedCount : 0));
    return { quantity, used, remaining: quantity - used };
  }

  function createMerchantBatch({ type, quantity, platform, drawDateKey, id, now = new Date() }) {
    if (![MERCHANT_DISCOUNT, MERCHANT_GIFT].includes(type)) throw new Error('請選擇商戶券分類。');
    const count = Number(quantity);
    if (!Number.isSafeInteger(count) || count < 1 || count > 9999) throw new Error('張數須為 1 至 9999 的整數。');
    const dateError = validateBackfillDate(drawDateKey, now);
    if (dateError) throw new Error(dateError);
    const expiryDate = getExpiryISOString(drawDateKey);
    return { id, type, ...(platform ? { platform } : {}), quantity: count, usedCount: 0, expiryDate, drawDate: parseDateKey(drawDateKey).toISOString(),
      status: 'active', termsVerified: false, stackability: 'unknown', recordedAt: now.toISOString() };
  }

  function changeMerchantUsage(offer, delta, now = new Date()) {
    if (![MERCHANT_DISCOUNT, MERCHANT_GIFT].includes(getCouponType(offer)) || ![1, -1].includes(delta)) return offer;
    const counts = getMerchantCounts(offer);
    if (delta === 1 && (getCouponStatus(offer, now) !== 'active' || counts.remaining === 0)) return offer;
    if (delta === -1 && counts.used === 0) return offer;
    const usedCount = counts.used + delta;
    return { ...offer, usedCount, status: usedCount === counts.quantity ? 'used' : offer.status === 'expired' ? 'expired' : 'active' };
  }

  function commitMerchantRedemption({ coupons, logs, couponId, entryId, now = new Date() }) {
    const unchanged = { coupons, logs, added: false };
    if (!entryId || logs.some(log => log && log.entryId === entryId)) return unchanged;
    const offer = coupons.find(c => c && c.id === couponId);
    if (!offer) return unchanged;
    const updated = changeMerchantUsage(offer, 1, now);
    if (updated === offer) return unchanged;
    const couponType = getCouponType(offer);
    const label = couponType === MERCHANT_DISCOUNT ? '商戶滿減券' : '消費禮遇券';
    return {
      coupons: coupons.map(c => c === offer ? updated : c),
      logs: [{ id: entryId, entryId, type: 'redeem', couponId, couponType, quantity: 1,
        date: now.toISOString(), desc: `核消${label} 1 張` }, ...logs],
      added: true
    };
  }

  function isMerchantOfferEligibleForAutoPlan(offer) {
    if (!offer || getCouponStatus(offer) !== 'active') return false;
    if (![MERCHANT_DISCOUNT, MERCHANT_GIFT].includes(getCouponType(offer))) return false;
    return offer.termsVerified === true && offer.stackability === 'verified';
  }

  // Record already-used coupons. This does not perform payment or merchant redemption.
  function commitRedemption({ coupons, logs, couponIds, entryId, now = new Date() }) {
    const unchanged = { coupons, logs, added: false };
    if (!entryId || logs.some(log => log.entryId === entryId) || !couponIds.length) return unchanged;
    const ids = [...new Set(couponIds)];
    const selected = ids.map(id => coupons.find(c => c.id === id));
    if (selected.some(c => !c || getCouponStatus(c, now) !== 'active' ||
      (getCouponType(c) !== GOVERNMENT_COUPON && getMerchantCounts(c).remaining < 1))) return unchanged;
    const date = now.toISOString();
    const records = selected.map((c, i) => {
      const couponType = getCouponType(c);
      const label = couponType === GOVERNMENT_COUPON ? `政府券 $${c.amount}` : couponType === MERCHANT_DISCOUNT ? '商戶滿減券' : '消費禮遇券';
      return { id: `${entryId}-${i}`, entryId, type: 'redeem', couponId: c.id, couponType,
        platform: c.platform || null, quantity: 1, date, desc: `核銷${label} 1 張（${c.platform || '未指定 App'}）` };
    });
    return { added: true, logs: [...records, ...logs], coupons: coupons.map(c => !ids.includes(c.id) ? c :
      getCouponType(c) === GOVERNMENT_COUPON ? { ...c, status: 'used', usedDate: date } :
      { ...changeMerchantUsage(c, 1, now), usedDate: date }) };
  }

  return {
    MACAU_TIME_ZONE,
    CAMPAIGN_START,
    CAMPAIGN_END,
    GOVERNMENT_COUPON,
    MERCHANT_DISCOUNT,
    MERCHANT_GIFT,
    getMacauDateKey,
    isDrawDate,
    getMostRecentDrawDate,
    getMacauTemporalState,
    getDrawPeriodStart,
    getExpiryISOString,
    validateBackfillDate,
    commitDrawEntry,
    getCouponType,
    getCouponStatus,
    buildUsagePlans,
    getMerchantCounts,
    createMerchantBatch,
    changeMerchantUsage,
    commitMerchantRedemption,
    commitRedemption,
    isMerchantOfferEligibleForAutoPlan
  };
});
