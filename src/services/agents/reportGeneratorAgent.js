const logger = require('../../utils/logger');

const safeRound = (value, decimals = 2) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
};

const generateReportSummary = (input = {}) => {
  const carbonData = input.carbonData || {};
  const emissionsSummary = input.emissionsSummary || {};
  const compliance = input.compliance || {};
  const frameworks = Array.isArray(input.reportingFrameworks)
    ? input.reportingFrameworks
    : [];

  return {
    title: 'Carbon emissions and reporting orchestration summary',
    totalEmissionsKg: safeRound(carbonData.totalEmissions ?? emissionsSummary.totalEmissions, 2),
    primaryBehaviors: emissionsSummary.primaryBehaviors || [],
    dataQualityConfidence: input.context?.dataQuality?.confidence ?? null,
    complianceStatus: compliance.status || 'unknown',
    complianceReadinessScore: compliance.readinessScore ?? null,
    reportingFrameworks: frameworks,
    period: input.period || null,
    generatedAt: new Date().toISOString()
  };
};

const generateCarbonSection = (carbonData = {}) => {
  const categoryBreakdown = carbonData.categoryBreakdown || {};
  const categories = Object.entries(categoryBreakdown)
    .map(([category, emissions]) => ({
      category,
      emissionsKg: safeRound(emissions, 2)
    }))
    .sort((a, b) => b.emissionsKg - a.emissionsKg);

  return {
    title: 'Emissions inventory',
    totalEmissionsKg: safeRound(carbonData.totalEmissions, 2),
    topCategories: categories.slice(0, 5),
    insights: carbonData.insights || [],
    scopeProxy: {
      scope1Categories: ['fuel', 'diesel', 'petrol', 'gas', 'lpg', 'natural_gas', 'coal'],
      scope2Categories: ['energy', 'electricity']
    }
  };
};

const generateCarbonCharts = (carbonData = {}) => {
  const categoryBreakdown = carbonData.categoryBreakdown || {};
  return Object.entries(categoryBreakdown).map(([category, value]) => ({
    type: 'category_emissions',
    category,
    value: safeRound(value, 2)
  }));
};

const generateTrendsSection = (trends = {}) => ({
  title: 'Emissions trends',
  emissionsTrend: trends.emissions || trends,
  efficiencyTrend: trends.efficiency || null,
  sustainabilityTrend: trends.sustainability || null
});

const generateTrendCharts = (trends = {}) => {
  const emissionsTrend = trends?.emissions || trends;
  if (!emissionsTrend || typeof emissionsTrend !== 'object') {
    return [];
  }
  return [{
    type: 'emissions_trend',
    data: emissionsTrend
  }];
};

const generateRecommendationsSection = (recommendations = []) => {
  const normalized = Array.isArray(recommendations)
    ? recommendations
    : (recommendations?.recommendations || []);

  return {
    title: 'Prioritized reduction actions',
    count: normalized.length,
    items: normalized.slice(0, 8)
  };
};

class ReportGeneratorAgent {
  constructor() {
    this.name = 'Report Generator Agent';
    this.type = 'report_generator';
    this.capabilities = [
      'report_generation',
      'carbon_reporting',
      'trend_visualization',
      'compliance_reporting'
    ];
  }

  async generateReport(input = {}) {
    try {
      const frameworks = Array.isArray(input.reportingFrameworks)
        ? input.reportingFrameworks
        : [];

      const report = {
        summary: generateReportSummary(input),
        sections: [],
        charts: [],
        recommendations: [],
        reportingOutcomes: {
          frameworks,
          readinessByFramework: {},
          disclosureHighlights: []
        }
      };

      if (input.carbonData) {
        report.sections.push(generateCarbonSection(input.carbonData));
        report.charts.push(...generateCarbonCharts(input.carbonData));
      }

      if (input.trends) {
        report.sections.push(generateTrendsSection(input.trends));
        report.charts.push(...generateTrendCharts(input.trends));
      }

      if (input.recommendations) {
        const recommendationsSection = generateRecommendationsSection(input.recommendations);
        report.sections.push(recommendationsSection);
        report.recommendations = recommendationsSection.items;
      }

      if (input.compliance) {
        report.sections.push({
          title: 'Compliance and reporting readiness',
          status: input.compliance.status,
          readinessScore: input.compliance.readinessScore,
          openIssues: (input.compliance.issues || []).slice(0, 6),
          frameworkResults: input.compliance.frameworks || {}
        });
        frameworks.forEach((framework) => {
          const frameworkKey = String(framework).toLowerCase();
          const frameworkResult = input.compliance.frameworks?.[frameworkKey]
            || input.compliance.frameworks?.[framework];
          report.reportingOutcomes.readinessByFramework[framework] = {
            readinessScore: frameworkResult?.readinessScore ?? input.compliance.readinessScore ?? null,
            status: frameworkResult?.status || input.compliance.status
          };
        });
      }

      if (input.emissionsSummary?.carbonRecommendations?.length) {
        report.reportingOutcomes.disclosureHighlights.push(
          ...input.emissionsSummary.carbonRecommendations
            .slice(0, 3)
            .map(item => item.title || item.message)
            .filter(Boolean)
        );
      }

      report.reportingOutcomes.overallReadinessScore = Object.values(report.reportingOutcomes.readinessByFramework)
        .map(item => Number(item?.readinessScore))
        .filter(score => Number.isFinite(score))
        .reduce((sum, score, _, arr) => (arr.length ? sum + score / arr.length : null), null);

      return report;
    } catch (error) {
      logger.error('Report generation failed:', error);
      throw error;
    }
  }
}

const reportGeneratorAgent = new ReportGeneratorAgent();

module.exports = reportGeneratorAgent;
module.exports.ReportGeneratorAgent = ReportGeneratorAgent;
module.exports.generateReportSummary = generateReportSummary;
module.exports.generateCarbonSection = generateCarbonSection;
module.exports.generateCarbonCharts = generateCarbonCharts;
module.exports.generateTrendsSection = generateTrendsSection;
module.exports.generateTrendCharts = generateTrendCharts;
module.exports.generateRecommendationsSection = generateRecommendationsSection;
