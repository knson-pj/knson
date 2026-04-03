(() => {
  "use strict";

  const PropertyDomain = window.KNSN_PROPERTY_DOMAIN || null;

  function truncateDisplayText(value, maxLength) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    const limit = Number(maxLength || 0);
    if (!text) return '';
    if (!Number.isFinite(limit) || limit <= 0 || text.length <= limit) return text;
    if (limit <= 1) return text.slice(0, limit);
    return `${text.slice(0, limit - 1)}…`;
  }

  function getFloorDisplayValue(item) {
    const raw = item?._raw && typeof item._raw === 'object' ? item._raw : (item?.raw && typeof item.raw === 'object' ? item.raw : {});
    const floor = String(item?.floor ?? raw.floor ?? raw.floorText ?? '').trim();
    const total = String(item?.totalfloor ?? item?.total_floor ?? raw.totalfloor ?? raw.total_floor ?? raw.totalFloor ?? '').trim();
    if (floor && total) {
      if (floor.includes('/')) return floor;
      return `${floor}/${total}`;
    }
    return floor || total || '';
  }

  function getCurrentPriceValue(row) {
    if (!row || typeof row !== 'object') return 0;
    if (PropertyDomain && typeof PropertyDomain.getCurrentPriceValue === 'function') {
      return PropertyDomain.getCurrentPriceValue(row);
    }
    const value = row.lowprice ?? row.currentPrice ?? row.current_price;
    if (value == null || value === '') return Number(row?.priceMain ?? row?.price_main ?? row?.appraisalPrice ?? 0) || 0;
    return Number(value || 0) || 0;
  }

  function getRatioValue(row) {
    const appraisal = Number(row?.priceMain ?? row?.price_main ?? row?.appraisalPrice ?? 0) || 0;
    const current = Number(getCurrentPriceValue(row) || 0) || 0;
    if (appraisal > 0 && current > 0) return current / appraisal;
    const raw = row?._raw || row?.raw || {};
    const rawRate = raw && (raw['최저입찰가율(%)'] || raw.bidRate || raw.rate);
    const numeric = Number(String(rawRate || '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(numeric) ? numeric / 100 : -1;
  }

  function isPlainSourceFilterSelected(value) {
    const key = String(value || '').trim();
    return key === 'realtor_naver' || key === 'realtor_direct' || key === 'general';
  }

  function resolveSourceBucket(itemOrRow, fallbackSourceType = '') {
    if (PropertyDomain && typeof PropertyDomain.getSourceBucket === 'function') {
      return PropertyDomain.getSourceBucket(
        itemOrRow || { sourceType: fallbackSourceType },
        String(fallbackSourceType || itemOrRow?.sourceType || itemOrRow?.property_source_type || '').trim()
      );
    }
    const source = String(fallbackSourceType || itemOrRow?.sourceType || itemOrRow?.property_source_type || '').trim();
    return source || 'general';
  }

  function getSourceBucketLabel(bucketOrItem, fallbackSourceType = '') {
    const bucket = (bucketOrItem && typeof bucketOrItem === 'object')
      ? resolveSourceBucket(bucketOrItem, fallbackSourceType)
      : String(bucketOrItem || '').trim() || resolveSourceBucket(null, fallbackSourceType);
    if (PropertyDomain && typeof PropertyDomain.getSourceBucketLabel === 'function') {
      return PropertyDomain.getSourceBucketLabel(bucket);
    }
    const map = {
      auction: '경매',
      onbid: '공매',
      realtor_naver: '네이버중개',
      realtor_direct: '일반중개',
      realtor: '중개',
      general: '일반',
    };
    return map[bucket] || '일반';
  }

  function getSourceBucketClass(bucketOrItem, fallbackSourceType = '') {
    const bucket = (bucketOrItem && typeof bucketOrItem === 'object')
      ? resolveSourceBucket(bucketOrItem, fallbackSourceType)
      : String(bucketOrItem || '').trim() || resolveSourceBucket(null, fallbackSourceType);
    if (PropertyDomain && typeof PropertyDomain.getSourceBucketClass === 'function') {
      return PropertyDomain.getSourceBucketClass(bucket);
    }
    const map = {
      auction: 'kind-auction',
      onbid: 'kind-gongmae',
      realtor_naver: 'kind-realtor-naver',
      realtor_direct: 'kind-realtor-direct',
      realtor: 'kind-realtor',
      general: 'kind-general',
    };
    return map[bucket] || 'kind-general';
  }

  function formatDateCell(value, formatDateFn, escapeHtmlFn) {
    const text = typeof formatDateFn === 'function' ? formatDateFn(value) : String(value || '').trim();
    const normalized = String(text || '').trim() || '-';
    return typeof escapeHtmlFn === 'function' ? escapeHtmlFn(normalized) : normalized;
  }

  window.KNSN_PROPERTY_RENDERERS = {
    truncateDisplayText,
    getFloorDisplayValue,
    getCurrentPriceValue,
    getRatioValue,
    isPlainSourceFilterSelected,
    resolveSourceBucket,
    getSourceBucketLabel,
    getSourceBucketClass,
    formatDateCell,
  };
})();
