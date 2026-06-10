/**
 * Operational boundary agent (GHG Protocol Corporate Standard).
 * Maps activity data in this product to Scope 1, 2, and Scope 3 categories.
 */

const { DEFAULT_SCOPE3_CATEGORIES_INCLUDED } = require('../../../../shared/ghgBoundaryBrsr');

const DEFAULT_SCOPE3 = [...DEFAULT_SCOPE3_CATEGORIES_INCLUDED];

const analyzeOperationalBoundary = ({ msmeData = {}, workflowSummary = {} }) => {
  const domain = String(msmeData.businessDomain || '').toLowerCase();
  const employees = Number(workflowSummary.employees || 0);
  const supplyLinks = Number(workflowSummary.supplyChainLinks || 0);

  let scope3Suggested = [...DEFAULT_SCOPE3];
  if (employees > 0 && !scope3Suggested.includes(7)) {
    scope3Suggested.push(7);
  }
  if (supplyLinks > 0) {
    [4, 9].forEach((c) => {
      if (!scope3Suggested.includes(c)) scope3Suggested.push(c);
    });
  }
  if (['textiles', 'food_processing', 'electronics'].includes(domain)) {
    [10, 11].forEach((c) => {
      if (!scope3Suggested.includes(c)) scope3Suggested.push(c);
    });
  }
  scope3Suggested = [...new Set(scope3Suggested)].sort((a, b) => a - b);

  const notes = [];
  notes.push(
    'Scope 1 should cover stationary and mobile combustion you operate, plus process and fugitive releases if material.'
  );
  notes.push(
    'Scope 2: report location-based grid electricity at minimum; add market-based if you hold contractual instruments.'
  );
  notes.push(
    'Scope 3: include categories where this workflow collects data (purchased goods, fuel energy-related, upstream transport, waste, business travel/commute, downstream transport).'
  );

  return {
    agent: 'operational_boundary_agent',
    confidence: 0.68,
    suggestedScope3CategoriesIncluded: scope3Suggested,
    scope1Toggles: {
      scope1StationaryCombustion: true,
      scope1MobileCombustion: true,
      scope1ProcessEmissions: ['manufacturing', 'food_processing', 'electronics', 'automotive', 'textiles'].includes(
        domain
      ),
      scope1FugitiveEmissions: ['food_processing', 'healthcare', 'electronics'].includes(domain)
    },
    scope2Toggles: {
      scope2LocationBased: true,
      scope2MarketBased: false
    },
    materialityThresholdPercent: 5,
    notes,
    references: ['GHG Protocol Corporate Standard — Setting Operational Boundaries', 'GHG Protocol Scope 3 Standard']
  };
};

module.exports = {
  analyzeOperationalBoundary
};
