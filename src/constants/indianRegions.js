/**
 * India state → climate/grid region mapping (single source of truth).
 */
const STATE_REGION_MAP = {
  'andhra pradesh': 'south-india',
  'arunachal pradesh': 'northeast-india',
  assam: 'northeast-india',
  bihar: 'east-india',
  chhattisgarh: 'east-india',
  goa: 'west-india',
  gujarat: 'west-india',
  haryana: 'north-india',
  'himachal pradesh': 'north-india',
  jharkhand: 'east-india',
  karnataka: 'south-india',
  kerala: 'south-india',
  'madhya pradesh': 'west-india',
  maharashtra: 'west-india',
  manipur: 'northeast-india',
  meghalaya: 'northeast-india',
  mizoram: 'northeast-india',
  nagaland: 'northeast-india',
  odisha: 'east-india',
  punjab: 'north-india',
  rajasthan: 'north-india',
  sikkim: 'northeast-india',
  'tamil nadu': 'south-india',
  telangana: 'south-india',
  tripura: 'northeast-india',
  'uttar pradesh': 'north-india',
  uttarakhand: 'north-india',
  'west bengal': 'east-india',
  delhi: 'north-india',
  'jammu and kashmir': 'north-india',
  ladakh: 'north-india',
  puducherry: 'south-india',
  chandigarh: 'north-india',
  'andaman and nicobar': 'south-india',
  lakshadweep: 'south-india',
  'dadra and nagar haveli': 'west-india',
  'daman and diu': 'west-india'
};

const normalizeStateKey = (state) => String(state || '').trim().toLowerCase();

const resolveRegionFromState = (state, fallback = 'north-india') => {
  const normalized = normalizeStateKey(state);
  if (!normalized) {
    return fallback;
  }
  if (STATE_REGION_MAP[normalized]) {
    return STATE_REGION_MAP[normalized];
  }
  if (normalized.includes('india')) {
    return normalized;
  }
  return fallback;
};

module.exports = {
  STATE_REGION_MAP,
  normalizeStateKey,
  resolveRegionFromState
};
