const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const DOCUMENT_BULK_PERIOD_TYPES = new Set(['annual', 'monthly', 'weekly', 'date_wise']);

const normalizeDocumentBulkPeriodType = (periodType) => {
  const lowered = String(periodType || 'monthly').toLowerCase();
  return DOCUMENT_BULK_PERIOD_TYPES.has(lowered) ? lowered : 'monthly';
};

const periodWiseKeyFromApiType = (periodType) => (
  periodType === 'date_wise' ? 'datewise' : periodType
);

const mapPeriodGroupToSummaryRow = (group = {}) => {
  const period = String(group.periodStart ?? group.period ?? group.startDate ?? group.bucket ?? '');
  const transactionCount = Math.round(toNumber(group.transactionCount ?? group.totalTransactions));
  const totalAmount = toNumber(group.totalAmount);
  const totalEmissions = toNumber(group.totalCO2Emissions ?? group.totalEmissions);

  return {
    periodStart: period,
    periodEnd: String(group.periodEnd ?? group.endDate ?? period),
    period,
    transactionCount,
    totalTransactions: transactionCount,
    totalAmount,
    totalEmissions,
    totalCO2Emissions: totalEmissions,
    averageEmissionPerTransaction: transactionCount > 0
      ? Number((totalEmissions / transactionCount).toFixed(3))
      : 0,
    averageEmissionFactor: totalAmount > 0
      ? Number((totalEmissions / totalAmount).toFixed(6))
      : 0
  };
};

const extractPeriodGroupsFromAssessment = (assessment, periodType) => {
  if (!assessment) {
    return [];
  }

  const periodWiseKey = periodWiseKeyFromApiType(periodType);
  const metricsSummary = assessment.documentBulkMetrics?.periodSummaries?.[periodType];
  if (Array.isArray(metricsSummary?.groups) && metricsSummary.groups.length > 0) {
    return metricsSummary.groups;
  }

  const mobilePeriodRows = assessment.mobileBreakdown?.periodWise?.[periodWiseKey];
  if (Array.isArray(mobilePeriodRows) && mobilePeriodRows.length > 0) {
    return mobilePeriodRows;
  }

  const bulkSummaryRows = assessment.documentBulkSummary?.periodWise?.[periodWiseKey];
  if (Array.isArray(bulkSummaryRows) && bulkSummaryRows.length > 0) {
    return bulkSummaryRows;
  }

  const batchBuckets = assessment.documentBatchSummary?.periodBuckets;
  if (Array.isArray(batchBuckets) && batchBuckets.length > 0) {
    return batchBuckets;
  }

  return [];
};

const buildPeriodSummaryPayload = ({ groups, periodType, assessment, source = 'assessment' }) => {
  const normalizedGroups = (Array.isArray(groups) ? groups : []).map(mapPeriodGroupToSummaryRow);
  const totalTransactions = normalizedGroups.reduce((sum, group) => sum + group.transactionCount, 0);
  const totalAmount = normalizedGroups.reduce((sum, group) => sum + group.totalAmount, 0);
  const totalEmissions = normalizedGroups.reduce((sum, group) => sum + group.totalEmissions, 0);

  return {
    periodType,
    source,
    groups: normalizedGroups,
    totalTransactions: totalTransactions || toNumber(assessment?.transactionCount),
    totalAmount: totalAmount || toNumber(assessment?.totalAmount),
    totalEmissions: totalEmissions || toNumber(assessment?.totalCO2Emissions),
    topCategories: assessment?.mobileBreakdown?.categoryBreakdown?.slice?.(0, 5) || [],
    topVendors: []
  };
};

module.exports = {
  normalizeDocumentBulkPeriodType,
  periodWiseKeyFromApiType,
  extractPeriodGroupsFromAssessment,
  buildPeriodSummaryPayload,
  mapPeriodGroupToSummaryRow
};
