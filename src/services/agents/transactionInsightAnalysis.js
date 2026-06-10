const { safeNumber, safeRound } = require('../../utils/safeNumber');

const resolveTransactionDate = (transaction) => {
  const raw = transaction?.date || transaction?.transactionDate || transaction?.createdAt;
  const parsed = raw ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
};

const resolveTransactionEmissions = (transaction) => {
  if (Number.isFinite(transaction?._computedEmissions)) {
    return transaction._computedEmissions;
  }
  if (Number.isFinite(transaction?.carbonFootprint?.co2Emissions)) {
    return transaction.carbonFootprint.co2Emissions;
  }
  if (Number.isFinite(transaction?.co2Emissions)) {
    return transaction.co2Emissions;
  }
  return 0;
};

const analyzeTransactionPatterns = (transactions = []) => {
  const list = Array.isArray(transactions) ? transactions : [];
  const emissions = list.map(resolveTransactionEmissions);
  const amounts = list.map((tx) => safeNumber(tx?.amount, 0));
  const totalEmissions = emissions.reduce((sum, value) => sum + value, 0);
  const totalAmount = amounts.reduce((sum, value) => sum + value, 0);
  const count = list.length || 1;

  const byCategory = {};
  list.forEach((tx) => {
    const category = tx?.category || 'uncategorized';
    if (!byCategory[category]) {
      byCategory[category] = { count: 0, emissions: 0, amount: 0 };
    }
    byCategory[category].count += 1;
    byCategory[category].emissions += resolveTransactionEmissions(tx);
    byCategory[category].amount += safeNumber(tx?.amount, 0);
  });

  return {
    transactionCount: list.length,
    avgEmission: totalEmissions / count,
    avgAmount: totalAmount / count,
    totalEmissions,
    totalAmount,
    byCategory,
    emissions,
    amounts
  };
};

const resolveAnomalyMultiplier = (transactionCount, { high = 3, low = 2 } = {}) => (
  transactionCount < 10 ? low : high
);

const detectEmissionAnomalies = (patterns = {}) => {
  const anomalies = [];
  const avgEmission = safeNumber(patterns.avgEmission, 0);
  if (avgEmission <= 0 || !Array.isArray(patterns.emissions)) {
    return anomalies;
  }
  const threshold = avgEmission * resolveAnomalyMultiplier(patterns.transactionCount, { high: 3, low: 2 });
  patterns.emissions.forEach((emission, index) => {
    if (emission > threshold) {
      anomalies.push({
        type: 'high_emission',
        index,
        message: 'Unusually high emission transaction detected',
        value: safeRound(emission, 2),
        threshold: safeRound(threshold, 2),
        severity: 'high'
      });
    }
  });
  return anomalies;
};

const detectSpendingAnomalies = (patterns = {}) => {
  const anomalies = [];
  const avgAmount = safeNumber(patterns.avgAmount, 0);
  if (avgAmount <= 0 || !Array.isArray(patterns.amounts)) {
    return anomalies;
  }
  const threshold = avgAmount * resolveAnomalyMultiplier(patterns.transactionCount, { high: 5, low: 2 });
  patterns.amounts.forEach((amount, index) => {
    if (amount > threshold) {
      anomalies.push({
        type: 'high_spending',
        index,
        message: 'Unusually high spending transaction detected',
        value: safeRound(amount, 2),
        threshold: safeRound(threshold, 2),
        severity: 'medium'
      });
    }
  });
  return anomalies;
};

const detectFrequencyAnomalies = (patterns = {}) => {
  const anomalies = [];
  const byCategory = patterns.byCategory || {};
  const categories = Object.entries(byCategory);
  if (categories.length < 2) {
    return anomalies;
  }
  const counts = categories.map(([, data]) => safeNumber(data.count, 0));
  const avgCount = counts.reduce((sum, value) => sum + value, 0) / counts.length;
  categories.forEach(([category, data]) => {
    if (data.count > avgCount * 4) {
      anomalies.push({
        type: 'category_frequency_spike',
        category,
        message: `Unusually high transaction frequency in ${category}`,
        value: data.count,
        threshold: Math.ceil(avgCount * 4),
        severity: 'low'
      });
    }
  });
  return anomalies;
};

const calculateAnomalySeverity = (anomalies = []) => {
  if (!anomalies.length) {
    return 'none';
  }
  if (anomalies.some((item) => item.severity === 'high')) {
    return 'high';
  }
  if (anomalies.some((item) => item.severity === 'medium')) {
    return 'medium';
  }
  return 'low';
};

const bucketTransactionsByMonth = (transactions = []) => {
  const buckets = new Map();
  transactions.forEach((tx) => {
    const date = resolveTransactionDate(tx);
    if (!date) {
      return;
    }
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!buckets.has(key)) {
      buckets.set(key, { emissions: 0, amount: 0, count: 0 });
    }
    const bucket = buckets.get(key);
    bucket.emissions += resolveTransactionEmissions(tx);
    bucket.amount += safeNumber(tx?.amount, 0);
    bucket.count += 1;
  });
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, stats]) => ({ period, ...stats }));
};

const computeTrendDirection = (series = []) => {
  if (series.length < 2) {
    return 'stable';
  }
  const first = series[0];
  const last = series[series.length - 1];
  const delta = last - first;
  const threshold = Math.max(Math.abs(first) * 0.05, 0.01);
  if (delta > threshold) {
    return 'increasing';
  }
  if (delta < -threshold) {
    return 'decreasing';
  }
  return 'stable';
};

const analyzeEmissionTrends = (data = {}) => {
  const transactions = Array.isArray(data?.transactions) ? data.transactions : [];
  const monthly = bucketTransactionsByMonth(transactions);
  const emissionsSeries = monthly.map((item) => safeRound(item.emissions, 2));
  return {
    direction: computeTrendDirection(emissionsSeries),
    monthly,
    series: emissionsSeries,
    averageMonthlyEmissions: emissionsSeries.length
      ? safeRound(emissionsSeries.reduce((sum, value) => sum + value, 0) / emissionsSeries.length, 2)
      : 0
  };
};

const analyzeSpendingTrends = (data = {}) => {
  const transactions = Array.isArray(data?.transactions) ? data.transactions : [];
  const monthly = bucketTransactionsByMonth(transactions);
  const amountSeries = monthly.map((item) => safeRound(item.amount, 2));
  return {
    direction: computeTrendDirection(amountSeries),
    monthly,
    series: amountSeries
  };
};

const analyzeEfficiencyTrends = (data = {}) => {
  const transactions = Array.isArray(data?.transactions) ? data.transactions : [];
  const monthly = bucketTransactionsByMonth(transactions).map((item) => ({
    ...item,
    emissionsPerInr: item.amount > 0 ? safeRound(item.emissions / item.amount, 4) : 0
  }));
  const efficiencySeries = monthly.map((item) => item.emissionsPerInr);
  return {
    direction: computeTrendDirection(efficiencySeries),
    monthly,
    series: efficiencySeries
  };
};

const analyzeSustainabilityTrends = (data = {}) => {
  const emissionTrends = analyzeEmissionTrends(data);
  const spendingTrends = analyzeSpendingTrends(data);
  return {
    emissions: emissionTrends,
    spending: spendingTrends,
    decarbonizationSignal: emissionTrends.direction === 'decreasing' ? 'improving' : (
      emissionTrends.direction === 'increasing' ? 'worsening' : 'stable'
    )
  };
};

const generateTrendPredictions = (trends = {}) => {
  const emissions = trends.emissions || {};
  const series = emissions.series || [];
  if (series.length < 2) {
    return { nextPeriodEmissions: null, confidence: 0.3 };
  }
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const delta = last - prev;
  return {
    nextPeriodEmissions: safeRound(Math.max(0, last + delta), 2),
    confidence: series.length >= 4 ? 0.75 : 0.5,
    method: 'linear_extrapolation'
  };
};

const generateTrendInsights = (trends = {}) => {
  const insights = [];
  const emissions = trends.emissions || {};
  if (emissions.direction && emissions.direction !== 'stable') {
    insights.push({
      type: 'emission_trend',
      message: `Emissions trend is ${emissions.direction} over the reporting window`,
      direction: emissions.direction,
      averageMonthlyEmissions: emissions.averageMonthlyEmissions
    });
  }
  const sustainability = trends.sustainability || {};
  if (sustainability.decarbonizationSignal) {
    insights.push({
      type: 'decarbonization_signal',
      message: `Decarbonization signal: ${sustainability.decarbonizationSignal}`,
      signal: sustainability.decarbonizationSignal
    });
  }
  return insights;
};

module.exports = {
  analyzeTransactionPatterns,
  detectEmissionAnomalies,
  detectSpendingAnomalies,
  detectFrequencyAnomalies,
  calculateAnomalySeverity,
  analyzeEmissionTrends,
  analyzeSpendingTrends,
  analyzeEfficiencyTrends,
  analyzeSustainabilityTrends,
  generateTrendPredictions,
  generateTrendInsights,
  resolveTransactionEmissions,
  resolveTransactionDate
};
