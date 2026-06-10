const STAGE_DEFINITIONS = {
  upstream: { stage: 'upstream', label: 'Upstream (Suppliers and Inputs)' },
  operations: { stage: 'operations', label: 'Operations (Internal Processing)' },
  downstream: { stage: 'downstream', label: 'Downstream (Distribution and Customers)' },
  support: { stage: 'support', label: 'Support Activities' }
};

const STAGE_ORDER = ['upstream', 'operations', 'downstream', 'support'];

const UPSTREAM_CATEGORIES = new Set([
  'raw_materials',
  'materials',
  'chemicals',
  'packaging',
  'consumables'
]);

const OPERATIONS_CATEGORIES = new Set([
  'energy',
  'utilities',
  'water',
  'waste_management',
  'equipment',
  'maintenance',
  'machinery',
  'process'
]);

const DOWNSTREAM_CATEGORIES = new Set([
  'transportation',
  'distribution',
  'logistics',
  'sales'
]);

const DOWNSTREAM_KEYWORDS = [
  'customer',
  'delivery',
  'dispatch',
  'shipment',
  'freight',
  'distribution',
  'export',
  'sales'
];

const UPSTREAM_KEYWORDS = [
  'supplier',
  'vendor',
  'procurement',
  'raw material',
  'input',
  'purchase'
];

const OPERATIONS_KEYWORDS = [
  'plant',
  'production',
  'machinery',
  'maintenance',
  'utility',
  'electricity',
  'diesel',
  'fuel'
];

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const asNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const roundTo = (value, decimals = 2) => {
  const factor = Math.pow(10, decimals);
  return Math.round(asNumber(value) * factor) / factor;
};

const toLabel = (value) => normalizeText(value)
  .split('_')
  .filter(Boolean)
  .map(token => token.charAt(0).toUpperCase() + token.slice(1))
  .join(' ') || 'Other';

const includesAnyKeyword = (text, keywords = []) => keywords.some(keyword => text.includes(keyword));

const resolveTransactionStage = (transaction = {}) => {
  const category = normalizeText(transaction.category);
  const transactionType = normalizeText(transaction.transactionType);
  const searchText = normalizeText(`${transaction.description || ''} ${transaction.subcategory || ''}`);

  if (
    transactionType === 'sale' ||
    transactionType === 'transport' ||
    DOWNSTREAM_CATEGORIES.has(category) ||
    includesAnyKeyword(searchText, DOWNSTREAM_KEYWORDS)
  ) {
    return 'downstream';
  }

  if (
    transactionType === 'purchase' ||
    transactionType === 'investment' ||
    UPSTREAM_CATEGORIES.has(category) ||
    includesAnyKeyword(searchText, UPSTREAM_KEYWORDS)
  ) {
    return 'upstream';
  }

  if (
    transactionType === 'expense' ||
    transactionType === 'utility' ||
    OPERATIONS_CATEGORIES.has(category) ||
    includesAnyKeyword(searchText, OPERATIONS_KEYWORDS)
  ) {
    return 'operations';
  }

  return 'support';
};

const extractPartnerName = (transaction = {}) => {
  if (typeof transaction.vendor === 'string' && transaction.vendor.trim()) {
    return transaction.vendor.trim();
  }

  if (transaction.vendor && typeof transaction.vendor === 'object' && String(transaction.vendor.name || '').trim()) {
    return String(transaction.vendor.name).trim();
  }

  if (typeof transaction.counterparty === 'string' && transaction.counterparty.trim()) {
    return transaction.counterparty.trim();
  }

  if (typeof transaction.customer === 'string' && transaction.customer.trim()) {
    return transaction.customer.trim();
  }

  return null;
};

const updatePartnerTotals = (partnerTotals, partnerName, amount) => {
  if (!partnerName) return;
  const existing = partnerTotals.get(partnerName) || { name: partnerName, transactionCount: 0, totalValue: 0 };
  existing.transactionCount += 1;
  existing.totalValue += amount;
  partnerTotals.set(partnerName, existing);
};

const buildTopPartners = (partnerTotals, totalValue, limit = 5) => {
  return Array.from(partnerTotals.values())
    .sort((left, right) => right.totalValue - left.totalValue)
    .slice(0, limit)
    .map(partner => ({
      name: partner.name,
      transactionCount: partner.transactionCount,
      totalValue: roundTo(partner.totalValue, 2),
      sharePercent: totalValue > 0 ? roundTo((partner.totalValue / totalValue) * 100, 1) : 0
    }));
};

const buildStageCategoryBreakdown = (categories, stageTotalValue, stageTransactionCount) => {
  const useValueShare = stageTotalValue > 0;
  const denominator = useValueShare ? stageTotalValue : stageTransactionCount;

  return Object.values(categories)
    .sort((left, right) => right.totalValue - left.totalValue)
    .slice(0, 5)
    .map(item => ({
      category: item.category,
      label: toLabel(item.category),
      transactionCount: item.transactionCount,
      totalValue: roundTo(item.totalValue, 2),
      sharePercent: denominator > 0
        ? roundTo(((useValueShare ? item.totalValue : item.transactionCount) / denominator) * 100, 1)
        : 0
    }));
};

const resolveDominantStage = (stages) => {
  if (!Array.isArray(stages) || stages.length === 0) {
    return 'support';
  }
  return [...stages]
    .sort((left, right) => {
      if (right.totalValue === left.totalValue) {
        return right.transactionCount - left.transactionCount;
      }
      return right.totalValue - left.totalValue;
    })[0]?.stage || 'support';
};

const resolvePeriodFromTransactions = (transactions = []) => {
  let startDate = null;
  let endDate = null;

  transactions.forEach(transaction => {
    if (!transaction?.date) return;
    const parsed = new Date(transaction.date);
    if (Number.isNaN(parsed.getTime())) return;
    if (!startDate || parsed < startDate) {
      startDate = parsed;
    }
    if (!endDate || parsed > endDate) {
      endDate = parsed;
    }
  });

  return {
    startDate: startDate ? startDate.toISOString() : null,
    endDate: endDate ? endDate.toISOString() : null
  };
};

const buildCoverageScore = (msme = {}, transactions = []) => {
  const profileSignals = [
    Boolean(msme.companyName),
    Boolean(msme.industry),
    Boolean(msme.businessDomain),
    Boolean(msme?.business?.primaryProducts)
  ];
  const profileScore = profileSignals.filter(Boolean).length / profileSignals.length;
  const transactionScore = Math.min(1, (Array.isArray(transactions) ? transactions.length : 0) / 20);
  const amountCoverage = (Array.isArray(transactions) ? transactions : [])
    .filter(transaction => asNumber(transaction.amount) > 0).length;
  const amountScore = transactions.length > 0 ? amountCoverage / transactions.length : 0;

  return roundTo((profileScore * 0.4 + transactionScore * 0.4 + amountScore * 0.2) * 100, 1);
};

const buildInsights = ({
  totalTransactions,
  stageContributionPercent,
  suppliers,
  customers,
  dominantStage
}) => {
  if (totalTransactions === 0) {
    return [
      'No transactions were available for the selected period, so value chain mapping is based only on company profile signals.'
    ];
  }

  const insights = [];

  if ((stageContributionPercent.upstream || 0) >= 50) {
    insights.push('Upstream spend dominates the value chain, indicating strong supplier dependency.');
  }

  if ((stageContributionPercent.operations || 0) >= 50) {
    insights.push('Operational activities represent the largest value-chain load and should be prioritized for efficiency programs.');
  }

  if ((stageContributionPercent.downstream || 0) >= 35) {
    insights.push('Downstream activity is material, suggesting logistics and customer delivery are core value-chain drivers.');
  }

  if ((stageContributionPercent.downstream || 0) < 10 && totalTransactions >= 8) {
    insights.push('Downstream visibility is limited in transaction data; consider tagging sales and distribution transactions more explicitly.');
  }

  if (suppliers[0] && suppliers[0].sharePercent >= 30) {
    insights.push(`Supplier concentration risk detected: ${suppliers[0].name} accounts for ${suppliers[0].sharePercent}% of mapped supplier value.`);
  }

  if (!customers.length) {
    insights.push('Customer-side counterparties are not explicitly captured in transactions; downstream mapping may be partial.');
  }

  if (insights.length === 0) {
    insights.push(`Value chain is currently balanced with ${dominantStage} as the dominant stage.`);
  }

  return insights;
};

const buildValueChainReport = ({ msme = {}, transactions = [], generatedAt = new Date() } = {}) => {
  const safeTransactions = Array.isArray(transactions) ? transactions : [];
  const stageStats = STAGE_ORDER.reduce((accumulator, stage) => {
    accumulator[stage] = {
      stage,
      label: STAGE_DEFINITIONS[stage].label,
      transactionCount: 0,
      totalValue: 0,
      categories: {},
      partners: new Map()
    };
    return accumulator;
  }, {});

  const supplierTotals = new Map();
  const customerTotals = new Map();

  safeTransactions.forEach(transaction => {
    const stage = resolveTransactionStage(transaction);
    const amount = asNumber(transaction.amount);
    const normalizedAmount = amount > 0 ? amount : 0;
    const category = normalizeText(transaction.category) || 'other';
    const transactionType = normalizeText(transaction.transactionType);
    const partnerName = extractPartnerName(transaction);

    const stageRecord = stageStats[stage] || stageStats.support;
    stageRecord.transactionCount += 1;
    stageRecord.totalValue += normalizedAmount;

    const existingCategory = stageRecord.categories[category] || {
      category,
      transactionCount: 0,
      totalValue: 0
    };
    existingCategory.transactionCount += 1;
    existingCategory.totalValue += normalizedAmount;
    stageRecord.categories[category] = existingCategory;

    updatePartnerTotals(stageRecord.partners, partnerName, normalizedAmount);

    if (stage === 'upstream' || transactionType === 'purchase' || transactionType === 'investment') {
      updatePartnerTotals(supplierTotals, partnerName, normalizedAmount);
    }

    if (stage === 'downstream' || transactionType === 'sale' || transactionType === 'transport') {
      updatePartnerTotals(customerTotals, partnerName, normalizedAmount);
    }
  });

  const stages = STAGE_ORDER.map(stage => ({
    stage,
    label: stageStats[stage].label,
    transactionCount: stageStats[stage].transactionCount,
    totalValue: roundTo(stageStats[stage].totalValue, 2),
    keyCategories: buildStageCategoryBreakdown(
      stageStats[stage].categories,
      stageStats[stage].totalValue,
      stageStats[stage].transactionCount
    ),
    topPartners: buildTopPartners(stageStats[stage].partners, stageStats[stage].totalValue, 3)
  }));

  const totalTransactionValue = roundTo(
    stages.reduce((sum, stage) => sum + stage.totalValue, 0),
    2
  );
  const totalTransactions = safeTransactions.length;
  const contributionBasis = totalTransactionValue > 0 ? 'transaction_value' : 'transaction_count';
  const denominator = contributionBasis === 'transaction_value'
    ? totalTransactionValue
    : totalTransactions;

  stages.forEach(stage => {
    const measure = contributionBasis === 'transaction_value'
      ? stage.totalValue
      : stage.transactionCount;
    stage.contributionPercent = denominator > 0
      ? roundTo((measure / denominator) * 100, 1)
      : 0;
  });

  const stageContributionPercent = stages.reduce((accumulator, stage) => {
    accumulator[stage.stage] = stage.contributionPercent;
    return accumulator;
  }, {});

  const suppliers = buildTopPartners(supplierTotals, totalTransactionValue, 5);
  const customers = buildTopPartners(customerTotals, totalTransactionValue, 5);
  const dominantStage = resolveDominantStage(stages);
  const period = resolvePeriodFromTransactions(safeTransactions);

  return {
    summary: {
      companyName: msme?.companyName || 'MSME',
      industry: msme?.industry || 'General',
      businessDomain: msme?.businessDomain || 'other',
      companyType: msme?.companyType || 'small',
      primaryProducts: msme?.business?.primaryProducts || null,
      totalTransactions,
      totalTransactionValue,
      contributionBasis,
      dominantStage,
      stageContributionPercent,
      period,
      dataCoverageScore: buildCoverageScore(msme, safeTransactions)
    },
    stages,
    keyPartners: {
      suppliers,
      customers
    },
    insights: buildInsights({
      totalTransactions,
      stageContributionPercent,
      suppliers,
      customers,
      dominantStage
    }),
    generatedAt: new Date(generatedAt).toISOString()
  };
};

module.exports = {
  buildValueChainReport
};
