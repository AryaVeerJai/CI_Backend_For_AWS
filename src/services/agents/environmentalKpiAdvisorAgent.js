/**
 * Water, waste, and non-GHG environmental KPI guidance (BRSR Principle 6 alignment).
 */
const buildEnvironmentalKpiAdvisory = ({ msmeData = {}, transactions = [] }) => {
  const env = msmeData.environmentalCompliance || {};
  const ops = msmeData.operations || {};

  const hasWaste = Boolean(env.hasWasteManagement);
  const waterSource = ops.waterSource || env.waterSource || '';
  const wastePractice = ops.wasteManagementPractice || env.wasteManagementPractice || '';

  const waterSignals = transactions.filter((tx) => {
    const cat = String(tx.category || tx.sustainabilityCategory || '').toLowerCase();
    const desc = String(tx.description || '').toLowerCase();
    return cat.includes('water') || /water|wastewater|effluent/.test(desc);
  }).length;

  const wasteSignals = transactions.filter((tx) => {
    const cat = String(tx.category || '').toLowerCase();
    const desc = String(tx.description || '').toLowerCase();
    return cat.includes('waste') || /waste|scrap|landfill|recycl/.test(desc);
  }).length;

  const kpis = [
    {
      id: 'water_withdrawal',
      label: 'Water withdrawal / consumption',
      brsrPrinciple: 6,
      status: waterSource || waterSignals > 0 ? 'partial' : 'missing',
      valueHint: waterSource || (waterSignals > 0 ? 'Derived from water-related spend' : null),
      action: waterSource
        ? 'Link water bills to volumetric m³ where available.'
        : 'Add water source and monthly consumption in company profile.'
    },
    {
      id: 'waste_generated',
      label: 'Waste generated in operations',
      brsrPrinciple: 6,
      status: hasWaste || wastePractice || wasteSignals > 0 ? 'partial' : 'missing',
      valueHint: wastePractice || (hasWaste ? 'Waste management declared' : null),
      action: hasWaste
        ? 'Quantify hazardous vs non-hazardous waste tonnes per year.'
        : 'Declare waste management practice in profile and upload disposal invoices.'
    },
    {
      id: 'energy_intensity',
      label: 'Energy intensity (optional PAT link)',
      brsrPrinciple: 6,
      status: 'informational',
      valueHint: null,
      action: 'Use electricity and fuel bills with activity data for intensity metrics.'
    }
  ];

  const completeCount = kpis.filter((k) => k.status === 'complete').length;
  const partialCount = kpis.filter((k) => k.status === 'partial').length;
  const readinessScore = Math.round(
    (completeCount * 40 + partialCount * 25 + (waterSignals + wasteSignals > 0 ? 15 : 0)) / 1.15
  );

  const summary =
    readinessScore >= 70
      ? 'Environmental KPIs are largely documented for BRSR-style disclosure.'
      : readinessScore >= 40
        ? 'Water and waste KPIs are partially captured — complete profile fields and bills.'
        : 'Water and waste metrics are missing — buyers may request Principle 6 datapoints.';

  return {
    readinessScore: Math.min(100, readinessScore),
    summary,
    kpis,
    recommendations: kpis
      .filter((k) => k.status === 'missing')
      .map((k) => ({
        priority: 'medium',
        title: k.label,
        action: k.action,
        path: '/msme-profile'
      }))
  };
};

module.exports = {
  buildEnvironmentalKpiAdvisory,
  async execute(task = {}) {
    const { input = {} } = task;
    return buildEnvironmentalKpiAdvisory(input);
  }
};
