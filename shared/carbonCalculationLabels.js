/**
 * Shared labels for carbon calculation audit fields (web + mobile).
 */
const CARBON_DEFAULTS = require('./carbonEmissionDefaults.json');

const DATA_QUALITY_TIER_LABELS = Object.freeze({
  tier_1_activity: 'Tier 1 — activity-based',
  tier_2_spend_proxy: 'Tier 2 — spend proxy',
  tier_3_estimate: 'Tier 3 — estimate',
  excluded: 'Excluded',
});

const QUANTIFICATION_METHOD_LABELS = Object.freeze({
  activity_based: 'Activity-based',
  spend_proxy: 'Spend proxy',
  estimate: 'Estimate',
  excluded: 'Excluded',
});

const GHG_SCOPE3_CATEGORY_LABELS = Object.freeze({
  cat1_purchased_goods: 'Cat 1 — purchased goods',
  cat2_capital_goods: 'Cat 2 — capital goods',
  cat3_fuel_energy_related: 'Cat 3 — fuel & energy related (FERA)',
  cat4_upstream_transport: 'Cat 4 — upstream transport',
  cat5_waste: 'Cat 5 — waste',
  cat6_business_travel: 'Cat 6 — business travel',
  cat7_employee_commuting: 'Cat 7 — employee commuting',
});

const RECALCULATION_TRIGGER_OPTIONS = Object.freeze([
  { id: 'structural_change', label: 'Structural change (merger, divestiture, facility change)' },
  { id: 'methodology_change', label: 'Methodology or emission factor update' },
  { id: 'base_year_update', label: 'Base year recalculation' },
  { id: 'data_correction', label: 'Material data correction discovered' },
  { id: 'boundary_change', label: 'Organizational or operational boundary change' },
  { id: 'discovery_error', label: 'Discovery of a significant calculation error' },
]);

const COMPLIANCE_INVENTORY_LABEL = 'Compliance inventory (ISO 14064 aligned)';
const CARBON_MODEL_VERSION = CARBON_DEFAULTS.configVersion || '2026-05-13';

const labelDataQualityTier = (tier) => DATA_QUALITY_TIER_LABELS[tier] || tier || '—';
const labelQuantificationMethod = (method) => QUANTIFICATION_METHOD_LABELS[method] || method || '—';
const labelScope3Category = (cat) => GHG_SCOPE3_CATEGORY_LABELS[cat] || cat || '—';

const formatComplianceFlags = (flags = {}) => {
  const items = [];
  if (flags.gst_may_be_included_in_amount) {
    items.push('GST may be included in amount — pre-tax used when GST fields present');
  }
  if (flags.sales_revenue_excluded) {
    items.push('Sales/revenue transaction excluded from inventory');
  }
  if (flags.spend_proxy_used) {
    items.push('Spend proxy used — add kWh, liter, or kg for Tier 1 data');
  }
  return items;
};

module.exports = {
  DATA_QUALITY_TIER_LABELS,
  QUANTIFICATION_METHOD_LABELS,
  GHG_SCOPE3_CATEGORY_LABELS,
  RECALCULATION_TRIGGER_OPTIONS,
  COMPLIANCE_INVENTORY_LABEL,
  CARBON_MODEL_VERSION,
  labelDataQualityTier,
  labelQuantificationMethod,
  labelScope3Category,
  formatComplianceFlags,
};
